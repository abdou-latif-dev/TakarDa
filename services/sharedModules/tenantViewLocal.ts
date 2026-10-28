// Données locales de la vue du locataire — F3c.
//   - côté PROPRIÉTAIRE : ce qui a déjà été publié pour chaque locataire (empreintes), pour ne réécrire que les changements ;
//   - côté LOCATAIRE : la copie en lecture seule de SA vue, rangée À PART de ses propres données (jamais dans les collections de l'application), propre au
//     compte (un autre compte du même appareil ne la lit jamais) et à l'espace de travail.
// Magasins illisibles : jamais traités comme vides (erreur). Aucun réseau, aucun SDK.

import { createAccountStore } from './accountStore';
import { isModuleId, validateTenantItem, type TenantItemKind } from './model';
import type { PublishedMemberState } from './tenantViewPublisher';

// ---- Propriétaire : état publié ------------------------------------------------------------------------------------------------------

export interface PublishedData {
  schemaVersion: 1;
  /** Clé « moduleId/uid du locataire ». */
  members: Record<string, PublishedMemberState>;
}

export function validatePublished(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['état de publication illisible'];
  const d = value as Record<string, unknown>;
  if (d.schemaVersion !== 1 || !d.members || typeof d.members !== 'object') return ['structure invalide'];
  const problems: string[] = [];
  for (const [key, member] of Object.entries(d.members as Record<string, unknown>)) {
    const items = (member as { items?: unknown } | null)?.items;
    if (!/^mod_[a-z0-9]{24}\/.+/.test(key) || !items || typeof items !== 'object') problems.push(`${key} : invalide`);
    else for (const [id, s] of Object.entries(items as Record<string, unknown>)) if (typeof (s as { hash?: unknown })?.hash !== 'string' || !Number.isInteger((s as { rev?: unknown }).rev)) problems.push(`${key}/${id} : invalide`);
  }
  return problems;
}

const publishedStore = createAccountStore<PublishedData>({ baseKey: 'tenant_view_published', name: 'vues publiées', empty: () => ({ schemaVersion: 1, members: {} }), validate: validatePublished });
const memberKey = (moduleId: string, memberUid: string): string => `${moduleId}/${memberUid}`;

export async function loadPublishedState(moduleId: string, memberUid: string): Promise<PublishedMemberState> {
  return (await publishedStore.load()).members[memberKey(moduleId, memberUid)] ?? { items: {} };
}

export async function savePublishedState(moduleId: string, memberUid: string, state: PublishedMemberState): Promise<void> {
  await publishedStore.update((d) => {
    const members = { ...d.members };
    if (Object.keys(state.items).length === 0) delete members[memberKey(moduleId, memberUid)];
    else members[memberKey(moduleId, memberUid)] = state;
    return { ...d, members };
  });
}

/** Oublie l'état publié de TOUS les locataires d'un espace (espace supprimé). */
export async function purgePublishedForModule(moduleId: string): Promise<void> {
  await publishedStore.update((d) => ({ ...d, members: Object.fromEntries(Object.entries(d.members).filter(([key]) => !key.startsWith(`${moduleId}/`))) }));
}

// ---- Locataire : copie reçue ---------------------------------------------------------------------------------------------------------

export interface ReceivedItem {
  kind: TenantItemKind;
  body: Record<string, unknown>;
  updatedAt: string;
}

export interface TenantViewCopy {
  moduleId: string;
  fetchedAt: string;
  /** Fin d'accès connue au moment de la lecture ; au-delà, la copie n'est plus montrée ni conservée. */
  accessUntil: string | null;
  moduleName: string | null;
  items: Record<string, ReceivedItem>;
}

export interface ReceivedData {
  schemaVersion: 1;
  copies: Record<string, TenantViewCopy>;
}

export function validateReceived(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['copie illisible'];
  const d = value as Record<string, unknown>;
  if (d.schemaVersion !== 1 || !d.copies || typeof d.copies !== 'object') return ['structure invalide'];
  const problems: string[] = [];
  for (const [moduleId, copy] of Object.entries(d.copies as Record<string, TenantViewCopy>)) {
    if (!isModuleId(moduleId) || !copy || copy.moduleId !== moduleId || typeof copy.fetchedAt !== 'string' || (copy.accessUntil !== null && typeof copy.accessUntil !== 'string') || !copy.items || typeof copy.items !== 'object') {
      problems.push(`${moduleId} : copie invalide`);
      continue;
    }
    for (const [id, item] of Object.entries(copy.items)) {
      const p = validateTenantItem({ ...item, rev: 1 });
      if (p.length > 0) problems.push(`${moduleId}/${id} : ${p[0]}`);
    }
  }
  return problems;
}

const receivedStore = createAccountStore<ReceivedData>({ baseKey: 'tenant_view_received', name: 'copie de ma vue', empty: () => ({ schemaVersion: 1, copies: {} }), validate: validateReceived });

export async function loadViewCopy(moduleId: string): Promise<TenantViewCopy | null> {
  return (await receivedStore.load()).copies[moduleId] ?? null;
}

export async function saveViewCopy(copy: TenantViewCopy): Promise<void> {
  await receivedStore.update((d) => ({ ...d, copies: { ...d.copies, [copy.moduleId]: copy } }));
}

/** Supprime la copie locale de ma vue (accès retiré, quitté ou expiré). N'agit pas sur le cloud. */
export async function purgeViewCopy(moduleId: string): Promise<void> {
  await receivedStore.update((d) => {
    const copies = { ...d.copies };
    delete copies[moduleId];
    return { ...d, copies };
  });
}
