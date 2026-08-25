import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { Colors } from '@/constants/theme';

const CORNER = 'absolute h-8 w-8 border-primary';

/** Animated camera overlay: 4 corner brackets + a sweeping scan line. Purely decorative — the real scan happens via CameraView's onBarcodeScanned. */
export function ScanFrame({ size = 280 }: { size?: number }) {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, { toValue: size - 4, duration: 1800, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [size, translateY]);

  return (
    <View style={{ width: size, height: size }}>
      <View className={`${CORNER} left-0 top-0 rounded-tl-md border-l-4 border-t-4`} />
      <View className={`${CORNER} right-0 top-0 rounded-tr-md border-r-4 border-t-4`} />
      <View className={`${CORNER} bottom-0 left-0 rounded-bl-md border-b-4 border-l-4`} />
      <View className={`${CORNER} bottom-0 right-0 rounded-br-md border-b-4 border-r-4`} />
      <Animated.View
        style={{
          position: 'absolute',
          left: 4,
          right: 4,
          height: 2,
          backgroundColor: Colors.primary,
          shadowColor: Colors.primary,
          shadowOpacity: 0.8,
          shadowRadius: 8,
          transform: [{ translateY }],
        }}
      />
    </View>
  );
}
