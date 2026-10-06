import { useCallback, useEffect, useRef, useState } from 'react';
import { Share, ScrollView, View, Pressable } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/ui/AppHeader';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { TextField } from '@/components/ui/TextField';
import { LoadingState, EmptyState } from '@/components/ui/States';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SectionTitleText, LabelText, BodyMdText } from '@/components/ui/Typography';
import { Colors } from '@/constants/theme';
import { formatFcfa, formatRelativeTime } from '@/utils/format';
import { coreService } from '@/services/coreService';
import { contratLabel, ensureImmobilierTool, loadImmobilierLookup } from '@/services/immobilierService';
import { ensureFacturesToolCached } from '@/services/facturesService';
import { listParticipations } from '@/services/utilityParticipantsService';
import { friendlyMessage } from '@/features/utilities/errors';
import { InlineNotice, type NoticeTone } from '@/features/utilities/components/InlineNotice';
import { ReceiptCard } from '@/features/utilities/components/ReceiptCard';
import { MODULE_META } from '@/features/utilities/meta';
import {
  computeRepartitionEquitable,
  fournisseurKey,
  computeRepartitionParCompteur,
  periodeLabel,
  resolveParticipantReleves,
  validateRepartition,
  validerFactureParCompteur,
  enregistrerPaiementPart,
  buildReceiptData,
  buildPartReceiptText,
  buildReceiptText,
  formatReceiptDate,
  getPartPaymentInfo,
  sortPartsForDisplay,
  summarizePayments,
  type Participant,
  type ParticipantIssue,
  type ReleveGapWarning,
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
  /** Téléphone de la personne (repère d'affichage), si connu. */
  phone?: string | null;
  /** Participant retenu pour cette facture (flux CEET/TDE : tous cochés par défaut). */
  selected: boolean;
}

/** D'où viennent les participants : le contrat actif d'un bien (Immobilier), les
 * PARTICIPATIONS du module CEET/TDE (flux principal — aucun nom retapé, identité
 * = identifiant), ou une saisie libre (fournisseur « autre » uniquement). */
type ParticipantsSource = 'bien' | 'participations' | 'libre';

const newRowKey = () => `row-${Date.now()}-${Math.random()}`;
const newManualParticipant = (): Participant => ({ type: 'manuel', id: null, label: '' });

/** Étape 2 du flux de répartition : participants, choix du mode,
 * prévisualisation, validation. Une fois validée, la facture_partagee devient
 * en lecture seule et cet écran affiche les parts + leur statut à la place.
 *
 * Mode « Proportionnel » : AUCUN index n'est saisi ici. Les relevés enregistrés
 * (écran Relevés) sont l'unique source de vérité : l'écran les affiche en
 * lecture seule, le calcul (`computeRepartitionParCompteur`) et la validation
 * (`validerFactureParCompteur`) les relisent et figent leurs valeurs dans les
 * parts. Un index manquant ou incohérent bloque le calcul — jamais remplacé par 0.
 *
 * Facture CEET/TDE sans bien : les participants sont les PARTICIPATIONS du module
 * (cochées/décochées, jamais retapées) et chaque relevé est retrouvé par identifiant
 * de personne. Rien n'est ressaisi ici : un relevé manquant ou incohérent se règle
 * dans l'écran Index.
 *
 * Fonctionne dans plusieurs contextes avec le même moteur (services/utilityBillingService.ts) :
 *  - Immobilier : `facture.values.bien` est renseigné → les participants sont
 *    les contrats actifs du bien (jamais ressaisis à la main) ;
 *  - Factures autonome : pas de bien → l'utilisateur indique explicitement les
 *    participants de cette facture (nom saisi), sans forcer de compte/contact.
 *    Aucun participant n'est créé implicitement à partir d'un relevé. */
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
  const [warnings, setWarnings] = useState<ReleveGapWarning[]>([]);
  const [issues, setIssues] = useState<ParticipantIssue[]>([]);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  // Paiement : un geste par part, directement « payée » ; un reçu consultable par part payée.
  const [payNotice, setPayNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [receiptPartId, setReceiptPartId] = useState<string | null>(null);
  const payingRef = useRef(false);
  const partsScrollRef = useRef<ScrollView>(null);
  const [source, setSource] = useState<ParticipantsSource>('libre');
  const isStandalone = source === 'libre'; // seule la saisie libre (fournisseur « autre ») garde des noms tapés
  const moduleKey: 'ceet' | 'tde' | null = (() => {
    const key = fournisseurKey(facture?.values.fournisseur);
    return key === 'ceet' || key === 'tde' ? key : null;
  })();

  const resetCalc = () => {
    setPreview(null);
    setWarnings([]);
    setIssues([]);
    setCalcError(null);
  };

  const load = async () => {
    const ent = await ensureFacturesToolCached();
    setToolId(ent.tool.id);
    setReleveEdId(ent.releveDefinition.id);
    setPartLocataireEdId(ent.partLocataireDefinition.id);

    const f = await coreService.getRecord(factureUtiliteId);
    setFacture(f);
    if (!f) {
      setLoading(false);
      return;
    }

    const allReleves = await coreService.getRecords({ toolId: ent.tool.id, entityDefinitionId: ent.releveDefinition.id });
    setReleves(allReleves);

    const allParts = await coreService.getRecords({ toolId: ent.tool.id, entityDefinitionId: ent.partLocataireDefinition.id });
    const ownParts = allParts.filter((p) => p.values.facture_partagee === f.id);
    setParts(sortPartsForDisplay(ownParts)); // ordre stable : payer une part ne la fait pas changer de place

    // Déjà répartie (une facture validée peut redescendre à "partielle" sans
    // jamais revenir dans le flux d'édition — l'existence de parts suffit).
    if (ownParts.length > 0) {
      setEvents(await coreService.getEvents({ recordId: f.id }));
      setLoading(false);
      return;
    }

    let participants: Participant[] = [];
    const moduleOfFacture = fournisseurKey(f.values.fournisseur);
    let phones: (string | null)[] = [];
    let keys: string[] = [];
    if (typeof f.values.bien === 'string' && f.values.bien) {
      setSource('bien');
      const immobilier = await ensureImmobilierTool();
      const allContrats = await coreService.getRecords({ toolId: immobilier.tool.id, entityDefinitionId: immobilier.contrat.id });
      const activeForBien = allContrats.filter((c) => c.values.bien === f.values.bien && c.statusKey === 'actif');
      const lookup = await loadImmobilierLookup();
      participants = activeForBien.map((c) => ({
        type: 'contrat' as const,
        id: c.id,
        label: contratLabel(c, lookup),
      }));
    } else if (moduleOfFacture === 'ceet' || moduleOfFacture === 'tde') {
      // Flux principal : les participations du module (une seule résolution : nom et
      // téléphone actuels de chaque personne). Une participation CEET ne sert jamais pour TDE.
      setSource('participations');
      const list = await listParticipations(moduleOfFacture);
      participants = list.map((p) => p.participant);
      phones = list.map((p) => p.phone);
      keys = list.map((p) => p.record.id);
    } else {
      setSource('libre');
    }

    setRows(participants.map((participant, i) => ({ rowKey: keys[i] ?? participant.id ?? newRowKey(), participant, phone: phones[i] ?? null, selected: true })));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factureUtiliteId]);

  const fetchReleves = useCallback(async (): Promise<RecordItem[]> => {
    if (!toolId || !releveEdId) return [];
    return coreService.getRecords({ toolId, entityDefinitionId: releveEdId });
  }, [toolId, releveEdId]);

  // Au retour de l'écran Relevés (saisie/correction d'un index), on relit les
  // relevés enregistrés : l'affichage et le calcul repartent toujours d'eux.
  useFocusEffect(
    useCallback(() => {
      if (!toolId) return;
      Promise.all([fetchReleves(), source === 'participations' && moduleKey ? listParticipations(moduleKey) : Promise.resolve(null)]).then(([fresh, list]) => {
        setReleves(fresh);
        if (list) {
          // Participants du module relus (nouveau participant, nom modifié) ; la sélection en cours est conservée.
          setRows((prev) => list.map((p) => ({ rowKey: p.record.id, participant: p.participant, phone: p.phone, selected: prev.find((r) => r.rowKey === p.record.id)?.selected ?? true })));
        }
        setPreview(null);
        setWarnings([]);
        setIssues([]);
        setCalcError(null);
      });
    }, [fetchReleves, toolId, source, moduleKey]),
  );

  const updateRow = (rowKey: string, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));
    resetCalc();
  };

  const addManualRow = () => {
    setRows((prev) => [...prev, { rowKey: newRowKey(), participant: newManualParticipant(), selected: true }]);
  };

  const removeManualRow = (rowKey: string) => {
    setRows((prev) => prev.filter((r) => r.rowKey !== rowKey));
    resetCalc();
  };

  const toggleRow = (rowKey: string) => {
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, selected: !r.selected } : r)));
    resetCalc();
  };

  // Seuls les participants retenus entrent dans le calcul et la validation.
  const activeRows = rows.filter((r) => r.selected);
  const rowsReady = activeRows.length > 0 && activeRows.every((r) => r.participant.label.trim() !== '');

  const onCalculer = async () => {
    if (!mode || !facture) return;
    resetCalc();
    try {
      const montantTotal = typeof facture.values.montant_total === 'number' ? facture.values.montant_total : 0;
      if (mode === 'proportionnel') {
        // Source unique : les relevés enregistrés, relus à l'instant du calcul.
        const fresh = await fetchReleves();
        setReleves(fresh);
        const result = computeRepartitionParCompteur({
          participants: activeRows.map((r) => ({ ...r.participant, label: r.participant.label.trim() })),
          fournisseur: String(facture.values.fournisseur ?? ''),
          periode: typeof facture.values.mois === 'string' ? facture.values.mois : '',
          releves: fresh,
          montantTotal,
        });
        setWarnings(result.warnings);
        if (!result.ok) {
          setIssues(result.issues);
          if (result.error === 'MONTANT_INVALIDE') setCalcError('Le montant de la facture est invalide.');
          else if (result.error === 'CONSOMMATION_TOTALE_NULLE') setCalcError('Aucune consommation relevée : la répartition par compteur est impossible.');
          else if (result.issues.length > 0) setCalcError('Calcul impossible : des index sont manquants ou incohérents (voir ci-dessus).');
          return;
        }
        setPreview(result.lines);
      } else {
        setPreview(computeRepartitionEquitable(activeRows.map((r) => r.participant), montantTotal));
      }
    } catch (err) {
      setCalcError(err instanceof Error ? err.message : 'Erreur de calcul.');
    }
  };

  const onValider = async () => {
    if (!preview || !mode || !toolId || !releveEdId || !partLocataireEdId || !facture) return;
    setSaving(true);
    try {
      if (mode === 'proportionnel') {
        // Relit les relevés enregistrés, recalcule, bloque si incomplet, puis
        // fige les valeurs dans les parts. Aucune écriture de relevé ici.
        await validerFactureParCompteur({
          toolId,
          releveEntityDefinitionId: releveEdId,
          partLocataireEntityDefinitionId: partLocataireEdId,
          facturePartageeId: facture.id,
          participants: activeRows.map((r) => ({ ...r.participant, label: r.participant.label.trim() })),
        });
      } else {
        await validateRepartition({
          toolId,
          partLocataireEntityDefinitionId: partLocataireEdId,
          facturePartageeId: facture.id,
          mode,
          lines: preview,
        });
      }
      await load();
    } catch (e) {
      // Message affiché dans l'écran (Alert.alert est invisible sur le web) ; la sélection en cours est conservée.
      setCalcError(`Validation impossible. ${friendlyMessage(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const showPayNotice = (n: { tone: NoticeTone; text: string }) => {
    setPayNotice(n);
    partsScrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  /** « Enregistrer le paiement » : un seul appui — participant, montant et période
   * viennent de la part, le statut devient directement « payée » avec la date réelle.
   * Un second appui pendant l'enregistrement est ignoré (et refusé par le moteur). */
  const onPay = async (part: RecordItem) => {
    if (payingRef.current) return;
    payingRef.current = true;
    setPayingId(part.id);
    setPayNotice(null);
    const label = String(part.values.label ?? 'Participant');
    try {
      await enregistrerPaiementPart(part.id);
      showPayNotice({ tone: 'success', text: `Paiement de ${label} enregistré.` });
    } catch (e) {
      showPayNotice({ tone: 'error', text: friendlyMessage(e) });
    } finally {
      await load(); // l'écran reflète toujours l'état réellement enregistré
      payingRef.current = false;
      setPayingId(null);
    }
  };

  const onShareOneReceipt = (part: RecordItem) => {
    if (!facture) return;
    Share.share({ title: 'Reçu', message: buildPartReceiptText(facture, part) });
  };

  const onShareReceipt = () => {
    if (!facture) return;
    Share.share({ message: buildReceiptText(facture, parts) });
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
        <ScrollView ref={partsScrollRef} contentContainerClassName="w-full max-w-3xl gap-5 self-center px-page-margin pb-10" showsVerticalScrollIndicator={false}>
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

          {payNotice && <InlineNotice tone={payNotice.tone}>{payNotice.text}</InlineNotice>}

          <View className="gap-3">
            <SectionHeader title="Répartition par participant" action="Partager la répartition" onAction={onShareReceipt} />
            {(() => {
              const sum = summarizePayments(parts);
              return (
                <LabelText>
                  {sum.paid}/{sum.total} payé{sum.total > 1 ? 's' : ''} · {formatFcfa(sum.montantPaye)} reçus · {formatFcfa(sum.montantRestant)} à recevoir
                </LabelText>
              );
            })()}
            {parts.map((p) => {
              const pay = getPartPaymentInfo(p);
              const open = receiptPartId === p.id;
              return (
                <Card key={p.id} className="gap-3">
                  <View className="flex-row items-center justify-between gap-3">
                    <View className="flex-1">
                      <SectionTitleText className="text-base" numberOfLines={1}>{String(p.values.label ?? 'Participant')}</SectionTitleText>
                      <LabelText style={{ color: pay.paid ? Colors.success : Colors.textMuted }}>
                        {typeof p.values.consommation === 'number' && p.values.consommation > 0 ? `${p.values.consommation} ${moduleKey ? MODULE_META[moduleKey].unit : 'unités'} · ` : ''}
                        {pay.paid ? (pay.dateKnown ? `Payé le ${formatReceiptDate(pay.date)}` : 'Payé (date inconnue)') : 'À payer'}
                      </LabelText>
                    </View>
                    <LabelText className="font-inter-semibold text-text-primary">
                      {typeof p.values.montant_attribue === 'number' ? formatFcfa(p.values.montant_attribue) : '—'}
                    </LabelText>
                  </View>
                  {pay.paid ? (
                    <SecondaryButton label={open ? 'Masquer le reçu' : 'Voir le reçu'} icon="receipt-long" onPress={() => setReceiptPartId(open ? null : p.id)} />
                  ) : (
                    <PrimaryButton label="Enregistrer le paiement" icon="check" loading={payingId === p.id} disabled={payingId !== null && payingId !== p.id} onPress={() => onPay(p)} />
                  )}
                  {pay.paid && open && facture && <ReceiptCard data={buildReceiptData(facture, p)} onShare={() => onShareOneReceipt(p)} />}
                </Card>
              );
            })}
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
  if (source === 'participations' && rows.length === 0 && moduleKey) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
        <AppHeader title={`${fournisseurLabel} · ${String(facture.values.mois ?? '')}`} showBack />
        <View className="px-page-margin">
          <EmptyState
            icon="group-add"
            title={`Aucun participant ${MODULE_META[moduleKey].label}`}
            description={`Ajoutez d'abord les personnes concernées, puis leurs index, avant de répartir cette facture.`}
            actionLabel="Ajouter des participants"
            onAction={() => router.push(`/${moduleKey}/participants` as never)}
            compact
          />
        </View>
      </SafeAreaView>
    );
  }

  if (source === 'bien' && rows.length === 0) {
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
          <SectionTitleText className="text-base">{source === 'participations' ? 'Participants' : isStandalone ? 'Participants' : 'Relevés'}</SectionTitleText>
          {source === 'participations' && <LabelText>Les index viennent des relevés enregistrés : rien à ressaisir ici. Décochez un participant pour l'exclure de cette facture.</LabelText>}
          {rows.map((row) => {
            const periode = typeof facture.values.mois === 'string' ? facture.values.mois : '';
            const showDetails = mode === 'proportionnel' && row.selected;
            const r = showDetails ? resolveParticipantReleves(row.participant, String(facture.values.fournisseur ?? ''), periode, releves) : null;
            const indexOf = (rec: RecordItem | null) => (rec && typeof rec.values.index === 'number' ? rec.values.index : null);
            const precIndex = r ? indexOf(r.precedent) : null;
            const actIndex = r ? indexOf(r.actuel) : null;
            const unit = moduleKey ? MODULE_META[moduleKey].unit : 'unités';
            return (
              <Card key={row.rowKey} className="gap-3">
                {isStandalone ? (
                  <View className="flex-row items-end gap-3">
                    <TextField containerClassName="flex-1" label="Nom du participant" value={row.participant.label} onChangeText={(t) => updateRow(row.rowKey, { participant: { ...row.participant, label: t } })} />
                    <SecondaryButton fullWidth={false} label="Retirer" icon="close" className="px-3" onPress={() => removeManualRow(row.rowKey)} />
                  </View>
                ) : source === 'participations' ? (
                  <Pressable onPress={() => toggleRow(row.rowKey)} accessibilityRole="checkbox" accessibilityState={{ checked: row.selected }} className="flex-row items-center gap-3">
                    <MaterialIcons name={row.selected ? 'check-box' : 'check-box-outline-blank'} size={24} color={row.selected ? Colors.primary : Colors.textMuted} />
                    <View className="flex-1">
                      <SectionTitleText className="text-base" numberOfLines={1}>{row.participant.label}</SectionTitleText>
                      {row.phone ? <LabelText numberOfLines={1}>{row.phone}</LabelText> : null}
                    </View>
                  </Pressable>
                ) : (
                  <SectionTitleText className="text-base" numberOfLines={1}>{row.participant.label}</SectionTitleText>
                )}
                {r && (
                  <View className="gap-1">
                    <LabelText>{periodeLabel(periode)}</LabelText>
                    {precIndex !== null && r.precedent && (
                      <LabelText>
                        Précédent : {periodeLabel(String(r.precedent.values.mois))} · <LabelText className="font-inter-semibold text-text-primary">{precIndex}</LabelText>
                      </LabelText>
                    )}
                    {actIndex !== null && (
                      <LabelText>
                        Actuel : {periodeLabel(periode)} · <LabelText className="font-inter-semibold text-text-primary">{actIndex}</LabelText>
                      </LabelText>
                    )}
                    {r.ok && <LabelText className="font-inter-semibold text-text-primary">Consommation : {r.consommation} {unit}</LabelText>}
                    {!r.ok && r.issue.code === 'INDEX_ACTUEL_MANQUANT' && (
                      <LabelText style={{ color: Colors.error }}>Aucun relevé pour {periodeLabel(periode)}. Ajoutez le relevé depuis l’écran Index.</LabelText>
                    )}
                    {!r.ok && r.issue.code === 'INDEX_PRECEDENT_MANQUANT' && (
                      <LabelText style={{ color: Colors.error }}>Relevé précédent manquant. Ce participant ne peut pas encore être calculé.</LabelText>
                    )}
                    {!r.ok && r.issue.code === 'INDEX_ACTUEL_INFERIEUR' && (
                      <LabelText style={{ color: Colors.error }}>
                        Index incohérent : le précédent ({precIndex}) est supérieur à l’actuel ({actIndex}). Corrigez le relevé avant de valider la facture.
                      </LabelText>
                    )}
                    {r.missingMonths.length > 0 && r.precedent && (
                      <LabelText style={{ color: Colors.warning }}>
                        ⚠ Relevé précédent disponible en {periodeLabel(String(r.precedent.values.mois))}. Aucun relevé enregistré en {r.missingMonths.map(periodeLabel).join(', ')}.
                      </LabelText>
                    )}
                  </View>
                )}
              </Card>
            );
          })}
          {isStandalone && <SecondaryButton label="Ajouter un participant" icon="add" onPress={addManualRow} />}
          {source === 'participations' && moduleKey && (
            <View className="gap-3">
              {mode === 'proportionnel' && (
                <SecondaryButton
                  label={`Ouvrir l’écran Index ${MODULE_META[moduleKey].label}`}
                  icon={MODULE_META[moduleKey].icon}
                  onPress={() => router.push({ pathname: `/${moduleKey}/releves`, params: { periode: typeof facture.values.mois === 'string' ? facture.values.mois : '' } } as never)}
                />
              )}
              <SecondaryButton label="Gérer les participants" icon="group" onPress={() => router.push(`/${moduleKey}/participants` as never)} />
            </View>
          )}
          {source !== 'participations' && mode === 'proportionnel' && (
            <SecondaryButton label="Saisir ou corriger les index" icon="speed" onPress={() => router.push('/factures/releves')} />
          )}
        </View>

        <PrimaryButton label="Calculer la répartition" disabled={!rowsReady || !mode} onPress={onCalculer} />
        {issues.map((issue) => (
          <LabelText key={`${issue.participant.id ?? issue.participant.label}-${issue.code}`} style={{ color: Colors.error }}>
            {issue.message}
          </LabelText>
        ))}
        {calcError && <LabelText className="text-error">{calcError}</LabelText>}
        {warnings.map((w) => (
          <LabelText key={`warn-${w.participant.id ?? w.participant.label}`} style={{ color: Colors.warning }}>
            ⚠ {w.participant.label} : {w.message}
          </LabelText>
        ))}

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
                      {mode === 'proportionnel' && (
                        <LabelText>
                          {line.indexPrecedent} → {line.indexActuel} · {line.consommation} unités
                        </LabelText>
                      )}
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
