import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { DisplayText, BodyLgText, LabelText } from '@/components/ui/Typography';
import { PrimaryButton } from '@/components/ui/Button';
import { ProgressDots } from '@/components/ui/ProgressBar';
import { Colors } from '@/constants/theme';
import { storage } from '@/services/storage';

const SLIDES = [
  {
    icon: 'qr-code-scanner' as const,
    title: 'Collectez facilement',
    body: 'Faites remplir vos formulaires et partagez les données grâce à un QR code sécurisé.',
    skipLabel: 'Ignorer',
  },
  {
    icon: 'edit-note' as const,
    title: 'Créez simplement',
    body: 'Créez vos formulaires, groupes et tontines en quelques secondes.',
    skipLabel: 'Passer',
  },
  {
    icon: 'dashboard-customize' as const,
    title: 'Tout au même endroit',
    body: 'Suivez vos membres, vos cotisations, vos activités et vos statistiques.',
    skipLabel: null,
  },
];

export function OnboardingScreen() {
  const [step, setStep] = useState(0);
  const slide = SLIDES[step];
  const isLast = step === SLIDES.length - 1;

  const finish = async () => {
    await storage.set('onboarding_seen', true);
    router.replace('/(auth)/login');
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <View className="flex-row justify-end px-page-margin py-2">
        {slide.skipLabel && (
          <Pressable onPress={finish} hitSlop={8}>
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
          onPress={() => (isLast ? finish() : setStep((s) => s + 1))}
        />
      </View>
    </SafeAreaView>
  );
}
