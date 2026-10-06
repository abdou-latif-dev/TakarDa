import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { Colors } from '@/constants/theme';
import { loadModuleOverview, type HistoryRow } from '@/services/utilityOverviewService';
import type { UtilityModule } from '@/services/utilityParticipantsService';
import { HistoryRowCard } from '../components/HistoryRowCard';
import { MODULE_META } from '../meta';

/** Historique d'un module : une ligne par facture (la plus récente d'abord) avec
 * montant, méthode et « n/N payés ». Un appui ouvre la facture : parts, paiements
 * et reçus. Calculé depuis les données réelles. */
export function UtilityHistoryScreen({ module }: { module: UtilityModule }) {
  const meta = MODULE_META[module];
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await loadModuleOverview(module)).history);
      setError(false);
    } catch {
      setError(true);
    }
  }, [module]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title={`Historique ${meta.label}`} showBack trailing={<MaterialIcons name={meta.icon} size={22} color={Colors.primary} />} />
      <ScrollView contentContainerClassName="w-full max-w-3xl gap-3 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        {error ? (
          <ErrorState onRetry={load} />
        ) : !rows ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="history"
            title={`Aucune facture ${meta.label}`}
            description="Les factures réparties entre vos participants apparaîtront ici, avec leurs paiements."
            actionLabel="Calculer une facture"
            onAction={() => router.push({ pathname: '/factures/facture-partagee-new', params: { fournisseur: module } } as never)}
          />
        ) : (
          <View className="gap-3">
            {rows.map((row) => (
              <HistoryRowCard key={row.factureId} row={row} onPress={() => router.push(`/factures/facture-partagee/${row.factureId}` as never)} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
