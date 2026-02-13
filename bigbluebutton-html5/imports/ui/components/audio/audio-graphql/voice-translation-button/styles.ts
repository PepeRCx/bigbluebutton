import styled from 'styled-components';
import Button from '/imports/ui/components/common/button/component';
import {
  colorWhite,
  colorPrimary,
  colorOffWhite,
} from '/imports/ui/stylesheets/styled-components/palette';

interface ButtonProps {
  active: boolean;
}

// @ts-ignore - as button comes from JS, we can't provide its props
const VoiceTranslationToggleButton = styled(Button)`
  ${({ ghost }) => ghost && `
    span {
      box-shadow: none;
      background-color: transparent !important;
      border-color: ${colorWhite} !important;
    }
    i {
      margin-top: .4rem;
    }
  `}
`;

const SpanButtonWrapper = styled.span<ButtonProps>`
  position: relative;
  ${({ active }) => !active && `
    i {
      bottom: -.2em;
    }
  `}
`;

const TitleLabel = {
  fontWeight: 'bold',
  opacity: 1,
};

const SelectedLabel = {
  color: colorPrimary,
  backgroundColor: colorOffWhite,
};

const SliderLabel = {
  fontWeight: '500',
  opacity: 0.9,
  paddingTop: '0.5rem',
};

const VolumeControlsSection = styled.div`
  padding: 0.5rem 1rem 1rem;
  border-top: 1px solid rgba(0, 0, 0, 0.12);
`;

const VolumeLabel = styled.div`
  font-size: 0.875rem;
  font-weight: 500;
  opacity: 0.9;
  padding: 0.5rem 0 0.25rem;
`;

export default {
  VoiceTranslationToggleButton,
  SpanButtonWrapper,
  TitleLabel,
  SelectedLabel,
  SliderLabel,
  VolumeControlsSection,
  VolumeLabel,
};
