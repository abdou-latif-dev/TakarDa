import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { MaterialIcons } from '@expo/vector-icons';
import { PrimaryButton } from '@/components/ui/Button';
import { HeadlineText, BodyLgText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';

export function DossierValidatedScreen() {
  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center gap-5 px-page-margin">
        <View className="h-24 w-24 items-center justify-center rounded-full bg-success-container">
          <MaterialIcons name="check-circle" size={56} color={Colors.success} />
        </View>
        <HeadlineText>Dossier validé</HeadlineText>
        <BodyLgText className="text-center text-text-secondary">
          Le dossier a été enregistré dans votre historique avec succès. Vous pouvez maintenant le consulter à tout moment.
        </BodyLgText>
      </View>
      <View className="px-page-margin pb-8">
        <PrimaryButton label="Terminer" icon="arrow-forward" onPress={() => router.replace('/records')} />
      </View>
    </SafeAreaView>
  );
}
