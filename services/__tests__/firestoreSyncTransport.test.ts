// P4 — transports de synchronisation et de réception, testés avec un backend EN MÉMOIRE (aucun SDK Firebase, aucun réseau, aucun
// compte). Le backend applique un MODÈLE des invariants des règles ; les vraies règles sont vérifiées par les tests d'émulateur et du
// projet de test (non exécutés ici).

import { createFirestoreSyncTransport } from '../firebase/firestoreSyncTransport';
import {
  changeFromDoc,
  checkFirestoreCompat,
  cloudFinancialKinds,
  cloudKinds,
  decodeCursor,
  encodeCursor,
  FIRESTORE_LIMITS,
  hashOfDoc,
  toTransportError,
  type CloudSyncDoc,
} from '../firebase/syncDocModel';
import { KIND, type Kind } from '../sync/kindRegistry';
import { SYNC_SCOPE_V1 } from '../sync/syncScope';
import { SyncTransportError, type PushRequest } from '../sync/syncEngine';
import { contentHash, type WireRecord } from '../sync/wireFormat';
import { createMemoryCloud, modelRules, RulesModelViolation } from './helpers/syncCloudMemory';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined, clear: async () => undefined, getAllKeys: async () => [] },
}));

const UID = 'alice';
const T = new Date('2026-10-19T10:00:00.000Z');

const wire = (id: string, over: Partial<WireRecord> = {}): WireRecord => ({
  id,
  kind: KIND.IMMOBILIER_BIEN,
  schemaVersion: 1,
  ownerUid: UID,
  statusKey: null,
  createdAt: '2026-10-19T09:00:00.000Z',
  updatedAt: '2026-10-19T09:00:00.000Z',
  body: { nom: 'Maison', adresse: 'Lomé' },
  refs: {},
  ...over,
});

let counter = 0;
const request = (op: PushRequest['op'], w: WireRecord | null, over: Partial<PushRequest> = {}): PushRequest => ({
  opId: `op-${(counter += 1)}`,
  recordId: w?.id ?? 'x',
  kind: w?.kind ?? KIND.IMMOBILIER_BIEN,
  op,
  expectedRev: op === 'create' ? null : 1,
  deletedAt: op === 'delete' ? T.toISOString() : null,
  wire: op === 'delete' ? null : w,
  ...over,
});

function setup(options: { tie?: boolean; overlapMs?: number } = {}) {
  const cloud = createMemoryCloud({ uid: UID, tieTimestamps: options.tie });
  const make = () => createFirestoreSyncTransport({ backend: cloud.backend, uid: UID, now: () => T, overlapMs: options.overlapMs });
  return { cloud, transport: make(), make };
}
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'erreur');

// ============================================================================================================================
describe('Modèle des documents', () => {
  it('les types du cloud et les faits financiers reflètent exactement le registre', () => {
    expect([...cloudKinds()].sort()).toEqual([...SYNC_SCOPE_V1].sort()); // la liste blanche V1 (Immobilier seul), pas les 19 types du registre
    expect(cloudKinds()).toHaveLength(7);
    expect([...cloudFinancialKinds()].sort()).toEqual([KIND.IMMOBILIER_CORRECTION_PAIEMENT, KIND.IMMOBILIER_PAIEMENT].sort());
  });

  it('contraintes réelles de Firestore : tableaux imbriqués, valeurs indéfinies, noms réservés, profondeur, taille, identifiants', () => {
    expect(checkFirestoreCompat(wire('ok'))).toEqual([]);
    expect(checkFirestoreCompat(wire('a', { body: { m: [[1], [2]] } })).join()).toContain('tableau imbriqué');
    expect(checkFirestoreCompat(wire('a', { body: { m: [{ x: [1, 2] }] } }))).toEqual([]); // tableau dans une carte dans un tableau : admis
    expect(checkFirestoreCompat(wire('a', { body: { x: undefined } as never })).join()).toContain('indéfinie');
    expect(checkFirestoreCompat(wire('a', { body: { __nom__: 1 } })).join()).toContain('réservé');
    expect(checkFirestoreCompat(wire('a', { body: { '': 1 } })).join()).toContain('vide');
    expect(checkFirestoreCompat(wire('a', { body: { n: Infinity } })).join()).toContain('non fini');
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < FIRESTORE_LIMITS.maxMapDepth + 2; i += 1) deep = { d: deep };
    expect(checkFirestoreCompat(wire('a', { body: deep })).join()).toContain('profondeur');
    expect(checkFirestoreCompat(wire('a', { body: { gros: 'x'.repeat(FIRESTORE_LIMITS.softMaxDocBytes + 1) } })).join()).toContain('volumineux');
    expect(checkFirestoreCompat(wire('a', { body: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, i])) })).join()).toContain('champs');
    for (const bad of ['', '.', '..', 'a/b', '__x__']) expect(checkFirestoreCompat(wire(bad)).join()).toContain('identifiant');
    expect(checkFirestoreCompat(wire('é'.repeat(800))).join()).toContain('identifiant'); // plus de 1500 octets
  });

  it('curseur : aller-retour, refus d’un curseur illisible', () => {
    const position = { t: '2026-10-19T10:00:00.123Z', id: 'rec|avec|barres' };
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
    expect(decodeCursor(null)).toBeNull();
    for (const bad of ['', 'x', 'v1|pas-une-date|a', 'v2|2026-10-19T10:00:00.000Z|a']) expect(() => decodeCursor(bad)).toThrow(SyncTransportError);
  });

  it('erreurs du SDK : réseau, permission, argument invalide, inconnue', () => {
    const of = (c: string, m = 'x') => toTransportError(Object.assign(new Error(m), { code: c })).code;
    expect(of('unavailable')).toBe('network');
    expect(of('firestore/deadline-exceeded')).toBe('network');
    expect(of('aborted')).toBe('network');
    expect(of('permission-denied')).toBe('permission');
    expect(of('unauthenticated')).toBe('permission');
    expect(of('invalid-argument')).toBe('invalid');
    expect(of('', 'Network request failed')).toBe('network');
    expect(of('autre')).toBe('unknown');
    expect(toTransportError(new SyncTransportError('conflict', 'c')).code).toBe('conflict');
    expect(toTransportError(Object.assign(new Error('secret'), { code: 'permission-denied' })).message).not.toContain('secret');
  });

  it('document → changement : suppression, contenu, document malformé', () => {
    const doc = { kind: KIND.IMMOBILIER_BIEN, schemaVersion: 1, ownerUid: UID, statusKey: null, createdAt: 'a', updatedAt: 'b', body: { nom: 'M' }, refs: {}, rev: 3, deleted: false, deletedAt: null, restoredAt: null, lastOpId: 'o', serverUpdatedAt: 'x' } as CloudSyncDoc;
    expect(changeFromDoc('r1', doc)).toMatchObject({ id: 'r1', rev: 3, deleted: false, wire: { id: 'r1', kind: KIND.IMMOBILIER_BIEN, body: { nom: 'M' } } });
    expect(changeFromDoc('r1', { ...doc, deleted: true, deletedAt: 'd' })).toEqual({ id: 'r1', kind: KIND.IMMOBILIER_BIEN, rev: 3, deleted: true, deletedAt: 'd', wire: null });
    expect(changeFromDoc('r1', { ...doc, body: 'cassé' as never }).wire).toBeNull();
    expect(changeFromDoc('r1', { kind: 5 as never, rev: 'x' as never })).toMatchObject({ rev: 0, kind: '', wire: null });
    expect(hashOfDoc(doc)).toBe(contentHash(wire('r1', { body: { nom: 'M' } })));
  });
});

// ============================================================================================================================
describe('Envoi : création, modification, suppression logique, restauration', () => {
  it('création : révision 1, tous les champs, horodatage serveur, propriétaire du compte', async () => {
    const { cloud, transport } = setup();
    expect(await transport.push(request('create', wire('b1')))).toEqual({ rev: 1 });
    const doc = cloud.docs.get('b1')!;
    expect(doc).toMatchObject({ kind: KIND.IMMOBILIER_BIEN, ownerUid: UID, rev: 1, deleted: false, deletedAt: null, restoredAt: null, body: { nom: 'Maison' } });
    expect(doc.serverUpdatedAt).toMatch(/^2026-10-19T/);
    expect(Object.keys(doc).sort()).toEqual(['body', 'createdAt', 'deleted', 'deletedAt', 'kind', 'lastOpId', 'ownerUid', 'refs', 'restoredAt', 'rev', 'schemaVersion', 'serverUpdatedAt', 'statusKey', 'updatedAt']);
  });

  it('modification : révision +1, date de création conservée ; mauvaise révision, document absent, création en double : conflits', async () => {
    const { cloud, transport } = setup();
    await transport.push(request('create', wire('b1')));
    expect(await transport.push(request('update', wire('b1', { body: { nom: 'Villa' }, createdAt: 'autre', updatedAt: 'u2' })))).toEqual({ rev: 2 });
    expect(cloud.docs.get('b1')).toMatchObject({ rev: 2, body: { nom: 'Villa' }, createdAt: '2026-10-19T09:00:00.000Z', updatedAt: 'u2' });
    expect(await code(transport.push(request('update', wire('b1'), { expectedRev: 1 })))).toBe('conflict');
    expect(await code(transport.push(request('update', wire('absent'), { expectedRev: 1 })))).toBe('conflict');
    expect(await code(transport.push(request('create', wire('b1'))))).toBe('conflict');
    expect(cloud.docs.get('b1')!.rev).toBe(2);
  });

  it('idempotence : réponse perdue après validation → même opId rejoué sans nouvelle écriture (création, modification, suppression)', async () => {
    const { cloud, transport } = setup();
    const create = request('create', wire('b1'));
    cloud.fail.lostResponse();
    expect(await code(transport.push(create))).toBe('network');
    expect(cloud.docs.get('b1')!.rev).toBe(1);
    const before = cloud.commits();
    expect(await transport.push(create)).toEqual({ rev: 1 });
    expect(cloud.commits()).toBe(before);

    const update = request('update', wire('b1', { body: { nom: 'V2' } }), { expectedRev: 1 });
    cloud.fail.lostResponse();
    expect(await code(transport.push(update))).toBe('network');
    expect(await transport.push(update)).toEqual({ rev: 2 });
    expect(cloud.docs.get('b1')!.rev).toBe(2);

    const del = request('delete', null, { recordId: 'b1', expectedRev: 2 });
    cloud.fail.lostResponse();
    expect(await code(transport.push(del))).toBe('network');
    expect(await transport.push(del)).toEqual({ rev: 3 });
    expect(cloud.docs.get('b1')).toMatchObject({ rev: 3, deleted: true });
  });

  it('une panne avant validation n’écrit rien ; le renvoi réussit', async () => {
    const { cloud, transport } = setup();
    const create = request('create', wire('b1'));
    cloud.fail.beforeCommit();
    expect(await code(transport.push(create))).toBe('network');
    expect(cloud.docs.size).toBe(0);
    expect(await transport.push(create)).toEqual({ rev: 1 });
  });

  it('suppression LOGIQUE : le contenu reste ; plus aucune modification ; rejouer le même opId est sans effet, un autre opId est un conflit', async () => {
    const { cloud, transport } = setup();
    await transport.push(request('create', wire('b1')));
    const del = request('delete', null, { recordId: 'b1', expectedRev: 1 });
    expect(await transport.push(del)).toEqual({ rev: 2 });
    expect(cloud.docs.get('b1')).toMatchObject({ deleted: true, deletedAt: T.toISOString(), body: { nom: 'Maison' }, rev: 2 });
    expect(await transport.push(del)).toEqual({ rev: 2 });
    expect(await code(transport.push(request('delete', null, { recordId: 'b1', expectedRev: 2 })))).toBe('conflict');
    expect(await code(transport.push(request('update', wire('b1'), { expectedRev: 2 })))).toBe('conflict');
    expect(await code(transport.push(request('delete', null, { recordId: 'absent', expectedRev: 1 })))).toBe('conflict');
  });

  it('restauration explicite : à la bonne révision, contenu intact, trace de restauration ; sinon conflit', async () => {
    const { cloud, transport } = setup();
    await transport.push(request('create', wire('b1')));
    expect(await code(transport.restore({ opId: 'r-0', recordId: 'b1', kind: KIND.IMMOBILIER_BIEN, expectedRev: 1 }))).toBe('conflict'); // pas supprimé
    await transport.push(request('delete', null, { recordId: 'b1', expectedRev: 1 }));
    expect(await code(transport.restore({ opId: 'r-1', recordId: 'b1', kind: KIND.IMMOBILIER_BIEN, expectedRev: 1 }))).toBe('conflict'); // mauvaise révision
    const restore = { opId: 'r-2', recordId: 'b1', kind: KIND.IMMOBILIER_BIEN, expectedRev: 2 };
    expect(await transport.restore(restore)).toEqual({ rev: 3 });
    expect(cloud.docs.get('b1')).toMatchObject({ deleted: false, deletedAt: null, restoredAt: T.toISOString(), body: { nom: 'Maison' }, rev: 3 });
    expect(await transport.restore(restore)).toEqual({ rev: 3 }); // idempotent
    expect(await transport.push(request('update', wire('b1', { body: { nom: 'Après' } }), { expectedRev: 3 }))).toEqual({ rev: 4 });
    expect(cloud.docs.get('b1')!.restoredAt).toBe(T.toISOString()); // la trace reste
    expect(await code(transport.restore({ ...restore, opId: 'r-3', recordId: 'absent' }))).toBe('conflict');
  });

  it('faits financiers : création seulement, jamais modifiés, supprimés ni restaurés', async () => {
    const { cloud, transport } = setup();
    const paiement = wire('p1', { kind: KIND.IMMOBILIER_PAIEMENT, body: { montant: 25000 } });
    expect(await transport.push(request('create', paiement))).toEqual({ rev: 1 });
    expect(await code(transport.push(request('update', paiement, { expectedRev: 1 })))).toBe('invalid');
    expect(await code(transport.push(request('delete', null, { recordId: 'p1', kind: KIND.IMMOBILIER_PAIEMENT, expectedRev: 1 })))).toBe('invalid');
    expect(await code(transport.restore({ opId: 'r', recordId: 'p1', kind: KIND.IMMOBILIER_PAIEMENT, expectedRev: 1 }))).toBe('invalid');
    expect(cloud.docs.get('p1')).toMatchObject({ rev: 1, body: { montant: 25000 }, deleted: false });
    // même en contournant le transport, le modèle des règles refuse
    const prev = cloud.docs.get('p1')!;
    const { serverUpdatedAt: _s, ...write } = prev;
    void _s;
    expect(() => modelRules(UID, prev, { ...write, rev: 2, body: { montant: 1 } })).toThrow(RulesModelViolation);
    expect(() => modelRules(UID, prev, { ...write, rev: 2, deleted: true, deletedAt: 'x' })).toThrow(RulesModelViolation);
    for (const kind of [KIND.IMMOBILIER_CORRECTION_PAIEMENT]) {
      const w = wire(`f-${kind}`, { kind });
      expect(await transport.push(request('create', w))).toEqual({ rev: 1 });
      expect(await code(transport.push(request('update', w, { expectedRev: 1 })))).toBe('invalid');
    }
  });

  it('refus avant toute lecture : autre propriétaire, contenu incohérent, type local, type inconnu, contenu non envoyable, opération sans jeton', async () => {
    const { cloud, transport } = setup();
    const w = wire('b1');
    const cases: [string, PushRequest][] = [
      ['autre propriétaire', request('create', wire('b1', { ownerUid: 'bob' }))],
      ['identifiant différent', request('create', w, { recordId: 'autre' })],
      ['type différent', request('create', w, { kind: KIND.IMMOBILIER_LOGEMENT })],
      ['type local', request('create', wire('o1', { kind: KIND.CORE_OUTIL }), { kind: KIND.CORE_OUTIL })],
      ['type inconnu', request('create', w, { kind: 'x.y' as Kind })],
      ['non envoyable', request('create', wire('b2', { body: { m: [[1]] } }))],
      ['sans contenu', request('create', null, { recordId: 'b1' })],
      ['sans jeton', request('create', w, { opId: '' })],
      ['identifiant avec barre', request('delete', null, { recordId: 'a/b', expectedRev: 1 })],
    ];
    for (const [label, req] of cases) expect([label, await code(transport.push(req))]).toEqual([label, 'invalid']);
    expect(cloud.log).toEqual([]); // aucun accès au cloud
    expect(() => createFirestoreSyncTransport({ backend: cloud.backend, uid: '' })).toThrow(SyncTransportError);
  });

  it('modèle des règles : une écriture que les règles refuseraient est détectée (propriétaire, révision, transitions)', async () => {
    const cloud = createMemoryCloud({ uid: UID });
    const transport = createFirestoreSyncTransport({ backend: cloud.backend, uid: UID, now: () => T });
    await transport.push(request('create', wire('b1')));
    const prev = cloud.docs.get('b1')!;
    const { serverUpdatedAt: _s, ...base } = prev;
    void _s;
    expect(() => modelRules(UID, prev, { ...base, rev: 3 })).toThrow(/révision/);
    expect(() => modelRules(UID, prev, { ...base, rev: 2, kind: KIND.IMMOBILIER_LOGEMENT })).toThrow();
    expect(() => modelRules(UID, prev, { ...base, rev: 2, ownerUid: 'bob' })).toThrow(/propriétaire/);
    expect(() => modelRules(UID, prev, { ...base, rev: 2, deleted: true, deletedAt: 'x', body: { nom: 'réécrit' } })).toThrow(/suppression logique/);
    expect(() => modelRules(UID, prev, { ...base, rev: 2, restoredAt: 'x' })).toThrow();
    expect(() => modelRules(UID, null, { ...base, rev: 5 })).toThrow(/création/);
    expect(() => modelRules('bob', null, { ...base, rev: 1 })).toThrow(/propriétaire/);
  });

  it('écriture concurrente d’un autre appareil entre la lecture et la validation : relecture, puis conflit — jamais d’écrasement', async () => {
    const { cloud, transport } = setup();
    await transport.push(request('create', wire('b1')));
    cloud.concurrentWrite((docs) => {
      const d = docs.get('b1')!;
      docs.set('b1', { ...d, rev: 2, body: { nom: 'Autre appareil' }, lastOpId: 'autre' });
    });
    expect(await code(transport.push(request('update', wire('b1', { body: { nom: 'Moi' } }), { expectedRev: 1 })))).toBe('conflict');
    expect(cloud.docs.get('b1')).toMatchObject({ rev: 2, body: { nom: 'Autre appareil' } });
  });
});

// ============================================================================================================================
describe('Lecture d’un document et lecture par pages', () => {
  it('read : révision, empreinte du contenu, suppression ; absent → null', async () => {
    const { transport } = setup();
    const w = wire('b1');
    await transport.push(request('create', w));
    expect(await transport.read(KIND.IMMOBILIER_BIEN, 'b1')).toEqual({ rev: 1, hash: contentHash(w), deleted: false });
    await transport.push(request('delete', null, { recordId: 'b1', expectedRev: 1 }));
    expect(await transport.read(KIND.IMMOBILIER_BIEN, 'b1')).toEqual({ rev: 2, hash: contentHash(w), deleted: true });
    expect(await transport.read(KIND.IMMOBILIER_BIEN, 'absent')).toBeNull();
    await expect(transport.read('x.y' as Kind, 'b1')).rejects.toBeInstanceOf(SyncTransportError);
  });

  it('pages : ordre du serveur, curseur, hasMore, reprise sans doublon', async () => {
    const { transport, make } = setup({ overlapMs: 0 });
    for (const id of ['a', 'b', 'c', 'd', 'e']) await transport.push(request('create', wire(id)));
    const reader = make();
    const first = await reader.pull({ cursor: null, limit: 2 });
    expect(first.changes.map((c) => c.id)).toEqual(['a', 'b']);
    expect(first.hasMore).toBe(true);
    const second = await reader.pull({ cursor: first.nextCursor, limit: 2 });
    expect(second.changes.map((c) => c.id)).toEqual(['c', 'd']);
    const third = await reader.pull({ cursor: second.nextCursor, limit: 2 });
    expect(third.changes.map((c) => c.id)).toEqual(['e']);
    expect(third.hasMore).toBe(false);
    const idle = await reader.pull({ cursor: third.nextCursor, limit: 2 });
    expect(idle).toMatchObject({ changes: [], hasMore: false, nextCursor: third.nextCursor });
  });

  it('horodatages égaux : départage par identifiant, rien n’est manqué ni lu deux fois', async () => {
    const { transport, make } = setup({ tie: true, overlapMs: 0 });
    for (const id of ['c', 'a', 'b']) await transport.push(request('create', wire(id)));
    const reader = make();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i += 1) {
      const page = await reader.pull({ cursor, limit: 1 });
      seen.push(...page.changes.map((c) => c.id));
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('recouvrement : la première page d’une instance relit un peu en arrière (idempotent), les suivantes sont strictes', async () => {
    const { cloud, transport, make } = setup({ overlapMs: 60_000 });
    for (const id of ['a', 'b', 'c']) await transport.push(request('create', wire(id)));
    const all = await make().pull({ cursor: null, limit: 10 });
    const cursorAtB = encodeCursor({ t: cloud.docs.get('b')!.serverUpdatedAt, id: 'b' });
    const reader = make();
    const overlapped = await reader.pull({ cursor: cursorAtB, limit: 10 });
    expect(overlapped.changes.map((c) => c.id)).toEqual(['a', 'b', 'c']); // a et b relus
    const strict = await reader.pull({ cursor: all.nextCursor, limit: 10 });
    expect(strict.changes).toEqual([]);
  });

  it('recouvrement saturé (plus de documents dans la fenêtre que dans une page) : la lecture avance quand même, jamais de blocage', async () => {
    const { cloud, transport, make } = setup({ overlapMs: 60_000 });
    for (const id of ['a', 'b', 'c']) await transport.push(request('create', wire(id)));
    const cursor = encodeCursor({ t: cloud.docs.get('c')!.serverUpdatedAt, id: 'c' }); // tout est déjà lu
    const idle = await make().pull({ cursor, limit: 1 });
    expect(idle.changes).toEqual([]); // la fenêtre (a, b, c) sature la page : lecture stricte après le curseur
    expect(idle.nextCursor).toBe(cursor);
    await transport.push(request('create', wire('d')));
    const fresh = await make().pull({ cursor, limit: 1 });
    expect(fresh.changes.map((c) => c.id)).toEqual(['d']); // le nouveau document est reçu malgré une fenêtre saturée
  });

  it('suppression, restauration et document malformé arrivent comme changements exploitables', async () => {
    const { cloud, transport, make } = setup({ overlapMs: 0 });
    await transport.push(request('create', wire('a')));
    await transport.push(request('create', wire('b')));
    await transport.push(request('delete', null, { recordId: 'b', expectedRev: 1 }));
    cloud.docs.set('c', { ...cloud.docs.get('a')!, body: 3 as never, serverUpdatedAt: '2026-10-19T09:59:00.000Z' });
    const page = await make().pull({ cursor: null, limit: 10 });
    const byId = Object.fromEntries(page.changes.map((c) => [c.id, c]));
    expect(byId.a).toMatchObject({ deleted: false, rev: 1, wire: { id: 'a' } });
    expect(byId.b).toMatchObject({ deleted: true, rev: 2, wire: null, deletedAt: T.toISOString() });
    expect(byId.c.wire).toBeNull();
  });

  it('erreurs de lecture : réseau ; curseur illisible', async () => {
    const { cloud, make } = setup();
    cloud.fail.reads(1);
    expect(await code(make().pull({ cursor: null, limit: 5 }))).toBe('network');
    await expect(make().pull({ cursor: 'illisible', limit: 5 })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('aucune suppression physique dans le transport ordinaire ; un document d’un autre propriétaire n’est ni modifié, ni supprimé, ni restauré', async () => {
    const { cloud, transport } = setup();
    expect('purge' in transport).toBe(false);
    expect(Object.keys(cloud.backend).sort()).toEqual(['get', 'page', 'transaction']); // le port ordinaire ne sait pas supprimer
    await transport.push(request('create', wire('b1')));
    const stored = cloud.docs.get('b1')!;
    cloud.docs.set('b1', { ...stored, ownerUid: 'bob' }); // état anormal : document d'un autre compte dans l'espace
    expect(await code(transport.push(request('update', wire('b1'), { expectedRev: 1 })))).toBe('invalid');
    expect(await code(transport.push(request('delete', null, { recordId: 'b1', expectedRev: 1 })))).toBe('invalid');
    cloud.docs.set('b1', { ...stored, ownerUid: 'bob', deleted: true, deletedAt: 'x', rev: 2 });
    expect(await code(transport.restore({ opId: 'r-x', recordId: 'b1', kind: KIND.IMMOBILIER_BIEN, expectedRev: 2 }))).toBe('invalid');
    expect(cloud.docs.get('b1')).toMatchObject({ ownerUid: 'bob', deleted: true, rev: 2 });
  });

  it('espace verrouillé (effacement du compte) : plus aucune écriture de synchronisation, la lecture reste possible', async () => {
    const { cloud, transport } = setup();
    await transport.push(request('create', wire('b1')));
    cloud.space.locked = true;
    expect(await code(transport.push(request('create', wire('b2'))))).toBe('permission');
    expect(await code(transport.push(request('update', wire('b1'), { expectedRev: 1 })))).toBe('permission');
    expect(await code(transport.push(request('delete', null, { recordId: 'b1', expectedRev: 1 })))).toBe('permission');
    expect(await transport.read(KIND.IMMOBILIER_BIEN, 'b1')).toMatchObject({ rev: 1 });
    expect(cloud.docs.size).toBe(1);
  });

  it('un document sans horodatage serveur arrête la lecture (aucun curseur invalide n’est produit)', async () => {
    const { cloud, make } = setup({ overlapMs: 0 });
    await make().push(request('create', wire('a')));
    cloud.docs.set('a', { ...cloud.docs.get('a')!, serverUpdatedAt: '' });
    await expect(make().pull({ cursor: null, limit: 5 })).rejects.toMatchObject({ code: 'invalid' });
  });
});
