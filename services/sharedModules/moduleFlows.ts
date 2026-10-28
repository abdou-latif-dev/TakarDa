// Flux des modules partagés — F3b : créer un module, « Rejoindre » (demande), approuver / refuser, révoquer / rétablir, partir, fin d'accès à 90 jours.
// Logique pure au-dessus du port `ModulesBackend` : aucun SDK, aucun réseau direct, rien n'est branché à l'application (voir sharedModulesService.ts).
// Aucune fonction ne lève : le résultat porte un message en français. Les règles du cloud (firestore.p5.rules, candidat non publié) restent
// l'arbitre ; ce module ne fait que présenter des demandes valides et traduire les refus.

import { ModulesError, type ModulesBackend } from './modulesPort';
import {
  MODULE_NAME_MAX,
  REQUEST_LABEL_MAX,
  accessUntilForContractEnd,
  generateModuleId,
  isModuleId,
  isTenantAccessActive,
  type MemberDoc,
  type ModuleDoc,
  type RequestDoc,
} from './model';

/** Plafond de membres ACTIFS par module : imposé ici, pas par les règles (décision de V1 confirmée : aucun plafond côté règles). */
export const MAX_ACTIVE_MEMBERS = 50;

export type AccessStatus = 'none' | 'pending' | 'refused' | 'approved_waiting' | 'active' | 'expired' | 'revoked' | 'left';

export const ACCESS_STATUS_LABEL: Record<AccessStatus, string> = {
  none: 'Aucune demande',
  pending: 'Demande en attente de validation',
  refused: 'Demande refusée',
  approved_waiting: 'Demande approuvée, accès en cours d’activation',
  active: 'Accès actif',
  expired: 'Accès expiré',
  revoked: 'Accès retiré par le propriétaire',
  left: 'Vous avez quitté cet espace',
};

/** Ce que voit un utilisateur de SON accès à un module, à partir de SA demande et de SA fiche de membre. Pur. */
export function deriveAccessStatus(request: Pick<RequestDoc, 'state'> | null, member: Pick<MemberDoc, 'role' | 'state' | 'accessUntil'> | null, now: Date): AccessStatus {
  if (member) {
    if (member.state === 'revoked') return 'revoked';
    if (member.state === 'left') return 'left';
    return isTenantAccessActive(member, now) ? 'active' : 'expired';
  }
  if (!request) return 'none';
  if (request.state === 'pending') return 'pending';
  if (request.state === 'refused') return 'refused';
  return 'approved_waiting';
}

export interface FlowDeps {
  backend: ModulesBackend;
  /** Compte connecté. */
  uid: string;
  now?: () => Date;
  /** Générateur d'identifiant de module (injectable pour les tests). */
  newModuleId?: () => string;
}

export type FlowResult<T> = { ok: true; value: T } | { ok: false; message: string };

const ok = <T,>(value: T): FlowResult<T> => ({ ok: true, value });
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

/** Traduit une erreur du port en message ; `permissionMessage` remplace le message générique d'un refus (sans révéler ce qui existe). */
export function explain(error: unknown, permissionMessage?: string): { ok: false; message: string } {
  if (error instanceof ModulesError) {
    if (error.code === 'network') return fail('Pas de connexion à Internet : réessayez.');
    if (error.code === 'permission') return fail(permissionMessage ?? 'Action refusée : votre accès a peut-être changé. Actualisez puis réessayez.');
    if (error.code === 'not_found') return fail('Élément introuvable : actualisez puis réessayez.');
    if (error.code === 'exists') return fail('Cet élément existe déjà.');
  }
  return fail('Une erreur est survenue. Vos données n’ont pas été modifiées.');
}

const nowIso = (deps: FlowDeps): string => (deps.now ?? (() => new Date()))().toISOString();

/** Identifiant saisi : espaces autour tolérés ; majuscules ramenées en minuscules (les identifiants sont en minuscules). */
export const normalizeModuleId = (text: string): string => text.trim().toLowerCase();

export const INVALID_MODULE_ID_MESSAGE = 'Identifiant d’espace invalide : il commence par « mod_ » et compte 28 caractères.';

// ---- Propriétaire : créer un module ------------------------------------------------------------------------------------------------

export async function createOwnedModule(deps: FlowDeps, name: string): Promise<FlowResult<{ moduleId: string; name: string }>> {
  const clean = name.trim();
  if (clean.length < 1) return fail('Donnez un nom à l’espace partagé.');
  if (clean.length > MODULE_NAME_MAX) return fail(`Le nom est trop long (${MODULE_NAME_MAX} caractères au plus).`);
  const doc: ModuleDoc = { ownerUid: deps.uid, type: 'immobilier', name: clean, createdAt: nowIso(deps), schemaVersion: 1 };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const moduleId = (deps.newModuleId ?? (() => generateModuleId()))();
    try {
      await deps.backend.createModule(moduleId, doc);
      return ok({ moduleId, name: clean });
    } catch (error) {
      if (error instanceof ModulesError && error.code === 'exists') continue; // identifiant déjà pris : on en tire un autre
      return explain(error, 'Création refusée. Vérifiez que votre adresse e-mail est vérifiée et que vous êtes connecté.');
    }
  }
  return fail('Création impossible pour le moment : réessayez.');
}

export async function renameOwnedModule(deps: FlowDeps, moduleId: string, name: string): Promise<FlowResult<null>> {
  const clean = name.trim();
  if (clean.length < 1 || clean.length > MODULE_NAME_MAX) return fail(`Le nom doit compter de 1 à ${MODULE_NAME_MAX} caractères.`);
  try {
    await deps.backend.renameModule(moduleId, clean);
    return ok(null);
  } catch (error) {
    return explain(error);
  }
}

// ---- Demandeur : « Rejoindre » -------------------------------------------------------------------------------------------------------

/**
 * Crée la demande d'accès du compte connecté. L'identifiant ne donne JAMAIS accès : le propriétaire doit approuver. En cas de refus du cloud, le
 * message ne dit pas pourquoi (module inexistant, déjà demandé, refusé, déjà membre) : il ne révèle rien sur ce qui existe.
 */
export async function requestAccess(deps: FlowDeps, moduleIdText: string, label: string): Promise<FlowResult<{ moduleId: string; label: string | null }>> {
  const moduleId = normalizeModuleId(moduleIdText);
  if (!isModuleId(moduleId)) return fail(INVALID_MODULE_ID_MESSAGE);
  const cleanLabel = label.trim();
  if (cleanLabel.length > REQUEST_LABEL_MAX) return fail(`Le nom est trop long (${REQUEST_LABEL_MAX} caractères au plus).`);
  const at = nowIso(deps);
  const doc: RequestDoc = { uid: deps.uid, state: 'pending', label: cleanLabel === '' ? null : cleanLabel, decidedBy: null, createdAt: at, updatedAt: at };
  try {
    await deps.backend.createRequest(moduleId, doc);
    return ok({ moduleId, label: doc.label });
  } catch (error) {
    return explain(error, 'La demande n’a pas pu être envoyée. Vérifiez l’identifiant ; si vous avez déjà fait une demande ou eu un accès pour cet espace, contactez son propriétaire.');
  }
}

export interface MyAccess {
  status: AccessStatus;
  /** Nom du module : connu seulement quand l'accès est actif. */
  moduleName: string | null;
  contractId: string | null;
  accessUntil: string | null;
}

/** État de MON accès à un module (ma demande et ma fiche de membre : seules lectures permises à un non-propriétaire). */
export async function checkMyAccess(deps: FlowDeps, moduleId: string): Promise<FlowResult<MyAccess>> {
  try {
    const [request, member] = await Promise.all([deps.backend.getRequest(moduleId, deps.uid), deps.backend.getMember(moduleId, deps.uid)]);
    const now = (deps.now ?? (() => new Date()))();
    const status = deriveAccessStatus(request, member, now);
    let moduleName: string | null = null;
    if (status === 'active') {
      try {
        moduleName = (await deps.backend.getModule(moduleId))?.name ?? null;
      } catch {
        moduleName = null; // le nom est un confort : son absence ne change pas l'état de l'accès
      }
    }
    return ok({ status, moduleName, contractId: member?.contractId ?? null, accessUntil: member?.accessUntil ?? null });
  } catch (error) {
    return explain(error);
  }
}

/** Annule MA demande en attente, ou retire le nom saisi d'une demande approuvée (une demande refusée reste : elle bloque). */
export async function cancelMyRequest(deps: FlowDeps, moduleId: string): Promise<FlowResult<null>> {
  try {
    await deps.backend.deleteRequest(moduleId, deps.uid);
    return ok(null);
  } catch (error) {
    return explain(error, 'Seule une demande en attente ou approuvée peut être effacée par son auteur (une demande refusée reste).');
  }
}

/** Je quitte un espace : l'accès est coupé immédiatement ; le propriétaire garde l'historique. */
export async function leaveModule(deps: FlowDeps, moduleId: string): Promise<FlowResult<null>> {
  try {
    await deps.backend.updateMember(moduleId, deps.uid, { state: 'left', updatedAt: nowIso(deps) });
    return ok(null);
  } catch (error) {
    return explain(error, 'Vous ne pouvez quitter que les espaces auxquels vous avez un accès actif.');
  }
}

// ---- Propriétaire : demandes et membres ----------------------------------------------------------------------------------------------

export interface OwnerView {
  requests: RequestDoc[];
  members: MemberDoc[];
}

/** Demandes (en attente d'abord, puis les plus récentes) et membres (actifs d'abord) du module. */
export async function loadOwnerView(deps: FlowDeps, moduleId: string): Promise<FlowResult<OwnerView>> {
  try {
    const [requests, members] = await Promise.all([deps.backend.listRequests(moduleId), deps.backend.listMembers(moduleId)]);
    const rank = (state: string) => (state === 'pending' ? 0 : 1);
    requests.sort((a, b) => rank(a.state) - rank(b.state) || (a.createdAt < b.createdAt ? 1 : -1));
    const memberRank = (state: string) => (state === 'active' ? 0 : 1);
    members.sort((a, b) => memberRank(a.state) - memberRank(b.state) || (a.createdAt < b.createdAt ? 1 : -1));
    return ok({ requests, members });
  } catch (error) {
    return explain(error);
  }
}

async function activeMemberCount(deps: FlowDeps, moduleId: string): Promise<number> {
  return (await deps.backend.listMembers(moduleId)).filter((m) => m.state === 'active').length;
}

const accessUntilOf = (contractEndDay: string | null | undefined): string | null => (contractEndDay ? accessUntilForContractEnd(contractEndDay) : null);

export interface ApproveInput {
  moduleId: string;
  requesterUid: string;
  /** Contrat auquel l'accès est lié (obligatoire : un locataire sans contrat ne verrait rien). */
  contractId: string;
  /** Jour de fin du contrat (AAAA-MM-JJ) s'il est déjà terminé : fixe la fin d'accès à ce jour + 90 jours. */
  contractEndDay?: string | null;
}

export async function approveRequest(deps: FlowDeps, input: ApproveInput): Promise<FlowResult<MemberDoc>> {
  if (!input.contractId.trim()) return fail('Choisissez le contrat du locataire : l’accès lui est lié.');
  if (input.requesterUid === deps.uid) return fail('Vous ne pouvez pas approuver votre propre demande.');
  try {
    if ((await activeMemberCount(deps, input.moduleId)) >= MAX_ACTIVE_MEMBERS) return fail(`Cet espace compte déjà ${MAX_ACTIVE_MEMBERS} membres actifs : retirez-en un avant d’en ajouter.`);
    const at = nowIso(deps);
    const member: MemberDoc = {
      uid: input.requesterUid,
      role: 'locataire',
      state: 'active',
      contractId: input.contractId.trim(),
      accessUntil: accessUntilOf(input.contractEndDay),
      addedBy: deps.uid,
      createdAt: at,
      updatedAt: at,
    };
    await deps.backend.decideRequest(input.moduleId, input.requesterUid, { state: 'approved', decidedBy: deps.uid, at }, member);
    return ok(member);
  } catch (error) {
    return explain(error, 'Approbation refusée : la demande a peut-être déjà été traitée. Actualisez la liste.');
  }
}

export async function refuseRequest(deps: FlowDeps, moduleId: string, requesterUid: string): Promise<FlowResult<null>> {
  if (requesterUid === deps.uid) return fail('Vous ne pouvez pas traiter votre propre demande.');
  try {
    await deps.backend.decideRequest(moduleId, requesterUid, { state: 'refused', decidedBy: deps.uid, at: nowIso(deps) }, null);
    return ok(null);
  } catch (error) {
    return explain(error, 'Refus impossible : la demande a peut-être déjà été traitée. Actualisez la liste.');
  }
}

/** Efface une demande (levée d'un refus : la personne pourra redemander). */
export async function clearRequest(deps: FlowDeps, moduleId: string, requesterUid: string): Promise<FlowResult<null>> {
  try {
    await deps.backend.deleteRequest(moduleId, requesterUid);
    return ok(null);
  } catch (error) {
    return explain(error);
  }
}

/** Retire l'accès d'un membre, immédiatement (l'historique financier du propriétaire n'est jamais touché). */
export async function revokeMember(deps: FlowDeps, moduleId: string, memberUid: string): Promise<FlowResult<null>> {
  try {
    await deps.backend.updateMember(moduleId, memberUid, { state: 'revoked', updatedAt: nowIso(deps) });
    return ok(null);
  } catch (error) {
    return explain(error, 'Révocation impossible : seul un accès actif peut être retiré. Actualisez la liste.');
  }
}

/** Rétablit un membre révoqué ou parti ; `contractEndDay` recalcule la fin d'accès (sinon elle est levée). */
export async function reactivateMember(deps: FlowDeps, moduleId: string, memberUid: string, contractEndDay?: string | null): Promise<FlowResult<null>> {
  try {
    if ((await activeMemberCount(deps, moduleId)) >= MAX_ACTIVE_MEMBERS) return fail(`Cet espace compte déjà ${MAX_ACTIVE_MEMBERS} membres actifs : retirez-en un avant d’en rétablir.`);
    await deps.backend.updateMember(moduleId, memberUid, { state: 'active', accessUntil: accessUntilOf(contractEndDay), updatedAt: nowIso(deps) });
    return ok(null);
  } catch (error) {
    return explain(error, 'Rétablissement impossible : seul un accès retiré ou quitté peut être rétabli. Actualisez la liste.');
  }
}

/** Lie un autre contrat à un membre actif (et recalcule sa fin d'accès). */
export async function setMemberContract(deps: FlowDeps, moduleId: string, memberUid: string, contractId: string, contractEndDay?: string | null): Promise<FlowResult<null>> {
  if (!contractId.trim()) return fail('Choisissez un contrat.');
  try {
    await deps.backend.updateMember(moduleId, memberUid, { contractId: contractId.trim(), accessUntil: accessUntilOf(contractEndDay), updatedAt: nowIso(deps) });
    return ok(null);
  } catch (error) {
    return explain(error, 'Modification impossible : seul un accès actif peut être modifié. Actualisez la liste.');
  }
}

/**
 * Pose la fin d'accès (fin de contrat + 90 jours) des membres actifs dont le contrat est terminé et qui n'en ont pas encore. Exécuté par
 * l'application du PROPRIÉTAIRE (aucune fonction cloud) : un locataire garde donc son accès jusqu'à ce que le propriétaire ouvre l'application après
 * la fin du contrat. Ne remplace jamais une fin d'accès déjà posée (une date plus proche, choisie à la main, est respectée). Retourne le nombre de membres mis à jour.
 */
export async function reconcileAccessEnds(deps: FlowDeps, moduleId: string, contractEndDayOf: (contractId: string) => string | null): Promise<FlowResult<number>> {
  try {
    let updated = 0;
    for (const member of await deps.backend.listMembers(moduleId)) {
      if (member.state !== 'active' || member.accessUntil !== null || !member.contractId) continue;
      const until = accessUntilOf(contractEndDayOf(member.contractId));
      if (until === null) continue;
      await deps.backend.updateMember(moduleId, member.uid, { accessUntil: until, updatedAt: nowIso(deps) });
      updated += 1;
    }
    return ok(updated);
  } catch (error) {
    return explain(error);
  }
}
