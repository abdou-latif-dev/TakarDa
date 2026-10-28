// Cycle de synchronisation — P5. Politique et exécution d'UN cycle (capture → envoi → réception), avec des limites explicites. CONÇU, NON DÉMARRÉ :
// rien dans l'application ne le crée ni ne l'appelle ; aucun minuteur n'existe à l'import. Il réutilise le moteur existant (capture, file,
// envoi, réception, reprises, idempotence) : il n'ajoute que la POLITIQUE (quand, combien, que faire en cas d'échec).
//
// Quand :
//   - changement local   → capture immédiate (locale, gratuite) ; envoi seulement, après un délai d'accalmie (anti-rafale) ;
//   - démarrage, retour au premier plan, retour du réseau, minuteur → cycle complet (envoi puis réception) ;
//   - action manuelle    → cycle complet sans délai d'attente entre deux cycles, MAIS jamais au-delà des plafonds quotidiens.
// Jamais : sans compte actif, hors ligne (aucune tentative réseau), pendant un cycle déjà en cours (les demandes sont fusionnées en UNE relance),
// ni après la déconnexion (arrêt propre à l'étape suivante ; la file du compte est conservée).
//
// Limites (maîtrise des coûts) : plafonds quotidiens de lectures et d'écritures par compte (UTC), pages et opérations par cycle, intervalle
// minimal entre cycles, plafond de cycles par heure, délai de reprise exponentiel plafonné après un échec, pause après trop d'échecs
// consécutifs (reprise sur action manuelle, retour au premier plan ou retour du réseau). Les compteurs sont des ESTIMATIONS par excès :
// chaque envoi compte une lecture et une écriture ; chaque document reçu compte une lecture ; chaque page, au moins une.

import { runInbound, type InboundRunReport, type PullTransport } from './inbound';
import { captureLocalChanges, runOnce, type RunReport, type SyncTransport } from './syncEngine';
import type { ScanScope } from './changeScanner';
import { createPersistentStore } from './localStore';
import { accountChangePending, getSyncAccount } from './syncAccount';
import { activationRequired, isActivated } from './syncActivation';

/** `push_only` : envoi sans réception (après un changement local) ; les autres raisons font un cycle complet. */
export type CycleReason = 'start' | 'local_change' | 'foreground' | 'network_back' | 'timer' | 'manual' | 'push_only';

export interface SyncLimits {
  /** Plafonds quotidiens (jour UTC) PAR COMPTE ; au-delà : pause jusqu'au lendemain. */
  dailyReads: number;
  dailyWrites: number;
  /** Plafonds PAR CYCLE. */
  maxWritesPerCycle: number;
  maxPullPagesPerCycle: number;
  pageSize: number;
  /** Intervalle minimal entre deux cycles (hors action manuelle) et entre deux actions manuelles. */
  minIntervalMs: number;
  manualMinIntervalMs: number;
  /** Accalmie avant l'envoi après un changement local. */
  localChangeDebounceMs: number;
  /** Minuteur de réception quand l'application est au premier plan. */
  foregroundIntervalMs: number;
  maxCyclesPerHour: number;
  /** Reprise après échec : base, plafond, et nombre d'échecs consécutifs avant la pause. */
  backoffBaseMs: number;
  backoffMaxMs: number;
  maxConsecutiveFailures: number;
  /** Service suspendu (le cloud refuse tout) : délai avant la prochaine tentative automatique ; entre-temps, aucun envoi après un simple changement local. */
  suspendedRetryMs: number;
}

export const DEFAULT_LIMITS: SyncLimits = {
  dailyReads: 5_000,
  dailyWrites: 2_000,
  maxWritesPerCycle: 100,
  maxPullPagesPerCycle: 5,
  pageSize: 100,
  minIntervalMs: 30_000,
  manualMinIntervalMs: 5_000,
  localChangeDebounceMs: 3_000,
  foregroundIntervalMs: 5 * 60_000,
  maxCyclesPerHour: 30,
  backoffBaseMs: 30_000,
  backoffMaxMs: 15 * 60_000,
  maxConsecutiveFailures: 8,
  suspendedRetryMs: 30 * 60_000,
};

// ---- Compteurs persistants (propres au compte) -------------------------------------------------------------------------------

export interface BudgetData {
  schemaVersion: 1;
  /** Jour UTC des compteurs (AAAA-MM-JJ). */
  day: string;
  reads: number;
  writes: number;
  /** Cycles réseau de l'heure en cours. */
  hour: string;
  cycles: number;
}

export function validateBudget(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['compteurs illisibles'];
  const b = value as Record<string, unknown>;
  if (b.schemaVersion !== 1 || typeof b.day !== 'string' || typeof b.hour !== 'string') return ['structure invalide'];
  for (const k of ['reads', 'writes', 'cycles'] as const) if (typeof b[k] !== 'number' || !Number.isFinite(b[k]) || (b[k] as number) < 0) return [`${k} invalide`];
  return [];
}

export const budgetStore = createPersistentStore<BudgetData>({
  baseKey: 'sync_budget',
  name: 'compteurs de synchronisation',
  empty: () => ({ schemaVersion: 1, day: '', reads: 0, writes: 0, hour: '', cycles: 0 }),
  validate: validateBudget,
});

const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
const hourOf = (d: Date): string => d.toISOString().slice(0, 13);
const nextDayStart = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));

/** Compteurs remis à zéro quand le jour (ou l'heure) change. */
export function currentBudget(stored: BudgetData, now: Date): BudgetData {
  const day = dayOf(now);
  const hour = hourOf(now);
  return { schemaVersion: 1, day, reads: stored.day === day ? stored.reads : 0, writes: stored.day === day ? stored.writes : 0, hour, cycles: stored.hour === hour ? stored.cycles : 0 };
}

// ---- État --------------------------------------------------------------------------------------------------------------------

export type CycleStatus = 'stopped' | 'idle' | 'running' | 'offline' | 'backoff' | 'quota_paused' | 'paused_errors' | 'suspended' | 'no_account' | 'not_activated';

export interface SyncCycleState {
  status: CycleStatus;
  account: string | null;
  lastCycleAt: string | null;
  lastSuccessAt: string | null;
  /** Prochaine tentative automatique prévue (null = aucune). */
  nextAttemptAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export type SkipReason = 'no_account' | 'not_activated' | 'offline' | 'running' | 'throttled' | 'quota' | 'hourly_cap' | 'paused_errors' | 'suspended' | 'stopped';

export interface CycleReport {
  ran: boolean;
  skipped?: SkipReason;
  /** Quand réessayer (ISO), si pertinent. */
  retryAt?: string | null;
  push?: RunReport;
  pull?: InboundRunReport;
  /** Estimations de ce cycle. */
  reads: number;
  writes: number;
  state: SyncCycleState;
}

export interface SyncCycleDeps {
  account?: () => string | null;
  /** Transports créés pour chaque cycle (le recouvrement de lecture s'applique à la première page de chaque instance). */
  transports: (uid: string) => { push: SyncTransport; pull: PullTransport };
  isOnline: () => boolean;
  now?: () => Date;
  schedule?: (run: () => void, delayMs: number) => () => void;
  scope: (uid: string) => ScanScope;
  limits?: Partial<SyncLimits>;
  random?: () => number;
  onState?: (state: SyncCycleState) => void;
}

export interface SyncCycle {
  /** Demande un cycle (décide : exécuter, différer ou ignorer). Ne lève jamais. */
  trigger(reason: CycleReason): Promise<CycleReport>;
  /** Arrêt : annule les minuteurs ; un cycle en cours s'arrête à l'étape suivante dès que le compte change. */
  stop(): void;
  /** Se résout quand plus aucune exécution n'est en cours (après `stop()`, l'exécution en cours s'arrête à sa prochaine opération). */
  whenIdle(): Promise<void>;
  start(): void;
  state(): SyncCycleState;
}

const noSchedule = (): (() => void) => () => undefined;

export function createSyncCycle(deps: SyncCycleDeps): SyncCycle {
  const limits: SyncLimits = { ...DEFAULT_LIMITS, ...deps.limits };
  const now = deps.now ?? (() => new Date());
  const account = deps.account ?? getSyncAccount;
  const schedule = deps.schedule ?? noSchedule; // sans minuteur fourni : aucun déclenchement automatique
  const random = deps.random ?? Math.random;

  let state: SyncCycleState = { status: 'stopped', account: null, lastCycleAt: null, lastSuccessAt: null, nextAttemptAt: null, consecutiveFailures: 0, lastError: null };
  let started = false;
  let running = false;
  let rerun: CycleReason | null = null;
  let lastNetworkCycleMs = 0;
  let lastManualMs = 0;
  let cancelNext: (() => void) | null = null;
  let cancelDebounce: (() => void) | null = null;
  let idleWaiters: (() => void)[] = [];
  const notifyIdle = () => {
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  };

  const publish = (patch: Partial<SyncCycleState>) => {
    state = { ...state, ...patch };
    deps.onState?.(state);
  };
  const clearTimers = () => {
    cancelNext?.();
    cancelDebounce?.();
    cancelNext = cancelDebounce = null;
  };
  const report = (partial: Partial<CycleReport> & { ran: boolean }): CycleReport => ({ reads: 0, writes: 0, ...partial, state });

  /** Programme la prochaine tentative automatique (reprise après échec ou minuteur de réception). */
  const planNext = (delayMs: number, reason: CycleReason) => {
    cancelNext?.();
    publish({ nextAttemptAt: new Date(now().getTime() + delayMs).toISOString() });
    cancelNext = schedule(() => void trigger(reason), delayMs);
  };

  async function trigger(reason: CycleReason): Promise<CycleReport> {
    try {
      return await attempt(reason);
    } catch (error) {
      // aucune exception ne sort du cycle : un échec local inattendu est un échec comme un autre (reprise différée)
      running = false;
      notifyIdle();
      const failures = state.consecutiveFailures + 1;
      publish({ status: 'backoff', consecutiveFailures: failures, lastError: error instanceof Error ? error.message : String(error) });
      return report({ ran: false, retryAt: state.nextAttemptAt });
    }
  }

  async function attempt(reason: CycleReason): Promise<CycleReport> {
    if (!started) return report({ ran: false, skipped: 'stopped' });
    const uid = account();
    if (!uid) {
      publish({ status: 'no_account', account: null });
      return report({ ran: false, skipped: 'no_account' });
    }
    if (state.account !== uid) publish({ account: uid, consecutiveFailures: 0, lastError: null, nextAttemptAt: null }); // autre compte : on repart de zéro
    // la synchronisation n'a lieu que pour un compte dont elle a été ACTIVÉE (activation sans envoi rétroactif, voir syncActivation.ts)
    if (activationRequired() && !(await isActivated())) {
      publish({ status: 'not_activated' });
      return report({ ran: false, skipped: 'not_activated' });
    }
    const t0 = now();

    // 1. changement local : capture (locale, gratuite) tout de suite, envoi après l'accalmie
    if (reason === 'local_change') {
      if (running) {
        rerun = rerun ?? 'local_change';
      } else {
        await captureLocalChanges({ scope: deps.scope(uid), now: t0, ownerUid: uid });
        cancelDebounce?.();
        cancelDebounce = schedule(() => void trigger('push_only'), limits.localChangeDebounceMs);
      }
      return report({ ran: false, skipped: running ? 'running' : undefined });
    }

    if (running) {
      rerun = reason; // fusionné : UNE relance après le cycle en cours
      return report({ ran: false, skipped: 'running' });
    }
    // 2. réseau
    if (!deps.isOnline()) {
      publish({ status: 'offline' });
      return report({ ran: false, skipped: 'offline' });
    }
    // service suspendu : un simple changement local ne relance pas d'envoi voué à l'échec avant l'heure de reprise prévue ; les autres raisons essaient
    if (state.status === 'suspended' && reason === 'push_only' && state.nextAttemptAt !== null && t0.toISOString() < state.nextAttemptAt) return report({ ran: false, skipped: 'suspended' });
    // 3. pauses et fréquence
    const manual = reason === 'manual';
    const resumeReasons: CycleReason[] = ['manual', 'foreground', 'network_back'];
    if (state.status === 'paused_errors' && !resumeReasons.includes(reason)) return report({ ran: false, skipped: 'paused_errors' });
    const sinceLast = t0.getTime() - (manual ? lastManualMs : lastNetworkCycleMs);
    const minGap = manual ? limits.manualMinIntervalMs : limits.minIntervalMs;
    if (lastNetworkCycleMs !== 0 && sinceLast < minGap && !(reason === 'network_back' && state.status === 'backoff')) {
      const retryAt = new Date(t0.getTime() + (minGap - sinceLast)).toISOString();
      if (!manual) planNext(minGap - sinceLast, reason);
      return report({ ran: false, skipped: 'throttled', retryAt });
    }
    const budget = currentBudget(await budgetStore.load(), t0);
    if (budget.cycles >= limits.maxCyclesPerHour) {
      const retryAt = new Date(Math.ceil((t0.getTime() + 1) / 3_600_000) * 3_600_000);
      publish({ status: 'quota_paused', nextAttemptAt: retryAt.toISOString() });
      if (!manual) planNext(retryAt.getTime() - t0.getTime(), 'timer');
      return report({ ran: false, skipped: 'hourly_cap', retryAt: retryAt.toISOString() });
    }
    const remainingReads = limits.dailyReads - budget.reads;
    const remainingWrites = limits.dailyWrites - budget.writes;
    if (remainingReads < 1 && remainingWrites < 1) {
      const retryAt = nextDayStart(t0);
      publish({ status: 'quota_paused', nextAttemptAt: retryAt.toISOString() });
      if (!manual) planNext(retryAt.getTime() - t0.getTime(), 'timer');
      return report({ ran: false, skipped: 'quota', retryAt: retryAt.toISOString() });
    }

    // 4. le cycle
    running = true;
    cancelNext?.();
    cancelNext = null;
    publish({ status: 'running', nextAttemptAt: null });
    lastNetworkCycleMs = t0.getTime();
    if (manual) lastManualMs = t0.getTime();
    const counted = { reads: 0, writes: 0 };
    const transports = deps.transports(uid);
    const pushTransport: SyncTransport = {
      push: async (request) => {
        counted.reads += 1; // la transaction lit avant d'écrire
        const result = await transports.push.push(request);
        counted.writes += 1;
        return result;
      },
      read: async (kind, id) => {
        counted.reads += 1;
        return transports.push.read(kind, id);
      },
    };
    const pageSize = Math.max(1, Math.min(limits.pageSize, Math.max(remainingReads, 1)));
    const pullTransport: PullTransport = {
      pull: async (request) => {
        const page = await transports.pull.pull(request);
        counted.reads += Math.max(1, page.changes.length);
        return page;
      },
    };
    let push: RunReport | undefined;
    let pull: InboundRunReport | undefined;
    let failed: string | null = null;
    let suspended = false;
    // arrêt demandé (stop()) ou compte différent : plus aucun nouveau travail, aucune écriture supplémentaire
    const shouldStop = (): boolean => !started || account() !== uid;
    try {
      await captureLocalChanges({ scope: deps.scope(uid), now: t0, ownerUid: uid });
      if (remainingWrites >= 1) {
        push = await runOnce({ transport: pushTransport, ownerUid: uid, now, maxOperations: Math.min(limits.maxWritesPerCycle, remainingWrites), shouldStop });
        if (push.stopped === 'network') failed = 'Réseau indisponible pendant l’envoi.';
        else if (push.stopped === 'persistence_error') failed = push.error ?? 'Erreur de stockage local pendant l’envoi.';
        else if (push.stopped === 'suspended') suspended = true;
      }
      if (!failed && push?.stopped !== 'account_changed' && !accountChangePending() && reason !== 'push_only' && remainingReads >= 1) {
        const pagesAllowed = Math.max(1, Math.min(limits.maxPullPagesPerCycle, Math.ceil(remainingReads / pageSize)));
        pull = await runInbound({ pull: pullTransport, ownerUid: uid, now, pageSize, maxPages: pagesAllowed, shouldStop });
        if (pull.stopped === 'network' || pull.stopped === 'pull_error') failed = pull.error ?? 'Lecture impossible.';
        else if (pull.stopped === 'persistence_error') failed = pull.error ?? 'Erreur de stockage local pendant la réception.';
        else if (pull.stopped === 'suspended') suspended = true;
      }
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
    }
    running = false;
    notifyIdle();

    // 5. compteurs (estimations par excès), même après un échec : les lectures et écritures tentées ont un coût
    try {
      await budgetStore.update((stored) => {
        const b = currentBudget(stored, t0);
        return { ...b, reads: b.reads + counted.reads, writes: b.writes + counted.writes, cycles: b.cycles + 1 };
      });
    } catch {
      // compteurs illisibles : on ne bloque pas la synchronisation sur eux, mais on ne les réinvente pas
    }

    const accountChanged = push?.stopped === 'account_changed' || pull?.stopped === 'account_changed' || account() !== uid;
    if (accountChanged) {
      publish({ status: account() ? 'idle' : 'no_account', account: account(), lastCycleAt: t0.toISOString(), nextAttemptAt: null });
      return report({ ran: true, push, pull, reads: counted.reads, writes: counted.writes });
    }
    if (suspended && !failed) {
      // le cloud refuse tout : ce n'est pas un échec à réessayer en rafale. La file est intacte ; reprise lente, ou à l'ouverture, au retour du réseau, sur action manuelle
      publish({ status: 'suspended', lastError: 'Accès refusé par les règles de sécurité.', lastCycleAt: t0.toISOString(), nextAttemptAt: null });
      planNext(limits.suspendedRetryMs, 'timer');
      return report({ ran: true, push, pull, reads: counted.reads, writes: counted.writes, retryAt: state.nextAttemptAt });
    }
    if (failed) {
      const failures = state.consecutiveFailures + 1;
      const paused = failures >= limits.maxConsecutiveFailures;
      const delay = Math.round(Math.min(limits.backoffBaseMs * 2 ** (failures - 1), limits.backoffMaxMs) * (0.75 + 0.5 * random()));
      publish({ status: paused ? 'paused_errors' : 'backoff', consecutiveFailures: failures, lastError: failed, lastCycleAt: t0.toISOString(), nextAttemptAt: null });
      if (!paused) planNext(delay, 'timer');
      return report({ ran: true, push, pull, reads: counted.reads, writes: counted.writes, retryAt: state.nextAttemptAt });
    }
    publish({ status: 'idle', consecutiveFailures: 0, lastError: null, lastCycleAt: t0.toISOString(), lastSuccessAt: t0.toISOString() });
    // minuteur de réception (premier plan) ; les demandes arrivées pendant le cycle sont fusionnées en UNE relance
    const queued = rerun;
    rerun = null;
    if (queued === 'local_change') {
      cancelDebounce?.();
      cancelDebounce = schedule(() => void trigger('push_only'), limits.localChangeDebounceMs);
      planNext(limits.foregroundIntervalMs, 'timer');
    } else if (queued) {
      planNext(limits.minIntervalMs, queued);
    } else {
      planNext(limits.foregroundIntervalMs, 'timer');
    }
    return report({ ran: true, push, pull, reads: counted.reads, writes: counted.writes });
  }

  return {
    trigger,
    start() {
      started = true;
      publish({ status: account() ? 'idle' : 'no_account', account: account() });
    },
    whenIdle: () => (running ? new Promise<void>((resolve) => void idleWaiters.push(resolve)) : Promise.resolve()),
    stop() {
      started = false;
      clearTimers();
      rerun = null;
      publish({ status: 'stopped', nextAttemptAt: null });
    },
    state: () => state,
  };
}
