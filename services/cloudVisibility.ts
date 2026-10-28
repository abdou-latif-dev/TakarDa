// Visibilité locale des données selon le compte cloud connecté.
//
// Un enregistrement reçu du cloud, ou créé puis suivi par la synchronisation d'un compte, porte `cloudOwnerUid`.
// Il n'est visible que pour ce compte : ni sans compte, ni pour un autre compte. Rien n'est supprimé : les données
// restent en stockage et réapparaissent à la reconnexion de leur propriétaire.
// Les enregistrements historiques (sans `cloudOwnerUid`) restent visibles pour tous, comme avant.
//
// Le masquage se propage aux enregistrements qui pointent vers un enregistrement masqué par un champ « relation »
// déclaré dans leur définition d'entité (contrat → logement, paiement → contrat, …). Aucune autre valeur n'est
// interprétée comme une référence.
//
// Module pur, sans SDK : la synchronisation l'utilise avec l'UID de SON compte, jamais avec le compte actif.

import { entityDefinitions, externalContacts as dbContacts, records as dbRecords, tools } from './db';
import type { CoreEvent, ExternalContact, RecordItem } from '@/types/entities';

let activeUid: string | null = null;
let epoch = 0;
let stampUid: string | null = null;
// Compte en mode MOTEUR (nouveau moteur choisi) : marque aussi ses créations, comme la V1 (la V1 et le moteur sont exclusifs : un seul des deux est posé).
let engineStampUid: string | null = null;

/** Compte actuellement connecté (null = mode sans compte). Mis à jour par le store du compte. Chaque changement de compte
 * incrémente l'époque : les résultats asynchrones lancés sous un ancien compte peuvent ainsi être écartés. */
export function setActiveCloudUid(uid: string | null): void {
  if (uid !== activeUid) epoch += 1;
  activeUid = uid;
}

/** Numéro de session de compte : change à chaque changement de compte (connexion, déconnexion, autre compte). */
export function getAccountEpoch(): number {
  return epoch;
}

/** Compte dont la synchronisation est ACTIVÉE (connecté + activée), sinon null : seul ce compte marque les créations. */
export function setCloudStampUid(uid: string | null): void {
  stampUid = uid;
}

/** Compte dont le NOUVEAU MOTEUR est choisi : ses créations sont marquées à son nom (jamais visibles pour un autre compte de l'appareil). */
export function setEngineStampUid(uid: string | null): void {
  engineStampUid = uid;
}

/** Compte qui marque les créations (synchronisation V1 activée, ou nouveau moteur choisi), sinon null. */
export const getCloudStampUid = (): string | null => stampUid ?? engineStampUid;

/**
 * Pose la marque d'affichage `cloudOwnerUid` sur des éléments locaux qui n'en ont pas, au nom du compte qui vient de les revendiquer (registre de propriété
 * du moteur). Couvre ce qui a été créé AVANT la première capture. N'écrase jamais la marque d'un autre compte, ne modifie aucune donnée métier.
 */
export function stampDisplayOwner(ids: readonly string[], account: string): number {
  const wanted = new Set(ids);
  let stamped = 0;
  for (const record of dbRecords) {
    if (wanted.has(record.id) && !record.cloudOwnerUid) {
      record.cloudOwnerUid = account;
      stamped += 1;
    }
  }
  for (const contact of dbContacts) {
    if (wanted.has(contact.id) && !contact.cloudOwnerUid) {
      contact.cloudOwnerUid = account;
      stamped += 1;
    }
  }
  return stamped;
}

/** Propriétaire à inscrire sur un enregistrement qui vient d'être créé. Même règle que le suivi de la synchronisation :
 * un bien créé pendant que la synchronisation est activée ; un logement dont le bien porte déjà la marque de ce compte.
 * Tout le reste (contrats, paiements, anciennes données…) n'est pas marqué ici. */
export function ownerForNewRecord(record: Pick<RecordItem, 'entityDefinitionId' | 'toolId' | 'values'>): string | undefined {
  const owner = stampUid ?? engineStampUid;
  if (!owner) return undefined;
  if (tools.find((t) => t.id === record.toolId)?.kind !== 'immobilier') return undefined;
  const key = entityDefinitions.find((d) => d.id === record.entityDefinitionId)?.key;
  if (key === 'bien') return owner;
  if (key === 'logement') {
    const parent = dbRecords.find((r) => r.id === record.values.bien);
    return parent?.cloudOwnerUid === owner ? owner : undefined;
  }
  return undefined;
}

export function getActiveCloudUid(): string | null {
  return activeUid;
}

const ownedByOther = (record: RecordItem, uid: string | null): boolean => !!record.cloudOwnerUid && record.cloudOwnerUid !== uid;

function relationKeysByDefinition(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const definition of entityDefinitions) {
    const keys = definition.fields.filter((f) => f.type === 'relation').map((f) => f.key);
    if (keys.length > 0) map.set(definition.id, keys);
  }
  return map;
}

function referencedIds(record: RecordItem, relationKeys: Map<string, string[]>): string[] {
  const out: string[] = [];
  for (const key of relationKeys.get(record.entityDefinitionId) ?? []) {
    const value = record.values[key];
    if (typeof value === 'string' && value) out.push(value);
    else if (Array.isArray(value)) for (const item of value) if (typeof item === 'string' && item) out.push(item);
  }
  return out;
}

/** Identifiants masqués pour `uid` : enregistrements d'un autre compte + ceux qui en dépendent (jusqu'à stabilité). */
export function hiddenRecordIds(all: readonly RecordItem[], uid: string | null): Set<string> {
  const hidden = new Set<string>();
  for (const record of all) if (ownedByOther(record, uid)) hidden.add(record.id);
  if (hidden.size === 0) return hidden; // cas courant : aucune donnée d'un autre compte
  const relationKeys = relationKeysByDefinition();
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of all) {
      if (hidden.has(record.id) || record.cloudOwnerUid === uid) continue; // ce qui est à soi n'est jamais masqué
      if (referencedIds(record, relationKeys).some((id) => hidden.has(id))) {
        hidden.add(record.id);
        changed = true;
      }
    }
  }
  return hidden;
}

/** Enregistrements visibles pour `uid` (null = sans compte). */
export function visibleRecordsFor(all: readonly RecordItem[], uid: string | null): RecordItem[] {
  const hidden = hiddenRecordIds(all, uid);
  return hidden.size === 0 ? [...all] : all.filter((r) => !hidden.has(r.id));
}

export function isRecordVisible(record: RecordItem, all: readonly RecordItem[], uid: string | null): boolean {
  return !hiddenRecordIds(all, uid).has(record.id);
}

/**
 * Contacts masqués pour `uid` : ceux d'un autre compte (marque `cloudOwnerUid`, posée à la réception), et les locataires qui ne servent QUE des
 * contrats masqués (le champ `locataire_id` est un texte, pas une relation déclarée : le masquage des enregistrements ne les atteint pas).
 * Un contact encore utilisé par un contrat visible reste visible. Les contacts historiques sans marque et sans contrat masqué restent visibles.
 */
export function hiddenContactIds(contacts: readonly ExternalContact[], all: readonly RecordItem[], uid: string | null): Set<string> {
  const hidden = new Set<string>();
  const hiddenRecords = hiddenRecordIds(all, uid);
  for (const contact of contacts) {
    if (contact.cloudOwnerUid && contact.cloudOwnerUid !== uid) {
      hidden.add(contact.id);
      continue;
    }
    if (hiddenRecords.size === 0) continue;
    const users = all.filter((r) => r.values.locataire_id === contact.id);
    if (users.length > 0 && users.every((r) => hiddenRecords.has(r.id))) hidden.add(contact.id);
  }
  return hidden;
}

export function visibleContactsFor(contacts: readonly ExternalContact[], all: readonly RecordItem[], uid: string | null): ExternalContact[] {
  const hidden = hiddenContactIds(contacts, all, uid);
  return hidden.size === 0 ? [...contacts] : contacts.filter((c) => !hidden.has(c.id));
}

export function isContactVisible(contact: ExternalContact, contacts: readonly ExternalContact[], all: readonly RecordItem[], uid: string | null): boolean {
  return !hiddenContactIds(contacts, all, uid).has(contact.id);
}

/** Événements d'activité : masqués s'ils concernent un enregistrement masqué. */
export function visibleEventsFor<T extends Pick<CoreEvent, 'recordId'>>(events: readonly T[], all: readonly RecordItem[], uid: string | null): T[] {
  const hidden = hiddenRecordIds(all, uid);
  return hidden.size === 0 ? [...events] : events.filter((e) => !e.recordId || !hidden.has(e.recordId));
}
