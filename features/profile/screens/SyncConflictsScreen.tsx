import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { BodyMdText, LabelText, SectionTitleText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import {
  decideConflict,
  listOpenConflicts,
  listRecoverableDeletions,
  listResolvedConflicts,
  restoreDeletion,
  type ConflictView,
  type RecoverableDeletion,
  type ResolutionName,
} from '@/services/syncDisplay';
import { useSyncEngineStore } from '@/store/syncEngineStore';

const TYPE_LABELS: Record<string, string> = {
  both_modified: 'Modifié des deux côtés',
  no_base: 'Version différente dans le cloud',
  update_vs_delete: 'Modifié ici, supprimé ailleurs',
  delete_vs_update: 'Supprimé ici, modifié ailleurs',
  financial_remote_change: 'Paiement modifié ailleurs',
  financial_remote_delete: 'Suppression d’un paiement reçue',
  restored_tombstone: 'Élément supprimé puis restauré',
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const show = (value: unknown): string => (value === undefined || value === null || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value));

function fieldValue(side: { body: Record<string, unknown>; refs: Record<string, string>; statusKey: string | null } | null, field: string): string {
  if (!side) return 'supprimé';
  if (field === 'statusKey') return show(side.statusKey);
  return show(field in side.body ? side.body[field] : side.refs[field]);
}

const remoteSide = (c: ConflictView) => (c.remote.wire ? { body: c.remote.wire.body, refs: c.remote.wire.refs, statusKey: c.remote.wire.statusKey } : null);

const RESOLUTIONS: { name: ResolutionName; label: string }[] = [
  { name: 'keep_local', label: 'Garder ma version' },
  { name: 'keep_remote', label: 'Garder la version du cloud' },
];

function ConflictCard({ conflict, busy, onDecide }: { conflict: ConflictView; busy: boolean; onDecide: (id: string, name: ResolutionName, picks?: Record<string, 'local' | 'remote'>) => void }) {
  const [picking, setPicking] = useState(false);
  const [picks, setPicks] = useState<Record<string, 'local' | 'remote'>>({});
  const remote = remoteSide(conflict);
  const complete = conflict.fields.length > 0 && conflict.fields.every((f) => picks[f]);
  return (
    <Card className="gap-3">
      <View className="gap-1">
        <LabelText className="font-inter-semibold text-text-primary">{conflict.kindLabel}</LabelText>
        <LabelText>{TYPE_LABELS[conflict.type] ?? conflict.type} · détecté le {when(conflict.detectedAt)}</LabelText>
        {conflict.financial ? <LabelText style={{ color: Colors.warning }}>Fait financier : jamais écrasé ni supprimé sans correction explicite.</LabelText> : null}
      </View>
      {conflict.fields.map((f) => (
        <View key={f} className="gap-1">
          <LabelText className="font-inter-semibold">{f}</LabelText>
          <BodyMdText>Ma version : {fieldValue(conflict.local, f)}</BodyMdText>
          <BodyMdText>Version du cloud : {fieldValue(remote, f)}</BodyMdText>
          {picking ? (
            <View className="flex-row gap-2">
              <SecondaryButton fullWidth={false} label={picks[f] === 'local' ? '✓ La mienne' : 'La mienne'} onPress={() => setPicks({ ...picks, [f]: 'local' })} />
              <SecondaryButton fullWidth={false} label={picks[f] === 'remote' ? '✓ Celle du cloud' : 'Celle du cloud'} onPress={() => setPicks({ ...picks, [f]: 'remote' })} />
            </View>
          ) : null}
        </View>
      ))}
      {RESOLUTIONS.map(({ name, label }) => {
        const option = conflict.options[name];
        return (
          <View key={name} className="gap-1">
            <PrimaryButton label={label} disabled={!option.allowed || busy} onPress={() => onDecide(conflict.recordId, name)} />
            <LabelText style={option.allowed ? undefined : { color: Colors.error }}>{option.allowed ? option.effect : option.reason}</LabelText>
          </View>
        );
      })}
      {conflict.options.fields.allowed ? (
        picking ? (
          <PrimaryButton label="Valider mes choix" disabled={!complete || busy} onPress={() => onDecide(conflict.recordId, 'fields', picks)} />
        ) : (
          <SecondaryButton label="Choisir champ par champ" disabled={busy} onPress={() => setPicking(true)} />
        )
      ) : (
        <LabelText style={{ color: Colors.error }}>{conflict.options.fields.reason}</LabelText>
      )}
    </Card>
  );
}

/** Conflits de synchronisation et suppressions récupérables. N'offre que les décisions que le moteur accepte, explique chaque refus et
 * conserve l'historique (la version écartée reste récupérable). Rien n'est envoyé par cet écran : la décision s'applique localement. */
export function SyncConflictsScreen() {
  const refresh = useSyncEngineStore((s) => s.refresh);
  const [state, setState] = useState<{ open: ConflictView[]; deletions: RecoverableDeletion[]; resolved: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [open, deletions, resolved] = await Promise.all([listOpenConflicts(), listRecoverableDeletions(), listResolvedConflicts()]);
      setState({ open, deletions, resolved: resolved.length });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lecture impossible.');
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const finish = async (outcome: { ok: true } | { ok: false; message: string }, success: string) => {
    setNotice(outcome.ok ? success : outcome.message);
    await load();
    await refresh();
    setBusy(false);
  };

  const decide = async (id: string, name: ResolutionName, picks?: Record<string, 'local' | 'remote'>) => {
    setBusy(true);
    const outcome = await decideConflict(id, name === 'fields' ? { type: 'fields', picks: picks ?? {} } : { type: name });
    await finish(outcome, 'Décision enregistrée. L’ancienne version reste dans l’historique.');
  };

  const restore = async (id: string) => {
    setBusy(true);
    await finish(await restoreDeletion(id), 'Élément restauré localement.');
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <AppHeader title="Conflits de synchronisation" />
      {error ? (
        <ErrorState description={error} onRetry={() => void load()} />
      ) : !state ? (
        <LoadingState />
      ) : (
        <ScrollView contentContainerClassName="gap-4 p-gutter pb-10">
          {notice ? <LabelText style={{ color: Colors.primary }}>{notice}</LabelText> : null}
          {state.open.length === 0 && state.deletions.length === 0 ? <EmptyState icon="check-circle" title="Aucun conflit" description="Toutes vos données concordent avec le cloud." /> : null}
          {state.open.length > 0 ? <SectionTitleText>À résoudre ({state.open.length})</SectionTitleText> : null}
          {state.open.map((c) => (
            <ConflictCard key={c.recordId} conflict={c} busy={busy} onDecide={(id, name, picks) => void decide(id, name, picks)} />
          ))}
          {state.deletions.length > 0 ? <SectionTitleText>Suppressions récupérables ({state.deletions.length})</SectionTitleText> : null}
          {state.deletions.map((d) => (
            <Card key={d.recordId} className="gap-2">
              <LabelText className="font-inter-semibold text-text-primary">{d.kindLabel}</LabelText>
              <LabelText>Supprimé ailleurs le {when(d.deletedAt ?? d.receivedAt)}. Une copie complète est conservée.</LabelText>
              <SecondaryButton label="Restaurer ici" disabled={busy} onPress={() => void restore(d.recordId)} />
            </Card>
          ))}
          {state.resolved > 0 ? <LabelText>{state.resolved} conflit(s) résolu(s) conservé(s) dans l’historique.</LabelText> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
