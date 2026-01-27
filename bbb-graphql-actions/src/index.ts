import express, { Request, Response } from 'express';
import { createServer } from 'http';
import util from 'util';
import { WebSocketServer } from 'ws';
import { redisMessageFactory } from './imports/redisMessageFactory';
import { DEBUG, SERVER_HOST, SERVER_PORT, MAX_BODY_SIZE } from './config';
import { createRedisClient } from './imports/redis';
import { ValidationError } from './types/ValidationError';
import { synthesizeSpeech, isAzureTTSEnabled } from './services/azureTTS';
import { isAzureSTTEnabled } from './services/azureSpeechToText';
import { initializeSTTWebSocket, getActiveConnectionCount } from './websocket/sttHandler';

// Initialize Express Application
const app = express();
app.use(express.json({ limit: MAX_BODY_SIZE }));

// Create HTTP server from Express app
const server = createServer(app);

// Create and configure Redis client
const redisClient = createRedisClient();

// Create WebSocket server for STT on path /stt/ws
const wss = new WebSocketServer({
  server,
  path: '/stt/ws',
});

/**
 * Handles action submissions and publishes them to Redis.
 */
app.post('/', async (req: Request, res: Response) => {
  try {
    // Destructure relevant information from the request body.
    const { action: { name: actionName }, input, session_variables: sessionVariables } = req.body;


    if(DEBUG) {
      console.debug('-------------------------------------------');
      console.debug(actionName);
      console.debug(sessionVariables);
    }

    // Build messages using received information (may return multiple messages).
    const messages = await redisMessageFactory.buildMessage(sessionVariables, actionName, input);

    // Publish all messages to Redis
    for (const message of messages) {
      const {
        eventName,
        routing,
        header,
        body
      } = message;

      // Construct payload to be sent to Redis.
      const redisPayload = {
        envelope: {
          name: eventName,
          routing,
          timestamp: Date.now(),
        },
        core: { header, body },
      };

      // If in debug mode, log the input and output information.
      if(DEBUG) {
        console.log(util.inspect({
          input: { actionName, input, sessionVariables },
          output: { redisPayload },
        }, { depth: null, colors: true }));
      }

      // Publish the constructed payload to Redis.
      if(actionName == 'userThirdPartyInfoResquest') {
        await redisClient.publish('to-third-party-redis-channel', JSON.stringify(redisPayload));
      } else {
        await redisClient.publish('to-akka-apps-redis-channel', JSON.stringify(redisPayload));
      }
    }

    // Send a success response.
    res.status(200).json(true);

  } catch (error) {
    const actionName = req.body?.action?.name || 'Unidentified Action';

    if (error instanceof ValidationError) {
      res.status(error.status).send({message: `${actionName}: ${error.message}`});
    } else {
      console.error(error);
      res.status(400).send({message: `${actionName}: Internal Server Error`});
    }
  }
});

/**
 * TTS (Text-to-Speech) endpoint for voice translation
 * Receives text and locale, returns audio as base64
 */
app.post('/tts', async (req: Request, res: Response) => {
  try {
    const { text, locale } = req.body;

    // Validate required fields
    if (!text || typeof text !== 'string') {
      res.status(400).json({ success: false, error: 'Missing or invalid text parameter' });
      return;
    }

    if (!locale || typeof locale !== 'string') {
      res.status(400).json({ success: false, error: 'Missing or invalid locale parameter' });
      return;
    }

    // Check if TTS is enabled
    if (!isAzureTTSEnabled()) {
      res.status(503).json({ success: false, error: 'TTS service is not available' });
      return;
    }

    if (DEBUG) {
      console.debug('[TTS] Request:', { text: text.substring(0, 50), locale });
    }

    // Synthesize speech
    const result = await synthesizeSpeech(text, locale);

    if (result.success && result.audio) {
      res.status(200).json({
        success: true,
        audio: result.audio,
        contentType: 'audio/mpeg',
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'TTS synthesis failed',
      });
    }
  } catch (error) {
    console.error('[TTS] Error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Health check endpoint for TTS service
 */
app.get('/tts/health', (req: Request, res: Response) => {
  res.status(200).json({
    enabled: isAzureTTSEnabled(),
    service: 'azure-tts',
  });
});

/**
 * Health check endpoint for STT service
 */
app.get('/stt/health', (req: Request, res: Response) => {
  res.status(200).json({
    enabled: isAzureSTTEnabled(),
    service: 'azure-stt',
    activeConnections: getActiveConnectionCount(),
  });
});

// Start the server and establish a connection to Redis.
const startServer = () => {
  console.info("Starting server");
  server.listen(SERVER_PORT, SERVER_HOST, () => {
    console.log(`Server is running on ${SERVER_HOST}:${SERVER_PORT}`);
    console.info("Waiting for Redis connection");
    redisClient.connect();
  });
}

// Initialize WebSocket handler for STT after Redis is connected
redisClient.on('connect', () => {
  console.info("Connected with Redis");
  // Initialize STT WebSocket with Redis client
  // @ts-ignore - RedisClient type compatibility
  initializeSTTWebSocket(wss, redisClient);
});
redisClient.on('disconnect', () => console.info("Disconnected from Redis"));

if(DEBUG) {
  console.log('Debug mode Enabled!');
}

// Start the Server and Redis client.
startServer();
