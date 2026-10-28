// Modèle des MODULES PARTAGÉS — F3a. Pur : aucun SDK, aucun réseau, aucune écriture, rien n'est branché à l'application.
//
// Un module est un espace de données partageable (V1 : Immobilier), distinct de l'espace personnel (`spaces/personal_<uid>`), dont il ne
// modifie aucune règle. Chemins Firestore (candidat firestore.p5.rules, NON publié) :
//
//   modules/{moduleId}                              le module : propriétaire immuable, type, nom
//   modules/{moduleId}/members/{uid}                un membre (V1 : un locataire) : état, contrat lié, fin d'accès
//   modules/{moduleId}/requests/{uid}               la demande d'accès de cet utilisateur (une seule par utilisateur)
//   modules/{moduleId}/syncRecords/{recordId}       les données du module (même modèle que les documents de synchronisation V1)
//   modules/{moduleId}/tenantViews/{uid}/items/{id} vue en lecture seule destinée à CE locataire (projection : aucun champ privé)
//
// Décisions de V1 retenues par défaut (à confirmer avant F3b, voir docs/f3a-espaces-partages.md) :
//   - l'ADMINISTRATEUR EST LE PROPRIÉTAIRE du module (un seul administrateur) ; les membres ne sont que des locataires ;
//   - un membre est lié à UN contrat ; la demande est identifiée par l'utilisateur (une demande par utilisateur et par module) ;
//   - un refus est conservé : le demandeur refusé reste bloqué tant que le propriétaire n'a pas supprimé la demande.

export const MODULES_COLLECTION = 'modules';
export const MEMBERS_COLLECTION = 'members';
export const REQUESTS_COLLECTION = 'requests';
export const MODULE_SYNC_COLLECTION = 'syncRecords';
export const TENANT_VIEWS_COLLECTION = 'tenantViews';
export const TENANT_ITEMS_COLLECTION = 'items';

export const MODULE_TYPES = ['immobilier'] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

/** V1 : un seul rôle de membre. L'administrateur est le propriétaire du module, pas un membre. */
export const MEMBER_ROLES = ['locataire'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_STATES = ['active', 'revoked', 'left'] as const;
export type MemberState = (typeof MEMBER_STATES)[number];

export const REQUEST_STATES = ['pending', 'approved', 'refused'] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

/** Durée de lecture conservée par un locataire après la fin de son contrat. */
export const ACCESS_AFTER_CONTRACT_DAYS = 90;

export const MODULE_NAME_MAX = 100;
export const REQUEST_LABEL_MAX = 60;
export const TIMESTAMP_MAX = 40;

export const MODULE_DOC_FIELDS = ['ownerUid', 'type', 'name', 'createdAt', 'schemaVersion'] as const;
export const MEMBER_DOC_FIELDS = ['uid', 'role', 'state', 'contractId', 'accessUntil', 'addedBy', 'createdAt', 'updatedAt'] as const;
export const REQUEST_DOC_FIELDS = ['uid', 'state', 'label', 'decidedBy', 'createdAt', 'updatedAt'] as const;
/** Document d'une vue locataire : projection destinée à UN locataire ; jamais de champ privé (voir la classification, section 4 des décisions). */
export const TENANT_ITEM_FIELDS = ['kind', 'body', 'rev', 'updatedAt'] as const;

export interface ModuleDoc {
  ownerUid: string;
  type: ModuleType;
  name: string;
  createdAt: string;
  schemaVersion: 1;
  /** Verrou d'effacement posé par le propriétaire (irréversible) : plus aucune écriture, plus aucune lecture de locataire. Absent = module ouvert. */
  deletionLockedAt?: string;
}

export interface MemberDoc {
  uid: string;
  role: MemberRole;
  state: MemberState;
  /** Contrat auquel l'accès est lié (V1 : un seul). */
  contractId: string | null;
  /** Fin de l'accès en lecture (ISO ici ; un `Timestamp` Firestore dans le cloud, seul comparable à l'heure du serveur par les règles). null = pas de fin. */
  accessUntil: string | null;
  addedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RequestDoc {
  uid: string;
  state: RequestState;
  /** Nom saisi par le demandeur pour se faire reconnaître (facultatif ; aucun e-mail n'est stocké). */
  label: string | null;
  /** Propriétaire qui a tranché ; null tant que la demande est en attente. */
  decidedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- Identifiant du module ---------------------------------------------------------------------------------------------------------

export const MODULE_ID_PREFIX = 'mod_';
export const MODULE_ID_SUFFIX_LENGTH = 24;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const MODULE_ID_PATTERN = /^mod_[a-z0-9]{24}$/;
/** Même motif que celui des règles (`matches`) : un test compare les deux. */
export const MODULE_ID_RULE_PATTERN = 'mod_[a-z0-9]{24}';

export const isModuleId = (value: unknown): value is string => typeof value === 'string' && MODULE_ID_PATTERN.test(value);

/**
 * Identifiant aléatoire. C'est une ADRESSE, pas un mot de passe : le connaître ne donne aucun accès (une demande doit être approuvée). La source
 * d'aléa est injectable ; par défaut `crypto.getRandomValues` s'il existe, sinon `Math.random` (moins fort : suffisant pour une adresse, jamais
 * pour un secret).
 */
export function generateModuleId(randomBytes?: (count: number) => Uint8Array): string {
  const fromCrypto = (count: number): Uint8Array | null => {
    const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
    return c?.getRandomValues ? c.getRandomValues(new Uint8Array(count)) : null;
  };
  const bytes = randomBytes?.(MODULE_ID_SUFFIX_LENGTH) ?? fromCrypto(MODULE_ID_SUFFIX_LENGTH) ?? Uint8Array.from({ length: MODULE_ID_SUFFIX_LENGTH }, () => Math.floor(Math.random() * 256));
  let suffix = '';
  for (let i = 0; i < MODULE_ID_SUFFIX_LENGTH; i += 1) suffix += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return MODULE_ID_PREFIX + suffix;
}

// ---- Validation (même contrat que les règles candidates) ---------------------------------------------------------------------------

const isShortText = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= TIMESTAMP_MAX;
const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): string[] => Object.keys(value).filter((k) => !allowed.includes(k)).map((k) => `champ inconnu : ${k}`);
const missingKeys = (value: Record<string, unknown>, required: readonly string[]): string[] => required.filter((k) => !(k in value)).map((k) => `champ manquant : ${k}`);
const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);

export function validateModuleDoc(value: unknown): string[] {
  const d = asRecord(value);
  if (!d) return ['module illisible'];
  const problems = [...onlyKeys(d, MODULE_DOC_FIELDS), ...missingKeys(d, MODULE_DOC_FIELDS)];
  if (typeof d.ownerUid !== 'string' || d.ownerUid === '') problems.push('propriétaire invalide');
  if (!isOneOf(MODULE_TYPES, d.type)) problems.push('type de module inconnu');
  if (typeof d.name !== 'string' || d.name.length < 1 || d.name.length > MODULE_NAME_MAX) problems.push('nom invalide');
  if (!isShortText(d.createdAt)) problems.push('date de création invalide');
  if (d.schemaVersion !== 1) problems.push('version de schéma inconnue');
  return problems;
}

export function validateMemberDoc(value: unknown): string[] {
  const d = asRecord(value);
  if (!d) return ['membre illisible'];
  const problems = [...onlyKeys(d, MEMBER_DOC_FIELDS), ...missingKeys(d, MEMBER_DOC_FIELDS)];
  if (typeof d.uid !== 'string' || d.uid === '') problems.push('identifiant invalide');
  if (!isOneOf(MEMBER_ROLES, d.role)) problems.push('rôle inconnu');
  if (!isOneOf(MEMBER_STATES, d.state)) problems.push('état inconnu');
  if (d.contractId !== null && (typeof d.contractId !== 'string' || d.contractId === '' || d.contractId.length > 100)) problems.push('contrat invalide');
  if (d.accessUntil !== null && !isShortText(d.accessUntil)) problems.push('fin d’accès invalide');
  if (typeof d.addedBy !== 'string' || d.addedBy === '') problems.push('auteur invalide');
  if (!isShortText(d.createdAt) || !isShortText(d.updatedAt)) problems.push('dates invalides');
  return problems;
}

export function validateRequestDoc(value: unknown): string[] {
  const d = asRecord(value);
  if (!d) return ['demande illisible'];
  const problems = [...onlyKeys(d, REQUEST_DOC_FIELDS), ...missingKeys(d, REQUEST_DOC_FIELDS)];
  if (typeof d.uid !== 'string' || d.uid === '') problems.push('identifiant invalide');
  if (!isOneOf(REQUEST_STATES, d.state)) problems.push('état inconnu');
  if (d.label !== null && (typeof d.label !== 'string' || d.label.length < 1 || d.label.length > REQUEST_LABEL_MAX)) problems.push('nom invalide');
  if (d.decidedBy !== null && (typeof d.decidedBy !== 'string' || d.decidedBy === '')) problems.push('décideur invalide');
  if (!isShortText(d.createdAt) || !isShortText(d.updatedAt)) problems.push('dates invalides');
  return problems;
}

// ---- États : transitions autorisées ------------------------------------------------------------------------------------------------

export type Actor = 'owner' | 'member';

/**
 * Transitions de l'état d'un membre. Le propriétaire révoque (`active → revoked`) et peut rétablir (`revoked|left → active`, après un nouvel
 * accord) ; le membre, lui, ne peut que partir (`active → left`). Aucune autre transition : jamais un membre qui se rétablit lui-même.
 */
export function canTransitionMember(from: MemberState, to: MemberState, actor: Actor): boolean {
  if (actor === 'member') return from === 'active' && to === 'left';
  return (from === 'active' && to === 'revoked') || ((from === 'revoked' || from === 'left') && to === 'active');
}

/** Transitions de l'état d'une demande : seul le propriétaire tranche, une fois ; une demande tranchée ne change plus. */
export function canTransitionRequest(from: RequestState, to: RequestState): boolean {
  return from === 'pending' && (to === 'approved' || to === 'refused');
}

// ---- Fin d'accès -------------------------------------------------------------------------------------------------------------------

/** Fin d'accès d'un locataire : fin de la journée de fin de contrat + 90 jours (UTC). `endDay` au format AAAA-MM-JJ. */
export function accessUntilForContractEnd(endDay: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDay)) return null;
  const start = Date.parse(`${endDay}T00:00:00.000Z`);
  if (Number.isNaN(start)) return null;
  return new Date(start + (1 + ACCESS_AFTER_CONTRACT_DAYS) * 86_400_000).toISOString();
}

/** Ce membre peut-il lire sa vue en ce moment ? État actif, rôle locataire, et fin d'accès non dépassée (comparaison stricte : à l'instant de fin, c'est fini). */
export function isTenantAccessActive(member: Pick<MemberDoc, 'role' | 'state' | 'accessUntil'> | null | undefined, now: Date): boolean {
  if (!member || member.role !== 'locataire' || member.state !== 'active') return false;
  if (member.accessUntil === null) return true;
  const until = Date.parse(member.accessUntil);
  return Number.isFinite(until) && now.getTime() < until;
}

// ---- Vue du locataire (F3c) ----------------------------------------------------------------------------------------------------------
//
// Projection publiée par le propriétaire pour UN locataire, un document par élément (`tenantViews/{uid}/items/{itemId}` : kind, body, rev, updatedAt).
// Les règles candidates n'acceptent que ces types et, pour chacun, que ces champs : un champ privé (notes, raisons de correction, champs personnalisés,
// dépenses, mode de paiement, nom du bien ou du propriétaire, loyer de référence, e-mail ou note du contact…) est refusé par le cloud même si le code
// de projection se trompait. Classification : section 4 des décisions. Décision du propriétaire du projet sur les points 4.3 : sont VISIBLES le nom du bien, le mode
// de paiement, l'e-mail et la note du contact, le nom du propriétaire (reçus) et le loyer de référence du logement. Restent PRIVÉS : notes libres du contrat
// et des paiements, raisons de correction ou d'annulation, champs personnalisés, dépenses, statistiques, autres locataires et contrats, journal brut, métadonnées.

export const TENANT_ITEM_KINDS = ['contrat', 'logement', 'paiement', 'avance', 'retards', 'evenement'] as const;
export type TenantItemKind = (typeof TENANT_ITEM_KINDS)[number];

export const TENANT_BODY_FIELDS: Record<TenantItemKind, readonly string[]> = {
  contrat: ['statut', 'locataireNom', 'locataireTelephone', 'locataireEmail', 'locataireNote', 'proprietaireNom', 'loyerMensuel', 'dateEntree', 'dateSortie', 'jourEcheance', 'dernierLoyerPaye', 'caution', 'avance'],
  logement: ['nom', 'type', 'cuisine', 'wc', 'adresse', 'nomBien', 'loyerReference'],
  paiement: ['mois', 'montant', 'statut', 'dateValidation', 'modePaiement', 'reference', 'retardsALaDate'],
  avance: ['montant', 'consomme', 'disponible', 'moisCouverts'],
  retards: ['fiable', 'mois', 'jourEcheance', 'calculeLe'],
  evenement: ['type', 'date', 'mois'],
};

export const TENANT_BODY_MAX_KEYS = 20;

export const isTenantItemKind = (value: unknown): value is TenantItemKind => typeof value === 'string' && (TENANT_ITEM_KINDS as readonly string[]).includes(value);

export interface TenantItemDoc {
  kind: TenantItemKind;
  body: Record<string, unknown>;
  rev: number;
  updatedAt: string;
}

/** Contrôle d'un élément de vue : type connu, uniquement les champs autorisés pour ce type (même contrat que les règles). */
export function validateTenantItem(value: unknown): string[] {
  const d = asRecord(value);
  if (!d) return ['élément illisible'];
  const problems = [...onlyKeys(d, ['kind', 'body', 'rev', 'updatedAt']), ...missingKeys(d, ['kind', 'body', 'rev', 'updatedAt'])];
  if (!isTenantItemKind(d.kind)) return [...problems, 'type d’élément inconnu'];
  const body = asRecord(d.body);
  if (!body) problems.push('contenu illisible');
  else {
    problems.push(...onlyKeys(body, TENANT_BODY_FIELDS[d.kind]).map((p) => `${p} (non autorisé pour « ${d.kind} »)`));
    if (Object.keys(body).length > TENANT_BODY_MAX_KEYS) problems.push('contenu trop grand');
  }
  if (typeof d.rev !== 'number' || !Number.isInteger(d.rev)) problems.push('révision invalide');
  if (!isShortText(d.updatedAt)) problems.push('date invalide');
  return problems;
}
