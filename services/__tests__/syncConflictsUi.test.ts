// Phase 6, étape 6 — consultation et résolution des conflits par la façade d'affichage (celle que l'écran utilise) : seules les décisions que le
// moteur accepte sont transmises, chaque refus est expliqué, l'historique conserve la version écartée, les suppressions récupérables se
// restaurent explicitement, et rien n'est envoyé au cloud par la décision elle-même.

import fs from 'fs';
import path from 'path';
import * as dbModule from '../db';
import { records } from '../db';
import { createBien, resetImmobilierToolCache } from '../immobilierService';
import { setActiveCloudUid } from '../cloudVisibility';
import { switchWorkspace } from '../persistence';
import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import { runInbound } from '../sync/inbound';
import { setSyncAccount } from '../sync/syncAccount';
import { __useActivationForTests } from '../sync/syncActivation';
import { captureLocalChanges, runOnce } from '../sync/syncEngine';
import { __useSyncScopeForTests } from '../sync/syncScope';
import { KIND } from '../sync/kindRegistry';
import { availableResolutions, decideConflict, listOpenConflicts, listRecoverableDeletions, listResolvedConflicts, restoreDeletion } from '../syncDisplay';
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

const EARLY = { enabledAt: '2000-01-01T00:00:00.000Z' };
const NOW = new Date('2026-10-22T12:00:00.000Z');
let cloud: MemoryCloud;

beforeEach(async () => {
  __useSyncScopeForTests(null);
  __useActivationForTests(false);
  await switchWorkspace('personal');
  mockMemory.clear();
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  setActiveCloudUid('alice');
  setSyncAccount('alice');
  cloud = createMemoryCloud({ uid: 'alice', start: new Date('2026-10-22T09:00:00.000Z') });
});

const transport = () => createFirestoreSyncTransport({ backend: cloud.backend, uid: 'alice', now: () => NOW, overlapMs: 0 });
const push = async () => (await captureLocalChanges({ scope: EARLY, now: NOW }), runOnce({ transport: transport(), ownerUid: 'alice', now: () => NOW, random: () => 0.5 }));
const pull = () => runInbound({ pull: transport(), ownerUid: 'alice', now: () => NOW });
const rec = (id: string) => records.find((r) => r.id === id) as unknown as { values: Record<string, unknown> };
const remoteEdit = (id: string, patch: Record<string, unknown>, at: string) => {
  const doc = cloud.docs.get(id)!;
  cloud.docs.set(id, { ...doc, rev: doc.rev + 1, body: { ...doc.body, ...patch }, lastOpId: 'autre', serverUpdatedAt: at });
};

describe('Consultation', () => {
  it('sans compte actif : rien n’est visible', async () => {
    setSyncAccount(null);
    expect(await listOpenConflicts()).toEqual([]);
    expect(await listRecoverableDeletions()).toEqual([]);
    expect(await listResolvedConflicts()).toEqual([]);
  });

  it('un conflit ouvert expose les deux versions, les champs en désaccord et les décisions permises', async () => {
    const a = await createBien({ nom: 'A', adresse: 'X' });
    await push();
    rec(a.id).values.nom = 'Locale';
    remoteEdit(a.id, { nom: 'Distante' }, '2026-10-22T09:30:00.000Z');
    await pull();
    const [conflict] = await listOpenConflicts();
    expect(conflict).toMatchObject({ recordId: a.id, type: 'both_modified', fields: ['nom'], financial: false });
    expect(conflict.local?.body.nom).toBe('Locale');
    expect(conflict.remote.wire?.body.nom).toBe('Distante');
    expect(conflict.options.keep_local.allowed && conflict.options.keep_remote.allowed && conflict.options.fields.allowed).toBe(true);
  });
});

describe('Décisions', () => {
  const conflictOn = async () => {
    const a = await createBien({ nom: 'A', adresse: 'X' });
    await push();
    rec(a.id).values.nom = 'Locale';
    remoteEdit(a.id, { nom: 'Distante' }, '2026-10-22T09:30:00.000Z');
    await pull();
    return a;
  };

  it('garder la version du cloud : la version locale écartée reste dans l’historique ; aucun envoi', async () => {
    const a = await conflictOn();
    const sent = cloud.log.length;
    expect(await decideConflict(a.id, { type: 'keep_remote' })).toEqual({ ok: true });
    expect(rec(a.id).values.nom).toBe('Distante');
    expect(await listOpenConflicts()).toEqual([]);
    const [resolved] = await listResolvedConflicts();
    expect(resolved).toMatchObject({ recordId: a.id, resolution: 'version distante conservée' });
    expect(resolved.discarded?.body.nom).toBe('Locale');
    expect(cloud.log.length).toBe(sent);
  });

  it('garder ma version : retenue pour l’envoi suivant, la version distante reste dans l’historique', async () => {
    const a = await conflictOn();
    expect(await decideConflict(a.id, { type: 'keep_local' })).toEqual({ ok: true });
    expect(rec(a.id).values.nom).toBe('Locale');
    const [resolved] = await listResolvedConflicts();
    expect(resolved.remote.wire?.body.nom).toBe('Distante');
    await push();
    expect(cloud.docs.get(a.id)?.body.nom).toBe('Locale'); // l'envoi se fait au cycle suivant, au-dessus de la révision distante
  });

  it('champ par champ : tous les champs en désaccord doivent être choisis, sinon refus expliqué', async () => {
    const a = await conflictOn();
    const incomplete = await decideConflict(a.id, { type: 'fields', picks: {} });
    expect(incomplete.ok).toBe(false);
    expect((await listOpenConflicts()).length).toBe(1); // rien n'a changé
    expect(await decideConflict(a.id, { type: 'fields', picks: { nom: 'remote' } })).toEqual({ ok: true });
    expect(rec(a.id).values.nom).toBe('Distante');
  });

  it('conflit inexistant ou déjà résolu : refus expliqué, rien n’est modifié', async () => {
    const a = await conflictOn();
    expect(await decideConflict('inconnu', { type: 'keep_local' })).toEqual({ ok: false, message: 'Ce conflit n’est plus ouvert.' });
    await decideConflict(a.id, { type: 'keep_remote' });
    expect(await decideConflict(a.id, { type: 'keep_local' })).toEqual({ ok: false, message: 'Ce conflit n’est plus ouvert.' });
    expect(rec(a.id).values.nom).toBe('Distante');
  });

  it('sans compte actif : aucune décision', async () => {
    const a = await conflictOn();
    setSyncAccount(null);
    expect((await decideConflict(a.id, { type: 'keep_remote' })).ok).toBe(false);
    expect(rec(a.id).values.nom).toBe('Locale');
  });
});

describe('Décisions refusées par le moteur : expliquées, jamais proposées', () => {
  it('suppression distante d’un fait financier : aucune décision permise, raison fournie', async () => {
    const options = availableResolutions({ type: 'financial_remote_delete', kind: KIND.IMMOBILIER_PAIEMENT, local: null, remote: { rev: 2, deleted: true, deletedAt: null, wire: null } });
    for (const name of ['keep_local', 'keep_remote', 'fields'] as const) {
      expect(options[name].allowed).toBe(false);
      expect(options[name].reason).toMatch(/\S/);
    }
  });
});

describe('Suppressions récupérables', () => {
  it('restauration explicite : l’élément revient localement ; un identifiant inconnu est refusé avec une explication', async () => {
    const b = await createBien({ nom: 'B', adresse: 'Y' });
    await push();
    const doc = cloud.docs.get(b.id)!;
    cloud.docs.set(b.id, { ...doc, rev: 2, deleted: true, deletedAt: 'x', lastOpId: 'autre', serverUpdatedAt: '2026-10-22T09:31:00.000Z' });
    await pull();
    expect((await listRecoverableDeletions()).map((d) => d.recordId)).toEqual([b.id]);
    expect(records.some((r) => r.id === b.id)).toBe(false);
    expect((await restoreDeletion('inconnu')).ok).toBe(false);
    expect(await restoreDeletion(b.id)).toEqual({ ok: true });
    expect(records.some((r) => r.id === b.id)).toBe(true);
  });
});

describe('Structure (écran et route)', () => {
  const root = path.join(__dirname, '..', '..');
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

  it('l’écran ne lit le moteur que par la façade, n’importe aucun transport et la route reste fermée avec le drapeau', () => {
    const screen = read('features/profile/screens/SyncConflictsScreen.tsx');
    expect(screen).not.toMatch(/services\/sync\/|firebase|runOnce|runInbound/);
    expect(screen).toContain("from '@/services/syncDisplay'");
    const route = read('app/account/conflicts.tsx');
    expect(route).toMatch(/CLOUD_ACCOUNT_ENABLED \?/);
    expect(route).toContain('<Redirect href="/(tabs)" />');
  });

  it('le drapeau cloud reste fermé', () => {
    expect(read('constants/features.ts')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
  });
});
