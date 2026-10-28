// Sauvegarde et restauration locales des données de l'espace de travail ACTIF.
//
// Ce qui manquait (constat du code) : l'ancien export (Profil › Stockage) omettait la collection `tours` (rotations des tontines :
// montants et bénéficiaires figés, non reconstructibles à l'identique), n'indiquait pas l'espace exporté (personnel ou démonstration),
// n'avait aucune empreinte d'intégrité et aucune restauration n'existait.
//
// Garanties de la restauration :
//  - rien ne change sans confirmation explicite ;
//  - la sauvegarde est validée AVANT tout remplacement (structure, doublons, empreinte, espace d'origine) ;
//  - une sauvegarde de sécurité de l'état courant est écrite puis RELUE et vérifiée avant de remplacer quoi que ce soit ;
//  - une sauvegarde vide ne remplace jamais des données existantes ;
//  - les collections absentes de la sauvegarde ne sont pas touchées ;
//  - le mode par défaut (« merge ») n'écrase aucun enregistrement existant ; « replace » exige une autorisation explicite pour retirer des données ;
//  - une sauvegarde de démonstration n'est jamais restaurée dans l'espace personnel (et inversement) sans autorisation explicite.
//
// Aucun réseau, aucun SDK. Non branché à l'interface de restauration dans P1 : l'API est testée sur des données isolées.

import { assertBackupAllowed } from './moduleLock';
import { COLLECTION_NAMES, replaceCollections, snapshotCollections, workspaceId, workspaceKey, type CollectionsSnapshot } from './persistence';
import { sha256Hex } from './sha256';
import { storage } from './storage';

export const BACKUP_FORMAT = 'TakarDa local backup';
export const BACKUP_SCHEMA_VERSION = 2;
export const RESTORE_SAFETY_PREFIX = 'restore_safety_';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  /** Espace d'origine : « personal » ou « demo » (absent des sauvegardes de version 1). */
  workspace?: 'personal' | 'demo';
  data: Record<string, unknown[]>;
  /** Nombre d'éléments par collection (version 2). */
  counts?: Record<string, number>;
  /** SHA-256 du contenu de `data` (version 2). */
  checksum?: string;
}

export type BackupErrorCode = 'not_confirmed' | 'invalid' | 'workspace_mismatch' | 'empty_backup' | 'would_shrink' | 'safety_failed' | 'apply_failed';

export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode, message: string, readonly details: string[] = []) {
    super(message);
    this.name = 'BackupError';
  }
}

/** Contenu canonique : collections triées par nom, éléments dans leur ordre. Sert à l'empreinte. */
function canonicalData(data: Record<string, unknown[]>): string {
  return JSON.stringify(Object.keys(data).sort().map((name) => [name, data[name]]));
}
export const checksumOf = (data: Record<string, unknown[]>): string => sha256Hex(canonicalData(data));

/** Sauvegarde COMPLÈTE de l'espace actif (toutes les collections persistées, `tours` comprises). Lecture seule. */
export function createBackup(now: Date = new Date()): BackupFile {
  assertBackupAllowed(); // sauvegarde complète = données de TOUS les comptes : refusée en contexte multi-compte
  const data = snapshotCollections();
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    workspace: workspaceId(),
    data,
    counts: Object.fromEntries(Object.entries(data).map(([name, list]) => [name, list.length])),
    checksum: checksumOf(data),
  };
}

export const serializeBackup = (backup: BackupFile): string => JSON.stringify(backup);

export function parseBackup(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface BackupValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  backup: BackupFile | null;
}

/** Valide une sauvegarde AVANT toute utilisation. Aucune écriture. */
export function validateBackup(raw: unknown): BackupValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (): BackupValidation => ({ ok: false, errors, warnings, backup: null });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('Le fichier n’est pas une sauvegarde TakarDa lisible.');
    return fail();
  }
  const file = raw as Record<string, unknown>;
  if (file.format !== BACKUP_FORMAT) errors.push('Format inconnu : ce n’est pas une sauvegarde TakarDa.');
  const version = file.schemaVersion;
  if (version !== 1 && version !== 2) errors.push(`Version de sauvegarde non prise en charge : ${String(version)}.`);
  if (!file.data || typeof file.data !== 'object' || Array.isArray(file.data)) errors.push('Contenu de la sauvegarde absent.');
  if (errors.length > 0) return fail();

  const data = file.data as Record<string, unknown>;
  const clean: Record<string, unknown[]> = {};
  for (const [name, list] of Object.entries(data)) {
    if (!COLLECTION_NAMES.includes(name)) {
      warnings.push(`Collection inconnue ignorée : ${name}.`);
      continue;
    }
    if (!Array.isArray(list)) {
      errors.push(`La collection « ${name} » n’est pas une liste.`);
      continue;
    }
    const ids = new Set<string>();
    list.forEach((item, index) => {
      const id = item && typeof item === 'object' ? (item as Record<string, unknown>).id : undefined;
      if (typeof id !== 'string' || id === '') errors.push(`${name}[${index}] : identifiant manquant.`);
      else if (ids.has(id)) errors.push(`${name} : identifiant en double (${id}).`);
      else ids.add(id);
    });
    clean[name] = list;
  }
  if (errors.length > 0) return fail();

  if (version === 2) {
    if (file.workspace !== 'personal' && file.workspace !== 'demo') errors.push('Espace d’origine absent ou invalide.');
    if (typeof file.checksum !== 'string') errors.push('Empreinte d’intégrité absente.');
    else if (file.checksum !== checksumOf(clean)) errors.push('Empreinte d’intégrité invalide : le fichier est incomplet ou a été modifié.');
    const counts = file.counts as Record<string, number> | undefined;
    if (counts) for (const [name, count] of Object.entries(counts)) if (name in clean && clean[name].length !== count) errors.push(`Nombre d’éléments incohérent pour « ${name} ».`);
  } else {
    warnings.push('Ancienne sauvegarde (version 1) : sans empreinte d’intégrité, sans indication d’espace, et sans la collection « tours ».');
  }
  for (const name of COLLECTION_NAMES) if (!(name in clean)) warnings.push(`Collection absente de la sauvegarde (non modifiée à la restauration) : ${name}.`);
  if (errors.length > 0) return fail();

  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    schemaVersion: version as number,
    exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : '',
    workspace: file.workspace === 'personal' || file.workspace === 'demo' ? file.workspace : undefined,
    data: clean,
    counts: file.counts as Record<string, number> | undefined,
    checksum: typeof file.checksum === 'string' ? file.checksum : undefined,
  };
  return { ok: true, errors, warnings, backup };
}

export type RestoreMode = 'merge' | 'replace';

export interface CollectionPlan {
  current: number;
  inBackup: number;
  toAdd: number;
  /** Même identifiant, contenu différent. */
  differing: number;
  /** Présents maintenant, absents de la sauvegarde : retirés seulement en mode « replace ». */
  missingFromBackup: number;
}

export interface RestorePlan {
  mode: RestoreMode;
  collections: Record<string, CollectionPlan>;
  totalToAdd: number;
  /** Éléments existants qui seraient écrasés (replace) ou ignorés pour ne pas être écrasés (merge). */
  totalDiffering: number;
  /** Éléments existants qui seraient retirés (replace seulement). */
  totalRemoved: number;
}

const idOf = (item: unknown): string => String((item as { id: string }).id);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Ce que ferait la restauration, sans rien modifier. */
export function planRestore(backup: BackupFile, mode: RestoreMode, current: CollectionsSnapshot = snapshotCollections()): RestorePlan {
  assertBackupAllowed();
  const collections: Record<string, CollectionPlan> = {};
  let totalToAdd = 0;
  let totalDiffering = 0;
  let totalRemoved = 0;
  for (const [name, incoming] of Object.entries(backup.data)) {
    const now = current[name] ?? [];
    const byId = new Map(now.map((item) => [idOf(item), item]));
    const incomingIds = new Set(incoming.map(idOf));
    const toAdd = incoming.filter((item) => !byId.has(idOf(item))).length;
    const differing = incoming.filter((item) => byId.has(idOf(item)) && !same(byId.get(idOf(item)), item)).length;
    const missingFromBackup = now.filter((item) => !incomingIds.has(idOf(item))).length;
    collections[name] = { current: now.length, inBackup: incoming.length, toAdd, differing, missingFromBackup };
    totalToAdd += toAdd;
    totalDiffering += differing;
    if (mode === 'replace') totalRemoved += missingFromBackup;
  }
  return { mode, collections, totalToAdd, totalDiffering, totalRemoved };
}

export interface RestoreOptions {
  /** Doit valoir `true` : aucune restauration sans confirmation explicite de l'utilisateur. */
  confirmed: boolean;
  /** « merge » (défaut) : ajoute ce qui manque, n'écrase rien. « replace » : remplace les collections présentes dans la sauvegarde. */
  mode?: RestoreMode;
  /** Autorise « replace » à retirer des éléments existants absents de la sauvegarde. */
  allowShrink?: boolean;
  /** Autorise la restauration d'une sauvegarde d'un autre espace (ou d'espace inconnu). Désactivé par défaut. */
  allowWorkspaceMismatch?: boolean;
  now?: Date;
}

export interface RestoreResult {
  applied: true;
  mode: RestoreMode;
  plan: RestorePlan;
  /** Clé de la sauvegarde de sécurité de l'état d'avant restauration (relue et vérifiée). */
  safetyKey: string;
  warnings: string[];
}

const total = (data: Record<string, unknown[]>): number => Object.values(data).reduce((sum, list) => sum + list.length, 0);

/** Restaure une sauvegarde dans l'espace actif, dans le respect des garanties décrites en tête de fichier. */
export async function applyRestore(raw: unknown, options: RestoreOptions): Promise<RestoreResult> {
  assertBackupAllowed(); // la restauration remplacerait ou fusionnerait les données de tous les comptes
  if (options.confirmed !== true) throw new BackupError('not_confirmed', 'Restauration non confirmée : rien n’a été modifié.');
  const mode: RestoreMode = options.mode ?? 'merge';
  const checked = validateBackup(raw);
  if (!checked.ok || !checked.backup) throw new BackupError('invalid', 'Sauvegarde invalide : rien n’a été modifié.', checked.errors);
  const backup = checked.backup;

  if (backup.workspace !== workspaceId() && !options.allowWorkspaceMismatch) {
    throw new BackupError(
      'workspace_mismatch',
      `Cette sauvegarde provient de l’espace « ${backup.workspace ?? 'inconnu'} » et l’espace actif est « ${workspaceId()} » : les données de démonstration et personnelles ne sont jamais mélangées sans autorisation.`,
    );
  }

  const current = snapshotCollections();
  if (total(backup.data) === 0 && total(current) > 0) throw new BackupError('empty_backup', 'La sauvegarde est vide : elle ne remplacera jamais des données existantes.');

  const plan = planRestore(backup, mode, current);
  if (mode === 'replace' && plan.totalRemoved > 0 && !options.allowShrink) {
    throw new BackupError('would_shrink', `Le remplacement retirerait ${plan.totalRemoved} élément(s) existant(s) absent(s) de la sauvegarde : refusé sans autorisation explicite.`);
  }

  // Sauvegarde de sécurité de l'état courant : écrite, relue, vérifiée. Sans elle, rien n'est remplacé.
  const safety = createBackup(options.now ?? new Date());
  const safetyKey = workspaceKey(`${RESTORE_SAFETY_PREFIX}${(options.now ?? new Date()).getTime()}`);
  try {
    await storage.set(safetyKey, safety);
    const reread = await storage.get<BackupFile>(safetyKey);
    if (!reread || reread.checksum !== safety.checksum || checksumOf(reread.data) !== safety.checksum) throw new Error('relecture différente');
  } catch (error) {
    throw new BackupError('safety_failed', 'La sauvegarde de sécurité de l’état actuel n’a pas pu être vérifiée : rien n’a été remplacé.', [String(error)]);
  }

  const next: CollectionsSnapshot = {};
  for (const [name, incoming] of Object.entries(backup.data)) {
    if (mode === 'replace') {
      next[name] = incoming;
    } else {
      const have = new Set((current[name] ?? []).map(idOf));
      next[name] = [...(current[name] ?? []), ...incoming.filter((item) => !have.has(idOf(item)))];
    }
  }
  try {
    await replaceCollections(next);
  } catch (error) {
    throw new BackupError('apply_failed', 'La restauration a échoué ; l’état précédent a été rétabli.', [String(error)]);
  }
  return { applied: true, mode, plan, safetyKey, warnings: checked.warnings };
}
