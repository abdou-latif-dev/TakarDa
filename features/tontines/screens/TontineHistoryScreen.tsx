import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Chip } from '@/components/ui/Chip';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { BodyLgText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { formatDayGroup, formatFcfa } from '@/utils/format';
import { useGroupStore } from '@/store/groupStore';
import { useTontineStore } from '@/store/tontineStore';
import type { Contribution, ContributionStatus } from '@/types/entities';

const FILTERS: { label: string; value: ContributionStatus | 'all' }[] = [
  { label: 'Tout', value: 'all' },
  { label: 'Payées', value: 'paid' },
  { label: 'En attente', value: 'pending' },
  { label: 'En retard', value: 'late' },
];

export function TontineHistoryScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { members, fetchMembers } = useGroupStore();
  const { history, historyStatus, fetchHistory } = useTontineStore();
  const [filter, setFilter] = useState<ContributionStatus | 'all'>('all');

  useEffect(() => {
    fetchHistory(groupId);
    if (!members[groupId]) fetchMembers(groupId);
  }, [groupId, members, fetchHistory, fetchMembers]);

  const groupMembers = members[groupId] ?? [];
  const items = history[groupId] ?? [];
  const filtered = filter === 'all' ? items : items.filter((c) => c.status === filter);

  const grouped = useMemo(() => {
    const map = new Map<string, Contribution[]>();
    for (const item of filtered) {
      const key = formatDayGroup(item.createdAt);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top']}>
      <AppHeader title="Historique" showBack />
      <View className="px-page-margin">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pb-3">
          {FILTERS.map((f) => (
            <Chip key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} />
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerClassName="gap-5 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {historyStatus[groupId] === 'loading' && <LoadingState />}
        {historyStatus[groupId] === 'error' && <ErrorState onRetry={() => fetchHistory(groupId)} />}
        {historyStatus[groupId] === 'success' && filtered.length === 0 && (
          <EmptyState icon="receipt-long" title="Aucune cotisation" description="Les paiements de ce groupe apparaîtront ici." />
        )}

        {grouped.map(([day, contributions]) => (
          <View key={day} className="gap-3">
            <SectionTitleText className="text-base">{day}</SectionTitleText>
            <View className="gap-3">
              {contributions.map((c) => {
                const member = groupMembers.find((m) => m.id === c.memberId);
                return (
                  <View
                    key={c.id}
                    className={`flex-row items-center gap-3 rounded-lg border border-border bg-surface p-gutter-card shadow-soft ${c.status === 'pending' ? 'opacity-75' : ''}`}>
                    <Avatar name={member?.displayName ?? '?'} size={44} />
                    <View className="flex-1">
                      <BodyLgText className="font-inter-semibold">{member?.displayName ?? 'Membre'}</BodyLgText>
                      <LabelText>Contribution</LabelText>
                    </View>
                    <View className="items-end gap-1">
                      <LabelText className="font-inter-semibold text-primary-dark">+{formatFcfa(c.amount)}</LabelText>
                      <StatusBadge status={c.status} />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
