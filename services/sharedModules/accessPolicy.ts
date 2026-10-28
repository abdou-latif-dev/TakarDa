// Politique d'accès de RÉFÉRENCE des modules partagés — F3a. Pure, sans SDK, sans réseau : elle dit, pour une opération et un état du monde donnés,
// ce que les règles candidates (firestore.p5.rules) DOIVENT décider. Deux exécutants partagent la même matrice de cas (voir
// services/__tests__/helpers/modulesMatrix.ts) :
//   - ce module, toujours exécuté (cohérence de la politique, couverture de la section 3 des décisions) ;
//   - le test d'ÉMULATEUR (modulesRules.emulator.test.ts) qui joue les mêmes cas contre les VRAIES règles : non lancé tant que l'émulateur
//     n'est pas autorisé. Tant qu'il n'a pas tourné, la politique n'est PAS une preuve du comportement des règles.

import {
  MODULE_NAME_MAX,
  canTransitionMember,
  canTransitionRequest,
  isModuleId,
  isTenantAccessActive,
  validateMemberDoc,
  validateModuleDoc,
  validateRequestDoc,
  validateTenantItem,
  type MemberDoc,
  type ModuleDoc,
  type RequestDoc,
} from './model';

export interface PolicyActor {
  uid: string;
  /** Fournisseur de connexion ; seul « password » est admis. */
  provider: string;
}

export interface RecordLite {
  kind: string;
  ownerUid: string;
  rev: number;
  deleted: boolean;
}

export interface PolicyWorld {
  now: Date;
  /** Types admis dans le cloud et, parmi eux, faits financiers (création seule) : fournis par l'appelant (ceux du périmètre de synchronisation), pour que cette politique n'importe aucun module du moteur. */
  syncKinds: readonly string[];
  financialKinds: readonly string[];
  modules: Record<string, ModuleDoc>;
  /** Clé « moduleId/uid ». */
  members: Record<string, MemberDoc>;
  /** Clé « moduleId/uid ». */
  requests: Record<string, RequestDoc>;
  /** Clé « moduleId/recordId ». */
  records: Record<string, RecordLite>;
  /** Comptes portant le marqueur « supprimé » (`deletedAccounts/<uid>`) : plus aucune création ni modification de données, même avec un jeton encore valide (voir accountTombstone.ts). Absent = aucun. */
  deletedUids?: readonly string[];
}

export type Patch = Record<string, unknown>;

export type Operation =
  | { type: 'getModule'; moduleId: string }
  | { type: 'listModules' }
  | { type: 'listOwnModules' }
  | { type: 'createModule'; moduleId: string; doc: Patch }
  | { type: 'updateModule'; moduleId: string; patch: Patch }
  | { type: 'deleteModule'; moduleId: string }
  | { type: 'getMember'; moduleId: string; uid: string }
  | { type: 'listMembers'; moduleId: string }
  | { type: 'createMember'; moduleId: string; uid: string; doc: Patch; withApprovedRequest: boolean }
  | { type: 'updateMember'; moduleId: string; uid: string; patch: Patch }
  | { type: 'deleteMember'; moduleId: string; uid: string }
  | { type: 'getRequest'; moduleId: string; uid: string }
  | { type: 'listRequests'; moduleId: string }
  | { type: 'createRequest'; moduleId: string; uid: string; doc: Patch }
  | { type: 'updateRequest'; moduleId: string; uid: string; patch: Patch }
  | { type: 'deleteRequest'; moduleId: string; uid: string }
  | { type: 'getRecord'; moduleId: string; id: string }
  | { type: 'listRecords'; moduleId: string }
  | { type: 'writeRecord'; moduleId: string; id: string; doc: Patch }
  | { type: 'deleteRecord'; moduleId: string; id: string }
  | { type: 'getTenantItem'; moduleId: string; uid: string; id: string }
  | { type: 'listTenantItems'; moduleId: string; uid: string }
  | { type: 'writeTenantItem'; moduleId: string; uid: string; id: string; doc: Patch }
  | { type: 'deleteTenantItem'; moduleId: string; uid: string; id: string };

export interface Decision {
  allow: boolean;
  /** Raison lisible (pour le diagnostic des tests) ; jamais affichée à l'utilisateur. */
  reason: string;
}

const yes = (reason: string): Decision => ({ allow: true, reason });
const no = (reason: string): Decision => ({ allow: false, reason });

const affected = (before: Patch, patch: Patch): string[] => Object.keys(patch).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(patch[k]));
const onlyAffects = (before: Patch, patch: Patch, allowed: readonly string[]): boolean => affected(before, patch).every((k) => allowed.includes(k));

/** Décision de référence. `patch` = champs modifiés ; le document résultant est `{ ...avant, ...patch }`. */
export function decide(op: Operation, actor: PolicyActor | null, world: PolicyWorld): Decision {
  const signedIn = actor !== null && actor.provider === 'password';
  if (!signedIn) return no('non connecté par e-mail et mot de passe');
  const uid = actor.uid;
  const live = !(world.deletedUids ?? []).includes(uid);
  const moduleDoc = 'moduleId' in op ? world.modules[op.moduleId] : undefined;
  const isOwner = !!moduleDoc && moduleDoc.ownerUid === uid;
  const memberOf = (moduleId: string, memberUid: string): MemberDoc | undefined => world.members[`${moduleId}/${memberUid}`];
  // Module verrouillé (effacement du compte propriétaire en cours) : plus aucune écriture, plus aucune lecture de locataire ; seule la suppression est permise au propriétaire.
  const locked = !!moduleDoc && typeof moduleDoc.deletionLockedAt === 'string' && moduleDoc.deletionLockedAt !== '';
  const activeTenant = 'moduleId' in op && !locked && isTenantAccessActive(memberOf(op.moduleId, uid), world.now);

  switch (op.type) {
    // ---- le module -------------------------------------------------------------------------------------------------------------
    case 'getModule':
      return isOwner || activeTenant ? yes('propriétaire ou locataire actif') : no('ni propriétaire ni locataire actif');
    case 'listModules':
      return no('aucune liste générale de modules : un module ne se découvre jamais');
    case 'listOwnModules':
      return yes('liste de SES propres modules (requête limitée à son identifiant)');
    case 'createModule': {
      if (!live) return no('compte supprimé ou en cours de suppression : aucune création');
      if (moduleDoc) return no('un module existe déjà sous cet identifiant');
      if (!isModuleId(op.moduleId)) return no('identifiant de module invalide');
      if (op.doc.ownerUid !== uid) return no('le propriétaire est le créateur');
      return validateModuleDoc(op.doc).length === 0 ? yes('création de son propre module') : no('document de module invalide');
    }
    case 'updateModule': {
      if (!moduleDoc) return no('module inexistant');
      if (!isOwner) return no('réservé au propriétaire');
      if (locked) return no('module verrouillé : aucune modification, le verrou est irréversible');
      const changedKeys = affected(moduleDoc as unknown as Patch, op.patch);
      if (changedKeys.length === 1 && changedKeys[0] === 'deletionLockedAt') {
        const value = op.patch.deletionLockedAt;
        return typeof value === 'string' && value.length >= 1 && value.length <= 40 ? yes('verrou d’effacement') : no('verrou invalide');
      }
      if (!onlyAffects(moduleDoc as unknown as Patch, op.patch, ['name'])) return no('seul le nom change, ou le verrou seul (propriétaire, type, date immuables)');
      const next = { ...moduleDoc, ...op.patch };
      return typeof next.name === 'string' && next.name.length >= 1 && next.name.length <= MODULE_NAME_MAX ? yes('renommage') : no('nom invalide');
    }
    case 'deleteModule':
      return isOwner && locked ? yes('suppression du module sous verrou (effacement du compte)') : no('un module ne se supprime que sous verrou, par son propriétaire');

    // ---- les membres -----------------------------------------------------------------------------------------------------------
    case 'getMember':
      return isOwner || uid === op.uid ? yes('propriétaire, ou ses propres informations') : no('les informations d’un autre membre sont privées');
    case 'listMembers':
      return isOwner ? yes('propriétaire') : no('la liste des membres est réservée au propriétaire');
    case 'createMember': {
      if (!moduleDoc) return no('module inexistant');
      if (locked) return no('module verrouillé');
      if (!isOwner) return no('seul le propriétaire ajoute un membre');
      if (!live) return no('compte supprimé ou en cours de suppression : aucune création');
      if (memberOf(op.moduleId, op.uid)) return no('ce membre existe déjà (le rétablir par une modification)');
      if (op.uid === uid) return no('le propriétaire n’est pas un membre');
      if (validateMemberDoc(op.doc).length > 0) return no('document de membre invalide');
      if (op.doc.uid !== op.uid) return no('identifiant différent du chemin');
      if (op.doc.state !== 'active') return no('un nouveau membre est actif');
      if (op.doc.addedBy !== uid) return no('auteur différent du propriétaire');
      if (!op.withApprovedRequest) return no('aucune demande approuvée dans la même opération');
      return yes('ajout à l’approbation d’une demande');
    }
    case 'updateMember': {
      const member = memberOf(op.moduleId, op.uid);
      if (!moduleDoc || !member) return no('membre inexistant');
      if (locked) return no('module verrouillé');
      const next = { ...member, ...op.patch } as Patch;
      const changed = affected(member as unknown as Patch, op.patch);
      if (changed.length === 0) return no('aucune modification');
      if (changed.includes('state') && !onlyAffects(member as unknown as Patch, op.patch, ['state', 'updatedAt', 'accessUntil'])) return no('un changement d’état ne modifie que l’état, la date et la fin d’accès');
      if (isOwner) {
        if (changed.includes('state')) {
          if (!canTransitionMember(member.state, next.state as MemberDoc['state'], 'owner')) return no('transition d’état interdite');
          return yes('révocation ou rétablissement');
        }
        // sans changement d'état : seuls le contrat lié, la fin d'accès et la date de mise à jour (membre actif)
        if (member.state !== 'active') return no('un membre qui n’est pas actif ne se modifie pas (le rétablir d’abord)');
        return onlyAffects(member as unknown as Patch, op.patch, ['contractId', 'accessUntil', 'updatedAt']) ? yes('contrat lié ou fin d’accès') : no('champ immuable');
      }
      if (uid === op.uid) {
        if (!live) return no('compte supprimé ou en cours de suppression : aucune modification');
        if (!changed.includes('state') || !onlyAffects(member as unknown as Patch, op.patch, ['state', 'updatedAt'])) return no('un membre ne peut que quitter');
        return canTransitionMember(member.state, next.state as MemberDoc['state'], 'member') ? yes('départ du membre') : no('transition d’état interdite');
      }
      return no('ni propriétaire ni ce membre');
    }
    case 'deleteMember':
      return isOwner && locked ? yes('suppression sous verrou (effacement du module)') : no('l’historique des membres est conservé (révoquer plutôt que supprimer)');

    // ---- les demandes ----------------------------------------------------------------------------------------------------------
    case 'getRequest':
      return isOwner || uid === op.uid ? yes('propriétaire, ou sa propre demande') : no('la demande d’un autre est privée');
    case 'listRequests':
      return isOwner ? yes('propriétaire') : no('la liste des demandes est réservée au propriétaire');
    case 'createRequest': {
      if (!moduleDoc) return no('module inexistant');
      if (locked) return no('module verrouillé');
      if (op.uid !== uid) return no('on ne crée que sa propre demande');
      if (!live) return no('compte supprimé ou en cours de suppression : aucune création');
      if (isOwner) return no('le propriétaire ne demande pas l’accès à son propre module');
      if (world.requests[`${op.moduleId}/${op.uid}`]) return no('une demande existe déjà');
      if (memberOf(op.moduleId, uid)) return no('déjà membre (ou ancien membre : voir le propriétaire)');
      if (validateRequestDoc(op.doc).length > 0) return no('document de demande invalide');
      if (op.doc.uid !== uid) return no('identifiant différent du demandeur');
      if (op.doc.state !== 'pending' || op.doc.decidedBy !== null) return no('une nouvelle demande est en attente et non tranchée : jamais d’auto-approbation');
      return yes('demande d’accès');
    }
    case 'updateRequest': {
      const request = world.requests[`${op.moduleId}/${op.uid}`];
      if (!moduleDoc || !request) return no('demande inexistante');
      if (locked) return no('module verrouillé');
      if (!isOwner) return no('seul le propriétaire tranche (jamais le demandeur : pas d’auto-approbation)');
      if (op.uid === uid) return no('le propriétaire ne tranche pas sa propre demande');
      const next = { ...request, ...op.patch } as Patch;
      if (!onlyAffects(request as unknown as Patch, op.patch, ['state', 'decidedBy', 'updatedAt'])) return no('champ immuable');
      if (!canTransitionRequest(request.state, next.state as RequestDoc['state'])) return no('une demande tranchée ne change plus');
      if (next.decidedBy !== uid) return no('le décideur est le propriétaire');
      return yes('approbation ou refus');
    }
    case 'deleteRequest': {
      const request = world.requests[`${op.moduleId}/${op.uid}`];
      if (!moduleDoc || !request) return no('demande inexistante');
      if (isOwner) return yes('le propriétaire efface une demande (lever un blocage)');
      return uid === op.uid && (request.state === 'pending' || request.state === 'approved') ? yes('annulation de sa demande en attente, ou retrait du nom saisi après approbation') : no('une demande refusée ne s’efface pas par le demandeur (elle bloque)');
    }

    // ---- les données du module (propriétaire seul) -----------------------------------------------------------------------------
    case 'getRecord':
    case 'listRecords':
      return isOwner ? yes('propriétaire') : no('les données du module sont réservées au propriétaire (le locataire lit sa vue)');
    case 'writeRecord': {
      if (!isOwner) return no('réservé au propriétaire');
      if (locked) return no('module verrouillé');
      if (!live) return no('compte supprimé ou en cours de suppression : aucune écriture');
      const existing = world.records[`${op.moduleId}/${op.id}`];
      const kind = op.doc.kind;
      if (typeof kind !== 'string' || !world.syncKinds.includes(kind)) return no('type hors périmètre');
      if (op.doc.ownerUid !== uid) return no('auteur différent du compte connecté');
      if (!existing) return op.doc.rev === 1 && op.doc.deleted === false ? yes('création') : no('une création a la révision 1 et n’est pas supprimée');
      if (world.financialKinds.includes(existing.kind)) return no('un fait financier est en création seule');
      if (op.doc.kind !== existing.kind) return no('type immuable');
      if (existing.ownerUid !== op.doc.ownerUid) return no('auteur immuable');
      if (existing.deleted === true && op.doc.deleted === true) return no('document déjà supprimé');
      return op.doc.rev === existing.rev + 1 ? yes('modification à la révision suivante') : no('révision strictement « ancienne + 1 »');
    }
    case 'deleteRecord':
      return isOwner && locked ? yes('suppression sous verrou (effacement du module)') : no('aucune suppression physique ordinaire (suppression logique seulement)');

    // ---- la vue du locataire (lecture seule) -----------------------------------------------------------------------------------
    case 'getTenantItem':
    case 'listTenantItems':
      if (isOwner) return yes('le propriétaire relit ce qu’il publie');
      return uid === op.uid && activeTenant ? yes('locataire actif, sa propre vue') : no('ni propriétaire, ni locataire actif de cette vue');
    case 'writeTenantItem':
      if (!isOwner) return no('seul le propriétaire publie une vue : un locataire n’écrit jamais');
      if (locked) return no('module verrouillé');
      if (!live) return no('compte supprimé ou en cours de suppression : aucune écriture');
      return validateTenantItem(op.doc).length === 0 ? yes('publication de la vue') : no('projection invalide (type inconnu ou champ non autorisé pour ce type)');
    case 'deleteTenantItem':
      return isOwner ? yes('retrait d’un élément de la vue') : no('seul le propriétaire retire un élément de la vue');
  }
}
