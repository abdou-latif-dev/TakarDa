import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { PrimaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { CoreFieldRenderer } from '@/components/core/CoreFieldRenderer';
import { ensureImmobilierTool } from '@/services/immobilierService';
import { ensureFacturesTool } from '@/services/facturesService';
import { createFacturePartagee, currentPeriode } from '@/services/utilityBillingService';
import type { EntityDefinition, FieldValue } from '@/types/entities';

/** Étape 1 du flux de répartition CEET/TDE : montant total + période +
 * fournisseur. Le mode de répartition (proportionnel/équitable) est choisi
 * ensuite, une fois les relevés saisis — voir RepartitionScreen.
 *
 * Écran partagé entre Immobilier (bienId présent, prérempli depuis la route
 * imbriquée sous un Bien) et Factures autonome (bienId absent, ex: atelier,
 * boutique, association) — un seul moteur, voir services/utilityBillingService.ts. */
export function FacturePartageeFormScreen() {
  const { bienId } = useLocalSearchParams<{ bienId?: string }>();
  const [entityDefinition, setEntityDefinition] = useState<EntityDefinition | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({ mois: currentPeriode() });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    ensureFacturesTool().then(({ tool, facturePartageeDefinition }) => {
      setToolId(tool.id);
      setEntityDefinition(facturePartageeDefinition);
    });
  }, []);

  if (!entityDefinition || !toolId) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader title="Facture partagée" showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const visibleFields = entityDefinition.fields.filter((f) => !['bien', 'mode_repartition', 'justificatif'].includes(f.key));
  const requiredMissing = visibleFields.some((f) => f.required && !values[f.key]);

  const onSave = async () => {
    setSaving(true);
    try {
      let bienEntityDefinitionId: string | undefined;
      if (bienId) {
        const immobilier = await ensureImmobilierTool();
        bienEntityDefinitionId = immobilier.bien.id;
      }
      const facture = await createFacturePartagee({
        toolId,
        facturePartageeEntityDefinitionId: entityDefinition.id,
        bienEntityDefinitionId,
        values: bienId ? { ...values, bien: bienId } : values,
      });
      router.replace(bienId ? `/immobilier/facture-utility/${facture.id}` : `/factures/facture-partagee/${facture.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Facture partagée (CEET/TDE)" showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView contentContainerClassName="gap-4 px-page-margin pb-6" keyboardShouldPersistTaps="handled">
          {visibleFields.map((field) => (
            <CoreFieldRenderer
              key={field.id}
              field={field}
              value={values[field.key] ?? null}
              onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
            />
          ))}
        </ScrollView>
        <View className="border-t border-border px-page-margin pb-4 pt-4">
          <PrimaryButton label="Continuer vers les relevés" disabled={requiredMissing} loading={saving} onPress={onSave} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
