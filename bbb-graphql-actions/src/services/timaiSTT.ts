/**
 * Tim AI (OmniVoice) Speech-to-Text (STT) Service
 *
 * Bridges to the OmniVoice HTTP STT API for batch transcription.
 * The client sends raw Int16 PCM audio; this service accumulates
 * audio chunks, converts them to WAV, and POSTs them to the
 * OmniVoice HTTP endpoint (/api/v1/stt) for transcription.
 *
 * API reference: voice-api-README.md
 */

import { TIMAI_STT_ENABLED, TIMAI_STT_URL } from '../config';
import { BBB_TO_TIMAI_LANGUAGE } from './timaiLocales';

const STT_HTTP_URL = TIMAI_STT_URL.replace(/^ws/, 'http').replace(/\/stt-stream$/, '/stt');

export const SUPPORTED_STT_LANGUAGES: Record<string, string> = BBB_TO_TIMAI_LANGUAGE;

export interface STTSessionCallbacks {
  onRecognized: (text: string, resultId: string) => void;
  onError: (error: string) => void;
  onSessionStarted: () => void;
  onSessionStopped: () => void;
}

export interface STTSession {
  pushAudio: (audioData: Buffer) => void;
  endStream: () => Promise<void>;
  stop: () => void;
}

export function isTimAISttEnabled(): boolean {
  return TIMAI_STT_ENABLED && !!TIMAI_STT_URL;
}

export function getSupportedSTTLocales(): string[] {
  return Object.keys(SUPPORTED_STT_LANGUAGES);
}

export function isLocaleSupported(locale: string): boolean {
  return locale in SUPPORTED_STT_LANGUAGES;
}

export function getTimAILanguageCode(locale: string): string | null {
  return SUPPORTED_STT_LANGUAGES[locale] || null;
}

function int16ToWav(samples: Int16Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = Buffer.alloc(totalSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(totalSize - 8, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], headerSize + i * 2);
  }

  return buffer;
}

function buildMultipartFormData(wavBuffer: Buffer, language: string): { body: Buffer, boundary: string } {
  const boundary = `----TimAIStt${Date.now()}`;
  const crlf = '\r\n';

  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}${crlf}`));
  parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="audio.wav"${crlf}`));
  parts.push(Buffer.from(`Content-Type: audio/wav${crlf}${crlf}`));
  parts.push(wavBuffer);
  parts.push(Buffer.from(`${crlf}--${boundary}${crlf}`));
  parts.push(Buffer.from(`Content-Disposition: form-data; name="language"${crlf}${crlf}`));
  parts.push(Buffer.from(language));
  parts.push(Buffer.from(`${crlf}--${boundary}--${crlf}`));

  return { body: Buffer.concat(parts), boundary };
}

export function createSTTSession(
  locale: string,
  callbacks: STTSessionCallbacks
): STTSession | null {
  if (!isTimAISttEnabled()) {
    console.error('[TimAI-STT] Service is not enabled or configured');
    return null;
  }

  const omniVoiceLang = getTimAILanguageCode(locale);
  if (!omniVoiceLang) {
    console.error(`[TimAI-STT] Unsupported locale: ${locale}`);
    return null;
  }

  const lang: string = omniVoiceLang;

  console.info(`[TimAI-STT] Creating STT session for locale: ${locale} (OmniVoice: ${omniVoiceLang})`);

  const SAMPLE_RATE = 16000;
  const CHUNK_DURATION_MS = 2000;
  let audioBuffer = new Int16Array(0);
  let isStopped = false;
  let isProcessing = false;
  let sequence = 0;

  callbacks.onSessionStarted();

  async function flushAudio() {
    if (isStopped || isProcessing || audioBuffer.length === 0) {
      return;
    }

    isProcessing = true;

    const samples = audioBuffer;
    audioBuffer = new Int16Array(0);

    try {
      const wavBuffer = int16ToWav(samples, SAMPLE_RATE);
      const { body, boundary } = buildMultipartFormData(wavBuffer, lang);

      const response = await fetch(STT_HTTP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[TimAI-STT] API error ${response.status}: ${errorBody}`);
        return;
      }

      const result = await response.json();
      const text = result.text;

      if (text && text.trim()) {
        sequence += 1;
        const resultId = `timai-${Date.now()}-${sequence}`;
        console.info(`[TimAI-STT] Transcription [${sequence}]: "${text.substring(0, 50)}"`);
        callbacks.onRecognized(text.trim(), resultId);
      }
    } catch (error) {
      console.error('[TimAI-STT] Transcription request failed:', error);
    } finally {
      isProcessing = false;
    }
  }

  const interval = setInterval(() => {
    if (!isStopped) {
      flushAudio();
    }
  }, CHUNK_DURATION_MS);

  return {
    pushAudio: (audioData: Buffer) => {
      if (isStopped) {
        return;
      }

      const int16Data = new Int16Array(audioData.buffer, audioData.byteOffset, audioData.byteLength / 2);
      const combined = new Int16Array(audioBuffer.length + int16Data.length);
      combined.set(audioBuffer, 0);
      combined.set(int16Data, audioBuffer.length);
      audioBuffer = combined;
    },

    endStream: async () => {
      if (isStopped) {
        return;
      }
      clearInterval(interval);
      await flushAudio();
    },

    stop: () => {
      if (!isStopped) {
        isStopped = true;
        clearInterval(interval);
        callbacks.onSessionStopped();
      }
    },
  };
}

export default {
  isTimAISttEnabled,
  getSupportedSTTLocales,
  isLocaleSupported,
  getTimAILanguageCode,
  createSTTSession,
  SUPPORTED_STT_LANGUAGES,
};
