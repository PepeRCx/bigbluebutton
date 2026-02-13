/**
 * Azure Text-to-Speech (TTS) Service
 *
 * Handles text-to-speech synthesis using Azure Cognitive Services Speech API.
 * Converts translated captions to audio for voice translation feature.
 */

import { AZURE_TTS_ENDPOINT, AZURE_TTS_KEY, AZURE_TTS_ENABLED } from '../config';

// Voice mappings for each supported locale
// Using Azure Neural voices for natural-sounding speech
interface VoiceConfig {
  name: string;
  lang: string;
  gender: 'Female' | 'Male';
}

export const VOICE_MAPPINGS: Record<string, VoiceConfig> = {
  // Original 5 languages
  'en-US': { name: 'en-US-AvaNeural', lang: 'en-US', gender: 'Female' },
  'es-ES': { name: 'es-ES-ElviraNeural', lang: 'es-ES', gender: 'Female' },
  'pt-BR': { name: 'pt-BR-FranciscaNeural', lang: 'pt-BR', gender: 'Female' },
  'de-DE': { name: 'de-DE-KatjaNeural', lang: 'de-DE', gender: 'Female' },
  'fr-FR': { name: 'fr-FR-DeniseNeural', lang: 'fr-FR', gender: 'Female' },

  // European languages
  'ru-RU': { name: 'ru-RU-SvetlanaNeural', lang: 'ru-RU', gender: 'Female' },
  'it-IT': { name: 'it-IT-ElsaNeural', lang: 'it-IT', gender: 'Female' },
  'pl-PL': { name: 'pl-PL-ZofiaNeural', lang: 'pl-PL', gender: 'Female' },
  'nl-NL': { name: 'nl-NL-ColetteNeural', lang: 'nl-NL', gender: 'Female' },
  'uk-UA': { name: 'uk-UA-PolinaNeural', lang: 'uk-UA', gender: 'Female' },
  'ro-RO': { name: 'ro-RO-AlinaNeural', lang: 'ro-RO', gender: 'Female' },
  'el-GR': { name: 'el-GR-AthinaNeural', lang: 'el-GR', gender: 'Female' },
  'cs-CZ': { name: 'cs-CZ-VlastaNeural', lang: 'cs-CZ', gender: 'Female' },
  'hu-HU': { name: 'hu-HU-NoemiNeural', lang: 'hu-HU', gender: 'Female' },
  'sv-SE': { name: 'sv-SE-SofieNeural', lang: 'sv-SE', gender: 'Female' },
  'da-DK': { name: 'da-DK-ChristelNeural', lang: 'da-DK', gender: 'Female' },
  'nb-NO': { name: 'nb-NO-PernilleNeural', lang: 'nb-NO', gender: 'Female' },
  'fi-FI': { name: 'fi-FI-NooraNeural', lang: 'fi-FI', gender: 'Female' },
  'bg-BG': { name: 'bg-BG-KalinaNeural', lang: 'bg-BG', gender: 'Female' },
  'sr-RS': { name: 'sr-RS-SophieNeural', lang: 'sr-RS', gender: 'Female' },
  'hr-HR': { name: 'hr-HR-GabrijelaNeural', lang: 'hr-HR', gender: 'Female' },
  'sk-SK': { name: 'sk-SK-ViktoriaNeural', lang: 'sk-SK', gender: 'Female' },
  'lt-LT': { name: 'lt-LT-OnaNeural', lang: 'lt-LT', gender: 'Female' },
  'lv-LV': { name: 'lv-LV-EveritaNeural', lang: 'lv-LV', gender: 'Female' },
  'et-EE': { name: 'et-EE-AnuNeural', lang: 'et-EE', gender: 'Female' },
  'sl-SI': { name: 'sl-SI-PetraNeural', lang: 'sl-SI', gender: 'Female' },
  'is-IS': { name: 'is-IS-GudrunNeural', lang: 'is-IS', gender: 'Female' },

  // Asian languages
  'zh-CN': { name: 'zh-CN-XiaoxiaoNeural', lang: 'zh-CN', gender: 'Female' },
  'ja-JP': { name: 'ja-JP-NanamiNeural', lang: 'ja-JP', gender: 'Female' },
  'ko-KR': { name: 'ko-KR-SunHiNeural', lang: 'ko-KR', gender: 'Female' },
  'hi-IN': { name: 'hi-IN-SwaraNeural', lang: 'hi-IN', gender: 'Female' },
  'bn-IN': { name: 'bn-IN-TanishaaNeural', lang: 'bn-IN', gender: 'Female' },
  'ta-IN': { name: 'ta-IN-PallaviNeural', lang: 'ta-IN', gender: 'Female' },
  'te-IN': { name: 'te-IN-ShrutiNeural', lang: 'te-IN', gender: 'Female' },
  'mr-IN': { name: 'mr-IN-AarohiNeural', lang: 'mr-IN', gender: 'Female' },
  'th-TH': { name: 'th-TH-PremwadeeNeural', lang: 'th-TH', gender: 'Female' },
  'vi-VN': { name: 'vi-VN-HoaiMyNeural', lang: 'vi-VN', gender: 'Female' },
  'id-ID': { name: 'id-ID-GadisNeural', lang: 'id-ID', gender: 'Female' },
  'ms-MY': { name: 'ms-MY-YasminNeural', lang: 'ms-MY', gender: 'Female' },
  'fil-PH': { name: 'fil-PH-BlessicaNeural', lang: 'fil-PH', gender: 'Female' },

  // Middle Eastern and other languages
  'ar-SA': { name: 'ar-SA-ZariyahNeural', lang: 'ar-SA', gender: 'Female' },
  'tr-TR': { name: 'tr-TR-EmelNeural', lang: 'tr-TR', gender: 'Female' },
  'he-IL': { name: 'he-IL-HilaNeural', lang: 'he-IL', gender: 'Female' },
  'fa-IR': { name: 'fa-IR-DilaraNeural', lang: 'fa-IR', gender: 'Female' },
  'ur-PK': { name: 'ur-PK-UzmaNeural', lang: 'ur-PK', gender: 'Female' },
  'sw-KE': { name: 'sw-KE-ZuriNeural', lang: 'sw-KE', gender: 'Female' },
  'ka-GE': { name: 'ka-GE-EkaNeural', lang: 'ka-GE', gender: 'Female' },
  'hy-AM': { name: 'hy-AM-AnahitNeural', lang: 'hy-AM', gender: 'Female' },
  'az-AZ': { name: 'az-AZ-BanuNeural', lang: 'az-AZ', gender: 'Female' },
  'kk-KZ': { name: 'kk-KZ-AigulNeural', lang: 'kk-KZ', gender: 'Female' },
};

/**
 * Checks if Azure TTS is enabled and configured
 */
export function isAzureTTSEnabled(): boolean {
  return AZURE_TTS_ENABLED &&
    !!AZURE_TTS_ENDPOINT &&
    !!AZURE_TTS_KEY;
}

/**
 * Gets the voice configuration for a locale
 */
export function getVoiceForLocale(locale: string): VoiceConfig | null {
  return VOICE_MAPPINGS[locale] || null;
}

/**
 * Gets all supported TTS locales
 */
export function getSupportedTTSLocales(): string[] {
  return Object.keys(VOICE_MAPPINGS);
}

/**
 * Escapes special XML characters in text for SSML
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds SSML (Speech Synthesis Markup Language) for Azure TTS
 */
function buildSSML(text: string, voice: VoiceConfig): string {
  const escapedText = escapeXml(text);
  return `<speak version='1.0' xml:lang='${voice.lang}'><voice xml:lang='${voice.lang}' xml:gender='${voice.gender}' name='${voice.name}'>${escapedText}</voice></speak>`;
}

interface TTSResult {
  success: boolean;
  audio?: string; // Base64 encoded audio
  error?: string;
}

/**
 * Synthesizes speech from text using Azure TTS API.
 *
 * @param text - The text to convert to speech
 * @param locale - The target locale (e.g., 'en-US', 'es-ES')
 * @returns Promise with base64 encoded audio or error
 */
export async function synthesizeSpeech(
  text: string,
  locale: string
): Promise<TTSResult> {
  // Check if TTS is enabled
  if (!isAzureTTSEnabled()) {
    console.debug('[AzureTTS] TTS skipped: Service disabled or missing configuration.');
    return { success: false, error: 'TTS service is not enabled or configured' };
  }

  // Validate input
  if (!text.trim()) {
    return { success: false, error: 'Empty text provided' };
  }

  // Get voice configuration for locale
  const voice = getVoiceForLocale(locale);
  if (!voice) {
    console.warn(`[AzureTTS] Unsupported locale: ${locale}`);
    return { success: false, error: `Unsupported locale: ${locale}` };
  }

  console.info(`[AzureTTS] Synthesizing speech for "${text.substring(0, 30)}..." in ${locale}`);

  // Build SSML
  const ssml = buildSSML(text, voice);

  try {
    const response = await fetch(AZURE_TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_TTS_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        'User-Agent': 'BigBlueButton-TTS',
      },
      body: ssml,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[AzureTTS] API error ${response.status}: ${errorBody}`);
      return { success: false, error: `Azure TTS API error: ${response.status}` };
    }

    // Get audio as ArrayBuffer and convert to base64
    const audioBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    console.info(`[AzureTTS] Successfully synthesized ${base64Audio.length} bytes of audio`);

    return { success: true, audio: base64Audio };
  } catch (error) {
    console.error('[AzureTTS] Synthesis failed:', error);
    return { success: false, error: 'TTS synthesis failed' };
  }
}

export default {
  synthesizeSpeech,
  isAzureTTSEnabled,
  getVoiceForLocale,
  getSupportedTTSLocales,
  VOICE_MAPPINGS,
};
