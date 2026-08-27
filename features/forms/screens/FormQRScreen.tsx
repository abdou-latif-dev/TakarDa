import { useEffect } from 'react';
import { Alert, Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { AppHeader } from '@/components/ui/AppHeader';
import { QRCard } from '@/components/ui/QRCard';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingState } from '@/components/ui/States';
import { useSubmissionStore } from '@/store/submissionStore';

const STATUS_MAP = { pending: 'pending', validated: 'validated', rejected: 'rejected', correction_requested: 'pending' } as const;

export function FormQRScreen() {
  const { submissionId } = useLocalSearchParams<{ submissionId: string }>();
  const { activeSubmission, fetchOne } = useSubmissionStore();

  useEffect(() => {
    fetchOne(submissionId);
  }, [submissionId, fetchOne]);

  if (!activeSubmission) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <AppHeader title="Votre dossier" showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const hoursLeft = Math.max(0, Math.round((new Date(activeSubmission.qrExpiresAt).getTime() - Date.now()) / 3_600_000));

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title="Votre dossier" showBack />
      <View className="flex-1 justify-center gap-6 px-page-margin">
        <StatusBadge status={STATUS_MAP[activeSubmission.status]} className="self-center" />
        <QRCard
          token={activeSubmission.qrToken}
          dossierLabel={`Dossier #${activeSubmission.qrToken}`}
          validityLabel={hoursLeft > 0 ? `Valide pendant ${hoursLeft}h` : 'QR code expiré'}
        />
        <View className="flex-row gap-3">
          <SecondaryButton
            label="Partager"
            icon="ios-share"
            onPress={() => Share.share({ message: `Mon dossier FormEase — code : ${activeSubmission.qrToken}` })}
          />
          <SecondaryButton
            label="Enregistrer"
            icon="download"
            onPress={async () => {
              await Clipboard.setStringAsync(activeSubmission.qrToken);
              Alert.alert('Enregistré', 'Le code de votre dossier a été copié dans le presse-papiers.');
            }}
          />
        </View>
        <PrimaryButton label="Retour à l'accueil" icon="home" onPress={() => router.replace('/(tabs)')} />
      </View>
    </SafeAreaView>
  );
}
