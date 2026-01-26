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

// TTS endpoint URL (relative to bbb-graphql-actions server)
const getTTSEndpoint = (): string => {
  // Use the same server as GraphQL actions
  const SETTINGS = window.meetingClientSettings;
  const GRAPHQL_ACTIONS_URL = SETTINGS?.public?.app?.graphqlActionsUrl || '';

  // Extract base URL and append /tts
  if (GRAPHQL_ACTIONS_URL) {
    const url = new URL(GRAPHQL_ACTIONS_URL);
    return `${url.protocol}//${url.host}/tts`;
  }

  // Fallback to localhost for development
  return 'http://localhost:8093/tts';
};

interface TTSResponse {
  success: boolean;
  audio?: string;
  contentType?: string;
  error?: string;
}

// Audio playback state
let currentAudioSource: AudioBufferSourceNode | null = null;
let audioContext: AudioContext | null = null;
let isPlaying = false;

/**
 * Gets or creates the AudioContext
 */
const getAudioContext = (): AudioContext => {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext();
  }
  return audioContext;
};

/**
 * Stops any currently playing TTS audio
 */
export const stopTTSAudio = (): void => {
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
 * Mutes or unmutes the original speaker audio
 */
export const setOriginalSpeakerMuted = (muted: boolean): void => {
  const SETTINGS = window.meetingClientSettings;
  const MEDIA_TAG = SETTINGS?.public?.media?.mediaTag?.replace(/#/g, '') || 'remoteMediaVideo';
  const mediaElement = document.getElementById(MEDIA_TAG) as HTMLMediaElement | null;

  if (mediaElement) {
    // Store original volume if muting
    if (muted && !mediaElement.dataset.ttsOriginalVolume) {
      mediaElement.dataset.ttsOriginalVolume = String(mediaElement.volume);
    }

    if (muted) {
      mediaElement.volume = 0;
      logger.debug({ logCode: 'tts_original_speaker_muted' }, 'Original speaker muted for TTS');
    } else {
      // Restore original volume
      const originalVolume = mediaElement.dataset.ttsOriginalVolume;
      mediaElement.volume = originalVolume ? parseFloat(originalVolume) : 1;
      delete mediaElement.dataset.ttsOriginalVolume;
      logger.debug({ logCode: 'tts_original_speaker_unmuted' }, 'Original speaker unmuted');
    }
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
 * Plays audio buffer using Web Audio API
 */
const playAudioBuffer = async (audioBuffer: ArrayBuffer): Promise<void> => {
  const ctx = getAudioContext();

  // Resume context if suspended (due to browser autoplay policies)
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  // Decode audio data
  const decodedAudio = await ctx.decodeAudioData(audioBuffer);

  // Stop any currently playing audio
  stopTTSAudio();

  // Create and configure source
  const source = ctx.createBufferSource();
  source.buffer = decodedAudio;
  source.connect(ctx.destination);

  // Track playback state
  currentAudioSource = source;
  isPlaying = true;

  source.onended = () => {
    isPlaying = false;
    currentAudioSource = null;
  };

  source.start(0);
};

/**
 * Main function to speak text using TTS
 * Handles fetching, muting original speaker, and playback
 */
export const speakText = async (text: string, locale: string): Promise<boolean> => {
  if (!text.trim()) {
    return false;
  }

  logger.info({
    logCode: 'tts_speak_request',
    extraInfo: { text: text.substring(0, 50), locale },
  }, 'TTS speak request');

  // Stop any previous TTS audio (interruption)
  stopTTSAudio();

  // Fetch audio from server
  const audioBuffer = await fetchTTSAudio(text, locale);

  if (!audioBuffer) {
    return false;
  }

  try {
    // Mute original speaker
    setOriginalSpeakerMuted(true);

    // Play the TTS audio
    await playAudioBuffer(audioBuffer);

    logger.info({ logCode: 'tts_speak_success' }, 'TTS audio playing');
    return true;
  } catch (error) {
    logger.error({
      logCode: 'tts_play_error',
      extraInfo: { errorMessage: (error as Error).message },
    }, 'Failed to play TTS audio');
    return false;
  }
};

/**
 * Checks if TTS is currently playing
 */
export const isTTSPlaying = (): boolean => isPlaying;

/**
 * Checks if TTS service is available
 */
export const checkTTSAvailability = async (): Promise<boolean> => {
  try {
    const endpoint = getTTSEndpoint().replace('/tts', '/tts/health');
    const response = await fetch(endpoint);
    const data = await response.json();
    return data.enabled === true;
  } catch {
    return false;
  }
};

export default {
  speakText,
  stopTTSAudio,
  setOriginalSpeakerMuted,
  isTTSPlaying,
  checkTTSAvailability,
};
