// Must be the very first import: nanoid (used by every genId() call in
// services/db.ts to create tontines, forms, submissions, etc.) needs
// crypto.getRandomValues, which React Native does not provide natively.
// Without this, every create/save action fails with a silently-swallowed
// exception — the button looks like it does nothing.
import 'react-native-get-random-values';
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
import { useThemeStore } from '@/store/themeStore';
import { hydrateDb, startAutoPersist } from '@/services/persistence';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Belt-and-suspenders: if fonts or the session restore ever fail to settle
// (bad network, a native module hiccup), don't leave the user staring at the
// splash screen forever — proceed with system-default fonts after 4s. This
// timeout must NEVER bypass dbHydrated (see below) — it only guards fonts
// and the auth-session restore, both of which already resolve quickly on
// their own via try/catch.
const BOOT_TIMEOUT_MS = 4000;
// hydrateDb() reads/parses one AsyncStorage entry — bounded on its own so a
// slow device can never hang the app, but generous enough that real local
// data is never skipped just because BOOT_TIMEOUT_MS fired first.
const DB_HYDRATE_TIMEOUT_MS = 6000;

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
  const [dbHydrated, setDbHydrated] = useState(false);
  const hiddenRef = useRef(false);

  // Local data (tontines, forms, submissions, activity...) must be restored
  // before auth restores the session and before any screen's fetch() runs,
  // otherwise stores would hydrate from the still-empty in-memory arrays.
  // dbHydrated is required, unconditionally, below — it must never be
  // bypassed by the generic boot timeout. Racing hydrateDb() against its own
  // dedicated timeout guarantees this effect still settles within a bounded
  // time even if AsyncStorage itself hangs on a slow device.
  useEffect(() => {
    let cancelled = false;
    Promise.race([
      hydrateDb().catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, DB_HYDRATE_TIMEOUT_MS)),
    ]).then(() => {
      if (!cancelled) setDbHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (dbHydrated) restore();
  }, [dbHydrated, restore]);

  useEffect(() => startAutoPersist(), []);

  // Theme preference: in-memory defaults already match {mode:'light',
  // accentKey:'default'}, so this never needs to gate `ready` the way
  // dbHydrated does — it only overwrites the defaults once AsyncStorage
  // resolves, with nothing to show differently in between.
  useEffect(() => {
    useThemeStore.getState().hydrate();
  }, []);

  useEffect(() => {
    if (fontError) console.warn('Font loading failed, continuing with system fonts:', fontError);
  }, [fontError]);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), BOOT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  // dbHydrated is a hard requirement — never bypassed by timedOut, so no
  // screen can ever read db.ts before local data is restored (or definitively
  // given up on within DB_HYDRATE_TIMEOUT_MS). timedOut only covers fonts and
  // a hung auth-session restore.
  const ready = (fontsLoaded || !!fontError || timedOut) && dbHydrated && (authStatus === 'ready' || timedOut);

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
