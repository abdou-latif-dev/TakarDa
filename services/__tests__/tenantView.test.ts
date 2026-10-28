// F3c — vue du locataire : projection côté propriétaire (aucun champ privé), publication par différences, lecture et copie locale côté locataire (accès
// actif seulement, retirée à la révocation, au départ ou à l'expiration), isolation entre locataires et entre comptes, et structure statique.
// Cloud en mémoire qui applique la politique de référence ; aucun SDK, aucun réseau.

import fs from 'fs';
import path from 'path';
import * as dbModule from '../db';
import { externalContacts, records } from '../db';
import { createBien, createLocataireEtContrat, enregistrerPaiementLoyer, ensureImmobilierTool, resetImmobilierToolCache, terminerContrat } from '../immobilierService';
import { setEmailVerified } from '../accountVerification';
import { snapshotCollections, switchWorkspace } from '../persistence';
import { recordCorrection } from '../sync/financialCorrection';
import { KIND } from '../sync/kindRegistry';
import { setSyncAccount } from '../sync/syncAccount';
import { buildTenantView, buildTenantViewForContract } from '../tenantViewBuilder';
import { createSharedModulesService, type ContractChoice } from '../sharedModulesService';
import { TENANT_BODY_FIELDS, TENANT_ITEM_KINDS, validateTenantItem } from '../sharedModules/model';
import { syncTenantView, canonicalJson } from '../sharedModules/tenantViewPublisher';
import { buildTenantReceiptText, toViewModel } from '../sharedModules/tenantViewModel';
import { copyGate } from '../sharedModules/tenantViewFlows';
import { createMemoryModulesCloud, type MemoryModulesCloud } from './helpers/modulesMemoryBackend';

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

const root = path.join(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const NOW = new Date(2026, 10, 20, 10, 0, 0); // 20 novembre 2026

/** Tout ce qui ne doit JAMAIS apparaître dans une vue de locataire (privé par décision). */
const PRIVATE = ['SECRET-NOTE-CONTRAT', 'CHAMP-PERSO-PRIVE', 'NOTE-PAIEMENT-PRIVEE', 'RAISON-CORRECTION-PRIVEE', 'RAISON-ANNULATION-PRIVEE', 'DEPENSE-PRIVEE', 'AUTRE-LOCATAIRE-NOM'];
/** Visibles depuis la décision du propriétaire du projet sur les points 4.3 (nom du bien, mode de paiement, e-mail et note du contact, nom du propriétaire, loyer de référence). */
const VISIBLE = ['IMMEUBLE-NOM-VISIBLE', 'MODE-VISIBLE-ESPECES', 'visible@x.test', 'NOTE-CONTACT-VISIBLE', 'PROPRIO-NOM-VISIBLE', '777777'];

let cloud: MemoryModulesCloud;
let clock: number;
const now = () => new Date(clock);

beforeEach(async () => {
  await switchWorkspace('personal');
  mockMemory.clear();
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
  clock = Date.parse('2026-11-20T10:00:00.000Z');
  cloud = createMemoryModulesCloud(now);
  as('alice');
});
afterEach(() => setSyncAccount(null));

function as(uid: string) {
  setSyncAccount(uid);
  setEmailVerified(uid, true);
}
const unwrap = <T,>(r: { ok: true; value: T } | { ok: false; message: string }): T => {
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

/** Un propriétaire réaliste : un bien, DEUX locataires, des paiements (un corrigé, un annulé), une dépense, et des champs privés partout. */
async function seedOwner() {
  const bien = await createBien({ nom: 'IMMEUBLE-NOM-VISIBLE', adresse: '12 rue du Marché, Lomé' });
  const first = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre 1', type: 'Chambre simple', cuisine: 'Interne', wc: 'Externe' }, nom: 'Koffi Mensah', telephone: '90123456', loyerMensuel: 30000, caution: 60000, avance: 90000, jourEcheance: 5, dateEntree: new Date(2026, 7, 5), dernierLoyerPaye: '2026-07' });
  const second = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre 2' }, nom: 'AUTRE-LOCATAIRE-NOM', telephone: '91234567', loyerMensuel: 45000, jourEcheance: 10, dateEntree: new Date(2026, 8, 1), dernierLoyerPaye: '2026-08' });
  const p1 = await enregistrerPaiementLoyer(first.contrat.id, new Date(2026, 8, 6)); // août
  const p2 = await enregistrerPaiementLoyer(first.contrat.id, new Date(2026, 9, 6)); // septembre
  const other = await enregistrerPaiementLoyer(second.contrat.id, new Date(2026, 9, 11));
  // champs privés partout
  const find = (id: string) => records.find((r) => r.id === id) as unknown as { values: Record<string, unknown> };
  find(first.contrat.id).values.notes_privees = 'SECRET-NOTE-CONTRAT';
  find(first.contrat.id).values.champ_perso = 'CHAMP-PERSO-PRIVE';
  find(first.logement.id).values.loyer_reference = 777777;
  find(p1.id).values.mode_paiement = 'MODE-VISIBLE-ESPECES';
  find(p1.id).values.note = 'NOTE-PAIEMENT-PRIVEE';
  const contact = externalContacts.find((c) => c.id === first.contact.id) as unknown as { email?: string; note?: string };
  contact.email = 'visible@x.test';
  contact.note = 'NOTE-CONTACT-VISIBLE';
  const ents = await ensureImmobilierTool();
  records.push({ id: 'dep1', toolId: ents.tool.id, entityDefinitionId: ents.depense.id, values: { bien: bien.id, libelle: 'DEPENSE-PRIVEE', montant: 5000, date: '2026-09-15' }, createdBy: 'u-me', createdAt: '2026-09-15T08:00:00.000Z', updatedAt: '2026-09-15T08:00:00.000Z' } as never);
  await recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: p1.id, type: 'correction', reason: 'RAISON-CORRECTION-PRIVEE', correctedAmount: 28000 });
  await recordCorrection({ kind: KIND.IMMOBILIER_CORRECTION_PAIEMENT, targetId: p2.id, type: 'annulation', reason: 'RAISON-ANNULATION-PRIVEE' });
  return { bien, first, second, p1, p2, other };
}

const body = (items: { id: string; kind: string; body: Record<string, unknown> }[], id: string) => items.find((i) => i.id === id)?.body;

// ============================================================================================================================
describe('Projection : ce que le propriétaire publie pour un locataire', () => {
  it('uniquement les champs autorisés : aucun champ privé, jamais (notes libres, raisons, champs personnalisés, dépenses, autres locataires)', async () => {
    const { first } = await seedOwner();
    const items = (await buildTenantViewForContract(first.contrat.id, NOW, 'PROPRIO-NOM-VISIBLE'))!;
    const text = JSON.stringify(items);
    for (const secret of PRIVATE) expect({ secret, leaked: text.includes(secret) }).toEqual({ secret, leaked: false });
    // chaque élément est valide : type connu et champs de la liste blanche de CE type
    for (const item of items) {
      expect({ id: item.id, problems: validateTenantItem({ kind: item.kind, body: item.body, rev: 1, updatedAt: 'x' }) }).toEqual({ id: item.id, problems: [] });
      for (const key of Object.keys(item.body)) expect(TENANT_BODY_FIELDS[item.kind]).toContain(key);
    }
    expect(new Set(items.map((i) => i.kind)).size).toBeGreaterThan(3);
    // décision du propriétaire du projet (points 4.3) : ces informations SONT visibles
    for (const visible of VISIBLE) expect({ visible, shown: text.includes(visible) }).toEqual({ visible, shown: true });
    expect(body(items, 'contrat')).toMatchObject({ locataireEmail: 'visible@x.test', locataireNote: 'NOTE-CONTACT-VISIBLE', proprietaireNom: 'PROPRIO-NOM-VISIBLE' });
    expect(body(items, 'logement')).toMatchObject({ nomBien: 'IMMEUBLE-NOM-VISIBLE', loyerReference: 777777 });
    expect(items.find((i) => i.kind === 'paiement' && i.body.modePaiement)?.body.modePaiement).toBe('MODE-VISIBLE-ESPECES');
  });

  it('sans nom de propriétaire renseigné (profil par défaut), le champ est simplement absent', async () => {
    const { first } = await seedOwner();
    expect(body((await buildTenantViewForContract(first.contrat.id, NOW, null))!, 'contrat')).not.toHaveProperty('proprietaireNom');
  });

  it('le contenu utile y est : contrat, logement avec adresse du bien, paiements effectifs, avance, retards expliqués, historique de SON contrat', async () => {
    const { first, p1, p2 } = await seedOwner();
    const items = (await buildTenantViewForContract(first.contrat.id, NOW))!;
    expect(body(items, 'contrat')).toMatchObject({ statut: 'actif', locataireNom: 'Koffi Mensah', locataireTelephone: '90123456', loyerMensuel: 30000, dateEntree: '2026-08-05', jourEcheance: 5, caution: 60000, avance: 90000 });
    expect(body(items, 'logement')).toEqual({ nom: 'Chambre 1', type: 'Chambre simple', cuisine: 'Interne', wc: 'Externe', adresse: '12 rue du Marché, Lomé', nomBien: 'IMMEUBLE-NOM-VISIBLE', loyerReference: 777777 });
    // paiement corrigé : montant effectif ; paiement annulé : « rejeté » SANS motif
    expect(body(items, `paiement_${p1.id.replace(/[^A-Za-z0-9_-]/g, '_')}`)).toMatchObject({ mois: '2026-08', montant: 28000, statut: 'paye' });
    expect(body(items, `paiement_${p2.id.replace(/[^A-Za-z0-9_-]/g, '_')}`)).toMatchObject({ mois: '2026-09', statut: 'rejete' });
    expect(body(items, `paiement_${p2.id.replace(/[^A-Za-z0-9_-]/g, '_')}`)).not.toHaveProperty('reference');
    expect(body(items, 'avance')).toEqual({ montant: 90000, consomme: 0, disponible: 90000, moisCouverts: [] });
    expect(body(items, 'retards')).toEqual({ fiable: true, mois: ['2026-09', '2026-10'], jourEcheance: 5, calculeLe: '2026-11-20' });
    const events = items.filter((i) => i.kind === 'evenement').map((i) => i.body.type);
    expect(events.sort()).toEqual(['contrat_cree', 'loyer_enregistre']); // l'annulation n'est pas un « loyer enregistré » ; aucun résumé brut du journal
  });

  it('chaque locataire ne reçoit que SES données : la vue de l’un ne contient rien de l’autre', async () => {
    const { first, second } = await seedOwner();
    const a = JSON.stringify(await buildTenantViewForContract(first.contrat.id, NOW));
    const b = JSON.stringify(await buildTenantViewForContract(second.contrat.id, NOW));
    expect(a).not.toContain('AUTRE-LOCATAIRE-NOM');
    expect(a).not.toContain('91234567');
    expect(b).not.toContain('Koffi');
    expect(b).not.toContain('90123456');
    expect(b).toContain('AUTRE-LOCATAIRE-NOM');
    expect(JSON.stringify(await buildTenantViewForContract(first.contrat.id, NOW))).toBe(a); // déterministe
  });

  it('retards : affichés seulement si le calcul est fiable et explicable ; sinon rien n’est affirmé', async () => {
    const bien = await createBien({ nom: 'B', adresse: 'Adresse' });
    const sansJour = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'L1' }, nom: 'Ama', telephone: '90123456', loyerMensuel: 20000, dateEntree: new Date(2026, 7, 5), dernierLoyerPaye: '2026-07' });
    expect(body((await buildTenantViewForContract(sansJour.contrat.id, NOW))!, 'retards')).toEqual({ fiable: false, mois: [], calculeLe: '2026-11-20' });
    const complet = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'L2' }, nom: 'Lea', telephone: '90123457', loyerMensuel: 20000, jourEcheance: 3, dateEntree: new Date(2026, 7, 5), dernierLoyerPaye: '2026-07' });
    expect(body((await buildTenantViewForContract(complet.contrat.id, NOW))!, 'retards')).toMatchObject({ fiable: true, jourEcheance: 3 });
    await terminerContrat(complet.contrat.id, new Date(2026, 10, 1));
    const ended = (await buildTenantViewForContract(complet.contrat.id, NOW))!;
    expect(body(ended, 'retards')).toMatchObject({ fiable: false, mois: [] }); // contrat terminé : plus de retard affirmé
    expect(body(ended, 'contrat')).toMatchObject({ statut: 'termine', dateSortie: '2026-11-01' });
    expect(ended.map((i) => i.body.type)).toContain('contrat_termine');
  });

  it('contrat introuvable : aucune vue', async () => {
    expect(await buildTenantViewForContract('inconnu', NOW)).toBeNull();
  });

  it('la projection est une fonction pure : mêmes entrées, mêmes éléments ; aucune donnée locale n’est modifiée', async () => {
    const { first } = await seedOwner();
    const before = JSON.stringify(snapshotCollections());
    await buildTenantViewForContract(first.contrat.id, NOW);
    expect(JSON.stringify(snapshotCollections())).toBe(before);
    expect(typeof buildTenantView).toBe('function');
  });
});

// ============================================================================================================================
describe('Publication par différences', () => {
  const item = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: 'logement' as const, body: { nom: id, ...over } });

  it('première publication : tout est écrit ; republication identique : rien ; un changement : seulement cet élément ; un élément disparu : retiré', async () => {
    cloud.modules['mod_aaaaaaaaaaaaaaaaaaaaaaaa'] = { ownerUid: 'alice', type: 'immobilier', name: 'A', createdAt: 'x', schemaVersion: 1 };
    cloud.members['mod_aaaaaaaaaaaaaaaaaaaaaaaa/koffi'] = { uid: 'koffi', role: 'locataire', state: 'active', contractId: 'c1', accessUntil: null, addedBy: 'alice', createdAt: 'x', updatedAt: 'x' };
    const deps = { backend: cloud.as('alice'), now };
    const M = 'mod_aaaaaaaaaaaaaaaaaaaaaaaa';
    let state = { items: {} as Record<string, { hash: string; rev: number }> };
    const persist = jest.fn(async (s: typeof state) => void (state = s));
    expect(await syncTenantView(deps, M, 'koffi', [item('a'), item('b')], state, persist)).toEqual({ written: 2, deleted: 0, unchanged: 0 });
    expect(await syncTenantView(deps, M, 'koffi', [item('a'), item('b')], state, persist)).toEqual({ written: 0, deleted: 0, unchanged: 2 });
    expect(await syncTenantView(deps, M, 'koffi', [item('a'), item('b', { type: 'Studio' })], state, persist)).toEqual({ written: 1, deleted: 0, unchanged: 1 });
    expect(state.items.b.rev).toBe(2);
    expect(state.items.a.rev).toBe(1);
    expect(await syncTenantView(deps, M, 'koffi', [item('a')], state, persist)).toEqual({ written: 0, deleted: 1, unchanged: 1 });
    expect(Object.keys(cloud.tenantItems)).toEqual([`${M}/koffi/a`]);
    expect(await syncTenantView(deps, M, 'koffi', [], state, persist)).toEqual({ written: 0, deleted: 1, unchanged: 0 });
    expect(Object.keys(cloud.tenantItems)).toEqual([]);
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });

  it('un élément invalide (champ privé, type inconnu) fait échouer AVANT toute écriture : rien n’est publié à moitié', async () => {
    const M = 'mod_aaaaaaaaaaaaaaaaaaaaaaaa';
    cloud.modules[M] = { ownerUid: 'alice', type: 'immobilier', name: 'A', createdAt: 'x', schemaVersion: 1 };
    const deps = { backend: cloud.as('alice'), now };
    const persist = jest.fn(async () => undefined);
    await expect(syncTenantView(deps, M, 'koffi', [item('a'), item('b', { notes: 'privé' })], { items: {} }, persist)).rejects.toThrow(/non autorisé/);
    await expect(syncTenantView(deps, M, 'koffi', [{ id: 'x', kind: 'depense' as never, body: {} }], { items: {} }, persist)).rejects.toThrow(/inconnu/);
    expect(cloud.writes).toEqual([]);
    expect(persist).not.toHaveBeenCalled();
  });
});

// ============================================================================================================================
describe('Parcours complet : propriétaire → cloud → locataire', () => {
  const MODULE = 'mod_aaaaaaaaaaaaaaaaaaaaaaaa';
  let contracts: ContractChoice[];
  const service = () =>
    createSharedModulesService({ enabled: () => true, backend: (uid: string) => cloud.as(uid), contracts: async () => contracts, now });

  async function setup() {
    const seeded = await seedOwner();
    contracts = [
      { id: seeded.first.contrat.id, label: 'Koffi', statusKey: 'actif', endDay: null },
      { id: seeded.second.contrat.id, label: 'Autre', statusKey: 'actif', endDay: null },
    ];
    // l'identifiant du module est fixé par le service de flux : on le crée directement, comme le fait le propriétaire
    cloud.modules[MODULE] = { ownerUid: 'alice', type: 'immobilier', name: 'Immeuble', createdAt: '2026-11-01T00:00:00.000Z', schemaVersion: 1 };
    for (const uid of ['koffi', 'ama']) {
      as(uid);
      unwrap(await service().requestAccess(uid, MODULE, uid));
    }
    as('alice');
    unwrap(await service().approve('alice', MODULE, 'koffi', seeded.first.contrat.id));
    unwrap(await service().approve('alice', MODULE, 'ama', seeded.second.contrat.id));
    return seeded;
  }
  /** Contenu publié pour un locataire (clé « module/uid/élément »). */
  const publishedFor = (uid: string) => JSON.stringify(Object.entries(cloud.tenantItems).filter(([k]) => k.startsWith(`${MODULE}/${uid}/`)));

  it('à l’approbation, la vue est publiée ; le locataire la lit, elle est gardée à part sur son appareil ; rien de privé n’a quitté l’appareil du propriétaire', async () => {
    await setup();
    const kofiItems = Object.keys(cloud.tenantItems).filter((k) => k.startsWith(`${MODULE}/koffi/`));
    expect(kofiItems.length).toBeGreaterThan(5);
    // chaque vue est vérifiée seule : celle d'Ama contient son propre nom (c'est SA vue) mais rien de privé, et celle de Koffi rien de celle d'Ama
    for (const secret of PRIVATE) expect({ secret, leaked: publishedFor('koffi').includes(secret) }).toEqual({ secret, leaked: false });
    for (const secret of PRIVATE.filter((p) => p !== 'AUTRE-LOCATAIRE-NOM')) expect({ secret, leaked: publishedFor('ama').includes(secret) }).toEqual({ secret, leaked: false });
    expect(publishedFor('ama')).not.toContain('Koffi');
    as('koffi');
    const state = unwrap(await service().refreshMyView('koffi', MODULE));
    expect(state.state).toBe('ok');
    if (state.state !== 'ok') return;
    expect(state.model.contrat).toMatchObject({ locataireNom: 'Koffi Mensah', loyerMensuel: 30000 });
    expect(state.model.logement?.adresse).toBe('12 rue du Marché, Lomé');
    expect(state.model.paiements.map((p) => [p.mois, p.statut])).toEqual([['2026-09', 'rejete'], ['2026-08', 'paye']]);
    expect(state.model.retards).toMatchObject({ fiable: true, mois: ['2026-09', '2026-10'] });
    expect(JSON.stringify(state.copy)).not.toContain('AUTRE-LOCATAIRE-NOM');
    // hors ligne : la copie locale reste lisible
    cloud.offline = true;
    const local = unwrap(await service().viewCopy('koffi', MODULE));
    expect(local.state).toBe('ok');
    cloud.offline = false;
    // la copie est rangée à part des données de l'application
    expect(Object.keys(snapshotCollections())).not.toContain('tenant_view_received');
    expect([...mockMemory.keys()].filter((k) => k.includes('tenant_view_received'))).toEqual(['@formease/tenant_view_received@koffi']);
  });

  it('un locataire ne voit jamais la vue d’un autre, n’écrit jamais, et ne lit pas les données du module', async () => {
    await setup();
    const koffi = cloud.as('koffi');
    await expect(koffi.listTenantItems(MODULE, 'ama')).rejects.toMatchObject({ code: 'permission' });
    await expect(koffi.putTenantItems(MODULE, 'koffi', [{ id: 'contrat', doc: { kind: 'contrat', body: { loyerMensuel: 1 }, rev: 9, updatedAt: 'x' } }])).rejects.toMatchObject({ code: 'permission' });
    await expect(koffi.deleteTenantItems(MODULE, 'koffi', ['contrat'])).rejects.toMatchObject({ code: 'permission' });
    await expect(koffi.listMembers(MODULE)).rejects.toMatchObject({ code: 'permission' });
    const own = await koffi.listTenantItems(MODULE, 'koffi');
    expect(JSON.stringify(own)).not.toContain('AUTRE-LOCATAIRE-NOM');
    const ama = await cloud.as('ama').listTenantItems(MODULE, 'ama');
    expect(JSON.stringify(ama)).toContain('AUTRE-LOCATAIRE-NOM');
    expect(JSON.stringify(ama)).not.toContain('Koffi');
  });

  it('révocation : la vue est retirée du cloud, la lecture est refusée, la copie locale du locataire est supprimée à l’actualisation', async () => {
    await setup();
    as('koffi');
    unwrap(await service().refreshMyView('koffi', MODULE));
    as('alice');
    unwrap(await service().revoke('alice', MODULE, 'koffi'));
    expect(Object.keys(cloud.tenantItems).filter((k) => k.startsWith(`${MODULE}/koffi/`))).toEqual([]); // plus rien à lire, même pour le locataire
    expect(Object.keys(cloud.tenantItems).some((k) => k.startsWith(`${MODULE}/ama/`))).toBe(true); // l'autre locataire n'est pas touché
    await expect(cloud.as('koffi').listTenantItems(MODULE, 'koffi')).rejects.toMatchObject({ code: 'permission' });
    as('koffi');
    expect(unwrap(await service().refreshMyView('koffi', MODULE))).toEqual({ state: 'unavailable', status: 'revoked' });
    expect(unwrap(await service().viewCopy('koffi', MODULE))).toEqual({ state: 'none' });
    expect([...mockMemory.entries()].filter(([k]) => k.includes('tenant_view_received')).every(([, v]) => !v.includes('Koffi'))).toBe(true);
    // rétablissement : la vue revient
    as('alice');
    unwrap(await service().reactivate('alice', MODULE, { uid: 'koffi', contractId: contracts[0].id }));
    as('koffi');
    expect(unwrap(await service().refreshMyView('koffi', MODULE)).state).toBe('ok');
  });

  it('départ du locataire : sa copie locale est supprimée ; fin d’accès (90 jours) : refus du cloud, copie retirée, et même hors ligne à l’heure de l’appareil', async () => {
    await setup();
    as('koffi');
    unwrap(await service().refreshMyView('koffi', MODULE));
    unwrap(await service().leave('koffi', MODULE));
    expect(unwrap(await service().viewCopy('koffi', MODULE))).toEqual({ state: 'none' });
    // amal : fin d'accès au 1er décembre ; l'appareil, hors ligne, cesse de montrer sa copie à cette heure
    as('alice');
    cloud.members[`${MODULE}/ama`] = { ...cloud.members[`${MODULE}/ama`], accessUntil: '2026-12-01T00:00:00.000Z' };
    as('ama');
    expect(unwrap(await service().refreshMyView('ama', MODULE)).state).toBe('ok');
    clock = Date.parse('2026-11-30T23:59:59.999Z');
    cloud.offline = true;
    expect(unwrap(await service().viewCopy('ama', MODULE)).state).toBe('ok');
    clock = Date.parse('2026-12-01T00:00:00.000Z');
    expect(unwrap(await service().viewCopy('ama', MODULE))).toEqual({ state: 'expired' });
    expect(unwrap(await service().viewCopy('ama', MODULE))).toEqual({ state: 'none' }); // la copie a été supprimée
    cloud.offline = false;
    expect(unwrap(await service().refreshMyView('ama', MODULE))).toEqual({ state: 'unavailable', status: 'expired' });
    // le propriétaire retire aussi la vue expirée du cloud à sa prochaine publication
    as('alice');
    expect(unwrap(await service().publishViews('alice', MODULE)).deleted).toBeGreaterThan(0);
    expect(Object.keys(cloud.tenantItems).some((k) => k.startsWith(`${MODULE}/ama/`))).toBe(false);
    expect(copyGate({ accessUntil: null }, new Date())).toBe('ok');
    expect(copyGate({ accessUntil: 'illisible' }, new Date())).toBe('expired'); // date illisible : refusé
  });

  it('les modifications du propriétaire se propagent (paiement ajouté) par différences ; une seconde publication n’écrit rien ; un contrat supprimé vide la vue', async () => {
    const seeded = await setup();
    as('alice');
    expect(unwrap(await service().publishViews('alice', MODULE))).toMatchObject({ written: 0, deleted: 0, failed: 0 });
    clock += 60_000;
    await enregistrerPaiementLoyer(seeded.first.contrat.id, new Date(2026, 10, 2)); // un paiement de plus pour Koffi
    const report = unwrap(await service().publishViews('alice', MODULE));
    expect(report.failed).toBe(0);
    expect(report.written).toBeGreaterThan(0);
    expect(report.written).toBeLessThan(10); // seuls les éléments qui ont changé
    const amaBefore = JSON.stringify(Object.entries(cloud.tenantItems).filter(([k]) => k.includes('/ama/')));
    expect(unwrap(await service().publishViews('alice', MODULE)).written).toBe(0);
    expect(JSON.stringify(Object.entries(cloud.tenantItems).filter(([k]) => k.includes('/ama/')))).toBe(amaBefore); // l'autre locataire n'a pas été réécrit
    const index = records.findIndex((r) => r.id === seeded.second.contrat.id);
    records.splice(index, 1);
    unwrap(await service().publishViews('alice', MODULE));
    expect(Object.keys(cloud.tenantItems).some((k) => k.includes('/ama/'))).toBe(false);
  });

  it('isolation entre comptes d’un même appareil : la copie de Koffi est invisible pour un autre compte ; les gardes (adresse non vérifiée, compte différent) s’appliquent à la lecture locale', async () => {
    await setup();
    as('koffi');
    unwrap(await service().refreshMyView('koffi', MODULE));
    as('bob');
    expect(unwrap(await service().viewCopy('bob', MODULE))).toEqual({ state: 'none' });
    expect(await service().viewCopy('koffi', MODULE)).toEqual({ ok: false, message: 'Le compte actif a changé : réessayez.' });
    as('koffi');
    expect(unwrap(await service().viewCopy('koffi', MODULE)).state).toBe('ok');
    cloud.offline = true;
    expect(await service().refreshMyView('koffi', MODULE)).toEqual({ ok: false, message: 'Pas de connexion à Internet : réessayez.' });
    expect(unwrap(await service().viewCopy('koffi', MODULE)).state).toBe('ok'); // l'échec réseau ne détruit pas la copie
  });
});

// ============================================================================================================================
describe('Modèle d’affichage et reçu', () => {
  it('lecture défensive : un champ absent ou de mauvais type est ignoré, jamais inventé ; tri du plus récent au plus ancien', () => {
    const model = toViewModel({
      contrat: { kind: 'contrat', body: { statut: 'actif', loyerMensuel: 'beaucoup', locataireNom: 'Koffi' } },
      p_a: { kind: 'paiement', body: { mois: '2026-08', montant: 30000, statut: 'paye', reference: 'TKD-1', dateValidation: '2026-09-06', retardsALaDate: 0 } },
      p_b: { kind: 'paiement', body: { mois: '2026-09', montant: 30000, statut: 'inconnu' } },
      p_c: { kind: 'paiement', body: { mois: '2026-10', statut: 'en_attente' } },
      retards: { kind: 'retards', body: { fiable: 'oui', mois: ['2026-09', 3] } },
      e1: { kind: 'evenement', body: { type: 'contrat_cree', date: '2026-08-05' } },
      e2: { kind: 'evenement', body: { type: 'piratage', date: '2026-08-06' } },
    });
    expect(model.contrat).toMatchObject({ statut: 'actif', loyerMensuel: null, locataireNom: 'Koffi' });
    expect(model.paiements.map((p) => p.mois)).toEqual(['2026-10', '2026-08']); // le statut inconnu est écarté
    expect(model.retards).toMatchObject({ fiable: false, mois: ['2026-09'] }); // « oui » n'est pas vrai
    expect(model.evenements).toHaveLength(1);
  });

  it('le reçu vient de la seule vue, avec le même contenu que celui du propriétaire (propriétaire, bien, logement, mode de paiement) ; absent pour un mois non payé', () => {
    const model = toViewModel({
      contrat: { kind: 'contrat', body: { locataireNom: 'Koffi Mensah', proprietaireNom: 'Mme Alice' } },
      logement: { kind: 'logement', body: { nom: 'Chambre 1', adresse: '12 rue du Marché', nomBien: 'Immeuble A' } },
      p1: { kind: 'paiement', body: { mois: '2026-08', montant: 30000, statut: 'paye', reference: 'TKD-AB12CD34', dateValidation: '2026-09-06', modePaiement: 'Mobile money', retardsALaDate: 0 } },
      p2: { kind: 'paiement', body: { mois: '2026-09', montant: 30000, statut: 'rejete' } },
    });
    const text = buildTenantReceiptText(model, model.paiements.find((p) => p.id === 'p1')!)!;
    expect(text).toContain('Référence : TKD-AB12CD34');
    expect(text).toContain('Locataire : Koffi Mensah');
    expect(text).toContain('Propriétaire : Mme Alice');
    expect(text).toContain('Bien : Immeuble A · Logement : Chambre 1');
    expect(text).toContain('Adresse : 12 rue du Marché');
    expect(text).toContain('Mode de paiement : Mobile money');
    expect(text).toContain('Période : août 2026');
    expect(text).toContain('Date du paiement : 06/09/2026');
    expect(text).toMatch(/Montant payé : 30\s?000 FCFA/);
    expect(text).toContain('Aucun loyer en retard à cette date');
    expect(buildTenantReceiptText(model, model.paiements.find((p) => p.id === 'p2')!)).toBeNull();
  });
});

// ============================================================================================================================
describe('Structure : le locataire ne peut qu’afficher', () => {
  const imports = (file: string) => read(file).split('\n').filter((l) => /^\s*(import|export) .* from /.test(l)).join('\n');

  it('l’écran du locataire n’appelle que la lecture ; il n’importe ni le moteur, ni Firebase, ni le port, et n’écrit rien', () => {
    const screen = read('features/profile/screens/TenantSpaceScreen.tsx');
    expect(imports('features/profile/screens/TenantSpaceScreen.tsx')).not.toMatch(/services\/sync\/|firebase|modulesPort|tenantViewPublisher|tenantViewFlows/i);
    expect(screen).toMatch(/sharedModules\.(viewCopy|refreshMyView)\(/);
    expect(screen).not.toMatch(/publishViews|approve|revoke|putTenantItems|deleteTenantItems|TextField|updateRecord|coreService/);
    expect(read('app/account/shared/space/[moduleId].tsx')).toContain('<Redirect href="/(tabs)" />');
  });

  it('la projection et la copie locale ne s’appuient sur aucun SDK ; la publication ne vit que dans les flux du propriétaire', () => {
    for (const file of ['services/tenantViewBuilder.ts', 'services/sharedModules/tenantViewModel.ts', 'services/sharedModules/tenantViewLocal.ts', 'services/sharedModules/tenantViewPublisher.ts', 'services/sharedModules/tenantViewFlows.ts']) {
      expect({ file, bad: imports(file).match(/firebase|firestore/i) }).toEqual({ file, bad: null });
    }
    expect(read('services/tenantViewBuilder.ts')).not.toMatch(/\.(createRecord|updateRecord|deleteRecord)\(|storage\.set|syncRecords/);
    // la copie du locataire vit dans son propre magasin, jamais dans les collections de l'application
    expect(read('services/sharedModules/tenantViewLocal.ts')).not.toMatch(/snapshotCollections|replaceCollections|from '\.\.\/db'/);
  });

  it('les types de vue sont exactement ceux du modèle ; la liste des champs refuse les champs privés connus', () => {
    expect([...TENANT_ITEM_KINDS]).toEqual(['contrat', 'logement', 'paiement', 'avance', 'retards', 'evenement']);
    const allFields = Object.values(TENANT_BODY_FIELDS).flat();
    // privés par décision : notes libres du contrat et des paiements, raisons, champs personnalisés, dépenses, statistiques
    for (const forbidden of ['notes', 'note', 'noteLibre', 'raison', 'raisonCorrection', 'raisonAnnulation', 'motif', 'depenses', 'depense', 'champsPersonnalises', 'champsPerso', 'statistiques', 'journal']) {
      expect({ forbidden, present: allFields.includes(forbidden) }).toEqual({ forbidden, present: false });
    }
    // visibles par décision (points 4.3)
    for (const allowed of ['locataireEmail', 'locataireNote', 'proprietaireNom', 'nomBien', 'loyerReference', 'modePaiement']) expect(allFields).toContain(allowed);
  });
});
