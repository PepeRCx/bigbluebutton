import { getPostgresPool } from '../imports/postgres';

interface MeetingCaptionDemandRow {
  meetingId: string;
  userId: string;
  captionLocale: string | null;
}

type SessionVariables = Record<string, unknown>;
type ActionInput = Record<string, unknown>;

const meetingCaptionLocales = new Map<string, Map<string, string>>();
const bootstrappedMeetings = new Set<string>();
const bootstrapPromises = new Map<string, Promise<void>>();
const preBootstrapOverrides = new Map<string, Set<string>>();

function normalizeLocale(locale: string | null | undefined): string {
  return (locale || '').trim();
}

function getMeetingUsers(meetingId: string): Map<string, string> {
  let users = meetingCaptionLocales.get(meetingId);
  if (!users) {
    users = new Map<string, string>();
    meetingCaptionLocales.set(meetingId, users);
  }

  return users;
}

function markOverride(meetingId: string, userId: string): void {
  if (bootstrappedMeetings.has(meetingId)) {
    return;
  }

  let overrides = preBootstrapOverrides.get(meetingId);
  if (!overrides) {
    overrides = new Set<string>();
    preBootstrapOverrides.set(meetingId, overrides);
  }

  overrides.add(userId);
}

function cleanupMeetingIfEmpty(meetingId: string): void {
  const users = meetingCaptionLocales.get(meetingId);
  if (users && users.size > 0) {
    return;
  }

  meetingCaptionLocales.delete(meetingId);
  bootstrapPromises.delete(meetingId);
  preBootstrapOverrides.delete(meetingId);
}

async function loadMeetingCaptionDemand(meetingId: string): Promise<MeetingCaptionDemandRow[]> {
  const postgresPool = getPostgresPool();
  const result = await postgresPool.query<MeetingCaptionDemandRow>(
    `SELECT "meetingId", "userId", "captionLocale"
     FROM "v_user"
     WHERE "meetingId" = $1
       AND COALESCE("captionLocale", '') <> ''`,
    [meetingId],
  );

  return result.rows;
}

async function bootstrapMeeting(meetingId: string): Promise<void> {
  if (!meetingId || bootstrappedMeetings.has(meetingId)) {
    return;
  }

  const existingPromise = bootstrapPromises.get(meetingId);
  if (existingPromise) {
    await existingPromise;
    return;
  }

  const bootstrapPromise = (async () => {
    const rows = await loadMeetingCaptionDemand(meetingId);
    const users = getMeetingUsers(meetingId);
    const overrides = preBootstrapOverrides.get(meetingId) || new Set<string>();

    rows.forEach((row) => {
      if (overrides.has(row.userId)) {
        return;
      }

      const locale = normalizeLocale(row.captionLocale);
      if (locale) {
        users.set(row.userId, locale);
      }
    });

    bootstrappedMeetings.add(meetingId);
    preBootstrapOverrides.delete(meetingId);
    cleanupMeetingIfEmpty(meetingId);
  })()
    .catch((error) => {
      console.error(`[MeetingCaptionDemand] Failed to bootstrap meeting ${meetingId}:`, error);
      throw error;
    })
    .finally(() => {
      bootstrapPromises.delete(meetingId);
    });

  bootstrapPromises.set(meetingId, bootstrapPromise);
  await bootstrapPromise;
}

export async function ensureMeetingBootstrapped(meetingId: string): Promise<void> {
  await bootstrapMeeting(meetingId);
}

export async function getTargetLocales(
  meetingId: string,
  sourceLocale: string,
  supportedLocales: string[],
): Promise<string[]> {
  if (!meetingId) {
    return [];
  }

  try {
    await ensureMeetingBootstrapped(meetingId);
  } catch (error) {
    console.error(`[MeetingCaptionDemand] Falling back to no target locales for meeting ${meetingId}:`, error);
    return [];
  }

  const users = meetingCaptionLocales.get(meetingId);
  if (!users || users.size === 0) {
    return [];
  }

  const supportedLocaleSet = new Set(supportedLocales);
  const normalizedSourceLocale = normalizeLocale(sourceLocale);
  const targetLocales = new Set<string>();

  users.forEach((locale) => {
    if (!locale || locale === normalizedSourceLocale || !supportedLocaleSet.has(locale)) {
      return;
    }

    targetLocales.add(locale);
  });

  return [...targetLocales];
}

export function setUserCaptionLocale(
  meetingId: string,
  userId: string,
  locale: string | null | undefined,
): void {
  if (!meetingId || !userId) {
    return;
  }

  markOverride(meetingId, userId);

  const normalizedLocale = normalizeLocale(locale);
  const users = getMeetingUsers(meetingId);

  if (!normalizedLocale) {
    users.delete(userId);
    cleanupMeetingIfEmpty(meetingId);
    return;
  }

  users.set(userId, normalizedLocale);
}

export function removeUser(meetingId: string, userId: string): void {
  if (!meetingId || !userId) {
    return;
  }

  markOverride(meetingId, userId);

  const users = meetingCaptionLocales.get(meetingId);
  if (!users) {
    return;
  }

  users.delete(userId);
  cleanupMeetingIfEmpty(meetingId);
}

export function syncMeetingCaptionDemandFromAction(
  actionName: string,
  sessionVariables: SessionVariables,
  input: ActionInput,
): void {
  const meetingId = sessionVariables['x-hasura-meetingid'] as string | undefined;
  const userId = sessionVariables['x-hasura-userid'] as string | undefined;

  if (!meetingId || !userId) {
    return;
  }

  if (actionName === 'userSetCaptionLocale') {
    setUserCaptionLocale(meetingId, userId, input.locale as string | undefined);
    return;
  }

  if (actionName === 'userLeaveMeeting') {
    removeUser(meetingId, userId);
  }
}

export default {
  ensureMeetingBootstrapped,
  getTargetLocales,
  setUserCaptionLocale,
  removeUser,
  syncMeetingCaptionDemandFromAction,
};
