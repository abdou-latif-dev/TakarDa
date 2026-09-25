import { useEffect } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { MaterialIcons } from '@expo/vector-icons';
import { PrimaryButton } from '@/components/ui/Button';
import { HeadlineText, BodyLgText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';

export function FormSuccessScreen() {
  const { formId, submissionId } = useLocalSearchParams<{ formId: string; submissionId: string }>();

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center gap-5 px-page-margin">
        <View className="h-24 w-24 items-center justify-center rounded-full bg-primary-soft">
          <MaterialIcons name="check-circle" size={56} color={Colors.primary} />
        </View>
        <HeadlineText>Formulaire envoyé</HeadlineText>
        <BodyLgText className="text-center text-text-secondary">
          Votre dossier a été enregistré avec succès. Votre QR code est prêt.
        </BodyLgText>
      </View>
      <View className="px-page-margin pb-8">
        <PrimaryButton
          label="Afficher mon QR code"
          icon="qr-code"
          iconPosition="left"
          onPress={() => router.replace(`/form/${formId}/qr?submissionId=${submissionId}`)}
        />
      </View>
    </SafeAreaView>
  );
}
