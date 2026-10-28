import { useEffect, useState } from 'react';
import { Alert, Pressable, Share, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { PaiementCorrectionDialog } from './PaiementCorrectionDialog';
import { describeCorrection, mustCorrectPayment, paymentCorrectionHistory } from '@/services/paymentCorrectionService';
import { useAuthStore } from '@/store/authStore';
import { buildRentReceiptText, receiptReference } from '@/services/rentReceiptService';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { formatMonth } from '@/components/ui/MonthPicker';
import { Colors } from '@/constants/theme';
import { formatFcfa } from '@/utils/format';
import { buildPaiementTimeline, enregistrerPaiementLoyer, formatDay, type PaiementTimelineRow } from '@/services/immobilierService';
import type { RecordItem } from '@/types/entities';

interface Props {
  contrat: RecordItem;
  paiements: RecordItem[];
  locataireNom: string;
  logementNom: string;
  bienNom?: string;
  /** Appelé après un paiement enregistré, pour recharger l'écran. */
  onRecorded: () => void | Promise<void>;
}

/** « Enregistrer le paiement » : un seul bouton, aucune saisie. Le mois, le
 * montant, le locataire et le logement viennent du contrat actif ; le résultat
 * est directement « Payé » et le mois suivant apparaît « À payer ». Un paiement
 * enregistré est un événement historique : on le consulte, on ne l'édite pas. */
export function PaiementsSection({ contrat, paiements, locataireNom, logementNom, bienNom, onRecorded }: Props) {
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<PaiementTimelineRow | null>(null);
  // F2 : un paiement déjà confirmé dans le cloud ne se modifie plus ; il se corrige ou s'annule (nouveau fait, avec motif)
  const [mustCorrect, setMustCorrect] = useState(false);
  const [historyLines, setHistoryLines] = useState<string[]>([]);
  const [correcting, setCorrecting] = useState(false);
  const owner = useAuthStore((st) => st.user?.name?.trim());
  const rows = buildPaiementTimeline(contrat, paiements);
  const actif = contrat.statusKey === 'actif';

  const selectedPaiement = selected?.paiement ?? null;
  useEffect(() => {
    let cancelled = false;
    setMustCorrect(false);
    setHistoryLines([]);
    if (!selectedPaiement) return;
    void (async () => {
      try {
        const [must, history] = await Promise.all([mustCorrectPayment(selectedPaiement), paymentCorrectionHistory(selectedPaiement.id)]);
        if (cancelled) return;
        setMustCorrect(must);
        setHistoryLines(history.map((c) => describeCorrection(c, formatFcfa)));
      } catch {
        // lecture locale impossible : on n'affiche ni action ni historique (le paiement reste consultable)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPaiement]);

  const onRecord = async () => {
    setSaving(true);
    try {
      await enregistrerPaiementLoyer(contrat.id);
      await onRecorded();
    } catch (e) {
      Alert.alert('Impossible d’enregistrer', e instanceof Error ? e.message : 'Une erreur est survenue.');
    } finally {
      setSaving(false);
    }
  };

  // Détails d'un VRAI paiement (jamais d'un mois couvert par l'avance : il n'y a ni paiement ni reçu à partager).
  const detailsOf = (row: PaiementTimelineRow) => {
    const p = row.paiement;
    if (!p) return null;
    const date = formatDay(p.values.date_validation ?? p.createdAt);
    const note = [p.values.mode_paiement, p.values.note].filter((v) => typeof v === 'string' && v).join(' — ');
    return [
      `Montant : ${row.montant !== null ? formatFcfa(row.montant) : '—'}`,
      `Enregistré le : ${date}`,
      `Locataire : ${locataireNom}`,
      `Logement : ${logementNom}${bienNom ? ` (${bienNom})` : ''}`,
      `Référence du reçu : ${receiptReference(p.id)}`,
      ...(note ? [`Note : ${note}`] : []),
      ...(historyLines.length > 0 ? ['', 'Corrections :', ...historyLines] : []),
    ].join('\n');
  };

  // Partager ne modifie rien : le texte est calculé, puis passe par le partage natif.
  const shareReceipt = (row: PaiementTimelineRow) => {
    if (!row.paiement) return;
    const message = buildRentReceiptText({
      paiement: row.paiement,
      contrat,
      paiementsDuContrat: paiements.filter((x) => x.values.contrat === contrat.id),
      locataireNom,
      logementNom,
      bienNom,
      bailleurNom: owner && owner !== 'Utilisateur' ? owner : null,
    });
    void Share.share({ title: 'Reçu de paiement de loyer', message });
  };

  return (
    <View className="gap-3">
      {actif && <PrimaryButton label="Enregistrer le paiement" icon="check" loading={saving} onPress={onRecord} />}
      <SectionTitleText className="text-base">Paiements</SectionTitleText>
      {rows.length === 0 ? (
        <BodyMdText>Aucun paiement pour l&apos;instant.</BodyMdText>
      ) : (
        <Card className="gap-0 p-0">
          {rows.map((row, i) => {
            const paye = row.status === 'paye';
            const couvert = row.status === 'couvert';
            const retard = row.status === 'en_retard';
            const annule = row.status === 'annule';
            const tone = paye ? Colors.success : couvert ? Colors.primary : retard || annule ? Colors.error : Colors.textMuted;
            return (
              <View key={`${row.mois}-${row.status}`}>
                {i > 0 && <View className="h-px bg-border" />}
                <Pressable
                  disabled={!paye && !annule}
                  onPress={() => setSelected(row)}
                  className="flex-row items-center gap-3 p-gutter-card active:bg-background-secondary">
                  <MaterialIcons name={paye ? 'check-circle' : couvert ? 'savings' : annule ? 'cancel' : 'radio-button-unchecked'} size={22} color={tone} />
                  <View className="flex-1">
                    <SectionTitleText className="text-base" numberOfLines={1}>{formatMonth(row.mois)}</SectionTitleText>
                    <LabelText style={{ color: tone }}>{paye ? 'Payé' : couvert ? 'Couvert par l’avance' : annule ? 'Annulé' : retard ? 'En retard' : 'À payer'}</LabelText>
                  </View>
                  <LabelText className="font-inter-semibold text-text-primary" numberOfLines={1}>
                    {row.montant !== null ? formatFcfa(row.montant) : ''}
                  </LabelText>
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}
      <Dialog
        visible={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? formatMonth(selected.mois) : ''}
        message={selected ? detailsOf(selected) ?? undefined : undefined}
        actions={[
          ...(selected?.status === 'annule' ? [] : [{ label: 'Partager le reçu', onPress: () => { if (selected) shareReceipt(selected); } }]),
          ...(mustCorrect && selected?.status !== 'annule' ? [{ label: 'Corriger ou annuler', variant: 'secondary' as const, onPress: () => setCorrecting(true) }] : []),
          { label: 'Fermer', variant: 'secondary', onPress: () => setSelected(null) },
        ]}
      />
      <PaiementCorrectionDialog
        visible={correcting && selectedPaiement !== null}
        paiement={selectedPaiement}
        currentAmount={selected?.montant ?? null}
        onClose={() => setCorrecting(false)}
        onDone={async () => {
          setCorrecting(false);
          setSelected(null);
          await onRecorded();
        }}
      />
    </View>
  );
}
