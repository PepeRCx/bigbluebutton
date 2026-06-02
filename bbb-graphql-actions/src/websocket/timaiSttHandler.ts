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
  createSTTSession,
  isTimAISttEnabled,
  isLocaleSupported,
  STTSession,
} from '../services/timaiSTT';
import { translateToAllLanguages, getSupportedLocales, isTranslationEnabled } from '../services/translationService';

interface STTConnection {
  ws: WebSocket;
  session: STTSession | null;
  meetingId: string;
  moderatorUserId: string;
  senderUserId: string;
  locale: string;
  currentTranscriptId: string;
}

const connections = new Map<WebSocket, STTConnection>();

function generateTranscriptId(userId: string): string {
  return `${userId}-${Date.now()}`;
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
    const translations = await translateToAllLanguages(transcript, sourceLocale);

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
  };

  connections.set(ws, connection);

  const session = createSTTSession(locale, {
    onRecognized: async (text, resultId) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'final',
          text,
          transcriptId: connection.currentTranscriptId,
          locale,
        }));
      }

      try {
        await publishTranscript(
          redisClient,
          meetingId,
          moderatorUserId,
          connection.currentTranscriptId,
          text,
          locale,
          true
        );

        await publishTranslations(
          redisClient,
          meetingId,
          moderatorUserId,
          connection.currentTranscriptId,
          text,
          locale
        );
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
