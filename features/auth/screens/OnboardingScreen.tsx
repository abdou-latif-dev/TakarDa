import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { DisplayText, BodyLgText, LabelText } from '@/components/ui/Typography';
import { PrimaryButton } from '@/components/ui/Button';
import { ProgressDots } from '@/components/ui/ProgressBar';
import { Colors } from '@/constants/theme';
import { completeOnboarding } from '@/services/onboardingService';
import { useDemoStore } from '@/store/demoStore';

const SLIDES = [
  {
    icon: 'dashboard-customize' as const,
    title: 'Vos outils de gestion',
    body: 'Tontine, immobilier, électricité (CEET) et eau (TDE) : suivez cotisations, loyers et factures partagées au même endroit.',
    skipLabel: 'Passer',
  },
  {
    icon: 'smartphone' as const,
    title: 'Explorez sans compte',
    body: "Essayez tout de suite les modules avec des exemples de démonstration : aucune inscription n'est demandée pour explorer.",
    skipLabel: 'Passer',
  },
  {
    icon: 'cloud-queue' as const,
    title: 'Un compte pour votre travail',
    body: 'Pour commencer votre travail personnel et le retrouver plus tard, un compte sera nécessaire. Le partage avec d’autres personnes arrivera dans une prochaine version.',
    skipLabel: null,
  },
];

export function OnboardingScreen() {
  const [step, setStep] = useState(0);
  // La création des exemples de démonstration (quelques secondes sur un téléphone modeste) se fait pendant que le bouton affiche son attente : jamais un écran qui ne répond pas.
  const [starting, setStarting] = useState(false);
  const slide = SLIDES[step];
  const isLast = step === SLIDES.length - 1;

  const finish = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await completeOnboarding();
    } catch {
      // Stockage indisponible : on entre quand même, la présentation sera simplement revue.
    }
    // Première utilisation sans aucun travail personnel : l'exploration commence dans l'espace de démonstration (isolé).
    // S'il existe des données personnelles, rien ne change. Jamais bloquant : en cas d'échec, on entre quand même dans l'application.
    await useDemoStore.getState().enterIfFresh().catch(() => false);
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <View className="flex-row justify-end px-page-margin py-2">
        {slide.skipLabel && (
          <Pressable onPress={finish} disabled={starting} hitSlop={8}>
            <LabelText className="font-inter-semibold text-text-secondary">{slide.skipLabel}</LabelText>
          </Pressable>
        )}
      </View>

      <View className="flex-1 items-center justify-center px-10">
        <View className="mb-10 aspect-square w-full max-w-[300px] items-center justify-center rounded-xl border border-border bg-background-secondary">
          <MaterialIcons name={slide.icon} size={96} color={Colors.primary} />
        </View>
        <DisplayText className="text-center text-[28px] leading-9">{slide.title}</DisplayText>
        <BodyLgText className="mt-3 text-center text-text-secondary">{slide.body}</BodyLgText>
      </View>

      <View className="gap-6 px-page-margin pb-6">
        <ProgressDots total={SLIDES.length} activeIndex={step} />
        <PrimaryButton
          label={isLast ? 'Commencer' : 'Continuer'}
          loading={starting}
          onPress={() => (isLast ? finish() : setStep((s) => s + 1))}
        />
      </View>
    </SafeAreaView>
  );
}
