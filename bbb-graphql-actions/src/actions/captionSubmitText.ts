import { RedisMessage, RedisMessageOrArray } from '../types';
import { throwErrorIfInvalidInput } from "../imports/validation";
import { translateToAllLanguages, isAzureTranslatorEnabled, getSupportedLocales } from '../services/azureTranslator';

/**
 * Builds Redis message(s) for caption submission.
 *
 * When Azure Translator is enabled and the caption is final (isFinal=true),
 * this will translate the transcript to all supported languages and return
 * multiple messages - one for the original caption and one for each translation.
 */
export default async function buildRedisMessage(
  sessionVariables: Record<string, unknown>,
  input: Record<string, unknown>
): Promise<RedisMessageOrArray> {
  throwErrorIfInvalidInput(input, [
    { name: 'transcriptId', type: 'string', required: true },
    { name: 'start', type: 'int', required: true },
    { name: 'end', type: 'int', required: true },
    { name: 'text', type: 'string', required: true },
    { name: 'transcript', type: 'string', required: true },
    { name: 'locale', type: 'string', required: true },
    { name: 'isFinal', type: 'boolean', required: true },
  ]);

  const eventName = `UpdateTranscriptPubMsg`;
  const meetingId = sessionVariables['x-hasura-meetingid'] as string;
  const userId = sessionVariables['x-hasura-userid'] as string;
  const sourceLocale = input.locale as string;
  const transcript = input.transcript as string;
  const isFinal = input.isFinal as boolean;

  const routing = {
    meetingId,
    userId,
  };

  const header = {
    name: eventName,
    meetingId: routing.meetingId,
    userId: routing.userId,
  };

  // Build the original caption message
  const originalMessage: RedisMessage = {
    eventName,
    routing,
    header,
    body: {
      transcriptId: input.transcriptId,
      start: input.start,
      end: input.end,
      text: input.text,
      transcript: input.transcript,
      locale: input.locale,
      result: input.isFinal,
    },
  };

  // If not final or translation disabled, return only the original message
  if (!isFinal || !isAzureTranslatorEnabled() || !transcript.trim()) {
    return originalMessage;
  }

  // Check if source locale is one of our supported translation languages
  const supportedLocales = getSupportedLocales();
  if (!supportedLocales.includes(sourceLocale)) {
    return originalMessage;
  }

  // Translate to all other supported languages
  const translations = await translateToAllLanguages(transcript, sourceLocale);

  if (translations.length === 0) {
    return originalMessage;
  }

  // Build messages for translated captions
  const messages: RedisMessage[] = [originalMessage];

  for (const translation of translations) {
    // Create a unique transcriptId for each translated caption
    const translatedTranscriptId = `${input.transcriptId}-${translation.locale}`;

    const translatedMessage: RedisMessage = {
      eventName,
      routing,
      header: {
        name: eventName,
        meetingId,
        userId,
      },
      body: {
        transcriptId: translatedTranscriptId,
        start: input.start,
        end: input.end,
        text: translation.text,
        transcript: translation.text,
        locale: translation.locale,
        result: true, // Translations are always final
      },
    };

    messages.push(translatedMessage);
  }

  return messages;
}
