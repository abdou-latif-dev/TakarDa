import { useEffect } from 'react';
import { Alert, Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { MaterialIcons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton, IconButton } from '@/components/ui/Button';
import { DisplayText, LabelText, BodyLgText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { formatFcfa, formatLongDate } from '@/utils/format';
import { useGroupStore } from '@/store/groupStore';
import { useTontineStore } from '@/store/tontineStore';

function ReceiptRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View className="flex-row items-center justify-between py-2.5">
      <LabelText>{label}</LabelText>
      <BodyLgText className={mono ? 'font-mono' : 'font-inter-semibold'} numberOfLines={1}>
        {value}
      </BodyLgText>
    </View>
  );
}

export function ContributionSuccessScreen() {
  const { groupId, contributionId } = useLocalSearchParams<{ groupId: string; contributionId: string }>();
  const group = useGroupStore((s) => s.groups.find((g) => g.id === groupId));
  const members = useGroupStore((s) => s.members[groupId]) ?? [];
  const history = useTontineStore((s) => s.history[groupId]) ?? [];
  const contribution = history.find((c) => c.id === contributionId);
  const member = members.find((m) => m.id === contribution?.memberId);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  if (!contribution) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-page-margin">
        <PrimaryButton label="Retour" onPress={() => router.replace(`/group/${groupId}/tontine`)} />
      </SafeAreaView>
    );
  }

  const receiptText = `FormEase — Reçu de cotisation\n${group?.name ?? ''}\n${member?.displayName ?? ''} · ${formatFcfa(contribution.amount)}\nRéférence : ${contribution.reference}`;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-page-margin py-3">
        <BodyLgText className="font-manrope-bold text-primary">FormEase</BodyLgText>
        <IconButton icon="close" onPress={() => router.replace(`/group/${groupId}/tontine`)} />
      </View>

      <View className="flex-1 justify-center gap-6 px-page-margin">
        <View className="items-center gap-4">
          <View className="flex-row items-center gap-1.5 self-center rounded-full bg-success-container px-3 py-1">
            <MaterialIcons name="check-circle" size={14} color={Colors.success} />
            <LabelText style={{ color: Colors.success }} className="font-inter-semibold">
              {contribution.status === 'paid' ? 'Validé' : 'En attente'}
            </LabelText>
          </View>
          <DisplayText>{formatFcfa(contribution.amount)}</DisplayText>
        </View>

        <Card className="gap-0 p-0">
          <View className="p-gutter-card" style={{ borderStyle: 'dashed', borderBottomWidth: 1, borderColor: Colors.border }}>
            <LabelText>Reçu de cotisation</LabelText>
          </View>
          <View className="px-gutter-card">
            <ReceiptRow label="Tontine" value={group?.name ?? '—'} />
            <View className="h-px bg-border" />
            <ReceiptRow label="Membre" value={member?.displayName ?? '—'} />
            <View className="h-px bg-border" />
            <ReceiptRow label="Date" value={formatLongDate(new Date(contribution.createdAt))} />
            <View className="h-px bg-border" />
            <ReceiptRow label="Référence" value={contribution.reference} mono />
          </View>
        </Card>

        <View className="gap-3">
          <PrimaryButton
            label="Partager le reçu"
            icon="share"
            iconPosition="left"
            onPress={() => Share.share({ message: receiptText })}
          />
          <SecondaryButton
            label="Copier la référence"
            icon="content-copy"
            onPress={async () => {
              await Clipboard.setStringAsync(contribution.reference);
              Alert.alert('Copié', 'La référence a été copiée dans le presse-papiers.');
            }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
