import { useEffect, useState } from 'react';
import { Alert, Share, ScrollView, View, Pressable } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { TextField } from '@/components/ui/TextField';
import { LoadingState, EmptyState } from '@/components/ui/States';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SectionTitleText, LabelText, BodyMdText } from '@/components/ui/Typography';
import { formatFcfa, formatRelativeTime } from '@/utils/format';
import { coreService } from '@/services/coreService';
import { contratLabel, ensureImmobilierTool, loadImmobilierLookup } from '@/services/immobilierService';
import { ensureFacturesTool } from '@/services/facturesService';
import {
  findPreviousReleve,
  computeConsommation,
  computeRepartitionProportionnelle,
  computeRepartitionEquitable,
  saveReleve,
  validateRepartition,
  markPartStatus,
  buildReceiptText,
  type Participant,
  type RepartitionLine,
  type RepartitionMode,
} from '@/services/utilityBillingService';
import type { CoreEvent, RecordItem } from '@/types/entities';

interface RowState {
  // Identifiant LOCAL de la ligne, pour le suivi UI uniquement (clé React,
  // édition, suppression) — jamais persisté. À ne pas confondre avec
  // `participant.id`, qui est soit un vrai Contrat.id (Immobilier), soit
  // `null` pour une saisie libre (voir services/utilityBillingService.ts).
  rowKey: string;
  participant: Participant;
  indexPrecedent: string;
  indexPrecedentPrefilled: boolean;
  indexActuel: string;
}

const newRowKey = () => `row-${Date.now()}-${Math.random()}`;
const newManualParticipant = (): Participant => ({ type: 'manuel', id: null, label: '' });

/** Étape 2 du flux de répartition : relevés par participant, choix du mode,
 * prévisualisation, validation. Une fois validée, la facture_partagee devient
 * en lecture seule et cet écran affiche les parts + leur statut à la place.
 *
 * Fonctionne dans deux contextes avec le même moteur (services/utilityBillingService.ts) :
 *  - Immobilier : `facture.values.bien` est renseigné → les participants sont
 *    les contrats actifs du bien (jamais ressaisis à la main) ;
 *  - Factures autonome : pas de bien → l'utilisateur ajoute librement des
 *    participants (nom saisi), sans forcer de compte/contact. */
export function RepartitionScreen() {
  const { factureUtiliteId } = useLocalSearchParams<{ factureUtiliteId: string }>();
  const [toolId, setToolId] = useState<string | null>(null);
  const [releveEdId, setReleveEdId] = useState<string | null>(null);
  const [partLocataireEdId, setPartLocataireEdId] = useState<string | null>(null);
  const [facture, setFacture] = useState<RecordItem | null>(null);
  const [releves, setReleves] = useState<RecordItem[]>([]);
  const [parts, setParts] = useState<RecordItem[]>([]);
  const [events, setEvents] = useState<CoreEvent[]>([]);
  const [rows, setRows] = useState<RowState[]>([]);
  const [mode, setMode] = useState<RepartitionMode | null>(null);
  const [preview, setPreview] = useState<RepartitionLine[] | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isStandalone, setIsStandalone] = useState(false);

  const load = async () => {
    const ent = await ensureFacturesTool();
    setToolId(ent.tool.id);
    setReleveEdId(ent.releveDefinition.id);
    setPartLocataireEdId(ent.partLocataireDefinition.id);

    const f = await coreService.getRecord(factureUtiliteId);
    setFacture(f);
    if (!f) {
      setLoading(false);
      return;
    }

    const fournisseur = String(f.values.fournisseur ?? '');
    const periode = typeof f.values.mois === 'string' ? f.values.mois : '';
    const allReleves = await coreService.getRecords({ toolId: ent.tool.id, entityDefinitionId: ent.releveDefinition.id });
    setReleves(allReleves);

    const allParts = await coreService.getRecords({ toolId: ent.tool.id, entityDefinitionId: ent.partLocataireDefinition.id });
    const ownParts = allParts.filter((p) => p.values.facture_partagee === f.id);
    setParts(ownParts);

    // Déjà répartie (une facture validée peut redescendre à "partielle" sans
    // jamais revenir dans le flux d'édition — l'existence de parts suffit).
    if (ownParts.length > 0) {
      setEvents(await coreService.getEvents({ recordId: f.id }));
      setLoading(false);
      return;
    }

    let participants: Participant[] = [];
    if (typeof f.values.bien === 'string' && f.values.bien) {
      setIsStandalone(false);
      const immobilier = await ensureImmobilierTool();
      const allContrats = await coreService.getRecords({ toolId: immobilier.tool.id, entityDefinitionId: immobilier.contrat.id });
      const activeForBien = allContrats.filter((c) => c.values.bien === f.values.bien && c.statusKey === 'actif');
      const lookup = await loadImmobilierLookup();
      participants = activeForBien.map((c) => ({
        type: 'contrat' as const,
        id: c.id,
        label: contratLabel(c, lookup),
      }));
    } else {
      setIsStandalone(true);
    }

    setRows(
      participants.map((participant) => {
        const prev = findPreviousReleve(participant, fournisseur, periode, allReleves);
        return {
          rowKey: participant.id ?? newRowKey(),
          participant,
          indexPrecedent: prev && typeof prev.values.index === 'number' ? String(prev.values.index) : '',
          indexPrecedentPrefilled: !!prev,
          indexActuel: '',
        };
      }),
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factureUtiliteId]);

  const updateRow = (rowKey: string, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));
    setPreview(null);
    setCalcError(null);
  };

  const addManualRow = () => {
    setRows((prev) => [...prev, { rowKey: newRowKey(), participant: newManualParticipant(), indexPrecedent: '', indexPrecedentPrefilled: false, indexActuel: '' }]);
  };

  const removeManualRow = (rowKey: string) => {
    setRows((prev) => prev.filter((r) => r.rowKey !== rowKey));
    setPreview(null);
  };

  const indicesReady = (row: RowState) => row.indexPrecedent.trim() !== '' && row.indexActuel.trim() !== '' && !Number.isNaN(Number(row.indexPrecedent)) && !Number.isNaN(Number(row.indexActuel));
  const rowsHaveLabels = rows.length > 0 && rows.every((r) => r.participant.label.trim() !== '');
  const rowsReady = rowsHaveLabels && (mode === 'equitable' || rows.every(indicesReady));

  const onCalculer = () => {
    if (!mode || !facture) return;
    setCalcError(null);
    try {
      const montantTotal = typeof facture.values.montant_total === 'number' ? facture.values.montant_total : 0;
      if (mode === 'proportionnel') {
        const consommations = rows.map((r) => ({ participant: r.participant, consommation: computeConsommation(Number(r.indexPrecedent), Number(r.indexActuel)) }));
        setPreview(computeRepartitionProportionnelle(consommations, montantTotal));
      } else {
        setPreview(computeRepartitionEquitable(rows.map((r) => r.participant), montantTotal));
      }
    } catch (err) {
      setCalcError(err instanceof Error ? err.message : 'Erreur de calcul.');
    }
  };

  const onValider = async () => {
    if (!preview || !mode || !toolId || !releveEdId || !partLocataireEdId || !facture) return;
    setSaving(true);
    try {
      const fournisseur = String(facture.values.fournisseur ?? '');
      const periode = typeof facture.values.mois === 'string' ? facture.values.mois : '';
      let currentReleves = releves;
      if (mode === 'proportionnel') {
        for (const row of rows) {
          const saved = await saveReleve({
            toolId,
            releveEntityDefinitionId: releveEdId,
            fournisseur,
            periode,
            participant: row.participant,
            index: Number(row.indexActuel),
            existing: currentReleves,
          });
          currentReleves = [...currentReleves.filter((r) => r.id !== saved.id), saved];
        }
      }
      await validateRepartition({
        toolId,
        partLocataireEntityDefinitionId: partLocataireEdId,
        facturePartageeId: facture.id,
        mode,
        lines: preview,
      });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const onTogglePartStatus = (part: RecordItem) => {
    if (!toolId || !facture) return;
    const next: 'a_payer' | 'payee' = part.statusKey === 'payee' ? 'a_payer' : 'payee';
    Alert.alert(next === 'payee' ? 'Marquer cette part payée ?' : 'Remettre en attente ?', undefined, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Confirmer',
        onPress: async () => {
          await markPartStatus({ toolId, facturePartageeId: facture.id, partId: part.id, statusKey: next, allParts: parts });
          await load();
        },
      },
    ]);
  };

  const onShareReceipt = () => {
    if (!facture) return;
    Share.share({ message: buildReceiptText(facture, parts, releves) });
  };

  if (loading || !facture) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader title="Répartition" showBack />
        <View className="px-page-margin">
          <LoadingState />
        </View>
      </SafeAreaView>
    );
  }

  const fournisseurLabel = facture.values.fournisseur === 'ceet' ? 'CEET' : facture.values.fournisseur === 'tde' ? 'TDE' : String(facture.values.fournisseur ?? '');
  const montantTotal = typeof facture.values.montant_total === 'number' ? facture.values.montant_total : 0;

  // ---- Vue lecture seule (déjà répartie) --------------------------------------
  if (parts.length > 0) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader title={`${fournisseurLabel} · ${String(facture.values.mois ?? '')}`} showBack />
        <ScrollView contentContainerClassName="gap-5 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
          <Card className="gap-2">
            <View className="flex-row items-center justify-between">
              <LabelText>Montant total</LabelText>
              <BodyMdText className="text-text-primary">{formatFcfa(montantTotal)}</BodyMdText>
            </View>
            <View className="flex-row items-center justify-between">
              <LabelText>Mode de répartition</LabelText>
              <BodyMdText className="text-text-primary">{facture.values.mode_repartition === 'proportionnel' ? 'Proportionnel' : 'Équitable'}</BodyMdText>
            </View>
          </Card>

          <View className="gap-3">
            <SectionHeader title="Répartition par participant" action="Partager le reçu" onAction={onShareReceipt} />
            <Card className="gap-0 p-0">
              {parts.map((p, i) => (
                <View key={p.id}>
                  {i > 0 && <View className="h-px bg-border" />}
                  <Pressable onPress={() => onTogglePartStatus(p)} className="flex-row items-center justify-between p-gutter-card active:bg-background-secondary">
                    <View className="flex-1">
                      <SectionTitleText className="text-base" numberOfLines={1}>{String(p.values.label ?? 'Participant')}</SectionTitleText>
                      <LabelText>
                        {typeof p.values.consommation === 'number' && p.values.consommation > 0 ? `${p.values.consommation} unités · ` : ''}
                        {p.statusKey === 'payee' ? 'Payée' : 'À payer'}
                      </LabelText>
                    </View>
                    <LabelText className="font-inter-semibold text-text-primary">
                      {typeof p.values.montant_attribue === 'number' ? formatFcfa(p.values.montant_attribue) : '—'}
                    </LabelText>
                  </Pressable>
                </View>
              ))}
            </Card>
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

  // ---- Vue édition (participants + relevés + calcul + validation) -----------
  if (!isStandalone && rows.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader title={`${fournisseurLabel} · ${String(facture.values.mois ?? '')}`} showBack />
        <View className="px-page-margin">
          <EmptyState icon="group-off" title="Aucun locataire actif" description="Ce bien n'a aucun contrat actif à qui répartir cette facture." compact />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
      <AppHeader title={`${fournisseurLabel} · ${String(facture.values.mois ?? '')}`} showBack />
      <ScrollView contentContainerClassName="gap-5 px-page-margin pb-10" showsVerticalScrollIndicator={false}>
        <Card className="gap-1">
          <LabelText>Montant total à répartir</LabelText>
          <SectionTitleText className="text-lg">{formatFcfa(montantTotal)}</SectionTitleText>
        </Card>

        <View className="gap-2">
          <SectionTitleText className="text-base">Mode de répartition</SectionTitleText>
          <View className="flex-row gap-2">
            <Chip label="Proportionnel" active={mode === 'proportionnel'} onPress={() => { setMode('proportionnel'); setPreview(null); setCalcError(null); }} />
            <Chip label="Équitable" active={mode === 'equitable'} onPress={() => { setMode('equitable'); setPreview(null); setCalcError(null); }} />
          </View>
        </View>

        <View className="gap-3">
          <SectionTitleText className="text-base">{isStandalone ? 'Participants' : 'Relevés'}</SectionTitleText>
          {rows.map((row) => {
            const consommation = indicesReady(row) ? computeConsommation(Number(row.indexPrecedent), Number(row.indexActuel)) : null;
            return (
              <Card key={row.rowKey} className="gap-3">
                {isStandalone ? (
                  <View className="flex-row items-end gap-3">
                    <TextField containerClassName="flex-1" label="Nom du participant" value={row.participant.label} onChangeText={(t) => updateRow(row.rowKey, { participant: { ...row.participant, label: t } })} />
                    <SecondaryButton fullWidth={false} label="Retirer" icon="close" className="px-3" onPress={() => removeManualRow(row.rowKey)} />
                  </View>
                ) : (
                  <SectionTitleText className="text-base" numberOfLines={1}>{row.participant.label}</SectionTitleText>
                )}
                {mode === 'proportionnel' && (
                  <>
                    <View className="flex-row gap-3">
                      <TextField
                        containerClassName="flex-1"
                        label={row.indexPrecedentPrefilled ? 'Index précédent (pré-rempli)' : 'Index précédent'}
                        keyboardType="numeric"
                        value={row.indexPrecedent}
                        onChangeText={(t) => updateRow(row.rowKey, { indexPrecedent: t.replace(/[^0-9.]/g, ''), indexPrecedentPrefilled: false })}
                      />
                      <TextField
                        containerClassName="flex-1"
                        label="Index actuel"
                        keyboardType="numeric"
                        value={row.indexActuel}
                        onChangeText={(t) => updateRow(row.rowKey, { indexActuel: t.replace(/[^0-9.]/g, '') })}
                      />
                    </View>
                    {consommation !== null && <LabelText>Consommation : {consommation} unités</LabelText>}
                  </>
                )}
              </Card>
            );
          })}
          {isStandalone && <SecondaryButton label="Ajouter un participant" icon="add" onPress={addManualRow} />}
        </View>

        <PrimaryButton label="Calculer la répartition" disabled={!rowsReady || !mode} onPress={onCalculer} />
        {calcError && <LabelText className="text-error">{calcError}</LabelText>}

        {preview && (
          <View className="gap-3">
            <SectionTitleText className="text-base">Prévisualisation</SectionTitleText>
            <Card className="gap-0 p-0">
              {preview.map((line, i) => (
                <View key={`${line.participant.id ?? line.participant.label}-${i}`}>
                  {i > 0 && <View className="h-px bg-border" />}
                  <View className="flex-row items-center justify-between p-gutter-card">
                    <View className="flex-1">
                      <SectionTitleText className="text-base" numberOfLines={1}>{line.participant.label}</SectionTitleText>
                      {mode === 'proportionnel' && <LabelText>{line.consommation} unités</LabelText>}
                    </View>
                    <LabelText className="font-inter-semibold text-text-primary">{formatFcfa(line.montant)}</LabelText>
                  </View>
                </View>
              ))}
            </Card>
            <PrimaryButton label="Valider la répartition" loading={saving} onPress={onValider} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
