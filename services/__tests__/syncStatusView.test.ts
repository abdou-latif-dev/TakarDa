// P5 — états réels de synchronisation (en attente, synchronisé, conflit, erreur, suppression récupérable) dans la forme de l'interface
// existante. Cloud en mémoire, aucune interface modifiée, rien d'activé.

import fs from 'fs';
import path from 'path';
import * as dbModule from '../db';
import { records } from '../db';
import { createBien, createLocataireEtContrat, enregistrerPaiementLoyer, resetImmobilierToolCache } from '../immobilierService';
import { switchWorkspace } from '../persistence';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { listResolvedConflicts } from '../sync/conflictView';
import { resolveConflict, runInbound } from '../sync/inbound';
import { createDefaultApplier } from '../sync/localApplier';
import { setSyncAccount } from '../sync/syncAccount';
import { __useActivationForTests } from '../sync/syncActivation';
import { bannerModel, engineStatus } from '../sync/syncStatusView';
import { captureLocalChanges, runOnce } from '../sync/syncEngine';
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
const T0 = new Date('2026-10-21T10:00:00.000Z');
const clock = () => T0;
const UID = 'alice';
let cloud: MemoryCloud;

const clearDevice = () => {
  mockMemory.clear();
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
};

beforeEach(async () => {
  __useActivationForTests(false); // moteur générique : l'activation est testée dans syncActivation.test.ts
  await switchWorkspace('personal');
  clearDevice();
  setSyncAccount(UID);
  cloud = createMemoryCloud({ uid: UID, start: new Date('2026-10-21T09:00:00.000Z') });
});

const transport = () => createFirestoreSyncTransport({ backend: cloud.backend, uid: UID, now: clock, overlapMs: 0 });
const capture = () => captureLocalChanges({ scope: SCOPE, now: T0 });
const push = async () => (await capture(), runOnce({ transport: transport(), ownerUid: UID, now: clock, random: () => 0.5 }));
const pull = () => runInbound({ pull: transport(), ownerUid: UID, now: clock });
const env = () => ({ ownerUid: UID, applier: createDefaultApplier(), now: T0 });
const item = (id: string) => records.find((r) => r.id === id) as unknown as { values: Record<string, unknown> };

describe('États réels de synchronisation', () => {
  it('sans compte : rien ; ancien élément : « local » ; nouvel élément : « en attente » puis « synchronisé » seulement après confirmation', async () => {
    setSyncAccount(null);
    expect(await engineStatus()).toMatchObject({ account: null, states: {}, pending: 0, conflicts: [], errors: [], recoverable: [] });
    setSyncAccount(UID);
    const old = await createBien({ nom: 'Ancien', adresse: 'X' });
    await captureLocalChanges({ scope: { enabledAt: '2999-01-01T00:00:00.000Z' }, now: T0 }); // rien n'est adopté
    expect((await engineStatus()).states[old.id]).toBe('local');
    const fresh = await createBien({ nom: 'Nouveau', adresse: 'Y' });
    expect((await engineStatus()).states[fresh.id]).toBe('local'); // pas encore capturé ni revendiqué
    await capture();
    let status = await engineStatus();
    expect(status.states[fresh.id]).toBe('pending');
    expect(status.pending).toBe(2); // les deux éléments sont éligibles avec la portée large du test
    await push();
    status = await engineStatus();
    expect(status.states[fresh.id]).toBe('synced');
    expect(status.pending).toBe(0);
    expect(bannerModel(status)).toMatchObject({ summary: 'Tout est synchronisé', tone: 'ok' });
  });

  it('modification locale pas encore capturée : déjà « en attente » (comme l’interface actuelle) ; jamais « synchronisé » tant que le cloud n’a pas confirmé', async () => {
    const bien = await createBien({ nom: 'Un', adresse: 'X' });
    await push();
    expect((await engineStatus()).states[bien.id]).toBe('synced');
    item(bien.id).values.nom = 'Modifié';
    const status = await engineStatus();
    expect(status.states[bien.id]).toBe('pending');
    expect(bannerModel(status).summary).toBe('1 en attente d’envoi');
    await push();
    expect((await engineStatus()).states[bien.id]).toBe('synced');
  });

  it('conflit : « conflit », bandeau d’attention, aucun envoi ; après résolution : retour à « en attente » puis « synchronisé » ; l’historique est conservé', async () => {
    const bien = await createBien({ nom: 'Un', adresse: 'X' });
    await push();
    item(bien.id).values.nom = 'Locale';
    // l'autre appareil modifie le même champ (écriture directe dans le cloud en mémoire)
    const doc = cloud.docs.get(bien.id)!;
    cloud.docs.set(bien.id, { ...doc, rev: 2, body: { ...doc.body, nom: 'Distante' }, lastOpId: 'autre', serverUpdatedAt: '2026-10-21T09:30:00.000Z' });
    await pull();
    let status = await engineStatus();
    expect(status.states[bien.id]).toBe('conflict');
    expect(status.conflicts).toEqual([bien.id]);
    expect(bannerModel(status)).toMatchObject({ summary: '1 conflit(s) à résoudre', tone: 'attention', conflicts: 1 });
    await resolveConflict(bien.id, { type: 'keep_local' }, env());
    status = await engineStatus();
    expect(status.states[bien.id]).toBe('pending');
    expect(status.conflicts).toEqual([]);
    await push();
    expect((await engineStatus()).states[bien.id]).toBe('synced');
    expect((await listResolvedConflicts()).map((c) => c.recordId)).toEqual([bien.id]);
  });

  it('refus définitif du cloud : « erreur » (jamais « synchronisé » ni perdu), bandeau d’attention', async () => {
    const bien = await createBien({ nom: 'Un', adresse: 'X' });
    (item(bien.id).values as Record<string, unknown>).tableau = [[1, 2]]; // tableau imbriqué : refusé par Firestore, détecté avant l'envoi
    const report = await push();
    expect(report.permanentErrors).toEqual([bien.id]);
    const status = await engineStatus();
    expect(status.states[bien.id]).toBe('error');
    expect(status.errors).toEqual([bien.id]);
    expect(bannerModel(status)).toMatchObject({ summary: '1 élément(s) refusé(s) par le cloud', tone: 'attention' });
    expect(cloud.docs.size).toBe(0);
  });

  it('suppression reçue : liste « récupérable » (copie conservée) et bandeau ; l’élément n’est plus un badge', async () => {
    const bien = await createBien({ nom: 'Un', adresse: 'X' });
    await push();
    const doc = cloud.docs.get(bien.id)!;
    cloud.docs.set(bien.id, { ...doc, rev: 2, deleted: true, deletedAt: 'x', lastOpId: 'autre', serverUpdatedAt: '2026-10-21T09:30:00.000Z' });
    await pull();
    const status = await engineStatus();
    expect(status.states[bien.id]).toBeUndefined();
    expect(status.recoverable.map((r) => r.recordId)).toEqual([bien.id]);
    expect(status.recoverable[0]).toMatchObject({ kindLabel: 'Bien' });
    expect(bannerModel(status)).toMatchObject({ summary: '1 suppression(s) reçue(s), récupérable(s)', tone: 'attention' });
  });

  it('bandeau : état du cycle (hors ligne, pause, quota) sans jamais annoncer « synchronisé » à tort', async () => {
    const bien = await createBien({ nom: 'Un', adresse: 'X' });
    await capture();
    const status = await engineStatus();
    expect(bannerModel(status, { status: 'running' }).summary).toBe('Synchronisation…');
    expect(bannerModel(status, { status: 'offline' })).toMatchObject({ summary: '1 en attente d’envoi — Hors ligne : la synchronisation reprendra au retour du réseau', tone: 'paused' });
    expect(bannerModel(status, { status: 'quota_paused' }).summary).toMatch(/Limite quotidienne atteinte/);
    expect(bannerModel(status, { status: 'paused_errors' }).summary).toMatch(/Synchroniser maintenant/);
    await push();
    const done = await engineStatus();
    expect(bannerModel(done, { status: 'offline' })).toMatchObject({ summary: expect.stringMatching(/Hors ligne/), tone: 'paused' });
    expect(bannerModel(done, { status: 'idle' }).summary).toBe('Tout est synchronisé');
    expect(bien.id).toBeTruthy();
  });

  it('isolation : l’élément d’un autre compte n’apparaît dans aucun état', async () => {
    const mine = await createBien({ nom: 'Un', adresse: 'X' });
    await push();
    setSyncAccount('bob');
    const status = await engineStatus();
    expect(status.account).toBe('bob');
    expect(Object.keys(status.states)).toEqual([]);
    expect(status.recoverable).toEqual([]);
    setSyncAccount(UID);
    expect((await engineStatus()).states[mine.id]).toBe('synced');
  });

  it('faits financiers : une modification locale d’un fait confirmé reste « en attente » (retenue), jamais envoyée ni « synchronisée »', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    const { contrat } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre 1' }, nom: 'Koffi', telephone: '90123456', loyerMensuel: 25000, dateEntree: new Date(2026, 0, 5), dernierLoyerPaye: '2026-09' });
    const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
    await push();
    expect((await engineStatus()).states[paiement.id]).toBe('synced');
    item(paiement.id).values.montant = 1;
    const report = await push();
    expect(report.blocked.find((b) => b.op.recordId === paiement.id)?.reason).toBe('financial_policy');
    expect(cloud.docs.get(paiement.id)!.body.montant).toBe(25000);
    const status = await engineStatus();
    expect(status.states[paiement.id]).toBe('pending'); // retenu : visible comme en attente, jamais comme synchronisé
    expect(bannerModel(status).tone).toBe('pending');
  });
});

describe('Réutilisation de l’interface existante', () => {
  it('les états produits sont exactement ceux de l’interface actuelle ; aucun composant n’est modifié ; le module n’est importé que par les tests', () => {
    const root = path.join(__dirname, '..', '..');
    const view = fs.readFileSync(path.join(root, 'services/sync/syncStatusView.ts'), 'utf8');
    const legacy = fs.readFileSync(path.join(root, 'services/cloudSyncService.ts'), 'utf8');
    expect(legacy).toContain("export type DisplaySync = 'local' | 'pending' | 'synced' | 'conflict' | 'error';");
    expect(view).toContain("export type EngineDisplayState = 'local' | 'pending' | 'synced' | 'conflict' | 'error';");
    const badge = fs.readFileSync(path.join(root, 'components/immobilier/SyncBadge.tsx'), 'utf8');
    for (const key of ['local', 'pending', 'syncing', 'synced', 'conflict', 'error']) expect(badge).toContain(`${key}: {`);
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.git', '.expo', 'android', 'ios', '__tests__'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const users = walk(root).filter((f) => !f.includes(`${path.sep}services${path.sep}sync${path.sep}`) && /sync\/(syncStatusView|conflictView)['"]/.test(fs.readFileSync(f, 'utf8')));
    // seule la façade d'affichage (services/syncDisplay.ts) lit les états et les conflits du moteur
    expect(users.map((f) => path.relative(root, f).replace(/\\/g, '/'))).toEqual(['services/syncDisplay.ts']);
  });
});
