// Port d'accès au cloud pour les modules partagés — F3b. Aucun SDK ici : la réalisation Firestore est dans services/firebase/firestoreModulesBackend.ts,
// une réalisation en mémoire (qui applique la politique de référence) sert aux tests. Les flux (moduleFlows.ts) ne parlent qu'à ce port.

import type { MemberDoc, ModuleDoc, RequestDoc, TenantItemDoc } from './model';

export type ModulesErrorCode = 'permission' | 'not_found' | 'exists' | 'network' | 'unknown';

export class ModulesError extends Error {
  constructor(readonly code: ModulesErrorCode, message: string) {
    super(message);
    this.name = 'ModulesError';
  }
}

export interface RequestDecision {
  state: 'approved' | 'refused';
  /** Propriétaire qui tranche. */
  decidedBy: string;
  at: string;
}

export interface ModulesBackend {
  /** Crée le module au nom du compte connecté ; `exists` si l'identifiant est déjà pris. */
  createModule(moduleId: string, doc: ModuleDoc): Promise<void>;
  /** Lecture du module (propriétaire ou locataire actif) ; null s'il n'existe pas ; `permission` sinon. */
  getModule(moduleId: string): Promise<ModuleDoc | null>;
  renameModule(moduleId: string, name: string): Promise<void>;

  /** « Rejoindre » : crée la demande du compte connecté. */
  createRequest(moduleId: string, doc: RequestDoc): Promise<void>;
  getRequest(moduleId: string, uid: string): Promise<RequestDoc | null>;
  listRequests(moduleId: string): Promise<RequestDoc[]>;
  /** Supprime la demande (le demandeur : en attente seulement ; le propriétaire : toute demande). */
  deleteRequest(moduleId: string, uid: string): Promise<void>;
  /**
   * Tranche une demande. Pour une approbation, la fiche du membre est créée DANS LA MÊME opération atomique (les règles l'exigent) ; pour un refus,
   * `member` est null.
   */
  decideRequest(moduleId: string, uid: string, decision: RequestDecision, member: MemberDoc | null): Promise<void>;

  getMember(moduleId: string, uid: string): Promise<MemberDoc | null>;
  listMembers(moduleId: string): Promise<MemberDoc[]>;
  /** Modification partielle d'une fiche de membre (état, contrat lié, fin d'accès, date). */
  updateMember(moduleId: string, uid: string, patch: Partial<Pick<MemberDoc, 'state' | 'contractId' | 'accessUntil' | 'updatedAt'>>): Promise<void>;

  // ---- Vue du locataire (F3c) : le propriétaire publie, le locataire lit sa propre vue ----------------------------------------------------
  /** Écrit des éléments de la vue de ce locataire (propriétaire seulement). */
  putTenantItems(moduleId: string, memberUid: string, items: TenantItemRecord[]): Promise<void>;
  /** Retire des éléments de la vue de ce locataire (propriétaire seulement). */
  deleteTenantItems(moduleId: string, memberUid: string, ids: string[]): Promise<void>;
  /** Lit la vue d'un locataire (le propriétaire, ou ce locataire seulement tant que son accès est actif). */
  listTenantItems(moduleId: string, memberUid: string): Promise<TenantItemRecord[]>;
}

export interface TenantItemRecord {
  id: string;
  doc: TenantItemDoc;
}
