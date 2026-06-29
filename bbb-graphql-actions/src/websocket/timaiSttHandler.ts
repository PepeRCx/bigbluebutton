/**
 * WebSocket handler for Tim AI (OmniVoice) Speech-to-Text streaming
 *
 * Accepts raw Int16 PCM audio streams from browser clients,
 * batches them, sends to the OmniVoice HTTP STT endpoint,
 * and publishes transcripts to Redis for the BBB caption pipeline.
 * Uses the configured translation backend for real-time caption translation.
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import { RedisClientType } from 'redis';
import {
  TRANSLATION_PROVIDER,
  TIMAI_STT_DUPLICATE_MAX_WORDS,
  TIMAI_STT_DUPLICATE_WINDOW_MS,
  TIMAI_STT_REPETITION_THRESHOLD,
} from '../config';
import {
  createSTTSession,
  isTimAISttEnabled,
  isLocaleSupported,
  STTSession,
} from '../services/timaiSTT';
import { getTargetLocales } from '../services/meetingCaptionDemand';
import { translateText, getSupportedLocales, isTranslationEnabled } from '../services/translationService';

const DUPLICATE_MAX_CHARS = 32;

interface STTConnection {
  ws: WebSocket;
  session: STTSession | null;
  meetingId: string;
  moderatorUserId: string;
  senderUserId: string;
  locale: string;
  currentTranscriptId: string;
  lastPublishedTranscriptNormalized: string;
  lastPublishedTranscriptAt: number;
}

const connections = new Map<WebSocket, STTConnection>();

function generateTranscriptId(userId: string): string {
  return `${userId}-${Date.now()}`;
}

function normalizeTranscript(transcript: string): string {
  return transcript.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getWordCount(transcript: string): number {
  return transcript ? transcript.split(' ').length : 0;
}

function hasConsecutiveRepetition(transcript: string, minConsecutive: number = 3): boolean {
  const words = normalizeTranscript(transcript).split(' ');
  if (words.length < minConsecutive) {
    return false;
  }

  let consecutive = 1;
  for (let i = 1; i < words.length; i += 1) {
    if (words[i] === words[i - 1]) {
      consecutive += 1;
      if (consecutive >= minConsecutive) {
        return true;
      }
    } else {
      consecutive = 1;
    }
  }

  return false;
}

function hasExcessiveWordRepetition(
  transcript: string,
  threshold: number = TIMAI_STT_REPETITION_THRESHOLD,
): boolean {
  const words = normalizeTranscript(transcript).split(' ');
  if (words.length < 4) {
    return false;
  }

  const wordFrequency = new Map<string, number>();
  words.forEach((word) => {
    wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
  });

  const maxFrequency = Math.max(...wordFrequency.values());
  return maxFrequency / words.length > threshold;
}

function shouldSuppressTranscript(connection: STTConnection, transcript: string): boolean {
  const normalizedTranscript = normalizeTranscript(transcript);
  if (!normalizedTranscript) {
    return false;
  }

  // Suppress obvious degenerate repetitions such as "hello hello hello".
  if (hasConsecutiveRepetition(transcript, 3)) {
    return true;
  }

  if (hasExcessiveWordRepetition(transcript)) {
    return true;
  }

  const wordCount = getWordCount(normalizedTranscript);
  const isShortPhrase = wordCount <= TIMAI_STT_DUPLICATE_MAX_WORDS
    || normalizedTranscript.length <= DUPLICATE_MAX_CHARS;

  if (!isShortPhrase) {
    return false;
  }

  const withinWindow = (Date.now() - connection.lastPublishedTranscriptAt) <= TIMAI_STT_DUPLICATE_WINDOW_MS;
  if (!withinWindow) {
    return false;
  }

  return normalizedTranscript === connection.lastPublishedTranscriptNormalized;
}

async function publishTranscript(
  redisClient: RedisClientType,
  meetingId: string,
  userId: string,
  transcriptId: string,
  transcript: string,
  locale: string,
  isFinal: boolean
): Promise<void> {
  const eventName = 'UpdateTranscriptPubMsg';

  const redisPayload = {
    envelope: {
      name: eventName,
      routing: {
        meetingId,
        userId,
      },
      timestamp: Date.now(),
    },
    core: {
      header: {
        name: eventName,
        meetingId,
        userId,
      },
      body: {
        transcriptId,
        start: 0,
        end: transcript.length,
        text: transcript,
        transcript,
        locale,
        result: isFinal,
      },
    },
  };

  await redisClient.publish('to-akka-apps-redis-channel', JSON.stringify(redisPayload));
}

async function publishTranslations(
  redisClient: RedisClientType,
  meetingId: string,
  userId: string,
  baseTranscriptId: string,
  transcript: string,
  sourceLocale: string
): Promise<void> {
  if (!isTranslationEnabled() || !transcript.trim()) {
    return;
  }

  const supportedLocales = getSupportedLocales();
  if (!supportedLocales.includes(sourceLocale)) {
    return;
  }

  try {
    const targetLocales = TRANSLATION_PROVIDER === 'tim-ai'
      ? await getTargetLocales(meetingId, sourceLocale, supportedLocales)
      : supportedLocales.filter((locale) => locale !== sourceLocale);

    if (targetLocales.length === 0) {
      console.info(`[TimAI-STTHandler] Translation skipped: no demanded target locales for meetingId=${meetingId}`);
      return;
    }

    const translations = await translateText(transcript, sourceLocale, targetLocales);

    for (const translation of translations) {
      const translatedTranscriptId = `${baseTranscriptId}-${translation.locale}`;
      await publishTranscript(
        redisClient,
        meetingId,
        userId,
        translatedTranscriptId,
        translation.text,
        translation.locale,
        true
      );
    }
  } catch (error) {
    console.error('[TimAI-STTHandler] Translation error:', error);
  }
}

function handleConnection(
  ws: WebSocket,
  req: IncomingMessage,
  redisClient: RedisClientType
): void {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const meetingId = url.searchParams.get('meetingId');
  const moderatorUserId = url.searchParams.get('moderatorUserId');
  const senderUserId = url.searchParams.get('senderUserId');
  const locale = url.searchParams.get('locale');

  console.info(`[TimAI-STTHandler] New connection: meetingId=${meetingId}, moderatorUserId=${moderatorUserId}, senderUserId=${senderUserId}, locale=${locale}`);

  if (!meetingId || !moderatorUserId || !senderUserId || !locale) {
    console.error('[TimAI-STTHandler] Missing required parameters');
    ws.close(4001, 'Missing required parameters: meetingId, moderatorUserId, senderUserId, locale');
    return;
  }

  if (!isTimAISttEnabled()) {
    console.error('[TimAI-STTHandler] Tim AI STT is not enabled');
    ws.close(4002, 'Tim AI STT service is not available');
    return;
  }

  if (!isLocaleSupported(locale)) {
    console.error(`[TimAI-STTHandler] Unsupported locale: ${locale}`);
    ws.close(4003, `Unsupported locale: ${locale}`);
    return;
  }

  const connection: STTConnection = {
    ws,
    session: null,
    meetingId,
    moderatorUserId,
    senderUserId,
    locale,
    currentTranscriptId: generateTranscriptId(senderUserId),
    lastPublishedTranscriptNormalized: '',
    lastPublishedTranscriptAt: 0,
  };

  connections.set(ws, connection);

  const session = createSTTSession(locale, {
    onRecognizing: async (text, resultId) => {
      const transcriptId = connection.currentTranscriptId;

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'interim',
          text,
          transcriptId,
          locale,
        }));
      }

      try {
        await publishTranscript(
          redisClient,
          meetingId,
          moderatorUserId,
          transcriptId,
          text,
          locale,
          false
        );
      } catch (error) {
        console.error('[TimAI-STTHandler] Failed to publish interim transcript:', error);
      }
    },

    onRecognized: async (text, resultId) => {
      const normalizedTranscript = normalizeTranscript(text);
      const transcriptId = connection.currentTranscriptId;

      if (shouldSuppressTranscript(connection, text)) {
        console.info(
          `[TimAI-STTHandler] Suppressed duplicate transcript for senderUserId=${senderUserId} `
          + `locale=${locale} text="${normalizedTranscript}"`,
        );
        connection.currentTranscriptId = generateTranscriptId(senderUserId);
        return;
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'final',
          text,
          transcriptId,
          locale,
        }));
      }

      try {
        await publishTranscript(
          redisClient,
          meetingId,
          moderatorUserId,
          transcriptId,
          text,
          locale,
          true
        );

        await publishTranslations(
          redisClient,
          meetingId,
          moderatorUserId,
          transcriptId,
          text,
          locale
        );

        connection.lastPublishedTranscriptNormalized = normalizedTranscript;
        connection.lastPublishedTranscriptAt = Date.now();
      } catch (error) {
        console.error('[TimAI-STTHandler] Failed to publish transcript:', error);
      }

      connection.currentTranscriptId = generateTranscriptId(senderUserId);
    },

    onError: (error) => {
      console.error('[TimAI-STTHandler] STT session error:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          error,
        }));
      }
    },

    onSessionStarted: () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'session_started',
        }));
      }
    },

    onSessionStopped: () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'session_stopped',
        }));
      }
    },
  });

  if (!session) {
    console.error('[TimAI-STTHandler] Failed to create STT session');
    ws.close(4004, 'Failed to create STT session');
    connections.delete(ws);
    return;
  }

  connection.session = session;

  ws.send(JSON.stringify({
    type: 'ready',
    locale,
  }));

  ws.on('message', (data: Buffer) => {
    if (connection.session) {
      connection.session.pushAudio(data);
    }
  });

  ws.on('close', async (code: number, reason: Buffer) => {
    console.info(`[TimAI-STTHandler] Connection closed: code=${code}`);

    if (connection.session) {
      try {
        await connection.session.endStream();
        connection.session.stop();
      } catch (error) {
        console.error('[TimAI-STTHandler] Error closing session:', error);
      }
    }

    connections.delete(ws);
  });

  ws.on('error', (error: Error) => {
    console.error('[TimAI-STTHandler] WebSocket error:', error);
  });
}

export function initializeTimAISttWebSocket(
  wss: WebSocketServer,
  redisClient: RedisClientType
): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    handleConnection(ws, req, redisClient);
  });

  console.info('[TimAI-STTHandler] WebSocket handler initialized');
}

export function getActiveConnectionCount(): number {
  return connections.size;
}

export default {
  initializeTimAISttWebSocket,
  getActiveConnectionCount,
};
