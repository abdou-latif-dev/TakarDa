import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { formatFcfa } from '@/utils/format';
import { periodeLabel } from '@/services/utilityBillingService';
import { formatPaymentDate, loadUtilityPayments, type UtilityPaymentRow } from '@/services/moduleStatsService';
import { loadModuleOverview, type HistoryRow } from '@/services/utilityOverviewService';
import type { UtilityModule } from '@/services/utilityParticipantsService';
import { HistoryRowCard } from '../components/HistoryRowCard';
import { MODULE_META } from '../meta';

const MAX_PAYMENTS = 20;

/** Historique d'un module : une ligne par facture (la plus récente d'abord) avec
 * montant, méthode et « n/N payés », puis les paiements de parts avec leur date réelle. Un appui sur
 * une facture l'ouvre : parts, paiements et reçus. Calculé depuis les données réelles, propres au fournisseur. */
export function UtilityHistoryScreen({ module }: { module: UtilityModule }) {
  const meta = MODULE_META[module];
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [payments, setPayments] = useState<UtilityPaymentRow[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [overview, paid] = await Promise.all([loadModuleOverview(module), loadUtilityPayments(module)]);
      setRows(overview.history);
      setPayments(paid);
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
          <>
            <View className="gap-3">
              {rows.map((row) => (
                <HistoryRowCard key={row.factureId} row={row} onPress={() => router.push(`/factures/facture-partagee/${row.factureId}` as never)} />
              ))}
            </View>

            {payments.length > 0 && (
              <View className="mt-3 gap-3">
                <SectionTitleText className="text-base">Paiements</SectionTitleText>
                <Card className="gap-3">
                  {payments.slice(0, MAX_PAYMENTS).map((p) => (
                    <View key={p.partId} className="flex-row items-start justify-between gap-3">
                      <View className="flex-1">
                        <LabelText className="font-inter-semibold text-text-primary" numberOfLines={1}>{p.label}</LabelText>
                        <LabelText>
                          {/^\d{4}-\d{2}$/.test(p.periode) ? periodeLabel(p.periode) : p.periode || '—'} · {formatPaymentDate(p.datePaiement)}
                        </LabelText>
                      </View>
                      <LabelText className="font-inter-semibold text-text-primary">{p.montant !== null ? formatFcfa(p.montant) : '—'}</LabelText>
                    </View>
                  ))}
                </Card>
                {payments.length > MAX_PAYMENTS && <LabelText>{payments.length - MAX_PAYMENTS} paiement(s) plus ancien(s) ne sont pas affichés ici ; ils restent dans leur facture.</LabelText>}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
