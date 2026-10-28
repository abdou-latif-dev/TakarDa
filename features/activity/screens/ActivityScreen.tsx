import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Chip } from '@/components/ui/Chip';
import { ActivityItem } from '@/components/ui/ActivityItem';
import { LabelText } from '@/components/ui/Typography';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useActivityStore } from '@/store/activityStore';
import { activityModule, groupActivitiesByDay, selectRecentActivities } from '@/services/activityService';
import type { ActivityModule } from '@/types/entities';

const MODULES: { key: ActivityModule; label: string }[] = [
  { key: 'tontine', label: 'Tontines' },
  { key: 'immobilier', label: 'Immobilier' },
  { key: 'ceet', label: 'CEET' },
  { key: 'tde', label: 'TDE' },
  { key: 'formulaires', label: 'Formulaires' },
];

/** Journal des actions métier, du plus récent au plus ancien, par jour. Les filtres
 * proposés sont ceux des modules qui ont réellement des activités. */
export function ActivityScreen() {
  const { events, status, fetch } = useActivityStore();
  const [filter, setFilter] = useState<'all' | ActivityModule>('all');

  // Recharge à chaque retour sur l'écran : une activité enregistrée ailleurs doit apparaître.
  useFocusEffect(useCallback(() => { fetch(); }, [fetch]));

  const present = useMemo(() => MODULES.filter((m) => events.some((e) => activityModule(e) === m.key)), [events]);
  const active = filter === 'all' || present.some((m) => m.key === filter) ? filter : 'all';
  const groups = useMemo(
    () => groupActivitiesByDay(selectRecentActivities(events, active === 'all' ? {} : { module: active })),
    [events, active],
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <AppHeader title="Activités" />
      {present.length > 0 && (
        <View className="px-page-margin">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pb-3">
            <Chip label="Tout" active={active === 'all'} onPress={() => setFilter('all')} />
            {present.map((m) => (
              <Chip key={m.key} label={m.label} active={active === m.key} onPress={() => setFilter(m.key)} />
            ))}
          </ScrollView>
        </View>
      )}

      <ScrollView contentContainerClassName="gap-4 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {status === 'loading' && events.length === 0 && <LoadingState />}
        {status === 'error' && <ErrorState onRetry={() => fetch()} />}
        {status === 'success' && groups.length === 0 && (
          <EmptyState icon="analytics" title="Pas encore d'activité" description="Vos actions apparaîtront ici." />
        )}
        {groups.map((group) => (
          <View key={group.label} className="gap-2.5">
            <LabelText className="px-1 pt-1 font-inter-semibold uppercase tracking-wide">{group.label}</LabelText>
            {group.events.map((event) => (
              <ActivityItem key={event.id} event={event} variant="card" />
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
