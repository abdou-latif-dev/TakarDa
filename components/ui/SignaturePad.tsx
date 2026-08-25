import { useRef, useState } from 'react';
import { PanResponder, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LabelText } from './Typography';
import { Colors } from '@/constants/theme';

interface SignaturePadProps {
  onChange: (signed: boolean) => void;
  height?: number;
}

/** Lightweight hand-drawn signature capture — no external signature library. */
export function SignaturePad({ onChange, height = 160 }: SignaturePadProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const currentPath = useRef('');

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        currentPath.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        currentPath.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        setPaths((prev) => [...prev.slice(0, -1), currentPath.current]);
      },
      onPanResponderRelease: () => {
        setPaths((prev) => {
          const next = [...prev, currentPath.current];
          onChange(next.filter(Boolean).length > 0);
          return next;
        });
        currentPath.current = '';
      },
    }),
  ).current;

  const clear = () => {
    setPaths([]);
    onChange(false);
  };

  return (
    <View className="gap-2">
      <View
        {...panResponder.panHandlers}
        style={{ height }}
        className="items-center justify-center rounded-md border border-dashed border-border bg-background-secondary">
        <Svg width="100%" height="100%">
          {paths.map((d, i) => (
            <Path key={i} d={d} stroke={Colors.textPrimary} strokeWidth={2} fill="none" strokeLinecap="round" />
          ))}
        </Svg>
        {paths.length === 0 && <LabelText className="absolute">Signez ici</LabelText>}
      </View>
      {paths.length > 0 && (
        <Pressable onPress={clear} hitSlop={8} className="self-end">
          <LabelText className="font-inter-semibold text-primary">Effacer</LabelText>
        </Pressable>
      )}
    </View>
  );
}
