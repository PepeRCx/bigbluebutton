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
};

// Reverse mapping from Azure codes to BBB locale codes
export const AZURE_TO_BBB_LOCALE: Record<string, string> = {
  'en': 'en-US',
  'es': 'es-ES',
  'pt': 'pt-BR',
  'de': 'de-DE',
  'fr': 'fr-FR',
};

interface AzureTranslation {
  text: string;
  to: string;
}

interface AzureTranslationResult {
  translations: AzureTranslation[];
}

interface TranslationResult {
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
  if (!isAzureTranslatorEnabled() || !text.trim()) {
    return [];
  }

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
