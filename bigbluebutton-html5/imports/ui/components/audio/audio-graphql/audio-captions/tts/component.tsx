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
  clearTTSQueue,
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

  const processedCaptionIdsRef = useRef<Set<string>>(new Set());
  const skipCurrentSnapshotRef = useRef<boolean>(true);
  const previousCaptionLocaleRef = useRef<string>(captionLocale);

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

    if (skipCurrentSnapshotRef.current) {
      captionsData.caption.forEach((caption) => {
        if (caption?.captionId) {
          processedCaptionIdsRef.current.add(caption.captionId);
        }
      });
      skipCurrentSnapshotRef.current = false;
      return;
    }

    captionsData.caption.forEach((caption) => {
      if (!caption?.captionId || !caption.captionText) {
        return;
      }

      if (processedCaptionIdsRef.current.has(caption.captionId)) {
        return;
      }

      processedCaptionIdsRef.current.add(caption.captionId);

      logger.debug({
        logCode: 'tts_caption_received',
        extraInfo: {
          captionId: caption.captionId,
          text: caption.captionText.substring(0, 30),
          locale: captionLocale,
        },
      }, 'TTS received new caption');

      void speakText(caption.captionText, captionLocale);
    });
  }, [captionsData, voiceTranslationEnabled, audioCaptionsEnabled, captionLocale]);

  // Handle TTS enable/disable state changes
  useEffect(() => {
    if (voiceTranslationEnabled && audioCaptionsEnabled) {
      // TTS enabled - apply volume settings
      updateOriginalSpeakerVolume(originalSpeakerVolume);
      setTTSVolumeValue(ttsVolume);
      skipCurrentSnapshotRef.current = true;
      logger.info({ logCode: 'tts_enabled' }, 'Voice Translation enabled');
    } else {
      // TTS disabled - stop any playing audio and restore original speaker volume
      clearTTSQueue();
      stopTTSAudio();
      restoreOriginalSpeakerVolume();
      processedCaptionIdsRef.current.clear();
      skipCurrentSnapshotRef.current = true;
      logger.info({ logCode: 'tts_disabled' }, 'Voice Translation disabled');
    }

    // Cleanup on unmount
    return () => {
      clearTTSQueue();
      stopTTSAudio();
      restoreOriginalSpeakerVolume();
      processedCaptionIdsRef.current.clear();
      skipCurrentSnapshotRef.current = true;
    };
  }, [voiceTranslationEnabled, audioCaptionsEnabled]);

  useEffect(() => {
    if (!voiceTranslationEnabled || !audioCaptionsEnabled) {
      previousCaptionLocaleRef.current = captionLocale;
      return;
    }

    if (captionLocale !== previousCaptionLocaleRef.current) {
      clearTTSQueue();
      stopTTSAudio();
      restoreOriginalSpeakerVolume();
      processedCaptionIdsRef.current.clear();
      skipCurrentSnapshotRef.current = true;

      logger.info({
        logCode: 'tts_locale_changed',
        extraInfo: { locale: captionLocale },
      }, 'Voice Translation locale changed');
    }

    previousCaptionLocaleRef.current = captionLocale;
  }, [captionLocale, voiceTranslationEnabled, audioCaptionsEnabled]);

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
