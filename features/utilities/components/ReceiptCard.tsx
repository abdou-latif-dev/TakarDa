import { View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { SecondaryButton } from '@/components/ui/Button';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { buildReceiptLines, type ReceiptData } from '@/services/utilityBillingService';

/** Reçu d'une part, affiché à partir des valeurs FIGÉES dans la part (jamais
 * recalculées depuis les relevés actuels) : module, période, participant, montant,
 * statut, date, et selon la méthode les index/consommation/prix unitaire ou le
 * nombre de participants. */
export function ReceiptCard({ data, onShare }: { data: ReceiptData; onShare: () => void }) {
  const lines = buildReceiptLines(data);
  return (
    <Card className="gap-3">
      <SectionTitleText className="text-base">{data.statut === 'payee' ? 'Reçu de paiement' : 'Détail de la part'}</SectionTitleText>
      <View className="gap-2">
        {lines.map((l) => (
          <View key={l.label} className="flex-row items-start justify-between gap-3">
            <LabelText className="shrink-0">{l.label}</LabelText>
            <BodyMdText className="flex-1 text-right text-text-primary">{l.value}</BodyMdText>
          </View>
        ))}
      </View>
      <SecondaryButton label="Partager le reçu" icon="share" onPress={onShare} />
    </Card>
  );
}
