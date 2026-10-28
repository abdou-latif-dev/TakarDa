// Registre central des TYPES métier stables (« kind ») — fondation P1 de la synchronisation hors ligne.
//
// Pourquoi : les identifiants de définition (`toolId`, `entityDefinitionId`, `fld-…`) sont créés au hasard, PAR APPAREIL, à la
// première utilisation d'un module. Ils ne peuvent donc pas servir d'identité cloud d'un type métier. Un `kind` est une chaîne
// stable (« module.entité »), identique sur tous les appareils et dans toutes les versions : c'est lui qui identifiera le type
// d'un enregistrement dans le cloud.
//
// Ce module est un REGISTRE et des adaptateurs de lecture : il ne déplace aucune donnée, n'écrit rien, n'importe aucun SDK et
// n'ouvre aucune connexion. Il décrit où vit chaque type aujourd'hui (moteur générique `core_*` ou blocs historiques) et si
// sa synchronisation est prévue.

import { entityDefinitions, tools } from '../db';
import type { RecordItem, ToolKind } from '@/types/entities';

/** Types stables. Ne jamais renommer ni réutiliser une valeur : ajouter seulement (voir les tests de stabilité). */
export const KIND = {
  // Immobilier (moteur générique, outil « immobilier »)
  IMMOBILIER_BIEN: 'immobilier.bien',
  IMMOBILIER_LOGEMENT: 'immobilier.logement',
  IMMOBILIER_CONTRAT: 'immobilier.contrat',
  IMMOBILIER_PAIEMENT: 'immobilier.paiement',
  IMMOBILIER_DEPENSE: 'immobilier.depense',
  IMMOBILIER_CORRECTION_PAIEMENT: 'immobilier.correction_paiement',
  // CEET / TDE (moteur générique, outil « facture » : le fournisseur est un champ, pas un type)
  UTILITY_FACTURE: 'utility.facture',
  UTILITY_RELEVE: 'utility.releve',
  UTILITY_FACTURE_PARTAGEE: 'utility.facture_partagee',
  UTILITY_PART_LOCATAIRE: 'utility.part_locataire',
  UTILITY_PARTICIPATION: 'utility.participation',
  // Tontines (blocs historiques db_snapshot)
  TONTINE_GROUPE: 'tontine.groupe',
  TONTINE_MEMBRE: 'tontine.membre',
  TONTINE_TOUR: 'tontine.tour',
  TONTINE_COTISATION: 'tontine.cotisation',
  TONTINE_CYCLE_HISTORIQUE: 'tontine.cycle_historique',
  TONTINE_CORRECTION_COTISATION: 'tontine.correction_cotisation',
  // Formulaires (blocs historiques)
  FORMS_FORMULAIRE: 'forms.formulaire',
  FORMS_REPONSE: 'forms.reponse',
  // Moteur générique
  CORE_CONTACT: 'core.contact',
  CORE_OUTIL: 'core.outil',
  CORE_DEFINITION_ENTITE: 'core.definition_entite',
  CORE_ROLE: 'core.role',
  CORE_MEMBRE_OUTIL: 'core.membre_outil',
  CORE_DOCUMENT: 'core.document',
  CORE_REGLE: 'core.regle',
  CORE_EVENEMENT: 'core.evenement',
  // Journaux et profil local
  ACTIVITE_EVENEMENT: 'activite.evenement',
  NOTIFICATION: 'notification.notification',
  PROFIL_LOCAL: 'profil.local',
} as const;

export type Kind = (typeof KIND)[keyof typeof KIND];

export type KindModule = 'immobilier' | 'utility' | 'tontine' | 'forms' | 'core' | 'activite' | 'notification' | 'profil';

/** Nom des collections persistées (clés de `services/persistence.ts`, `db.ts`). */
export type LegacyCollectionName =
  | 'users'
  | 'groups'
  | 'memberships'
  | 'tontineCycles'
  | 'tours'
  | 'contributions'
  | 'forms'
  | 'submissions'
  | 'activityEvents'
  | 'notifications';

export type CoreCollectionName = 'tools' | 'entityDefinitions' | 'records' | 'toolMembers' | 'externalContacts' | 'roleDefinitions' | 'events' | 'documents' | 'workflowRules';

/** Magasins propres à la synchronisation (ex. corrections financières), distincts des collections métier persistées. */
export type SyncStoreName = 'corrections_paiement' | 'corrections_cotisation';

export type KindSource =
  | { type: 'core_record'; toolKind: ToolKind; entityKey: string }
  | { type: 'collection'; collection: LegacyCollectionName | CoreCollectionName }
  | { type: 'store'; store: SyncStoreName };

/**
 * `planned` : le type devra être synchronisé (P2 et suivantes). `local_only` : propre à l'appareil (journaux, définitions
 * système définies par le code, pièces jointes locales) : il ne partira pas dans le cloud tant qu'une décision contraire n'est pas prise.
 */
export type SyncPlan = 'planned' | 'local_only';

export interface NaturalKeySpec {
  description: string;
  /** Clé logique de l'enregistrement, ou null quand elle ne peut pas être établie (donnée incomplète). */
  of: (item: Record<string, unknown>) => string | null;
}

export interface KindDefinition {
  kind: Kind;
  module: KindModule;
  label: string;
  source: KindSource;
  /** Version du schéma de ce type (à incrémenter quand ses champs changent). */
  schemaVersion: number;
  sync: SyncPlan;
  /** Fait financier : jamais écrasé par une synchronisation ; sa politique de correction est à valider en P3. */
  financialFact: boolean;
  /** Clé logique unique CONFIRMÉE par le code métier (sert à repérer les doublons, jamais à réécrire un identifiant). */
  naturalKey?: NaturalKeySpec;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const values = (item: Record<string, unknown>): Record<string, unknown> => (item.values && typeof item.values === 'object' ? (item.values as Record<string, unknown>) : {});

const def = (
  kind: Kind,
  module: KindModule,
  label: string,
  source: KindSource,
  sync: SyncPlan,
  extra: { financialFact?: boolean; naturalKey?: NaturalKeySpec } = {},
): KindDefinition => ({ kind, module, label, source, schemaVersion: 1, sync, financialFact: extra.financialFact ?? false, naturalKey: extra.naturalKey });

const record = (toolKind: ToolKind, entityKey: string): KindSource => ({ type: 'core_record', toolKind, entityKey });
const collection = (name: LegacyCollectionName | CoreCollectionName): KindSource => ({ type: 'collection', collection: name });
const store = (name: SyncStoreName): KindSource => ({ type: 'store', store: name });

export const KIND_DEFINITIONS: readonly KindDefinition[] = [
  def(KIND.IMMOBILIER_BIEN, 'immobilier', 'Bien', record('immobilier', 'bien'), 'planned'),
  def(KIND.IMMOBILIER_LOGEMENT, 'immobilier', 'Logement', record('immobilier', 'logement'), 'planned'),
  def(KIND.IMMOBILIER_CONTRAT, 'immobilier', 'Contrat de location', record('immobilier', 'contrat'), 'planned'),
  def(KIND.IMMOBILIER_PAIEMENT, 'immobilier', 'Paiement de loyer', record('immobilier', 'paiement'), 'planned', {
    financialFact: true,
    // Confirmé par planAdvanceCoverage (jamais deux couvertures pour le même mois d'un contrat). Les paiements ordinaires n'ont
    // PAS de clé logique : un loyer rejeté puis payé peut légitimement exister deux fois pour un même mois.
    naturalKey: {
      description: 'couverture par avance : contrat + mois',
      of: (item) => {
        const v = values(item);
        return item.statusKey === 'couvert' && str(v.contrat) && str(v.mois) ? `couvert|${str(v.contrat)}|${str(v.mois)}` : null;
      },
    },
  }),
  def(KIND.IMMOBILIER_DEPENSE, 'immobilier', 'Dépense', record('immobilier', 'depense'), 'planned'),
  // Correction ou annulation EXPLICITE d'un paiement : nouveau fait, avec référence au fait initial, jamais une réécriture (voir financialCorrection.ts).
  def(KIND.IMMOBILIER_CORRECTION_PAIEMENT, 'immobilier', 'Correction ou annulation de paiement', store('corrections_paiement'), 'planned', { financialFact: true }),
  def(KIND.UTILITY_FACTURE, 'utility', 'Facture (CEET / TDE)', record('facture', 'facture'), 'planned'),
  def(KIND.UTILITY_RELEVE, 'utility', 'Relevé de compteur', record('facture', 'releve'), 'planned', {
    // Confirmé par saveReleve (un relevé par fournisseur, période et participant identifié).
    naturalKey: {
      description: 'fournisseur + mois + type et identifiant du participant',
      of: (item) => {
        const v = values(item);
        return str(v.fournisseur) && str(v.mois) && str(v.participant_type) && str(v.participant_id)
          ? `${str(v.fournisseur)}|${str(v.mois)}|${str(v.participant_type)}|${str(v.participant_id)}`
          : null;
      },
    },
  }),
  def(KIND.UTILITY_FACTURE_PARTAGEE, 'utility', 'Facture partagée', record('facture', 'facture_partagee'), 'planned'),
  def(KIND.UTILITY_PART_LOCATAIRE, 'utility', 'Part de facture d’un participant', record('facture', 'part_locataire'), 'planned'),
  def(KIND.UTILITY_PARTICIPATION, 'utility', 'Participant CEET / TDE', record('facture', 'participation'), 'planned'),
  def(KIND.TONTINE_GROUPE, 'tontine', 'Tontine', collection('groups'), 'planned'),
  def(KIND.TONTINE_MEMBRE, 'tontine', 'Membre de tontine', collection('memberships'), 'planned'),
  def(KIND.TONTINE_TOUR, 'tontine', 'Tour de tontine', collection('tours'), 'planned', {
    // Déjà déterministe : l'identifiant est « <groupe>-tour-<numéro> » (services/tontineTours.ts).
    naturalKey: { description: 'tontine + numéro de tour', of: (item) => (str(item.groupId) && typeof item.tourNumber === 'number' ? `${str(item.groupId)}|${item.tourNumber}` : null) },
  }),
  def(KIND.TONTINE_COTISATION, 'tontine', 'Cotisation', collection('contributions'), 'planned', {
    financialFact: true,
    // Confirmé par recordContributions (une cotisation par membre et par tour).
    naturalKey: { description: 'tour + membre', of: (item) => (str(item.tourId) && str(item.memberId) ? `${str(item.tourId)}|${str(item.memberId)}` : null) },
  }),
  def(KIND.TONTINE_CYCLE_HISTORIQUE, 'tontine', 'Cycle de tontine (ancien modèle)', collection('tontineCycles'), 'local_only'),
  def(KIND.TONTINE_CORRECTION_COTISATION, 'tontine', 'Correction ou annulation de cotisation', store('corrections_cotisation'), 'planned', { financialFact: true }),
  def(KIND.FORMS_FORMULAIRE, 'forms', 'Formulaire', collection('forms'), 'planned'),
  def(KIND.FORMS_REPONSE, 'forms', 'Réponse à un formulaire', collection('submissions'), 'planned'),
  def(KIND.CORE_CONTACT, 'core', 'Contact (personne sans compte)', collection('externalContacts'), 'planned'),
  def(KIND.CORE_OUTIL, 'core', 'Outil installé', collection('tools'), 'local_only'),
  def(KIND.CORE_DEFINITION_ENTITE, 'core', 'Définition d’entité', collection('entityDefinitions'), 'local_only'),
  def(KIND.CORE_ROLE, 'core', 'Rôle d’un outil', collection('roleDefinitions'), 'local_only'),
  def(KIND.CORE_MEMBRE_OUTIL, 'core', 'Membre d’un outil', collection('toolMembers'), 'local_only'),
  def(KIND.CORE_DOCUMENT, 'core', 'Pièce jointe (référence locale)', collection('documents'), 'local_only'),
  def(KIND.CORE_REGLE, 'core', 'Règle automatique', collection('workflowRules'), 'local_only'),
  def(KIND.CORE_EVENEMENT, 'core', 'Événement du moteur (journal)', collection('events'), 'local_only'),
  def(KIND.ACTIVITE_EVENEMENT, 'activite', 'Activité (journal)', collection('activityEvents'), 'local_only'),
  def(KIND.NOTIFICATION, 'notification', 'Notification', collection('notifications'), 'local_only'),
  def(KIND.PROFIL_LOCAL, 'profil', 'Profil local de l’appareil', collection('users'), 'local_only'),
];

const BY_KIND = new Map<string, KindDefinition>(KIND_DEFINITIONS.map((d) => [d.kind, d]));

export const ALL_KINDS: readonly Kind[] = KIND_DEFINITIONS.map((d) => d.kind);
export const isKnownKind = (value: string): value is Kind => BY_KIND.has(value);
export const getKindDefinition = (kind: Kind): KindDefinition => BY_KIND.get(kind) as KindDefinition;
export const kindsToSync = (): Kind[] => KIND_DEFINITIONS.filter((d) => d.sync === 'planned').map((d) => d.kind);

const BY_RECORD_SOURCE = new Map<string, Kind>();
const BY_COLLECTION = new Map<string, Kind>();
for (const d of KIND_DEFINITIONS) {
  if (d.source.type === 'core_record') BY_RECORD_SOURCE.set(`${d.source.toolKind}/${d.source.entityKey}`, d.kind);
  else if (d.source.type === 'collection') BY_COLLECTION.set(d.source.collection, d.kind);
}

/** Type stable d'une entité du moteur générique à partir de son outil et de sa clé d'entité (ex. 'immobilier' + 'bien'). */
export const kindOfEntity = (toolKind: ToolKind, entityKey: string): Kind | null => BY_RECORD_SOURCE.get(`${toolKind}/${entityKey}`) ?? null;

/** Type stable d'une collection (groupes, membres, contacts…). */
export const kindOfCollection = (name: string): Kind | null => BY_COLLECTION.get(name) ?? null;

/**
 * Type stable d'un enregistrement du moteur générique : traduit les identifiants LOCAUX (`toolId`, `entityDefinitionId`) en
 * type métier. Retourne null pour un outil personnalisé ou une entité inconnue : il n'a alors pas d'identité cloud.
 * Lecture seule, sans effet de bord.
 */
export function kindOfRecord(record: Pick<RecordItem, 'toolId' | 'entityDefinitionId'>): Kind | null {
  const definition = entityDefinitions.find((d) => d.id === record.entityDefinitionId);
  const tool = tools.find((t) => t.id === record.toolId);
  if (!definition || !tool) return null;
  return kindOfEntity(tool.kind, definition.key);
}

/** Clé logique de l'élément si son type en déclare une (sinon null). */
export const naturalKeyOf = (kind: Kind, item: Record<string, unknown>): string | null => getKindDefinition(kind).naturalKey?.of(item) ?? null;

/** Repère les éléments qui représentent le même enregistrement LOGIQUE (même clé logique, identifiants différents). Aucune écriture. */
export function findLogicalDuplicates(kind: Kind, items: readonly Record<string, unknown>[]): { key: string; ids: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const key = naturalKeyOf(kind, item);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), str(item.id)]);
  }
  return [...groups.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids }));
}
