import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { IconButton, PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { SectionTitleText } from '@/components/ui/Typography';
import { InfoRow } from '@/components/immobilier/InfoRow';
import { TontineSpaceCard } from '@/components/tontine/TontineSpaceCard';
import { InlineNotice } from '@/features/utilities/components/InlineNotice';
import { formatFcfa, formatLongDate } from '@/utils/format';
import { loadTontineOverview, type TontineOverview } from '@/services/tontineOverviewService';

/** Espace Tontine : l'entrée de l'outil. Résumé, liste des tontines, accès à l'historique et aux
 * statistiques du module ; « Nouvelle tontine » (le formulaire existant) est une action secondaire. */
export function TontineSpaceScreen() {
  const { justDeleted } = useLocalSearchParams<{ justDeleted?: string }>();
  const [overview, setOverview] = useState<TontineOverview | null>(null);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await loadTontineOverview());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!justDeleted) return;
    setNotice(justDeleted);
    router.setParams({ justDeleted: undefined });
  }, [justDeleted]);

  const create = () => router.push('/tontine/create');
  const next = overview?.nextTour;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Tontine" showBack trailing={<IconButton icon="add" onPress={create} />} />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {notice && <InlineNotice tone="success">{notice}</InlineNotice>}

        {error ? (
          <ErrorState onRetry={load} />
        ) : !overview ? (
          <LoadingState />
        ) : overview.tontines.length === 0 ? (
          <EmptyState
            icon="savings"
            title="Aucune tontine"
            description="Créez votre première tontine pour commencer."
            actionLabel="+ Nouvelle tontine"
            onAction={create}
          />
        ) : (
          <>
            <Card className="gap-0 p-0">
              <InfoRow label="Tontines actives" value={String(overview.activeTontines)} />
              <View className="h-px bg-border" />
              <InfoRow label="Membres" value={String(overview.distinctMembers)} />
              <View className="h-px bg-border" />
              <InfoRow
                label="Prochain tour"
                value={next ? `${next.name} · ${next.beneficiary ?? '—'} · ${formatLongDate(new Date(next.date))}${next.late ? ' (en retard)' : ''}` : '—'}
              />
              <View className="h-px bg-border" />
              <InfoRow
                label="Cotisations en attente"
                value={overview.pendingContributions === null ? '—' : `${overview.pendingContributions}${overview.expectedAmount ? ` · ${formatFcfa(overview.expectedAmount)}` : ''}`}
              />
              {overview.lateTontines > 0 && (
                <>
                  <View className="h-px bg-border" />
                  <InfoRow label="En retard" value={`${overview.lateTontines} tontine${overview.lateTontines > 1 ? 's' : ''}`} />
                </>
              )}
            </Card>

            <View className="gap-3">
              <SectionTitleText className="text-base">Mes tontines</SectionTitleText>
              {overview.tontines.map((card) => (
                <TontineSpaceCard key={card.groupId} card={card} />
              ))}
            </View>

            <View className="flex-row gap-3">
              <View className="flex-1"><SecondaryButton label="Historique" icon="history" onPress={() => router.push('/tontine/historique' as never)} /></View>
              <View className="flex-1"><SecondaryButton label="Statistiques" icon="bar-chart" onPress={() => router.push('/tontine/statistiques' as never)} /></View>
            </View>

            <PrimaryButton label="+ Nouvelle tontine" onPress={create} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
