import { useEffect, useRef } from 'react';
import { Animated, Pressable } from 'react-native';
import { Colors } from '@/constants/theme';

/**
 * iOS-style toggle — 51x31, knob slides on an orange track when on.
 * Built on React Native's core Animated API rather than Reanimated: this
 * control is used deep in settings screens, not worth pulling in a
 * version-sensitive native module for a single color/position tween.
 */
export function Switch({ value, onValueChange }: { value: boolean; onValueChange: (v: boolean) => void }) {
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: value ? 1 : 0, duration: 150, useNativeDriver: false }).start();
  }, [value, progress]);

  // Colors.surfaceContainerHigh (not a hardcoded gray) so the "off" track
  // follows the current theme instead of staying light-gray forever in dark
  // mode — Colors is kept in sync with the active scheme by app/_layout.tsx,
  // so re-reading it on every render (interpolate() is cheap) is enough,
  // no extra subscription needed here.
  const trackColor = progress.interpolate({ inputRange: [0, 1], outputRange: [Colors.surfaceContainerHigh, Colors.primary] });
  const knobTranslate = progress.interpolate({ inputRange: [0, 1], outputRange: [2, 20] });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
      hitSlop={8}>
      <Animated.View style={{ width: 51, height: 31, borderRadius: 16, padding: 2, backgroundColor: trackColor }}>
        <Animated.View
          style={{
            width: 27,
            height: 27,
            borderRadius: 14,
            backgroundColor: '#FFFFFF',
            transform: [{ translateX: knobTranslate }],
          }}
        />
      </Animated.View>
    </Pressable>
  );
}
