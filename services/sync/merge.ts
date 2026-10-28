// Fusion à trois voies d'un enregistrement NON financier — P3, pure (aucune écriture, aucun réseau).
//
// Trois versions : BASE (dernier contenu confirmé par le cloud), LOCALE (contenu actuel de l'appareil), DISTANTE (contenu reçu).
// Règle, champ par champ (un champ = une clé de premier niveau du corps, ou le statut) :
//  - locale = distante                      → rien à choisir ;
//  - seule la distante diffère de la base   → on prend la distante ;
//  - seule la locale diffère de la base     → on garde la locale ;
//  - les DEUX diffèrent de la base, et entre elles → CONFLIT sur ce champ : aucune des deux n'est choisie, jamais au hasard.
// Sans version de base connue, aucune fusion n'est tentée (`no_base`) : on ne devine pas ce qui a changé.

import { stableStringify } from './wireFormat';
import type { BaselineContent } from './syncQueue';

export type MergeResult =
  | { status: 'identical' }
  | { status: 'clean'; merged: BaselineContent; fromRemote: string[]; keptLocal: string[] }
  | { status: 'conflict'; fields: string[] }
  | { status: 'no_base' };

const STATUS_FIELD = '@statut';
const ABSENT = Symbol('absent');
type Slot = unknown | typeof ABSENT;

const same = (a: Slot, b: Slot): boolean => (a === ABSENT || b === ABSENT ? a === b : stableStringify(a) === stableStringify(b));
const slot = (body: Record<string, unknown>, key: string): Slot => (Object.prototype.hasOwnProperty.call(body, key) ? body[key] : ABSENT);

export const contentEquals = (a: BaselineContent, b: BaselineContent): boolean => stableStringify({ body: a.body, statusKey: a.statusKey }) === stableStringify({ body: b.body, statusKey: b.statusKey });

export function mergeThreeWay(base: BaselineContent | undefined | null, local: BaselineContent, remote: BaselineContent): MergeResult {
  if (contentEquals(local, remote)) return { status: 'identical' };
  if (!base) return { status: 'no_base' };

  const body: Record<string, unknown> = {};
  const conflicts: string[] = [];
  const fromRemote: string[] = [];
  const keptLocal: string[] = [];
  const keys = new Set([...Object.keys(base.body), ...Object.keys(local.body), ...Object.keys(remote.body)]);
  for (const key of [...keys].sort()) {
    const b = slot(base.body, key);
    const l = slot(local.body, key);
    const r = slot(remote.body, key);
    let chosen: Slot;
    if (same(l, r)) chosen = l;
    else if (same(b, l)) {
      chosen = r;
      fromRemote.push(key);
    } else if (same(b, r)) {
      chosen = l;
      keptLocal.push(key);
    } else {
      conflicts.push(key);
      continue;
    }
    if (chosen !== ABSENT) body[key] = chosen;
  }

  let statusKey: string | null;
  if (local.statusKey === remote.statusKey) statusKey = local.statusKey;
  else if (base.statusKey === local.statusKey) {
    statusKey = remote.statusKey;
    fromRemote.push(STATUS_FIELD);
  } else if (base.statusKey === remote.statusKey) {
    statusKey = local.statusKey;
    keptLocal.push(STATUS_FIELD);
  } else {
    conflicts.push(STATUS_FIELD);
    statusKey = local.statusKey;
  }

  if (conflicts.length > 0) return { status: 'conflict', fields: conflicts };

  // Les références sont des clés du corps : on les recalcule à partir du corps fusionné (jamais une référence qui contredit le corps).
  const refs: Record<string, string> = {};
  for (const field of new Set([...Object.keys(local.refs), ...Object.keys(remote.refs), ...Object.keys(base.refs)])) {
    const value = body[field];
    if (typeof value === 'string' && value !== '') refs[field] = value;
  }
  return { status: 'clean', merged: { body, refs, statusKey }, fromRemote, keptLocal };
}

/** Champs qui diffèrent entre deux contenus (pour présenter un conflit). */
export function differingFields(a: BaselineContent, b: BaselineContent): string[] {
  const out: string[] = [];
  for (const key of new Set([...Object.keys(a.body), ...Object.keys(b.body)])) if (!same(slot(a.body, key), slot(b.body, key))) out.push(key);
  if (a.statusKey !== b.statusKey) out.push(STATUS_FIELD);
  return out.sort();
}

export const STATUS_FIELD_NAME = STATUS_FIELD;
