import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { EmptyState, LoadingState } from '@/components/ui/States';
import { LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { coreService } from '@/services/coreService';
import { ensureFacturesTool } from '@/services/facturesService';
import { ensureImmobilierTool } from '@/services/immobilierService';
import { saveReleve, type Participant, type ParticipantType } from '@/services/utilityBillingService';
import type { EntityDefinition, RecordItem, Tool } from '@/types/entities';

type ReadingInput = { id: string; participant: Participant; index: string; note: string };
const newRow = (): ReadingInput => ({ id: `${Date.now()}-${Math.random()}`, participant: { type: 'manuel', id: null, label: '' }, index: '', note: '' });

/** Cahier des index — un relevé par (fournisseur, mois, participant). Le
 * participant est toujours identifié par un vrai id Core (Contrat.id ou nul
 * pour une saisie libre), jamais par le seul libellé tapé : deux biens ayant
 * chacun un "compteur Boutique" ne peuvent donc jamais se confondre (voir le
 * rapport de fusion Étape 4). Écran partagé avec Immobilier — voir
 * services/utilityBillingService.ts pour le moteur commun. */
export function RelevesScreen() {
  const [tool, setTool] = useState<Tool | null>(null);
  const [definition, setDefinition] = useState<EntityDefinition | null>(null);
  const [type, setType] = useState('CEET');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<ReadingInput[]>([newRow()]);
  const [saved, setSaved] = useState<RecordItem[]>([]);
  const [biens, setBiens] = useState<RecordItem[]>([]);
  const [contratsByBien, setContratsByBien] = useState<Record<string, RecordItem[]>>({});
  const [pickerRowId, setPickerRowId] = useState<string | null>(null);
  const [pickerBienId, setPickerBienId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    ensureImmobilierTool().then(async ({ tool: immoTool, bien, contrat }) => {
      const allBiens = await coreService.getRecords({ toolId: immoTool.id, entityDefinitionId: bien.id });
      setBiens(allBiens);
      const allContrats = await coreService.getRecords({ toolId: immoTool.id, entityDefinitionId: contrat.id });
      const grouped: Record<string, RecordItem[]> = {};
      for (const c of allContrats) {
        if (c.statusKey !== 'actif') continue;
        const key = String(c.values.bien);
        (grouped[key] ??= []).push(c);
      }
      setContratsByBien(grouped);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const ensured = await ensureFacturesTool();
    setTool(ensured.tool);
    setDefinition(ensured.releveDefinition);
    const records = await coreService.getRecords({ toolId: ensured.tool.id, entityDefinitionId: ensured.releveDefinition.id });
    setSaved(records.filter((record) => record.values.fournisseur === type && record.values.mois === month));
    setLoading(false);
  }, [month, type]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setRowParticipant = (rowId: string, participant: Participant) => setRows((all) => all.map((r) => (r.id === rowId ? { ...r, participant } : r)));

  const save = async () => {
    if (!tool || !definition) return;
    const validRows = rows.filter((row) => row.participant.label.trim() && row.index.trim() !== '' && Number.isFinite(Number(row.index)));
    if (!validRows.length) {
      Alert.alert('Aucun relevé à enregistrer', 'Indiquez au moins un participant et son index.');
      return;
    }
    setSaving(true);
    try {
      let existing = saved;
      for (const row of validRows) {
        const record = await saveReleve({
          toolId: tool.id,
          releveEntityDefinitionId: definition.id,
          fournisseur: type,
          periode: month,
          participant: { ...row.participant, label: row.participant.label.trim() },
          index: Number(row.index),
          note: row.note.trim() || null,
          existing,
        });
        existing = [...existing.filter((r) => r.id !== record.id), record];
      }
      setRows([newRow()]);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = (record: RecordItem) => Alert.alert('Supprimer ce relevé ?', `${record.values.compteur} · index ${record.values.index}`, [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Supprimer', style: 'destructive', onPress: async () => { await coreService.deleteRecord(record.id); await load(); } },
  ]);

  const setRowType = (rowId: string, participantType: ParticipantType) => {
    if (participantType === 'manuel') {
      setRowParticipant(rowId, { type: 'manuel', id: null, label: '' });
      setPickerRowId(null);
    } else {
      setPickerRowId(rowId);
      setPickerBienId(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Cahier des index" showBack trailing={<MaterialIcons name="speed" size={22} color={Colors.primary} />} />
      <ScrollView contentContainerClassName="gap-4 px-page-margin pb-10" keyboardShouldPersistTaps="handled">
        <Card className="gap-4">
          <SectionTitleText className="text-base">Relevés manuels</SectionTitleText>
          <View className="flex-row flex-wrap gap-2">
            {['CEET', 'TDE', 'Autre'].map((item) => <Chip key={item} label={item} active={type === item} onPress={() => setType(item)} />)}
          </View>
          <TextField label="Mois" placeholder="AAAA-MM" value={month} onChangeText={setMonth} />
          {rows.map((row) => (
            <View key={row.id} className="gap-3 border-t border-border pt-3">
              <View className="flex-row gap-2">
                <Chip label="Depuis un bien" active={row.participant.type === 'contrat'} onPress={() => setRowType(row.id, 'contrat')} />
                <Chip label="Saisie libre" active={row.participant.type === 'manuel'} onPress={() => setRowType(row.id, 'manuel')} />
              </View>
              {row.participant.type === 'manuel' ? (
                <TextField label="Nom ou repère du participant" placeholder="Ex. Boutique, compteur 2" value={row.participant.label} onChangeText={(value) => setRowParticipant(row.id, { ...row.participant, label: value })} />
              ) : (
                <Pressable onPress={() => setPickerRowId(row.id)} className="gap-1 rounded-md border border-border bg-surface px-4 py-3">
                  <LabelText className="text-text-secondary">Participant (contrat)</LabelText>
                  <LabelText className="text-text-primary">{row.participant.label || 'Choisir un bien et un contrat…'}</LabelText>
                </Pressable>
              )}
              <TextField label="Index relevé" value={row.index} onChangeText={(value) => setRows((all) => all.map((item) => item.id === row.id ? { ...item, index: value } : item))} keyboardType="numeric" />
              <TextField label="Note facultative" value={row.note} onChangeText={(value) => setRows((all) => all.map((item) => item.id === row.id ? { ...item, note: value } : item))} />

              {pickerRowId === row.id && row.participant.type === 'contrat' && (
                <View className="gap-2 rounded-md border border-border bg-background-secondary p-3">
                  <LabelText className="text-text-secondary">Bien</LabelText>
                  <View className="flex-row flex-wrap gap-2">
                    {biens.map((b) => <Chip key={b.id} label={String(b.values.nom)} active={pickerBienId === b.id} onPress={() => setPickerBienId(b.id)} />)}
                  </View>
                  {pickerBienId && (
                    <>
                      <LabelText className="text-text-secondary">Contrat</LabelText>
                      <View className="flex-row flex-wrap gap-2">
                        {(contratsByBien[pickerBienId] ?? []).length === 0 ? (
                          <LabelText>Aucun contrat actif pour ce bien.</LabelText>
                        ) : (
                          (contratsByBien[pickerBienId] ?? []).map((c) => {
                            const label = typeof c.values.locataire_nom === 'string' && c.values.locataire_nom ? c.values.locataire_nom : String(c.values.nom_logement ?? 'Locataire');
                            return (
                              <Chip
                                key={c.id}
                                label={label}
                                active={row.participant.id === c.id}
                                onPress={() => { setRowParticipant(row.id, { type: 'contrat', id: c.id, label }); setPickerRowId(null); }}
                              />
                            );
                          })
                        )}
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>
          ))}
          <SecondaryButton label="Ajouter un participant" icon="add" onPress={() => setRows((all) => [...all, newRow()])} />
          <PrimaryButton label="Enregistrer les index" loading={saving} disabled={!/^\d{4}-\d{2}$/.test(month)} onPress={save} />
        </Card>

        <View className="gap-3">
          <SectionTitleText className="text-base">Enregistrés · {type} · {month}</SectionTitleText>
          {loading ? <LoadingState /> : saved.length === 0 ? (
            <EmptyState icon="speed" title="Aucun index pour ce mois" description="Les relevés que vous ajoutez ici pourront servir au calcul des prochaines factures." compact />
          ) : saved.map((record) => (
            <Pressable key={record.id} onLongPress={() => remove(record)} className="flex-row items-center gap-3 rounded-xl border border-border bg-surface p-gutter-card">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft"><MaterialIcons name={record.values.participant_type === 'contrat' ? 'home-work' : 'speed'} size={19} color={Colors.primary} /></View>
              <View className="flex-1"><LabelText className="font-inter-semibold text-text-primary">{String(record.values.compteur)}</LabelText><LabelText>Index {String(record.values.index)}{record.values.note ? ` · ${String(record.values.note)}` : ''}</LabelText></View>
              <Pressable onPress={() => remove(record)} hitSlop={10}><MaterialIcons name="delete-outline" size={20} color={Colors.textMuted} /></Pressable>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
