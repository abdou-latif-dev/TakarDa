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
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { vars, useColorScheme } from 'nativewind';
import * as SystemUI from 'expo-system-ui';
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
import { useCloudStore } from '@/store/cloudStore';
import { ModuleLockGuard } from '@/components/account/ModuleLockGuard';
import { refreshSyncLifecycle, startSyncLifecycle } from '@/services/syncLifecycle';
import { useDemoStore } from '@/store/demoStore';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { AccountRequiredDialog } from '@/components/account/AccountRequiredDialog';
import { DemoBanner } from '@/components/demo/DemoBanner';
import { resetAccountCaches } from '@/store/accountCaches';
import { getThemeVariables, setColorsForScheme, LIGHT_COLORS, DARK_COLORS } from '@/constants/theme';
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
  const mode = useThemeStore((s) => s.mode);
  const { colorScheme, setColorScheme } = useColorScheme();
  // Thème : « Clair », « Sombre » ou « Système » (réglage Profil › Apparence, conservé sur l'appareil). Calculé
  // dans le rendu (pas dans un effet) pour que `Colors` et les variables --td-* soient justes dès ce rendu.
  const activeScheme: 'light' | 'dark' = mode === 'system' ? (colorScheme === 'dark' ? 'dark' : 'light') : mode;
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

  // Espace de démonstration : relit l'espace réellement actif une fois la base locale chargée (voir services/persistence.ts).
  useEffect(() => {
    if (dbHydrated) useDemoStore.getState().sync();
  }, [dbHydrated]);

  // Compte cloud facultatif : restaure la session Firebase si elle existe. Ne synchronise ni ne migre rien.
  // Fermé tant que les règles et fonctions cloud ne sont pas validées (constants/features.ts) : Firebase n'est alors pas initialisé.
  useEffect(() => {
    if (dbHydrated && CLOUD_ACCOUNT_ENABLED) useCloudStore.getState().init();
  }, [dbHydrated]);

  // Nouveau moteur de synchronisation (phase 7) : pilotage du runtime selon l'authentification. Entièrement derrière le drapeau fermé : sans lui,
  // rien n'est démarré, abonné ni chargé. Le runtime est arrêté à la déconnexion, au changement de compte, pendant une suppression et au démontage.
  useEffect(() => {
    if (!dbHydrated || !CLOUD_ACCOUNT_ENABLED) return undefined;
    const stop = startSyncLifecycle(useCloudStore);
    // changement d'espace (démonstration ↔ personnel) : le runtime est réévalué
    const unsubscribeDemo = useDemoStore.subscribe(() => void refreshSyncLifecycle());
    return () => {
      unsubscribeDemo();
      stop();
    };
  }, [dbHydrated]);

  // Changement de compte : les listes gardées en mémoire sont vidées (les données persistées ne sont pas touchées).
  useEffect(
    () =>
      useCloudStore.subscribe((s, prev) => {
        if (s.accountEpoch !== prev.accountEpoch) resetAccountCaches();
      }),
    [],
  );

  // Theme preference: the system appearance is the initial default, so this
  // never needs to gate `ready` the way
  // dbHydrated does — it only overwrites the defaults once AsyncStorage
  // resolves, with nothing to show differently in between.
  useEffect(() => {
    useThemeStore.getState().hydrate();
  }, []);

  // Tells NativeWind which scheme to force (or 'system' to release any
  // override and follow the OS again) — an imperative call, appropriate in an
  // effect since it's NativeWind's own API for changing its internal state.
  useEffect(() => {
    setColorScheme(mode);
  }, [mode, setColorScheme]);

  // Mutates the `Colors` singleton (see constants/theme.ts's header comment on
  // it) SYNCHRONOUSLY in the render body, not in a useEffect. This was the
  // actual bug behind Étape 4A's "dark mode isn't coherent" report: mutating
  // it post-render meant every component reading `Colors.X` directly (icons,
  // SVG props, shadow colors — anything a NativeWind className can't express)
  // kept showing the previous scheme's colors until some unrelated re-render
  // happened to occur afterwards. Calling it here, before returning JSX, means
  // it's always current by the time this render's whole subtree (the entire
  // app, since this is the root) reads it — same render pass, no lag.
  setColorsForScheme(activeScheme);

  // Android : fond de la fenêtre native (zone derrière la barre de navigation, clavier, transitions) = fond du thème.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(activeScheme === 'dark' ? DARK_COLORS.background : LIGHT_COLORS.background).catch(() => {});
  }, [activeScheme]);

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
      {/* Les variables de thème (--td-*) doivent être posées sur un composant React Native de base : NativeWind
          ignore `vars()` sur un composant tiers comme GestureHandlerRootView. Sur le web le style est transmis
          tel quel au DOM, ce qui masquait le problème ; sur Android toutes les classes bg-surface, border-border,
          text-text-* restaient sans couleur. */}
      <View style={[{ flex: 1 }, vars(getThemeVariables(activeScheme))]}>
      {/* initialWindowMetrics: react-native-safe-area-context's own documented fix for
          insets reading as {top:0,...} for a brief moment after a screen mounts, before
          the native onInsetsChange event arrives — most noticeable on freshly-pushed/
          modal screens on Android, exactly the "content sits too close to the top" symptom
          reported after real-device testing (Étape 4D follow-up). */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <DemoBanner />
        <Stack key={activeScheme} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: activeScheme === 'dark' ? DARK_COLORS.background : LIGHT_COLORS.background } }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="modals" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack>
        <AccountRequiredDialog />
        {CLOUD_ACCOUNT_ENABLED ? <ModuleLockGuard /> : null}
        <StatusBar style={activeScheme === 'dark' ? 'light' : 'dark'} />
      </SafeAreaProvider>
      </View>
    </GestureHandlerRootView>
  );
}
