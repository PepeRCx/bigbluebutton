import React, { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useMutation } from '@apollo/client';
import { layoutSelect } from '/imports/ui/components/layout/context';
import { Layout } from '/imports/ui/components/layout/layoutTypes';
import useCurrentUser from '/imports/ui/core/hooks/useCurrentUser';
import useMeeting from '/imports/ui/core/hooks/useMeeting';
import ButtonEmoji from '/imports/ui/components/common/button/button-emoji/ButtonEmoji';
import BBBMenu from '/imports/ui/components/common/menu/component';
import useVoiceTranslationEnable, { setVoiceTranslationEnable } from '/imports/ui/core/local-states/useVoiceTranslationEnable';
import useAudioCaptionEnable from '/imports/ui/core/local-states/useAudioCaptionEnable';
import useTTSVolume, { setTTSVolume } from '/imports/ui/core/local-states/useTTSVolume';
import useOriginalSpeakerVolume, { setOriginalSpeakerVolume } from '/imports/ui/core/local-states/useOriginalSpeakerVolume';
import { SET_CAPTION_LOCALE } from '/imports/ui/core/graphql/mutations/userMutations';
import { setUserLocaleProperty } from '../audio-captions/service';
import { checkTTSAvailability } from '../audio-captions/tts/service';
import VolumeSlider from './volume-slider/component';
import Styled from './styles';
import { MenuOptionItemType, MenuSeparatorItemType } from '/imports/ui/components/common/menu/menuTypes';

type MenuAction = MenuOptionItemType | MenuSeparatorItemType;

const TRANSLATION_LANGUAGES = [
  { locale: 'en-US', name: 'English' },
  { locale: 'es-ES', name: 'Español' },
  { locale: 'pt-BR', name: 'Português' },
  { locale: 'de-DE', name: 'Deutsch' },
  { locale: 'fr-FR', name: 'Français' },
];

const intlMessages = defineMessages({
  voiceTranslation: {
    id: 'app.audio.voiceTranslation.button.label',
    description: 'Voice translation button label',
  },
  voiceTranslationSettings: {
    id: 'app.audio.voiceTranslation.button.settings',
    description: 'Voice translation settings label',
  },
  enableVoiceTranslation: {
    id: 'app.audio.voiceTranslation.enable',
    description: 'Enable voice translation',
  },
  disableVoiceTranslation: {
    id: 'app.audio.voiceTranslation.disable',
    description: 'Disable voice translation',
  },
  translateTo: {
    id: 'app.audio.voiceTranslation.translateTo',
    description: 'Translate to language header',
  },
  originalSpeakerVolume: {
    id: 'app.audio.voiceTranslation.originalSpeakerVolume',
    description: 'Original speaker volume label',
  },
  ttsVoiceVolume: {
    id: 'app.audio.voiceTranslation.ttsVoiceVolume',
    description: 'TTS voice volume label',
  },
  on: {
    id: 'app.switch.onLabel',
  },
  off: {
    id: 'app.switch.offLabel',
  },
});

interface VoiceTranslationButtonProps {
  isRTL: boolean;
  currentCaptionLocale: string;
}

const VoiceTranslationButton: React.FC<VoiceTranslationButtonProps> = ({
  isRTL,
  currentCaptionLocale,
}) => {
  const intl = useIntl();
  const [voiceTranslationEnabled] = useVoiceTranslationEnable();
  const [audioCaptionsEnabled] = useAudioCaptionEnable();
  const [ttsVolume] = useTTSVolume();
  const [originalVolume] = useOriginalSpeakerVolume();
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [setCaptionLocaleMutation] = useMutation(SET_CAPTION_LOCALE);

  const selectedLocale = currentCaptionLocale || 'en-US';

  useEffect(() => {
    checkTTSAvailability().then(setTtsAvailable);
  }, []);

  const setUserCaptionLocale = (captionLocale: string, provider: string) => {
    setCaptionLocaleMutation({
      variables: {
        locale: captionLocale,
        provider,
      },
    });
  };

  const handleToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVoiceTranslationEnable(!voiceTranslationEnabled);
  };

  const handleLanguageSelect = (locale: string) => {
    setUserLocaleProperty(locale, setUserCaptionLocale);
  };

  const getMenuActions = (): MenuAction[] => {
    const actions: MenuAction[] = [
      {
        icon: voiceTranslationEnabled ? 'speak_louder' : 'listen',
        label: voiceTranslationEnabled
          ? intl.formatMessage(intlMessages.disableVoiceTranslation)
          : intl.formatMessage(intlMessages.enableVoiceTranslation),
        key: 'voice-translation-toggle',
        iconRight: voiceTranslationEnabled ? 'check' : undefined,
        customStyles: voiceTranslationEnabled ? Styled.SelectedLabel : undefined,
        onClick: () => {
          setVoiceTranslationEnable(!voiceTranslationEnabled);
        },
      },
      {
        key: 'separator-after-toggle',
        isSeparator: true,
      },
      {
        key: 'translateToHeader',
        label: intl.formatMessage(intlMessages.translateTo),
        customStyles: Styled.TitleLabel,
        disabled: true,
      },
      {
        key: 'separator-language-start',
        isSeparator: true,
      },
    ];

    TRANSLATION_LANGUAGES.forEach((lang) => {
      actions.push({
        icon: '',
        label: lang.name,
        key: `lang-${lang.locale}`,
        iconRight: selectedLocale === lang.locale ? 'check' : undefined,
        customStyles: selectedLocale === lang.locale ? Styled.SelectedLabel : undefined,
        onClick: () => {
          handleLanguageSelect(lang.locale);
        },
      });
    });

    return actions;
  };

  const renderVolumeControls = () => {
    if (!voiceTranslationEnabled) return null;

    return (
      <Styled.VolumeControlsSection>
        <Styled.VolumeLabel>
          {intl.formatMessage(intlMessages.originalSpeakerVolume)}
        </Styled.VolumeLabel>
        <VolumeSlider
          value={originalVolume}
          onChange={(v: number) => setOriginalSpeakerVolume(v)}
          label={intl.formatMessage(intlMessages.originalSpeakerVolume)}
        />
        <Styled.VolumeLabel>
          {intl.formatMessage(intlMessages.ttsVoiceVolume)}
        </Styled.VolumeLabel>
        <VolumeSlider
          value={ttsVolume}
          onChange={(v: number) => setTTSVolume(v)}
          label={intl.formatMessage(intlMessages.ttsVoiceVolume)}
        />
      </Styled.VolumeControlsSection>
    );
  };

  const buttonIcon = voiceTranslationEnabled ? 'speak_louder' : 'listen';

  const voiceTranslationButton = (
    <Styled.VoiceTranslationToggleButton
      active={voiceTranslationEnabled}
      icon={buttonIcon}
      label={intl.formatMessage(intlMessages.voiceTranslation)}
      color={voiceTranslationEnabled ? 'primary' : 'default'}
      hideLabel
      circle
      size="lg"
      onClick={handleToggleClick}
      data-test="voiceTranslationButton"
    />
  );

  if (!ttsAvailable || !audioCaptionsEnabled) {
    return null;
  }

  return (
    <Styled.SpanButtonWrapper active={voiceTranslationEnabled}>
      <BBBMenu
        trigger={(
          <>
            {voiceTranslationButton}
            <ButtonEmoji
              emoji="device_list_selector"
              hideLabel
              label={intl.formatMessage(intlMessages.voiceTranslationSettings)}
              tabIndex={0}
              rotate
            />
          </>
        )}
        actions={getMenuActions()}
        renderOtherComponents={renderVolumeControls()}
        opts={{
          id: 'voice-translation-dropdown-menu',
          keepMounted: true,
          transitionDuration: 0,
          elevation: 3,
          getcontentanchorel: null,
          fullwidth: 'true',
          anchorOrigin: { vertical: 'top', horizontal: isRTL ? 'right' : 'left' },
          transformOrigin: { vertical: 'bottom', horizontal: isRTL ? 'right' : 'left' },
        }}
        keepOpen
      />
    </Styled.SpanButtonWrapper>
  );
};

const VoiceTranslationButtonContainer: React.FC = () => {
  const isRTL = layoutSelect((i: Layout) => i.isRTL);
  const {
    data: currentUser,
    loading: currentUserLoading,
  } = useCurrentUser((user) => ({
    captionLocale: user.captionLocale,
  }));

  const {
    data: currentMeetingData,
    loading: currentMeetingLoading,
  } = useMeeting((m) => ({
    componentsFlags: m.componentsFlags,
  }));

  if (currentUserLoading || currentMeetingLoading) return null;
  if (!currentUser || !currentMeetingData) return null;
  if (!currentMeetingData?.componentsFlags?.hasCaption) return null;

  const currentCaptionLocale = currentUser.captionLocale || '';

  return (
    <VoiceTranslationButton
      isRTL={isRTL}
      currentCaptionLocale={currentCaptionLocale}
    />
  );
};

export default VoiceTranslationButtonContainer;
