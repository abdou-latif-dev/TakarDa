// Registre LOCAL des espaces partagés d'un compte — F3b. Garde sur l'appareil : les espaces que ce compte a créés (identifiant, nom) et ceux qu'il a
// demandé à rejoindre (identifiant, dernier état connu). C'est un simple carnet d'adresses : il ne donne aucun accès (l'accès est jugé par le cloud),
// et l'état affiché n'est qu'une copie, rafraîchie à la demande. Propre au compte actif (clé `<clé>@<uid>`) : un autre compte du même appareil n'y a
// jamais accès. Aucun réseau, aucun SDK. Magasin illisible : jamais traité comme vide (erreur), comme les autres magasins locaux.

import { createAccountStore } from './accountStore';
import { isModuleId } from './model';
import type { AccessStatus } from './moduleFlows';

const STATUSES: readonly AccessStatus[] = ['none', 'pending', 'refused', 'approved_waiting', 'active', 'expired', 'revoked', 'left'];

export interface OwnedModuleEntry {
  moduleId: string;
  name: string;
  createdAt: string;
}

export interface JoinedModuleEntry {
  moduleId: string;
  /** Nom saisi par le demandeur dans sa demande. */
  label: string | null;
  requestedAt: string;
  /** Dernier état connu (copie locale). */
  status: AccessStatus;
  /** Nom de l'espace, connu seulement quand l'accès a été actif. */
  moduleName: string | null;
  checkedAt: string | null;
}

export interface LocalModulesData {
  schemaVersion: 1;
  owned: OwnedModuleEntry[];
  joined: JoinedModuleEntry[];
}

export function validateLocalModules(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['registre illisible'];
  const d = value as Record<string, unknown>;
  if (d.schemaVersion !== 1 || !Array.isArray(d.owned) || !Array.isArray(d.joined)) return ['structure invalide'];
  const problems: string[] = [];
  for (const o of d.owned as Record<string, unknown>[]) {
    if (!o || !isModuleId(o.moduleId) || typeof o.name !== 'string' || typeof o.createdAt !== 'string') problems.push('espace créé invalide');
  }
  for (const j of d.joined as Record<string, unknown>[]) {
    if (!j || !isModuleId(j.moduleId) || typeof j.requestedAt !== 'string' || !STATUSES.includes(j.status as AccessStatus)) problems.push('espace rejoint invalide');
    else if ((j.label !== null && typeof j.label !== 'string') || (j.moduleName !== null && typeof j.moduleName !== 'string') || (j.checkedAt !== null && typeof j.checkedAt !== 'string')) problems.push('espace rejoint invalide');
  }
  const ids = [...(d.owned as OwnedModuleEntry[]).map((o) => `o:${o.moduleId}`), ...(d.joined as JoinedModuleEntry[]).map((j) => `j:${j.moduleId}`)];
  if (new Set(ids).size !== ids.length) problems.push('identifiants en double');
  return problems;
}

export const localModulesStore = createAccountStore<LocalModulesData>({
  baseKey: 'shared_modules',
  name: 'espaces partagés',
  empty: () => ({ schemaVersion: 1, owned: [], joined: [] }),
  validate: validateLocalModules,
});

export const listLocalModules = (): Promise<LocalModulesData> => localModulesStore.load();

export const rememberOwnedModule = (entry: OwnedModuleEntry): Promise<LocalModulesData> =>
  localModulesStore.update((d) => (d.owned.some((o) => o.moduleId === entry.moduleId) ? d : { ...d, owned: [...d.owned, entry] }));

/** Retire un espace créé du carnet local (après sa suppression dans le cloud). */
export const forgetOwnedModule = (moduleId: string): Promise<LocalModulesData> => localModulesStore.update((d) => ({ ...d, owned: d.owned.filter((o) => o.moduleId !== moduleId) }));

export const renameOwnedEntry = (moduleId: string, name: string): Promise<LocalModulesData> =>
  localModulesStore.update((d) => ({ ...d, owned: d.owned.map((o) => (o.moduleId === moduleId ? { ...o, name } : o)) }));

/** Retient une demande envoyée (une entrée par espace : une nouvelle demande remplace l'ancienne entrée). */
export const rememberJoinedModule = (entry: JoinedModuleEntry): Promise<LocalModulesData> =>
  localModulesStore.update((d) => ({ ...d, joined: [...d.joined.filter((j) => j.moduleId !== entry.moduleId), entry] }));

export const updateJoinedStatus = (moduleId: string, patch: Partial<Pick<JoinedModuleEntry, 'status' | 'moduleName' | 'checkedAt'>>): Promise<LocalModulesData> =>
  localModulesStore.update((d) => ({ ...d, joined: d.joined.map((j) => (j.moduleId === moduleId ? { ...j, ...patch } : j)) }));

/** Oublie un espace rejoint dans ce carnet (n'agit pas sur le cloud). */
export const forgetJoinedModule = (moduleId: string): Promise<LocalModulesData> => localModulesStore.update((d) => ({ ...d, joined: d.joined.filter((j) => j.moduleId !== moduleId) }));
