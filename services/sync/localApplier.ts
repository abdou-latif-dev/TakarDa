// Application LOCALE des changements reçus — P3. Interface + réalisation par défaut sur les collections en mémoire de l'application.
//
// Aucun service métier n'est utilisé pour écrire (pas de logique de loyers, de tours, de factures : un changement reçu est une
// donnée déjà validée par l'appareil qui l'a produite) ; l'écriture se limite au remplacement ou au retrait d'un élément dans sa
// collection, suivi de l'enregistrement habituel (`flushDb`). Ce module n'est appelé que EXPLICITEMENT (voir inbound.ts) : l'application
// ne l'utilise pas. Dans l'espace de démonstration, toute écriture est refusée.

import { contributions, externalContacts, forms, groups, memberships, records, submissions, tours } from '../db';
import { ensureFacturesTool } from '../facturesService';
import { ensureImmobilierTool } from '../immobilierService';
import { flushDb, snapshotCollections, workspaceId } from '../persistence';
import { collectSyncableItems, type LocalItem } from './changeScanner';
import { correctionStore } from './financialCorrection';
import { getKindDefinition, type Kind } from './kindRegistry';
import { claimOwnership, ownerOf, ownershipStore, usableBy } from './ownership';
import { requireSyncAccount } from './syncAccount';
import { isSyncKind } from './syncScope';
import { itemFromWire, type LocalIds, type WireRecord } from './wireFormat';

export interface LocalApplier {
  /** Éléments locaux synchronisables (y compris les corrections financières). Lecture seule. */
  snapshot(): Promise<LocalItem[]>;
  /** Crée ou remplace l'élément correspondant à l'enregistrement reçu. */
  upsert(wire: WireRecord): Promise<void>;
  /** Retire l'élément des collections VIVES (jamais d'effacement définitif : l'appelant en conserve une copie). Retourne l'élément retiré. */
  remove(kind: Kind, id: string): Promise<Record<string, unknown> | null>;
  /** Réinsère un élément précédemment retiré (restauration contrôlée). */
  insert(kind: Kind, item: Record<string, unknown>): Promise<void>;
}

const COLLECTIONS: Record<string, Record<string, unknown>[]> = {
  groups: groups as unknown as Record<string, unknown>[],
  memberships: memberships as unknown as Record<string, unknown>[],
  tours: tours as unknown as Record<string, unknown>[],
  contributions: contributions as unknown as Record<string, unknown>[],
  forms: forms as unknown as Record<string, unknown>[],
  submissions: submissions as unknown as Record<string, unknown>[],
  externalContacts: externalContacts as unknown as Record<string, unknown>[],
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function guard(): void {
  if (workspaceId() !== 'personal') throw new Error('L’espace de démonstration n’accepte aucun changement reçu.');
}

/** Tableau vif qui contient les éléments de ce type (null si le type n'est pas applicable localement). */
function arrayFor(kind: Kind): Record<string, unknown>[] | null {
  const source = getKindDefinition(kind).source;
  if (source.type === 'core_record') return records as unknown as Record<string, unknown>[];
  if (source.type === 'collection') return COLLECTIONS[source.collection] ?? null;
  return null;
}

async function localIdsFor(kind: Kind): Promise<LocalIds> {
  const source = getKindDefinition(kind).source;
  if (source.type !== 'core_record') throw new Error(`${kind} n’est pas un enregistrement du moteur générique.`);
  if (source.toolKind === 'immobilier') {
    const ents = await ensureImmobilierTool();
    const definition = (ents as unknown as Record<string, { id: string }>)[source.entityKey];
    if (!definition) throw new Error(`Définition locale introuvable pour ${kind}.`);
    return { toolId: ents.tool.id, entityDefinitionId: definition.id };
  }
  const ents = await ensureFacturesTool();
  const byKey: Record<string, { id: string }> = {
    facture: ents.entityDefinition,
    releve: ents.releveDefinition,
    facture_partagee: ents.facturePartageeDefinition,
    part_locataire: ents.partLocataireDefinition,
    participation: ents.participationDefinition,
  };
  const definition = byKey[source.entityKey];
  if (!definition) throw new Error(`Définition locale introuvable pour ${kind}.`);
  return { toolId: ents.tool.id, entityDefinitionId: definition.id };
}

/**
 * Applicateur par défaut, lié à UN compte (le compte de synchronisation actif si non précisé). ISOLATION : il ne voit, ne remplace, ne retire
 * ni ne restaure jamais l'élément d'un autre compte ; un élément reçu est inscrit au nom du compte AVANT d'être écrit.
 */
export function createDefaultApplier(boundAccount?: string): LocalApplier {
  const account = boundAccount ?? requireSyncAccount();
  const foreign = (owners: Record<string, string>, kind: Kind, item: Record<string, unknown> | undefined): boolean => !!item && !usableBy(ownerOf(owners, kind, item), account);
  const existingItem = (kind: Kind, id: string): Record<string, unknown> | undefined => arrayFor(kind)?.find((x) => x.id === id);
  return {
    async snapshot() {
      const corrections = Object.values((await correctionStore.load()).items) as unknown as Record<string, unknown>[];
      const { items } = collectSyncableItems(snapshotCollections(), corrections);
      const owners = (await ownershipStore.load()).owners;
      return items.filter((i) => getKindDefinition(i.kind).source.type === 'store' || usableBy(ownerOf(owners, i.kind, i.item), account));
    },

    async upsert(wire) {
      guard();
      if (wire.ownerUid !== account) throw new Error('Cet enregistrement n’appartient pas au compte actif : refusé.');
      if (!isSyncKind(wire.kind)) throw new Error('Type hors du périmètre de la synchronisation (Immobilier seul) : refusé.');
      const source = getKindDefinition(wire.kind).source;
      if (source.type === 'store') {
        await correctionStore.update((store) => ({ ...store, items: { ...store.items, [wire.id]: itemFromWire(wire, null) as never } }));
        return;
      }
      const list = arrayFor(wire.kind);
      if (!list) throw new Error(`Aucune collection locale pour ${wire.kind}.`);
      const owners = (await ownershipStore.load()).owners;
      if (foreign(owners, wire.kind, existingItem(wire.kind, wire.id))) throw new Error('Un élément portant cet identifiant appartient à un autre compte : refusé, rien n’est écrasé.');
      if ((await claimOwnership(account, [wire.id])).length > 0) throw new Error('Cet identifiant appartient à un autre compte : refusé.'); // inscrit AVANT l'écriture
      const index = list.findIndex((x) => x.id === wire.id);
      const existing = index >= 0 ? list[index] : null;
      const needsIds = !existing && source.type === 'core_record';
      const item = itemFromWire(wire, existing, needsIds ? await localIdsFor(wire.kind) : undefined);
      if (index >= 0) list[index] = item;
      else list.push(item);
      await flushDb();
    },

    async remove(kind, id) {
      guard();
      if (!isSyncKind(kind)) throw new Error('Type hors du périmètre de la synchronisation (Immobilier seul) : refusé.');
      if (getKindDefinition(kind).source.type === 'store') throw new Error('Un fait financier de correction ne se retire jamais.');
      const list = arrayFor(kind);
      const index = list ? list.findIndex((x) => x.id === id) : -1;
      if (!list || index < 0) return null;
      if (foreign((await ownershipStore.load()).owners, kind, list[index])) throw new Error('Cet élément appartient à un autre compte : suppression refusée.');
      const [removed] = list.splice(index, 1);
      await flushDb();
      return clone(removed);
    },

    async insert(kind, item) {
      guard();
      if (!isSyncKind(kind)) throw new Error('Type hors du périmètre de la synchronisation (Immobilier seul) : refusé.');
      const list = arrayFor(kind);
      if (!list) throw new Error(`Aucune collection locale pour ${kind}.`);
      if (list.some((x) => x.id === item.id)) throw new Error('Un élément portant cet identifiant existe déjà : restauration refusée.');
      if ((await claimOwnership(account, [String(item.id)])).length > 0) throw new Error('Cet identifiant appartient à un autre compte : restauration refusée.');
      list.push(clone(item));
      await flushDb();
    },
  };
}
