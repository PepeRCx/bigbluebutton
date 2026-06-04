/**
 * Voice Translation (TTS) Controller Component
 *
 * This component monitors caption updates and triggers TTS playback
 * when Voice Translation is enabled. It handles:
 * - Listening to caption subscription updates
 * - Triggering TTS for final captions
 * - Managing original speaker muting state
 */

import React, { useEffect, useRef } from 'react';
import { useSubscription } from '@apollo/client';
import useVoiceTranslationEnable from '/imports/ui/core/local-states/useVoiceTranslationEnable';
import useAudioCaptionEnable from '/imports/ui/core/local-states/useAudioCaptionEnable';
import useTTSVolume from '/imports/ui/core/local-states/useTTSVolume';
import useOriginalSpeakerVolume from '/imports/ui/core/local-states/useOriginalSpeakerVolume';
import useCurrentUser from '/imports/ui/core/hooks/useCurrentUser';
import { GET_CAPTIONS, getCaptions } from '../live/queries';
import {
  speakText,
  stopTTSAudio,
  updateOriginalSpeakerVolume,
  setTTSVolumeValue,
  restoreOriginalSpeakerVolume,
} from './service';
import logger from '/imports/startup/client/logger';

const TTSController: React.FC = () => {
  const [voiceTranslationEnabled] = useVoiceTranslationEnable();
  const [audioCaptionsEnabled] = useAudioCaptionEnable();
  const [ttsVolume] = useTTSVolume();
  const [originalSpeakerVolume] = useOriginalSpeakerVolume();

  const {
    data: currentUser,
  } = useCurrentUser((u) => ({
    captionLocale: u.captionLocale,
    odUserId: u.userId,
  }));

  const currentUserId = currentUser?.odUserId ?? '';
  const captionLocale = currentUser?.captionLocale ?? 'en-US';

  // Track last spoken caption to avoid repeating
  const lastSpokenCaptionId = useRef<string>('');

  // Subscribe to captions when TTS is enabled
  const shouldSubscribe = voiceTranslationEnabled && audioCaptionsEnabled && !!captionLocale;

  const {
    data: captionsData,
  } = useSubscription<getCaptions>(GET_CAPTIONS, {
    variables: {
      locale: captionLocale,
      excludeUserId: currentUserId,
    },
    skip: !shouldSubscribe,
  });

  // Handle caption updates and trigger TTS
  useEffect(() => {
    if (!voiceTranslationEnabled || !audioCaptionsEnabled) {
      return;
    }

    if (!captionsData?.caption || captionsData.caption.length === 0) {
      return;
    }

    // Get the most recent caption
    const latestCaption = captionsData.caption[captionsData.caption.length - 1];

    if (!latestCaption || !latestCaption.captionText) {
      return;
    }

    // Check if this caption was already spoken
    if (latestCaption.captionId === lastSpokenCaptionId.current) {
      return;
    }

    // Speak the caption
    lastSpokenCaptionId.current = latestCaption.captionId;

    logger.debug({
      logCode: 'tts_caption_received',
      extraInfo: {
        captionId: latestCaption.captionId,
        text: latestCaption.captionText.substring(0, 30),
        locale: captionLocale,
      },
    }, 'TTS received new caption');

    speakText(latestCaption.captionText, captionLocale);
  }, [captionsData, voiceTranslationEnabled, audioCaptionsEnabled, captionLocale]);

  // Handle TTS enable/disable state changes
  useEffect(() => {
    if (voiceTranslationEnabled && audioCaptionsEnabled) {
      // TTS enabled - apply volume settings
      updateOriginalSpeakerVolume(originalSpeakerVolume);
      setTTSVolumeValue(ttsVolume);
      logger.info({ logCode: 'tts_enabled' }, 'Voice Translation enabled');
    } else {
      // TTS disabled - stop any playing audio and restore original speaker volume
      stopTTSAudio();
      restoreOriginalSpeakerVolume();
      lastSpokenCaptionId.current = '';
      logger.info({ logCode: 'tts_disabled' }, 'Voice Translation disabled');
    }

    // Cleanup on unmount
    return () => {
      stopTTSAudio();
      restoreOriginalSpeakerVolume();
    };
  }, [voiceTranslationEnabled, audioCaptionsEnabled]);

  // Apply volume changes when sliders are adjusted
  useEffect(() => {
    if (voiceTranslationEnabled && audioCaptionsEnabled) {
      setTTSVolumeValue(ttsVolume);
    }
  }, [ttsVolume, voiceTranslationEnabled, audioCaptionsEnabled]);

  useEffect(() => {
    if (voiceTranslationEnabled && audioCaptionsEnabled) {
      updateOriginalSpeakerVolume(originalSpeakerVolume);
    }
  }, [originalSpeakerVolume, voiceTranslationEnabled, audioCaptionsEnabled]);

  // This component doesn't render anything visible
  return null;
};

export default TTSController;
