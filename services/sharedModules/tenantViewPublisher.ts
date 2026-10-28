// Publication de la vue d'un locataire par le PROPRIÉTAIRE — F3c. Logique pure au-dessus du port : n'écrit que ce qui a CHANGÉ depuis la dernière publication
// (empreinte de chaque élément retenue localement), retire ce qui a disparu, et enregistre son état après chaque phase réussie. Aucun SDK, aucun réseau direct.
//
// Écriture d'abord, retrait ensuite : une coupure entre les deux laisse au locataire une vue légèrement trop complète (jamais incomplète) ; la publication
// suivante reprend. Retirer toute la vue (membre révoqué, parti, expiré) = publier une liste vide.

import { sha256Hex } from '../sha256';
import { validateTenantItem, type TenantItemDoc, type TenantItemKind } from './model';
import type { ModulesBackend } from './modulesPort';

export interface PublishedItemState {
  hash: string;
  rev: number;
}

export interface PublishedMemberState {
  items: Record<string, PublishedItemState>;
}

export interface DesiredItem {
  id: string;
  kind: TenantItemKind;
  body: Record<string, unknown>;
}

export interface PublishReport {
  written: number;
  deleted: number;
  /** Éléments identiques à la dernière publication : non réécrits. */
  unchanged: number;
}

/** Sérialisation stable (clés triées) : deux contenus égaux ont la même empreinte, quel que soit l'ordre des champs. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const hashOfItem = (item: Pick<DesiredItem, 'kind' | 'body'>): string => sha256Hex(canonicalJson({ kind: item.kind, body: item.body }));

/**
 * Aligne la vue publiée sur `desired`. Un élément invalide (type inconnu, champ non autorisé) fait échouer AVANT toute écriture : rien n'est publié à moitié.
 * `persist` enregistre l'état local après chaque phase réussie.
 */
export async function syncTenantView(
  deps: { backend: ModulesBackend; now: () => Date },
  moduleId: string,
  memberUid: string,
  desired: readonly DesiredItem[],
  previous: PublishedMemberState,
  persist: (state: PublishedMemberState) => Promise<void>,
): Promise<PublishReport> {
  const at = deps.now().toISOString();
  const docs = new Map<string, { doc: TenantItemDoc; hash: string }>();
  for (const item of desired) {
    const hash = hashOfItem(item);
    const rev = (previous.items[item.id]?.rev ?? 0) + 1;
    const doc: TenantItemDoc = { kind: item.kind, body: item.body, rev, updatedAt: at };
    const problems = validateTenantItem(doc);
    if (problems.length > 0) throw new Error(`Élément de vue invalide (${item.id}) : ${problems.join(' ; ')}`);
    docs.set(item.id, { doc, hash });
  }
  const toWrite = [...docs.entries()].filter(([id, d]) => previous.items[id]?.hash !== d.hash);
  const toDelete = Object.keys(previous.items).filter((id) => !docs.has(id));
  let state: PublishedMemberState = { items: { ...previous.items } };

  if (toWrite.length > 0) {
    await deps.backend.putTenantItems(moduleId, memberUid, toWrite.map(([id, d]) => ({ id, doc: d.doc })));
    for (const [id, d] of toWrite) state.items[id] = { hash: d.hash, rev: d.doc.rev };
    await persist(state);
  }
  if (toDelete.length > 0) {
    await deps.backend.deleteTenantItems(moduleId, memberUid, toDelete);
    state = { items: Object.fromEntries(Object.entries(state.items).filter(([id]) => !toDelete.includes(id))) };
    await persist(state);
  }
  return { written: toWrite.length, deleted: toDelete.length, unchanged: docs.size - toWrite.length };
}
