// Clôture de la phase 6 — exclusion mutuelle entre la synchronisation V1 (`records`) et le nouveau moteur (`syncRecords`), dans les deux sens,
// y compris pour deux démarrages simultanés ; un refus est explicite et ne modifie aucune donnée ; le comportement V1 est inchangé quand le
// moteur est inactif.

import * as dbModule from '../db';
import { records } from '../db';
import { createBien, resetImmobilierToolCache } from '../immobilierService';
import { enableSync, importLocalRecords, loadSyncState, releaseLocalOwnership, resolveConflict, syncNow, type CloudRecordsApi } from '../cloudSyncService';
import { setActiveCloudUid } from '../cloudVisibility';
import { switchWorkspace } from '../persistence';
import { setSyncAccount } from '../sync/syncAccount';
import { __useActivationForTests, getActivation, isActivated } from '../sync/syncActivation';
import { forgetSyncAccountState } from '../sync/syncAccountCleanup';
import { activateEngine, engineActivationState } from '../syncLifecycle';
import { setEmailVerified } from '../accountVerification';
import { __resetSyncModeForTests, claimEngine, clearEngineChosen, readEngineChoice, isEngineChosen, isEngineClaimed, markEngineChosen, noteV1State, runV1Operation, SyncModeError } from '../syncMode';
import { startSyncRuntime, type SyncRuntime, type SyncRuntimeDeps } from '../sync/syncRuntime';

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

const calls: string[] = [];
const api: CloudRecordsApi = {
  ensureSpace: async (uid: string) => (calls.push('ensureSpace'), `personal_${uid}`),
  fetchRecords: async () => (calls.push('fetchRecords'), []),
  writeRecord: async () => (calls.push('writeRecord'), 1),
} as unknown as CloudRecordsApi;

const runtimeDeps = (): SyncRuntimeDeps => ({
  enabled: () => true,
  uid: () => 'alice',
  transports: () => {
    throw new Error('aucun transport ne doit être demandé dans ce test');
  },
  isOnline: () => false, // aucun réseau : le cycle ne fait que se déclarer hors ligne
  schedule: () => () => undefined,
});

const running: SyncRuntime[] = [];
const start = (): SyncRuntime | null => {
  const runtime = startSyncRuntime(runtimeDeps());
  if (runtime) running.push(runtime);
  return runtime;
};

beforeEach(async () => {
  __useActivationForTests(true);
  await switchWorkspace('personal');
  mockMemory.clear();
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  setActiveCloudUid('alice');
  setSyncAccount('alice');
  setEmailVerified('alice', true); // F1 : la synchronisation exige une adresse e-mail vérifiée (refus testé dans accountF1.test.ts)
  __resetSyncModeForTests();
  calls.length = 0;
});
afterEach(() => {
  running.splice(0).forEach((r) => r.stop());
  __useActivationForTests(false);
});

const snapshot = () => JSON.stringify({ records, storage: [...mockMemory.entries()].filter(([k]) => !k.includes('sync_owners')) });

describe('Le nouveau moteur refuse de démarrer si la V1 peut être active', () => {
  it('V1 active pour le compte (état persisté) : refus explicite, aucune donnée modifiée, aucun écouteur', async () => {
    await createBien({ nom: 'A', adresse: 'X' });
    await enableSync(api, 'alice'); // la V1 est activée pour alice
    expect(await loadSyncState('alice')).not.toBeNull();
    const before = snapshot();
    expect(() => start()).toThrow(SyncModeError);
    try {
      start();
    } catch (e) {
      expect((e as SyncModeError).code).toBe('v1_active');
      expect((e as Error).message).toMatch(/V1 est active/);
    }
    expect(isEngineClaimed()).toBe(false);
    expect(snapshot()).toBe(before);
  });

  it('état V1 jamais lu : refus (inconnu = pas de pari)', () => {
    expect(() => start()).toThrow(expect.objectContaining({ code: 'v1_unknown' }));
  });

  it('V1 non active (état lu, absent) : le moteur démarre ; un second démarrage est refusé', async () => {
    expect(await loadSyncState('alice')).toBeNull();
    expect(start()).not.toBeNull();
    expect(isEngineClaimed()).toBe(true);
    expect(() => start()).toThrow(expect.objectContaining({ code: 'engine_active' }));
  });

  it('une opération V1 en cours au moment du démarrage : refus', async () => {
    noteV1State('alice', false);
    let release: () => void = () => undefined;
    const pending = runV1Operation('alice', () => new Promise<void>((resolve) => { release = resolve; }));
    expect(() => start()).toThrow(expect.objectContaining({ code: 'v1_active' })); // la réservation est synchrone
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(() => start()).toThrow(expect.objectContaining({ code: 'v1_active' })); // toujours en cours
    release();
    await pending;
    expect(start()).not.toBeNull(); // l'opération terminée, le moteur peut démarrer
  });

  it('après la suppression de l’état V1 du compte (libération), le moteur peut démarrer', async () => {
    await enableSync(api, 'alice');
    await releaseLocalOwnership('alice');
    expect(start()).not.toBeNull();
  });
});

describe('La V1 refuse toute opération pendant que le nouveau moteur tourne', () => {
  it('enableSync, syncNow, importLocalRecords et resolveConflict : refus explicite, aucun appel cloud, aucune donnée modifiée', async () => {
    await enableSync(api, 'alice'); // état V1 existant, puis libéré pour laisser démarrer le moteur
    await releaseLocalOwnership('alice');
    await createBien({ nom: 'A', adresse: 'X' });
    expect(start()).not.toBeNull();
    calls.length = 0;
    const before = snapshot();
    for (const operation of [() => enableSync(api, 'alice'), () => syncNow(api, 'alice'), () => importLocalRecords('alice'), () => resolveConflict(api, 'alice', 'x', 'cloud')]) {
      await expect(operation()).rejects.toThrow(/V1 est suspendue/);
    }
    expect(calls).toEqual([]);
    expect(snapshot()).toBe(before);
  });

  it('après l’arrêt du moteur, la V1 fonctionne de nouveau comme avant', async () => {
    noteV1State('alice', false);
    const runtime = start()!;
    await expect(enableSync(api, 'alice')).rejects.toThrow(SyncModeError);
    runtime.stop();
    await runtime.drain(); // la réservation n'est rendue qu'à la fin de l'exécution en cours
    await Promise.resolve();
    expect(isEngineClaimed()).toBe(false);
    const state = await enableSync(api, 'alice');
    expect(state.uid).toBe('alice');
    expect(calls).toContain('ensureSpace');
  });
});

describe('Course entre les deux démarrages', () => {
  it('moteur et activation V1 lancés dans le même tour : un seul passe, jamais les deux', async () => {
    noteV1State('alice', false);
    const outcomes = await Promise.allSettled([Promise.resolve().then(() => start()), enableSync(api, 'alice')]);
    const engineStarted = outcomes[0].status === 'fulfilled';
    const v1Enabled = outcomes[1].status === 'fulfilled';
    expect(engineStarted && v1Enabled).toBe(false);
    expect(engineStarted || v1Enabled).toBe(true);
  });

  it('activation V1 lancée AVANT le moteur : le moteur est refusé tant qu’elle n’est pas terminée ; lancée APRÈS : elle est refusée', async () => {
    noteV1State('alice', false);
    const v1First = enableSync(api, 'alice');
    expect(() => start()).toThrow(SyncModeError); // l'opération V1 est déjà réservée (réservation avant tout await)
    await v1First;
    expect(() => start()).toThrow(expect.objectContaining({ code: 'v1_active' })); // et la V1 est maintenant active
    __resetSyncModeForTests();
    noteV1State('alice', false);
    const engine = start();
    expect(engine).not.toBeNull();
    await expect(enableSync(api, 'alice')).rejects.toThrow(SyncModeError);
  });

  it('claimEngine : deux réservations successives, une seule réussit ; la libération est idempotente', () => {
    noteV1State('alice', false);
    const release = claimEngine('alice');
    expect(() => claimEngine('alice')).toThrow(SyncModeError);
    release();
    release();
    expect(() => claimEngine('alice')).not.toThrow();
  });
});

describe('Comportement V1 inchangé quand le moteur est inactif', () => {
  it('activation, état persisté et lecture identiques ; aucune réservation durable', async () => {
    const state = await enableSync(api, 'alice');
    expect(state).toMatchObject({ uid: 'alice', spaceId: 'personal_alice', entries: {}, lastSyncAt: null });
    expect(await loadSyncState('alice')).toEqual(state);
    expect(await enableSync(api, 'alice')).toEqual(state); // idempotente
    expect(isEngineClaimed()).toBe(false);
  });
});

// ---- Phase 7 : marqueur persistant « moteur choisi » et activation explicite ---------------------------------------------------------

describe('Marqueur persistant « moteur choisi »', () => {
  it('posé seulement si la V1 n’est ni active, ni en cours, ni inconnue', async () => {
    await expect(markEngineChosen('alice')).rejects.toMatchObject({ code: 'v1_unknown' });
    await enableSync(api, 'alice');
    await expect(markEngineChosen('alice')).rejects.toMatchObject({ code: 'v1_active' });
    expect(await isEngineChosen('alice')).toBe(false);
  });

  it('une fois posé, la V1 est refusée pour ce compte MÊME moteur arrêté et MÊME après un redémarrage simulé ; aucun appel cloud ni donnée modifiée', async () => {
    expect(await loadSyncState('alice')).toBeNull();
    await createBien({ nom: 'A', adresse: 'X' });
    await markEngineChosen('alice');
    expect(isEngineClaimed()).toBe(false); // le moteur ne tourne pas
    const before = snapshot();
    for (const operation of [() => enableSync(api, 'alice'), () => syncNow(api, 'alice'), () => importLocalRecords('alice'), () => resolveConflict(api, 'alice', 'x', 'cloud')]) {
      await expect(operation()).rejects.toMatchObject({ code: 'engine_chosen' });
    }
    __resetSyncModeForTests(); // redémarrage : la mémoire est oubliée, le stockage reste
    await expect(enableSync(api, 'alice')).rejects.toMatchObject({ code: 'engine_chosen' });
    expect(calls).toEqual([]);
    expect(snapshot()).toBe(before);
    // un autre compte n'est pas concerné
    expect((await enableSync(api, 'bob')).uid).toBe('bob');
  });

  it('retiré avec l’état du compte (oubli technique) : la V1 redevient possible ; aucune donnée métier touchée', async () => {
    await loadSyncState('alice');
    await markEngineChosen('alice');
    await clearEngineChosen('alice');
    expect(await isEngineChosen('alice')).toBe(false);
    expect((await enableSync(api, 'alice')).uid).toBe('alice');
  });

  it('course : choisir le moteur et activer la V1 dans le même tour — un seul passe', async () => {
    await loadSyncState('alice');
    const outcomes = await Promise.allSettled([markEngineChosen('alice'), enableSync(api, 'alice')]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const chosenNow = await isEngineChosen('alice');
    const v1Now = (await loadSyncState('alice')) !== null;
    expect(chosenNow !== v1Now).toBe(true); // jamais les deux
  });

  it('marqueur illisible : la V1 reste refusée (prudence), jamais deux moteurs', async () => {
    await loadSyncState('alice');
    const original = mockMemory.get.bind(mockMemory);
    const spy = jest.spyOn(mockMemory, 'has').mockImplementation(() => {
      throw new Error('stockage illisible');
    });
    __resetSyncModeForTests();
    await expect(enableSync(api, 'alice')).rejects.toMatchObject({ code: 'marker_unreadable' }); // jamais une V1 démarrée, jamais pris pour un choix
    expect(await readEngineChoice('alice')).toBe('unreadable');
    expect(await isEngineChosen('alice')).toBe(false); // illisible n'est PAS « choisi » : le moteur ne démarre pas sur cette base
    spy.mockRestore();
    void original;
    // le stockage revient : l'état illisible n'a pas été mis en cache, la lecture suivante tranche
    expect(await readEngineChoice('alice')).toBe('not_chosen');
    expect((await enableSync(api, 'alice')).uid).toBe('alice');
  });
});

describe('Activation explicite du nouveau moteur', () => {
  const open = () => true;

  it('drapeau fermé : refusée, rien n’est posé ni activé', async () => {
    await loadSyncState('alice');
    expect(await activateEngine('alice', () => false)).toMatchObject({ ok: false });
    expect(await isEngineChosen('alice')).toBe(false);
    expect(await isActivated()).toBe(false);
  });

  it('succès : marqueur posé, synchronisation ACTIVÉE pour le compte, anciennes données exclues, rien d’envoyé ni de modifié', async () => {
    const old = await createBien({ nom: 'Ancien', adresse: 'X' });
    const before = JSON.stringify(records);
    expect(await activateEngine('alice', open)).toEqual({ ok: true });
    expect(await isEngineChosen('alice')).toBe(true);
    expect(await isActivated()).toBe(true);
    expect((await getActivation()).legacyIds).toContain(old.id); // l'ancien élément est « ancien » : jamais envoyé automatiquement
    expect(JSON.stringify(records)).toBe(before);
    expect(calls).toEqual([]);
    expect(await engineActivationState('alice')).toEqual({ chosen: true, v1Active: false });
  });

  it('V1 active pour le compte : refusée avec explication, aucune activation', async () => {
    await enableSync(api, 'alice');
    const result = await activateEngine('alice', open);
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/V1 est active/) });
    expect(await isEngineChosen('alice')).toBe(false);
    expect(await isActivated()).toBe(false);
  });

  it('compte actif différent : refusée', async () => {
    expect(await activateEngine('bob', open)).toMatchObject({ ok: false });
    expect(await isEngineChosen('bob')).toBe(false);
  });

  it('activation impossible (espace de démonstration) : le choix n’est pas conservé', async () => {
    await switchWorkspace('demo');
    expect(await activateEngine('alice', open)).toMatchObject({ ok: false });
    expect(await isEngineChosen('alice')).toBe(false);
    await switchWorkspace('personal');
  });

  it('l’oubli de l’état technique du compte retire aussi le choix', async () => {
    await activateEngine('alice', open);
    await forgetSyncAccountState('alice');
    expect(await isEngineChosen('alice')).toBe(false);
  });

  it('idempotente : une seconde activation ne change pas l’instant d’activation', async () => {
    await activateEngine('alice', open);
    const first = (await getActivation()).enabledAt;
    __resetSyncModeForTests();
    await loadSyncState('alice');
    expect((await activateEngine('alice', open)).ok).toBe(true);
    expect((await getActivation()).enabledAt).toBe(first);
  });
});
