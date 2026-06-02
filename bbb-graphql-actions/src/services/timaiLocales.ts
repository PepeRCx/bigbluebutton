export const BBB_TO_TIMAI_LANGUAGE: Record<string, string> = {
  'en-US': 'en',
  'de-DE': 'de',
  'es-ES': 'es',
  'fr-FR': 'fr',
};

export const TIMAI_TO_BBB_LOCALE: Record<string, string> = Object.entries(BBB_TO_TIMAI_LANGUAGE)
  .reduce<Record<string, string>>((acc, [locale, languageCode]) => {
    acc[languageCode] = locale;
    return acc;
  }, {});

export const TIMAI_SUPPORTED_LOCALES = Object.keys(BBB_TO_TIMAI_LANGUAGE);
