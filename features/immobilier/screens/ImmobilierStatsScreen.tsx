import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { LabelText } from '@/components/ui/Typography';
import { InfoRow } from '@/components/immobilier/InfoRow';
import { formatFcfa } from '@/utils/format';
import { loadImmobilierStats, type ImmobilierStats, type StatsPeriod } from '@/services/moduleStatsService';

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'month', label: 'Ce mois' },
  { key: 'year', label: 'Cette année' },
];

/** Statistiques d'Immobilier : parc (biens, logements, occupation, contrats), loyers ENCAISSÉS sur la période choisie et
 * loyers impayés (en nombre de loyers). Aucun montant « attendu » n'est affiché : le loyer peut changer d'un mois à l'autre. */
export function ImmobilierStatsScreen() {
  const [period, setPeriod] = useState<StatsPeriod>('all');
  const [stats, setStats] = useState<ImmobilierStats | null | undefined>(undefined);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setStats(await loadImmobilierStats(period));
      setError(false);
    } catch {
      setError(true);
    }
  }, [period]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const plural = (n: number, one: string) => `${n} ${one}${n > 1 ? 's' : ''}`;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Statistiques Immobilier" showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-4 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {error ? (
          <ErrorState onRetry={load} />
        ) : stats === undefined ? (
          <LoadingState />
        ) : stats === null || (stats.biens === 0 && stats.contratsActifs === 0 && stats.encaisse.count === 0) ? (
          <EmptyState icon="bar-chart" title="Aucune statistique" description="Ajoutez un bien, ses logements et ses contrats pour voir ses chiffres ici." />
        ) : (
          <>
            <Card className="gap-0 p-0">
              <InfoRow label="Biens" value={String(stats.biens)} />
              <View className="h-px bg-border" />
              <InfoRow label="Logements" value={`${stats.logements} · ${plural(stats.occupes, 'occupé')} · ${plural(stats.vacants, 'vacant')}`} />
              <View className="h-px bg-border" />
              <InfoRow label="Contrats" value={`${plural(stats.contratsActifs, 'actif')} · ${plural(stats.contratsTermines, 'terminé')}`} />
              <View className="h-px bg-border" />
              <InfoRow label="Loyers impayés" value={stats.impayes.loyers === 0 ? 'Aucun' : `${plural(stats.impayes.loyers, 'loyer')} · ${plural(stats.impayes.contrats, 'contrat')}`} />
            </Card>

            <View className="gap-3">
              <View className="flex-row gap-2">
                {PERIODS.map((p) => (
                  <Chip key={p.key} label={p.label} active={period === p.key} onPress={() => setPeriod(p.key)} />
                ))}
              </View>
              <Card className="gap-0 p-0">
                <InfoRow label="Loyers encaissés" value={formatFcfa(stats.encaisse.amount)} />
                <View className="h-px bg-border" />
                <InfoRow label="Paiements" value={String(stats.encaisse.count)} />
              </Card>
              {stats.encaisse.sansDate > 0 && (
                <LabelText>
                  {stats.encaisse.sansDate > 1
                    ? `${stats.encaisse.sansDate} paiements sans date enregistrée ne sont pas comptés dans cette période.`
                    : '1 paiement sans date enregistrée n’est pas compté dans cette période.'}
                </LabelText>
              )}
            </View>
            <LabelText>Encaissé = paiements enregistrés dont la date de validation est dans la période. Un loyer attendu n&apos;est pas affiché en montant : le loyer peut changer d&apos;un mois à l&apos;autre.</LabelText>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
