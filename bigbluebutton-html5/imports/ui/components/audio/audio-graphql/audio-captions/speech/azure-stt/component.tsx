import React, {
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { useReactiveVar } from '@apollo/client';
import AudioManager from '/imports/ui/services/audio-manager';
import useCurrentUser from '/imports/ui/core/hooks/useCurrentUser';
import useIsAudioConnected from '/imports/ui/components/audio/audio-graphql/hooks/useIsAudioConnected';
import logger from '/imports/startup/client/logger';
import Auth from '/imports/ui/services/auth';

const AUDIO_SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;

interface AzureSTTProviderProps {
  locale: string;
  connected: boolean;
  muted: boolean;
}

const AzureSTTProvider: React.FC<AzureSTTProviderProps> = ({
  locale,
  connected,
  muted,
}) => {
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isActiveRef = useRef(false);
  const localeRef = useRef(locale);

  const buildWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const meetingId = Auth.meetingID;
    const moderatorUserId = Auth.userID;
    const senderUserId = Auth.userID;
    return `${protocol}//${host}/stt/ws?meetingId=${meetingId}&moderatorUserId=${moderatorUserId}&senderUserId=${senderUserId}&locale=${localeRef.current}`;
  }, []);

  const convertFloat32ToInt16 = (float32Array: Float32Array): Int16Array => {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return int16Array;
  };

  const startAudioProcessing = useCallback(() => {
    const inputStream = AudioManager.inputStream;

    if (!inputStream) {
      logger.warn({
        logCode: 'azure_stt_no_input_stream',
      }, 'Azure STT: No input stream available');
      return;
    }

    try {
      // Clone the stream to avoid affecting the original
      const clonedStream = inputStream.clone();
      streamRef.current = clonedStream;

      // Create AudioContext with target sample rate
      const audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
      audioContextRef.current = audioContext;

      // Create source from cloned stream
      const source = audioContext.createMediaStreamSource(clonedStream);
      sourceRef.current = source;

      // Create ScriptProcessorNode for processing audio
      const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        if (!isActiveRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputData = event.inputBuffer.getChannelData(0);
        const int16Data = convertFloat32ToInt16(inputData);

        // Send audio data as binary
        wsRef.current.send(int16Data.buffer);
      };

      // Connect nodes
      source.connect(processor);
      processor.connect(audioContext.destination);

      logger.info({
        logCode: 'azure_stt_audio_processing_started',
      }, 'Azure STT: Audio processing started');
    } catch (error) {
      logger.error({
        logCode: 'azure_stt_audio_processing_error',
        extraInfo: {
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      }, 'Azure STT: Failed to start audio processing');
    }
  }, []);

  const stopAudioProcessing = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    logger.info({
      logCode: 'azure_stt_audio_processing_stopped',
    }, 'Azure STT: Audio processing stopped');
  }, []);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const url = buildWebSocketUrl();
    logger.info({
      logCode: 'azure_stt_connecting',
      extraInfo: { url },
    }, 'Azure STT: Connecting to WebSocket');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      logger.info({
        logCode: 'azure_stt_connected',
      }, 'Azure STT: WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'ready':
            logger.info({
              logCode: 'azure_stt_ready',
              extraInfo: { locale: message.locale },
            }, 'Azure STT: Service ready');
            isActiveRef.current = true;
            startAudioProcessing();
            break;

          case 'session_started':
            logger.debug({
              logCode: 'azure_stt_session_started',
            }, 'Azure STT: Recognition session started');
            break;

          case 'interim':
            logger.debug({
              logCode: 'azure_stt_interim_result',
              extraInfo: { text: message.text },
            }, `Azure STT interim: ${message.text}`);
            break;

          case 'final':
            logger.debug({
              logCode: 'azure_stt_final_result',
              extraInfo: { text: message.text },
            }, `Azure STT final: ${message.text}`);
            break;

          case 'error':
            logger.error({
              logCode: 'azure_stt_error',
              extraInfo: { error: message.error },
            }, `Azure STT error: ${message.error}`);
            break;

          case 'session_stopped':
            logger.info({
              logCode: 'azure_stt_session_stopped',
            }, 'Azure STT: Recognition session stopped');
            break;

          default:
            logger.debug({
              logCode: 'azure_stt_unknown_message',
              extraInfo: { message },
            }, 'Azure STT: Unknown message received');
        }
      } catch (error) {
        logger.error({
          logCode: 'azure_stt_message_parse_error',
          extraInfo: {
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        }, 'Azure STT: Failed to parse message');
      }
    };

    ws.onerror = (error) => {
      logger.error({
        logCode: 'azure_stt_ws_error',
      }, 'Azure STT: WebSocket error');
    };

    ws.onclose = (event) => {
      logger.info({
        logCode: 'azure_stt_ws_closed',
        extraInfo: { code: event.code, reason: event.reason },
      }, `Azure STT: WebSocket closed (${event.code})`);
      isActiveRef.current = false;
      wsRef.current = null;
    };
  }, [buildWebSocketUrl, startAudioProcessing]);

  const disconnectWebSocket = useCallback(() => {
    isActiveRef.current = false;
    stopAudioProcessing();

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close(1000, 'Client disconnect');
      }
      wsRef.current = null;
    }

    logger.info({
      logCode: 'azure_stt_disconnected',
    }, 'Azure STT: Disconnected');
  }, [stopAudioProcessing]);

  // Track locale changes
  useEffect(() => {
    if (locale !== localeRef.current && locale !== '') {
      localeRef.current = locale;
      // Reconnect with new locale if already connected
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        logger.info({
          logCode: 'azure_stt_locale_changed',
          extraInfo: { locale },
        }, `Azure STT: Locale changed to ${locale}, reconnecting`);
        disconnectWebSocket();
        connectWebSocket();
      }
    }
  }, [locale, connectWebSocket, disconnectWebSocket]);

  // Handle connection/mute state changes
  useEffect(() => {
    const shouldBeActive = connected && !muted && locale !== '';

    if (shouldBeActive && !wsRef.current) {
      connectWebSocket();
    } else if (!shouldBeActive && wsRef.current) {
      disconnectWebSocket();
    }
  }, [connected, muted, locale, connectWebSocket, disconnectWebSocket]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectWebSocket();
    };
  }, [disconnectWebSocket]);

  return null;
};

const AzureSTTProviderContainer: React.FC = () => {
  // @ts-ignore - isMuted has a value property with makeVar
  const isMuted = useReactiveVar(AudioManager._isMuted.value) as boolean;
  const isConnected = useIsAudioConnected();

  const {
    data: currentUser,
  } = useCurrentUser(
    (user) => ({
      speechLocale: user.speechLocale,
    }),
  );

  if (!currentUser) return null;

  return (
    <AzureSTTProvider
      locale={currentUser.speechLocale ?? ''}
      connected={isConnected}
      muted={isMuted}
    />
  );
};

export default AzureSTTProviderContainer;
