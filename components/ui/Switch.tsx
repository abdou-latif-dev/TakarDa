import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Colors } from '@/constants/theme';

const AnimatedView = Animated.createAnimatedComponent(View);

/** iOS-style toggle — 51x31, knob slides on an orange track when on. */
export function Switch({ value, onValueChange }: { value: boolean; onValueChange: (v: boolean) => void }) {
  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(value ? Colors.primary : '#E5E5EA', { duration: 150 }),
  }));
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(value ? 20 : 2, { duration: 150 }) }],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onValueChange(!value)}
      hitSlop={8}>
      <AnimatedView style={[{ width: 51, height: 31, borderRadius: 16, padding: 2 }, trackStyle]}>
        <AnimatedView
          style={[{ width: 27, height: 27, borderRadius: 14, backgroundColor: '#FFFFFF' }, knobStyle]}
        />
      </AnimatedView>
    </Pressable>
  );
}
