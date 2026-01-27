/**
 * Azure Speech-to-Text (STT) Service
 *
 * Handles speech-to-text transcription using Azure Cognitive Services Speech SDK.
 * Converts audio streams to text transcripts for the caption system.
 */

import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import { AZURE_STT_ENABLED, AZURE_STT_KEY, AZURE_STT_REGION } from '../config';

// Supported locale mappings for Azure Speech-to-Text
// Format: locale -> Azure recognition language code
export const SUPPORTED_STT_LANGUAGES: Record<string, string> = {
  'en-US': 'en-US',
  'es-ES': 'es-ES',
  'pt-BR': 'pt-BR',
  'de-DE': 'de-DE',
  'fr-FR': 'fr-FR',
};

/**
 * Checks if Azure STT is enabled and configured
 */
export function isAzureSTTEnabled(): boolean {
  return AZURE_STT_ENABLED && !!AZURE_STT_KEY && !!AZURE_STT_REGION;
}

/**
 * Gets all supported STT locales
 */
export function getSupportedSTTLocales(): string[] {
  return Object.keys(SUPPORTED_STT_LANGUAGES);
}

/**
 * Checks if a locale is supported for STT
 */
export function isLocaleSupported(locale: string): boolean {
  return locale in SUPPORTED_STT_LANGUAGES;
}

/**
 * Gets the Azure language code for a locale
 */
export function getAzureLanguageCode(locale: string): string | null {
  return SUPPORTED_STT_LANGUAGES[locale] || null;
}

export interface STTSessionCallbacks {
  onRecognizing: (text: string, resultId: string) => void;
  onRecognized: (text: string, resultId: string) => void;
  onError: (error: string) => void;
  onSessionStarted: () => void;
  onSessionStopped: () => void;
}

export interface STTSession {
  pushAudio: (audioData: ArrayBuffer) => void;
  stop: () => Promise<void>;
  close: () => void;
}

/**
 * Creates an Azure Speech SDK STT session with PushAudioInputStream.
 *
 * @param locale - The locale for speech recognition (e.g., 'en-US')
 * @param callbacks - Event callbacks for recognition events
 * @returns STT session object with methods to push audio and control the session
 */
export function createSTTSession(
  locale: string,
  callbacks: STTSessionCallbacks
): STTSession | null {
  if (!isAzureSTTEnabled()) {
    console.error('[AzureSTT] Service is not enabled or configured');
    return null;
  }

  const azureLang = getAzureLanguageCode(locale);
  if (!azureLang) {
    console.error(`[AzureSTT] Unsupported locale: ${locale}`);
    return null;
  }

  console.info(`[AzureSTT] Creating STT session for locale: ${locale}`);

  // Create speech config
  const speechConfig = sdk.SpeechConfig.fromSubscription(AZURE_STT_KEY, AZURE_STT_REGION);
  speechConfig.speechRecognitionLanguage = azureLang;

  // Enable intermediate results
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceResponse_RequestSentimentAnalysis,
    'false'
  );

  // Create push audio stream (16kHz, 16-bit mono PCM)
  const pushStream = sdk.AudioInputStream.createPushStream(
    sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1)
  );

  // Create audio config from push stream
  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

  // Create speech recognizer
  const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  // Set up event handlers
  recognizer.recognizing = (_s: sdk.SpeechRecognizer, e: sdk.SpeechRecognitionEventArgs) => {
    if (e.result.reason === sdk.ResultReason.RecognizingSpeech) {
      const text = e.result.text;
      if (text) {
        callbacks.onRecognizing(text, e.result.resultId);
      }
    }
  };

  recognizer.recognized = (_s: sdk.SpeechRecognizer, e: sdk.SpeechRecognitionEventArgs) => {
    if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
      const text = e.result.text;
      if (text) {
        callbacks.onRecognized(text, e.result.resultId);
      }
    } else if (e.result.reason === sdk.ResultReason.NoMatch) {
      // No speech was recognized - this is normal during silence
    }
  };

  recognizer.canceled = (_s: sdk.SpeechRecognizer, e: sdk.SpeechRecognitionCanceledEventArgs) => {
    if (e.reason === sdk.CancellationReason.Error) {
      console.error(`[AzureSTT] Recognition canceled: ${e.errorDetails}`);
      callbacks.onError(`Recognition error: ${e.errorDetails}`);
    }
  };

  recognizer.sessionStarted = () => {
    console.info('[AzureSTT] Session started');
    callbacks.onSessionStarted();
  };

  recognizer.sessionStopped = () => {
    console.info('[AzureSTT] Session stopped');
    callbacks.onSessionStopped();
  };

  // Start continuous recognition
  recognizer.startContinuousRecognitionAsync(
    () => {
      console.info('[AzureSTT] Continuous recognition started');
    },
    (err: string) => {
      console.error('[AzureSTT] Failed to start recognition:', err);
      callbacks.onError(`Failed to start recognition: ${err}`);
    }
  );

  return {
    pushAudio: (audioData: ArrayBuffer) => {
      pushStream.write(audioData);
    },

    stop: () => {
      return new Promise<void>((resolve, reject) => {
        recognizer.stopContinuousRecognitionAsync(
          () => {
            console.info('[AzureSTT] Recognition stopped');
            resolve();
          },
          (err: string) => {
            console.error('[AzureSTT] Failed to stop recognition:', err);
            reject(err);
          }
        );
      });
    },

    close: () => {
      pushStream.close();
      recognizer.close();
      console.info('[AzureSTT] Session closed');
    },
  };
}

export default {
  isAzureSTTEnabled,
  getSupportedSTTLocales,
  isLocaleSupported,
  getAzureLanguageCode,
  createSTTSession,
  SUPPORTED_STT_LANGUAGES,
};
