import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { PrimaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { CoreFieldRenderer } from '@/components/core/CoreFieldRenderer';
import { useCoreStore } from '@/store/coreStore';
import { ensureImmobilierTool } from '@/services/immobilierService';
import type { EntityDefinition, FieldValue } from '@/types/entities';

export function DepenseFormScreen() {
  const { bienId } = useLocalSearchParams<{ bienId: string }>();
  const [entityDefinition, setEntityDefinition] = useState<EntityDefinition | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [saving, setSaving] = useState(false);
  const createRecord = useCoreStore((s) => s.createRecord);

  useEffect(() => {
    ensureImmobilierTool().then(({ tool, depense }) => {
      setToolId(tool.id);
      setEntityDefinition(depense);
    });
  }, []);

  if (!entityDefinition || !toolId) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <AppHeader title="Nouvelle dépense" showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const visibleFields = entityDefinition.fields.filter((f) => f.key !== 'bien');
  const requiredMissing = visibleFields.some((f) => f.required && !values[f.key]);

  const onSave = async () => {
    setSaving(true);
    try {
      await createRecord({ entityDefinitionId: entityDefinition.id, toolId, values: { ...values, bien: bienId } });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title="Nouvelle dépense" showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
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
          <PrimaryButton label="Enregistrer la dépense" disabled={requiredMissing} loading={saving} onPress={onSave} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
