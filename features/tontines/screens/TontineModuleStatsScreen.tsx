import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { LabelText } from '@/components/ui/Typography';
import { InfoRow } from '@/components/immobilier/InfoRow';
import { formatFcfa } from '@/utils/format';
import { loadTontineStats, type TontineStats } from '@/services/tontineOverviewService';

/** Statistiques du module Tontine (préparation V1) : quelques chiffres réels, sur les tours déjà
 * générés. Les tours à venir n'existent pas encore et ne sont pas comptés. */
export function TontineModuleStatsScreen() {
  const [stats, setStats] = useState<TontineStats | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setStats(await loadTontineStats());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Statistiques Tontine" showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-4 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {error ? (
          <ErrorState onRetry={load} />
        ) : !stats ? (
          <LoadingState />
        ) : stats.tontines === 0 ? (
          <EmptyState icon="bar-chart" title="Aucune statistique" description="Créez une tontine pour voir ses chiffres ici." />
        ) : (
          <>
            <Card className="gap-0 p-0">
              <InfoRow label="Tontines" value={String(stats.tontines)} />
              <View className="h-px bg-border" />
              <InfoRow label="Membres" value={String(stats.distinctMembers)} />
              <View className="h-px bg-border" />
              <InfoRow label="Tours complets" value={`${stats.toursComplete} sur ${stats.toursGenerated}`} />
              <View className="h-px bg-border" />
              <InfoRow label="Cotisations payées" value={String(stats.paidContributions)} />
              <View className="h-px bg-border" />
              <InfoRow label="Cotisations en attente" value={String(stats.pendingContributions)} />
              <View className="h-px bg-border" />
              <InfoRow label="Cotisations en retard" value={String(stats.lateContributions)} />
              <View className="h-px bg-border" />
              <InfoRow label="Total versé" value={formatFcfa(stats.collected)} />
              <View className="h-px bg-border" />
              <InfoRow label="Attendu" value={formatFcfa(stats.expected)} />
              <View className="h-px bg-border" />
              <InfoRow label="Reste à verser" value={formatFcfa(stats.remaining)} />
              <View className="h-px bg-border" />
              <InfoRow label="Montants versés / attendus" value={stats.paymentRate === null ? '—' : `${Math.round(stats.paymentRate * 100)} %`} />
            </Card>
            <LabelText>Calculé sur les tours déjà générés ; les tours à venir ne sont pas comptés.</LabelText>
            {stats.members !== stats.distinctMembers && (
              <LabelText>
                Une personne présente dans plusieurs tontines (comme vous) n&apos;est comptée qu&apos;une fois ; les invités ajoutés à la main ne peuvent pas être rapprochés d&apos;une tontine à l&apos;autre.
              </LabelText>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
