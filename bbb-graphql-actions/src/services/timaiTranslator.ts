import WebSocket from 'ws';
import { TIMAI_TRANSLATE_ENABLED, TIMAI_TRANSLATE_URL } from '../config';
import { BBB_TO_TIMAI_LANGUAGE, TIMAI_SUPPORTED_LOCALES } from './timaiLocales';
import type { TranslationResult } from './azureTranslator';

const TRANSLATION_TIMEOUT_MS = 30000;

interface TimAITranslateMessage {
  type?: string;
  text?: string;
  message?: string;
}

export function getSupportedLocales(): string[] {
  return [...TIMAI_SUPPORTED_LOCALES];
}

export function getTimAITranslateLanguageCode(locale: string): string | null {
  return BBB_TO_TIMAI_LANGUAGE[locale] || null;
}

export function isTimAITranslatorEnabled(): boolean {
  return TIMAI_TRANSLATE_ENABLED && !!TIMAI_TRANSLATE_URL;
}

async function translateWithWebSocket(
  text: string,
  sourceLocale: string,
  targetLocale: string,
): Promise<string> {
  const source = getTimAITranslateLanguageCode(sourceLocale);
  const target = getTimAITranslateLanguageCode(targetLocale);

  if (!source || !target || source === target) {
    return '';
  }

  return new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(TIMAI_TRANSLATE_URL);
    let completed = false;
    let finalReceived = false;
    let partialText = '';
    let finalText = '';

    const timeout = setTimeout(() => {
      if (completed) {
        return;
      }

      completed = true;
      ws.close();
      reject(new Error(`Timed out waiting for Tim AI translation: ${sourceLocale} -> ${targetLocale}`));
    }, TRANSLATION_TIMEOUT_MS);

    const finish = (callback: () => void) => {
      if (completed) {
        return;
      }

      completed = true;
      clearTimeout(timeout);
      callback();
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({ source, target }));
    });

    ws.on('message', (data) => {
      let message: TimAITranslateMessage;

      try {
        message = JSON.parse(data.toString()) as TimAITranslateMessage;
      } catch (error) {
        finish(() => {
          ws.close();
          reject(new Error(`Invalid Tim AI translation response for ${targetLocale}`));
        });
        return;
      }

      if (message.type === 'error') {
        finish(() => {
          ws.close();
          reject(new Error(message.message || `Tim AI translation failed for ${targetLocale}`));
        });
        return;
      }

      if (message.type === 'ready') {
        ws.send(JSON.stringify({ text }));
        return;
      }

      if (message.type === 'partial') {
        partialText += message.text || '';
        return;
      }

      if (message.type === 'final') {
        finalReceived = true;
        finalText = message.text || partialText;
        ws.send(JSON.stringify({ type: 'end' }));
        return;
      }

      if (message.type === 'done') {
        finish(() => {
          ws.close();
          resolve(finalText || partialText);
        });
      }
    });

    ws.on('error', (error) => {
      finish(() => {
        ws.close();
        reject(error);
      });
    });

    ws.on('close', () => {
      if (!completed && finalReceived) {
        finish(() => {
          resolve(finalText || partialText);
        });
        return;
      }

      if (!completed) {
        finish(() => {
          reject(new Error(`Tim AI translation socket closed before completion for ${targetLocale}`));
        });
      }
    });
  });
}

export async function translateText(
  text: string,
  sourceLocale: string,
  targetLocales: string[],
): Promise<TranslationResult[]> {
  if (!isTimAITranslatorEnabled()) {
    console.debug('[TimAI-Translator] Translation skipped: service disabled or missing configuration.');
    return [];
  }

  if (!text.trim()) {
    return [];
  }

  const sourceLanguageCode = getTimAITranslateLanguageCode(sourceLocale);
  if (!sourceLanguageCode) {
    console.warn(`[TimAI-Translator] Unsupported source locale: ${sourceLocale}`);
    return [];
  }

  const validTargetLocales = [...new Set(targetLocales)].filter((locale) => {
    const targetLanguageCode = getTimAITranslateLanguageCode(locale);
    return !!targetLanguageCode && targetLanguageCode !== sourceLanguageCode;
  });

  if (validTargetLocales.length === 0) {
    return [];
  }

  console.info(`[TimAI-Translator] Translating "${text.substring(0, 20)}..." from ${sourceLocale} to ${validTargetLocales.length} languages.`);

  const settledTranslations = await Promise.all(
    validTargetLocales.map(async (locale) => {
      try {
        const translatedText = await translateWithWebSocket(text, sourceLocale, locale);
        return translatedText.trim()
          ? { locale, text: translatedText.trim() }
          : null;
      } catch (error) {
        console.error(`[TimAI-Translator] Translation failed for ${locale}:`, error);
        return null;
      }
    }),
  );

  return settledTranslations.filter((translation): translation is TranslationResult => translation !== null);
}

export async function translateToAllLanguages(
  text: string,
  sourceLocale: string,
): Promise<TranslationResult[]> {
  const targetLocales = getSupportedLocales().filter((locale) => locale !== sourceLocale);
  return translateText(text, sourceLocale, targetLocales);
}

export default {
  translateText,
  translateToAllLanguages,
  getSupportedLocales,
  getTimAITranslateLanguageCode,
  isTimAITranslatorEnabled,
};
