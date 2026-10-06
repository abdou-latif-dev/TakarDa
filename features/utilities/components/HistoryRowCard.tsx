import { Pressable, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { formatFcfa } from '@/utils/format';
import { periodeLabel } from '@/services/utilityBillingService';
import type { HistoryRow, InvoiceState } from '@/services/utilityOverviewService';

const STATE_LABEL: Record<InvoiceState, string> = { a_repartir: 'À répartir', a_payer: 'À payer', partielle: 'Partiellement payée', payee: 'Payée' };
const STATE_COLOR: Record<InvoiceState, () => string> = {
  a_repartir: () => Colors.textMuted,
  a_payer: () => Colors.warning,
  partielle: () => Colors.warning,
  payee: () => Colors.success,
};

/** Une facture du module : période, montant, méthode, « n/N payés » et état. Un
 * appui ouvre la facture (parts, paiements, reçus). */
export function HistoryRowCard({ row, onPress }: { row: HistoryRow; onPress: () => void }) {
  const periode = /^\d{4}-\d{2}$/.test(row.periode) ? periodeLabel(row.periode) : row.periode || '—';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="active:opacity-80">
      <Card className="gap-1">
        <View className="flex-row items-center justify-between gap-3">
          <SectionTitleText className="flex-1 text-base" numberOfLines={1}>{periode.charAt(0).toUpperCase() + periode.slice(1)}</SectionTitleText>
          <LabelText className="font-inter-semibold text-text-primary">{row.montantTotal !== null ? formatFcfa(row.montantTotal) : '—'}</LabelText>
        </View>
        <LabelText numberOfLines={2}>
          {row.methode ?? 'Pas encore répartie'}
          {row.total > 0 ? ` · ${row.paid}/${row.total} payé${row.total > 1 ? 's' : ''}` : ''}
          {row.state === 'a_payer' || row.state === 'partielle' ? ` · ${formatFcfa(row.montantRestant)} à recevoir` : ''}
        </LabelText>
        <View className="flex-row items-center justify-between">
          <LabelText className="font-inter-semibold" style={{ color: STATE_COLOR[row.state]() }}>{STATE_LABEL[row.state]}</LabelText>
          <MaterialIcons name="chevron-right" size={20} color={Colors.textMuted} />
        </View>
      </Card>
    </Pressable>
  );
}
