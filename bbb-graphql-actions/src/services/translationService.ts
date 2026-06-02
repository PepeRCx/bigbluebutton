import { TRANSLATION_PROVIDER } from '../config';
import {
  getSupportedLocales as getAzureSupportedLocales,
  isAzureTranslatorEnabled,
  translateText as translateWithAzure,
  translateToAllLanguages as translateAllWithAzure,
  type TranslationResult,
} from './azureTranslator';
import {
  getSupportedLocales as getTimAISupportedLocales,
  isTimAITranslatorEnabled,
  translateText as translateWithTimAI,
  translateToAllLanguages as translateAllWithTimAI,
} from './timaiTranslator';

export function isTranslationEnabled(): boolean {
  if (TRANSLATION_PROVIDER === 'tim-ai') {
    return isTimAITranslatorEnabled();
  }

  return isAzureTranslatorEnabled();
}

export function getSupportedLocales(): string[] {
  if (TRANSLATION_PROVIDER === 'tim-ai') {
    return getTimAISupportedLocales();
  }

  return getAzureSupportedLocales();
}

export async function translateText(
  text: string,
  sourceLocale: string,
  targetLocales: string[],
): Promise<TranslationResult[]> {
  if (TRANSLATION_PROVIDER === 'tim-ai') {
    return translateWithTimAI(text, sourceLocale, targetLocales);
  }

  return translateWithAzure(text, sourceLocale, targetLocales);
}

export async function translateToAllLanguages(
  text: string,
  sourceLocale: string,
): Promise<TranslationResult[]> {
  if (TRANSLATION_PROVIDER === 'tim-ai') {
    return translateAllWithTimAI(text, sourceLocale);
  }

  return translateAllWithAzure(text, sourceLocale);
}

export default {
  getSupportedLocales,
  isTranslationEnabled,
  translateText,
  translateToAllLanguages,
};
