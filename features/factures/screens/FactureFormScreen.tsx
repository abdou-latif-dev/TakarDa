import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { SectionTitleText, BodyMdText } from '@/components/ui/Typography';
import { CoreFieldRenderer } from '@/components/core/CoreFieldRenderer';
import { useCoreStore } from '@/store/coreStore';
import { ensureFacturesTool } from '@/services/facturesService';
import type { EntityDefinition, FieldValue } from '@/types/entities';

const monthNow = () => new Date().toISOString().slice(0, 7);

/** Facture simple, à un seul payeur — sans répartition. Pour répartir une
 * facture CEET/TDE entre plusieurs participants, voir "Facture partagée"
 * (features/immobilier/screens/FacturePartageeFormScreen.tsx, réutilisé ici
 * sans bien via la route /factures/facture-partagee-new) : c'est le même
 * moteur, voir services/utilityBillingService.ts. Cet écran ne construit plus
 * de répartition ni n'écrit dans `repartitions_json` (voir le rapport de
 * fusion Étape 4) — ce champ reste dans le schéma uniquement pour que
 * FactureDetailScreen puisse encore afficher d'anciennes factures qui
 * l'auraient déjà utilisé. */
export function FactureFormScreen() {
  const [entity, setEntity] = useState<EntityDefinition | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [customValues, setCustomValues] = useState<Record<string, FieldValue>>({});
  const [saving, setSaving] = useState(false);
  const createRecord = useCoreStore((s) => s.createRecord);

  useEffect(() => {
    let active = true;
    ensureFacturesTool().then(({ tool, entityDefinition }) => {
      if (!active) return;
      setToolId(tool.id);
      setEntity(entityDefinition);
      const now = new Date();
      setValues({
        fournisseur: 'CEET', reference_compteur: '', mois: monthNow(), montant: null,
        date_emission: now.toISOString().slice(0, 10), echeance: null, mode_paiement: null,
        date_paiement: null, note: null, justificatif: null, client: null,
      });
    }).catch(() => Alert.alert('Erreur', 'Impossible de charger le formulaire Factures.'));
    return () => { active = false; };
  }, []);

  const customFields = useMemo(() => (entity?.fields ?? []).filter((f) => f.key.startsWith('custom_')), [entity]);
  const excludedKeys = ['bien_id', 'bien_nom', 'mode_repartition', 'repartitions_json'];
  const visibleFields = (entity?.fields ?? []).filter((f) => !excludedKeys.includes(f.key) && !f.key.startsWith('custom_'));
  const requiredMissing = !values.fournisseur || !String(values.reference_compteur ?? '').trim() || !String(values.mois ?? '').trim() || !(Number(values.montant) > 0) || !values.date_emission || customFields.some((f) => f.required && (customValues[f.key] === null || customValues[f.key] === undefined || customValues[f.key] === ''));

  const save = async () => {
    if (!entity || !toolId) return;
    setSaving(true);
    try {
      await createRecord({ toolId, entityDefinitionId: entity.id, values: { ...values, ...customValues }, statusKey: 'a_payer' });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  if (!entity || !toolId) return <SafeAreaView className="flex-1 bg-background"><AppHeader title="Nouvelle facture" showBack /><View className="px-page-margin"><LoadingState /></View></SafeAreaView>;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Nouvelle facture" showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerClassName="gap-4 px-page-margin pb-6" keyboardShouldPersistTaps="handled">
          <Card className="gap-4">
            <SectionTitleText className="text-base">Facture simple (un seul payeur)</SectionTitleText>
            {visibleFields.map((field) => (
              <CoreFieldRenderer key={field.id} field={field} value={values[field.key] ?? null} onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))} />
            ))}
          </Card>
          {customFields.length > 0 && (
            <Card className="gap-4">
              <SectionTitleText className="text-base">Champs personnalisés</SectionTitleText>
              {customFields.map((field) => (
                <CoreFieldRenderer key={field.id} field={field} value={customValues[field.key] ?? null} onChange={(v) => setCustomValues((prev) => ({ ...prev, [field.key]: v }))} />
              ))}
            </Card>
          )}
          <View className="gap-2 border-t border-border pt-4">
            <BodyMdText className="text-text-secondary">Facture à répartir entre plusieurs personnes ? Utilisez « Facture partagée » plutôt que ce formulaire simple.</BodyMdText>
            <View className="flex-row gap-3">
              <SecondaryButton fullWidth={false} className="flex-1" label="Cahier d'index" icon="speed" onPress={() => router.push('/factures/releves')} />
              <SecondaryButton fullWidth={false} className="flex-1" label="Facture partagée" icon="call-split" onPress={() => router.push('/factures/facture-partagee-new')} />
            </View>
          </View>
        </ScrollView>
        <View className="border-t border-border px-page-margin pb-4 pt-4"><PrimaryButton label="Enregistrer la facture" disabled={requiredMissing} loading={saving} onPress={save} /></View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
