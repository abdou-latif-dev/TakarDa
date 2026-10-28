// Format d'ÉCHANGE d'un enregistrement (ce qui partirait vers le cloud) et empreinte de son contenu.
//
// Le format d'échange exclut tout ce qui est propre à l'appareil : identifiants d'outil et de définition (`toolId`,
// `entityDefinitionId`), identité locale (`createdBy` = « u-me »), marque de visibilité locale (`cloudOwnerUid`). Le type métier
// stable (`kind`) remplace les identifiants de définition ; le propriétaire (`ownerUid`) est fourni par l'appelant, jamais déduit
// d'un champ local. L'empreinte ne porte que sur le contenu métier : une simple retouche de `updatedAt`, ou une métadonnée locale,
// ne déclenche aucune opération.
//
// Module pur : aucun SDK, aucun réseau, aucune écriture.

import { sha256Hex } from '../sha256';
import { getKindDefinition, type Kind } from './kindRegistry';
import { extractReferences, relationsOf } from './relationManifest';

export interface WireRecord {
  id: string;
  kind: Kind;
  schemaVersion: number;
  ownerUid: string;
  statusKey: string | null;
  createdAt: string;
  updatedAt: string;
  /** Contenu métier propre au type (champs `values` du moteur générique, ou propriétés des blocs historiques). */
  body: Record<string, unknown>;
  /** Références d'entité PRÉSENTES (champ → identifiant). Jamais une autorisation d'accès. */
  refs: Record<string, string>;
}

const cleanJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Propriétés d'un enregistrement du moteur générique qui n'appartiennent pas au contenu métier. */
const RECORD_ENVELOPE = new Set(['id', 'entityDefinitionId', 'toolId', 'values', 'statusKey', 'createdBy', 'cloudOwnerUid', 'createdAt', 'updatedAt']);

export function buildWireRecord(kind: Kind, item: Record<string, unknown>, ownerUid: string): WireRecord {
  const definition = getKindDefinition(kind);
  const localOnly = new Set(relationsOf(kind).filter((r) => r.location === 'property' && (r.type === 'local_id' || r.field === 'createdBy')).map((r) => r.field));
  localOnly.add('cloudOwnerUid');
  let body: Record<string, unknown>;
  if (definition.source.type === 'core_record') {
    body = cleanJson((item.values && typeof item.values === 'object' ? item.values : {}) as Record<string, unknown>);
  } else {
    body = {};
    for (const [name, value] of Object.entries(item)) {
      if (name === 'id' || name === 'statusKey' || localOnly.has(name)) continue;
      body[name] = cleanJson(value);
    }
  }
  const refs: Record<string, string> = {};
  for (const ref of extractReferences(kind, item)) refs[ref.field] = ref.id;
  const createdAt = str(item.createdAt) || str(item.joinedAt);
  return {
    id: str(item.id),
    kind,
    schemaVersion: definition.schemaVersion,
    ownerUid,
    statusKey: typeof item.statusKey === 'string' ? item.statusKey : null,
    createdAt,
    updatedAt: str(item.updatedAt) || createdAt,
    body,
    refs,
  };
}

/** Sérialisation canonique : clés triées récursivement (deux objets équivalents donnent la même chaîne). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return val;
  });
}

/** Empreinte du CONTENU métier (corps, références, statut) : ni dates de retouche, ni propriétaire, ni métadonnées locales. */
export const contentHash = (wire: Pick<WireRecord, 'body' | 'refs' | 'statusKey' | 'kind'>): string =>
  sha256Hex(stableStringify({ kind: wire.kind, body: wire.body, refs: wire.refs, statusKey: wire.statusKey }));

/** Empreinte directe d'un élément local (même résultat quel que soit le propriétaire). */
export const hashOfItem = (kind: Kind, item: Record<string, unknown>): string => contentHash(buildWireRecord(kind, item, '-'));

// Les clés d'enveloppe ne sont exportées que pour les tests : elles documentent ce qui reste hors du contenu métier.
export const RECORD_ENVELOPE_FIELDS: readonly string[] = [...RECORD_ENVELOPE];

// ---- Réception (P3) : reconstruction d'un élément local à partir du format d'échange ---------------------------------------------

/** Champs qui n'appartiennent jamais au contenu échangé (propres à l'appareil) : un contenu distant ne peut pas les fournir. */
export function localOnlyFields(kind: Kind): Set<string> {
  const fields = new Set(relationsOf(kind).filter((r) => r.location === 'property' && (r.type === 'local_id' || r.field === 'createdBy')).map((r) => r.field));
  for (const name of ['cloudOwnerUid', 'toolId', 'entityDefinitionId', 'id', 'statusKey']) fields.add(name);
  return fields;
}

export interface LocalIds {
  toolId: string;
  entityDefinitionId: string;
}

/**
 * Élément local correspondant à un enregistrement reçu. Pur. Pour un enregistrement du moteur générique, `localIds` (identifiants
 * d'outil et de définition PROPRES à l'appareil) est requis quand il n'existe pas encore d'élément local. Les champs propres à
 * l'appareil d'un élément existant sont conservés ; rien d'autre n'est repris de l'ancien contenu.
 */
export function itemFromWire(wire: WireRecord, existing: Record<string, unknown> | null, localIds?: LocalIds): Record<string, unknown> {
  const definition = getKindDefinition(wire.kind);
  const body = cleanJson(wire.body);
  if (definition.source.type === 'core_record') {
    const item: Record<string, unknown> = {
      // nouvel enregistrement reçu : marque d'affichage du propriétaire (masquage pour les autres comptes, voir cloudVisibility.ts)
      ...(existing ?? { createdBy: 'u-me', toolId: localIds?.toolId, entityDefinitionId: localIds?.entityDefinitionId, cloudOwnerUid: wire.ownerUid }),
      id: wire.id,
      values: body,
      createdAt: wire.createdAt || str(existing?.createdAt),
      updatedAt: wire.updatedAt || wire.createdAt,
    };
    if (wire.statusKey === null) delete item.statusKey;
    else item.statusKey = wire.statusKey;
    return item;
  }
  const kept: Record<string, unknown> = {};
  if (existing) {
    for (const name of localOnlyFields(wire.kind)) if (name in existing && name !== 'id' && name !== 'statusKey') kept[name] = existing[name];
  } else {
    if (relationsOf(wire.kind).some((r) => r.field === 'createdBy' && r.location === 'property')) kept.createdBy = 'u-me';
    // nouveau contact (locataire) reçu : marque d'affichage du propriétaire, comme pour les enregistrements (masqué aux autres comptes)
    if (wire.kind === 'core.contact') kept.cloudOwnerUid = wire.ownerUid;
  }
  const item: Record<string, unknown> = { ...kept, ...body, id: wire.id };
  if (wire.statusKey !== null) item.statusKey = wire.statusKey;
  return item;
}

/** Contenu métier d'un enregistrement (ce qui sert de version de base à la fusion). */
export const contentOfWire = (wire: Pick<WireRecord, 'body' | 'refs' | 'statusKey'>): { body: Record<string, unknown>; refs: Record<string, string>; statusKey: string | null } => ({
  body: cleanJson(wire.body),
  refs: { ...wire.refs },
  statusKey: wire.statusKey,
});

/** Clé logique d'un enregistrement reçu (null si son type n'en déclare pas). */
export const naturalKeyOfWire = (wire: WireRecord): string | null => getKindDefinition(wire.kind).naturalKey?.of(itemFromWire(wire, null, { toolId: '', entityDefinitionId: '' })) ?? null;
