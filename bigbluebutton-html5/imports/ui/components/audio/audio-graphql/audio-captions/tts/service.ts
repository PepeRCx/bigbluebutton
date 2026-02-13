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
const getTTSEndpoint = (): string => {
  // Use relative URL - nginx will proxy to bbb-graphql-actions
  return '/tts';
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

// Volume control state
let ttsGainNode: GainNode | null = null;
let currentTTSVolume: number = 1;
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
    const response = await fetch('/tts/health');
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
  setOriginalSpeakerVolumeValue,
  updateOriginalSpeakerVolume,
  setTTSVolumeValue,
  restoreOriginalSpeakerVolume,
  isTTSPlaying,
  checkTTSAvailability,
};
