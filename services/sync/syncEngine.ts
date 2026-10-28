// Moteur de synchronisation hors réseau — P2. LOCAL ET ISOLÉ : il n'est branché à aucun service, écran ni magasin de l'application,
// n'importe aucun SDK et n'ouvre aucune connexion. Il décrit COMMENT une synchronisation fiable fonctionnera ; l'envoi réel n'existe
// pas : le transport est un paramètre OBLIGATOIRE (`SyncTransport`), fourni par l'appelant — dans P2, uniquement par les tests.
//
// Garanties :
//  - files d'opérations persistantes et idempotentes (une opération explicite par enregistrement, fusion sans perte) ;
//  - ordre parent-enfant issu du manifeste de relations ; références absentes ou invalides signalées, jamais envoyées ;
//  - reprise après interruption : une opération dont le résultat est inconnu est VÉRIFIÉE auprès du transport avant tout renvoi ;
//  - un magasin illisible (file, référence, métadonnées) n'est jamais traité comme vide ni écrasé : l'exécution s'arrête avant tout envoi ;
//  - l'espace de démonstration n'est jamais capturé ni envoyé ;
//  - les faits financiers, les doublons logiques et les conflits sont retenus, jamais résolus ni fusionnés automatiquement.

import { genId } from '../db';
import { snapshotCollections, workspaceId } from '../persistence';
import { collectSyncableItems, externalKeyOwners, scanChanges, scanVanishedPending, type LocalItem, type ScanScope } from './changeScanner';
import { correctionStore } from './financialCorrection';
import { conflictStore, pendingInboundStore, type PendingStoreData } from './inboundStores';
import { tryAcquireSyncLock } from './syncLock';
import { accountChangePending, requireSyncAccount } from './syncAccount';
import { getActiveCloudUid, stampDisplayOwner } from '../cloudVisibility';
import { evaluateScope, isSyncKind, type ScopeResult } from './syncScope';
import { applyLegacyFilter, requireActivation, type ActivationData } from './syncActivation';
import { claimOwnership, ownerOf, ownershipStore, usableBy } from './ownership';
import { createMeta, defaultOrigin, loadSyncMeta, markConflict, markError, markPending, markSynced, updateSyncMeta } from './localSyncMeta';
import { planOperations, type FinancialPolicy, type PlannedBlock } from './syncPlanner';
import { applyChanges, backoffMs, baselineStore, MAX_TRANSIENT_ATTEMPTS, queueStore, RESTORED_PLACEHOLDER_HASH, type BlockReason, type IncomingChange, type QueuedOperation } from './syncQueue';
import { buildWireRecord, contentHash, contentOfWire, naturalKeyOfWire, type WireRecord } from './wireFormat';
import { getKindDefinition, naturalKeyOf, type Kind } from './kindRegistry';

export type SyncEngineErrorCode = 'demo_workspace' | 'store_corrupted' | 'no_owner';

export class SyncEngineError extends Error {
  constructor(readonly code: SyncEngineErrorCode, message: string, readonly details: string[] = []) {
    super(message);
    this.name = 'SyncEngineError';
  }
}

export type TransportErrorCode = 'network' | 'conflict' | 'permission' | 'invalid' | 'unknown';

export class SyncTransportError extends Error {
  constructor(readonly code: TransportErrorCode, message: string) {
    super(message);
    this.name = 'SyncTransportError';
  }
}

export interface PushRequest {
  /** Jeton d'idempotence : le même `opId` désigne toujours la même opération logique. */
  opId: string;
  recordId: string;
  kind: Kind;
  op: 'create' | 'update' | 'delete' | 'restore';
  /** null pour une création ; sinon la dernière révision connue (contrôle de concurrence). */
  expectedRev: number | null;
  /** Suppression logique : horodatage ; null sinon. */
  deletedAt: string | null;
  /** Contenu à écrire (null pour une suppression). */
  wire: WireRecord | null;
}

export interface RemoteDoc {
  rev: number;
  /** Empreinte du contenu distant (même fonction que `contentHash`). */
  hash: string;
  deleted: boolean;
}

/** Accès au cloud, fourni par l'appelant. Aucune implémentation réseau n'existe dans P2. */
export interface SyncTransport {
  push(request: PushRequest): Promise<{ rev: number }>;
  read(kind: Kind, id: string): Promise<RemoteDoc | null>;
}

export interface RunOptions {
  transport: SyncTransport;
  ownerUid: string;
  now?: () => Date;
  policy?: FinancialPolicy;
  random?: () => number;
  maxPasses?: number;
  /** Plafond d'opérations TENTÉES dans cette exécution (maîtrise des écritures) : au-delà, arrêt propre (`stopped: 'limit'`), la file est conservée. */
  maxOperations?: number;
  /** Arrêt demandé par l'appelant (arrêt du cycle) : l'exécution s'arrête proprement avant la prochaine opération ; la file est conservée. */
  shouldStop?: () => boolean;
}

/** `suspended` : le cloud refuse TOUT (règles d'urgence, accès retiré) alors qu'aucune écriture n'a pu être confirmée ; la file est conservée, rien n'est bloqué définitivement. */
export type RunStop = 'network' | 'persistence_error' | 'account_changed' | 'limit' | 'suspended' | null;

export interface RunReport {
  skipped?: 'already_running';
  confirmed: string[];
  retried: { recordId: string; attempts: number; nextRetryAt: string | null }[];
  conflicts: string[];
  permanentErrors: string[];
  blocked: PlannedBlock[];
  stopped: RunStop;
  error?: string;
  passes: number;
}

const emptyReport = (): RunReport => ({ confirmed: [], retried: [], conflicts: [], permanentErrors: [], blocked: [], stopped: null, passes: 0 });

// ---- Lecture sûre des magasins ---------------------------------------------------------------------------------------------

/** Charge les trois magasins ; si l'un est illisible, lève SyncEngineError AVANT toute opération (rien n'est écrasé). */
async function ensureReadable(): Promise<void> {
  try {
    await Promise.all([queueStore.load(), baselineStore.load(), loadSyncMeta(), correctionStore.load(), conflictStore.load(), pendingInboundStore.load()]);
  } catch (error) {
    // Corruption, JSON illisible ou erreur de lecture : dans tous les cas, le magasin n'est PAS traité comme vide.
    throw new SyncEngineError('store_corrupted', 'Un magasin de synchronisation est illisible : exécution arrêtée, rien n’a été modifié.', [error instanceof Error ? error.message : String(error)]);
  }
}

/**
 * Éléments locaux utilisables par le compte, ramenés au périmètre V1 (lecture seule), AVANT le filtre des anciennes données : sert à la capture
 * et à l'aperçu de l'envoi volontaire des anciennes données (legacyAdoption.ts).
 */
export async function loadScopedItems(account: string): Promise<ScopeResult> {
  const corrections = Object.values((await correctionStore.load()).items) as unknown as Record<string, unknown>[];
  const { items } = collectSyncableItems(snapshotCollections(), corrections);
  // ISOLATION : jamais l'élément d'un autre compte (ni consulté, ni capturé, ni envoyé) ; les corrections viennent du magasin du compte
  const owners = (await ownershipStore.load()).owners;
  const usable = items.filter((i) => getKindDefinition(i.kind).source.type === 'store' || usableBy(ownerOf(owners, i.kind, i.item), account));
  // PÉRIMÈTRE V1 (Immobilier seul) : ce qui en sort n'est ni capturé, ni planifié, ni envoyé (et n'est jamais supprimé dans le cloud)
  return evaluateScope(usable);
}

/** Éléments locaux synchronisables, corrections financières comprises (lecture seule). */
async function loadLocalItems(account: string): Promise<{ items: LocalItem[]; excluded: Set<string>; activation: ActivationData | null }> {
  const scoped = await loadScopedItems(account);
  const excluded = new Set(scoped.excluded.map((e) => e.id));
  let allowed = scoped.allowed;
  // ACTIVATION SANS ENVOI RÉTROACTIF : ce qui existait avant l'activation du compte (et ce qui en dépend) reste local, même modifié ensuite
  const activation = await requireActivation(); // sans activation du compte : rien n'est capturé ni planifié
  if (activation) {
    const legacy = applyLegacyFilter(allowed, activation, await baselineStore.load());
    allowed = legacy.allowed;
    for (const id of legacy.excluded.keys()) excluded.add(id);
  }
  return { items: allowed, excluded, activation };
}

/** Clés logiques d'éléments connus du cloud mais absents localement, ou reçus et retenus : servent à repérer les doublons (rapport seulement). */
function externalKeys(items: readonly LocalItem[], baseline: Awaited<ReturnType<typeof baselineStore.load>>, pending: PendingStoreData): Map<string, string[]> {
  const owners = externalKeyOwners(items, baseline);
  for (const [id, entry] of Object.entries(pending.items)) {
    const wire = entry.change.wire;
    if (!wire || entry.reason === 'invalid' || entry.reason === 'newer_schema') continue;
    const key = naturalKeyOfWire(wire);
    if (key) owners.set(`${wire.kind}|${key}`, [...(owners.get(`${wire.kind}|${key}`) ?? []), id]);
  }
  return owners;
}

// ---- Capture des changements locaux ------------------------------------------------------------------------------------------

export interface CaptureResult {
  skipped?: 'demo_workspace' | 'busy';
  enqueued: number;
  ignoredLegacy: number;
}

/**
 * Compare l'état local à la référence et met les changements en file (création, modification, suppression logique). Idempotent :
 * l'appeler deux fois de suite ne crée aucune opération supplémentaire. Ne touche à aucune donnée métier. Dans l'espace de
 * démonstration : aucune capture, aucune écriture.
 */
export async function captureLocalChanges(options: { scope: ScanScope; now?: Date; ownerUid?: string }): Promise<CaptureResult> {
  if (workspaceId() !== 'personal') return { skipped: 'demo_workspace', enqueued: 0, ignoredLegacy: 0 };
  const account = requireSyncAccount(options.ownerUid); // sans compte actif (ou autre compte) : rien n'est capturé
  const release = tryAcquireSyncLock(); // un changement de compte attend la fin de la capture
  if (!release) return { skipped: 'busy', enqueued: 0, ignoredLegacy: 0 };
  try {
    return await captureLocked(account, options);
  } finally {
    release();
  }
}

async function captureLocked(account: string, options: { scope: ScanScope; now?: Date }): Promise<CaptureResult> {
  await ensureReadable();
  const now = options.now ?? new Date();
  const { items, excluded, activation } = await loadLocalItems(account);
  const baseline = await baselineStore.load();
  // l'instant d'activation STOCKÉ prévaut sur celui de l'appelant (jamais plus ancien) ; les éléments adoptés (étape future) sont seuls à pouvoir précéder l'activation
  const scope: ScanScope = activation?.enabledAt ? { enabledAt: activation.enabledAt > options.scope.enabledAt ? activation.enabledAt : options.scope.enabledAt, adoptedIds: new Set(activation.adoptedIds) } : options.scope;
  const scan = scanChanges(items, baseline, scope, now, excluded);
  const vanished = scanVanishedPending(items, await queueStore.load(), now, excluded);
  const known = new Set(scan.changes.map((c) => c.recordId));
  let changes = [...scan.changes, ...vanished.filter((c) => !known.has(c.recordId))];
  if (changes.length === 0) return { enqueued: 0, ignoredLegacy: scan.ignoredLegacy };
  // un élément créé depuis l'activation est inscrit au nom du compte AVANT d'être mis en file (une coupure laisse une inscription inoffensive)
  const claims = changes.filter((c) => c.op === 'create' && getKindDefinition(c.kind).source.type !== 'store').map((c) => c.recordId);
  const refused = new Set(await claimOwnership(account, claims));
  // le masquage d'affichage ne lit que `cloudOwnerUid` : il suit le registre de propriété, mais SEULEMENT si le compte cloud actif est bien le compte revendiquant
  // (en production les deux sont toujours identiques ; un contexte incohérent ne marque rien plutôt que de marquer au nom du mauvais compte)
  if (getActiveCloudUid() === account) stampDisplayOwner(claims.filter((id) => !refused.has(id)), account);
  if (refused.size > 0) changes = changes.filter((c) => !refused.has(c.recordId)); // appartient à un autre compte : jamais capturé
  if (changes.length === 0) return { enqueued: 0, ignoredLegacy: scan.ignoredLegacy };

  const next = await queueStore.update((queue) => applyChanges(queue.nonce ? queue : { ...queue, nonce: genId('q') }, changes, now));
  await updateSyncMeta((store) => {
    const entries = { ...store.entries };
    for (const change of changes) {
      const op = next.ops[change.recordId];
      if (!op) delete entries[change.recordId]; // création jamais envoyée puis supprimée : rien à suivre
      else entries[change.recordId] = markPending(entries[change.recordId] ?? createMeta(change.kind, defaultOrigin(), now), op.op === 'restore' ? 'update' : op.op, now);
    }
    return { ...store, entries };
  });
  return { enqueued: changes.length, ignoredLegacy: scan.ignoredLegacy };
}

/** Marque « à vérifier » les opérations dont l'envoi a commencé sans résultat enregistré (processus interrompu). */
export async function recoverInterruptedOperations(): Promise<number> {
  let recovered = 0;
  await queueStore.update((queue) => {
    const ops = { ...queue.ops };
    for (const [id, op] of Object.entries(ops)) {
      if (op.inFlight) {
        ops[id] = { ...op, inFlight: false, uncertain: true };
        recovered += 1;
      }
    }
    return recovered > 0 ? { ...queue, ops } : queue;
  });
  return recovered;
}

// ---- Exécution -----------------------------------------------------------------------------------------------------------------

type Outcome = 'confirmed' | 'retry' | 'blocked' | 'network';

export async function runOnce(options: RunOptions): Promise<RunReport> {
  if (workspaceId() !== 'personal') throw new SyncEngineError('demo_workspace', 'L’espace de démonstration n’est jamais synchronisé.');
  if (!options.ownerUid) throw new SyncEngineError('no_owner', 'Aucun compte propriétaire fourni : rien n’est envoyé.');
  const account = requireSyncAccount(options.ownerUid); // le compte annoncé doit être le compte actif : jamais d'envoi au nom d'un autre
  const release = tryAcquireSyncLock();
  if (!release) return { ...emptyReport(), skipped: 'already_running' };
  const report = emptyReport();
  try {
    await ensureReadable();
    await recoverInterruptedOperations();
    const clock = options.now ?? (() => new Date());
    const random = options.random ?? Math.random;
    const maxPasses = options.maxPasses ?? 10;
    let attempted = 0;
    // Refus d'accès (permission) : on ne peut pas savoir, sur UN refus, s'il vise cet élément ou tout le service. On le diffère, on continue avec les
    // autres, et on tranche en fin d'exécution : si le cloud a confirmé AU MOINS une écriture, le refus est propre à l'élément (bloqué, comme avant) ;
    // sinon c'est le service qui refuse (coupure d'urgence…) : rien n'est bloqué, la file attend le retour du service.
    const deferred = new Map<string, QueuedOperation>();

    for (let pass = 0; pass < maxPasses; pass += 1) {
      if (accountChangePending() || options.shouldStop?.()) {
        report.stopped = 'account_changed';
        return report;
      }
      const queue = await queueStore.load();
      const baseline = await baselineStore.load();
      const { items, excluded } = await loadLocalItems(account);
      const held = new Set(Object.keys((await conflictStore.load()).open));
      const plan = planOperations({ queue, baseline, items, now: clock(), policy: options.policy, heldIds: held, excludedIds: excluded, externalKeys: externalKeys(items, baseline, await pendingInboundStore.load()) });
      report.blocked = plan.blocked;
      report.passes = pass + 1;
      const ready = plan.ready.filter((op) => !deferred.has(op.recordId));
      if (ready.length === 0) break;

      const byId = new Map(items.map((i) => [i.id, i]));
      let progressed = false;
      for (const op of ready) {
        if (accountChangePending() || options.shouldStop?.()) {
          report.stopped = 'account_changed'; // déconnexion ou changement de compte : arrêt propre, la file du compte est conservée
          return report;
        }
        if (options.maxOperations !== undefined && attempted >= options.maxOperations) {
          report.stopped = 'limit';
          return report;
        }
        attempted += 1;
        let outcome: Outcome;
        try {
          outcome = await processOperation(op, byId.get(op.recordId), options, clock, random, report, deferred);
        } catch (error) {
          // erreur d'enregistrement local APRÈS un envoi possible : on s'arrête ; la reprise vérifiera l'état du cloud
          report.stopped = 'persistence_error';
          report.error = error instanceof Error ? error.message : String(error);
          return report;
        }
        if (outcome === 'network') {
          report.stopped = 'network';
          return report;
        }
        if (outcome === 'confirmed') progressed = true;
      }
      if (!progressed) break;
    }
    if (deferred.size > 0) {
      if (report.confirmed.length > 0) {
        for (const op of deferred.values()) await blockOperation(op, 'permanent_error', 'Refusé par le cloud (permission) : Accès refusé par les règles de sécurité.', report, clock());
      } else {
        report.stopped = 'suspended';
        report.error = 'Accès refusé par les règles de sécurité.';
      }
    }
    return report;
  } finally {
    release();
  }
}

async function patchOperation(op: QueuedOperation, patch: Partial<QueuedOperation>): Promise<void> {
  await queueStore.update((queue) => {
    const current = queue.ops[op.recordId];
    if (!current || current.opId !== op.opId) return queue; // l'opération a été remplacée : on ne touche pas à la nouvelle
    return { ...queue, ops: { ...queue.ops, [op.recordId]: { ...current, ...patch } } };
  });
}

async function setMeta(recordId: string, kind: Kind, change: (meta: ReturnType<typeof createMeta>) => ReturnType<typeof createMeta> | null): Promise<void> {
  await updateSyncMeta((store) => {
    const entries = { ...store.entries };
    const next = change(entries[recordId] ?? createMeta(kind, defaultOrigin()));
    if (next === null) delete entries[recordId];
    else entries[recordId] = next;
    return { ...store, entries };
  });
}

interface ConfirmedContent {
  wire: WireRecord;
  naturalKey: string | null;
}

async function confirm(op: QueuedOperation, rev: number, hash: string | null, report: RunReport, confirmed: ConfirmedContent | null = null): Promise<Outcome> {
  // Ordre : référence d'abord, puis file, puis métadonnées. Une interruption entre deux étapes laisse l'opération « à vérifier » :
  // la reprise la confirme sans renvoi (idempotent).
  await baselineStore.update((b) => {
    const entries = { ...b.entries };
    if (op.op === 'restore') entries[op.recordId] = { kind: op.kind, hash: RESTORED_PLACEHOLDER_HASH, rev }; // contenu du cloud inconnu : le contenu local partira ensuite
    else if (op.op === 'delete' || hash === null) delete entries[op.recordId];
    else entries[op.recordId] = { kind: op.kind, hash, rev, ...(confirmed ? { base: contentOfWire(confirmed.wire), naturalKey: confirmed.naturalKey } : {}) };
    return { ...b, entries };
  });
  await queueStore.update((queue) => {
    if (queue.ops[op.recordId]?.opId !== op.opId) return queue;
    const ops = { ...queue.ops };
    delete ops[op.recordId];
    return { ...queue, ops };
  });
  await setMeta(op.recordId, op.kind, (meta) => (op.op === 'delete' ? null : markSynced(meta, rev)));
  report.confirmed.push(op.recordId);
  return 'confirmed';
}

async function blockOperation(op: QueuedOperation, reason: Extract<BlockReason, 'conflict' | 'permanent_error'>, detail: string, report: RunReport, now: Date): Promise<Outcome> {
  await patchOperation(op, { inFlight: false, uncertain: false, attempts: op.attempts + (reason === 'permanent_error' ? 1 : 0), lastError: detail.slice(0, 300), block: { reason, detail: detail.slice(0, 300) } });
  await setMeta(op.recordId, op.kind, (meta) => (reason === 'conflict' ? markConflict(meta, detail, now) : markError(meta, detail, null, now)));
  (reason === 'conflict' ? report.conflicts : report.permanentErrors).push(op.recordId);
  return 'blocked';
}

async function transientFailure(op: QueuedOperation, error: Error, uncertainNow: boolean, report: RunReport, now: Date, random: () => number): Promise<Outcome> {
  const attempts = op.attempts + 1;
  if (attempts >= MAX_TRANSIENT_ATTEMPTS && !(error instanceof SyncTransportError && error.code === 'network')) {
    return blockOperation({ ...op, attempts: op.attempts }, 'permanent_error', `Échec répété (${attempts} tentatives) : ${error.message}`, report, now);
  }
  const next = new Date(now.getTime() + backoffMs(attempts, random));
  await patchOperation(op, { inFlight: false, uncertain: uncertainNow || op.uncertain, attempts, lastAttemptAt: now.toISOString(), nextRetryAt: next.toISOString(), lastError: error.message.slice(0, 300) });
  await setMeta(op.recordId, op.kind, (meta) => markError(meta, error.message, next, now));
  report.retried.push({ recordId: op.recordId, attempts, nextRetryAt: next.toISOString() });
  return error instanceof SyncTransportError && error.code === 'network' ? 'network' : 'retry';
}

async function processOperation(
  op: QueuedOperation,
  local: LocalItem | undefined,
  options: RunOptions,
  clock: () => Date,
  random: () => number,
  report: RunReport,
  deferred: Map<string, QueuedOperation> = new Map(),
): Promise<Outcome> {
  const now = clock();
  // troisième barrière : jamais d'envoi d'un type hors périmètre, quelle que soit la façon dont l'opération est arrivée en file
  if (!isSyncKind(op.kind)) return blockOperation(op, 'permanent_error', 'Type hors du périmètre de la synchronisation (Immobilier seul) : rien n’est envoyé.', report, now);
  const wire = op.op === 'delete' || op.op === 'restore' || !local ? null : buildWireRecord(op.kind, local.item, options.ownerUid);
  const hash = wire ? contentHash(wire) : null;
  const snap: ConfirmedContent | null = wire && local ? { wire, naturalKey: naturalKeyOf(op.kind, local.item) } : null;
  await patchOperation(op, { inFlight: true, lastAttemptAt: now.toISOString() });

  const classify = async (error: unknown, afterPush: boolean): Promise<Outcome> => {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err instanceof SyncTransportError) {
      if (err.code === 'conflict') return resolveConflict();
      if (err.code === 'permission') {
        // refus différé (voir runOnce) : l'opération reste en file, sans compter comme une tentative vouée à l'échec
        await patchOperation(op, { inFlight: false, lastAttemptAt: now.toISOString(), lastError: err.message.slice(0, 300) });
        deferred.set(op.recordId, op);
        return 'retry';
      }
      if (err.code === 'invalid') return blockOperation(op, 'permanent_error', `Refusé par le cloud (${err.code}) : ${err.message}`, report, now);
    }
    return transientFailure(op, err, afterPush, report, now, random);
  };

  // le cloud a refusé la révision attendue : si son contenu est déjà exactement le nôtre (réponse perdue), c'est confirmé ; sinon conflit
  const resolveConflict = async (): Promise<Outcome> => {
    let remote: RemoteDoc | null;
    try {
      remote = await options.transport.read(op.kind, op.recordId);
    } catch (error) {
      return transientFailure(op, error instanceof Error ? error : new Error(String(error)), false, report, now, random);
    }
    if (op.op === 'restore') {
      if (remote && !remote.deleted) return confirm(op, remote.rev, null, report); // déjà restauré (par nous, réponse perdue, ou ailleurs)
      return blockOperation(op, 'conflict', 'Le cloud a changé depuis la décision de restauration : résolution explicite requise.', report, now);
    }
    if (op.op === 'delete' && (!remote || remote.deleted)) return confirm(op, remote?.rev ?? op.baseRev, null, report);
    if (remote && !remote.deleted && hash !== null && remote.hash === hash) return confirm(op, remote.rev, hash, report, snap);
    return blockOperation(op, 'conflict', 'Le cloud contient une version différente (modifiée ou supprimée ailleurs) : résolution explicite requise.', report, now);
  };

  // Révision attendue pour un envoi ordinaire ; remplacée uniquement dans le cas décrit plus bas (suppression d'une création dont le résultat était inconnu).
  let expectedRevOverride: number | null = null;

  // reprise : résultat inconnu d'un envoi précédent → on VÉRIFIE avant de renvoyer
  if (op.uncertain) {
    let remote: RemoteDoc | null;
    try {
      remote = await options.transport.read(op.kind, op.recordId);
    } catch (error) {
      return classify(error, false);
    }
    if (op.op === 'restore') {
      if (remote && !remote.deleted) return confirm(op, remote.rev, null, report); // la restauration a bien eu lieu : jamais renvoyée
      if (!remote || remote.rev !== op.baseRev) return blockOperation(op, 'conflict', 'Le cloud a changé depuis la décision de restauration : résolution explicite requise.', report, now);
      // toujours supprimé à la révision attendue : la restauration n'a pas eu lieu, on l'envoie
    } else if (op.op === 'delete') {
      if (!remote || remote.deleted) return confirm(op, remote?.rev ?? op.baseRev, null, report);
      // création envoyée (réponse perdue) puis supprimée localement : le cloud contient NOTRE enregistrement, de révision inconnue ici
      if (op.baseRev === 0) expectedRevOverride = remote.rev;
    } else if (remote && !remote.deleted && hash !== null && remote.hash === hash) {
      return confirm(op, remote.rev, hash, report, snap);
    } else if (remote && (remote.deleted || op.op === 'create' || remote.rev !== op.baseRev)) {
      return blockOperation(op, 'conflict', 'Le cloud contient une version différente (modifiée ou supprimée ailleurs) : résolution explicite requise.', report, now);
    }
  }

  let result: { rev: number };
  try {
    result = await options.transport.push({
      opId: op.opId,
      recordId: op.recordId,
      kind: op.kind,
      op: op.op,
      expectedRev: op.op === 'create' ? null : expectedRevOverride ?? op.baseRev,
      deletedAt: op.deletedAt,
      wire,
    });
  } catch (error) {
    // erreur du transport (ou inconnue) : le résultat de l'envoi n'est pas connu → « à vérifier » à la prochaine exécution
    return classify(error, true);
  }
  // L'enregistrement local de la confirmation est HORS du « try » ci-dessus : une erreur de stockage ici n'est pas une erreur
  // d'envoi. Elle remonte à runOnce, qui s'arrête ; l'opération reste « en cours » et sera vérifiée (jamais renvoyée à l'aveugle).
  return confirm(op, result.rev, hash, report, snap);
}

/** Met UN changement explicite en file (ex. restauration demandée par une résolution de conflit), avec la marque unique de la file. */
export async function enqueueChange(change: IncomingChange, now: Date = new Date()): Promise<void> {
  await queueStore.update((queue) => applyChanges(queue.nonce ? queue : { ...queue, nonce: genId('q') }, [change], now));
}

// ---- Lecture seule : résumé de la file -----------------------------------------------------------------------------------------

export async function getQueueSummary(): Promise<{ total: number; byOp: Record<string, number>; uncertain: number; stickyBlocks: number }> {
  const queue = await queueStore.load();
  const ops = Object.values(queue.ops);
  const byOp: Record<string, number> = {};
  for (const op of ops) byOp[op.op] = (byOp[op.op] ?? 0) + 1;
  return { total: ops.length, byOp, uncertain: ops.filter((o) => o.uncertain || o.inFlight).length, stickyBlocks: ops.filter((o) => o.block && (o.block.reason === 'conflict' || o.block.reason === 'permanent_error')).length };
}
