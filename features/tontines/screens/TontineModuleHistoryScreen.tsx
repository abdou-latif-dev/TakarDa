import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { ActivityItem } from '@/components/ui/ActivityItem';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { EmptyState } from '@/components/ui/States';
import { groupActivitiesByDay } from '@/services/activityService';
import { getTontineHistory } from '@/services/tontineOverviewService';
import type { ActivityEvent } from '@/types/entities';

/** Historique du module Tontine : ses propres événements (tontine créée, membre ajouté, cotisation,
 * tour suivant…), filtrés dans le journal — ce n'est pas l'écran global Activités. Le détail tour par
 * tour d'une tontine reste dans son propre écran « Historique ». */
export function TontineModuleHistoryScreen() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  useFocusEffect(useCallback(() => { setEvents(getTontineHistory()); }, []));
  const groups = useMemo(() => groupActivitiesByDay(events), [events]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Historique Tontine" showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {groups.length === 0 ? (
          <EmptyState icon="history" title="Pas encore d'historique" description="Les actions de vos tontines apparaîtront ici." />
        ) : (
          groups.map((group) => (
            <View key={group.label} className="gap-3">
              <SectionHeader title={group.label} />
              <View className="rounded-lg border border-border bg-surface p-gutter-card shadow-soft">
                {group.events.map((event, i) => (
                  <ActivityItem key={event.id} event={event} isLast={i === group.events.length - 1} />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
