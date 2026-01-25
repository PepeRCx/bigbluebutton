import React, { useEffect, useRef } from 'react';
import { layoutSelect } from '/imports/ui/components/layout/context';
import { Layout } from '/imports/ui/components/layout/layoutTypes';
import useCurrentUser from '/imports/ui/core/hooks/useCurrentUser';
import ButtonEmoji from '/imports/ui/components/common/button/button-emoji/ButtonEmoji';
import BBBMenu from '/imports/ui/components/common/menu/component';
import { defineMessages, useIntl } from 'react-intl';
import { useMutation } from '@apollo/client';
import Styled from './styles';
import {
  setAudioCaptions, setUserLocaleProperty,
} from '../service';
import { MenuSeparatorItemType, MenuOptionItemType } from '/imports/ui/components/common/menu/menuTypes';
import useAudioCaptionEnable from '/imports/ui/core/local-states/useAudioCaptionEnable';
import { User } from '/imports/ui/Types/user';
import { SET_CAPTION_LOCALE, SET_SPEAKING_LANGUAGE } from '/imports/ui/core/graphql/mutations/userMutations';
import useMeeting from '/imports/ui/core/hooks/useMeeting';
import { ActiveCaptionsResponse, getactiveCaptions } from './queries';
import AudioCaptionsService from '/imports/ui/components/audio/audio-graphql/audio-captions/service';
import useDeduplicatedSubscription from '/imports/ui/core/hooks/useDeduplicatedSubscription';
import { TRANSCRIPTION_LOCALE } from '/imports/ui/components/audio/audio-graphql/audio-captions/transcriptionLocale';

// Supported languages for translation
const TRANSLATION_LANGUAGES = [
  { locale: 'en-US', name: 'English' },
  { locale: 'es-ES', name: 'Español' },
  { locale: 'pt-BR', name: 'Português' },
  { locale: 'de-DE', name: 'Deutsch' },
  { locale: 'fr-FR', name: 'Français' },
];

const messages: { [key: string]: { id: string; description?: string } } = {
  start: {
    id: 'app.audio.captions.button.start',
    description: 'Start audio captions',
  },
  stop: {
    id: 'app.audio.captions.button.stop',
    description: 'Stop audio captions',
  },
  transcriptionSettings: {
    id: 'app.audio.captions.button.transcriptionSettings',
    description: 'Audio captions settings modal',
  },
  transcription: {
    id: 'app.audio.captions.button.transcription',
    description: 'Audio speech transcription label',
  },
  transcriptionOn: {
    id: 'app.switch.onLabel',
  },
  transcriptionOff: {
    id: 'app.switch.offLabel',
  },
  language: {
    id: 'app.audio.captions.button.language',
    description: 'Audio speech recognition language label',
  },
  autoDetect: {
    id: 'app.audio.captions.button.autoDetect',
    description: 'Audio speech recognition language auto detect',
  },
  iSpeak: {
    id: 'app.audio.captions.button.iSpeak',
    description: 'I speak language selector label',
  },
  showCaptionsIn: {
    id: 'app.audio.captions.button.showCaptionsIn',
    description: 'Show captions in language selector label',
  },
};

Object.keys(TRANSCRIPTION_LOCALE).forEach((key: string) => {
  const localeKey = TRANSCRIPTION_LOCALE[key as keyof typeof TRANSCRIPTION_LOCALE];
  messages[localeKey] = {
    id: `app.audio.captions.select.${localeKey}`,
    description: `Audio speech recognition ${key} language`,
  };
});

const intlMessages = defineMessages(messages);

interface AudioCaptionsButtonProps {
  isRTL: boolean;
  availableVoices: string[];
  currentCaptionLocale: string;
  currentSpeakingLanguage: string;
  isSupported: boolean;
}

const DISABLED = '';

const AudioCaptionsButton: React.FC<AudioCaptionsButtonProps> = ({
  isRTL,
  currentCaptionLocale,
  currentSpeakingLanguage,
  availableVoices,
  isSupported,
}) => {
  const knownLocales = window.meetingClientSettings.public.captions.locales;
  const PROVIDER = window.meetingClientSettings.public.app.audioCaptions.provider;

  const intl = useIntl();
  const [active] = useAudioCaptionEnable();
  const [setCaptionLocaleMutation] = useMutation(SET_CAPTION_LOCALE);
  const [setSpeakingLanguageMutation] = useMutation(SET_SPEAKING_LANGUAGE);

  const setUserCaptionLocale = (captionLocale: string, provider: string) => {
    setCaptionLocaleMutation({
      variables: {
        locale: captionLocale,
        provider,
      },
    });
  };

  const setUserSpeakingLanguage = (locale: string) => {
    setSpeakingLanguageMutation({
      variables: {
        locale,
      },
    });
  };

  const isCaptionLocaleSet = () => currentCaptionLocale === DISABLED;
  const fallbackLocale = availableVoices.includes(navigator.language)
    ? navigator.language
    : 'en-US';

  const getSelectedLocaleValue = isCaptionLocaleSet()
    ? fallbackLocale
    : currentCaptionLocale;

  const selectedCaptionLocale = useRef(getSelectedLocaleValue);
  const selectedSpeakingLanguage = useRef(currentSpeakingLanguage || 'en-US');

  useEffect(() => {
    if (!isCaptionLocaleSet()) selectedCaptionLocale.current = getSelectedLocaleValue;
  }, [currentCaptionLocale]);

  useEffect(() => {
    if (currentSpeakingLanguage) selectedSpeakingLanguage.current = currentSpeakingLanguage;
  }, [currentSpeakingLanguage]);

  const shouldRenderChevron = isSupported;
  const shouldRenderSelector = isSupported && availableVoices.length > 0;

  const isAudioTranscriptionEnabled = AudioCaptionsService.useIsAudioTranscriptionEnabled();

  // Build "I speak" language options
  const getSpeakingLanguageOptions = (): (MenuOptionItemType | MenuSeparatorItemType)[] => {
    return TRANSLATION_LANGUAGES.map((lang) => ({
      icon: '',
      label: lang.name,
      key: `speak-${lang.locale}`,
      iconRight: selectedSpeakingLanguage.current === lang.locale ? 'check' : null,
      customStyles: (selectedSpeakingLanguage.current === lang.locale) && Styled.SelectedLabel,
      onClick: () => {
        selectedSpeakingLanguage.current = lang.locale;
        setUserSpeakingLanguage(lang.locale);
      },
    }));
  };

  // Build "Show captions in" language options
  const getCaptionLanguageOptions = (): (MenuOptionItemType | MenuSeparatorItemType)[] => {
    return TRANSLATION_LANGUAGES.map((lang) => ({
      icon: '',
      label: lang.name,
      key: `caption-${lang.locale}`,
      iconRight: selectedCaptionLocale.current === lang.locale ? 'check' : null,
      customStyles: (selectedCaptionLocale.current === lang.locale) && Styled.SelectedLabel,
      onClick: () => {
        selectedCaptionLocale.current = lang.locale;
        setUserLocaleProperty(lang.locale, setUserCaptionLocale);
      },
    }));
  };

  const autoLanguage = AudioCaptionsService.isGladia() ? {
    icon: '',
    label: intl.formatMessage(intlMessages.autoDetect),
    key: 'auto',
    iconRight: selectedCaptionLocale.current === 'auto' ? 'check' : null,
    customStyles: (selectedCaptionLocale.current === 'auto') && Styled.SelectedLabel,
    disabled: !isAudioTranscriptionEnabled,
    dividerTop: true,
    onClick: () => {
      selectedCaptionLocale.current = 'auto';
      AudioCaptionsService.setSpeechLocale(selectedCaptionLocale.current, setUserCaptionLocale);
    },
  } : undefined;

  const getAvailableLocales = () => {
    let indexToInsertSeparator = -1;
    const availableVoicesObjectToMenu: (MenuOptionItemType | MenuSeparatorItemType)[] = availableVoices
      .filter((availableVoice) => availableVoice !== 'auto' && availableVoice !== '')
      .map((availableVoice: string, index: number) => {
        if (availableVoice === availableVoices[0]) {
          indexToInsertSeparator = index;
        }

        const label = intlMessages[availableVoice as keyof typeof intlMessages]
          ? intl.formatMessage(intlMessages[availableVoice as keyof typeof intlMessages])
          : AudioCaptionsService.getLocaleName(availableVoice);

        return (
          {
            icon: '',
            label,
            key: availableVoice,
            iconRight: selectedCaptionLocale.current === availableVoice ? 'check' : null,
            customStyles: (selectedCaptionLocale.current === availableVoice) && Styled.SelectedLabel,
            disabled: !isAudioTranscriptionEnabled,
            dividerTop: !AudioCaptionsService.isGladia() && availableVoice === availableVoices[0],
            onClick: () => {
              selectedCaptionLocale.current = availableVoice;
              setUserLocaleProperty(selectedCaptionLocale.current, setUserCaptionLocale);
            },
          }
        );
      });
    if (indexToInsertSeparator >= 0) {
      availableVoicesObjectToMenu.splice(indexToInsertSeparator, 0, {
        key: 'separator-01',
        isSeparator: true,
      });
    }
    return [
      ...availableVoicesObjectToMenu,
    ];
  };

  const getAvailableCaptions = () => {
    return availableVoices.map((caption) => {
      const localeName = knownLocales ? knownLocales.find((l) => l.locale === caption)?.name : 'en';

      return localeName !== '' ? {
        key: caption,
        label: localeName,
        customStyles: (selectedCaptionLocale.current === caption) && Styled.SelectedLabel,
        iconRight: selectedCaptionLocale.current === caption ? 'check' : null,
        onClick: () => {
          selectedCaptionLocale.current = caption;
          setUserLocaleProperty(selectedCaptionLocale.current, setUserCaptionLocale);
        },
      } : null;
    });
  };

  const getAvailableLocalesList = () => {
    // Build menu with two sections: "I speak" and "Show captions in"
    const menuItems: (MenuOptionItemType | MenuSeparatorItemType | undefined)[] = [
      // "I speak" section header
      {
        key: 'iSpeakHeader',
        label: intl.formatMessage(intlMessages.iSpeak),
        customStyles: Styled.TitleLabel,
        disabled: true,
      },
      {
        key: 'separator-speak-start',
        isSeparator: true,
      },
      ...getSpeakingLanguageOptions(),
      // "Show captions in" section header
      {
        key: 'showCaptionsInHeader',
        label: intl.formatMessage(intlMessages.showCaptionsIn),
        customStyles: Styled.TitleLabel,
        disabled: true,
      },
      {
        key: 'separator-caption-start',
        isSeparator: true,
      },
      ...getCaptionLanguageOptions(),
    ];

    // Add transcription section for audio captions
    if (shouldRenderChevron) {
      menuItems.push(
        {
          key: 'transcriptionHeader',
          label: intl.formatMessage(intlMessages.transcription),
          customStyles: Styled.TitleLabel,
          disabled: true,
        },
        {
          key: 'separator-transcription',
          isSeparator: true,
        },
      );
      if (autoLanguage) {
        menuItems.push(autoLanguage);
      }
      menuItems.push(...getAvailableLocales());
    }

    return menuItems.filter((e) => e);
  };

  const onToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentCaptionLocale && !active) {
      setUserCaptionLocale(availableVoices[0] || 'en-US', PROVIDER);
    }
    setAudioCaptions(!active);
  };

  const startStopCaptionsButton = (
    <Styled.ClosedCaptionToggleButton
      active={active}
      icon={active ? 'closed_caption' : 'closed_caption_stop'}
      label={intl.formatMessage(active ? intlMessages.stop : intlMessages.start)}
      color={active ? 'primary' : 'default'}
      hideLabel
      circle
      size="lg"
      onClick={onToggleClick}
    />
  );

  return (
    shouldRenderChevron || shouldRenderSelector
      ? (
        <Styled.SpanButtonWrapper active={active}>
          <BBBMenu
            trigger={(
              <>
                { startStopCaptionsButton }
                <ButtonEmoji
                  emoji="device_list_selector"
                  hideLabel
                  label={intl.formatMessage(intlMessages.transcriptionSettings)}
                  tabIndex={0}
                  rotate
                />
              </>
            )}
            actions={getAvailableLocalesList()}
            opts={{
              id: 'default-dropdown-menu',
              keepMounted: true,
              transitionDuration: 0,
              elevation: 3,
              getcontentanchorel: null,
              fullwidth: 'true',
              anchorOrigin: { vertical: 'top', horizontal: isRTL ? 'right' : 'left' },
              transformOrigin: { vertical: 'bottom', horizontal: isRTL ? 'right' : 'left' },
            }}
          />
        </Styled.SpanButtonWrapper>
      ) : startStopCaptionsButton
  );
};

const AudioCaptionsButtonContainer: React.FC = () => {
  const isRTL = layoutSelect((i: Layout) => i.isRTL);
  const {
    data: currentUser,
    loading: currentUserLoading,
  } = useCurrentUser(
    (user: Partial<User>) => ({
      captionLocale: user.captionLocale,
      voice: user.voice,
      speechLocale: user.speechLocale,
      speakingLanguage: user.speakingLanguage,
    }),
  );

  const {
    data: currentMeetingData,
    loading: currentMeetingLoading,
  } = useMeeting((m) => ({
    componentsFlags: m.componentsFlags,
  }));

  const {
    data: activeCaptionsData,
    loading: activeCaptionsLoading,
  } = useDeduplicatedSubscription<ActiveCaptionsResponse>(getactiveCaptions);

  if (currentUserLoading) return null;
  if (currentMeetingLoading) return null;
  if (activeCaptionsLoading) return null;
  if (!currentUser) return null;
  if (!currentMeetingData) return null;
  if (!activeCaptionsData) return null;

  const availableVoices = activeCaptionsData.caption_activeLocales.map((caption) => caption.locale);
  const currentCaptionLocale = currentUser.captionLocale || '';
  const currentSpeakingLanguage = currentUser.speakingLanguage || 'en-US';
  const isSupported = availableVoices.length > 0;

  if (!currentMeetingData?.componentsFlags?.hasCaption) return null;

  return (
    <AudioCaptionsButton
      isRTL={isRTL}
      availableVoices={availableVoices}
      currentCaptionLocale={currentCaptionLocale}
      currentSpeakingLanguage={currentSpeakingLanguage}
      isSupported={isSupported}
    />
  );
};

export default AudioCaptionsButtonContainer;
