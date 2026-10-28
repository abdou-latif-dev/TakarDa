import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { LabelText, SectionTitleText } from '@/components/ui/Typography';
import { InfoRow } from '@/components/immobilier/InfoRow';
import { formatFcfa } from '@/utils/format';
import { periodeLabel } from '@/services/utilityBillingService';
import { loadUtilityStats, type UtilityPeriodStat, type UtilityStats } from '@/services/moduleStatsService';
import type { UtilityModule } from '@/services/utilityParticipantsService';
import { MODULE_META } from '../meta';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const formatNumber = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

function periodLine(row: UtilityPeriodStat, unit: string): string {
  const parts = [row.montantFacture !== null ? formatFcfa(row.montantFacture) : 'montant non disponible'];
  parts.push(row.consommation !== null ? `${formatNumber(row.consommation)} ${unit}` : 'consommation non disponible');
  if (row.variation !== null) parts.push(`${row.variation > 0 ? '+' : ''}${formatNumber(row.variation)} % vs mois précédent`);
  return parts.join(' · ');
}

/** Statistiques d'un module CEET ou TDE : factures validées, parts et montants payés/restants, puis les périodes avec leur
 * consommation. Tout vient des parts FIGÉES à la validation (jamais recalculé depuis les relevés) ; une consommation
 * absente (partage équitable) est dite « non disponible », jamais remplacée par 0, et aucune variation n'est calculée sans
 * deux consommations connues sur deux mois consécutifs. */
export function UtilityStatsScreen({ module }: { module: UtilityModule }) {
  const meta = MODULE_META[module];
  const [stats, setStats] = useState<UtilityStats | null | undefined>(undefined);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setStats(await loadUtilityStats(module));
      setError(false);
    } catch {
      setError(true);
    }
  }, [module]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title={`Statistiques ${meta.label}`} showBack />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-4 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {error ? (
          <ErrorState onRetry={load} />
        ) : stats === undefined ? (
          <LoadingState />
        ) : stats === null || (stats.facturesValidees === 0 && stats.facturesEnAttente === 0) ? (
          <EmptyState
            icon="bar-chart"
            title={`Aucune facture ${meta.label}`}
            description="Calculez et validez une facture pour voir ses chiffres ici."
            actionLabel="Calculer une facture"
            onAction={() => router.push({ pathname: '/factures/facture-partagee-new', params: { fournisseur: module } } as never)}
          />
        ) : (
          <>
            <Card className="gap-0 p-0">
              <InfoRow label="Factures validées" value={String(stats.facturesValidees)} />
              <View className="h-px bg-border" />
              <InfoRow label="En attente de répartition" value={String(stats.facturesEnAttente)} />
              <View className="h-px bg-border" />
              <InfoRow label="Parts payées" value={`${stats.parts.payees} sur ${stats.parts.total}`} />
              <View className="h-px bg-border" />
              <InfoRow label="Parts restantes" value={String(stats.parts.restantes)} />
              <View className="h-px bg-border" />
              <InfoRow label="Montant payé" value={formatFcfa(stats.montants.paye)} />
              <View className="h-px bg-border" />
              <InfoRow label="Montant restant" value={formatFcfa(stats.montants.restant)} />
            </Card>

            <View className="gap-3">
              <SectionTitleText className="text-base">Par période</SectionTitleText>
              {stats.periodes.length === 0 ? (
                <LabelText>Aucune facture validée avec une période exploitable.</LabelText>
              ) : (
                <Card className="gap-3">
                  {stats.periodes.slice(0, 12).map((row) => (
                    <View key={row.periode}>
                      <LabelText className="font-inter-semibold text-text-primary">{capitalize(periodeLabel(row.periode))}</LabelText>
                      <LabelText>{periodLine(row, meta.unit)}</LabelText>
                    </View>
                  ))}
                </Card>
              )}
              {stats.periodesNonStandard > 0 && (
                <LabelText>
                  {stats.periodesNonStandard} facture{stats.periodesNonStandard > 1 ? 's' : ''} validée{stats.periodesNonStandard > 1 ? 's' : ''} sans période au format mois/année {stats.periodesNonStandard > 1 ? 'sont comptées' : 'est comptée'} dans les totaux mais pas dans ce détail.
                </LabelText>
              )}
            </View>
            <LabelText>Montants et consommations figés à la validation de chaque facture. Une consommation n&apos;est connue que pour une répartition par compteur ; la variation n&apos;est calculée que entre deux mois consécutifs connus.</LabelText>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
