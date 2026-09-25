import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/States';
import { SectionTitleText } from '@/components/ui/Typography';
import { CoreFieldRenderer } from '@/components/core/CoreFieldRenderer';
import { TextField } from '@/components/ui/TextField';
import { Chip } from '@/components/ui/Chip';
import { useCoreStore } from '@/store/coreStore';
import { coreService } from '@/services/coreService';
import { ensureFacturesTool } from '@/services/facturesService';
import type { EntityDefinition, FieldValue, RecordItem } from '@/types/entities';

type Line = { id: string; label: string; previous: string; current: string };
const freshLine = (): Line => ({ id: `${Date.now()}-${Math.random()}`, label: '', previous: '', current: '' });
const monthNow = () => new Date().toISOString().slice(0, 7);

export function FactureFormScreen() {
  const [entity, setEntity] = useState<EntityDefinition | null>(null);
  const [readingEntity, setReadingEntity] = useState<EntityDefinition | null>(null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [customValues, setCustomValues] = useState<Record<string, FieldValue>>({});
  const [type, setType] = useState('CEET');
  const [month, setMonth] = useState(monthNow());
  const [mode, setMode] = useState<'INDEX' | 'EGAL'>('INDEX');
  const [lines, setLines] = useState<Line[]>([freshLine()]);
  const [readings, setReadings] = useState<RecordItem[]>([]);
  const [saving, setSaving] = useState(false);
  const createRecord = useCoreStore((s) => s.createRecord);

  useEffect(() => {
    let active = true;
    ensureFacturesTool().then(async ({ tool, entityDefinition, releveDefinition }) => {
      if (!active) return;
      setToolId(tool.id); setEntity(entityDefinition); setReadingEntity(releveDefinition);
      const now = new Date();
      setValues({
        fournisseur: 'CEET', reference_compteur: '', mois: monthNow(), montant: null,
        date_emission: now.toISOString().slice(0, 10), echeance: null, mode_paiement: null,
        date_paiement: null, note: null, justificatif: null, client: null,
      });
      const records = await coreService.getRecords({ toolId: tool.id, entityDefinitionId: releveDefinition.id });
      if (active) setReadings(records);
    }).catch(() => Alert.alert('Erreur', 'Impossible de charger le formulaire Factures.'));
    return () => { active = false; };
  }, []);

  const customFields = useMemo(() => (entity?.fields ?? []).filter((f) => f.key.startsWith('custom_')), [entity]);
  const currentReadings = readings.filter((r) => r.values.fournisseur === type && r.values.mois === month);
  const previousMonth = useMemo(() => {
    const [year, m] = month.split('-').map(Number);
    return Number.isFinite(year) && Number.isFinite(m) ? new Date(year, m - 2, 1).toISOString().slice(0, 7) : '';
  }, [month]);
  const previousReadings = readings.filter((r) => r.values.fournisseur === type && r.values.mois === previousMonth);

  const setLine = (id: string, key: keyof Line, value: string) => setLines((all) => all.map((line) => line.id === id ? { ...line, [key]: value } : line));
  const resolvedLine = (line: Line): Line => {
    const key = line.label.trim().toLowerCase();
    const current = currentReadings.find((r) => String(r.values.compteur).trim().toLowerCase() === key);
    const previous = previousReadings.find((r) => String(r.values.compteur).trim().toLowerCase() === key);
    return { ...line, current: line.current || (current ? String(current.values.index) : ''), previous: line.previous || (previous ? String(previous.values.index) : '') };
  };
  const lineUsage = (line: Line) => { const resolved = resolvedLine(line); return Math.max(0, Number(resolved.current) - Number(resolved.previous)); };
  const totalUsage = lines.reduce((sum, line) => sum + lineUsage(line), 0);
  const amount = Number(values.montant) || 0;
  let allocated = 0;
  const computed = lines.filter((line) => line.label.trim()).map((rawLine, index, all) => {
    const line = resolvedLine(rawLine);
    const usage = lineUsage(line);
    const share = mode === 'INDEX' && totalUsage > 0 ? usage / totalUsage : 1 / all.length;
    const part = index === all.length - 1 ? amount - allocated : Math.floor(amount * share);
    allocated += part;
    return { line, usage, part };
  });
  const requiredMissing = !values.fournisseur || !String(values.reference_compteur ?? '').trim() || !String(values.mois ?? '').trim() || !(Number(values.montant) > 0) || !values.date_emission || customFields.some((f) => f.required && (customValues[f.key] === null || customValues[f.key] === undefined || customValues[f.key] === ''));

  const save = async () => {
    if (!entity || !readingEntity || !toolId) return;
    if (computed.length === 0) {
      Alert.alert('Ajoutez une ligne', 'Indiquez au moins un compteur ou une personne pour répartir la facture.');
      return;
    }
    if (mode === 'INDEX' && computed.some(({ line }) => !line.previous || !line.current || lineUsage(line) < 0)) {
      Alert.alert('Vérifiez les index', 'Pour chaque ligne, indiquez un index précédent et un index actuel supérieur ou égal.');
      return;
    }
    setSaving(true);
    try {
      const shares = computed.map(({ line, usage, part }) => ({
        lineId: line.id, label: line.label.trim(), previousIndex: Number(line.previous) || 0,
        currentIndex: Number(line.current) || 0, consumption: usage, amount: part, status: 'a_payer', paidAt: null,
      }));
      const finalValues = {
        ...values, ...customValues, fournisseur: type, mois: month, mode_repartition: mode,
        repartitions_json: JSON.stringify(shares),
        date_paiement: null,
      };
      await createRecord({ toolId, entityDefinitionId: entity.id, values: finalValues, statusKey: 'a_payer' });
      // Save current meter readings additively; the free-form name is the only association.
      if (mode === 'INDEX') {
        const existing = new Map(currentReadings.map((r) => [String(r.values.compteur).trim().toLowerCase(), r]));
        for (const { line } of computed) {
          const currentIndex = Number(line.current);
          const key = line.label.trim().toLowerCase();
          if (!Number.isFinite(currentIndex)) continue;
          const readingValues = { fournisseur: type, mois: month, compteur: line.label.trim(), index: currentIndex, note: null };
          const found = existing.get(key);
          if (found) await coreService.updateRecord(found.id, { values: readingValues });
          else await coreService.createRecord({ toolId, entityDefinitionId: readingEntity.id, values: readingValues });
        }
      }
      router.back();
    } finally { setSaving(false); }
  };

  if (!entity || !readingEntity || !toolId) return <SafeAreaView className="flex-1 bg-background"><AppHeader title="Nouvelle facture" showBack /><View className="px-page-margin"><LoadingState /></View></SafeAreaView>;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title="Nouvelle facture" showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerClassName="gap-4 px-page-margin pb-6" keyboardShouldPersistTaps="handled">
          <SecondaryButton label="Ouvrir le cahier d’index" icon="speed" onPress={() => router.push('/factures/releves')} />
          <Card className="gap-4">
            <SectionTitleText className="text-base">Informations de facture</SectionTitleText>
            <View className="flex-row flex-wrap gap-2">{['CEET', 'TDE', 'Autre'].map((item) => <Chip key={item} label={item} active={type === item} onPress={() => { setType(item); setValues((v) => ({ ...v, fournisseur: item })); }} />)}</View>
            <TextField label="Mois de facture (AAAA-MM)" value={month} onChangeText={(v) => { setMonth(v); setValues((s) => ({ ...s, mois: v })); }} />
            {entity.fields.filter((f) => !['fournisseur', 'mois', 'mode_repartition', 'repartitions_json', 'bien_id', 'bien_nom', 'client'].includes(f.key) && !f.key.startsWith('custom_')).map((field) => <CoreFieldRenderer key={field.id} field={field} value={values[field.key] ?? null} onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))} />)}
          </Card>
          {customFields.length > 0 && <Card className="gap-4"><SectionTitleText className="text-base">Champs personnalisés</SectionTitleText>{customFields.map((field) => <CoreFieldRenderer key={field.id} field={field} value={customValues[field.key] ?? null} onChange={(v) => setCustomValues((prev) => ({ ...prev, [field.key]: v }))} />)}</Card>}
          <Card className="gap-4">
            <SectionTitleText className="text-base">Répartition manuelle</SectionTitleText>
            <View className="flex-row flex-wrap gap-2"><Chip label="Selon les index" active={mode === 'INDEX'} onPress={() => setMode('INDEX')} /><Chip label="À parts égales" active={mode === 'EGAL'} onPress={() => setMode('EGAL')} /></View>
            {lines.map((line) => {
              const current = currentReadings.find((r) => String(r.values.compteur).trim().toLowerCase() === line.label.trim().toLowerCase());
              const previous = previousReadings.find((r) => String(r.values.compteur).trim().toLowerCase() === line.label.trim().toLowerCase());
              return <View key={line.id} className="gap-3 border-t border-border pt-3">
                <TextField label="Nom libre (compteur, activité ou personne)" value={line.label} onChangeText={(v) => setLine(line.id, 'label', v)} />
                {mode === 'INDEX' && <View className="flex-row gap-3"><View className="flex-1"><TextField label="Index précédent" keyboardType="numeric" value={line.previous || (previous ? String(previous.values.index) : '')} onChangeText={(v) => setLine(line.id, 'previous', v)} /></View><View className="flex-1"><TextField label="Index actuel" keyboardType="numeric" value={line.current || (current ? String(current.values.index) : '')} onChangeText={(v) => setLine(line.id, 'current', v)} /></View></View>}
                <SecondaryButton label="Supprimer cette ligne" icon="delete-outline" onPress={() => setLines((all) => all.length > 1 ? all.filter((item) => item.id !== line.id) : all)} />
              </View>;
            })}
            <SecondaryButton label="Ajouter une ligne libre" icon="add" onPress={() => setLines((all) => [...all, freshLine()])} />
            {computed.map(({ line, usage, part }) => <SectionTitleText key={line.id} className="text-sm">{line.label}: {part.toLocaleString('fr-FR')} FCFA{mode === 'INDEX' ? ` · ${usage} unités` : ''}</SectionTitleText>)}
          </Card>
        </ScrollView>
        <View className="border-t border-border px-page-margin pb-4 pt-4"><PrimaryButton label="Enregistrer la facture" disabled={requiredMissing} loading={saving} onPress={save} /></View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
