import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { SectionTitleText, LabelText, BodyMdText } from '@/components/ui/Typography';
import { CoreFieldRenderer } from '@/components/core/CoreFieldRenderer';
import { useCoreStore } from '@/store/coreStore';
import { ensureFacturesTool } from '@/services/facturesService';
import { coreService } from '@/services/coreService';
import { formatRelativeTime } from '@/utils/format';
import type { CoreEvent, EntityDefinition, FieldValue, RecordItem } from '@/types/entities';

export function FactureDetailScreen() {
  const { recordId } = useLocalSearchParams<{ recordId: string }>();
  const [entityDefinition, setEntityDefinition] = useState<EntityDefinition | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [record, setRecord] = useState<RecordItem | null>(null);
  const [events, setEvents] = useState<CoreEvent[]>([]);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [saving, setSaving] = useState(false);
  const { updateRecord, deleteRecord } = useCoreStore();

  const load = async () => {
    const { tool, entityDefinition } = await ensureFacturesTool();
    setToolId(tool.id);
    setEntityDefinition(entityDefinition);
    const r = await coreService.getRecord(recordId);
    setRecord(r);
    if (r) setValues(r.values);
    setEvents(await coreService.getEvents({ recordId }));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  if (!entityDefinition || !record || !toolId) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const onSaveEdit = async () => {
    setSaving(true);
    try {
      await updateRecord(record.id, { values }, { toolId, entityDefinitionId: entityDefinition.id });
      setEditing(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const onChangeStatus = async (statusKey: string) => {
    await updateRecord(record.id, { statusKey }, { toolId, entityDefinitionId: entityDefinition.id });
    await load();
  };

  const onDelete = () => {
    Alert.alert('Supprimer cette facture', 'Cette action est définitive. Continuer ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          await deleteRecord(record.id, { toolId, entityDefinitionId: entityDefinition.id });
          router.back();
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title="Facture" showBack />
      <ScrollView contentContainerClassName="gap-5 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View className="flex-row flex-wrap gap-2">
          {(entityDefinition.statuses ?? []).map((s) => (
            <Chip key={s.key} label={s.label} active={record.statusKey === s.key} onPress={() => onChangeStatus(s.key)} />
          ))}
        </View>

        {editing ? (
          <Card className="gap-4">
            {entityDefinition.fields.map((field) => (
              <CoreFieldRenderer
                key={field.id}
                field={field}
                value={values[field.key] ?? null}
                onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
              />
            ))}
            <PrimaryButton label="Enregistrer les modifications" loading={saving} onPress={onSaveEdit} />
          </Card>
        ) : (
          <>
            <Card className="gap-0 p-0">
              {entityDefinition.fields.map((field, i) => (
                <View key={field.id}>
                  {i > 0 && <View className="h-px bg-border" />}
                  <View className="flex-row items-center justify-between p-gutter-card">
                    <LabelText>{field.label}</LabelText>
                    <BodyMdText className="text-right text-text-primary">
                      {record.values[field.key] !== null && record.values[field.key] !== undefined
                        ? String(record.values[field.key])
                        : '—'}
                    </BodyMdText>
                  </View>
                </View>
              ))}
            </Card>
            <SecondaryButton label="Modifier" icon="edit" onPress={() => setEditing(true)} />
          </>
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

        <SecondaryButton label="Supprimer cette facture" icon="delete-outline" onPress={onDelete} />
      </ScrollView>
    </SafeAreaView>
  );
}
