// Envoi VOLONTAIRE des anciennes données — F2. Local, sans réseau : cette étape ne fait que DÉCIDER quelles données antérieures à l'activation
// deviennent éligibles à l'envoi ; l'envoi lui-même est fait ensuite par le moteur, comme pour toute création (file, accalmie, reprise).
//
// Garanties :
//   - JAMAIS automatique : une seule porte d'entrée (`adoptLegacyData`), qui exige une confirmation explicite (`confirmed: true`) ;
//   - APERÇU d'abord (`previewLegacyAdoption`) : ce qui partira, par type, et ce qui ne peut pas partir (données incomplètes) ; rien n'est écrit ;
//   - SAUVEGARDE d'abord : l'état local complet est écrit, relu et vérifié (empreinte) AVANT toute décision ; sinon rien ne change ;
//   - seules les données du périmètre V1 (Immobilier) et du compte actif sont concernées ; une donnée déjà confirmée dans le cloud ne l'est pas deux fois ;
//   - les données récentes qui dépendaient d'une ancienne donnée (un nouveau paiement d'un ancien contrat) partent avec elle, jamais avant ;
//   - rien n'est supprimé, modifié ni migré dans les données métier ; la décision est une simple inscription dans l'activation du compte
//     (`adoptedIds`), cumulative et idempotente.

import { checksumOf, createBackup, type BackupFile } from '../backupService';
import { signalLocalDataChange, workspaceId, workspaceKey } from '../persistence';
import { storage } from '../storage';
import type { LocalItem } from './changeScanner';
import { applyLegacyFilter, activationStore, type ActivationData } from './syncActivation';
import { loadScopedItems } from './syncEngine';
import { getKindDefinition, type Kind } from './kindRegistry';
import { getSyncAccount } from './syncAccount';
import { acquireSyncLockWithin } from './syncLock';
import { baselineStore, type BaselineStore } from './syncQueue';

export const ADOPTION_SAFETY_PREFIX = 'adoption_safety_';

export type AdoptionErrorCode = 'demo_workspace' | 'no_account' | 'not_activated' | 'not_confirmed' | 'busy' | 'safety_failed' | 'backup_unavailable';

export class AdoptionError extends Error {
  constructor(readonly code: AdoptionErrorCode, message: string) {
    super(message);
    this.name = 'AdoptionError';
  }
}

export interface AdoptionPlan {
  /** Anciennes données qui deviennent éligibles (triées). */
  adoptIds: string[];
  /** Tout ce qui partira à la suite : anciennes données + données récentes qui en dépendaient (hors éléments déjà confirmés). */
  willSend: LocalItem[];
}

/** Calcul PUR du plan : ne modifie rien. `allowed` = éléments du compte dans le périmètre V1 (avant le filtre des anciennes données). */
export function planAdoption(allowed: readonly LocalItem[], activation: ActivationData, baseline: BaselineStore): AdoptionPlan {
  const legacy = new Set(activation.legacyIds);
  const adopted = new Set(activation.adoptedIds);
  const adoptIds = allowed.filter((i) => legacy.has(i.id) && !adopted.has(i.id) && !baseline.entries[i.id]).map((i) => i.id).sort();
  const before = new Set(applyLegacyFilter(allowed, activation, baseline).allowed.map((i) => i.id));
  const after = applyLegacyFilter(allowed, { ...activation, adoptedIds: [...activation.adoptedIds, ...adoptIds] }, baseline).allowed;
  return { adoptIds, willSend: after.filter((i) => !before.has(i.id) && !baseline.entries[i.id]) };
}

export interface AdoptionPreview {
  /** Nombre d'éléments par type, pour l'aperçu. */
  byKind: { kind: Kind; label: string; count: number }[];
  /** Nombre d'anciennes données concernées. */
  legacyCount: number;
  /** Nombre total d'éléments qui partiront (anciennes données + données récentes liées). */
  total: number;
  /** Anciennes données qui ne peuvent PAS partir (ex. contrat sans locataire) : elles restent sur l'appareil. */
  incomplete: number;
}

const INCOMPLETE_REASONS = new Set(['tenant_missing', 'contract_not_allowed', 'payment_not_allowed']);

async function context(): Promise<{ account: string; activation: ActivationData; baseline: BaselineStore; allowed: LocalItem[]; incomplete: number }> {
  if (workspaceId() !== 'personal') throw new AdoptionError('demo_workspace', 'L’espace de démonstration n’envoie jamais de données.');
  const account = getSyncAccount();
  if (!account) throw new AdoptionError('no_account', 'Aucun compte actif.');
  const activation = await activationStore.load();
  if (activation.enabledAt === null) throw new AdoptionError('not_activated', 'La synchronisation n’est pas activée pour ce compte.');
  const scoped = await loadScopedItems(account);
  const legacy = new Set(activation.legacyIds);
  const incomplete = scoped.excluded.filter((e) => legacy.has(e.id) && INCOMPLETE_REASONS.has(e.reason)).length;
  return { account, activation, baseline: await baselineStore.load(), allowed: scoped.allowed, incomplete };
}

/** Aperçu de ce qui partirait. Lecture seule, sans réseau, sans effet. */
export async function previewLegacyAdoption(): Promise<AdoptionPreview> {
  const { activation, baseline, allowed, incomplete } = await context();
  const plan = planAdoption(allowed, activation, baseline);
  const counts = new Map<Kind, number>();
  for (const item of plan.willSend) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const byKind = [...counts.entries()].map(([kind, count]) => ({ kind, label: getKindDefinition(kind).label, count })).sort((a, b) => (a.label < b.label ? -1 : 1));
  return { byKind, legacyCount: plan.adoptIds.length, total: plan.willSend.length, incomplete };
}

export interface AdoptionResult {
  /** Anciennes données rendues éligibles. */
  adopted: number;
  /** Éléments qui partiront à la suite (anciennes données + données récentes liées). */
  willSend: number;
  /** Clé de la sauvegarde de sécurité (relue et vérifiée avant la décision) ; null s'il n'y avait rien à adopter. */
  safetyKey: string | null;
}

/**
 * Rend éligibles à l'envoi les anciennes données du compte actif. Exige une confirmation explicite. Écrit d'abord une sauvegarde complète, relue
 * et vérifiée ; sans elle, rien ne change. N'envoie rien lui-même : demande seulement au moteur de capturer (accalmie, reprise et limites habituelles).
 */
export async function adoptLegacyData(options: { confirmed: boolean; now?: Date }): Promise<AdoptionResult> {
  if (options.confirmed !== true) throw new AdoptionError('not_confirmed', 'Envoi non confirmé : rien n’a été modifié.');
  const release = await acquireSyncLockWithin(5000); // aucune capture ni réception en même temps ; un changement de compte attend
  if (!release) throw new AdoptionError('busy', 'Une synchronisation est en cours : réessayez dans un instant.');
  let result: AdoptionResult;
  try {
    const { account, activation, baseline, allowed } = await context();
    const plan = planAdoption(allowed, activation, baseline);
    if (plan.adoptIds.length === 0) return { adopted: 0, willSend: 0, safetyKey: null };

    let backup: BackupFile;
    try {
      backup = createBackup(options.now ?? new Date());
    } catch (error) {
      throw new AdoptionError('backup_unavailable', error instanceof Error ? error.message : 'Sauvegarde impossible : rien n’a été modifié.');
    }
    const safetyKey = workspaceKey(`${ADOPTION_SAFETY_PREFIX}${(options.now ?? new Date()).getTime()}`);
    try {
      await storage.set(safetyKey, backup);
      const reread = await storage.get<BackupFile>(safetyKey);
      if (!reread || reread.checksum !== backup.checksum || checksumOf(reread.data) !== backup.checksum) throw new Error('relecture différente');
    } catch (error) {
      throw new AdoptionError('safety_failed', `La sauvegarde de sécurité n’a pas pu être vérifiée : rien n’a été modifié. (${error instanceof Error ? error.message : String(error)})`);
    }

    if (getSyncAccount() !== account) throw new AdoptionError('no_account', 'Le compte actif a changé : rien n’a été modifié.');
    const legacy = new Set(activation.legacyIds); // l'inscription ne retient jamais autre chose qu'une ancienne donnée de ce compte
    await activationStore.update((current) => ({ ...current, adoptedIds: [...new Set([...current.adoptedIds, ...plan.adoptIds.filter((id) => legacy.has(id))])].sort() }));
    result = { adopted: plan.adoptIds.length, willSend: plan.willSend.length, safetyKey };
  } finally {
    release();
  }
  signalLocalDataChange(); // hors du verrou : le moteur capture maintenant, puis envoie après l'accalmie
  return result;
}
