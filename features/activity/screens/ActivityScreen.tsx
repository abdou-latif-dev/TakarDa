import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Chip } from '@/components/ui/Chip';
import { ActivityItem } from '@/components/ui/ActivityItem';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useActivityStore } from '@/store/activityStore';
import { useGroupStore } from '@/store/groupStore';

const FILTERS = ['Tout', 'Groupes', 'Tontines', 'Formulaires'] as const;

export function ActivityScreen() {
  const { events, status, fetch } = useActivityStore();
  const { groups, fetchGroups } = useGroupStore();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Tout');

  useEffect(() => {
    fetch();
    fetchGroups();
  }, [fetch, fetchGroups]);

  const tontineGroupIds = useMemo(() => new Set(groups.filter((g) => g.kind === 'tontine').map((g) => g.id)), [groups]);

  const filtered = events.filter((e) => {
    if (filter === 'Tout') return true;
    if (filter === 'Tontines') return e.groupId ? tontineGroupIds.has(e.groupId) : e.type === 'contribution_added';
    if (filter === 'Groupes') return e.type === 'member_joined' || e.type === 'member_invited' || e.type === 'group_created';
    if (filter === 'Formulaires') return e.type === 'form_submitted' || e.type === 'qr_scanned' || e.type.startsWith('submission');
    return true;
  });

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <AppHeader title="Activité" />
      <View className="px-page-margin">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pb-3">
          {FILTERS.map((f) => (
            <Chip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} />
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerClassName="gap-4 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState onRetry={fetch} />}
        {status === 'success' && filtered.length === 0 && (
          <EmptyState icon="analytics" title="Pas encore d'activité" description="Vos actions apparaîtront ici." />
        )}
        {status === 'success' && filtered.length > 0 && (
          <View className="rounded-lg border border-border bg-surface p-gutter-card shadow-soft">
            {filtered.map((event, i) => (
              <ActivityItem key={event.id} event={event} isLast={i === filtered.length - 1} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
