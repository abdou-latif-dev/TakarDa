// Propriété locale des éléments synchronisés — P5. Registre de l'APPAREIL (par espace de travail, commun à tous les comptes) qui dit quel
// compte possède chaque élément : il empêche un compte de capturer, d'envoyer, de recevoir par-dessus ou de supprimer l'élément d'un autre.
//
// Règles :
//  - un élément reçu du cloud pour le compte X est inscrit au nom de X AVANT d'être écrit (une coupure laisse au pire une inscription sans
//    élément) ; pour un enregistrement du moteur générique, il porte aussi `cloudOwnerUid` (mécanisme de masquage d'affichage existant) ;
//  - un élément créé localement depuis l'activation de la synchronisation du compte X est inscrit au nom de X au moment où il est capturé ;
//  - un élément SANS propriétaire et antérieur à l'activation reste « ancien » : ni capturé, ni adopté (aucune migration) ;
//  - un élément d'un autre compte n'est ni visible pour le moteur, ni capturable, ni modifiable, ni supprimable par lui.
// Le registre n'écrit jamais dans les données métier.

import { createPersistentStore } from './localStore';
import { getKindDefinition, type Kind } from './kindRegistry';

export interface OwnershipData {
  schemaVersion: 1;
  /** identifiant d'élément → uid du compte propriétaire */
  owners: Record<string, string>;
}

export function validateOwnership(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['registre illisible'];
  const s = value as Record<string, unknown>;
  if (s.schemaVersion !== 1 || !s.owners || typeof s.owners !== 'object') return ['structure invalide'];
  return Object.entries(s.owners as Record<string, unknown>)
    .filter(([, uid]) => typeof uid !== 'string' || uid === '')
    .map(([id]) => `${id} : propriétaire invalide`);
}

/** Registre commun aux comptes de l'espace de travail (jamais sous une clé de compte : c'est lui qui les sépare). */
export const ownershipStore = createPersistentStore<OwnershipData>({
  baseKey: 'sync_owners',
  name: 'propriété des éléments',
  scope: 'workspace',
  empty: () => ({ schemaVersion: 1, owners: {} }),
  validate: validateOwnership,
});

/** Propriétaire d'un élément : registre d'abord, puis la marque d'affichage `cloudOwnerUid` des enregistrements du moteur générique. */
export function ownerOf(owners: Readonly<Record<string, string>>, kind: Kind, item: Record<string, unknown>): string | null {
  const registered = owners[typeof item.id === 'string' ? item.id : ''];
  if (registered) return registered;
  if (getKindDefinition(kind).source.type === 'core_record' && typeof item.cloudOwnerUid === 'string' && item.cloudOwnerUid !== '') return item.cloudOwnerUid;
  return null;
}

/** Visible pour le moteur du compte : à lui, ou sans propriétaire. Jamais à un autre compte. */
export const usableBy = (owner: string | null, account: string): boolean => owner === null || owner === account;

/** Inscrit des éléments au nom d'un compte. Refuse d'écraser le propriétaire d'un autre compte (retourne ceux refusés). */
export async function claimOwnership(account: string, ids: readonly string[]): Promise<string[]> {
  const refused: string[] = [];
  if (ids.length === 0) return refused;
  await ownershipStore.update((store) => {
    const owners = { ...store.owners };
    for (const id of ids) {
      if (owners[id] && owners[id] !== account) refused.push(id);
      else owners[id] = account;
    }
    return { ...store, owners };
  });
  return refused;
}

/** Rend sans propriétaire les éléments d'un compte (suppression de ce compte) : les données restent locales, visibles comme avant. */
export async function releaseOwnership(account: string): Promise<number> {
  let released = 0;
  await ownershipStore.update((store) => {
    const owners: Record<string, string> = {};
    for (const [id, uid] of Object.entries(store.owners)) {
      if (uid === account) released += 1;
      else owners[id] = uid;
    }
    return released > 0 ? { ...store, owners } : store;
  });
  return released;
}
