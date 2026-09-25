import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { PrimaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { CoreFieldRenderer } from '@/components/core/CoreFieldRenderer';
import { useCoreStore } from '@/store/coreStore';
import { ensureImmobilierTool } from '@/services/immobilierService';
import type { EntityDefinition, FieldValue } from '@/types/entities';

export function BienFormScreen() {
  const [entityDefinition, setEntityDefinition] = useState<EntityDefinition | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [saving, setSaving] = useState(false);
  const createRecord = useCoreStore((s) => s.createRecord);

  useEffect(() => {
    ensureImmobilierTool().then(({ tool, bien }) => {
      setToolId(tool.id);
      setEntityDefinition(bien);
    });
  }, []);

  if (!entityDefinition || !toolId) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader title="Nouveau bien" showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const requiredMissing = entityDefinition.fields.some((f) => f.required && !values[f.key]);

  const onSave = async () => {
    setSaving(true);
    try {
      await createRecord({ entityDefinitionId: entityDefinition.id, toolId, values });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Nouveau bien" showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerClassName="gap-4 px-page-margin pb-6" keyboardShouldPersistTaps="handled">
          {entityDefinition.fields.map((field) => (
            <CoreFieldRenderer
              key={field.id}
              field={field}
              value={values[field.key] ?? null}
              onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
            />
          ))}
        </ScrollView>
        <View className="border-t border-border px-page-margin pb-4 pt-4">
          <PrimaryButton label="Enregistrer le bien" disabled={requiredMissing} loading={saving} onPress={onSave} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
