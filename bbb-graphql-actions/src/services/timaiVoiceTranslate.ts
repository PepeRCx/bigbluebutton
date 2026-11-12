import { OpusEncoder } from '@discordjs/opus';
import WebSocket from 'ws';
import { TIMAI_VOICE_TRANSLATE_URL } from '../config';
import { BBB_TO_TIMAI_LANGUAGE, TIMAI_TO_BBB_LOCALE } from './timaiLocales';

const SAMPLE_RATE = 16000;
const FRAME_DURATION_MS = 20;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000;
const FRAME_BYTES = SAMPLES_PER_FRAME * 2;
const READY_TIMEOUT_MS = 15000;
const END_TIMEOUT_MS = 30000;

interface VoiceMessage {
  type?: string;
  message?: string;
  text?: string;
  utterance_id?: string;
  is_final?: boolean;
}

export interface TimAIVoiceCallbacks {
  onTranscript: (text: string, sequence: number) => void | Promise<void>;
  onTranslation: (text: string, targetLocale: string, sequence: number) => void | Promise<void>;
  onError: (error: string) => void | Promise<void>;
}

export interface TimAIVoiceSession {
  pushAudio: (audioData: Buffer) => void;
  endStream: () => Promise<void>;
  stop: () => void;
}

function reportCallbackError(callbacks: TimAIVoiceCallbacks, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  void Promise.resolve(callbacks.onError(message)).catch(() => undefined);
}

interface TargetConnection {
  targetLanguage: string;
  socket: WebSocket;
  sequenceByUtterance: Map<string, number>;
  currentSequence: number;
  ready: boolean;
  done: boolean;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  resolveDone: () => void;
  readyPromise: Promise<void>;
  donePromise: Promise<void>;
}

function createTargetConnection(
  sourceLanguage: string,
  targetLanguage: string,
  callbacks: TimAIVoiceCallbacks,
): TargetConnection {
  const socket = new WebSocket(TIMAI_VOICE_TRANSLATE_URL);
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveDone!: () => void;

  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const donePromise = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const connection: TargetConnection = {
    targetLanguage,
    socket,
    sequenceByUtterance: new Map(),
    currentSequence: 0,
    ready: false,
    done: false,
    resolveReady,
    rejectReady,
    resolveDone,
    readyPromise,
    donePromise,
  };

  const readyTimeout = setTimeout(() => {
    connection.rejectReady(new Error(`Timed out connecting to Tim AI v2 for ${targetLanguage}`));
    socket.terminate();
  }, READY_TIMEOUT_MS);

  socket.on('open', () => {
    socket.send(JSON.stringify({
      language: sourceLanguage,
      target: targetLanguage,
      sample_rate: SAMPLE_RATE,
    }));
  });

  socket.on('message', (data) => {
    let message: VoiceMessage;
    try {
      message = JSON.parse(data.toString()) as VoiceMessage;
    } catch {
      reportCallbackError(callbacks, `Invalid Tim AI v2 response for target ${targetLanguage}`);
      return;
    }

    if (message.type === 'ready') {
      if (!connection.ready) {
        connection.ready = true;
        clearTimeout(readyTimeout);
        connection.resolveReady();
      }
      return;
    }

    if (message.type === 'error') {
      const error = message.message || `Tim AI v2 failed for target ${targetLanguage}`;
      if (!connection.ready) {
        clearTimeout(readyTimeout);
        connection.rejectReady(new Error(error));
      } else {
        reportCallbackError(callbacks, error);
      }
      return;
    }

    if (message.type === 'transcript' && message.is_final && message.utterance_id && message.text) {
      connection.currentSequence += 1;
      connection.sequenceByUtterance.set(message.utterance_id, connection.currentSequence);
      void Promise.resolve(callbacks.onTranscript(message.text, connection.currentSequence))
        .catch((error: unknown) => reportCallbackError(callbacks, error));
      return;
    }

    if (message.type === 'translation' && message.is_final && message.utterance_id && message.text) {
      const sequence = connection.sequenceByUtterance.get(message.utterance_id);
      const targetLocale = TIMAI_TO_BBB_LOCALE[targetLanguage];
      if (sequence !== undefined && targetLocale) {
        void Promise.resolve(callbacks.onTranslation(message.text, targetLocale, sequence))
          .catch((error: unknown) => reportCallbackError(callbacks, error));
      }
      connection.sequenceByUtterance.delete(message.utterance_id);
      return;
    }

    if (message.type === 'done') {
      connection.done = true;
      connection.resolveDone();
    }
  });

  socket.on('error', (error) => {
    clearTimeout(readyTimeout);
    if (!connection.ready) {
      connection.rejectReady(error);
    } else {
      reportCallbackError(callbacks, error);
    }
  });

  socket.on('close', () => {
    clearTimeout(readyTimeout);
    if (!connection.ready) {
      connection.rejectReady(new Error(`Tim AI v2 closed before ready for ${targetLanguage}`));
    }
    if (!connection.done) {
      connection.done = true;
      connection.resolveDone();
    }
  });

  return connection;
}

export async function createTimAIVoiceSession(
  sourceLocale: string,
  targetLocales: string[],
  callbacks: TimAIVoiceCallbacks,
): Promise<TimAIVoiceSession> {
  const sourceLanguage = BBB_TO_TIMAI_LANGUAGE[sourceLocale];
  if (!sourceLanguage) {
    throw new Error(`Unsupported Tim AI source locale: ${sourceLocale}`);
  }

  const targetLanguages = [...new Set(targetLocales
    .map((locale) => BBB_TO_TIMAI_LANGUAGE[locale])
    .filter((language): language is string => !!language && language !== sourceLanguage))];

  if (targetLanguages.length === 0) {
    throw new Error(`No Tim AI v2 targets available for source locale ${sourceLocale}`);
  }

  const connections = targetLanguages.map((target) =>
    createTargetConnection(sourceLanguage, target, callbacks));

  try {
    await Promise.all(connections.map(({ readyPromise }) => readyPromise));
  } catch (error) {
    connections.forEach(({ socket }) => socket.terminate());
    throw error;
  }

  const encoder = new OpusEncoder(SAMPLE_RATE, 1);
  let pendingPcm = Buffer.alloc(0);
  let stopped = false;

  const sendPcmFrame = (pcmFrame: Buffer) => {
    try {
      const opusPacket = encoder.encode(pcmFrame);
      connections.forEach(({ socket, ready }) => {
        if (ready && socket.readyState === WebSocket.OPEN) {
          socket.send(opusPacket);
        }
      });
    } catch (error) {
      reportCallbackError(callbacks, error);
    }
  };

  const sendPendingFrames = (flushPartial = false) => {
    while (pendingPcm.length >= FRAME_BYTES) {
      sendPcmFrame(pendingPcm.subarray(0, FRAME_BYTES));
      pendingPcm = pendingPcm.subarray(FRAME_BYTES);
    }

    if (flushPartial && pendingPcm.length > 0) {
      const paddedFrame = Buffer.alloc(FRAME_BYTES);
      pendingPcm.copy(paddedFrame);
      pendingPcm = Buffer.alloc(0);
      sendPcmFrame(paddedFrame);
    }
  };

  return {
    pushAudio: (audioData: Buffer) => {
      if (stopped || audioData.length === 0) {
        return;
      }
      pendingPcm = pendingPcm.length
        ? Buffer.concat([pendingPcm, audioData])
        : Buffer.from(audioData);
      sendPendingFrames();
    },

    endStream: async () => {
      if (stopped) {
        return;
      }
      sendPendingFrames(true);
      stopped = true;

      connections.forEach(({ socket }) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'end' }));
        }
      });

      await Promise.race([
        Promise.all(connections.map(({ donePromise }) => donePromise)),
        new Promise<void>((resolve) => setTimeout(resolve, END_TIMEOUT_MS)),
      ]);
      connections.forEach(({ socket }) => socket.close());
    },

    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      connections.forEach(({ socket }) => socket.close());
    },
  };
}
