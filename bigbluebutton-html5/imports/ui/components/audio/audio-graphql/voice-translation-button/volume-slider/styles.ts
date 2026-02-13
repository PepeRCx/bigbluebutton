import styled from 'styled-components';
import {
  colorGrayLight,
  colorPrimary,
  colorText,
} from '/imports/ui/stylesheets/styled-components/palette';

const SliderContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  width: 100%;
  min-width: 200px;
  user-select: none;
  -webkit-user-select: none;
`;

const VolumeIcon = styled.span`
  color: ${colorText};
  font-size: 1rem;
  width: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const SliderWrapper = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
`;

const Slider = styled.input`
  -webkit-appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: ${colorGrayLight};
  outline: none;
  cursor: pointer;
  pointer-events: auto;
  touch-action: none;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${colorPrimary};
    cursor: grab;
    transition: transform 0.1s ease-in-out;
    pointer-events: auto;

    &:active {
      cursor: grabbing;
      transform: scale(1.1);
    }

    &:hover {
      transform: scale(1.1);
    }
  }

  &::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: ${colorPrimary};
    cursor: grab;
    border: none;
    transition: transform 0.1s ease-in-out;
    pointer-events: auto;

    &:active {
      cursor: grabbing;
      transform: scale(1.1);
    }

    &:hover {
      transform: scale(1.1);
    }
  }

  &::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
  }

  &::-moz-range-track {
    height: 4px;
    border-radius: 2px;
    background: ${colorGrayLight};
  }
`;

const VolumePercentage = styled.span`
  color: ${colorText};
  font-size: 0.875rem;
  min-width: 2.5rem;
  text-align: right;
`;

export default {
  SliderContainer,
  VolumeIcon,
  SliderWrapper,
  Slider,
  VolumePercentage,
};
