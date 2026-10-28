// Modèle de lecture des conflits et des suppressions récupérables — P5. PUR et sans écran : c'est ce qu'une interface future affichera.
// Il dit, pour chaque conflit ouvert, quelles décisions sont possibles et pourquoi les autres ne le sont pas : l'interface n'a ainsi aucune
// règle à réécrire, et ne peut pas proposer une décision que le moteur refuserait. Lecture seule : rien n'est modifié.

import { conflictStore, tombstoneStore, type ConflictRecord, type ConflictType, type Tombstone } from './inboundStores';
import { getKindDefinition, type Kind } from './kindRegistry';
import { getSyncAccount } from './syncAccount';

export type ResolutionName = 'keep_local' | 'keep_remote' | 'fields';

export interface ResolutionOption {
  allowed: boolean;
  /** Pourquoi la décision est refusée (null si permise). */
  reason: string | null;
  /** Conséquence à présenter avant de confirmer (null si rien de particulier). */
  effect: string | null;
}

export type ResolutionOptions = Record<ResolutionName, ResolutionOption>;

const allow = (effect: string | null = null): ResolutionOption => ({ allowed: true, reason: null, effect });
const deny = (reason: string): ResolutionOption => ({ allowed: false, reason, effect: null });

/** Décisions possibles pour un conflit ouvert (miroir exact de `resolveConflict`). */
export function availableResolutions(conflict: Pick<ConflictRecord, 'type' | 'kind' | 'local' | 'remote'>): ResolutionOptions {
  const financial = getKindDefinition(conflict.kind).financialFact;
  const both = !!conflict.local && !!conflict.remote.wire;
  switch (conflict.type as ConflictType) {
    case 'both_modified':
    case 'no_base':
      return {
        keep_local: both ? allow('Votre version part vers le cloud au-dessus de la version distante ; celle-ci est conservée dans l’historique du conflit.') : deny('Version locale ou distante introuvable.'),
        keep_remote: both ? allow('La version distante remplace la vôtre ; la vôtre est conservée dans l’historique du conflit.') : deny('Version locale ou distante introuvable.'),
        fields: both ? allow('Chaque champ en désaccord doit être choisi.') : deny('Version locale ou distante introuvable.'),
      };
    case 'financial_remote_change':
      return {
        keep_local: allow('Le fait financier local est conservé ; toute modification locale reste retenue (jamais envoyée) : utilisez une correction explicite.'),
        keep_remote: allow('La version distante remplace le fait local ; la version locale est conservée dans l’historique.'),
        fields: both ? allow('Chaque champ en désaccord doit être choisi.') : deny('Version locale ou distante introuvable.'),
      };
    case 'delete_vs_update':
      return {
        keep_local: allow('Votre suppression est maintenue : elle repart au-dessus de la révision distante.'),
        keep_remote: allow('L’élément est rétabli localement avec la version distante.'),
        fields: deny('Votre version est une suppression : il n’y a pas de champ à choisir.'),
      };
    case 'update_vs_delete':
    case 'restored_tombstone':
      return {
        keep_local: financial
          ? deny('Un fait financier ne se restaure pas par cette voie : enregistrez une correction explicite.')
          : allow('L’élément est RESTAURÉ dans le cloud (opération explicite), puis votre contenu local lui est envoyé.'),
        keep_remote: allow('La suppression est appliquée ici ; une copie complète reste récupérable.'),
        fields: deny('La version distante est une suppression : il n’y a pas de champ à choisir.'),
      };
    case 'financial_remote_delete':
      return {
        keep_local: deny('Un fait financier ne se supprime ni ne se restaure : enregistrez une annulation ou une correction explicite.'),
        keep_remote: deny('Un fait financier n’est jamais supprimé : enregistrez une annulation ou une correction explicite.'),
        fields: deny('Aucun champ à choisir.'),
      };
  }
}

export interface ConflictView {
  recordId: string;
  kind: Kind;
  kindLabel: string;
  type: ConflictType;
  financial: boolean;
  detectedAt: string;
  fields: string[];
  local: ConflictRecord['local'];
  remote: ConflictRecord['remote'];
  base: ConflictRecord['base'];
  options: ResolutionOptions;
}

export function viewConflict(conflict: ConflictRecord): ConflictView {
  const definition = getKindDefinition(conflict.kind);
  return {
    recordId: conflict.recordId,
    kind: conflict.kind,
    kindLabel: definition.label,
    type: conflict.type,
    financial: definition.financialFact,
    detectedAt: conflict.detectedAt,
    fields: conflict.fields,
    local: conflict.local,
    remote: conflict.remote,
    base: conflict.base,
    options: availableResolutions(conflict),
  };
}

/** Conflits ouverts, du plus ancien au plus récent. Lecture seule. */
export async function listOpenConflicts(): Promise<ConflictView[]> {
  if (!getSyncAccount()) return []; // sans compte : aucun conflit n'est visible
  const store = await conflictStore.load();
  return Object.values(store.open)
    .sort((a, b) => (a.detectedAt < b.detectedAt ? -1 : a.detectedAt > b.detectedAt ? 1 : a.recordId < b.recordId ? -1 : 1))
    .map(viewConflict);
}

/** Historique des conflits résolus (versions écartées comprises). Lecture seule. */
export async function listResolvedConflicts(): Promise<ConflictRecord[]> {
  if (!getSyncAccount()) return [];
  return [...(await conflictStore.load()).history];
}

export interface RecoverableDeletion {
  recordId: string;
  kind: Kind;
  kindLabel: string;
  deletedAt: string | null;
  receivedAt: string;
  snapshot: Tombstone['snapshot'];
}

/** Suppressions reçues encore récupérables (copie complète conservée). Lecture seule. */
export async function listRecoverableDeletions(): Promise<RecoverableDeletion[]> {
  if (!getSyncAccount()) return [];
  const store = await tombstoneStore.load();
  return Object.values(store.items)
    .filter((t) => t.status === 'deleted')
    .map((t) => ({ recordId: t.recordId, kind: t.kind, kindLabel: getKindDefinition(t.kind).label, deletedAt: t.remoteDeletedAt, receivedAt: t.receivedAt, snapshot: t.snapshot }));
}
