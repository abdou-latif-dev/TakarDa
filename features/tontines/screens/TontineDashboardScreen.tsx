import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { MemberRow } from '@/components/ui/MemberRow';
import { PrimaryButton, SecondaryButton, IconButton } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { LoadingState } from '@/components/ui/States';
import { DisplayText, HeadlineText, LabelText, BodyMdText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { formatFcfa, formatLongDate } from '@/utils/format';
import { useGroupStore } from '@/store/groupStore';
import { useTontineStore } from '@/store/tontineStore';
import type { ContributionStatus } from '@/types/entities';

const STATUS_MAP: Record<ContributionStatus, 'paid' | 'pending' | 'late'> = {
  paid: 'paid',
  pending: 'pending',
  late: 'late',
};

export function TontineDashboardScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const group = useGroupStore((s) => s.groups.find((g) => g.id === groupId));
  const deleteTontine = useGroupStore((s) => s.deleteTontine);
  const { summaries, summaryStatus, fetchSummary, advanceRound } = useTontineStore();
  const [advancing, setAdvancing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const summary = summaries[groupId];

  useEffect(() => {
    fetchSummary(groupId);
  }, [groupId, fetchSummary]);

  if (summaryStatus[groupId] !== 'success' || !summary) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const paidRatio = summary.members.length > 0 ? summary.paidCount / summary.members.length : 0;
  const lateCount = Object.values(summary.contributionsByMember).filter((c) => c?.status === 'late').length;
  const dueDate = summary.cycle ? formatLongDate(new Date(summary.cycle.dueDate)) : '—';

  const onAdvanceRound = () => {
    Alert.alert(
      'Marquer comme reçu',
      `Confirmer que ${summary.nextBeneficiary?.displayName ?? 'ce membre'} a reçu la cagnotte et passer au tour suivant ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          onPress: async () => {
            setAdvancing(true);
            try {
              await advanceRound(groupId);
            } finally {
              setAdvancing(false);
            }
          },
        },
      ],
    );
  };

  const onDelete = () => {
    Alert.alert(
      'Supprimer cette tontine',
      `"${group?.name}" et toutes ses données (membres, cotisations, historique) seront définitivement supprimés. Continuer ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteTontine(groupId);
              router.replace({ pathname: '/(tabs)/modeles', params: { justDeleted: 'Tontine supprimée' } });
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppHeader showBack trailing={<IconButton icon="delete-outline" onPress={onDelete} disabled={deleting} />} />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View>
          <DisplayText className="text-2xl">{group?.name}</DisplayText>
          <BodyMdText>{summary.cycle?.label ?? 'Cycle en cours'}</BodyMdText>
        </View>

        <View className="flex-row gap-3">
          <SecondaryButton
            label="Ajouter un membre"
            icon="person-add"
            onPress={() => router.push(`/group/${groupId}/add-member`)}
          />
          <PrimaryButton
            label="Cotisation"
            icon="add"
            onPress={() => router.push(`/group/${groupId}/tontine/add-contribution`)}
          />
        </View>

        <Card className="gap-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
                <MaterialIcons name="sync" size={20} color={Colors.primary} />
              </View>
              <View>
                <LabelText>
                  Tour {summary.currentRound} / {summary.totalRounds}
                </LabelText>
                <HeadlineText className="text-lg">{summary.nextBeneficiary?.displayName ?? '—'}</HeadlineText>
              </View>
            </View>
          </View>
          <ProgressBar progress={summary.progress} />
          <View className="flex-row gap-3">
            <SecondaryButton label="Ordre de passage" icon="swap-vert" onPress={() => router.push(`/group/${groupId}/order`)} />
            <PrimaryButton label="Marquer reçu" icon="check-circle" loading={advancing} onPress={onAdvanceRound} />
          </View>
        </Card>

        <View className="gap-3">
          <Card className="gap-4">
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
                <MaterialIcons name="account-balance-wallet" size={20} color={Colors.primary} />
              </View>
              <LabelText>Collecté ce mois</LabelText>
            </View>
            <HeadlineText className="text-3xl">{formatFcfa(summary.totalCollected)}</HeadlineText>
            <View className="gap-2">
              <LabelText>Progression des paiements</LabelText>
              <ProgressBar progress={paidRatio} />
              <LabelText className="font-inter-semibold text-text-primary">
                {summary.paidCount} / {summary.members.length} membres ont payé
              </LabelText>
            </View>
          </Card>

          <View className="flex-row gap-3">
            <Card className="flex-1 gap-1">
              <LabelText>Prochaine échéance</LabelText>
              <HeadlineText className="text-lg">{dueDate}</HeadlineText>
            </Card>
          </View>
          <View className="flex-row gap-3">
            <Card className="flex-1 gap-1">
              <LabelText>Cotisations</LabelText>
              <HeadlineText className="text-lg">{formatFcfa(summary.totalCollected)}</HeadlineText>
            </Card>
            <Card className="flex-1 gap-1 border-error-container bg-error-container/10">
              <LabelText>Retards</LabelText>
              <HeadlineText className="text-lg text-error">{lateCount}</HeadlineText>
            </Card>
          </View>
        </View>

        <View className="gap-3">
          <SectionHeader
            title="Membres"
            action="Voir tout"
            onAction={() => router.push(`/group/${groupId}/tontine/active-members`)}
          />
          <View className="rounded-lg border border-border bg-surface px-gutter-card shadow-soft">
            {summary.members.slice(0, 5).map((member, i) => {
              const contribution = summary.contributionsByMember[member.id];
              return (
                <View key={member.id} className={i < 4 ? 'border-b border-border' : undefined}>
                  <MemberRow
                    name={member.displayName}
                    accountType={member.accountType}
                    trailingText={formatFcfa(summary.cycle?.amountExpectedPerMember ?? 10000)}
                    status={contribution ? STATUS_MAP[contribution.status] : 'pending'}
                  />
                </View>
              );
            })}
          </View>
        </View>

        <View className="flex-row gap-3">
          <SecondaryButton
            label="Historique"
            icon="history"
            onPress={() => router.push(`/group/${groupId}/tontine/history`)}
          />
          <SecondaryButton
            label="Statistiques"
            icon="bar-chart"
            onPress={() => router.push(`/group/${groupId}/tontine/stats`)}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
