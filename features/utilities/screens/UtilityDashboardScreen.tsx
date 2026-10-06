import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { LabelText, SectionTitleText } from '@/components/ui/Typography';
import { InfoRow } from '@/components/immobilier/InfoRow';
import { Colors } from '@/constants/theme';
import { formatFcfa } from '@/utils/format';
import { periodeLabel } from '@/services/utilityBillingService';
import { loadModuleOverview, type ModuleDashboard } from '@/services/utilityOverviewService';
import type { UtilityModule } from '@/services/utilityParticipantsService';
import { HistoryRowCard } from '../components/HistoryRowCard';
import { MODULE_META } from '../meta';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Accueil d'un module (CEET ou TDE) : l'essentiel d'un coup d'œil et les actions
 * principales. Rien n'est stocké ici — tout est calculé depuis les participants,
 * relevés, factures et parts réels ; un module vide l'affiche honnêtement. */
export function UtilityDashboardScreen({ module }: { module: UtilityModule }) {
  const meta = MODULE_META[module];
  const [data, setData] = useState<ModuleDashboard | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setData((await loadModuleOverview(module)).dashboard);
      setError(false);
    } catch {
      setError(true);
    }
  }, [module]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const go = (path: string) => router.push(path as never);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title={meta.label} showBack trailing={<MaterialIcons name={meta.icon} size={22} color={Colors.primary} />} />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <LabelText>{meta.subtitle}</LabelText>

        {error ? (
          <ErrorState onRetry={load} />
        ) : !data ? (
          <LoadingState />
        ) : (
          <>
            <Card className="gap-0 p-0">
              <InfoRow label="Participants" value={String(data.participants)} />
              <View className="h-px bg-border" />
              <InfoRow label="Dernier relevé" value={data.lastReleve ? cap(periodeLabel(data.lastReleve.periode)) : '—'} />
              <View className="h-px bg-border" />
              <InfoRow
                label="Dernière facture"
                value={data.lastFacture ? `${data.lastFacture.montant !== null ? formatFcfa(data.lastFacture.montant) : '—'} · ${/^\d{4}-\d{2}$/.test(data.lastFacture.periode) ? periodeLabel(data.lastFacture.periode) : data.lastFacture.periode}` : '—'}
              />
              <View className="h-px bg-border" />
              <InfoRow label="À recevoir" value={formatFcfa(data.aRecevoir)} />
            </Card>

            <View className="gap-3">
              <PrimaryButton label="Enregistrer les index" icon={meta.icon} onPress={() => go(`/${module}/releves`)} />
              <SecondaryButton label="Calculer une facture" icon="calculate" onPress={() => router.push({ pathname: '/factures/facture-partagee-new', params: { fournisseur: module } } as never)} />
              <View className="flex-row gap-3">
                <View className="flex-1"><SecondaryButton label="Participants" icon="group" onPress={() => go(`/${module}/participants`)} /></View>
                <View className="flex-1"><SecondaryButton label="Historique" icon="history" onPress={() => go(`/${module}/historique`)} /></View>
              </View>
            </View>

            {data.participants === 0 && <LabelText>Commencez par ajouter les participants concernés, puis enregistrez leurs index.</LabelText>}

            {data.aRegler.length > 0 && (
              <View className="gap-3">
                <SectionTitleText className="text-base">À régler</SectionTitleText>
                {data.aRegler.slice(0, 3).map((row) => (
                  <HistoryRowCard key={row.factureId} row={row} onPress={() => go(`/factures/facture-partagee/${row.factureId}`)} />
                ))}
                {data.aRegler.length > 3 && <SecondaryButton label={`Voir les ${data.aRegler.length} factures à régler`} onPress={() => go(`/${module}/historique`)} />}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
