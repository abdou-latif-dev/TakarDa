import { useState } from 'react';
import { View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Switch } from '@/components/ui/Switch';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { disableAdvanceUse, enableAdvanceUse, getAdvanceStatus } from '@/services/rentAdvanceService';
import { describeMonths } from '@/services/rentTermsService';
import { formatFcfa } from '@/utils/format';
import type { RecordItem } from '@/types/entities';

interface Props {
  contrat: RecordItem;
  paiements: RecordItem[];
  /** Appelé après un changement, pour recharger l'écran. */
  onChanged: () => void | Promise<void>;
}

const amountOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Avance et caution, séparées. L'avance peut être consommée automatiquement pour les loyers à venir — seulement si le
 * bailleur l'autorise ; la caution n'est jamais utilisée pour un loyer. */
export function AdvanceCard({ contrat, paiements, onChanged }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avance = amountOf(contrat.values.avance);
  const caution = amountOf(contrat.values.caution);
  const loyer = amountOf(contrat.values.loyer_mensuel);
  if (!avance && !caution) return null;

  const status = getAdvanceStatus(contrat, paiements);
  const actif = contrat.statusKey === 'actif';

  const toggle = async (next: boolean) => {
    setError(null);
    if (next) return setConfirming(true);
    setBusy(true);
    try {
      await disableAdvanceUse(contrat.id);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await enableAdvanceUse(contrat.id);
      setConfirming(false);
      await onChanged();
    } catch (e) {
      setConfirming(false);
      setError(e instanceof Error ? e.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3">
      <SectionTitleText className="text-base">Avance et caution</SectionTitleText>

      {avance ? (
        <View className="gap-0.5">
          <View className="flex-row items-center justify-between gap-3">
            <LabelText>Avance</LabelText>
            <LabelText className="font-inter-semibold text-text-primary">{formatFcfa(avance)}</LabelText>
          </View>
          {loyer ? <LabelText>{describeMonths(avance, loyer) ? `≈ ${describeMonths(avance, loyer)} de loyer` : ''}</LabelText> : null}
        </View>
      ) : null}
      {caution ? (
        <View className="gap-0.5">
          <View className="flex-row items-center justify-between gap-3">
            <LabelText>Caution</LabelText>
            <LabelText className="font-inter-semibold text-text-primary">{formatFcfa(caution)}</LabelText>
          </View>
          <LabelText>Montant à part : jamais utilisé pour payer un loyer, et ce n’est pas un revenu.</LabelText>
        </View>
      ) : null}

      {avance && actif ? (
        <View className="gap-2 border-t border-border pt-3">
          <View className="flex-row items-center gap-3">
            <View className="min-w-0 flex-1 gap-0.5">
              <LabelText className="font-inter-semibold text-text-primary">Utiliser automatiquement l’avance pour les loyers futurs</LabelText>
              <LabelText>Désactivé par défaut. Chaque mois dû est alors couvert par l’avance, sans paiement ni reçu.</LabelText>
            </View>
            <Switch value={status.authorized} onValueChange={(v) => { if (!busy) void toggle(v); }} />
          </View>
          {status.authorized && (
            <View className="gap-0.5 rounded-md bg-primary-soft p-3">
              <LabelText>Avance restante</LabelText>
              <SectionTitleText className="text-base">{formatFcfa(status.balance)}</SectionTitleText>
              <LabelText>
                {status.coveredMonths} mois couvert{status.coveredMonths > 1 ? 's' : ''} · {status.monthsLeft} mois encore couvrable{status.monthsLeft > 1 ? 's' : ''}
              </LabelText>
              {status.unusableRemainder > 0 && (
                <LabelText>Reste de {formatFcfa(status.unusableRemainder)} : inférieur à un loyer, il n’est pas utilisé automatiquement.</LabelText>
              )}
            </View>
          )}
          {status.authorized && status.exhausted && (
            <BodyMdText style={{ color: Colors.warning }} className="font-inter-semibold">
              L’avance est épuisée : un paiement normal est de nouveau nécessaire chaque mois.
            </BodyMdText>
          )}
        </View>
      ) : null}
      {error && <LabelText className="font-inter-semibold" style={{ color: Colors.error }}>{error}</LabelText>}

      <Dialog
        visible={confirming}
        onClose={() => setConfirming(false)}
        title="Utiliser l’avance automatiquement ?"
        message={`Chaque mois dû${loyer ? `, un loyer de ${formatFcfa(loyer)}` : ''} sera couvert par l’avance (${formatFcfa(status.balance)} disponibles), sans paiement ni reçu, jusqu’à épuisement. Les mois déjà écoulés ne sont pas concernés. La caution n’est jamais touchée.`}
        actions={[
          { label: 'Activer', onPress: () => void confirm(), loading: busy },
          { label: 'Annuler', variant: 'secondary', onPress: () => setConfirming(false) },
        ]}
      />
    </Card>
  );
}
