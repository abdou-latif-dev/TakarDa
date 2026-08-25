import 'react-native-gesture-handler';
import 'react-native-reanimated';
import '../global.css';
import { useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { useAuthStore } from '@/store/authStore';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Belt-and-suspenders: if fonts or the session restore ever fail to settle
// (bad network, a native module hiccup), don't leave the user staring at the
// splash screen forever — proceed with system-default fonts after 4s.
const BOOT_TIMEOUT_MS = 4000;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const restore = useAuthStore((s) => s.restore);
  const authStatus = useAuthStore((s) => s.status);
  const [timedOut, setTimedOut] = useState(false);
  const hiddenRef = useRef(false);

  useEffect(() => {
    restore();
  }, [restore]);

  useEffect(() => {
    if (fontError) console.warn('Font loading failed, continuing with system fonts:', fontError);
  }, [fontError]);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), BOOT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const ready = (fontsLoaded || !!fontError || timedOut) && (authStatus === 'ready' || timedOut);

  useEffect(() => {
    if (ready && !hiddenRef.current) {
      hiddenRef.current = true;
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FFFFFF' } }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="modals" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
