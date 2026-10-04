import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { PrimaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { MonthPicker } from '@/components/ui/MonthPicker';
import { CoreFieldRenderer } from '@/components/core/CoreFieldRenderer';
import { coreService } from '@/services/coreService';
import { useCoreStore } from '@/store/coreStore';
import { ensureImmobilierTool, normalizeMois } from '@/services/immobilierService';
import type { EntityDefinition, FieldValue } from '@/types/entities';

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Enregistre un paiement de loyer d'un contrat (en attente — validé ensuite
 * manuellement). Le montant est pré-rempli avec le loyer du contrat ; le mois
 * est contrôlé (AAAA-MM) : un mois mal saisi faussait le calcul du retard. */
export function PaiementFormScreen() {
  const { contratId } = useLocalSearchParams<{ contratId: string }>();
  const [entityDefinition, setEntityDefinition] = useState<EntityDefinition | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({ mois: currentMonthKey() });
  const [saving, setSaving] = useState(false);
  const createRecord = useCoreStore((s) => s.createRecord);

  useEffect(() => {
    Promise.all([ensureImmobilierTool(), coreService.getRecord(contratId)]).then(([{ tool, paiement }, contrat]) => {
      setToolId(tool.id);
      setEntityDefinition(paiement);
      if (contrat && typeof contrat.values.loyer_mensuel === 'number') {
        setValues((prev) => ({ ...prev, montant: contrat.values.loyer_mensuel }));
      }
    });
  }, [contratId]);

  if (!entityDefinition || !toolId) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader title="Nouveau paiement" showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const visibleFields = entityDefinition.fields.filter((f) => f.key !== 'contrat' && f.key !== 'date_validation');
  const requiredMissing = visibleFields.some((f) => f.required && !values[f.key]);

  const onSave = async () => {
    const mois = normalizeMois(String(values.mois ?? ''));
    if (!mois) {
      Alert.alert('Mois invalide', 'Saisissez le mois au format AAAA-MM (ex. 2026-10).');
      return;
    }
    setSaving(true);
    try {
      await createRecord({
        entityDefinitionId: entityDefinition.id,
        toolId,
        values: { ...values, mois, contrat: contratId },
        statusKey: 'en_attente',
      });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Nouveau paiement" showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView contentContainerClassName="w-full max-w-3xl gap-4 self-center px-page-margin pb-6" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {visibleFields.map((field) => (
            <View key={field.id} className="gap-1">
              {field.key === 'mois' ? (
                <MonthPicker
                  label="Mois payé *"
                  allowNone={false}
                  value={typeof values.mois === 'string' ? (normalizeMois(values.mois) ?? currentMonthKey()) : currentMonthKey()}
                  onChange={(v) => setValues((prev) => ({ ...prev, mois: v ?? currentMonthKey() }))}
                />
              ) : (
                <CoreFieldRenderer
                  field={field}
                  value={values[field.key] ?? null}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                />
              )}
            </View>
          ))}
        </ScrollView>
        <View className="border-t border-border px-page-margin pb-4 pt-4">
          <PrimaryButton label="Enregistrer le paiement" disabled={requiredMissing} loading={saving} onPress={onSave} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
