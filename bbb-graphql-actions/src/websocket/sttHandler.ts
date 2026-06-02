/**
 * WebSocket handler for Azure Speech-to-Text streaming
 *
 * Accepts audio streams from clients, processes them through Azure STT,
 * and publishes transcripts to Redis for the caption pipeline.
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import { RedisClientType } from 'redis';
import {
  createSTTSession,
  isAzureSTTEnabled,
  isLocaleSupported,
  STTSession,
} from '../services/azureSpeechToText';
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

// Store active connections
const connections = new Map<WebSocket, STTConnection>();

/**
 * Generates a unique transcript ID
 */
function generateTranscriptId(userId: string): string {
  return `${userId}-${Date.now()}`;
}

/**
 * Publishes a transcript update to Redis (UpdateTranscriptPubMsg format)
 */
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

/**
 * Publishes translated transcripts to Redis
 */
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
    console.error('[STTHandler] Translation error:', error);
  }
}

/**
 * Handles a new WebSocket connection for STT
 */
function handleConnection(
  ws: WebSocket,
  req: IncomingMessage,
  redisClient: RedisClientType
): void {
  // Parse query parameters
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const meetingId = url.searchParams.get('meetingId');
  const moderatorUserId = url.searchParams.get('moderatorUserId');
  const senderUserId = url.searchParams.get('senderUserId');
  const locale = url.searchParams.get('locale');

  console.info(`[STTHandler] New connection: meetingId=${meetingId}, moderatorUserId=${moderatorUserId}, senderUserId=${senderUserId}, locale=${locale}`);

  // Validate parameters
  if (!meetingId || !moderatorUserId || !senderUserId || !locale) {
    console.error('[STTHandler] Missing required parameters');
    ws.close(4001, 'Missing required parameters: meetingId, moderatorUserId, senderUserId, locale');
    return;
  }

  if (!isAzureSTTEnabled()) {
    console.error('[STTHandler] Azure STT is not enabled');
    ws.close(4002, 'Azure STT service is not available');
    return;
  }

  if (!isLocaleSupported(locale)) {
    console.error(`[STTHandler] Unsupported locale: ${locale}`);
    ws.close(4003, `Unsupported locale: ${locale}`);
    return;
  }

  // Create connection record
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

  // Create STT session with callbacks
  const session = createSTTSession(locale, {
    onRecognizing: async (text, resultId) => {
      // Send interim result to client
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'interim',
          text,
          transcriptId: connection.currentTranscriptId,
          locale,
        }));
      }

      // Publish interim transcript to Redis (using moderatorUserId for attribution)
      try {
        await publishTranscript(
          redisClient,
          meetingId,
          moderatorUserId,
          connection.currentTranscriptId,
          text,
          locale,
          false
        );
      } catch (error) {
        console.error('[STTHandler] Failed to publish interim transcript:', error);
      }
    },

    onRecognized: async (text, resultId) => {
      // Send final result to client
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'final',
          text,
          transcriptId: connection.currentTranscriptId,
          locale,
        }));
      }

      // Publish final transcript to Redis
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

        // Translate to other languages
        await publishTranslations(
          redisClient,
          meetingId,
          moderatorUserId,
          connection.currentTranscriptId,
          text,
          locale
        );
      } catch (error) {
        console.error('[STTHandler] Failed to publish final transcript:', error);
      }

      // Generate new transcript ID for next sentence
      connection.currentTranscriptId = generateTranscriptId(senderUserId);
    },

    onError: (error) => {
      console.error('[STTHandler] STT session error:', error);
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
    console.error('[STTHandler] Failed to create STT session');
    ws.close(4004, 'Failed to create STT session');
    connections.delete(ws);
    return;
  }

  connection.session = session;

  // Handle incoming audio data
  ws.on('message', (data: Buffer) => {
    if (connection.session) {
      // Convert Buffer to ArrayBuffer
      const arrayBuffer = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      );
      connection.session.pushAudio(arrayBuffer);
    }
  });

  // Handle connection close
  ws.on('close', async (code: number, reason: Buffer) => {
    console.info(`[STTHandler] Connection closed: code=${code}, reason=${reason.toString()}`);

    if (connection.session) {
      try {
        await connection.session.stop();
        connection.session.close();
      } catch (error) {
        console.error('[STTHandler] Error closing session:', error);
      }
    }

    connections.delete(ws);
  });

  // Handle errors
  ws.on('error', (error: Error) => {
    console.error('[STTHandler] WebSocket error:', error);
  });

  // Send ready message
  ws.send(JSON.stringify({
    type: 'ready',
    locale,
  }));
}

/**
 * Initializes the WebSocket server for STT
 */
export function initializeSTTWebSocket(
  wss: WebSocketServer,
  redisClient: RedisClientType
): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    handleConnection(ws, req, redisClient);
  });

  console.info('[STTHandler] WebSocket handler initialized');
}

/**
 * Gets the count of active STT connections
 */
export function getActiveConnectionCount(): number {
  return connections.size;
}

export default {
  initializeSTTWebSocket,
  getActiveConnectionCount,
};
