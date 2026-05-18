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

const TARGET_SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;

interface TimAISttProviderProps {
  locale: string;
  connected: boolean;
  muted: boolean;
}

const TimAISttProvider: React.FC<TimAISttProviderProps> = ({
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
    return `${protocol}//${host}/tim-ai/stt/ws?meetingId=${meetingId}&moderatorUserId=${moderatorUserId}&senderUserId=${senderUserId}&locale=${localeRef.current}`;
  }, []);

  const downsampleAndConvertToInt16 = (
    float32Array: Float32Array,
    inputSampleRate: number,
  ): Int16Array => {
    const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
    const outputLength = Math.floor(float32Array.length / ratio);
    const int16Array = new Int16Array(outputLength);
    for (let i = 0; i < outputLength; i += 1) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, float32Array.length - 1);
      const frac = srcIndex - srcIndexFloor;
      const interpolated = float32Array[srcIndexFloor] * (1 - frac)
        + float32Array[srcIndexCeil] * frac;
      const sample = Math.max(-1, Math.min(1, interpolated));
      int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return int16Array;
  };

  const startAudioProcessing = useCallback(() => {
    const inputStream = AudioManager.inputStream;

    if (!inputStream) {
      logger.warn({
        logCode: 'timai_stt_no_input_stream',
      }, 'Tim AI STT: No input stream available');
      return;
    }

    try {
      const clonedStream = inputStream.clone();
      streamRef.current = clonedStream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(clonedStream);
      sourceRef.current = source;

      const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        if (!isActiveRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputData = event.inputBuffer.getChannelData(0);
        const int16Data = downsampleAndConvertToInt16(inputData, audioContext.sampleRate);

        wsRef.current.send(int16Data.buffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      logger.info({
        logCode: 'timai_stt_audio_processing_started',
      }, 'Tim AI STT: Audio processing started');
    } catch (error) {
      logger.error({
        logCode: 'timai_stt_audio_processing_error',
        extraInfo: {
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      }, 'Tim AI STT: Failed to start audio processing');
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
      logCode: 'timai_stt_audio_processing_stopped',
    }, 'Tim AI STT: Audio processing stopped');
  }, []);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const url = buildWebSocketUrl();
    logger.info({
      logCode: 'timai_stt_connecting',
      extraInfo: { url },
    }, 'Tim AI STT: Connecting to WebSocket');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      logger.info({
        logCode: 'timai_stt_connected',
      }, 'Tim AI STT: WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case 'ready':
            logger.info({
              logCode: 'timai_stt_ready',
              extraInfo: { locale: message.locale },
            }, 'Tim AI STT: Service ready');
            isActiveRef.current = true;
            startAudioProcessing();
            break;

          case 'session_started':
            logger.debug({
              logCode: 'timai_stt_session_started',
            }, 'Tim AI STT: Recognition session started');
            break;

          case 'final':
            logger.debug({
              logCode: 'timai_stt_final_result',
              extraInfo: { text: message.text },
            }, `Tim AI STT final: ${message.text}`);
            break;

          case 'error':
            logger.error({
              logCode: 'timai_stt_error',
              extraInfo: { error: message.error },
            }, `Tim AI STT error: ${message.error}`);
            break;

          case 'session_stopped':
            logger.info({
              logCode: 'timai_stt_session_stopped',
            }, 'Tim AI STT: Recognition session stopped');
            break;

          default:
            logger.debug({
              logCode: 'timai_stt_unknown_message',
              extraInfo: { message },
            }, 'Tim AI STT: Unknown message received');
        }
      } catch (error) {
        logger.error({
          logCode: 'timai_stt_message_parse_error',
          extraInfo: {
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        }, 'Tim AI STT: Failed to parse message');
      }
    };

    ws.onerror = (error) => {
      logger.error({
        logCode: 'timai_stt_ws_error',
      }, 'Tim AI STT: WebSocket error');
    };

    ws.onclose = (event) => {
      logger.info({
        logCode: 'timai_stt_ws_closed',
        extraInfo: { code: event.code, reason: event.reason },
      }, `Tim AI STT: WebSocket closed (${event.code})`);
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
      logCode: 'timai_stt_disconnected',
    }, 'Tim AI STT: Disconnected');
  }, [stopAudioProcessing]);

  useEffect(() => {
    if (locale !== localeRef.current && locale !== '') {
      localeRef.current = locale;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        logger.info({
          logCode: 'timai_stt_locale_changed',
          extraInfo: { locale },
        }, `Tim AI STT: Locale changed to ${locale}, reconnecting`);
        disconnectWebSocket();
        connectWebSocket();
      }
    }
  }, [locale, connectWebSocket, disconnectWebSocket]);

  useEffect(() => {
    const shouldBeActive = connected && !muted && locale !== '';

    if (shouldBeActive && !wsRef.current) {
      connectWebSocket();
    } else if (!shouldBeActive && wsRef.current) {
      disconnectWebSocket();
    }
  }, [connected, muted, locale, connectWebSocket, disconnectWebSocket]);

  useEffect(() => {
    return () => {
      disconnectWebSocket();
    };
  }, [disconnectWebSocket]);

  return null;
};

const TimAISttProviderContainer: React.FC = () => {
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
    <TimAISttProvider
      locale={currentUser.speechLocale ?? ''}
      connected={isConnected}
      muted={isMuted}
    />
  );
};

export default TimAISttProviderContainer;
