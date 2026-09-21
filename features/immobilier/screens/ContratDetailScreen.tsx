import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton, IconButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { SectionTitleText, LabelText, BodyMdText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { CoreFieldRenderer } from '@/components/core/CoreFieldRenderer';
import { formatFcfa, formatRelativeTime } from '@/utils/format';
import { coreService } from '@/services/coreService';
import { ensureImmobilierTool, computeContratLateness } from '@/services/immobilierService';
import { useCoreStore } from '@/store/coreStore';
import type { CoreEvent, EntityDefinition, FieldValue, RecordItem } from '@/types/entities';

const LATENESS_TONE: Record<string, string> = {
  a_jour: Colors.success,
  retard: Colors.error,
  sans_paiement: Colors.textMuted,
};

export function ContratDetailScreen() {
  const { contratId } = useLocalSearchParams<{ contratId: string }>();
  const [toolId, setToolId] = useState<string | null>(null);
  const [entityDefinition, setEntityDefinition] = useState<EntityDefinition | null>(null);
  const [contrat, setContrat] = useState<RecordItem | null>(null);
  const [paiements, setPaiements] = useState<RecordItem[]>([]);
  const [events, setEvents] = useState<CoreEvent[]>([]);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [saving, setSaving] = useState(false);
  const { updateRecord, deleteRecord } = useCoreStore();

  const load = async () => {
    const { tool, contrat: contratEd, paiement } = await ensureImmobilierTool();
    setToolId(tool.id);
    setEntityDefinition(contratEd);
    const c = await coreService.getRecord(contratId);
    setContrat(c);
    if (c) setValues(c.values);
    const allPaiements = await coreService.getRecords({ toolId: tool.id, entityDefinitionId: paiement.id });
    setPaiements(allPaiements.filter((p) => p.values.contrat === contratId));
    setEvents(await coreService.getEvents({ recordId: contratId }));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contratId]);

  if (!entityDefinition || !contrat || !toolId) {
    return (
      <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
        <AppHeader showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const lateness = computeContratLateness(contrat, paiements);
  const visibleFields = entityDefinition.fields.filter(
    (f) => !['bien', 'locataire_member_id'].includes(f.key),
  );

  const onSaveEdit = async () => {
    setSaving(true);
    try {
      await updateRecord(contrat.id, { values }, { toolId, entityDefinitionId: entityDefinition.id });
      setEditing(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const onChangePaiementStatus = (paiementId: string) => {
    Alert.alert('Statut du paiement', 'Choisissez le nouveau statut.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Marquer payé',
        onPress: async () => {
          await coreService.updateRecord(paiementId, { statusKey: 'paye' });
          await load();
        },
      },
      {
        text: 'Marquer rejeté',
        style: 'destructive',
        onPress: async () => {
          await coreService.updateRecord(paiementId, { statusKey: 'rejete' });
          await load();
        },
      },
    ]);
  };

  const onDelete = () => {
    Alert.alert('Supprimer ce contrat', 'Le contrat et ses paiements seront définitivement supprimés. Continuer ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          for (const p of paiements) await coreService.deleteRecord(p.id);
          await deleteRecord(contrat.id, { toolId, entityDefinitionId: entityDefinition.id });
          router.back();
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'bottom']}>
      <AppHeader title="Contrat" showBack trailing={<IconButton icon="delete-outline" onPress={onDelete} />} />
      <ScrollView contentContainerClassName="gap-5 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center justify-between">
          <SectionTitleText className="text-lg">{String(contrat.values.nom_logement ?? 'Logement')}</SectionTitleText>
          <LabelText style={{ color: LATENESS_TONE[lateness.key] }} className="font-inter-semibold">
            {lateness.key === 'retard' ? `${lateness.label} (${lateness.lateMonths} mois)` : lateness.label}
          </LabelText>
        </View>

        {editing ? (
          <Card className="gap-4">
            {visibleFields.map((field) => (
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
              {visibleFields.map((field, i) => (
                <View key={field.id}>
                  {i > 0 && <View className="h-px bg-border" />}
                  <View className="flex-row items-center justify-between p-gutter-card">
                    <LabelText>{field.label}</LabelText>
                    <BodyMdText className="text-right text-text-primary">
                      {contrat.values[field.key] !== null && contrat.values[field.key] !== undefined
                        ? String(contrat.values[field.key])
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
          <View className="flex-row items-center justify-between">
            <SectionTitleText className="text-base">Paiements</SectionTitleText>
            <SecondaryButton
              label="Ajouter"
              icon="add"
              fullWidth={false}
              onPress={() => router.push(`/immobilier/contrat/${contratId}/paiement-new`)}
            />
          </View>
          {paiements.length === 0 ? (
            <BodyMdText>Aucun paiement pour l&apos;instant.</BodyMdText>
          ) : (
            <Card className="gap-0 p-0">
              {paiements
                .sort((a, b) => (a.values.mois && b.values.mois ? String(b.values.mois).localeCompare(String(a.values.mois)) : 0))
                .map((p, i) => (
                  <View key={p.id}>
                    {i > 0 && <View className="h-px bg-border" />}
                    <Pressable
                      onPress={() => onChangePaiementStatus(p.id)}
                      className="flex-row items-center justify-between p-gutter-card active:bg-background-secondary">
                      <View className="flex-1">
                        <SectionTitleText className="text-base">{String(p.values.mois ?? '')}</SectionTitleText>
                        <LabelText>{p.statusKey === 'paye' ? 'Payé' : p.statusKey === 'rejete' ? 'Rejeté' : 'En attente'}</LabelText>
                      </View>
                      <LabelText className="font-inter-semibold text-text-primary">
                        {typeof p.values.montant === 'number' ? formatFcfa(p.values.montant) : '—'}
                      </LabelText>
                    </Pressable>
                  </View>
                ))}
            </Card>
          )}
        </View>

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
    </SafeAreaView>
  );
}
