// P5 — cycle de synchronisation : quand capturer, envoyer, recevoir ; coupures réseau, reprises, déconnexion ; limites de lectures, d'écritures
// et de nouvelles tentatives. Horloge et minuteurs SIMULÉS, cloud en mémoire : aucun minuteur réel, aucun SDK, aucun réseau, rien n'est
// démarré dans l'application.

import fs from 'fs';
import path from 'path';
import * as dbModule from '../db';
import { createBien, resetImmobilierToolCache } from '../immobilierService';
import { switchWorkspace } from '../persistence';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { budgetStore, createSyncCycle, currentBudget, DEFAULT_LIMITS, type CycleReason, type SyncCycle, type SyncLimits } from '../sync/syncCycle';
import { queueStore } from '../sync/syncQueue';
import { getSyncAccount, setSyncAccount } from '../sync/syncAccount';
import { __useActivationForTests } from '../sync/syncActivation';
import { createMemoryCloud, type MemoryCloud } from './helpers/syncCloudMemory';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));

const mockMemory = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => (mockMemory.has(key) ? (mockMemory.get(key) as string) : null),
    setItem: async (key: string, value: string) => void mockMemory.set(key, value),
    removeItem: async (key: string) => void mockMemory.delete(key),
    clear: async () => mockMemory.clear(),
    getAllKeys: async () => [...mockMemory.keys()],
  },
}));

const SCOPE = { enabledAt: '2000-01-01T00:00:00.000Z' };
const START = Date.parse('2026-10-21T10:00:00.000Z');

function fakeTime() {
  let t = START;
  const timers: { id: number; at: number; fn: () => void }[] = [];
  let next = 1;
  return {
    now: () => new Date(t),
    advance: (ms: number) => void (t += ms),
    set: (ms: number) => void (t = ms),
    schedule: (fn: () => void, delay: number) => {
      const id = next++;
      timers.push({ id, at: t + delay, fn });
      return () => void timers.splice(0, timers.length, ...timers.filter((x) => x.id !== id));
    },
    pending: () => timers.map((x) => x.at - t).sort((a, b) => a - b),
    /** Exécute les minuteurs échus (dans l'ordre) et attend leur fin. */
    async runDue() {
      for (;;) {
        const due = timers.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)[0];
        if (!due) return;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
        await new Promise((r) => setTimeout(r, 15));
      }
    },
  };
}

let cloud: MemoryCloud;
let time: ReturnType<typeof fakeTime>;
let online: boolean;

beforeEach(async () => {
  __useActivationForTests(false); // moteur générique : l'activation est testée dans syncActivation.test.ts
  mockMemory.clear();
  await switchWorkspace('personal');
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  setSyncAccount('alice');
  cloud = createMemoryCloud({ uid: 'alice', start: new Date('2026-10-21T09:00:00.000Z') });
  time = fakeTime();
  online = true;
});

function makeCycle(limits: Partial<SyncLimits> = {}, over: { transports?: () => ReturnType<typeof createFirestoreSyncTransport> } = {}): SyncCycle {
  const cycle = createSyncCycle({
    transports: () => {
      const t = over.transports ? over.transports() : createFirestoreSyncTransport({ backend: cloud.backend, uid: 'alice', now: time.now, overlapMs: 0 });
      return { push: t, pull: t };
    },
    isOnline: () => online,
    now: time.now,
    schedule: time.schedule,
    scope: () => SCOPE,
    limits,
    random: () => 0.5,
  });
  cycle.start();
  return cycle;
}
const ops = async () => Object.keys((await queueStore.load()).ops).length;
const budget = async () => currentBudget(await budgetStore.load(), time.now());

// ============================================================================================================================
describe('Quand synchroniser : portes d’entrée', () => {
  it('jamais avant le démarrage, sans compte, ni hors ligne : aucune tentative réseau', async () => {
    await createBien({ nom: 'Un', adresse: 'X' });
    const cycle = createSyncCycle({ transports: () => ({ push: createFirestoreSyncTransport({ backend: cloud.backend, uid: 'alice' }), pull: createFirestoreSyncTransport({ backend: cloud.backend, uid: 'alice' }) }), isOnline: () => online, now: time.now, schedule: time.schedule, scope: () => SCOPE });
    expect((await cycle.trigger('start')).skipped).toBe('stopped');
    cycle.start();
    setSyncAccount(null);
    expect((await cycle.trigger('start')).skipped).toBe('no_account');
    expect(cycle.state().status).toBe('no_account');
    setSyncAccount('alice');
    online = false;
    const offline = await cycle.trigger('start');
    expect(offline.skipped).toBe('offline');
    expect(cycle.state().status).toBe('offline');
    expect(cloud.log).toEqual([]);
    expect(await ops()).toBe(0); // même la capture attend : aucune écriture tant qu'on n'est pas autorisé
    online = true;
    expect((await cycle.trigger('network_back')).ran).toBe(true);
    expect(cloud.docs.size).toBe(1);
  });

  it('cycle complet : capture, envoi, réception ; compteurs estimés et persistés ; minuteur de réception programmé', async () => {
    await createBien({ nom: 'Un', adresse: 'X' });
    const cycle = makeCycle();
    const report = await cycle.trigger('start');
    expect(report.ran).toBe(true);
    expect(report.push?.confirmed).toHaveLength(1);
    expect(report.pull?.stopped).toBeNull();
    expect(report.writes).toBe(1);
    expect(report.reads).toBeGreaterThanOrEqual(2);
    expect(cycle.state()).toMatchObject({ status: 'idle', consecutiveFailures: 0, lastError: null, account: 'alice' });
    expect(cycle.state().lastSuccessAt).toBe(time.now().toISOString());
    expect(time.pending()).toEqual([DEFAULT_LIMITS.foregroundIntervalMs]);
    const b = await budget();
    expect(b).toMatchObject({ writes: 1, cycles: 1 });
    expect(b.reads).toBe(report.reads);
  });

  it('changement local : capture tout de suite (sans réseau), envoi seulement après l’accalmie, sans réception (envoi seul)', async () => {
    const cycle = makeCycle();
    await createBien({ nom: 'Un', adresse: 'X' });
    const r = await cycle.trigger('local_change');
    expect(r.ran).toBe(false);
    expect(await ops()).toBe(1);
    expect(cloud.log).toEqual([]); // rien n'est parti
    await createBien({ nom: 'Deux', adresse: 'Y' });
    await cycle.trigger('local_change'); // rafale : l'accalmie repart de zéro
    expect(time.pending()).toEqual([DEFAULT_LIMITS.localChangeDebounceMs]);
    time.advance(DEFAULT_LIMITS.localChangeDebounceMs);
    await time.runDue();
    expect(cloud.docs.size).toBe(2);
    expect(cloud.log.some((l) => l.kind === 'page')).toBe(false); // envoi seul : aucune lecture de réception
  });

  it('une demande pendant un cycle est fusionnée en UNE relance', async () => {
    await createBien({ nom: 'Un', adresse: 'X' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = () => {
      const real = createFirestoreSyncTransport({ backend: cloud.backend, uid: 'alice', now: time.now, overlapMs: 0 });
      return { ...real, push: async (req: Parameters<typeof real.push>[0]) => (await gate, real.push(req)) } as typeof real;
    };
    const cycle = makeCycle({}, { transports: slow });
    const first = cycle.trigger('start');
    await new Promise((r) => setTimeout(r, 15));
    const reasons: CycleReason[] = ['foreground', 'manual', 'network_back'];
    const skipped = await Promise.all(reasons.map((r) => cycle.trigger(r)));
    expect(skipped.map((s) => s.skipped)).toEqual(['running', 'running', 'running']);
    release();
    const done = await first;
    expect(done.ran).toBe(true);
    expect(time.pending()).toContain(DEFAULT_LIMITS.minIntervalMs); // exactement une relance (la dernière demande) + le minuteur de réception
    expect(time.pending().filter((p) => p === DEFAULT_LIMITS.minIntervalMs)).toHaveLength(1);
  });

  it('fréquence : deux cycles automatiques trop proches sont différés ; une action manuelle passe sans attendre 30 s mais pas sans limite', async () => {
    const cycle = makeCycle();
    await cycle.trigger('foreground');
    cloud.log.length = 0;
    time.advance(5_000);
    const throttled = await cycle.trigger('foreground');
    expect(throttled).toMatchObject({ ran: false, skipped: 'throttled' });
    expect(throttled.retryAt).toBe(new Date(time.now().getTime() + DEFAULT_LIMITS.minIntervalMs - 5_000).toISOString());
    expect(cloud.log).toEqual([]);
    const m1 = await cycle.trigger('manual');
    expect(m1.ran).toBe(true);
    time.advance(1_000);
    expect((await cycle.trigger('manual')).skipped).toBe('throttled'); // 5 s minimum entre deux actions manuelles
    time.advance(DEFAULT_LIMITS.manualMinIntervalMs);
    expect((await cycle.trigger('manual')).ran).toBe(true);
  });
});

// ============================================================================================================================
describe('Coupures, reprises, nouvelles tentatives', () => {
  it('échecs réseau : reprise exponentielle plafonnée, puis pause ; reprise sur action manuelle ; aucun doublon', async () => {
    await createBien({ nom: 'Un', adresse: 'X' });
    const cycle = makeCycle({ maxConsecutiveFailures: 4, backoffBaseMs: 30_000, backoffMaxMs: 100_000, minIntervalMs: 0 });
    cloud.fail.reads(10_000);
    const delays: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await cycle.trigger('timer');
      expect(r.ran).toBe(true);
      expect(cycle.state()).toMatchObject({ status: 'backoff', consecutiveFailures: i + 1 });
      delays.push(Date.parse(cycle.state().nextAttemptAt as string) - time.now().getTime());
      time.advance(delays[i]);
    }
    expect(delays).toEqual([30_000, 60_000, 100_000]); // 30 s, 60 s, puis plafonné
    await cycle.trigger('timer');
    expect(cycle.state()).toMatchObject({ status: 'paused_errors', consecutiveFailures: 4, nextAttemptAt: null });
    expect(time.pending().every((p) => p > DEFAULT_LIMITS.minIntervalMs - 1)).toBe(true);
    const callsBefore = cloud.log.length;
    expect((await cycle.trigger('timer')).skipped).toBe('paused_errors'); // aucun réessai automatique
    expect(cloud.log.length).toBe(callsBefore);
    // le réseau revient : action manuelle → reprise ; tout est envoyé UNE fois (le délai propre à l'opération en file est écoulé)
    cloud.fail.reads(0);
    time.advance(60_000);
    const resumed = await cycle.trigger('manual');
    expect(resumed.ran).toBe(true);
    expect(cycle.state()).toMatchObject({ status: 'idle', consecutiveFailures: 0, lastError: null });
    expect(cloud.docs.size).toBe(1);
    expect(cloud.commits()).toBe(1);
  });

  it('limite d’écritures par cycle : le reste attend dans la file et part au cycle suivant, une seule fois chacun', async () => {
    for (const nom of ['A', 'B', 'C', 'D', 'E']) await createBien({ nom, adresse: 'X' });
    const cycle = makeCycle({ maxWritesPerCycle: 2, minIntervalMs: 0 });
    const first = await cycle.trigger('manual');
    expect(first.push).toMatchObject({ stopped: 'limit' });
    expect(first.writes).toBe(2);
    expect(cloud.docs.size).toBe(2);
    expect(await ops()).toBe(3); // conservé, jamais perdu
    time.advance(10_000);
    await cycle.trigger('manual');
    time.advance(10_000);
    await cycle.trigger('manual');
    expect(cloud.docs.size).toBe(5);
    expect(await ops()).toBe(0);
    expect(cloud.commits()).toBe(5); // aucune opération répétée
  });

  it('limite de pages de réception par cycle : la lecture reprend où elle s’est arrêtée', async () => {
    for (const nom of ['A', 'B', 'C', 'D']) await createBien({ nom, adresse: 'X' });
    const pusher = makeCycle({ minIntervalMs: 0 });
    await pusher.trigger('manual');
    expect(cloud.docs.size).toBe(4);
    pusher.stop();
    time.advance(60_000);
    // appareil vide : lecture par pages de 1, deux pages par cycle
    for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
    dbModule.users.push(dbModule.defaultLocalUser());
    resetImmobilierToolCache();
    mockMemory.clear();
    const reader = makeCycle({ minIntervalMs: 0, pageSize: 1, maxPullPagesPerCycle: 2 });
    const r1 = await reader.trigger('manual');
    expect(r1.pull?.applied).toHaveLength(2);
    time.advance(10_000);
    const r2 = await reader.trigger('manual');
    expect(r2.pull?.applied).toHaveLength(2);
    time.advance(10_000);
    const r3 = await reader.trigger('manual');
    expect(r3.pull?.applied).toHaveLength(0); // tout est reçu : plus rien, aucun doublon
    expect(dbModule.records).toHaveLength(4);
  });
});

// ============================================================================================================================
describe('Plafonds quotidiens, horaires et déconnexion', () => {
  it('plafond d’écritures du jour : plus d’envoi, la réception continue ; tout épuisé : pause jusqu’à minuit UTC, même sur action manuelle ; remise à zéro le lendemain', async () => {
    for (const nom of ['A', 'B', 'C']) await createBien({ nom, adresse: 'X' });
    const cycle = makeCycle({ dailyWrites: 2, dailyReads: 10, minIntervalMs: 0, manualMinIntervalMs: 0 });
    const first = await cycle.trigger('manual');
    expect(first.writes).toBe(2);
    expect(first.push).toMatchObject({ stopped: 'limit' });
    time.advance(1_000);
    const second = await cycle.trigger('manual'); // écritures épuisées : pas d'envoi, réception seulement
    expect(second.ran).toBe(true);
    expect(second.push).toBeUndefined();
    expect(second.pull).toBeDefined();
    expect(cloud.docs.size).toBe(2);
    expect(await ops()).toBe(1); // l'opération en attente est conservée
    // lectures épuisées aussi
    await budgetStore.update((b) => ({ ...b, reads: 10 }));
    const blocked = await cycle.trigger('manual');
    expect(blocked).toMatchObject({ ran: false, skipped: 'quota' });
    expect(blocked.retryAt).toBe('2026-10-22T00:00:00.000Z');
    expect(cycle.state().status).toBe('quota_paused');
    // le lendemain : compteurs remis à zéro, l'opération partie
    time.set(Date.parse('2026-10-22T00:00:01.000Z'));
    const next = await cycle.trigger('manual');
    expect(next.ran).toBe(true);
    expect(cloud.docs.size).toBe(3);
    expect((await budget()).writes).toBe(1);
  });

  it('plafond de cycles par heure', async () => {
    const cycle = makeCycle({ maxCyclesPerHour: 2, minIntervalMs: 0, manualMinIntervalMs: 0 });
    expect((await cycle.trigger('manual')).ran).toBe(true);
    expect((await cycle.trigger('manual')).ran).toBe(true);
    const third = await cycle.trigger('manual');
    expect(third).toMatchObject({ ran: false, skipped: 'hourly_cap', retryAt: '2026-10-21T11:00:00.000Z' });
    time.set(Date.parse('2026-10-21T11:00:00.000Z'));
    expect((await cycle.trigger('manual')).ran).toBe(true);
  });

  it('compteurs propres à chaque compte', async () => {
    const cycle = makeCycle({ minIntervalMs: 0 });
    await createBien({ nom: 'Un', adresse: 'X' });
    await cycle.trigger('manual');
    expect((await budget()).writes).toBe(1);
    setSyncAccount('bob');
    expect((await budget()).writes).toBe(0);
    setSyncAccount('alice');
    expect((await budget()).writes).toBe(1);
  });

  it('déconnexion pendant un cycle : arrêt propre, aucun échec compté, aucun minuteur, état du compte conservé ; un autre compte repart de zéro', async () => {
    await createBien({ nom: 'Un', adresse: 'X' });
    await createBien({ nom: 'Deux', adresse: 'Y' });
    const inner = () => createFirestoreSyncTransport({ backend: cloud.backend, uid: 'alice', now: time.now, overlapMs: 0 });
    let first = true;
    const cycle = makeCycle({ minIntervalMs: 0 }, {
      transports: () => {
        const real = inner();
        return {
          ...real,
          push: async (req: Parameters<typeof real.push>[0]) => {
            const result = await real.push(req);
            if (first) {
              first = false;
              setSyncAccount(null); // déconnexion pendant l'exécution
            }
            return result;
          },
        } as typeof real;
      },
    });
    const report = await cycle.trigger('manual');
    expect(report.ran).toBe(true);
    expect(report.push?.stopped).toBe('account_changed');
    expect(report.pull).toBeUndefined(); // pas de réception après la déconnexion
    expect(getSyncAccount()).toBeNull();
    expect(cycle.state()).toMatchObject({ status: 'no_account', consecutiveFailures: 0, nextAttemptAt: null });
    expect(time.pending()).toEqual([]);
    expect(cloud.docs.size).toBe(1);
    // reconnexion du même compte : la file est retrouvée et reprise (rien de refait)
    setSyncAccount('alice');
    expect(await ops()).toBe(1);
    time.advance(10_000);
    await cycle.trigger('manual');
    expect(cloud.docs.size).toBe(2);
    expect(cloud.commits()).toBe(2);
  });

  it('arrêt : les minuteurs sont annulés et plus aucune demande n’est exécutée', async () => {
    const cycle = makeCycle();
    await cycle.trigger('start');
    expect(time.pending().length).toBeGreaterThan(0);
    cycle.stop();
    expect(time.pending()).toEqual([]);
    expect(cycle.state().status).toBe('stopped');
    cloud.log.length = 0;
    expect((await cycle.trigger('manual')).skipped).toBe('stopped');
    expect(cloud.log).toEqual([]);
  });

  it('aucune exception ne sort du cycle : un incident local inattendu devient une reprise différée', async () => {
    await createBien({ nom: 'Un', adresse: 'X' });
    const cycle = createSyncCycle({
      transports: () => {
        throw new Error('incident inattendu');
      },
      isOnline: () => true,
      now: time.now,
      schedule: time.schedule,
      scope: () => SCOPE,
      limits: { minIntervalMs: 0 },
    });
    cycle.start();
    const r = await cycle.trigger('manual');
    expect(r.ran).toBe(false);
    expect(cycle.state()).toMatchObject({ status: 'backoff', consecutiveFailures: 1, lastError: 'incident inattendu' });
  });
});

// ============================================================================================================================
describe('Non démarré dans l’application', () => {
  it('aucun code de production ne crée ni n’appelle le cycle ; le module n’a aucun minuteur propre ni accès réseau', () => {
    const root = path.join(__dirname, '..', '..');
    const source = fs.readFileSync(path.join(root, 'services', 'sync', 'syncCycle.ts'), 'utf8');
    const code = source.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
    expect(code).not.toMatch(/setTimeout|setInterval|AppState|NetInfo|fetch\(|firebase/);
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.git', '.expo', 'android', 'ios', '__tests__'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const users = walk(root).filter((f) => !f.endsWith('syncCycle.ts') && /sync\/syncCycle['"]/.test(fs.readFileSync(f, 'utf8')));
    // seule la façade d'affichage (services/syncDisplay.ts) en lit le TYPE d'état ; rien ne crée ni n'appelle le cycle
    expect(users.map((f) => path.relative(root, f).replace(/\\/g, '/'))).toEqual(['services/syncDisplay.ts']);
    expect(fs.readFileSync(path.join(root, 'services/syncDisplay.ts'), 'utf8')).toMatch(/import type \{ CycleStatus \} from '\.\/sync\/syncCycle';/);
    expect(fs.readFileSync(path.join(root, 'constants/features.ts'), 'utf8')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
  });
});
