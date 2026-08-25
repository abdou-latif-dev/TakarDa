import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { BottomSheetCard } from '@/components/ui/BottomSheetCard';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { SectionTitleText, BodyMdText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { useSubmissionStore } from '@/store/submissionStore';

export function ConfirmValidationModal() {
  const { submissionId } = useLocalSearchParams<{ submissionId: string }>();
  const setStatus = useSubmissionStore((s) => s.setStatus);
  const [loading, setLoading] = useState(false);

  const onConfirm = async () => {
    setLoading(true);
    try {
      await setStatus(submissionId, 'validated');
      router.replace(`/records/${submissionId}/validated`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheetCard>
      <View className="items-center gap-4 px-page-margin pb-8 pt-2">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-success-container">
          <MaterialIcons name="check-circle" size={32} color={Colors.success} />
        </View>
        <SectionTitleText className="text-center text-lg">Confirmer la validation ?</SectionTitleText>
        <BodyMdText className="text-center">Le dossier sera marqué comme validé.</BodyMdText>

        <View className="mt-2 w-full gap-3">
          <PrimaryButton label="Valider" loading={loading} onPress={onConfirm} />
          <SecondaryButton label="Annuler" onPress={() => router.back()} />
        </View>
      </View>
    </BottomSheetCard>
  );
}
