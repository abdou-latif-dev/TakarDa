import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, useWindowDimensions, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { DateField } from '@/components/ui/DateField';
import { MonthPicker } from '@/components/ui/MonthPicker';
import { PrimaryButton } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { LoadingState } from '@/components/ui/States';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import {
  createLocataireEtContrat,
  CUISINE_OPTIONS,
  listBiensWithSummary,
  LOGEMENT_TYPES,
  loadBienOverview,
  normalizeName,
  parseAmount,
  WC_OPTIONS,
  type BienSummary,
  type LogementView,
} from '@/services/immobilierService';

/** Choix exclusif : retoucher le chip actif le désélectionne (champ facultatif). */
function ChoiceRow({ label, options, value, onChange }: { label: string; options: readonly string[]; value: string | null; onChange: (value: string | null) => void }) {
  return (
    <View className="gap-2">
      <LabelText className="text-text-secondary">{label}</LabelText>
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => (
          <Chip key={option} label={option} active={value === option} onPress={() => onChange(value === option ? null : option)} />
        ))}
      </View>
    </View>
  );
}

/** « Ajouter un locataire » — UN formulaire, UNE action « Enregistrer » :
 * choisir le bien, le logement (existant, ou nouveau avec type/cuisine/WC),
 * saisir le locataire, le loyer et les dates. Le contrat de bail est créé
 * derrière, automatiquement : le propriétaire ne le voit jamais comme une
 * étape séparée. `?logementId=` présélectionne un logement vacant. */
export function ContratFormScreen() {
  const { bienId: routeBienId, logementId: presetLogementId } = useLocalSearchParams<{ bienId: string; logementId?: string }>();
  const { width } = useWindowDimensions();
  const [biens, setBiens] = useState<BienSummary[] | null>(null);
  const [bienId, setBienId] = useState<string>(routeBienId);
  const [views, setViews] = useState<LogementView[] | null>(null);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedId, setSelectedId] = useState<string | null>(presetLogementId ?? null);
  const [newNom, setNewNom] = useState('');
  const [newType, setNewType] = useState<string | null>('Chambre simple');
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [wc, setWc] = useState<string | null>(null);
  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [loyer, setLoyer] = useState('');
  const [caution, setCaution] = useState('');
  const [avance, setAvance] = useState('');
  const [jour, setJour] = useState('');
  const [dateEntree, setDateEntree] = useState(new Date());
  const [dernierLoyer, setDernierLoyer] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBiensWithSummary().then(setBiens);
  }, []);

  // Le message d'erreur se rapporte à la saisie précédente : il disparaît dès qu'on la corrige.
  useEffect(() => {
    setError(null);
  }, [mode, selectedId, newNom, newType, nom, telephone, loyer, caution, avance, jour, dateEntree, dernierLoyer, bienId]);

  // Recharge les logements du bien choisi (au départ, puis à chaque changement de bien).
  useEffect(() => {
    let cancelled = false;
    setViews(null);
    loadBienOverview(bienId).then((overview) => {
      if (cancelled) return;
      setViews(overview.views);
      const free = overview.views.filter((v) => !v.occupied);
      const preset = presetLogementId && bienId === routeBienId ? free.find((v) => v.logement.id === presetLogementId) : undefined;
      setSelectedId(preset ? preset.logement.id : null);
      if (preset && typeof preset.logement.values.loyer_reference === 'number') setLoyer(String(preset.logement.values.loyer_reference));
      setMode(free.length === 0 ? 'new' : 'existing');
    });
    return () => {
      cancelled = true;
    };
  }, [bienId, presetLogementId, routeBienId]);

  const vacants = useMemo(() => (views ?? []).filter((v) => !v.occupied), [views]);

  // Un nom saisi qui correspond à un logement existant du bien : on le réutilise, on ne le duplique pas.
  const sameName = useMemo(() => {
    if (mode !== 'new' || !newNom.trim() || !views) return null;
    const wanted = normalizeName(newNom);
    return views.find((v) => normalizeName(String(v.logement.values.nom ?? '')) === wanted) ?? null;
  }, [mode, newNom, views]);

  const pick = useCallback(
    (view: LogementView) => {
      setSelectedId(view.logement.id);
      setError(null);
      if (!loyer && typeof view.logement.values.loyer_reference === 'number') setLoyer(String(view.logement.values.loyer_reference));
    },
    [loyer],
  );

  const onSave = async () => {
    setError(null);
    const loyerMensuel = parseAmount(loyer);
    if (mode === 'existing' && !selectedId) return setError('Choisissez un logement vacant, ou créez-en un.');
    if (mode === 'new' && !newNom.trim()) return setError('Donnez un nom au logement (ex. Chambre 1, A1…).');
    if (sameName?.occupied) return setError(`« ${String(sameName.logement.values.nom)} » est déjà occupé.`);
    if (!nom.trim()) return setError('Indiquez le nom et le prénom du locataire.');
    if (!telephone.trim()) return setError('Indiquez le numéro de téléphone du locataire.');
    if (!loyerMensuel) return setError('Indiquez le loyer.');
    const jourEcheance = jour.trim() ? Number(jour) : null;
    if (jourEcheance !== null && (!Number.isInteger(jourEcheance) || jourEcheance < 1 || jourEcheance > 31)) {
      return setError('Le jour d’échéance doit être compris entre 1 et 31, ou laissé vide.');
    }
    setSaving(true);
    try {
      await createLocataireEtContrat({
        bienId,
        ...(mode === 'existing' ? { logementId: selectedId as string } : { nouveauLogement: { nom: newNom, type: newType, cuisine, wc } }),
        nom,
        telephone,
        loyerMensuel,
        dateEntree,
        caution: parseAmount(caution),
        avance: parseAmount(avance),
        jourEcheance,
        dernierLoyerPaye: dernierLoyer,
      });
      if (bienId === routeBienId) router.back();
      else router.replace(`/immobilier/${bienId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue.');
    } finally {
      setSaving(false);
    }
  };

  if (biens === null || views === null) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader title="Nouveau locataire" showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const wide = width >= 720;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Nouveau locataire" showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView
          contentContainerClassName="w-full max-w-3xl gap-4 self-center px-page-margin pb-6"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <Card className="gap-3">
            <SectionTitleText className="text-base">Choisir le bien</SectionTitleText>
            <View className="flex-row flex-wrap gap-2">
              {biens.map((b) => (
                <Chip key={b.bien.id} label={String(b.bien.values.nom)} active={bienId === b.bien.id} onPress={() => setBienId(b.bien.id)} />
              ))}
            </View>
          </Card>

          <Card className="gap-3">
            <SectionTitleText className="text-base">Infos chambre / logement</SectionTitleText>
            <View className="flex-row flex-wrap gap-2">
              <Chip label="Logement existant" active={mode === 'existing'} onPress={() => setMode('existing')} />
              <Chip label="+ Nouveau logement" active={mode === 'new'} onPress={() => setMode('new')} />
            </View>
            {mode === 'existing' ? (
              vacants.length === 0 ? (
                <BodyMdText>Aucun logement vacant dans ce bien. Créez-en un.</BodyMdText>
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  {vacants.map((v) => (
                    <Chip key={v.logement.id} label={String(v.logement.values.nom)} active={selectedId === v.logement.id} onPress={() => pick(v)} />
                  ))}
                </View>
              )
            ) : (
              <View className="gap-3">
                <TextField label="Nom du logement *" placeholder="Ex. Chambre 1, A1…" value={newNom} onChangeText={setNewNom} />
                {sameName ? (
                  <LabelText style={{ color: sameName.occupied ? Colors.error : undefined }}>
                    {sameName.occupied
                      ? 'Ce logement existe déjà et il est occupé.'
                      : 'Ce logement existe déjà (vacant) : il sera utilisé, pas dupliqué.'}
                  </LabelText>
                ) : (
                  <>
                    <ChoiceRow label="Type de logement" options={LOGEMENT_TYPES} value={newType} onChange={setNewType} />
                    <ChoiceRow label="Cuisine" options={CUISINE_OPTIONS} value={cuisine} onChange={setCuisine} />
                    <ChoiceRow label="WC" options={WC_OPTIONS} value={wc} onChange={setWc} />
                  </>
                )}
              </View>
            )}
          </Card>

          <Card className="gap-3">
            <SectionTitleText className="text-base">Informations du locataire</SectionTitleText>
            <BodyMdText>Le locataire n&apos;a pas besoin d&apos;installer TakarDa.</BodyMdText>
            <TextField label="Nom et prénom *" value={nom} onChangeText={setNom} autoCapitalize="words" />
            <TextField label="Numéro de téléphone *" value={telephone} onChangeText={setTelephone} keyboardType="phone-pad" placeholder="+228 …" />
          </Card>

          <Card className="gap-3">
            <SectionTitleText className="text-base">Loyer et conditions</SectionTitleText>
            <TextField label="Loyer mensuel (FCFA) *" value={loyer} onChangeText={setLoyer} keyboardType="numeric" icon="payments" placeholder="25000" />
            <View className={wide ? 'flex-row gap-3' : 'gap-3'}>
              <TextField containerClassName={wide ? 'flex-1' : undefined} label="Caution (FCFA)" value={caution} onChangeText={setCaution} keyboardType="numeric" icon="payments" />
              <TextField containerClassName={wide ? 'flex-1' : undefined} label="Avance (FCFA)" value={avance} onChangeText={setAvance} keyboardType="numeric" icon="payments" />
            </View>
            <TextField label="Jour d'échéance du loyer (1-31)" value={jour} onChangeText={setJour} keyboardType="numeric" placeholder="Ex. 5 (facultatif)" />
          </Card>

          <Card className="gap-4">
            <SectionTitleText className="text-base">Dates</SectionTitleText>
            <DateField label="Date d'entrée" value={dateEntree} onChange={setDateEntree} />
            <MonthPicker label="Dernier loyer payé" value={dernierLoyer} onChange={setDernierLoyer} />
            <LabelText>Sert à calculer si le locataire est à jour ou en retard.</LabelText>
          </Card>
        </ScrollView>
        <View className="mx-auto w-full max-w-3xl gap-2 border-t border-border px-page-margin pb-4 pt-3">
          {error && (
            <LabelText className="font-inter-semibold" style={{ color: Colors.error }}>
              {error}
            </LabelText>
          )}
          <PrimaryButton label="Enregistrer" loading={saving} onPress={onSave} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
