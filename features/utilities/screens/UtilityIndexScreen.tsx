import { useCallback, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { formatMonth } from '@/components/ui/MonthPicker';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { deleteReleve, periodeLabel, RELEVE_VERROUILLE_MESSAGE, updateReleveIndex } from '@/services/utilityBillingService';
import {
  buildIndexPeriodView,
  loadIndexData,
  saveRelevesPeriode,
  type IndexPeriodRow,
  type UtilityModule,
  type UtilityParticipation,
} from '@/services/utilityParticipantsService';
import type { RecordItem } from '@/types/entities';
import { friendlyMessage, parseIndexInput } from '../errors';
import { InlineNotice, type NoticeTone } from '../components/InlineNotice';
import { PeriodSelector } from '../components/PeriodSelector';
import { currentMonth, MODULE_META } from '../meta';

/** « en mars 2026 », « en mars 2026, avril 2026 » ou « de mars 2026 à septembre 2026 » (au-delà de deux mois). */
function missingText(months: string[]): string {
  return months.length > 2 ? `de ${periodeLabel(months[0])} à ${periodeLabel(months[months.length - 1])}` : `en ${months.map(periodeLabel).join(', ')}`;
}

/** Index (relevés) d'un module, période par période : on retrouve ce qui est
 * enregistré, on saisit ce qui manque. L'index précédent et la consommation sont
 * déduits des relevés réels — rien n'est comblé ni deviné. Un relevé peut être
 * corrigé ou supprimé tant qu'aucune facture validée ne l'utilise ; ensuite il est
 * verrouillé. Les relevés sont indépendants des factures : on peut saisir
 * plusieurs mois à l'avance. */
export function UtilityIndexScreen({ module }: { module: UtilityModule }) {
  const meta = MODULE_META[module];
  // `?periode=AAAA-MM` (ex. depuis la répartition d'une facture) ouvre directement la bonne période.
  const { periode: requested } = useLocalSearchParams<{ periode?: string }>();
  const [periode, setPeriode] = useState(typeof requested === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : currentMonth());
  const [participations, setParticipations] = useState<UtilityParticipation[]>([]);
  const [releves, setReleves] = useState<RecordItem[]>([]);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // Le message est en haut de l'écran : on y remonte pour qu'il soit toujours vu.
  const showNotice = (n: { tone: NoticeTone; text: string }) => {
    setNotice(n);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const load = useCallback(async () => {
    try {
      const data = await loadIndexData(module);
      setParticipations(data.participations);
      setReleves(data.releves);
      setLocked(data.locked);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [module]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rows = useMemo(() => buildIndexPeriodView(participations, releves, module, periode, locked), [participations, releves, module, periode, locked]);
  const pending = rows.filter((r) => !r.actuel);

  const parsed = pending.map((r) => ({ row: r, input: parseIndexInput(inputs[r.participation.record.id]) }));
  const typed = parsed.filter((p) => !p.input.empty);
  const hasInvalid = typed.some((p) => 'error' in p.input);

  // Écarts de relevés : un seul message par situation identique, avec les noms concernés.
  const gapGroups = useMemo(() => {
    const groups = new Map<string, { previous: string; missing: string[]; names: string[] }>();
    for (const r of rows) {
      if (!r.precedent || r.missingMonths.length === 0) continue;
      const previous = String(r.precedent.values.mois);
      const key = `${previous}|${r.missingMonths.join(',')}`;
      const g = groups.get(key) ?? { previous, missing: r.missingMonths, names: [] };
      g.names.push(r.participation.displayName);
      groups.set(key, g);
    }
    return [...groups.values()];
  }, [rows]);

  const changePeriode = (next: string) => {
    setPeriode(next);
    setInputs({});
    setEditing(null);
    setConfirmDelete(null);
    setNotice(null);
  };

  const run = async (action: () => Promise<string>) => {
    setSaving(true);
    setNotice(null);
    try {
      const text = await action();
      showNotice({ tone: 'success', text });
      await load();
    } catch (e) {
      showNotice({ tone: 'error', text: friendlyMessage(e) });
      await load(); // l'état affiché reflète toujours ce qui est réellement enregistré
    } finally {
      setSaving(false);
    }
  };

  const onSave = () =>
    run(async () => {
      const entries = typed.map((p) => ({ participationId: p.row.participation.record.id, index: (p.input as { value: number }).value }));
      await saveRelevesPeriode({ fournisseur: module, periode, entries });
      setInputs({});
      return `${entries.length} index enregistré${entries.length > 1 ? 's' : ''} pour ${periodeLabel(periode)}.`;
    });

  const onSaveEdit = () => {
    if (!editing) return;
    const input = parseIndexInput(editing.text);
    if (input.empty || 'error' in input) {
      showNotice({ tone: 'error', text: 'Saisissez uniquement des chiffres (un index ne peut pas être négatif).' });
      return;
    }
    return run(async () => {
      await updateReleveIndex(editing.id, input.value);
      setEditing(null);
      return 'Index corrigé.';
    });
  };

  const renderRow = (row: IndexPeriodRow) => {
    const id = row.participation.record.id;
    const prevIndex = row.precedent && typeof row.precedent.values.index === 'number' ? row.precedent.values.index : null;
    const releve = row.actuel;
    const input = parseIndexInput(inputs[id]);
    const lowerThanPrev = !releve && !input.empty && 'value' in input && prevIndex !== null && input.value < prevIndex;
    return (
      <Card key={id} className="gap-2">
        <View>
          <SectionTitleText className="text-base" numberOfLines={1}>{row.participation.displayName}</SectionTitleText>
          {row.participation.phone ? <LabelText numberOfLines={1}>{row.participation.phone}</LabelText> : null}
        </View>

        {releve ? (
          <>
            {editing?.id === releve.id ? (
              <>
                <TextField label="Nouvel index" keyboardType="numeric" value={editing.text} onChangeText={(t) => setEditing({ id: releve.id, text: t })} />
                <View className="flex-row gap-3">
                  <View className="flex-1"><SecondaryButton label="Annuler" onPress={() => setEditing(null)} /></View>
                  <View className="flex-1"><PrimaryButton label="Enregistrer" loading={saving} onPress={onSaveEdit} /></View>
                </View>
              </>
            ) : (
              <>
                <BodyMdText className="text-text-primary">Index : {String(releve.values.index)}</BodyMdText>
                {row.consommation !== null && (
                  <LabelText>
                    Consommation : {row.consommation} {meta.unit}
                    {row.precedent ? ` (depuis ${formatMonth(String(row.precedent.values.mois))})` : ''}
                  </LabelText>
                )}
                {row.issue === 'INDEX_ACTUEL_INFERIEUR' && (
                  <LabelText style={{ color: Colors.error }}>
                    Cet index est inférieur au précédent ({prevIndex}). Corrigez-le avant de poursuivre : la facture ne pourra pas être validée avec cette valeur.
                  </LabelText>
                )}
                {row.precedent === null && <LabelText>Premier relevé enregistré : aucune consommation à calculer.</LabelText>}
                {row.locked ? (
                  <View className="flex-row items-start gap-2">
                    <MaterialIcons name="lock-outline" size={16} color={Colors.textMuted} style={{ marginTop: 1 }} />
                    <LabelText className="flex-1">{RELEVE_VERROUILLE_MESSAGE}</LabelText>
                  </View>
                ) : confirmDelete === releve.id ? (
                  <View className="gap-3">
                    <BodyMdText className="text-text-primary">Supprimer ce relevé ? Cette action est définitive.</BodyMdText>
                    <View className="flex-row gap-3">
                      <View className="flex-1"><SecondaryButton label="Annuler" onPress={() => setConfirmDelete(null)} /></View>
                      <View className="flex-1">
                        <PrimaryButton label="Supprimer" loading={saving} onPress={() => run(async () => { await deleteReleve(releve.id); setConfirmDelete(null); return 'Relevé supprimé.'; })} />
                      </View>
                    </View>
                  </View>
                ) : (
                  <View className="flex-row gap-3">
                    <View className="flex-1"><SecondaryButton label="Modifier" icon="edit" disabled={saving} onPress={() => { setNotice(null); setEditing({ id: releve.id, text: String(releve.values.index) }); }} /></View>
                    <View className="flex-1"><SecondaryButton label="Supprimer" icon="delete-outline" disabled={saving} onPress={() => { setNotice(null); setConfirmDelete(releve.id); }} /></View>
                  </View>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <TextField label="Index relevé" keyboardType="numeric" value={inputs[id] ?? ''} onChangeText={(t) => setInputs((prev) => ({ ...prev, [id]: t }))} />
            {!input.empty && 'error' in input && <LabelText style={{ color: Colors.error }}>{input.error}</LabelText>}
            <LabelText>{prevIndex !== null ? `Précédent : ${prevIndex} (${formatMonth(String(row.precedent!.values.mois))})` : 'Aucun relevé précédent.'}</LabelText>
            {lowerThanPrev && <LabelText style={{ color: Colors.warning }}>Cet index est inférieur au précédent ({prevIndex}). Vérifiez la valeur.</LabelText>}
          </>
        )}
      </Card>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title={`Index ${meta.label}`} showBack trailing={<MaterialIcons name={meta.icon} size={22} color={Colors.primary} />} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView ref={scrollRef} contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
          <PeriodSelector value={periode} onChange={changePeriode} />
          <SectionTitleText className="text-center text-lg">{formatMonth(periode)}</SectionTitleText>

          {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}

          {error ? (
            <ErrorState onRetry={load} />
          ) : loading ? (
            <LoadingState />
          ) : participations.length === 0 ? (
            <EmptyState
              icon="group-add"
              title="Aucun participant"
              description={`Ajoutez d'abord les personnes concernées par ${meta.label} pour enregistrer leurs index.`}
              actionLabel="Ajouter des participants"
              onAction={() => router.replace(`/${module}/participants` as never)}
            />
          ) : (
            <>
              {gapGroups.map((g) => (
                <InlineNotice key={`${g.previous}-${g.missing.join(',')}`} tone="warning">
                  {`Aucun relevé enregistré ${missingText(g.missing)} (dernier relevé : ${periodeLabel(g.previous)}) pour ${g.names.length > 1 ? `${g.names.length} participants` : 'un participant'} : ${g.names.join(', ')}. Les consommations sont calculées depuis ${periodeLabel(g.previous)}.`}
                </InlineNotice>
              ))}

              <View className="gap-3">{rows.map(renderRow)}</View>

              {pending.length > 0 ? (
                <PrimaryButton label="Enregistrer les index" disabled={typed.length === 0 || hasInvalid} loading={saving} onPress={onSave} />
              ) : (
                <LabelText className="text-center">Tous les index de {formatMonth(periode)} sont enregistrés.</LabelText>
              )}
              {/* Navigation entre sœurs : on remplace l'écran au lieu d'empiler. */}
              <SecondaryButton label="Participants" icon="group" onPress={() => router.replace(`/${module}/participants` as never)} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
