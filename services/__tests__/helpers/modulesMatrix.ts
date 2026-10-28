// Matrice de cas des modules partagés — F3a. UNE SEULE description de ce qui doit être autorisé ou refusé, jouée par deux exécutants :
//   - sharedModules.test.ts   : contre la politique de référence (accessPolicy.ts), toujours ;
//   - modulesRules.emulator.test.ts : contre les VRAIES règles (firestore.p5.rules) dans l'émulateur, seulement quand il est lancé.
// Chaque cas porte la protection de la section 3 des décisions qu'il vérifie (`protects`).

import { cloudFinancialKinds, cloudKinds } from '../../firebase/syncDocModel';
import type { MemberDoc, ModuleDoc, RequestDoc } from '../../sharedModules/model';
import type { Operation, Patch, PolicyActor, PolicyWorld } from '../../sharedModules/accessPolicy';

export const NOW = new Date('2026-10-21T12:00:00.000Z');
export const PAST = '2026-09-01T00:00:00.000Z';
export const FUTURE = '2026-12-31T00:00:00.000Z';
const STAMP = '2026-10-01T09:00:00.000Z';

export const M1 = 'mod_aaaaaaaaaaaaaaaaaaaaaaaa';
export const M2 = 'mod_bbbbbbbbbbbbbbbbbbbbbbbb';
export const M_NEW = 'mod_cccccccccccccccccccccccc';
/** Module VERROUILLÉ (effacement du compte propriétaire en cours). */
export const M3 = 'mod_eeeeeeeeeeeeeeeeeeeeeeee';
export const M_MISSING = 'mod_dddddddddddddddddddddddd';
/** Module OUVERT dont le propriétaire porte le marqueur « compte supprimé » (suppression commencée, module pas encore verrouillé). */
export const M4 = 'mod_ffffffffffffffffffffffff';

export type ActorKey = 'owner1' | 'owner2' | 't1' | 'tFuture' | 'tBoundary' | 'tExpired' | 'tRevoked' | 'tLeft' | 't2' | 'pend' | 'refused' | 'stranger' | 'wrongProvider' | 'anon' | 'ghost' | 'ghostOwner' | 'ghostTenant';

export const ACTORS: Record<ActorKey, PolicyActor | null> = {
  owner1: { uid: 'owner1', provider: 'password' },
  owner2: { uid: 'owner2', provider: 'password' },
  t1: { uid: 't1', provider: 'password' },
  tFuture: { uid: 'tFuture', provider: 'password' },
  tBoundary: { uid: 'tBoundary', provider: 'password' },
  tExpired: { uid: 'tExpired', provider: 'password' },
  tRevoked: { uid: 'tRevoked', provider: 'password' },
  tLeft: { uid: 'tLeft', provider: 'password' },
  t2: { uid: 't2', provider: 'password' },
  pend: { uid: 'pend', provider: 'password' },
  refused: { uid: 'refused', provider: 'password' },
  stranger: { uid: 'stranger', provider: 'password' },
  wrongProvider: { uid: 'owner1', provider: 'google.com' },
  anon: null,
  // comptes portant le marqueur « supprimé » (jeton encore valide : constat du test A6)
  ghost: { uid: 'ghost', provider: 'password' },
  ghostOwner: { uid: 'ghostOwner', provider: 'password' },
  ghostTenant: { uid: 'ghostTenant', provider: 'password' },
};
export const GHOSTS: ActorKey[] = ['ghost', 'ghostOwner', 'ghostTenant'];

const module = (ownerUid: string, name: string): ModuleDoc => ({ ownerUid, type: 'immobilier', name, createdAt: STAMP, schemaVersion: 1 });
const member = (uid: string, over: Partial<MemberDoc> = {}): MemberDoc => ({ uid, role: 'locataire', state: 'active', contractId: 'contrat-1', accessUntil: null, addedBy: 'owner1', createdAt: STAMP, updatedAt: STAMP, ...over });
const request = (uid: string, over: Partial<RequestDoc> = {}): RequestDoc => ({ uid, state: 'pending', label: null, decidedBy: null, createdAt: STAMP, updatedAt: STAMP, ...over });

/** Le monde de départ : deux modules (deux propriétaires), des locataires dans tous les états, des demandes, deux données. */
export function baseWorld(): PolicyWorld {
  return {
    now: NOW,
    syncKinds: cloudKinds(),
    financialKinds: cloudFinancialKinds(),
    modules: { [M1]: module('owner1', 'Immeuble A'), [M2]: module('owner2', 'Immeuble B'), [M3]: { ...module('owner1', 'Immeuble en cours d’effacement'), deletionLockedAt: '2026-10-20T08:00:00.000Z' }, [M4]: module('ghostOwner', 'Immeuble d’un compte supprimé') },
    members: {
      [`${M1}/t1`]: member('t1'),
      [`${M1}/tFuture`]: member('tFuture', { accessUntil: FUTURE }),
      [`${M1}/tBoundary`]: member('tBoundary', { accessUntil: NOW.toISOString() }),
      [`${M1}/tExpired`]: member('tExpired', { accessUntil: PAST }),
      [`${M1}/tRevoked`]: member('tRevoked', { state: 'revoked' }),
      [`${M1}/tLeft`]: member('tLeft', { state: 'left' }),
      [`${M2}/t2`]: member('t2', { addedBy: 'owner2' }),
      [`${M3}/t1`]: member('t1'),
      [`${M1}/ghostTenant`]: member('ghostTenant'),
    },
    requests: {
      [`${M1}/pend`]: request('pend'),
      [`${M1}/refused`]: request('refused', { state: 'refused', decidedBy: 'owner1' }),
      [`${M1}/t1`]: request('t1', { state: 'approved', decidedBy: 'owner1' }),
      [`${M3}/pend`]: request('pend'),
      [`${M4}/pend`]: request('pend'),
    },
    records: {
      [`${M1}/rec1`]: { kind: 'immobilier.bien', ownerUid: 'owner1', rev: 1, deleted: false },
      [`${M1}/pay1`]: { kind: 'immobilier.paiement', ownerUid: 'owner1', rev: 1, deleted: false },
      [`${M3}/rec3`]: { kind: 'immobilier.bien', ownerUid: 'owner1', rev: 1, deleted: false },
    },
    deletedUids: ['ghost', 'ghostOwner', 'ghostTenant'],
  };
}

export interface MatrixCase {
  name: string;
  /** Protection de la section 3 des décisions vérifiée par ce cas. */
  protects: string;
  actor: ActorKey;
  op: Operation;
  expect: 'allow' | 'deny';
}

const c = (protects: string, actor: ActorKey, expectation: 'allow' | 'deny', name: string, op: Operation): MatrixCase => ({ name, protects, actor, op, expect: expectation });

const newModuleDoc = (ownerUid: string, over: Patch = {}): Patch => ({ ...module(ownerUid, 'Mon immeuble'), ...over });
const memberDoc = (uid: string, over: Patch = {}): Patch => ({ ...member(uid, { addedBy: 'owner1', createdAt: STAMP, updatedAt: STAMP }), ...over });
const requestDoc = (uid: string, over: Patch = {}): Patch => ({ ...request(uid), ...over });
const recordDoc = (over: Patch = {}): Patch => ({ kind: 'immobilier.bien', ownerUid: 'owner1', rev: 1, deleted: false, ...over });
const itemDoc = (over: Patch = {}): Patch => ({ kind: 'contrat', body: { loyerMensuel: 30000 }, rev: 1, updatedAt: STAMP, ...over });

const NON_ACTIVE_OR_FOREIGN: ActorKey[] = ['owner2', 'tBoundary', 'tExpired', 'tRevoked', 'tLeft', 't2', 'pend', 'refused', 'stranger', 'wrongProvider', 'anon'];
const ALL_ACTORS = (Object.keys(ACTORS) as ActorKey[]).filter((a) => !GHOSTS.includes(a));

export const MATRIX: MatrixCase[] = [
  // ---- le module : étanchéité, propriétaire immuable ---------------------------------------------------------------------------
  c('accès réservé aux membres actifs', 'owner1', 'allow', 'le propriétaire lit son module', { type: 'getModule', moduleId: M1 }),
  c('accès réservé aux membres actifs', 't1', 'allow', 'un locataire actif lit le module (son nom)', { type: 'getModule', moduleId: M1 }),
  c('accès réservé aux membres actifs', 'tFuture', 'allow', 'un locataire dont la fin d’accès est future lit le module', { type: 'getModule', moduleId: M1 }),
  ...NON_ACTIVE_OR_FOREIGN.map((a) => c('accès expiré, révoqué, refusé, en attente ou étranger : refusé', a, 'deny', `${a} ne lit pas le module`, { type: 'getModule', moduleId: M1 })),
  c('étanchéité entre modules', 'owner1', 'deny', 'le propriétaire de M1 ne lit pas M2', { type: 'getModule', moduleId: M2 }),
  c('étanchéité entre modules', 't1', 'deny', 'le locataire de M1 ne lit pas M2', { type: 'getModule', moduleId: M2 }),
  ...ALL_ACTORS.map((a) => c('un module ne se découvre jamais', a, 'deny', `${a} ne liste pas les modules`, { type: 'listModules' })),
  c('création de son propre module', 'stranger', 'allow', 'on crée son propre module', { type: 'createModule', moduleId: M_NEW, doc: newModuleDoc('stranger') }),
  c('propriétaire immuable', 'stranger', 'deny', 'on ne crée pas un module au nom d’un autre', { type: 'createModule', moduleId: M_NEW, doc: newModuleDoc('owner1') }),
  c('aucun champ inconnu', 'stranger', 'deny', 'aucun administrateur supplémentaire glissé à la création', { type: 'createModule', moduleId: M_NEW, doc: newModuleDoc('stranger', { adminUids: ['stranger', 'owner1'] }) }),
  c('identifiant non devinable', 'stranger', 'deny', 'identifiant de module hors format', { type: 'createModule', moduleId: 'mod_court', doc: newModuleDoc('stranger') }),
  c('propriétaire immuable', 'stranger', 'deny', 'on ne reprend pas un module existant en le « créant »', { type: 'createModule', moduleId: M1, doc: newModuleDoc('stranger') }),
  c('renommer', 'owner1', 'allow', 'le propriétaire renomme son module', { type: 'updateModule', moduleId: M1, patch: { name: 'Immeuble A2' } }),
  c('propriétaire immuable', 'owner1', 'deny', 'le propriétaire ne transfère pas la propriété', { type: 'updateModule', moduleId: M1, patch: { ownerUid: 'stranger' } }),
  c('propriétaire immuable', 'owner1', 'deny', 'le type du module ne change pas', { type: 'updateModule', moduleId: M1, patch: { type: 'tontine' } }),
  c('renommer', 'owner1', 'deny', 'un nom vide est refusé', { type: 'updateModule', moduleId: M1, patch: { name: '' } }),
  ...(['t1', 'owner2', 'stranger', 'pend'] as ActorKey[]).map((a) => c('seul le propriétaire modifie le module', a, 'deny', `${a} ne renomme pas le module`, { type: 'updateModule', moduleId: M1, patch: { name: 'Piraté' } })),
  c('un administrateur ne supprime pas le module', 'owner1', 'deny', 'le propriétaire ne supprime pas le module depuis un client', { type: 'deleteModule', moduleId: M1 }),
  c('un administrateur ne supprime pas le module', 'stranger', 'deny', 'un tiers ne supprime pas un module', { type: 'deleteModule', moduleId: M1 }),

  // ---- les membres ---------------------------------------------------------------------------------------------------------------
  c('un membre ne voit que ses propres informations', 'owner1', 'allow', 'le propriétaire lit un membre', { type: 'getMember', moduleId: M1, uid: 't1' }),
  c('un membre ne voit que ses propres informations', 't1', 'allow', 'un locataire lit sa propre fiche de membre', { type: 'getMember', moduleId: M1, uid: 't1' }),
  c('un membre révoqué apprend sa révocation', 'tRevoked', 'allow', 'un membre révoqué lit sa propre fiche (il voit l’état)', { type: 'getMember', moduleId: M1, uid: 'tRevoked' }),
  c('un locataire ne voit aucun autre locataire', 't1', 'deny', 'un locataire ne lit pas la fiche d’un autre', { type: 'getMember', moduleId: M1, uid: 'tFuture' }),
  c('un non-membre ne lit pas les membres', 'stranger', 'deny', 'un tiers ne lit pas un membre', { type: 'getMember', moduleId: M1, uid: 't1' }),
  c('étanchéité entre modules', 't2', 'deny', 'un locataire d’un autre module ne lit pas un membre de M1', { type: 'getMember', moduleId: M1, uid: 't1' }),
  c('étanchéité entre modules', 'owner2', 'deny', 'le propriétaire d’un autre module ne lit pas les membres de M1', { type: 'getMember', moduleId: M1, uid: 't1' }),
  c('un locataire ne voit aucun autre locataire', 'owner1', 'allow', 'le propriétaire liste ses membres', { type: 'listMembers', moduleId: M1 }),
  ...(['t1', 'tFuture', 'stranger', 'pend', 'owner2', 'anon'] as ActorKey[]).map((a) => c('un locataire ne voit aucun autre locataire', a, 'deny', `${a} ne liste pas les membres`, { type: 'listMembers', moduleId: M1 })),
  c('seul le propriétaire approuve', 'owner1', 'allow', 'ajout d’un membre à l’approbation de sa demande', { type: 'createMember', moduleId: M1, uid: 'pend', doc: memberDoc('pend'), withApprovedRequest: true }),
  c('jamais d’auto-approbation', 'owner1', 'deny', 'aucun membre sans demande approuvée dans la même opération', { type: 'createMember', moduleId: M1, uid: 'pend', doc: memberDoc('pend'), withApprovedRequest: false }),
  c('jamais d’auto-approbation', 'pend', 'deny', 'le demandeur ne s’ajoute pas lui-même', { type: 'createMember', moduleId: M1, uid: 'pend', doc: memberDoc('pend'), withApprovedRequest: true }),
  c('jamais d’auto-approbation', 'stranger', 'deny', 'un tiers ne s’ajoute pas', { type: 'createMember', moduleId: M1, uid: 'stranger', doc: memberDoc('stranger'), withApprovedRequest: true }),
  c('étanchéité entre modules', 'owner2', 'deny', 'le propriétaire d’un autre module n’ajoute personne à M1', { type: 'createMember', moduleId: M1, uid: 'pend', doc: memberDoc('pend', { addedBy: 'owner2' }), withApprovedRequest: true }),
  c('deux rôles seulement', 'owner1', 'deny', 'aucun rôle d’administrateur donné à un membre', { type: 'createMember', moduleId: M1, uid: 'pend', doc: memberDoc('pend', { role: 'admin' }), withApprovedRequest: true }),
  c('un nouveau membre est actif', 'owner1', 'deny', 'un membre ne naît pas révoqué ou avec un état inventé', { type: 'createMember', moduleId: M1, uid: 'pend', doc: memberDoc('pend', { state: 'revoked' }), withApprovedRequest: true }),
  c('aucun champ inconnu', 'owner1', 'deny', 'aucun champ supplémentaire dans la fiche d’un membre', { type: 'createMember', moduleId: M1, uid: 'pend', doc: memberDoc('pend', { canWrite: true }), withApprovedRequest: true }),
  c('le propriétaire n’est pas un membre', 'owner1', 'deny', 'le propriétaire ne s’ajoute pas comme membre', { type: 'createMember', moduleId: M1, uid: 'owner1', doc: memberDoc('owner1'), withApprovedRequest: true }),
  c('un membre existant ne se recrée pas', 'owner1', 'deny', 'on ne recrée pas un membre existant (on le rétablit)', { type: 'createMember', moduleId: M1, uid: 't1', doc: memberDoc('t1'), withApprovedRequest: true }),
  c('révocation par le propriétaire', 'owner1', 'allow', 'le propriétaire révoque un locataire actif', { type: 'updateMember', moduleId: M1, uid: 't1', patch: { state: 'revoked', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('révocation par le propriétaire', 'owner1', 'deny', 'on ne « révoque » pas un membre déjà révoqué', { type: 'updateMember', moduleId: M1, uid: 'tRevoked', patch: { state: 'revoked', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('rétablissement par le propriétaire', 'owner1', 'allow', 'le propriétaire rétablit un membre révoqué', { type: 'updateMember', moduleId: M1, uid: 'tRevoked', patch: { state: 'active', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('rétablissement par le propriétaire', 'owner1', 'allow', 'le propriétaire rétablit un membre parti', { type: 'updateMember', moduleId: M1, uid: 'tLeft', patch: { state: 'active', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('contrat lié et fin d’accès', 'owner1', 'allow', 'le propriétaire lie un contrat', { type: 'updateMember', moduleId: M1, uid: 't1', patch: { contractId: 'contrat-2', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('contrat lié et fin d’accès', 'owner1', 'allow', 'le propriétaire fixe la fin d’accès', { type: 'updateMember', moduleId: M1, uid: 't1', patch: { accessUntil: FUTURE, updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('rôle immuable', 'owner1', 'deny', 'le rôle d’un membre ne change pas', { type: 'updateMember', moduleId: M1, uid: 't1', patch: { role: 'admin', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('identité immuable', 'owner1', 'deny', 'l’identifiant d’un membre ne change pas', { type: 'updateMember', moduleId: M1, uid: 't1', patch: { uid: 'stranger' } }),
  c('un membre ne modifie que son départ', 't1', 'allow', 'un locataire quitte le module', { type: 'updateMember', moduleId: M1, uid: 't1', patch: { state: 'left', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('un membre ne se révoque pas lui-même d’une façon détournée', 't1', 'deny', 'un locataire ne se pose pas l’état « révoqué »', { type: 'updateMember', moduleId: M1, uid: 't1', patch: { state: 'revoked', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('un membre révoqué ne se rétablit pas', 'tRevoked', 'deny', 'un membre révoqué ne se rétablit pas lui-même', { type: 'updateMember', moduleId: M1, uid: 'tRevoked', patch: { state: 'active', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('un membre parti ne se rétablit pas', 'tLeft', 'deny', 'un membre parti ne se rétablit pas lui-même', { type: 'updateMember', moduleId: M1, uid: 'tLeft', patch: { state: 'active', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('un membre ne prolonge pas son accès', 't1', 'deny', 'un locataire ne prolonge pas sa fin d’accès', { type: 'updateMember', moduleId: M1, uid: 't1', patch: { accessUntil: '2030-01-01T00:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('un membre ne change pas son contrat', 'tExpired', 'deny', 'un accès expiré ne se prolonge pas par une modification', { type: 'updateMember', moduleId: M1, uid: 'tExpired', patch: { accessUntil: '2030-01-01T00:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('un membre ne change pas son contrat', 't1', 'deny', 'un locataire ne se lie pas à un autre contrat', { type: 'updateMember', moduleId: M1, uid: 't1', patch: { contractId: 'contrat-du-voisin', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  ...(['stranger', 'tFuture', 'owner2', 'pend'] as ActorKey[]).map((a) => c('seul le propriétaire ou le membre lui-même', a, 'deny', `${a} ne modifie pas la fiche de t1`, { type: 'updateMember', moduleId: M1, uid: 't1', patch: { state: 'revoked', updatedAt: '2026-10-21T12:00:00.000Z' } })),
  c('l’historique est conservé', 'owner1', 'deny', 'le propriétaire ne supprime pas un membre', { type: 'deleteMember', moduleId: M1, uid: 't1' }),
  c('l’historique est conservé', 't1', 'deny', 'un membre ne supprime pas sa fiche', { type: 'deleteMember', moduleId: M1, uid: 't1' }),

  // ---- les demandes d'accès ------------------------------------------------------------------------------------------------------
  c('un utilisateur ne lit que sa demande', 'pend', 'allow', 'un demandeur lit sa propre demande', { type: 'getRequest', moduleId: M1, uid: 'pend' }),
  c('le propriétaire voit les demandes', 'owner1', 'allow', 'le propriétaire lit une demande', { type: 'getRequest', moduleId: M1, uid: 'pend' }),
  c('un utilisateur ne lit que sa demande', 'stranger', 'deny', 'un tiers ne lit pas la demande d’un autre', { type: 'getRequest', moduleId: M1, uid: 'pend' }),
  c('un utilisateur ne lit que sa demande', 't1', 'deny', 'un locataire ne lit pas la demande d’un autre', { type: 'getRequest', moduleId: M1, uid: 'pend' }),
  c('le propriétaire voit les demandes', 'owner1', 'allow', 'le propriétaire liste les demandes', { type: 'listRequests', moduleId: M1 }),
  ...(['pend', 't1', 'stranger', 'owner2', 'anon'] as ActorKey[]).map((a) => c('un utilisateur ne lit que sa demande', a, 'deny', `${a} ne liste pas les demandes`, { type: 'listRequests', moduleId: M1 })),
  c('« Rejoindre » crée une demande', 'stranger', 'allow', 'un utilisateur connecté demande l’accès', { type: 'createRequest', moduleId: M1, uid: 'stranger', doc: requestDoc('stranger', { label: 'Koffi' }) }),
  c('un utilisateur ne crée que sa demande', 'stranger', 'deny', 'on ne crée pas la demande d’un autre', { type: 'createRequest', moduleId: M1, uid: 'someoneElse', doc: requestDoc('someoneElse') }),
  c('jamais d’auto-approbation', 'stranger', 'deny', 'une demande ne naît pas « approuvée »', { type: 'createRequest', moduleId: M1, uid: 'stranger', doc: requestDoc('stranger', { state: 'approved' }) }),
  c('jamais d’auto-approbation', 'stranger', 'deny', 'une demande ne naît pas avec un décideur', { type: 'createRequest', moduleId: M1, uid: 'stranger', doc: requestDoc('stranger', { decidedBy: 'stranger' }) }),
  c('aucun champ inconnu', 'stranger', 'deny', 'aucun champ supplémentaire dans une demande', { type: 'createRequest', moduleId: M1, uid: 'stranger', doc: requestDoc('stranger', { role: 'admin' }) }),
  c('le propriétaire ne se demande pas l’accès', 'owner1', 'deny', 'le propriétaire ne demande pas l’accès à son module', { type: 'createRequest', moduleId: M1, uid: 'owner1', doc: requestDoc('owner1') }),
  c('une demande par utilisateur', 'pend', 'deny', 'une seconde demande est refusée', { type: 'createRequest', moduleId: M1, uid: 'pend', doc: requestDoc('pend') }),
  c('un refus bloque jusqu’à décision du propriétaire', 'refused', 'deny', 'un demandeur refusé ne redemande pas', { type: 'createRequest', moduleId: M1, uid: 'refused', doc: requestDoc('refused') }),
  c('un membre ne redemande pas', 'tRevoked', 'deny', 'un membre révoqué ne redemande pas : il voit le propriétaire', { type: 'createRequest', moduleId: M1, uid: 'tRevoked', doc: requestDoc('tRevoked') }),
  c('un module inexistant ne se devine pas', 'stranger', 'deny', 'demande vers un module inexistant', { type: 'createRequest', moduleId: M_MISSING, uid: 'stranger', doc: requestDoc('stranger') }),
  c('seul le propriétaire approuve', 'owner1', 'allow', 'le propriétaire approuve une demande', { type: 'updateRequest', moduleId: M1, uid: 'pend', patch: { state: 'approved', decidedBy: 'owner1', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('seul le propriétaire approuve', 'owner1', 'allow', 'le propriétaire refuse une demande', { type: 'updateRequest', moduleId: M1, uid: 'pend', patch: { state: 'refused', decidedBy: 'owner1', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('jamais d’auto-approbation', 'pend', 'deny', 'le demandeur ne peut pas approuver sa propre demande', { type: 'updateRequest', moduleId: M1, uid: 'pend', patch: { state: 'approved', decidedBy: 'pend', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('jamais d’auto-approbation', 'pend', 'deny', 'le demandeur ne se fait pas passer pour le propriétaire', { type: 'updateRequest', moduleId: M1, uid: 'pend', patch: { state: 'approved', decidedBy: 'owner1', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('seul le propriétaire approuve', 'stranger', 'deny', 'un tiers n’approuve pas', { type: 'updateRequest', moduleId: M1, uid: 'pend', patch: { state: 'approved', decidedBy: 'stranger', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('étanchéité entre modules', 'owner2', 'deny', 'le propriétaire d’un autre module n’approuve pas', { type: 'updateRequest', moduleId: M1, uid: 'pend', patch: { state: 'approved', decidedBy: 'owner2', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('une demande tranchée ne change plus', 'owner1', 'deny', 'une demande approuvée ne redevient pas refusée', { type: 'updateRequest', moduleId: M1, uid: 't1', patch: { state: 'refused', decidedBy: 'owner1', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('le décideur est le propriétaire', 'owner1', 'deny', 'le décideur inscrit est le propriétaire', { type: 'updateRequest', moduleId: M1, uid: 'pend', patch: { state: 'approved', decidedBy: 'someoneElse', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('identité immuable', 'owner1', 'deny', 'l’identifiant d’une demande ne change pas', { type: 'updateRequest', moduleId: M1, uid: 'pend', patch: { state: 'approved', decidedBy: 'owner1', uid: 'stranger' } }),
  c('un demandeur annule sa demande en attente', 'pend', 'allow', 'annulation de sa demande en attente', { type: 'deleteRequest', moduleId: M1, uid: 'pend' }),
  c('un refus bloque jusqu’à décision du propriétaire', 'refused', 'deny', 'un demandeur refusé n’efface pas son refus', { type: 'deleteRequest', moduleId: M1, uid: 'refused' }),
  c('le propriétaire lève un blocage', 'owner1', 'allow', 'le propriétaire efface une demande refusée', { type: 'deleteRequest', moduleId: M1, uid: 'refused' }),
  c('un utilisateur ne retire que sa demande', 'stranger', 'deny', 'un tiers n’efface pas la demande d’un autre', { type: 'deleteRequest', moduleId: M1, uid: 'pend' }),
  c('le demandeur retire le nom qu’il a saisi', 't1', 'allow', 'un locataire efface sa demande approuvée (le nom qu’il avait saisi)', { type: 'deleteRequest', moduleId: M1, uid: 't1' }),
  c('le demandeur retire le nom qu’il a saisi', 'stranger', 'deny', 'un tiers n’efface pas la demande approuvée d’un locataire', { type: 'deleteRequest', moduleId: M1, uid: 't1' }),
  c('le demandeur retire le nom qu’il a saisi', 't2', 'deny', 'un locataire d’un autre module n’efface pas la demande d’un autre', { type: 'deleteRequest', moduleId: M1, uid: 't1' }),

  // ---- les données du module : propriétaire seul, faits financiers en création seule -------------------------------------------
  c('les données du module sont privées', 'owner1', 'allow', 'le propriétaire lit une donnée', { type: 'getRecord', moduleId: M1, id: 'rec1' }),
  c('les données du module sont privées', 'owner1', 'allow', 'le propriétaire liste ses données', { type: 'listRecords', moduleId: M1 }),
  ...(['t1', 'tFuture', 'tExpired', 'tRevoked', 'pend', 'stranger', 'owner2', 't2', 'anon'] as ActorKey[]).flatMap((a) => [
    c('un locataire ne lit que sa vue, jamais les données du module', a, 'deny', `${a} ne lit pas une donnée du module`, { type: 'getRecord', moduleId: M1, id: 'rec1' }),
    c('un locataire ne lit que sa vue, jamais les données du module', a, 'deny', `${a} ne liste pas les données du module`, { type: 'listRecords', moduleId: M1 }),
  ]),
  c('un locataire n’écrit rien', 't1', 'deny', 'un locataire n’écrit pas une donnée', { type: 'writeRecord', moduleId: M1, id: 'new1', doc: recordDoc({ ownerUid: 't1' }) }),
  c('un locataire n’écrit rien', 't1', 'deny', 'un locataire ne modifie pas une donnée existante', { type: 'writeRecord', moduleId: M1, id: 'rec1', doc: recordDoc({ ownerUid: 't1', rev: 2 }) }),
  c('étanchéité entre modules', 'owner2', 'deny', 'le propriétaire d’un autre module n’écrit pas dans M1', { type: 'writeRecord', moduleId: M1, id: 'new1', doc: recordDoc({ ownerUid: 'owner2' }) }),
  c('création par le propriétaire', 'owner1', 'allow', 'le propriétaire crée une donnée', { type: 'writeRecord', moduleId: M1, id: 'new1', doc: recordDoc() }),
  c('périmètre Immobilier seul', 'owner1', 'deny', 'un type hors périmètre est refusé', { type: 'writeRecord', moduleId: M1, id: 'new1', doc: recordDoc({ kind: 'tontine.cotisation' }) }),
  c('auteur = compte connecté', 'owner1', 'deny', 'l’auteur écrit au nom de quelqu’un d’autre', { type: 'writeRecord', moduleId: M1, id: 'new1', doc: recordDoc({ ownerUid: 'stranger' }) }),
  c('révision', 'owner1', 'deny', 'une création n’a pas une révision avancée', { type: 'writeRecord', moduleId: M1, id: 'new1', doc: recordDoc({ rev: 5 }) }),
  c('modification par le propriétaire', 'owner1', 'allow', 'modification à la révision suivante', { type: 'writeRecord', moduleId: M1, id: 'rec1', doc: recordDoc({ rev: 2 }) }),
  c('révision', 'owner1', 'deny', 'saut de révision', { type: 'writeRecord', moduleId: M1, id: 'rec1', doc: recordDoc({ rev: 3 }) }),
  c('type immuable', 'owner1', 'deny', 'le type d’une donnée ne change pas', { type: 'writeRecord', moduleId: M1, id: 'rec1', doc: recordDoc({ kind: 'immobilier.logement', rev: 2 }) }),
  c('faits financiers en création seule', 'owner1', 'deny', 'un paiement existant n’est jamais modifié', { type: 'writeRecord', moduleId: M1, id: 'pay1', doc: recordDoc({ kind: 'immobilier.paiement', rev: 2 }) }),
  c('faits financiers en création seule', 'owner1', 'allow', 'un nouveau paiement se crée', { type: 'writeRecord', moduleId: M1, id: 'pay2', doc: recordDoc({ kind: 'immobilier.paiement' }) }),
  c('pas de suppression physique', 'owner1', 'deny', 'aucune suppression physique d’une donnée', { type: 'deleteRecord', moduleId: M1, id: 'rec1' }),

  // ---- la vue du locataire : lecture seule, limitée à lui, limitée dans le temps -------------------------------------------------
  c('un locataire lit sa vue', 't1', 'allow', 'un locataire actif lit un élément de sa vue', { type: 'getTenantItem', moduleId: M1, uid: 't1', id: 'item1' }),
  c('un locataire lit sa vue', 't1', 'allow', 'un locataire actif liste sa vue', { type: 'listTenantItems', moduleId: M1, uid: 't1' }),
  c('un locataire lit sa vue', 'tFuture', 'allow', 'un locataire dont la fin d’accès est future lit sa vue', { type: 'listTenantItems', moduleId: M1, uid: 'tFuture' }),
  c('un locataire ne voit aucun autre locataire', 't1', 'deny', 'un locataire ne lit pas la vue d’un autre', { type: 'getTenantItem', moduleId: M1, uid: 'tFuture', id: 'item1' }),
  c('un locataire ne voit aucun autre locataire', 't1', 'deny', 'un locataire ne liste pas la vue d’un autre', { type: 'listTenantItems', moduleId: M1, uid: 'tFuture' }),
  c('accès expiré refusé', 'tExpired', 'deny', 'accès expiré : lecture refusée', { type: 'getTenantItem', moduleId: M1, uid: 'tExpired', id: 'item1' }),
  c('accès expiré refusé', 'tExpired', 'deny', 'accès expiré : liste refusée', { type: 'listTenantItems', moduleId: M1, uid: 'tExpired' }),
  c('accès expiré refusé', 'tBoundary', 'deny', 'à l’instant exact de fin d’accès : refusé', { type: 'listTenantItems', moduleId: M1, uid: 'tBoundary' }),
  c('accès révoqué refusé', 'tRevoked', 'deny', 'accès révoqué : lecture refusée immédiatement', { type: 'getTenantItem', moduleId: M1, uid: 'tRevoked', id: 'item1' }),
  c('accès révoqué refusé', 'tLeft', 'deny', 'membre parti : lecture refusée', { type: 'listTenantItems', moduleId: M1, uid: 'tLeft' }),
  c('accès en attente ou refusé : lecture refusée', 'pend', 'deny', 'demande en attente : aucune lecture', { type: 'listTenantItems', moduleId: M1, uid: 'pend' }),
  c('accès en attente ou refusé : lecture refusée', 'refused', 'deny', 'demande refusée : aucune lecture', { type: 'listTenantItems', moduleId: M1, uid: 'refused' }),
  c('étanchéité entre modules', 't2', 'deny', 'un locataire de M2 ne lit rien de M1', { type: 'listTenantItems', moduleId: M1, uid: 't2' }),
  c('étanchéité entre modules', 't2', 'deny', 'un locataire de M2 ne lit pas la vue de t1', { type: 'listTenantItems', moduleId: M1, uid: 't1' }),
  c('un non-membre ne lit rien', 'stranger', 'deny', 'un tiers ne lit pas une vue', { type: 'listTenantItems', moduleId: M1, uid: 't1' }),
  c('étanchéité entre modules', 'owner2', 'deny', 'le propriétaire d’un autre module ne lit pas la vue', { type: 'listTenantItems', moduleId: M1, uid: 't1' }),
  c('le propriétaire relit ce qu’il publie', 'owner1', 'allow', 'le propriétaire relit la vue d’un locataire', { type: 'listTenantItems', moduleId: M1, uid: 't1' }),
  c('un locataire n’écrit rien', 't1', 'deny', 'un locataire n’écrit pas dans sa vue', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'item1', doc: itemDoc() }),
  c('un locataire n’écrit rien', 't1', 'deny', 'un locataire ne retire rien de sa vue', { type: 'deleteTenantItem', moduleId: M1, uid: 't1', id: 'item1' }),
  c('le propriétaire publie la vue', 'owner1', 'allow', 'le propriétaire publie un élément', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'item1', doc: itemDoc() }),
  c('aucun champ privé dans la vue', 'owner1', 'deny', 'un champ privé au premier niveau ne se glisse pas dans la vue', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'item1', doc: itemDoc({ notes: 'privé' }) }),
  c('aucun champ privé dans la vue', 'owner1', 'deny', 'des notes libres ne se glissent pas dans le contenu du contrat', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'item1', doc: itemDoc({ body: { loyerMensuel: 30000, notes: 'privé' } }) }),
  c('le propriétaire publie la vue', 'owner1', 'allow', 'le mode de paiement est publié (décision du propriétaire du projet)', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'pay1', doc: itemDoc({ kind: 'paiement', body: { mois: '2026-09', montant: 30000, modePaiement: 'espèces' } }) }),
  c('aucun champ privé dans la vue', 'owner1', 'deny', 'la note libre d’un paiement reste privée', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'pay1', doc: itemDoc({ kind: 'paiement', body: { mois: '2026-09', montant: 30000, note: 'privé' } }) }),
  c('aucun champ privé dans la vue', 'owner1', 'deny', 'la raison d’une correction ou d’une annulation reste privée', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'pay1', doc: itemDoc({ kind: 'paiement', body: { mois: '2026-09', montant: 30000, raisonCorrection: 'erreur' } }) }),
  c('le propriétaire publie la vue', 'owner1', 'allow', 'le nom du bien et le loyer de référence sont publiés (décision du propriétaire du projet)', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'logement', doc: itemDoc({ kind: 'logement', body: { nom: 'Chambre 1', nomBien: 'Immeuble A', loyerReference: 30000, adresse: '12 rue du Marché' } }) }),
  c('le propriétaire publie la vue', 'owner1', 'allow', 'l’e-mail, la note du contact et le nom du propriétaire sont publiés (décision du propriétaire du projet)', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'contrat', doc: itemDoc({ body: { locataireNom: 'Koffi', locataireEmail: 'k@x.test', locataireNote: 'note du contact', proprietaireNom: 'Alice' } }) }),
  c('aucun champ privé dans la vue', 'owner1', 'deny', 'une dépense ne se glisse pas dans le logement', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'logement', doc: itemDoc({ kind: 'logement', body: { nom: 'Chambre 1', depenses: [5000] } }) }),
  c('aucun champ privé dans la vue', 'owner1', 'deny', 'un champ d’un autre type ne passe pas (loyer dans un logement)', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'logement', doc: itemDoc({ kind: 'logement', body: { nom: 'Chambre 1', loyerMensuel: 1 } }) }),
  c('le propriétaire publie la vue', 'owner1', 'allow', 'le propriétaire publie un paiement', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'pay1', doc: itemDoc({ kind: 'paiement', body: { mois: '2026-09', montant: 30000, statut: 'paye', dateValidation: '2026-09-12', reference: 'TKD-AB12CD34', retardsALaDate: 0 } }) }),
  c('périmètre Immobilier seul', 'owner1', 'deny', 'un type hors périmètre ne se publie pas', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'item1', doc: itemDoc({ kind: 'tontine.cotisation' }) }),
  c('périmètre Immobilier seul', 'owner1', 'deny', 'un type de synchronisation (contact) n’est pas un type de vue', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'item1', doc: itemDoc({ kind: 'core.contact' }) }),
  c('étanchéité entre modules', 'owner2', 'deny', 'le propriétaire d’un autre module ne publie pas dans M1', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'item1', doc: itemDoc() }),
  c('le propriétaire retire de la vue', 'owner1', 'allow', 'le propriétaire retire un élément de la vue', { type: 'deleteTenantItem', moduleId: M1, uid: 't1', id: 'item1' }),

  // ---- effacement du compte propriétaire : verrou irréversible, puis seul le propriétaire supprime -----------------------------------
  c('liste de ses propres modules', 'owner1', 'allow', 'le propriétaire retrouve SES modules (requête limitée à son identifiant)', { type: 'listOwnModules' }),
  c('liste de ses propres modules', 'stranger', 'allow', 'un utilisateur connecté liste les siens (aucun module d’autrui n’est retourné)', { type: 'listOwnModules' }),
  c('aucun accès sans connexion par mot de passe', 'anon', 'deny', 'sans connexion : aucune liste de ses modules', { type: 'listOwnModules' }),
  c('aucun accès sans connexion par mot de passe', 'wrongProvider', 'deny', 'autre fournisseur de connexion : aucune liste de ses modules', { type: 'listOwnModules' }),
  c('verrou d’effacement', 'owner1', 'allow', 'le propriétaire pose le verrou d’effacement', { type: 'updateModule', moduleId: M1, patch: { deletionLockedAt: '2026-10-21T12:00:00.000Z' } }),
  c('verrou d’effacement', 'owner1', 'deny', 'le verrou ne se pose pas deux fois (module déjà verrouillé)', { type: 'updateModule', moduleId: M3, patch: { deletionLockedAt: '2026-10-21T12:00:00.000Z' } }),
  c('verrou d’effacement', 'owner1', 'deny', 'le verrou est irréversible : on ne le retire pas', { type: 'updateModule', moduleId: M3, patch: { deletionLockedAt: null } }),
  c('verrou d’effacement', 'owner1', 'deny', 'le verrou ne se pose pas avec une valeur vide', { type: 'updateModule', moduleId: M1, patch: { deletionLockedAt: '' } }),
  c('verrou d’effacement', 'owner1', 'deny', 'le verrou ne se mélange pas à un renommage', { type: 'updateModule', moduleId: M1, patch: { deletionLockedAt: '2026-10-21T12:00:00.000Z', name: 'Autre' } }),
  ...(['t1', 'stranger', 'owner2', 'pend'] as ActorKey[]).map((a) => c('verrou d’effacement', a, 'deny', `${a} ne verrouille pas le module de M1`, { type: 'updateModule', moduleId: M1, patch: { deletionLockedAt: '2026-10-21T12:00:00.000Z' } })),
  c('sous verrou : plus aucune écriture', 'owner1', 'deny', 'module verrouillé : aucun renommage', { type: 'updateModule', moduleId: M3, patch: { name: 'Autre' } }),
  c('sous verrou : plus aucune écriture', 'owner1', 'deny', 'module verrouillé : aucune révocation', { type: 'updateMember', moduleId: M3, uid: 't1', patch: { state: 'revoked', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('sous verrou : plus aucune écriture', 'owner1', 'deny', 'module verrouillé : aucune donnée créée', { type: 'writeRecord', moduleId: M3, id: 'new3', doc: recordDoc() }),
  c('sous verrou : plus aucune écriture', 'owner1', 'deny', 'module verrouillé : aucune modification de donnée', { type: 'writeRecord', moduleId: M3, id: 'rec3', doc: recordDoc({ rev: 2 }) }),
  c('sous verrou : plus aucune écriture', 'owner1', 'deny', 'module verrouillé : aucune publication de vue', { type: 'writeTenantItem', moduleId: M3, uid: 't1', id: 'item1', doc: itemDoc() }),
  c('sous verrou : plus aucune écriture', 'owner1', 'deny', 'module verrouillé : aucune approbation', { type: 'updateRequest', moduleId: M3, uid: 'pend', patch: { state: 'approved', decidedBy: 'owner1', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('sous verrou : plus aucune écriture', 'stranger', 'deny', 'module verrouillé : aucune nouvelle demande', { type: 'createRequest', moduleId: M3, uid: 'stranger', doc: requestDoc('stranger') }),
  c('sous verrou : plus aucune écriture', 't1', 'deny', 'module verrouillé : le locataire ne peut même plus quitter par une écriture', { type: 'updateMember', moduleId: M3, uid: 't1', patch: { state: 'left', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  c('sous verrou : le locataire perd sa lecture', 't1', 'deny', 'module verrouillé : le locataire ne lit plus le module', { type: 'getModule', moduleId: M3 }),
  c('sous verrou : le locataire perd sa lecture', 't1', 'deny', 'module verrouillé : le locataire ne lit plus sa vue', { type: 'listTenantItems', moduleId: M3, uid: 't1' }),
  c('sous verrou : le locataire perd sa lecture', 'owner1', 'allow', 'module verrouillé : le propriétaire lit encore son module', { type: 'getModule', moduleId: M3 }),
  c('suppression sous verrou par le propriétaire', 'owner1', 'allow', 'sous verrou : le propriétaire supprime un membre', { type: 'deleteMember', moduleId: M3, uid: 't1' }),
  c('suppression sous verrou par le propriétaire', 'owner1', 'allow', 'sous verrou : le propriétaire supprime une donnée', { type: 'deleteRecord', moduleId: M3, id: 'rec3' }),
  c('suppression sous verrou par le propriétaire', 'owner1', 'allow', 'sous verrou : le propriétaire retire un élément de vue', { type: 'deleteTenantItem', moduleId: M3, uid: 't1', id: 'item1' }),
  c('suppression sous verrou par le propriétaire', 'owner1', 'allow', 'sous verrou : le propriétaire supprime le module', { type: 'deleteModule', moduleId: M3 }),
  c('suppression sous verrou par le propriétaire', 'owner1', 'deny', 'sans verrou : le propriétaire ne supprime pas un membre', { type: 'deleteMember', moduleId: M1, uid: 't1' }),
  c('suppression sous verrou par le propriétaire', 'owner1', 'deny', 'sans verrou : le propriétaire ne supprime pas une donnée', { type: 'deleteRecord', moduleId: M1, id: 'rec1' }),
  ...(['t1', 'stranger', 'owner2', 'pend', 'anon', 'wrongProvider'] as ActorKey[]).flatMap((a) => [
    c('suppression sous verrou par le propriétaire', a, 'deny', `${a} ne supprime pas le module verrouillé`, { type: 'deleteModule', moduleId: M3 }),
    c('suppression sous verrou par le propriétaire', a, 'deny', `${a} ne supprime pas une fiche de membre du module verrouillé`, { type: 'deleteMember', moduleId: M3, uid: 't1' }),
    c('suppression sous verrou par le propriétaire', a, 'deny', `${a} ne supprime pas une donnée du module verrouillé`, { type: 'deleteRecord', moduleId: M3, id: 'rec3' }),
  ]),

  // ---- compte supprimé : un ancien jeton ne recrée rien (constat du test A6 sur le projet de test réel) ---------------------------------
  c('compte supprimé : aucune création ni modification', 'ghost', 'deny', 'un compte supprimé ne crée pas de module', { type: 'createModule', moduleId: M_NEW, doc: newModuleDoc('ghost') }),
  c('compte supprimé : aucune création ni modification', 'ghost', 'deny', 'un compte supprimé ne crée pas de demande d’accès', { type: 'createRequest', moduleId: M1, uid: 'ghost', doc: requestDoc('ghost') }),
  c('compte supprimé : aucune création ni modification', 'ghostOwner', 'deny', 'un propriétaire supprimé ne crée pas de donnée dans son module encore ouvert', { type: 'writeRecord', moduleId: M4, id: 'zombie', doc: recordDoc({ ownerUid: 'ghostOwner' }) }),
  c('compte supprimé : aucune création ni modification', 'ghostOwner', 'deny', 'un propriétaire supprimé ne publie pas de vue', { type: 'writeTenantItem', moduleId: M4, uid: 't1', id: 'zombie', doc: itemDoc() }),
  c('compte supprimé : aucune création ni modification', 'ghostOwner', 'deny', 'un propriétaire supprimé n’approuve plus de demande (aucun membre ajouté)', { type: 'createMember', moduleId: M4, uid: 'pend', doc: memberDoc('pend', { addedBy: 'ghostOwner' }), withApprovedRequest: true }),
  c('compte supprimé : aucune création ni modification', 'ghostTenant', 'deny', 'un locataire supprimé n’écrit plus dans le module d’un autre (même pour « quitter »)', { type: 'updateMember', moduleId: M1, uid: 'ghostTenant', patch: { state: 'left', updatedAt: '2026-10-21T12:00:00.000Z' } }),
  // la procédure de suppression, elle, doit pouvoir aller à son terme : le verrou et les suppressions restent permis
  c('compte supprimé : la suppression va à son terme', 'ghostOwner', 'allow', 'un propriétaire supprimé pose encore le verrou d’effacement de son module', { type: 'updateModule', moduleId: M4, patch: { deletionLockedAt: '2026-10-21T12:00:00.000Z' } }),
  c('compte supprimé : la suppression va à son terme', 'ghostOwner', 'allow', 'un propriétaire supprimé efface encore une demande de son module', { type: 'deleteRequest', moduleId: M4, uid: 'pend' }),

  // ---- tout compte sans connexion valide : refusé partout ---------------------------------------------------------------------
  c('aucun accès sans connexion par mot de passe', 'anon', 'deny', 'sans connexion : aucune création de demande', { type: 'createRequest', moduleId: M1, uid: 'anon', doc: requestDoc('anon') }),
  c('aucun accès sans connexion par mot de passe', 'wrongProvider', 'deny', 'autre fournisseur de connexion : le propriétaire lui-même est refusé', { type: 'listRecords', moduleId: M1 }),
  c('aucun accès sans connexion par mot de passe', 'wrongProvider', 'deny', 'autre fournisseur de connexion : aucune publication de vue', { type: 'writeTenantItem', moduleId: M1, uid: 't1', id: 'item1', doc: itemDoc() }),
];

