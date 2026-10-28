import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { SplashView } from '@/features/auth/screens/SplashView';
import { hasCompletedOnboarding, resolveEntryRoute } from '@/services/onboardingService';

const MIN_SPLASH_MS = 1400;
// hasCompletedOnboarding() devrait être quasi instantané, mais un appel natif bloqué (ou
// une première initialisation lente d'AsyncStorage) ne doit jamais garder l'utilisateur
// sur le splash : au-delà de ce délai on considère la présentation comme non vue.
const STORAGE_TIMEOUT_MS = 2000;

/** Point d'entrée : splash, puis présentation au premier lancement, sinon l'accueil.
 * Aucun compte n'est demandé. */
export default function Index() {
  const [phase, setPhase] = useState<'splash' | 'onboarding' | 'tabs'>('splash');

  useEffect(() => {
    let cancelled = false;
    const minSplash = new Promise<void>((resolve) => setTimeout(resolve, MIN_SPLASH_MS));
    const completed = Promise.race([
      hasCompletedOnboarding(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), STORAGE_TIMEOUT_MS)),
    ]);

    (async () => {
      const [, done] = await Promise.all([minSplash, completed]);
      if (!cancelled) setPhase(resolveEntryRoute(done));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === 'splash') return <SplashView />;
  if (phase === 'onboarding') return <Redirect href="/(auth)/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
