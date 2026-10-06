import { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { DateField } from '@/components/ui/DateField';
import { formatMonth, MonthPicker } from '@/components/ui/MonthPicker';
import { PrimaryButton, SecondaryButton, IconButton } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { SectionTitleText, LabelText, BodyMdText } from '@/components/ui/Typography';
import { InfoRow } from '@/components/immobilier/InfoRow';
import { PaiementsSection } from '@/components/immobilier/PaiementsSection';
import { Colors } from '@/constants/theme';
import { CoreFieldRenderer } from '@/components/core/CoreFieldRenderer';
import { formatFcfa, formatRelativeTime } from '@/utils/format';
import { coreService } from '@/services/coreService';
import {
  deleteContratCascade,
  ensureImmobilierTool,
  formatDay,
  isValidPhone,
  loadContratDetail,
  normalizeDernierLoyerPaye,
  parseAmount,
  parseDay,
  terminerContrat,
  toIsoDay,
  updateLocataire,
  type ContratDetail,
} from '@/services/immobilierService';
import type { FieldDefinition, FieldValue } from '@/types/entities';

const STATUT_LABEL: Record<string, string> = { actif: 'Actif', termine: 'Terminé', archive: 'Archivé' };

/** Contrat d'un locataire dans un logement : termes de la location, locataire
 * (contact), paiements (validation manuelle), historique complet. */
export function ContratDetailScreen() {
  // Computed inside the component, not at module scope (see the Étape 4A theme audit).
  const LATENESS_TONE: Record<string, string> = { a_jour: Colors.success, retard: Colors.error, sans_paiement: Colors.textMuted };
  const { contratId } = useLocalSearchParams<{ contratId: string }>();
  const [detail, setDetail] = useState<ContratDetail | null>(null);
  const [customFields, setCustomFields] = useState<FieldDefinition[]>([]);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [loyer, setLoyer] = useState('');
  const [caution, setCaution] = useState('');
  const [avance, setAvance] = useState('');
  const [jour, setJour] = useState('');
  const [dateEntree, setDateEntree] = useState(new Date());
  const [dernierLoyer, setDernierLoyer] = useState<string | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, FieldValue>>({});

  const load = useCallback(async () => {
    try {
      const [result, ents] = await Promise.all([loadContratDetail(contratId), ensureImmobilierTool()]);
      setDetail(result);
      setCustomFields(ents.contrat.fields.filter((f) => f.key.startsWith('custom_')));
      setError(false);
    } catch {
      setError(true);
    }
  }, [contratId]);

  // Recharge au retour (nouveau paiement, validation…).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <ErrorState onRetry={load} />
        </View>
      </SafeAreaView>
    );
  }
  if (!detail) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const { contrat, logement, bien, locataire, paiements, lateness, events } = detail;
  const actif = contrat.statusKey === 'actif';
  const logementNom = String(logement?.values.nom ?? contrat.values.nom_logement ?? 'Logement');
  const locataireNom = locataire?.name ?? (typeof contrat.values.locataire_nom === 'string' ? contrat.values.locataire_nom : '—');
  const montant = (value: unknown) => (typeof value === 'number' ? formatFcfa(value) : '—');
  // Anciens paiements créés « en attente » (ou rejetés) avant la simplification : toujours validables.
  const legacyPaiements = paiements.filter((p) => p.statusKey !== 'paye');

  const startEdit = () => {
    setNom(locataire?.name ?? '');
    setTelephone(locataire?.phone ?? '');
    setLoyer(typeof contrat.values.loyer_mensuel === 'number' ? String(contrat.values.loyer_mensuel) : '');
    setCaution(typeof contrat.values.caution === 'number' ? String(contrat.values.caution) : '');
    setAvance(typeof contrat.values.avance === 'number' ? String(contrat.values.avance) : '');
    setJour(typeof contrat.values.jour_echeance === 'number' ? String(contrat.values.jour_echeance) : '');
    setDateEntree(parseDay(contrat.values.date_entree) ?? new Date());
    setDernierLoyer(typeof contrat.values.dernier_loyer_paye === 'string' ? contrat.values.dernier_loyer_paye : null);
    setCustomValues(Object.fromEntries(customFields.map((f) => [f.key, contrat.values[f.key] ?? null])));
    setEditing(true);
  };

  const onSaveEdit = async () => {
    const loyerMensuel = parseAmount(loyer);
    if (!loyerMensuel) return Alert.alert('Loyer requis', 'Indiquez le loyer mensuel.');
    if (locataire && !nom.trim()) return Alert.alert('Nom requis', 'Indiquez le nom et le prénom du locataire.');
    if (locataire && !isValidPhone(telephone)) return Alert.alert('Téléphone invalide', 'Indiquez un numéro de 8 à 15 chiffres.');
    const jourEcheance = jour.trim() ? Number(jour) : null;
    if (jourEcheance !== null && (!Number.isInteger(jourEcheance) || jourEcheance < 1 || jourEcheance > 31)) {
      return Alert.alert('Jour d’échéance invalide', 'Saisissez un jour entre 1 et 31, ou laissez vide.');
    }
    setSaving(true);
    try {
      // Le nom/téléphone du locataire se modifient sur LE contact (source unique),
      // jamais sur une copie dans le contrat.
      if (locataire) await updateLocataire(locataire.id, { name: nom, phone: telephone });
      await coreService.updateRecord(contrat.id, {
        values: {
          loyer_mensuel: loyerMensuel,
          caution: parseAmount(caution),
          avance: parseAmount(avance),
          jour_echeance: jourEcheance,
          date_entree: toIsoDay(dateEntree),
          dernier_loyer_paye: normalizeDernierLoyerPaye(dernierLoyer),
          ...customValues,
        },
      });
      setEditing(false);
      await load();
    } catch (e) {
      Alert.alert('Impossible d’enregistrer', e instanceof Error ? e.message : 'Une erreur est survenue.');
    } finally {
      setSaving(false);
    }
  };

  const onTerminer = () => {
    Alert.alert('Terminer le contrat', `${locataireNom} quitte ${logementNom}. Le logement redeviendra vacant ; le contrat et ses paiements restent consultables.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Terminer',
        style: 'destructive',
        onPress: async () => {
          try {
            await terminerContrat(contrat.id);
            await load();
          } catch (e) {
            Alert.alert('Impossible', e instanceof Error ? e.message : 'Une erreur est survenue.');
          }
        },
      },
    ]);
  };

  const onChangePaiementStatus = (paiement: (typeof paiements)[number]) => {
    if (paiement.statusKey === 'paye') {
      const date = String(paiement.values.date_validation ?? '');
      Alert.alert('Loyer validé', 'Ce paiement a été validé manuellement.', [
        { text: 'Fermer', style: 'cancel' },
        {
          text: 'Partager le reçu',
          onPress: () =>
            Share.share({
              title: 'Reçu de loyer',
              message: [
                'REÇU DE LOYER',
                `Locataire : ${locataireNom}`,
                `Logement : ${logementNom}${bien ? ` (${String(bien.values.nom)})` : ''}`,
                `Mois : ${String(paiement.values.mois ?? '—')}`,
                `Date de validation : ${date ? formatDay(date) : '—'}`,
                `Mode de paiement : ${String(paiement.values.mode_paiement ?? 'Non précisé')}`,
                `Montant reçu : ${typeof paiement.values.montant === 'number' ? paiement.values.montant.toLocaleString('fr-FR') : String(paiement.values.montant ?? 0)} FCFA`,
              ].join('\n'),
            }),
        },
      ]);
      return;
    }
    const amountText = typeof paiement.values.montant === 'number' ? `${paiement.values.montant.toLocaleString('fr-FR')} FCFA` : 'ce montant';
    Alert.alert('Valider le loyer reçu', `Confirmez-vous avoir reçu ${amountText} ? La validation sera conservée dans l’historique.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Marquer payé',
        onPress: async () => {
          await coreService.updateRecord(paiement.id, { statusKey: 'paye', values: { date_validation: toIsoDay(new Date()) } });
          await load();
        },
      },
      {
        text: 'Marquer rejeté',
        style: 'destructive',
        onPress: async () => {
          await coreService.updateRecord(paiement.id, { statusKey: 'rejete' });
          await load();
        },
      },
    ]);
  };

  const onDelete = () => {
    Alert.alert(
      'Supprimer ce contrat',
      `Le contrat, ses ${paiements.length} paiement${paiements.length > 1 ? 's' : ''} et son historique seront définitivement supprimés. Pour un départ, préférez « Terminer le contrat ». Continuer ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            await deleteContratCascade(contrat.id);
            router.back();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Contrat" showBack trailing={<IconButton icon="delete-outline" onPress={onDelete} />} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View className="gap-1">
            <View className="flex-row items-center gap-3">
              <SectionTitleText className="flex-1 text-lg" numberOfLines={2}>{logementNom}</SectionTitleText>
              {actif && (
                <LabelText style={{ color: LATENESS_TONE[lateness.key] }} className="font-inter-semibold" numberOfLines={1}>
                  {lateness.key === 'retard' ? `${lateness.label} (${lateness.lateMonths} mois)` : lateness.label}
                </LabelText>
              )}
            </View>
            <LabelText numberOfLines={1}>{bien ? String(bien.values.nom) : ''}</LabelText>
          </View>

          {editing ? (
            <Card className="gap-4">
              <TextField label="Nom et prénom du locataire" value={nom} onChangeText={setNom} />
              <TextField label="Téléphone" value={telephone} onChangeText={setTelephone} keyboardType="phone-pad" />
              <TextField label="Loyer mensuel *" value={loyer} onChangeText={setLoyer} keyboardType="numeric" icon="payments" />
              <DateField label="Date d'entrée" value={dateEntree} onChange={setDateEntree} />
              <MonthPicker label="Dernier loyer payé" value={dernierLoyer} onChange={setDernierLoyer} />
              <TextField label="Caution" value={caution} onChangeText={setCaution} keyboardType="numeric" icon="payments" />
              <TextField label="Avance" value={avance} onChangeText={setAvance} keyboardType="numeric" icon="payments" />
              <TextField label="Jour d'échéance (1-31)" value={jour} onChangeText={setJour} keyboardType="numeric" />
              {customFields.map((field) => (
                <CoreFieldRenderer
                  key={field.id}
                  field={field}
                  value={customValues[field.key] ?? null}
                  onChange={(v) => setCustomValues((prev) => ({ ...prev, [field.key]: v }))}
                />
              ))}
              <PrimaryButton label="Enregistrer les modifications" loading={saving} onPress={onSaveEdit} />
              <SecondaryButton label="Annuler" onPress={() => setEditing(false)} />
            </Card>
          ) : (
            <>
              <Card className="gap-0 p-0">
                <InfoRow label="Statut" value={STATUT_LABEL[contrat.statusKey ?? ''] ?? '—'} />
                <View className="h-px bg-border" />
                <InfoRow label="Locataire" value={locataireNom} />
                <View className="h-px bg-border" />
                <InfoRow label="Téléphone" value={locataire?.phone ?? (typeof contrat.values.locataire_telephone === 'string' ? contrat.values.locataire_telephone : '—')} />
                <View className="h-px bg-border" />
                <InfoRow label="Loyer" value={typeof contrat.values.loyer_mensuel === 'number' ? `${formatFcfa(contrat.values.loyer_mensuel)} / mois` : '—'} />
                <View className="h-px bg-border" />
                <InfoRow label="Entrée" value={formatDay(contrat.values.date_entree)} />
                {contrat.values.date_sortie ? (
                  <>
                    <View className="h-px bg-border" />
                    <InfoRow label="Sortie" value={formatDay(contrat.values.date_sortie)} />
                  </>
                ) : null}
                <View className="h-px bg-border" />
                <InfoRow label="Caution" value={montant(contrat.values.caution)} />
                <View className="h-px bg-border" />
                <InfoRow label="Avance" value={montant(contrat.values.avance)} />
                <View className="h-px bg-border" />
                <InfoRow label="Dernier loyer payé" value={typeof contrat.values.dernier_loyer_paye === 'string' ? formatMonth(contrat.values.dernier_loyer_paye) : '—'} />
                {typeof contrat.values.jour_echeance === 'number' && (
                  <>
                    <View className="h-px bg-border" />
                    <InfoRow label="Échéance" value={`le ${contrat.values.jour_echeance} du mois`} />
                  </>
                )}
                {customFields.map((field) => (
                  <View key={field.id}>
                    <View className="h-px bg-border" />
                    <InfoRow label={field.label} value={contrat.values[field.key] !== null && contrat.values[field.key] !== undefined ? String(contrat.values[field.key]) : '—'} />
                  </View>
                ))}
              </Card>
              <SecondaryButton label="Modifier" icon="edit" onPress={startEdit} />
              {actif && <SecondaryButton label="Terminer le contrat" icon="logout" onPress={onTerminer} />}
            </>
          )}

          <PaiementsSection
            contrat={contrat}
            paiements={paiements}
            locataireNom={locataireNom}
            logementNom={logementNom}
            bienNom={bien ? String(bien.values.nom) : undefined}
            onRecorded={load}
          />

          {legacyPaiements.length > 0 && (
            <View className="gap-3">
              <SectionTitleText className="text-base">Paiements à valider</SectionTitleText>
              <Card className="gap-0 p-0">
                {legacyPaiements.map((p, i) => (
                  <View key={p.id}>
                    {i > 0 && <View className="h-px bg-border" />}
                    <Pressable onPress={() => onChangePaiementStatus(p)} className="flex-row items-center gap-3 p-gutter-card active:bg-background-secondary">
                      <View className="flex-1">
                        <SectionTitleText className="text-base" numberOfLines={1}>{String(p.values.mois ?? '')}</SectionTitleText>
                        <LabelText>{p.statusKey === 'rejete' ? 'Rejeté' : 'En attente'}</LabelText>
                      </View>
                      <LabelText className="font-inter-semibold text-text-primary" numberOfLines={1}>{montant(p.values.montant)}</LabelText>
                    </Pressable>
                  </View>
                ))}
              </Card>
            </View>
          )}

          <View className="gap-3">
            <SectionTitleText className="text-base">Historique</SectionTitleText>
            {events.length === 0 ? (
              <BodyMdText>Aucun événement pour l&apos;instant.</BodyMdText>
            ) : (
              events.map((e) => (
                <View key={e.id} className="gap-0.5">
                  <BodyMdText className="text-text-primary">{e.summary}</BodyMdText>
                  <LabelText>{formatRelativeTime(e.at)}</LabelText>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
