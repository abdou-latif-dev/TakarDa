import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { SplashView } from '@/features/auth/screens/SplashView';
import { useAuthStore } from '@/store/authStore';
import { storage } from '@/services/storage';

const ONBOARDING_KEY = 'onboarding_seen';
const MIN_SPLASH_MS = 1400;

export default function Index() {
  const user = useAuthStore((s) => s.user);
  const [phase, setPhase] = useState<'splash' | 'onboarding' | 'auth' | 'tabs'>('splash');

  useEffect(() => {
    let cancelled = false;
    const timer = new Promise((resolve) => setTimeout(resolve, MIN_SPLASH_MS));
    // storage.get should be near-instant, but never let a stuck native call
    // (or a slow first-launch AsyncStorage init) strand the user on the
    // splash screen forever.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
    const safeSeenOnboarding = Promise.race([storage.get<boolean>(ONBOARDING_KEY).catch(() => null), timeout]);

    (async () => {
      const [, seenOnboarding] = await Promise.all([timer, safeSeenOnboarding]);
      if (cancelled) return;
      if (user) return setPhase('tabs');
      if (!seenOnboarding) return setPhase('onboarding');
      return setPhase('auth');
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (phase === 'splash') return <SplashView />;
  if (phase === 'onboarding') return <Redirect href="/(auth)/onboarding" />;
  if (phase === 'auth') return <Redirect href="/(auth)/login" />;
  return <Redirect href="/(tabs)" />;
}
