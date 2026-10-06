import { useState } from 'react';
import { Alert, Pressable, Share, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/Button';
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
  const rows = buildPaiementTimeline(contrat, paiements);
  const actif = contrat.statusKey === 'actif';

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

  const openDetails = (row: PaiementTimelineRow) => {
    const p = row.paiement;
    if (!p) return;
    const montantText = row.montant !== null ? formatFcfa(row.montant) : '—';
    const date = formatDay(p.values.date_validation ?? p.createdAt);
    const note = [p.values.mode_paiement, p.values.note].filter((v) => typeof v === 'string' && v).join(' — ');
    const lines = [
      `Montant : ${montantText}`,
      `Enregistré le : ${date}`,
      `Locataire : ${locataireNom}`,
      `Logement : ${logementNom}${bienNom ? ` (${bienNom})` : ''}`,
      ...(note ? [`Note : ${note}`] : []),
    ];
    Alert.alert(formatMonth(row.mois), lines.join('\n'), [
      { text: 'Fermer', style: 'cancel' },
      {
        text: 'Partager le reçu',
        onPress: () => Share.share({ title: 'Reçu de loyer', message: ['REÇU DE LOYER', `Mois : ${formatMonth(row.mois)}`, ...lines].join('\n') }),
      },
    ]);
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
            const retard = row.status === 'en_retard';
            const tone = paye ? Colors.success : retard ? Colors.error : Colors.textMuted;
            return (
              <View key={`${row.mois}-${row.status}`}>
                {i > 0 && <View className="h-px bg-border" />}
                <Pressable
                  disabled={!paye}
                  onPress={() => openDetails(row)}
                  className="flex-row items-center gap-3 p-gutter-card active:bg-background-secondary">
                  <MaterialIcons name={paye ? 'check-circle' : 'radio-button-unchecked'} size={22} color={tone} />
                  <View className="flex-1">
                    <SectionTitleText className="text-base" numberOfLines={1}>{formatMonth(row.mois)}</SectionTitleText>
                    <LabelText style={{ color: tone }}>{paye ? 'Payé' : retard ? 'En retard' : 'À payer'}</LabelText>
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
    </View>
  );
}
