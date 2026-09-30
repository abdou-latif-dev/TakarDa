import { useEffect, useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconButton } from '@/components/ui/Button';
import { TontineListCard } from '@/components/tontine/TontineListCard';
import { useGroupStore } from '@/store/groupStore';

/** Superseded in the tab bar by MesModelesScreen (see app/(tabs)/_layout.tsx),
 * kept routable for any deep link that still points here. Renders the exact
 * same TontineListCard MesModelesScreen uses — no more independent progress
 * calculation (Tour/Boucle audit, 2026-09-30, §32). */
export function MesTontinesScreen() {
  const { groups, status, fetchGroups } = useGroupStore();

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const tontines = useMemo(() => groups.filter((g) => g.kind === 'tontine'), [groups]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
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

        {tontines.length > 0 && (
          <View className="gap-3">
            <SectionHeader title="Tontines" />
            <View className="gap-3">
              {tontines.map((t) => (
                <TontineListCard key={t.id} tontine={t} />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
