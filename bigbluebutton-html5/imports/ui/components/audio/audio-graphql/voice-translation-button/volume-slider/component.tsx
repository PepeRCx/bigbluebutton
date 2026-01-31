import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  if (volume < 0.33) return 'volume_level_1';
  if (volume < 0.66) return 'volume_level_2';
  return 'volume_level_3';
};

const VolumeSlider: React.FC<VolumeSliderProps> = ({
  value,
  onChange,
  label,
  disabled = false,
}) => {
  // Use local state to track value during drag
  const [localValue, setLocalValue] = useState(value);
  const isDragging = useRef(false);
  const pendingValue = useRef(value);

  // Sync local value with prop when not dragging
  useEffect(() => {
    if (!isDragging.current) {
      setLocalValue(value);
      pendingValue.current = value;
    }
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    setLocalValue(newValue);
    pendingValue.current = newValue;
    // Don't call onChange here - wait for drag end to avoid re-renders
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    isDragging.current = true;
  }, []);

  const handleDragEnd = useCallback(() => {
    if (isDragging.current) {
      isDragging.current = false;
      // Commit the value when drag ends
      onChange(pendingValue.current);
    }
  }, [onChange]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // For click (not drag), commit immediately
    onChange(pendingValue.current);
  }, [onChange]);

  const stopPropagation = useCallback((e: React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
    e.stopPropagation();
  }, []);

  const percentage = Math.round(localValue * 100);

  return (
    <Styled.SliderContainer
      onMouseDown={stopPropagation}
      onTouchStart={stopPropagation}
      onPointerDown={stopPropagation}
      onClick={stopPropagation}
    >
      <Styled.VolumeIcon>
        <Icon iconName={getVolumeIcon(localValue)} />
      </Styled.VolumeIcon>
      <Styled.SliderWrapper>
        <Styled.Slider
          type="range"
          min="0"
          max="1"
          step="0.02"
          value={localValue}
          onChange={handleChange}
          onMouseDown={handleDragStart}
          onMouseUp={handleDragEnd}
          onMouseLeave={handleDragEnd}
          onTouchStart={handleDragStart}
          onTouchEnd={handleDragEnd}
          onBlur={handleDragEnd}
          onClick={handleClick}
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
