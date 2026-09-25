import { useEffect, useState } from 'react';
import { Alert, Share, ScrollView, View } from 'react-native';
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
import { formatFcfa, formatRelativeTime } from '@/utils/format';
import type { CoreEvent, EntityDefinition, FieldValue, RecordItem } from '@/types/entities';

export function FactureDetailScreen() {
  const { recordId } = useLocalSearchParams<{ recordId: string }>();
  const [entityDefinition, setEntityDefinition] = useState<EntityDefinition | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [record, setRecord] = useState<RecordItem | null>(null);
  const [events, setEvents] = useState<CoreEvent[]>([]);
  const [shares, setShares] = useState<Array<{ lineId?: string; label?: string; tenantId?: string; tenantName?: string; unit?: string; previousIndex: number; currentIndex: number; consumption: number; amount: number; status: string; paidAt: string | null }>>([]);
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
    if (r) {
      setValues(r.values);
      try {
        const parsed = typeof r.values.repartitions_json === 'string' ? JSON.parse(r.values.repartitions_json) : [];
        setShares(Array.isArray(parsed) ? parsed : []);
      } catch {
        setShares([]);
      }
    }
    setEvents(await coreService.getEvents({ recordId }));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  if (!entityDefinition || !record || !toolId) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
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
    const next = entityDefinition.statuses?.find((status) => status.key === statusKey)?.label ?? statusKey;
    const amount = record.values.montant;
    const amountLabel = typeof amount === 'number' ? `${amount.toLocaleString('fr-FR')} FCFA` : 'montant inconnu';
    Alert.alert(
      statusKey === 'payee' ? 'Confirmer le paiement reçu' : `Passer au statut « ${next} » ?`,
      statusKey === 'payee'
        ? `Confirmez-vous avoir reçu ${amountLabel} pour cette facture ? Cette validation manuelle sera inscrite dans l’historique.`
        : `Le statut passera de « ${entityDefinition.statuses?.find((status) => status.key === record.statusKey)?.label ?? 'Sans statut'} » à « ${next} ».`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          onPress: async () => {
            await updateRecord(record.id, {
              statusKey,
              ...(statusKey === 'payee' ? { values: { date_paiement: new Date().toISOString().slice(0, 10) } } : {}),
            }, { toolId, entityDefinitionId: entityDefinition.id });
            await load();
          },
        },
      ],
    );
  };

  const validateShare = (index: number) => {
    const share = shares[index];
    if (!share || share.status === 'payee') return;
    Alert.alert(
      'Valider le paiement',
      `Confirmez-vous avoir reçu ${share.amount.toLocaleString('fr-FR')} FCFA de ${share.label ?? share.tenantName ?? 'cette ligne'} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Marquer payé',
          onPress: async () => {
            const next = shares.map((item, i) => i === index ? { ...item, status: 'payee', paidAt: new Date().toISOString() } : item);
            const paidCount = next.filter((item) => item.status === 'payee').length;
            const statusKey = paidCount === next.length ? 'payee' : paidCount > 0 ? 'partielle' : 'a_payer';
            await updateRecord(
              record.id,
              {
                values: {
                  repartitions_json: JSON.stringify(next),
                  ...(statusKey === 'payee' ? { date_paiement: new Date().toISOString().slice(0, 10) } : {}),
                },
                statusKey,
              },
              { toolId, entityDefinitionId: entityDefinition.id },
            );
            await load();
          },
        },
      ],
    );
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
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Facture" showBack />
      <ScrollView contentContainerClassName="gap-5 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <View className="gap-2">
          <SectionTitleText className="text-base">Statut de la facture</SectionTitleText>
          <BodyMdText className="text-text-secondary">Le statut est mis à jour par vous après vérification du paiement.</BodyMdText>
        </View>
        {shares.length === 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {(entityDefinition.statuses ?? []).filter((status) => status.key !== 'partielle').map((s) => (
              <Chip key={s.key} label={s.label} active={record.statusKey === s.key} onPress={() => onChangeStatus(s.key)} />
            ))}
          </View>
        ) : (
          <BodyMdText>État calculé à partir des validations manuelles des lignes.</BodyMdText>
        )}

        {shares.length > 0 && (
          <Card className="gap-3">
            <SectionTitleText className="text-base">Parts à recouvrer</SectionTitleText>
            <SecondaryButton
              label="Partager le récapitulatif"
              icon="ios-share"
              onPress={() => Share.share({
                title: 'Répartition de facture',
                message: [
                  `FACTURE ${String(record.values.fournisseur ?? '').toUpperCase()} · ${String(record.values.mois ?? '')}`,
                  `Total : ${typeof record.values.montant === 'number' ? record.values.montant.toLocaleString('fr-FR') : String(record.values.montant ?? 0)} FCFA`,
          ...shares.map((share) => `${share.label ?? share.tenantName ?? 'Ligne'}${share.unit ? ` (${share.unit})` : ''} : ${share.amount.toLocaleString('fr-FR')} FCFA — ${share.status === 'payee' ? 'Payé' : 'À payer'}`),
                ].join('\n'),
              })}
            />
            {shares.map((share, index) => (
              <View key={share.lineId ?? share.tenantId ?? `${share.label ?? share.tenantName}-${index}`} className="flex-row items-center gap-3 border-t border-border pt-3">
                <View className="flex-1">
                  <BodyMdText className="font-inter-semibold text-text-primary">{share.label ?? share.tenantName ?? 'Ligne'}{share.unit ? ` · ${share.unit}` : ''}</BodyMdText>
                  <LabelText>{share.amount.toLocaleString('fr-FR')} FCFA · {share.status === 'payee' ? `Payé ${share.paidAt ? formatRelativeTime(share.paidAt) : ''}` : 'À payer'}</LabelText>
                  {String(record.values.mode_repartition) === 'INDEX' && <LabelText>Index {share.previousIndex} → {share.currentIndex} · {share.consumption} unités</LabelText>}
                </View>
                {share.status === 'payee' ? (
                  <Chip label="Payé" active />
                ) : (
                  <SecondaryButton fullWidth={false} label="Valider" icon="check" className="px-3" onPress={() => validateShare(index)} />
                )}
              </View>
            ))}
          </Card>
        )}

        {editing ? (
          <Card className="gap-4">
            {entityDefinition.fields.filter((field) => !['repartitions_json', 'bien_id', 'bien_nom', 'mode_repartition'].includes(field.key)).map((field) => (
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
              {entityDefinition.fields.filter((field) => !['repartitions_json', 'bien_id', 'bien_nom', 'mode_repartition'].includes(field.key)).map((field, i) => (
                <View key={field.id}>
                  {i > 0 && <View className="h-px bg-border" />}
                  <View className="flex-row items-center justify-between p-gutter-card">
                    <LabelText>{field.label}</LabelText>
                    <BodyMdText className="text-right text-text-primary">
                      {record.values[field.key] !== null && record.values[field.key] !== undefined
                        ? field.key === 'montant' && typeof record.values[field.key] === 'number'
                          ? formatFcfa(record.values[field.key] as number)
                          : String(record.values[field.key])
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
