import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { DisplayText, BodyLgText, LabelText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';

// Deliberately uses React Native's built-in Animated API rather than
// react-native-reanimated: this screen renders before the app has finished
// booting, so it must not depend on the Worklets native runtime being fully
// initialized yet.

function Dot({ delayMs }: { delayMs: number }) {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delayMs),
        Animated.timing(translateY, { toValue: -6, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 300, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [delayMs, translateY]);

  return (
    <Animated.View
      style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, transform: [{ translateY }] }}
    />
  );
}

/** Custom branded splash rendered on top of the native cold-start splash. */
export function SplashView() {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  return (
    <View className="flex-1 items-center justify-center bg-white">
      <Animated.View style={{ opacity, transform: [{ translateY }] }} className="items-center gap-4">
        <View
          className="h-32 w-32 items-center justify-center rounded-xl bg-primary-soft"
          style={{ shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 4 } }}>
          <MaterialIcons name="description" size={56} color={Colors.primary} />
        </View>
        <DisplayText className="mt-2">FormEase</DisplayText>
        <BodyLgText className="text-text-secondary">Vos données. Vos processus. Simplifiés.</BodyLgText>
      </Animated.View>

      <View className="absolute bottom-16 items-center gap-3">
        <View className="flex-row gap-1.5">
          <Dot delayMs={0} />
          <Dot delayMs={150} />
          <Dot delayMs={300} />
        </View>
        <LabelText className="uppercase tracking-widest">Chargement</LabelText>
      </View>
    </View>
  );
}
