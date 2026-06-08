/**
 * Voice Translation (TTS) Service
 *
 * Handles text-to-speech audio playback for translated captions.
 * Features:
 * - Fetches TTS audio from server
 * - Manages audio playback with Web Audio API
 * - Handles interruption for new captions
 * - Mutes original speaker audio when TTS is active
 */

import logger from '/imports/startup/client/logger';

// TTS endpoint URL (proxied through nginx)
// Selects the appropriate endpoint based on the configured TTS provider
const getTTSEndpoint = (): string => {
  const SETTINGS = window.meetingClientSettings;
  const provider = SETTINGS?.public?.app?.audioCaptions?.tts?.provider || 'azure';
  if (provider === 'tim-ai') {
    return '/tim-ai/tts';
  }
  return '/tts';
};

interface TTSResponse {
  success: boolean;
  audio?: string;
  contentType?: string;
  error?: string;
}

interface TTSQueueItem {
  text: string;
  locale: string;
  resolve: (success: boolean) => void;
}

// Audio playback state
let currentAudioSource: AudioBufferSourceNode | null = null;
let audioContext: AudioContext | null = null;
let isPlaying = false;
let ttsQueue: TTSQueueItem[] = [];
let playbackSessionId = 0;
let activeProcessingSessionId: number | null = null;

// Volume control state
let ttsGainNode: GainNode | null = null;
let currentTTSVolume: number = 1;
// Cache the user's preferred speaker level while voice translation is active.
// Temporary restores to 100% must not overwrite this preference.
let currentOriginalSpeakerVolume: number = 1;

/**
 * Gets or creates the AudioContext
 */
const getAudioContext = (): AudioContext => {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext();
  }
  return audioContext;
};

const resolveQueuedItems = (items: TTSQueueItem[], success: boolean): void => {
  items.forEach((item) => item.resolve(success));
};

const restoreOriginalSpeakerVolumeIfIdle = (): void => {
  if (!isPlaying && ttsQueue.length === 0 && activeProcessingSessionId === null) {
    restoreOriginalSpeakerVolume();
  }
};

/**
 * Stops any currently playing TTS audio
 */
export const stopTTSAudio = (): void => {
  playbackSessionId += 1;
  activeProcessingSessionId = null;
  if (currentAudioSource) {
    try {
      currentAudioSource.stop();
      currentAudioSource.disconnect();
    } catch (e) {
      // Ignore errors if already stopped
    }
    currentAudioSource = null;
  }
  isPlaying = false;
};

export const clearTTSQueue = (): void => {
  const pendingItems = ttsQueue.splice(0);
  resolveQueuedItems(pendingItems, false);
  restoreOriginalSpeakerVolumeIfIdle();
};

/**
 * Converts base64 string to ArrayBuffer
 */
const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

/**
 * Mutes or unmutes the original speaker audio (legacy function for compatibility)
 */
export const setOriginalSpeakerMuted = (muted: boolean): void => {
  // Use the new volume-based approach
  if (muted) {
    setOriginalSpeakerVolumeValue(currentOriginalSpeakerVolume);
  } else {
    setOriginalSpeakerVolumeValue(1);
  }
};

/**
 * Sets the original speaker volume (0-1 range)
 */
export const setOriginalSpeakerVolumeValue = (volume: number): void => {
  const SETTINGS = window.meetingClientSettings;
  const MEDIA_TAG = SETTINGS?.public?.media?.mediaTag?.replace(/#/g, '') || 'remoteMediaVideo';
  const mediaElement = document.getElementById(MEDIA_TAG) as HTMLMediaElement | null;

  const clampedVolume = Math.max(0, Math.min(1, volume));

  if (mediaElement) {
    mediaElement.volume = clampedVolume;
    logger.debug({
      logCode: 'tts_original_speaker_volume_set',
      extraInfo: { volume: clampedVolume },
    }, `Original speaker volume set to ${Math.round(clampedVolume * 100)}%`);
  }
};

/**
 * Updates the stored original speaker volume and applies it
 */
export const updateOriginalSpeakerVolume = (volume: number): void => {
  currentOriginalSpeakerVolume = Math.max(0, Math.min(1, volume));
  setOriginalSpeakerVolumeValue(currentOriginalSpeakerVolume);
};

/**
 * Sets the TTS voice volume (0-1 range)
 */
export const setTTSVolumeValue = (volume: number): void => {
  currentTTSVolume = Math.max(0, Math.min(1, volume));
  if (ttsGainNode) {
    ttsGainNode.gain.value = currentTTSVolume;
  }
  logger.debug({
    logCode: 'tts_volume_set',
    extraInfo: { volume: currentTTSVolume },
  }, `TTS volume set to ${Math.round(currentTTSVolume * 100)}%`);
};

/**
 * Restores original speaker to full volume
 */
export const restoreOriginalSpeakerVolume = (): void => {
  const SETTINGS = window.meetingClientSettings;
  const MEDIA_TAG = SETTINGS?.public?.media?.mediaTag?.replace(/#/g, '') || 'remoteMediaVideo';
  const mediaElement = document.getElementById(MEDIA_TAG) as HTMLMediaElement | null;

  if (mediaElement) {
    mediaElement.volume = 1;
    logger.debug({ logCode: 'tts_original_speaker_restored' }, 'Original speaker volume restored to 100%');
  }
};

/**
 * Fetches TTS audio from the server
 */
const fetchTTSAudio = async (text: string, locale: string): Promise<ArrayBuffer | null> => {
  const endpoint = getTTSEndpoint();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, locale }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      logger.error({
        logCode: 'tts_fetch_error',
        extraInfo: { status: response.status, error: errorData.error },
      }, 'Failed to fetch TTS audio');
      return null;
    }

    const data: TTSResponse = await response.json();

    if (!data.success || !data.audio) {
      logger.error({
        logCode: 'tts_response_error',
        extraInfo: { error: data.error },
      }, 'TTS response was not successful');
      return null;
    }

    return base64ToArrayBuffer(data.audio);
  } catch (error) {
    logger.error({
      logCode: 'tts_fetch_exception',
      extraInfo: { errorMessage: (error as Error).message },
    }, 'Exception while fetching TTS audio');
    return null;
  }
};

/**
 * Plays audio buffer using Web Audio API with volume control
 */
const playAudioBuffer = async (
  audioBuffer: ArrayBuffer,
  sessionId: number,
): Promise<boolean> => {
  const ctx = getAudioContext();

  // Resume context if suspended (due to browser autoplay policies)
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  // Decode audio data
  const decodedAudio = await ctx.decodeAudioData(audioBuffer);
  if (sessionId !== playbackSessionId) {
    return false;
  }

  // Create GainNode for volume control if needed
  if (!ttsGainNode || ttsGainNode.context !== ctx) {
    ttsGainNode = ctx.createGain();
    ttsGainNode.connect(ctx.destination);
  }
  ttsGainNode.gain.value = currentTTSVolume;

  // Create and configure source
  const source = ctx.createBufferSource();
  source.buffer = decodedAudio;
  source.connect(ttsGainNode);

  // Track playback state
  currentAudioSource = source;
  isPlaying = true;

  return new Promise<boolean>((resolve) => {
    source.onended = () => {
      isPlaying = false;
      if (currentAudioSource === source) {
        currentAudioSource = null;
      }
      resolve(sessionId === playbackSessionId);
    };

    source.start(0);
  });
};

const processQueue = async (sessionId: number): Promise<void> => {
  while (sessionId === playbackSessionId) {
    const item = ttsQueue.shift();

    if (!item) {
      break;
    }

    const audioBuffer = await fetchTTSAudio(item.text, item.locale);

    if (sessionId !== playbackSessionId) {
      item.resolve(false);
      break;
    }

    if (!audioBuffer) {
      item.resolve(false);
      continue;
    }

    try {
      const played = await playAudioBuffer(audioBuffer, sessionId);
      item.resolve(played && sessionId === playbackSessionId);
    } catch (error) {
      logger.error({
        logCode: 'tts_play_error',
        extraInfo: { errorMessage: (error as Error).message },
      }, 'Failed to play TTS audio');
      item.resolve(false);
    }
  }

  if (activeProcessingSessionId === sessionId) {
    activeProcessingSessionId = null;
  }

  restoreOriginalSpeakerVolumeIfIdle();
};

const startQueueProcessing = (): void => {
  if (ttsQueue.length === 0) {
    restoreOriginalSpeakerVolumeIfIdle();
    return;
  }

  if (activeProcessingSessionId === playbackSessionId) {
    return;
  }

  const sessionId = playbackSessionId;
  activeProcessingSessionId = sessionId;

  void processQueue(sessionId);
};

/**
 * Main function to speak text using TTS
 * Handles queueing, muting original speaker, and playback
 */
export const speakText = async (text: string, locale: string): Promise<boolean> => {
  if (!text.trim()) {
    return false;
  }

  logger.info({
    logCode: 'tts_speak_request',
    extraInfo: { text: text.substring(0, 50), locale },
  }, 'TTS speak request');

  setOriginalSpeakerMuted(true);

  return new Promise<boolean>((resolve) => {
    ttsQueue.push({
      text,
      locale,
      resolve: (success) => {
        if (success) {
          logger.info({ logCode: 'tts_speak_success' }, 'TTS audio playing');
        }
        resolve(success);
      },
    });

    startQueueProcessing();
  });
};

/**
 * Checks if TTS is currently playing
 */
export const isTTSPlaying = (): boolean => isPlaying || ttsQueue.length > 0;

/**
 * Checks if TTS service is available
 */
export const checkTTSAvailability = async (): Promise<boolean> => {
  const SETTINGS = window.meetingClientSettings;
  const provider = SETTINGS?.public?.app?.audioCaptions?.tts?.provider || 'azure';
  const healthPath = provider === 'tim-ai' ? '/tim-ai/tts/health' : '/tts/health';
  try {
    const response = await fetch(healthPath);
    const data = await response.json();
    return data.enabled === true;
  } catch {
    return false;
  }
};

export default {
  speakText,
  stopTTSAudio,
  clearTTSQueue,
  setOriginalSpeakerMuted,
  setOriginalSpeakerVolumeValue,
  updateOriginalSpeakerVolume,
  setTTSVolumeValue,
  restoreOriginalSpeakerVolume,
  isTTSPlaying,
  checkTTSAvailability,
};
