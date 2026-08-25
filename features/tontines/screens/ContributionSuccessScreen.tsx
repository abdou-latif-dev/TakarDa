import { useEffect } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { MaterialIcons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/Button';
import { HeadlineText, LabelText, DisplayText, BodyLgText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { formatFcfa } from '@/utils/format';

export function ContributionSuccessScreen() {
  const { groupId, memberName, amount } = useLocalSearchParams<{ groupId: string; memberName?: string; amount?: string }>();

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center gap-6 px-page-margin">
        <View className="h-32 w-32 items-center justify-center rounded-full bg-primary-soft">
          <MaterialIcons name="check-circle" size={72} color={Colors.primary} />
        </View>

        <HeadlineText>Contribution enregistrée</HeadlineText>

        {memberName ? (
          <View className="flex-row items-center gap-1.5">
            <MaterialIcons name="person" size={16} color={Colors.textSecondary} />
            <BodyLgText className="text-text-secondary">{memberName}</BodyLgText>
          </View>
        ) : null}

        <Card className="w-full items-center gap-1">
          <LabelText className="uppercase tracking-wide">Montant de la transaction</LabelText>
          <DisplayText className="text-primary">{formatFcfa(Number(amount) || 0)}</DisplayText>
        </Card>
      </View>

      <View className="px-page-margin pb-6">
        <PrimaryButton label="Terminer" onPress={() => router.replace(`/group/${groupId}/tontine`)} />
      </View>
    </SafeAreaView>
  );
}
