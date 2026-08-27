import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SectionTitleText, LabelText, BodyMdText } from '@/components/ui/Typography';
import { IconButton } from '@/components/ui/Button';
import { Colors } from '@/constants/theme';
import { formatFcfa } from '@/utils/format';
import { useGroupStore } from '@/store/groupStore';
import type { Group } from '@/types/entities';

const FREQUENCY_LABEL: Record<string, string> = {
  daily: 'Quotidienne',
  weekly: 'Hebdomadaire',
  monthly: 'Mensuelle',
  custom: 'Personnalisée',
};

function TontineCard({ tontine }: { tontine: Group }) {
  const members = useGroupStore((s) => s.members[tontine.id]) ?? [];
  const round = tontine.currentRound ?? 1;
  const total = tontine.memberCount || 1;
  const next = members.find((m) => m.position === round);
  const progress = Math.min(1, (round - 1) / total);

  return (
    <Pressable
      onPress={() => router.push(`/group/${tontine.id}/tontine`)}
      className="gap-3 overflow-hidden rounded-xl border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <SectionTitleText numberOfLines={1}>{tontine.name}</SectionTitleText>
          <LabelText>
            {FREQUENCY_LABEL[tontine.frequency ?? 'monthly']} · {formatFcfa(tontine.contributionAmount ?? 0)} / membre
          </LabelText>
        </View>
        <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
          <MaterialIcons name="savings" size={18} color={Colors.primary} />
        </View>
      </View>

      <View className="flex-row items-center justify-between">
        <View className="flex-row">
          {members.slice(0, 4).map((m, i) => (
            <View key={m.id} style={{ marginLeft: i === 0 ? 0 : -10 }}>
              <Avatar name={m.displayName} size={28} />
            </View>
          ))}
          {tontine.memberCount > 4 && (
            <View className="ml-[-10px] h-7 w-7 items-center justify-center rounded-full bg-surface-container">
              <LabelText>+{tontine.memberCount - 4}</LabelText>
            </View>
          )}
        </View>
        {next && (
          <View className="items-end">
            <LabelText>Prochain bénéficiaire</LabelText>
            <LabelText className="font-inter-semibold text-text-primary">{next.displayName}</LabelText>
          </View>
        )}
      </View>

      <View className="gap-1.5">
        <ProgressBar progress={progress} />
        <LabelText>
          Tour {round} / {total}
        </LabelText>
      </View>
    </Pressable>
  );
}

export function MesTontinesScreen() {
  const { groups, status, fetchGroups, fetchMembers } = useGroupStore();

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const tontines = useMemo(() => groups.filter((g) => g.kind === 'tontine'), [groups]);
  const active = tontines.filter((t) => t.tontineStatus !== 'completed');
  const completed = tontines.filter((t) => t.tontineStatus === 'completed');

  useEffect(() => {
    active.forEach((t) => fetchMembers(t.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.length]);

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader
        title="Mes tontines"
        trailing={<IconButton icon="add" onPress={() => router.push('/tontine/create')} />}
      />
      <ScrollView contentContainerClassName="gap-6 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState onRetry={fetchGroups} />}

        {status === 'success' && tontines.length === 0 && (
          <EmptyState
            icon="savings"
            title="Aucune tontine"
            description="Créez votre première tontine pour commencer à suivre les cotisations et l'ordre de passage."
            actionLabel="Créer une tontine"
            onAction={() => router.push('/tontine/create')}
          />
        )}

        {active.length > 0 && (
          <View className="gap-3">
            <SectionHeader title="Tontines actives" />
            <View className="gap-3">
              {active.map((t) => (
                <TontineCard key={t.id} tontine={t} />
              ))}
            </View>
          </View>
        )}

        {completed.length > 0 && (
          <View className="gap-3 opacity-80">
            <SectionHeader title="Tontines terminées" />
            <View className="gap-3">
              {completed.map((t) => (
                <Card key={t.id} className="flex-row items-center justify-between">
                  <View className="flex-1">
                    <SectionTitleText numberOfLines={1}>{t.name}</SectionTitleText>
                    <BodyMdText>
                      {t.memberCount} membres · {formatFcfa((t.contributionAmount ?? 0) * t.memberCount)} total
                    </BodyMdText>
                  </View>
                  <Pressable onPress={() => router.push(`/group/${t.id}/tontine`)}>
                    <LabelText className="font-inter-semibold text-primary">Détails</LabelText>
                  </Pressable>
                </Card>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
