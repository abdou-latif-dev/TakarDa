import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { PrimaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { SectionTitleText, BodyMdText } from '@/components/ui/Typography';
import { CoreFieldRenderer } from '@/components/core/CoreFieldRenderer';
import { useCoreStore } from '@/store/coreStore';
import { ensureImmobilierTool, createContratWithLocataire } from '@/services/immobilierService';
import type { EntityDefinition, FieldValue } from '@/types/entities';

/** One combined form for the room/lease AND the tenant's identity — mirrors
 * H-PAY's AddTenantScreen (see the Étape 2 H-PAY audit report), which proved
 * this single-step flow is how landlords actually work in the field, rather
 * than creating an abstract "Logement" first and a "Locataire" separately. */
export function ContratFormScreen() {
  const { bienId } = useLocalSearchParams<{ bienId: string }>();
  const [entityDefinition, setEntityDefinition] = useState<EntityDefinition | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [locataireNom, setLocataireNom] = useState('');
  const [locataireTelephone, setLocataireTelephone] = useState('');
  const [saving, setSaving] = useState(false);
  const fetchRecords = useCoreStore((s) => s.fetchRecords);

  useEffect(() => {
    ensureImmobilierTool().then(({ tool, contrat, locataireRole }) => {
      setToolId(tool.id);
      setEntityDefinition(contrat);
      setRoleId(locataireRole.id);
    });
  }, []);

  if (!entityDefinition || !toolId || !roleId) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <AppHeader title="Nouveau contrat" showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  // The "bien"/"locataire_*" fields are set programmatically below, not rendered generically.
  const visibleFields = entityDefinition.fields.filter(
    (f) => !['bien', 'locataire_member_id', 'locataire_nom', 'locataire_telephone'].includes(f.key),
  );
  const requiredMissing = visibleFields.some((f) => f.required && !values[f.key]);

  const onSave = async () => {
    setSaving(true);
    try {
      await createContratWithLocataire({
        toolId,
        contratEntityDefinitionId: entityDefinition.id,
        locataireRoleId: roleId,
        values: { ...values, bien: bienId },
        locataireNom: locataireNom.trim() || undefined,
        locataireTelephone: locataireTelephone.trim() || undefined,
      });
      await fetchRecords({ toolId, entityDefinitionId: entityDefinition.id });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title="Nouveau contrat" showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerClassName="gap-4 px-page-margin pb-6" keyboardShouldPersistTaps="handled">
          <View className="gap-1">
            <SectionTitleText className="text-base">Logement</SectionTitleText>
            <BodyMdText>Informations sur la chambre, l&apos;appartement ou la boutique.</BodyMdText>
          </View>
          {visibleFields.map((field) => (
            <CoreFieldRenderer
              key={field.id}
              field={field}
              value={values[field.key] ?? null}
              onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
            />
          ))}

          <View className="mt-2 gap-1">
            <SectionTitleText className="text-base">Locataire (optionnel)</SectionTitleText>
            <BodyMdText>
              Laissez vide pour un logement vacant. Le locataire n&apos;a pas besoin d&apos;installer TakarDa.
            </BodyMdText>
          </View>
          <CoreFieldRenderer
            field={{ id: 'nom', key: 'nom', type: 'text', label: 'Nom du locataire', required: false, order: 0 }}
            value={locataireNom}
            onChange={(v) => setLocataireNom(typeof v === 'string' ? v : '')}
          />
          <CoreFieldRenderer
            field={{ id: 'tel', key: 'tel', type: 'phone', label: 'Téléphone', required: false, order: 1 }}
            value={locataireTelephone}
            onChange={(v) => setLocataireTelephone(typeof v === 'string' ? v : '')}
          />
        </ScrollView>
        <View className="border-t border-border px-page-margin pb-4 pt-4">
          <PrimaryButton label="Enregistrer le contrat" disabled={requiredMissing} loading={saving} onPress={onSave} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
