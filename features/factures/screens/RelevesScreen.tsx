import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
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
import type { EntityDefinition, RecordItem, Tool } from '@/types/entities';

type ReadingInput = { id: string; compteur: string; index: string; note: string };
const newRow = (): ReadingInput => ({ id: `${Date.now()}-${Math.random()}`, compteur: '', index: '', note: '' });

export function RelevesScreen() {
  const [tool, setTool] = useState<Tool | null>(null);
  const [definition, setDefinition] = useState<EntityDefinition | null>(null);
  const [type, setType] = useState('CEET');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [rows, setRows] = useState<ReadingInput[]>([newRow()]);
  const [saved, setSaved] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const save = async () => {
    if (!tool || !definition) return;
    const validRows = rows.filter((row) => row.compteur.trim() && row.index.trim() !== '' && Number.isFinite(Number(row.index)));
    if (!validRows.length) {
      Alert.alert('Aucun relevé à enregistrer', 'Indiquez au moins un compteur et son index.');
      return;
    }
    setSaving(true);
    try {
      const byCounter = new Map(saved.map((record) => [String(record.values.compteur).trim().toLowerCase(), record]));
      for (const row of validRows) {
        const key = row.compteur.trim().toLowerCase();
        const previous = byCounter.get(key);
        const values = { fournisseur: type, mois: month, compteur: row.compteur.trim(), index: Number(row.index), note: row.note.trim() || null };
        if (previous) await coreService.updateRecord(previous.id, { values });
        else byCounter.set(key, await coreService.createRecord({ toolId: tool.id, entityDefinitionId: definition.id, values }));
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
              <TextField label="Nom ou repère du compteur" placeholder="Ex. Boutique, compteur 2" value={row.compteur} onChangeText={(value) => setRows((all) => all.map((item) => item.id === row.id ? { ...item, compteur: value } : item))} />
              <TextField label="Index relevé" value={row.index} onChangeText={(value) => setRows((all) => all.map((item) => item.id === row.id ? { ...item, index: value } : item))} keyboardType="numeric" />
              <TextField label="Note facultative" value={row.note} onChangeText={(value) => setRows((all) => all.map((item) => item.id === row.id ? { ...item, note: value } : item))} />
            </View>
          ))}
          <SecondaryButton label="Ajouter un compteur" icon="add" onPress={() => setRows((all) => [...all, newRow()])} />
          <PrimaryButton label="Enregistrer les index" loading={saving} disabled={!/^\d{4}-\d{2}$/.test(month)} onPress={save} />
        </Card>

        <View className="gap-3">
          <SectionTitleText className="text-base">Enregistrés · {type} · {month}</SectionTitleText>
          {loading ? <LoadingState /> : saved.length === 0 ? (
            <EmptyState icon="speed" title="Aucun index pour ce mois" description="Les relevés que vous ajoutez ici pourront servir au calcul des prochaines factures." compact />
          ) : saved.map((record) => (
            <Pressable key={record.id} onLongPress={() => remove(record)} className="flex-row items-center gap-3 rounded-xl border border-border bg-surface p-gutter-card">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft"><MaterialIcons name="speed" size={19} color={Colors.primary} /></View>
              <View className="flex-1"><LabelText className="font-inter-semibold text-text-primary">{String(record.values.compteur)}</LabelText><LabelText>Index {String(record.values.index)}{record.values.note ? ` · ${String(record.values.note)}` : ''}</LabelText></View>
              <Pressable onPress={() => remove(record)} hitSlop={10}><MaterialIcons name="delete-outline" size={20} color={Colors.textMuted} /></Pressable>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
