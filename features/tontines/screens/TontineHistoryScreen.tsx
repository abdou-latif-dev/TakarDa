import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Chip } from '@/components/ui/Chip';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { BodyLgText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { formatFcfa, formatLongDate } from '@/utils/format';
import { useTontineStore } from '@/store/tontineStore';
import type { TourStatus } from '@/types/entities';

const STATUS_BADGE: Record<TourStatus, 'paid' | 'pending' | 'late'> = {
  complete: 'paid',
  partial: 'pending',
  upcoming: 'pending',
  late: 'late',
};

const STATUS_LABEL: Record<TourStatus, string> = {
  complete: 'Complet',
  partial: 'Partiellement payé',
  upcoming: 'À venir',
  late: 'En retard',
};

const FILTERS: { label: string; value: TourStatus | 'all' }[] = [
  { label: 'Tout', value: 'all' },
  { label: 'Complet', value: 'complete' },
  { label: 'Partiel', value: 'partial' },
  { label: 'En retard', value: 'late' },
];

/** Real, tour-by-tour history (§28 of the Tour/Boucle audit) — never a bare
 * list of contributions with no context: every row always says which tour,
 * which loop, which date, which beneficiary, which amount, which state. */
export function TontineHistoryScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { history, historyStatus, fetchHistory } = useTontineStore();
  const [filter, setFilter] = useState<TourStatus | 'all'>('all');

  useEffect(() => {
    fetchHistory(groupId);
  }, [groupId, fetchHistory]);

  const entries = history[groupId] ?? [];
  const filtered = filter === 'all' ? entries : entries.filter((e) => e.status === filter);

  const grouped = useMemo(() => {
    const map = new Map<number, typeof filtered>();
    for (const entry of filtered) {
      map.set(entry.tour.cycleNumber, [...(map.get(entry.tour.cycleNumber) ?? []), entry]);
    }
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  }, [filtered]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
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
          <EmptyState icon="receipt-long" title="Aucun tour" description="Les tours de cette tontine apparaîtront ici." />
        )}

        {grouped.map(([cycleNumber, cycleEntries]) => (
          <View key={cycleNumber} className="gap-3">
            <SectionTitleText className="text-base">Boucle {cycleNumber}</SectionTitleText>
            <View className="gap-3">
              {cycleEntries.map((entry) => (
                <Pressable
                  key={entry.tour.id}
                  onPress={() => router.push(`/group/${groupId}/tontine/tour/${entry.tour.tourNumber}`)}
                  className="gap-2 rounded-lg border border-border bg-surface p-gutter-card shadow-soft active:opacity-90">
                  <View className="flex-row items-center gap-3">
                    <Avatar name={entry.beneficiary?.displayName ?? '?'} size={44} />
                    <View className="flex-1">
                      <BodyLgText className="font-inter-semibold" numberOfLines={1}>
                        Tour {entry.tour.tourNumber} · {entry.beneficiary?.displayName ?? 'Membre'}
                      </BodyLgText>
                      <LabelText>{formatLongDate(new Date(entry.tour.scheduledDate))}</LabelText>
                    </View>
                  </View>
                  <View className="flex-row items-center justify-between">
                    <LabelText className="font-inter-semibold text-text-primary">
                      {formatFcfa(entry.collected)} / {formatFcfa(entry.expectedTotal)} · {entry.paidCount}/{entry.totalMembers}
                    </LabelText>
                    <StatusBadge status={STATUS_BADGE[entry.status]} />
                  </View>
                  <LabelText>{STATUS_LABEL[entry.status]}</LabelText>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
