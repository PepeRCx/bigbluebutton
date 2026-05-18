/**
 * Tim AI (OmniVoice) Text-to-Speech (TTS) Service
 *
 * Handles text-to-speech synthesis using the Tim AI OmniVoice API.
 * Converts text to WAV audio via HTTP POST, returns base64-encoded audio
 * for playback in the browser.
 *
 * API reference: voice-api-README.md
 */

import { TIMAI_TTS_ENABLED, TIMAI_TTS_URL } from '../config';

// Supported language mappings: BBB locale code → OmniVoice language code
// Only languages overlapping between BBB's available list and OmniVoice's supported set.
export const SUPPORTED_TTS_LANGUAGES: Record<string, string> = {
  'en-US': 'en',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'pt-BR': 'pt',
  'ru-RU': 'ru',
  'it-IT': 'it',
  'pl-PL': 'pl',
  'nl-NL': 'nl',
  'uk-UA': 'uk',
  'ro-RO': 'ro',
  'el-GR': 'el',
  'cs-CZ': 'cs',
  'hu-HU': 'hu',
  'sv-SE': 'sv',
  'da-DK': 'da',
  'nb-NO': 'no',
  'fi-FI': 'fi',
  'bg-BG': 'bg',
  'hr-HR': 'hr',
  'lt-LT': 'lt',
  'et-EE': 'et',
  'tr-TR': 'tr',
  'ja-JP': 'ja',
  'ar-SA': 'ar',
};

export function isTimAITtsEnabled(): boolean {
  return TIMAI_TTS_ENABLED && !!TIMAI_TTS_URL;
}

export function getSupportedTTSLocales(): string[] {
  return Object.keys(SUPPORTED_TTS_LANGUAGES);
}

export function isTTSLocaleSupported(locale: string): boolean {
  return locale in SUPPORTED_TTS_LANGUAGES;
}

export function getTimAILanguageCode(locale: string): string | null {
  return SUPPORTED_TTS_LANGUAGES[locale] || null;
}

interface TTSResult {
  success: boolean;
  audio?: string;
  contentType?: string;
  error?: string;
}

export async function synthesizeSpeech(
  text: string,
  locale: string
): Promise<TTSResult> {
  if (!isTimAITtsEnabled()) {
    console.debug('[TimAI-TTS] TTS skipped: Service disabled or missing configuration.');
    return { success: false, error: 'TTS service is not enabled or configured' };
  }

  if (!text.trim()) {
    return { success: false, error: 'Empty text provided' };
  }

  const omniVoiceLang = getTimAILanguageCode(locale);
  if (!omniVoiceLang) {
    console.warn(`[TimAI-TTS] Unsupported locale: ${locale}`);
    return { success: false, error: `Unsupported locale: ${locale}` };
  }

  console.info(`[TimAI-TTS] Synthesizing speech for "${text.substring(0, 30)}..." in ${locale} (OmniVoice: ${omniVoiceLang})`);

  try {
    const response = await fetch(TIMAI_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        language: omniVoiceLang,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[TimAI-TTS] API error ${response.status}: ${errorBody}`);
      return { success: false, error: `Tim AI TTS API error: ${response.status}` };
    }

    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    console.info(`[TimAI-TTS] Successfully synthesized ${base64Audio.length} bytes of audio (WAV)`);

    return { success: true, audio: base64Audio, contentType: 'audio/wav' };
  } catch (error) {
    console.error('[TimAI-TTS] Synthesis failed:', error);
    return { success: false, error: 'TTS synthesis failed' };
  }
}

export default {
  synthesizeSpeech,
  isTimAITtsEnabled,
  getSupportedTTSLocales,
  isTTSLocaleSupported,
  getTimAILanguageCode,
  SUPPORTED_TTS_LANGUAGES,
};
