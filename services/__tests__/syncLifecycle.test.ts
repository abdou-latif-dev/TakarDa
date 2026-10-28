// Phase 7 — cycle de vie du nouveau moteur : le runtime tourne seulement si drapeau ouvert, espace personnel, compte authentifié, pas de suppression en cours
// et moteur CHOISI ; il est arrêté à la déconnexion, au changement de compte, pendant une suppression, en démonstration et au démontage ; un runtime obsolète
// ne travaille jamais après un changement de compte, même avec des démarrages asynchrones qui se chevauchent. Aucun Firebase : démarrage simulé.

import fs from 'fs';
import path from 'path';
import { SyncModeError } from '../syncMode';
import { createSyncLifecycle, startSyncLifecycle, type AuthSource, type LifecycleDeps, type LifecycleSnapshot } from '../syncLifecycle';

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

const signedIn = (uid: string, epoch = 1, over: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot => ({ authStatus: 'signedIn', uid, epoch, deleting: false, ...over });
const signedOut: LifecycleSnapshot = { authStatus: 'signedOut', uid: null, epoch: 2, deleting: false };

interface Harness {
  deps: LifecycleDeps;
  events: string[];
  state: { enabled: boolean; personal: boolean; chosen: Record<string, boolean> };
  /** Runtimes réellement vivants : ne dépasse jamais 1. */
  alive: () => number;
  gate: { hold: boolean; release: () => void };
  uidGetters: (() => string | null)[];
  bootError: { error: Error | null };
}

function harness(): Harness {
  const events: string[] = [];
  const state = { enabled: true, personal: true, chosen: { alice: true, bob: true } as Record<string, boolean> };
  let alive = 0;
  let peak = 0;
  const uidGetters: (() => string | null)[] = [];
  const bootError = { error: null as Error | null };
  let pending: (() => void) | null = null;
  const gate = {
    hold: false,
    release: () => {
      pending?.();
      pending = null;
    },
  };
  const deps: LifecycleDeps = {
    enabled: () => state.enabled,
    personalWorkspace: () => state.personal,
    engineChosen: async (uid) => state.chosen[uid] === true,
    boot: async (getUid) => {
      uidGetters.push(getUid);
      events.push(`boot:${getUid()}`);
      if (gate.hold) await new Promise<void>((resolve) => { pending = resolve; });
      if (bootError.error) throw bootError.error;
      alive += 1;
      peak = Math.max(peak, alive);
      expect(peak).toBeLessThanOrEqual(1); // jamais deux runtimes vivants en même temps
    },
    shutdown: () => {
      events.push('shutdown');
      alive = 0;
    },
  };
  return { deps, events, state, alive: () => alive, gate, uidGetters, bootError };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('Conditions de démarrage', () => {
  it('compte authentifié, moteur choisi, espace personnel : le runtime démarre pour CE compte, une seule fois', async () => {
    const h = harness();
    const lifecycle = createSyncLifecycle(h.deps);
    await lifecycle.apply(signedIn('alice'));
    await lifecycle.apply(signedIn('alice')); // même état : rien de plus
    expect(h.events).toEqual(['boot:alice']);
    expect(h.alive()).toBe(1);
    expect(lifecycle.status()).toEqual({ state: 'running', uid: 'alice' });
  });

  it('moteur non choisi pour le compte : rien ne démarre', async () => {
    const h = harness();
    h.state.chosen.alice = false;
    const lifecycle = createSyncLifecycle(h.deps);
    await lifecycle.apply(signedIn('alice'));
    expect(h.events).toEqual([]);
    expect(lifecycle.status()).toEqual({ state: 'stopped', reason: 'not_chosen' });
  });

  it('sans compte, statut inconnu, drapeau fermé : rien ne démarre', async () => {
    const h = harness();
    const lifecycle = createSyncLifecycle(h.deps);
    await lifecycle.apply(signedOut);
    await lifecycle.apply({ authStatus: 'unknown', uid: null, epoch: 0, deleting: false });
    h.state.enabled = false;
    await lifecycle.apply(signedIn('alice'));
    expect(h.events).toEqual([]);
    expect(lifecycle.status()).toEqual({ state: 'stopped', reason: 'disabled' });
  });

  it('espace de démonstration : jamais ; retour à l’espace personnel puis réévaluation : démarrage', async () => {
    const h = harness();
    h.state.personal = false;
    const lifecycle = createSyncLifecycle(h.deps);
    await lifecycle.apply(signedIn('alice'));
    expect(h.events).toEqual([]);
    expect(lifecycle.status()).toEqual({ state: 'stopped', reason: 'demo' });
    h.state.personal = true;
    await lifecycle.refresh();
    expect(h.events).toEqual(['boot:alice']);
  });

  it('refus d’exclusion (V1 active) : statut « refusé » explicite, aucune exception, rien ne tourne', async () => {
    const h = harness();
    h.bootError.error = new SyncModeError('v1_active', 'V1 active');
    const lifecycle = createSyncLifecycle(h.deps);
    await expect(lifecycle.apply(signedIn('alice'))).resolves.toBeUndefined();
    expect(lifecycle.status()).toEqual({ state: 'refused', code: 'v1_active', message: 'V1 active' });
    expect(h.alive()).toBe(0);
  });
});

describe('Arrêts', () => {
  it('déconnexion : arrêt ; reconnexion : redémarrage', async () => {
    const h = harness();
    const lifecycle = createSyncLifecycle(h.deps);
    await lifecycle.apply(signedIn('alice'));
    await lifecycle.apply(signedOut);
    expect(h.alive()).toBe(0);
    expect(lifecycle.status()).toEqual({ state: 'stopped', reason: 'signed_out' });
    await lifecycle.apply(signedIn('alice', 3));
    expect(h.events).toEqual(['boot:alice', 'shutdown', 'boot:alice']);
  });

  it('suppression de compte en cours : arrêt avant l’effacement ; fin de la suppression : pas de redémarrage tant que l’état n’est pas réévalué', async () => {
    const h = harness();
    const lifecycle = createSyncLifecycle(h.deps);
    await lifecycle.apply(signedIn('alice'));
    await lifecycle.apply(signedIn('alice', 1, { deleting: true }));
    expect(h.alive()).toBe(0);
    expect(lifecycle.status()).toEqual({ state: 'stopped', reason: 'deleting' });
    await lifecycle.apply(signedOut);
    expect(h.events).toEqual(['boot:alice', 'shutdown']);
  });

  it('démontage : arrêt complet, plus aucun démarrage ensuite', async () => {
    const h = harness();
    const lifecycle = createSyncLifecycle(h.deps);
    await lifecycle.apply(signedIn('alice'));
    lifecycle.dispose();
    expect(h.alive()).toBe(0);
    await lifecycle.apply(signedIn('bob'));
    expect(h.events).toEqual(['boot:alice', 'shutdown']);
  });

  it('même compte, nouvelle époque (reconnexion) : redémarrage, l’ancien runtime est arrêté', async () => {
    const h = harness();
    const lifecycle = createSyncLifecycle(h.deps);
    await lifecycle.apply(signedIn('alice', 1));
    await lifecycle.apply(signedIn('alice', 2));
    expect(h.events).toEqual(['boot:alice', 'shutdown', 'boot:alice']);
  });
});

describe('Changement de compte et courses asynchrones', () => {
  it('A → B : l’arrêt de A est SYNCHRONE (avant tout await), et l’ancien runtime ne voit plus aucun compte', async () => {
    const h = harness();
    const lifecycle = createSyncLifecycle(h.deps);
    await lifecycle.apply(signedIn('alice', 1));
    const aliceUid = h.uidGetters[0];
    expect(aliceUid()).toBe('alice');
    const pending = lifecycle.apply(signedIn('bob', 2));
    expect(h.events).toEqual(['boot:alice', 'shutdown']); // arrêt déjà fait, démarrage de B pas encore
    expect(aliceUid()).toBeNull(); // l'ancien runtime est lié à son compte : il ne travaille jamais pour B
    await pending;
    expect(h.events).toEqual(['boot:alice', 'shutdown', 'boot:bob']);
    expect(h.uidGetters[1]()).toBe('bob');
  });

  it('démarrage de A encore en cours quand le compte devient B : A est arrêté dès son démarrage terminé, puis B démarre ; jamais deux vivants', async () => {
    const h = harness();
    h.gate.hold = true;
    const lifecycle = createSyncLifecycle(h.deps);
    const first = lifecycle.apply(signedIn('alice', 1));
    await settle(); // boot(alice) bloqué
    expect(h.events).toEqual(['boot:alice']);
    h.gate.hold = false;
    const second = lifecycle.apply(signedIn('bob', 2));
    h.gate.release(); // le démarrage de A se termine APRÈS le changement de compte
    await Promise.all([first, second]);
    expect(h.events).toEqual(['boot:alice', 'shutdown', 'shutdown', 'boot:bob']);
    expect(h.alive()).toBe(1);
    expect(lifecycle.status()).toEqual({ state: 'running', uid: 'bob' });
    expect(h.uidGetters[0]()).toBeNull(); // A ne voit plus de compte
  });

  it('démarrage en cours puis déconnexion : rien ne reste vivant', async () => {
    const h = harness();
    h.gate.hold = true;
    const lifecycle = createSyncLifecycle(h.deps);
    const first = lifecycle.apply(signedIn('alice', 1));
    await settle();
    const second = lifecycle.apply(signedOut);
    h.gate.release();
    await Promise.all([first, second]);
    expect(h.alive()).toBe(0);
    expect(lifecycle.status()).toEqual({ state: 'stopped', reason: 'signed_out' });
  });

  it('rafale de changements (A, B, A, B) : à la fin, un seul runtime, pour le dernier compte', async () => {
    const h = harness();
    const lifecycle = createSyncLifecycle(h.deps);
    await Promise.all([lifecycle.apply(signedIn('alice', 1)), lifecycle.apply(signedIn('bob', 2)), lifecycle.apply(signedIn('alice', 3)), lifecycle.apply(signedIn('bob', 4))]);
    expect(h.alive()).toBe(1);
    expect(lifecycle.status()).toEqual({ state: 'running', uid: 'bob' });
    expect(h.uidGetters[h.uidGetters.length - 1]()).toBe('bob');
  });
});

describe('Drapeau fermé et pilotage depuis une source d’authentification', () => {
  const source = (): AuthSource & { subscribe: jest.Mock; getState: jest.Mock } => ({
    subscribe: jest.fn(() => () => undefined),
    getState: jest.fn(() => ({ authStatus: 'signedIn', user: { uid: 'alice' }, accountEpoch: 1, deleting: false })),
  });

  it('drapeau fermé : aucun abonnement, aucune lecture, aucun démarrage', async () => {
    const h = harness();
    h.state.enabled = false;
    const src = source();
    const stop = startSyncLifecycle(src, h.deps);
    await settle();
    expect(src.subscribe).not.toHaveBeenCalled();
    expect(src.getState).not.toHaveBeenCalled();
    expect(h.events).toEqual([]);
    expect(() => stop()).not.toThrow();
  });

  it('drapeau ouvert : abonnement, démarrage pour le compte, puis désabonnement et arrêt au démontage', async () => {
    const h = harness();
    const src = source();
    const unsubscribe = jest.fn();
    src.subscribe.mockReturnValue(unsubscribe);
    const stop = startSyncLifecycle(src, h.deps);
    await settle();
    expect(src.subscribe).toHaveBeenCalledTimes(1);
    expect(h.events).toEqual(['boot:alice']);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.alive()).toBe(0);
  });
});

describe('Structure : un seul point de démarrage, derrière le drapeau', () => {
  const root = path.join(__dirname, '..', '..');
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.git', '.expo', 'android', 'ios', '__tests__'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const rel = (f: string) => path.relative(root, f).split(path.sep).join('/');

  it('la composition de production n’est chargée que par syncLifecycle (à la demande) ; aucun import statique de Firebase', () => {
    const importers = walk(root).filter((f) => /syncRuntimeBoot['"]/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(importers).toEqual(['services/syncLifecycle.ts']);
    const lifecycle = read('services/syncLifecycle.ts');
    expect(lifecycle.split('\n').filter((l) => l.startsWith('import')).join('\n')).not.toMatch(/firebase|syncRuntime/);
    expect(lifecycle).toMatch(/require\('\.\/firebase\/syncRuntimeBoot'\)/);
  });

  it('_layout démarre le pilotage uniquement si le drapeau est ouvert et la base chargée ; le garde de modules aussi', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toMatch(/if \(!dbHydrated \|\| !CLOUD_ACCOUNT_ENABLED\) return undefined;\s*\n\s*const stop = startSyncLifecycle\(useCloudStore\);/);
    expect(layout).toContain('{CLOUD_ACCOUNT_ENABLED ? <ModuleLockGuard /> : null}');
    expect(walk(root).filter((f) => /startSyncLifecycle\(/.test(fs.readFileSync(f, 'utf8'))).map(rel).sort()).toEqual(['app/_layout.tsx', 'services/syncLifecycle.ts']);
  });

  it('l’écran de compte propose l’activation explicite du moteur, annonce que les anciennes données ne partent pas automatiquement, et ne lit le moteur que par la façade', () => {
    const screen = read('features/profile/screens/CloudAccountScreen.tsx');
    expect(screen).toContain("from '@/services/syncLifecycle'");
    expect(screen).toMatch(/Activer le nouveau moteur/);
    expect(screen).toMatch(/anciennes données ne seront PAS envoyées automatiquement/);
    // F2 : l'envoi volontaire des anciennes données vit dans sa propre carte (aperçu + confirmation) ; l'écran lui-même n'adopte rien et n'importe ni le moteur ni Firebase
    expect(screen).toContain("from '../components/LegacyAdoptionCard'");
    expect(screen.replace(/LegacyAdoptionCard/g, '')).not.toMatch(/services\/sync\/|firebase\/|adoptLegacy|adopt/i);
    expect(read('services/syncLifecycle.ts')).not.toMatch(/adoptedIds|adoptLegacy|adoptRecords/); // aucune adoption de données historiques
  });

  it('le drapeau cloud reste fermé', () => {
    expect(read('constants/features.ts')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
  });
});
