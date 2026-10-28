// Modules INDISPONIBLES en contexte multi-compte — phase 7.
//
// Constat : seuls Immobilier (biens, logements, contrats, paiements, dépenses, contacts locataires) et ses activités portent un propriétaire
// (`cloudOwnerUid`) et sont masqués par compte. Les tontines, formulaires, CEET/TDE (factures, relevés, participants), les outils génériques et les
// contacts qui ne sont pas des locataires restent des données LOCALES de l'appareil, sans propriétaire : un second compte connecté sur le même
// appareil les verrait. Les marquer par propriétaire exigerait de toucher les écrans, services et statistiques de chacun — une refonte hors périmètre.
//
// Décision (sûre, sans migration) : tant que le contexte est multi-compte, ces modules sont INDISPONIBLES, et la protection est appliquée AUSSI
// dans les services et la couche de données, pas seulement dans l'interface :
//   - couche de données générique (coreService) : les outils autres qu'Immobilier, leurs enregistrements, membres et événements sont introuvables
//     (lecture) ou refusés (écriture) ; les contacts qui ne sont ni locataires d'un contrat ni créés par le compte actif sont masqués ;
//   - services historiques (groupes/tontines, formulaires, réponses, modèles) : refus explicite (`ModuleLockedError`) via `guardService` ;
//   - notifications et compteurs de stockage : vides ; sauvegarde complète et restauration : refusées (elles manipulent TOUTES les données) ;
//   - journal d'activité, statistiques et accueil : filtrés ; liste des outils : sans les modules verrouillés ;
//   - interface : garde de navigation (ModuleLockGuard) en complément.
// Aucune donnée n'est supprimée, déplacée ni modifiée ; elles redeviennent accessibles dès que le contexte n'est plus multi-compte (déconnexion, ou un
// seul compte connu). Comptes fermés (drapeau) : rien n'est jamais verrouillé.

import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import type { ActivityEvent, ExternalContact, RecordItem } from '@/types/entities';
import { getActiveCloudUid } from './cloudVisibility';
import { records, tools } from './db';
import { isDeviceAccountsReliable, knownDeviceAccounts, ownersMarkedOnData } from './deviceAccounts';

export type LockableModule = 'tontine' | 'formulaires' | 'utility';
export const LOCKABLE_MODULES: readonly LockableModule[] = ['tontine', 'formulaires', 'utility'];

let flagOverride: boolean | null = null;

/** RÉSERVÉ AUX TESTS : simule l'ouverture du drapeau. Aucun code de production ne l'appelle (un test statique le vérifie). */
export function __useLockFlagForTests(open: boolean | null): void {
  flagOverride = open;
}
const flagOpen = (): boolean => flagOverride ?? CLOUD_ACCOUNT_ENABLED;

export interface LockContext {
  flagOpen: boolean;
  activeUid: string | null;
  /** Le registre des comptes est-il fiable (lu, sans échec d'écriture ni d'amorçage) ? Sinon le contexte multi-compte est présumé. */
  hydrated: boolean;
  known: readonly string[];
}

/** Décision pure : multi-compte = drapeau ouvert, compte actif, et un AUTRE compte connu sur l'appareil (ou registre non fiable : présumé). */
export function isMultiAccount(context: LockContext): boolean {
  if (!context.flagOpen || !context.activeUid) return false;
  if (!context.hydrated) return true;
  return context.known.some((uid) => uid !== context.activeUid);
}

export function currentLockContext(): LockContext {
  const activeUid = getActiveCloudUid();
  // comptes connus = registre ∪ marques de propriétaire présentes dans les données (jamais plus permissif que les données elles-mêmes)
  return { flagOpen: flagOpen(), activeUid, hydrated: isDeviceAccountsReliable(), known: [...new Set([...knownDeviceAccounts(), ...ownersMarkedOnData()])] };
}

/** Court-circuit : drapeau fermé ou sans compte → aucun calcul (appelé sur les chemins de données chauds). */
export function isMultiAccountContext(): boolean {
  if (!flagOpen() || !getActiveCloudUid()) return false;
  return isMultiAccount(currentLockContext());
}

export const isModuleLocked = (_module: LockableModule): boolean => isMultiAccountContext();

export class ModuleLockedError extends Error {
  readonly code = 'module_locked';
  constructor(readonly module: LockableModule | 'sauvegarde') {
    super(
      module === 'sauvegarde'
        ? 'La sauvegarde et la restauration complètes sont indisponibles tant que plusieurs comptes ont utilisé cet appareil : elles manipuleraient les données de tous les comptes. Rien n’a été modifié.'
        : 'Ce module est indisponible tant que plusieurs comptes ont utilisé cet appareil. Vos données sont conservées intactes.',
    );
    this.name = 'ModuleLockedError';
  }
}

export function assertModuleAvailable(module: LockableModule): void {
  if (isModuleLocked(module)) throw new ModuleLockedError(module);
}

/** Sauvegarde ou restauration complète : refusées en contexte multi-compte (elles lisent ou remplacent les données de TOUS les comptes). */
export function assertBackupAllowed(): void {
  if (isMultiAccountContext()) throw new ModuleLockedError('sauvegarde');
}

/**
 * Enveloppe les méthodes d'un service historique : chaque appel est refusé (`ModuleLockedError`) tant que le module est verrouillé, AVANT toute lecture
 * ou écriture de données. Les propriétés non fonctionnelles sont conservées ; `this` reste le service d'origine.
 */
export function guardService<T extends object>(module: LockableModule, service: T): T {
  const guarded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(service)) {
    guarded[key] =
      typeof value === 'function'
        ? (...args: unknown[]) => {
            assertModuleAvailable(module);
            return (value as (...a: unknown[]) => unknown).apply(service, args);
          }
        : value;
  }
  return guarded as T;
}

// ---- Couche de données générique (coreService) ----------------------------------------------------------------------------------

/** Outils verrouillés : tout outil qui n'est pas Immobilier (CEET/TDE, tontine, commerce, outils génériques) en contexte multi-compte. */
export function lockedToolIds(): Set<string> {
  if (!isMultiAccountContext()) return new Set();
  return new Set(tools.filter((t) => t.kind !== 'immobilier').map((t) => t.id));
}
export const isToolLockedForAccount = (toolId: string): boolean => isMultiAccountContext() && tools.some((t) => t.id === toolId && t.kind !== 'immobilier');

/** Création d'un outil d'un autre type qu'Immobilier : refusée en contexte multi-compte (jamais de doublon ni de données sans propriétaire). */
export function assertToolKindAvailable(kind: string): void {
  if (kind !== 'immobilier' && isMultiAccountContext()) throw new ModuleLockedError('utility');
}

/** Une pièce jointe est verrouillée si son outil, ou l'outil de son enregistrement, l'est (contexte multi-compte). */
export function isDocumentLocked(doc: { toolId?: string; recordId?: string }): boolean {
  if (!isMultiAccountContext()) return false;
  if (doc.toolId && isToolLockedForAccount(doc.toolId)) return true;
  const record = doc.recordId ? records.find((r) => r.id === doc.recordId) : undefined;
  return !!record && isToolLockedForAccount(record.toolId);
}

export function assertDocumentTargetAvailable(target: { toolId?: string; recordId?: string }): void {
  if (isDocumentLocked(target)) throw new ModuleLockedError('utility');
}

export function assertToolAvailable(toolId: string): void {
  if (isToolLockedForAccount(toolId)) throw new ModuleLockedError('utility');
}

/**
 * Contact masqué par le verrou : en contexte multi-compte, seuls restent visibles les locataires d'un contrat Immobilier et les contacts créés par le
 * compte actif (marque de propriétaire). Les autres (anciens contacts non liés, participants CEET/TDE) sont masqués, jamais supprimés.
 */
export function isContactLockedOut(contact: ExternalContact, all: readonly RecordItem[] = records): boolean {
  if (!isMultiAccountContext()) return false;
  if (contact.cloudOwnerUid && contact.cloudOwnerUid === getActiveCloudUid()) return false;
  const immobilierTools = new Set(tools.filter((t) => t.kind === 'immobilier').map((t) => t.id));
  return !all.some((r) => immobilierTools.has(r.toolId) && r.values.locataire_id === contact.id);
}

/** Marque à poser sur un contact créé en contexte multi-compte (il reste ainsi visible pour son créateur seul). */
export const ownerForNewContact = (): string | undefined => (isMultiAccountContext() ? (getActiveCloudUid() ?? undefined) : undefined);

// ---- Chemins d'écran, journal d'activité ----------------------------------------------------------------------------------------

const PATHS: { module: LockableModule; test: RegExp }[] = [
  { module: 'tontine', test: /^\/(tontine|tontines|group|new-activity)(\/|$)/ },
  { module: 'formulaires', test: /^\/(form|forms|modeles|records|scan)(\/|$)/ },
  { module: 'utility', test: /^\/(ceet|tde|factures|mes-outils)(\/|$)|\/facture-utility/ },
];

/** Module verrouillable auquel appartient un chemin d'écran (hors verrou : null). */
export function lockedModuleForPath(pathname: string): LockableModule | null {
  const clean = pathname.replace(/^\/\(tabs\)/, '').split('?')[0] || '/';
  return PATHS.find((p) => p.test.test(clean))?.module ?? null;
}

export const isPathLocked = (pathname: string): boolean => lockedModuleForPath(pathname) !== null && isMultiAccountContext();

// Activités : seuls les événements d'Immobilier sont attribuables à un compte ; les autres sont masqués en contexte multi-compte.
const NON_IMMOBILIER_TYPES = new Set<string>([
  'submission_validated', 'submission_rejected', 'contribution_added', 'member_joined', 'member_invited', 'form_submitted', 'form_created', 'form_updated', 'qr_scanned',
  'group_created', 'group_updated', 'activity_created', 'order_updated', 'cycle_completed', 'form_deleted', 'tontine_deleted',
]);

/** `multi` peut être fourni par l'appelant (calculé une seule fois pour toute une liste). */
export function isActivityLocked(event: Pick<ActivityEvent, 'module' | 'groupId' | 'type'>, multi: boolean = isMultiAccountContext()): boolean {
  if (!multi) return false;
  if (event.module === 'immobilier') return false;
  return event.module !== undefined || event.groupId !== undefined || NON_IMMOBILIER_TYPES.has(event.type) || event.type.startsWith('utility.');
}

