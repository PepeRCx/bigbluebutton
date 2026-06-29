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

import {
  TIMAI_STT_ENABLED,
  TIMAI_STT_ENERGY_THRESHOLD,
  TIMAI_STT_MIN_CHUNK_MS,
  TIMAI_STT_MIN_VOICED_MS,
  TIMAI_STT_URL,
  TIMAI_STT_CHUNK_DURATION_MS,
  TIMAI_STT_INTERIM_INTERVAL_MS,
  TIMAI_STT_REPETITION_THRESHOLD,
} from '../config';
import { BBB_TO_TIMAI_LANGUAGE } from './timaiLocales';

const STT_HTTP_URL = TIMAI_STT_URL.replace(/^ws/, 'http').replace(/\/stt-stream$/, '/stt');
const FRAME_DURATION_MS = 20;

export const SUPPORTED_STT_LANGUAGES: Record<string, string> = BBB_TO_TIMAI_LANGUAGE;

export interface STTSessionCallbacks {
  onRecognizing: (text: string, resultId: string) => void | Promise<void>;
  onRecognized: (text: string, resultId: string) => void | Promise<void>;
  onError: (error: string) => void | Promise<void>;
  onSessionStarted: () => void | Promise<void>;
  onSessionStopped: () => void | Promise<void>;
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

interface AudioGateMetrics {
  chunkRms: number;
  totalDurationMs: number;
  voicedDurationMs: number;
}

interface AudioGateResult extends AudioGateMetrics {
  passed: boolean;
  reason?: string;
}

interface FlushAudioOptions {
  allowShortChunk?: boolean;
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

function roundMetric(value: number): string {
  return value.toFixed(3);
}

function normalizeTranscript(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function getWordCount(transcript: string): number {
  return transcript ? transcript.split(' ').length : 0;
}

function hasConsecutiveRepetition(words: string[], minConsecutive: number = 3): boolean {
  if (words.length < minConsecutive) {
    return false;
  }

  let consecutive = 1;
  for (let i = 1; i < words.length; i += 1) {
    if (words[i].toLowerCase() === words[i - 1].toLowerCase()) {
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

function isRepetitiveTranscript(transcript: string, threshold: number = TIMAI_STT_REPETITION_THRESHOLD): boolean {
  const normalized = normalizeTranscript(transcript);
  const words = normalized.split(' ');

  if (words.length < 4) {
    return false;
  }

  if (hasConsecutiveRepetition(words, 3)) {
    return true;
  }

  const wordFrequency = new Map<string, number>();
  words.forEach((word) => {
    const lower = word.toLowerCase();
    wordFrequency.set(lower, (wordFrequency.get(lower) || 0) + 1);
  });

  const maxFrequency = Math.max(...wordFrequency.values());
  return maxFrequency / words.length > threshold;
}

function mergeTranscript(existingTranscript: string, nextTranscript: string): string {
  const existing = normalizeTranscript(existingTranscript);
  const next = normalizeTranscript(nextTranscript);

  if (!existing) {
    return next;
  }

  if (!next) {
    return existing;
  }

  if (existing === next || existing.endsWith(next)) {
    return existing;
  }

  if (next.startsWith(existing)) {
    return next;
  }

  const existingWords = existing.split(' ');
  const nextWords = next.split(' ');
  const maxOverlap = Math.min(existingWords.length, nextWords.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const existingSuffix = existingWords.slice(-overlap).join(' ');
    const nextPrefix = nextWords.slice(0, overlap).join(' ');

    if (existingSuffix === nextPrefix) {
      return `${existingWords.join(' ')} ${nextWords.slice(overlap).join(' ')}`.trim();
    }
  }

  return `${existing} ${next}`.trim();
}

function analyzeAudioChunk(
  samples: Int16Array,
  sampleRate: number,
  allowShortChunk: boolean = false,
): AudioGateResult {
  const totalDurationMs = (samples.length / sampleRate) * 1000;

  if (samples.length === 0) {
    return {
      passed: false,
      reason: 'empty',
      totalDurationMs,
      voicedDurationMs: 0,
      chunkRms: 0,
    };
  }

  let sumSquares = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const normalizedSample = samples[i] / 32768;
    sumSquares += normalizedSample * normalizedSample;
  }

  const chunkRms = Math.sqrt(sumSquares / samples.length);
  if (totalDurationMs < TIMAI_STT_MIN_CHUNK_MS && !allowShortChunk) {
    return {
      passed: false,
      reason: 'short_chunk',
      totalDurationMs,
      voicedDurationMs: 0,
      chunkRms,
    };
  }

  const frameSize = Math.max(1, Math.floor((sampleRate * FRAME_DURATION_MS) / 1000));
  let voicedFrames = 0;

  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const frameEnd = Math.min(offset + frameSize, samples.length);
    const frameLength = frameEnd - offset;

    if (frameLength <= 0) {
      continue;
    }

    let frameSumSquares = 0;
    for (let i = offset; i < frameEnd; i += 1) {
      const normalizedSample = samples[i] / 32768;
      frameSumSquares += normalizedSample * normalizedSample;
    }

    const frameRms = Math.sqrt(frameSumSquares / frameLength);
    if (frameRms > TIMAI_STT_ENERGY_THRESHOLD) {
      voicedFrames += 1;
    }
  }

  const voicedDurationMs = voicedFrames * FRAME_DURATION_MS;
  if (voicedDurationMs < TIMAI_STT_MIN_VOICED_MS) {
    return {
      passed: false,
      reason: 'low_voiced_duration',
      totalDurationMs,
      voicedDurationMs,
      chunkRms,
    };
  }

  return {
    passed: true,
    totalDurationMs,
    voicedDurationMs,
    chunkRms,
  };
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
  const CHUNK_DURATION_MS = TIMAI_STT_CHUNK_DURATION_MS;
  let audioBuffer = new Int16Array(0);
  let isStopped = false;
  let isProcessing = false;
  let sequence = 0;
  let bufferedTranscript = '';
  let lastInterimTranscript = '';
  let interimSequence = 0;

  callbacks.onSessionStarted();

  async function emitInterim(): Promise<void> {
    if (isStopped) {
      return;
    }

    const interimTranscript = normalizeTranscript(bufferedTranscript);
    if (!interimTranscript || interimTranscript === lastInterimTranscript) {
      return;
    }

    interimSequence += 1;
    const resultId = `timai-interim-${Date.now()}-${interimSequence}`;
    lastInterimTranscript = interimTranscript;
    await callbacks.onRecognizing(interimTranscript, resultId);
  }

  async function finalizeBufferedTranscript(reason: string): Promise<void> {
    const finalTranscript = normalizeTranscript(bufferedTranscript);

    if (!finalTranscript) {
      return;
    }

    sequence += 1;
    const resultId = `timai-${Date.now()}-${sequence}`;
    bufferedTranscript = '';

    console.info(`[TimAI-STT] Finalized utterance [${sequence}] (${reason}): "${finalTranscript.substring(0, 80)}"`);
    await callbacks.onRecognized(finalTranscript, resultId);
  }

  async function flushAudio(options: FlushAudioOptions = {}) {
    if (isStopped || isProcessing || audioBuffer.length === 0) {
      return;
    }

    isProcessing = true;

    const samples = audioBuffer;
    audioBuffer = new Int16Array(0);

    try {
      const gateResult = analyzeAudioChunk(
        samples,
        SAMPLE_RATE,
        options.allowShortChunk ?? false,
      );
      if (!gateResult.passed) {
        console.info(
          `[TimAI-STT] Skipping chunk: reason=${gateResult.reason} totalMs=${Math.round(gateResult.totalDurationMs)} `
          + `voicedMs=${Math.round(gateResult.voicedDurationMs)} chunkRms=${roundMetric(gateResult.chunkRms)}`,
        );
        await finalizeBufferedTranscript(gateResult.reason || 'audio_gate');
        return;
      }

      console.debug(
        `[TimAI-STT] Sending chunk: totalMs=${Math.round(gateResult.totalDurationMs)} `
        + `voicedMs=${Math.round(gateResult.voicedDurationMs)} chunkRms=${roundMetric(gateResult.chunkRms)}`,
      );

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
        callbacks.onError(`API error ${response.status}`);
        return;
      }

      const result = await response.json();
      const text = normalizeTranscript(result.text || '');

      if (isRepetitiveTranscript(text)) {
        console.warn(`[TimAI-STT] Discarding repetitive transcript: "${text.substring(0, 80)}"`);
        return;
      }

      if (text) {
        bufferedTranscript = mergeTranscript(bufferedTranscript, text);
        console.info(`[TimAI-STT] Buffered chunk: "${text.substring(0, 80)}"`);
        await emitInterim();
      } else {
        await finalizeBufferedTranscript('empty_result');
      }
    } catch (error) {
      console.error('[TimAI-STT] Transcription request failed:', error);
      callbacks.onError(error instanceof Error ? error.message : 'Transcription request failed');
    } finally {
      isProcessing = false;
    }
  }

  const interval = setInterval(() => {
    if (!isStopped) {
      flushAudio();
    }
  }, CHUNK_DURATION_MS);

  const interimInterval = setInterval(() => {
    if (!isStopped && !isProcessing) {
      void emitInterim();
    }
  }, TIMAI_STT_INTERIM_INTERVAL_MS);

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
      clearInterval(interimInterval);
      if (audioBuffer.length > 0) {
        await flushAudio({ allowShortChunk: true });
      }
      await finalizeBufferedTranscript('end_stream');
    },

    stop: () => {
      if (!isStopped) {
        isStopped = true;
        clearInterval(interval);
        clearInterval(interimInterval);
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
