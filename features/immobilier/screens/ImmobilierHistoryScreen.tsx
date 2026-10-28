import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { ActivityItem } from '@/components/ui/ActivityItem';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { LabelText } from '@/components/ui/Typography';
import { groupActivitiesByDay } from '@/services/activityService';
import { loadImmobilierHistory } from '@/services/moduleStatsService';
import type { ActivityEvent } from '@/types/entities';

/** Historique d'Immobilier : les loyers réellement enregistrés (y compris ceux d'avant le journal d'activités) et les
 * événements du module (bien, logement, contrat…). Les événements des autres modules n'y figurent jamais. Les paiements
 * antérieurs ne sont pas reconstitués : seuls les enregistrements existants sont affichés. */
export function ImmobilierHistoryScreen() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setEvents(await loadImmobilierHistory());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const groups = useMemo(() => groupActivitiesByDay(events ?? []), [events]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Historique Immobilier" showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {error ? (
          <ErrorState onRetry={load} />
        ) : !events ? (
          <LoadingState />
        ) : groups.length === 0 ? (
          <EmptyState icon="history" title="Pas encore d'historique" description="Les loyers enregistrés et les actions sur vos biens, logements et contrats apparaîtront ici." />
        ) : (
          <>
            {groups.map((group) => (
              <View key={group.label} className="gap-3">
                <SectionHeader title={group.label} />
                <View className="rounded-lg border border-border bg-surface p-gutter-card shadow-soft">
                  {group.events.map((event, i) => (
                    <ActivityItem key={event.id} event={event} isLast={i === group.events.length - 1} />
                  ))}
                </View>
              </View>
            ))}
            <LabelText>Seuls les paiements et événements réellement enregistrés sont listés.</LabelText>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
