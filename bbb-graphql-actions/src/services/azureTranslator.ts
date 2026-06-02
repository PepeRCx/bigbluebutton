/**
 * Azure Translator Service
 *
 * Handles text-to-text translation using Azure Cognitive Services Translator API.
 * Translates captions to multiple target languages for real-time caption display.
 */

import { AZURE_TRANSLATOR_ENDPOINT, AZURE_TRANSLATOR_KEY, AZURE_TRANSLATOR_ENABLED } from '../config';

// Supported language mappings from BBB locale codes to Azure language codes
export const SUPPORTED_LANGUAGES: Record<string, { azureCode: string; name: string }> = {
  'en-US': { azureCode: 'en', name: 'English' },
  'es-ES': { azureCode: 'es', name: 'Spanish' },
  'pt-BR': { azureCode: 'pt', name: 'Portuguese' },
  'de-DE': { azureCode: 'de', name: 'German' },
  'fr-FR': { azureCode: 'fr', name: 'French' },
  'ru-RU': { azureCode: 'ru', name: 'Russian' },
  'it-IT': { azureCode: 'it', name: 'Italian' },
  'pl-PL': { azureCode: 'pl', name: 'Polish' },
  'nl-NL': { azureCode: 'nl', name: 'Dutch' },
  'uk-UA': { azureCode: 'uk', name: 'Ukrainian' },
  'ro-RO': { azureCode: 'ro', name: 'Romanian' },
  'el-GR': { azureCode: 'el', name: 'Greek' },
  'cs-CZ': { azureCode: 'cs', name: 'Czech' },
  'hu-HU': { azureCode: 'hu', name: 'Hungarian' },
  'sv-SE': { azureCode: 'sv', name: 'Swedish' },
  'da-DK': { azureCode: 'da', name: 'Danish' },
  'nb-NO': { azureCode: 'nb', name: 'Norwegian' },
  'fi-FI': { azureCode: 'fi', name: 'Finnish' },
  'bg-BG': { azureCode: 'bg', name: 'Bulgarian' },
  'sr-RS': { azureCode: 'sr', name: 'Serbian' },
  'hr-HR': { azureCode: 'hr', name: 'Croatian' },
  'sk-SK': { azureCode: 'sk', name: 'Slovak' },
  'lt-LT': { azureCode: 'lt', name: 'Lithuanian' },
  'lv-LV': { azureCode: 'lv', name: 'Latvian' },
  'et-EE': { azureCode: 'et', name: 'Estonian' },
  'sl-SI': { azureCode: 'sl', name: 'Slovenian' },
  'is-IS': { azureCode: 'is', name: 'Icelandic' },
  'zh-CN': { azureCode: 'zh-Hans', name: 'Chinese (Simplified)' },
  'hi-IN': { azureCode: 'hi', name: 'Hindi' },
  'ar-SA': { azureCode: 'ar', name: 'Arabic' },
  'ja-JP': { azureCode: 'ja', name: 'Japanese' },
  'bn-IN': { azureCode: 'bn', name: 'Bengali' },
  'ur-PK': { azureCode: 'ur', name: 'Urdu' },
  'id-ID': { azureCode: 'id', name: 'Indonesian' },
  'sw-KE': { azureCode: 'sw', name: 'Swahili' },
  'mr-IN': { azureCode: 'mr', name: 'Marathi' },
  'te-IN': { azureCode: 'te', name: 'Telugu' },
  'tr-TR': { azureCode: 'tr', name: 'Turkish' },
  'ko-KR': { azureCode: 'ko', name: 'Korean' },
  'ta-IN': { azureCode: 'ta', name: 'Tamil' },
  'vi-VN': { azureCode: 'vi', name: 'Vietnamese' },
  'th-TH': { azureCode: 'th', name: 'Thai' },
  'fa-IR': { azureCode: 'fa', name: 'Persian' },
  'fil-PH': { azureCode: 'fil', name: 'Filipino' },
  'ms-MY': { azureCode: 'ms', name: 'Malay' },
  'he-IL': { azureCode: 'he', name: 'Hebrew' },
  'ka-GE': { azureCode: 'ka', name: 'Georgian' },
  'hy-AM': { azureCode: 'hy', name: 'Armenian' },
  'az-AZ': { azureCode: 'az', name: 'Azerbaijani' },
  'kk-KZ': { azureCode: 'kk', name: 'Kazakh' },
};

// Reverse mapping from Azure codes to BBB locale codes
export const AZURE_TO_BBB_LOCALE: Record<string, string> = {
  'en': 'en-US',
  'es': 'es-ES',
  'pt': 'pt-BR',
  'de': 'de-DE',
  'fr': 'fr-FR',
  'ru': 'ru-RU',
  'it': 'it-IT',
  'pl': 'pl-PL',
  'nl': 'nl-NL',
  'uk': 'uk-UA',
  'ro': 'ro-RO',
  'el': 'el-GR',
  'cs': 'cs-CZ',
  'hu': 'hu-HU',
  'sv': 'sv-SE',
  'da': 'da-DK',
  'nb': 'nb-NO',
  'fi': 'fi-FI',
  'bg': 'bg-BG',
  'sr': 'sr-RS',
  'hr': 'hr-HR',
  'sk': 'sk-SK',
  'lt': 'lt-LT',
  'lv': 'lv-LV',
  'et': 'et-EE',
  'sl': 'sl-SI',
  'is': 'is-IS',
  'zh-Hans': 'zh-CN',
  'hi': 'hi-IN',
  'ar': 'ar-SA',
  'ja': 'ja-JP',
  'bn': 'bn-IN',
  'ur': 'ur-PK',
  'id': 'id-ID',
  'sw': 'sw-KE',
  'mr': 'mr-IN',
  'te': 'te-IN',
  'tr': 'tr-TR',
  'ko': 'ko-KR',
  'ta': 'ta-IN',
  'vi': 'vi-VN',
  'th': 'th-TH',
  'fa': 'fa-IR',
  'fil': 'fil-PH',
  'ms': 'ms-MY',
  'he': 'he-IL',
  'ka': 'ka-GE',
  'hy': 'hy-AM',
  'az': 'az-AZ',
  'kk': 'kk-KZ',
};

interface AzureTranslation {
  text: string;
  to: string;
}

interface AzureTranslationResult {
  translations: AzureTranslation[];
}

export interface TranslationResult {
  locale: string;
  text: string;
}

/**
 * Converts a BBB locale code to Azure language code
 */
export function toAzureCode(bbbLocale: string): string | null {
  const language = SUPPORTED_LANGUAGES[bbbLocale];
  return language ? language.azureCode : null;
}

/**
 * Converts an Azure language code to BBB locale code
 */
export function toBBBLocale(azureCode: string): string | null {
  return AZURE_TO_BBB_LOCALE[azureCode] || null;
}

/**
 * Gets all supported BBB locale codes
 */
export function getSupportedLocales(): string[] {
  return Object.keys(SUPPORTED_LANGUAGES);
}

/**
 * Checks if Azure Translator is enabled and configured
 */
export function isAzureTranslatorEnabled(): boolean {
  return AZURE_TRANSLATOR_ENABLED &&
    !!AZURE_TRANSLATOR_ENDPOINT &&
    !!AZURE_TRANSLATOR_KEY;
}

/**
 * Translates text from source language to multiple target languages using Azure Translator API.
 *
 * @param text - The text to translate
 * @param sourceLocale - The source language BBB locale code (e.g., 'en-US')
 * @param targetLocales - Array of target language BBB locale codes to translate to
 * @returns Map of locale code to translated text. Falls back to original text on error.
 */
export async function translateText(
  text: string,
  sourceLocale: string,
  targetLocales: string[]
): Promise<TranslationResult[]> {
  // If translation is disabled or no text, return empty
  if (!isAzureTranslatorEnabled()) {
    console.debug('[AzureTranslator] Translation skipped: Service disabled or missing configuration.');
    return [];
  }

  if (!text.trim()) {
    return [];
  }

  console.info(`[AzureTranslator] Translating "${text.substring(0, 20)}..." from ${sourceLocale} to ${targetLocales.length} languages.`);

  // Convert source locale to Azure code
  const sourceAzureCode = toAzureCode(sourceLocale);
  if (!sourceAzureCode) {
    console.warn(`[AzureTranslator] Unsupported source locale: ${sourceLocale}`);
    return [];
  }

  // Filter target locales to only supported ones and exclude source
  const validTargetLocales = targetLocales.filter(locale => {
    const azureCode = toAzureCode(locale);
    return azureCode && azureCode !== sourceAzureCode;
  });

  if (validTargetLocales.length === 0) {
    return [];
  }

  // Build target language codes for API
  const targetAzureCodes = validTargetLocales
    .map(locale => toAzureCode(locale))
    .filter(Boolean) as string[];

  // Build API URL with query parameters
  const toParams = targetAzureCodes.map(code => `to=${code}`).join('&');
  const url = `${AZURE_TRANSLATOR_ENDPOINT}?api-version=3.0&from=${sourceAzureCode}&${toParams}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_TRANSLATOR_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ Text: text }]),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[AzureTranslator] API error ${response.status}: ${errorBody}`);
      return [];
    }

    const results: AzureTranslationResult[] = await response.json();

    if (!results || !results[0] || !results[0].translations) {
      console.error('[AzureTranslator] Invalid response format');
      return [];
    }

    // Map Azure response back to BBB locale codes
    const translations: TranslationResult[] = results[0].translations.map(translation => {
      const bbbLocale = toBBBLocale(translation.to);
      return {
        locale: bbbLocale || translation.to,
        text: translation.text,
      };
    }).filter(t => t.locale);

    return translations;
  } catch (error) {
    console.error('[AzureTranslator] Translation failed:', error);
    return [];
  }
}

/**
 * Translates text to all supported languages except the source.
 * Convenience method that translates to all configured languages.
 *
 * @param text - The text to translate
 * @param sourceLocale - The source language BBB locale code
 * @returns Map of locale code to translated text
 */
export async function translateToAllLanguages(
  text: string,
  sourceLocale: string
): Promise<TranslationResult[]> {
  const allLocales = getSupportedLocales();
  const targetLocales = allLocales.filter(locale => locale !== sourceLocale);
  return translateText(text, sourceLocale, targetLocales);
}

export default {
  translateText,
  translateToAllLanguages,
  getSupportedLocales,
  isAzureTranslatorEnabled,
  toAzureCode,
  toBBBLocale,
  SUPPORTED_LANGUAGES,
};
