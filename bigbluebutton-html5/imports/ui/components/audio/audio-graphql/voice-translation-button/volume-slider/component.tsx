import React from 'react';
import Icon from '/imports/ui/components/common/icon/component';
import Styled from './styles';

interface VolumeSliderProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  disabled?: boolean;
}

const getVolumeIcon = (volume: number): string => {
  if (volume === 0) return 'volume_off';
  if (volume < 0.33) return 'volume_level_0';
  if (volume < 0.66) return 'volume_level_1';
  return 'volume_level_2';
};

const VolumeSlider: React.FC<VolumeSliderProps> = ({
  value,
  onChange,
  label,
  disabled = false,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    onChange(newValue);
  };

  const percentage = Math.round(value * 100);

  return (
    <Styled.SliderContainer>
      <Styled.VolumeIcon>
        <Icon iconName={getVolumeIcon(value)} />
      </Styled.VolumeIcon>
      <Styled.SliderWrapper>
        <Styled.Slider
          type="range"
          min="0"
          max="1"
          step="0.02"
          value={value}
          onChange={handleChange}
          disabled={disabled}
          aria-label={label}
        />
      </Styled.SliderWrapper>
      <Styled.VolumePercentage>
        {percentage}%
      </Styled.VolumePercentage>
    </Styled.SliderContainer>
  );
};

export default VolumeSlider;
