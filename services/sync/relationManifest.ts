// Manifeste de relations : déclare, pour chaque type métier (voir kindRegistry.ts), les champs qui sont des RÉFÉRENCES vers d'autres
// enregistrements — y compris ceux qui sont aujourd'hui de simples textes (`locataire_id`, `participant_id`, `releve_*_id`…).
//
// Chaque entrée a été confirmée dans le code (définitions d'entités de immobilierService.ts / facturesService.ts, types de
// types/entities.ts, services de tontine et de formulaires). Rien n'est converti : le manifeste DÉCRIT les données telles qu'elles
// sont, il ne les modifie pas. Il servira à ordonner l'envoi (parents d'abord), à calculer ce qu'une personne peut voir et à
// repérer les orphelins. Un identifiant de référence n'est jamais une autorisation d'accès.
//
// Module pur : aucun SDK, aucun réseau, aucune écriture.

import { KIND, getKindDefinition, kindsToSync, type Kind } from './kindRegistry';

/**
 * - `relation` : champ déclaré de type « relation » dans la définition d'entité.
 * - `text_ref` : champ TEXTE qui contient l'identifiant d'un autre enregistrement (référence non déclarée par le moteur).
 * - `identity_ref` : identité d'une personne (profil local ou compte) — pas un enregistrement métier synchronisable en l'état.
 * - `static_ref` : référence à un contenu fourni par l'application (ex. modèle de formulaire), jamais synchronisé.
 * - `local_id` : identifiant PROPRE À L'APPAREIL (outil, définition d'entité) : à ne jamais envoyer comme identité cloud.
 */
export type ReferenceType = 'relation' | 'text_ref' | 'identity_ref' | 'static_ref' | 'local_id';

export type ReferenceLocation = 'values' | 'property';

export interface RelationDef {
  kind: Kind;
  field: string;
  /** `values` : champ de `RecordItem.values` (moteur générique) ; `property` : propriété de l'objet (blocs historiques). */
  location: ReferenceLocation;
  type: ReferenceType;
  /** Types visés (vide pour `identity_ref`, `static_ref` et `local_id`). */
  targets: readonly Kind[];
  /** Référence dont le type visé dépend d'un autre champ (ex. participant : contrat, contact ou saisie libre). */
  polymorphic?: { discriminator: string; map: Readonly<Record<string, Kind | null>> };
  required: boolean;
  /** Copie dénormalisée d'une relation canonique (peut diverger) : la source de vérité est l'autre champ. */
  denormalizedCopy?: boolean;
  note: string;
}

const rel = (
  kind: Kind,
  field: string,
  location: ReferenceLocation,
  type: ReferenceType,
  targets: readonly Kind[],
  required: boolean,
  note: string,
  extra: { polymorphic?: RelationDef['polymorphic']; denormalizedCopy?: boolean } = {},
): RelationDef => ({ kind, field, location, type, targets, required, note, polymorphic: extra.polymorphic, denormalizedCopy: extra.denormalizedCopy });

const PARTICIPANT: RelationDef['polymorphic'] = {
  discriminator: 'participant_type',
  map: { contrat: KIND.IMMOBILIER_CONTRAT, contact: KIND.CORE_CONTACT, manuel: null },
};
const PARTICIPANT_TARGETS = [KIND.IMMOBILIER_CONTRAT, KIND.CORE_CONTACT] as const;

/** Champs communs de tout enregistrement du moteur générique (`RecordItem`). */
const recordCommon = (kind: Kind): RelationDef[] => [
  rel(kind, 'toolId', 'property', 'local_id', [], true, 'Identifiant d’outil propre à l’appareil : remplacé par le type métier dans le cloud.'),
  rel(kind, 'entityDefinitionId', 'property', 'local_id', [], true, 'Identifiant de définition propre à l’appareil : remplacé par le type métier dans le cloud.'),
  rel(kind, 'createdBy', 'property', 'identity_ref', [], true, 'Identité locale (« u-me » aujourd’hui) : ne désigne pas un compte et n’accorde aucun droit.'),
];

export const RELATIONS: readonly RelationDef[] = [
  // ---- Immobilier ---------------------------------------------------------------------------------------------------
  ...recordCommon(KIND.IMMOBILIER_BIEN),
  ...recordCommon(KIND.IMMOBILIER_LOGEMENT),
  rel(KIND.IMMOBILIER_LOGEMENT, 'bien', 'values', 'relation', [KIND.IMMOBILIER_BIEN], true, 'Bien auquel appartient le logement.'),
  ...recordCommon(KIND.IMMOBILIER_CONTRAT),
  rel(KIND.IMMOBILIER_CONTRAT, 'bien', 'values', 'relation', [KIND.IMMOBILIER_BIEN], true, 'Copie du bien du logement (compatibilité) : la relation canonique est `logement`.', { denormalizedCopy: true }),
  rel(KIND.IMMOBILIER_CONTRAT, 'logement', 'values', 'relation', [KIND.IMMOBILIER_LOGEMENT], true, 'Logement loué (relation canonique).'),
  rel(KIND.IMMOBILIER_CONTRAT, 'locataire_id', 'values', 'text_ref', [KIND.CORE_CONTACT], true, 'Identifiant du contact locataire (champ texte).'),
  ...recordCommon(KIND.IMMOBILIER_PAIEMENT),
  rel(KIND.IMMOBILIER_PAIEMENT, 'contrat', 'values', 'relation', [KIND.IMMOBILIER_CONTRAT], true, 'Contrat payé (relation canonique).'),
  rel(KIND.IMMOBILIER_PAIEMENT, 'logement', 'values', 'text_ref', [KIND.IMMOBILIER_LOGEMENT], false, 'Copie du logement du contrat (champ texte).', { denormalizedCopy: true }),
  rel(KIND.IMMOBILIER_PAIEMENT, 'bien', 'values', 'text_ref', [KIND.IMMOBILIER_BIEN], false, 'Copie du bien du contrat (champ texte).', { denormalizedCopy: true }),
  rel(KIND.IMMOBILIER_PAIEMENT, 'locataire_id', 'values', 'text_ref', [KIND.CORE_CONTACT], false, 'Copie du locataire du contrat (champ texte).', { denormalizedCopy: true }),
  ...recordCommon(KIND.IMMOBILIER_DEPENSE),
  rel(KIND.IMMOBILIER_DEPENSE, 'bien', 'values', 'relation', [KIND.IMMOBILIER_BIEN], true, 'Bien concerné par la dépense.'),

  rel(KIND.IMMOBILIER_CORRECTION_PAIEMENT, 'targetId', 'property', 'relation', [KIND.IMMOBILIER_PAIEMENT], true, 'Paiement initial corrigé ou annulé (le fait initial n’est jamais modifié).'),
  rel(KIND.IMMOBILIER_CORRECTION_PAIEMENT, 'createdBy', 'property', 'identity_ref', [], true, 'Identité locale de l’auteur.'),

  // ---- CEET / TDE ---------------------------------------------------------------------------------------------------
  ...recordCommon(KIND.UTILITY_FACTURE),
  rel(KIND.UTILITY_FACTURE, 'bien_id', 'values', 'text_ref', [KIND.IMMOBILIER_BIEN], false, 'Bien immobilier d’origine, absent en usage autonome (champ texte).'),
  ...recordCommon(KIND.UTILITY_RELEVE),
  rel(KIND.UTILITY_RELEVE, 'participant_id', 'values', 'text_ref', PARTICIPANT_TARGETS, false, 'Participant du relevé : contrat, contact, ou saisie libre (sans identifiant).', { polymorphic: PARTICIPANT }),
  ...recordCommon(KIND.UTILITY_FACTURE_PARTAGEE),
  rel(KIND.UTILITY_FACTURE_PARTAGEE, 'bien', 'values', 'relation', [KIND.IMMOBILIER_BIEN], false, 'Bien d’origine ; la cible n’est renseignée dans la définition qu’à la première facture créée depuis un bien.'),
  ...recordCommon(KIND.UTILITY_PART_LOCATAIRE),
  rel(KIND.UTILITY_PART_LOCATAIRE, 'facture_partagee', 'values', 'relation', [KIND.UTILITY_FACTURE_PARTAGEE], true, 'Facture partagée dont la part est issue.'),
  rel(KIND.UTILITY_PART_LOCATAIRE, 'participant_id', 'values', 'text_ref', PARTICIPANT_TARGETS, false, 'Participant : contrat, contact, ou saisie libre.', { polymorphic: PARTICIPANT }),
  rel(KIND.UTILITY_PART_LOCATAIRE, 'releve_precedent_id', 'values', 'text_ref', [KIND.UTILITY_RELEVE], false, 'Relevé précédent utilisé pour la répartition (champ texte, figé).'),
  rel(KIND.UTILITY_PART_LOCATAIRE, 'releve_actuel_id', 'values', 'text_ref', [KIND.UTILITY_RELEVE], false, 'Relevé actuel utilisé pour la répartition (champ texte, figé).'),
  ...recordCommon(KIND.UTILITY_PARTICIPATION),
  rel(KIND.UTILITY_PARTICIPATION, 'participant_id', 'values', 'text_ref', PARTICIPANT_TARGETS, true, 'Participant : contrat ou contact.', { polymorphic: PARTICIPANT }),

  // ---- Tontines (blocs historiques) -------------------------------------------------------------------------------
  rel(KIND.TONTINE_GROUPE, 'ownerId', 'property', 'identity_ref', [], true, 'Identité locale du créateur.'),
  rel(KIND.TONTINE_MEMBRE, 'groupId', 'property', 'relation', [KIND.TONTINE_GROUPE], true, 'Tontine du membre.'),
  rel(KIND.TONTINE_MEMBRE, 'userId', 'property', 'identity_ref', [], true, 'Identité du membre : utilisateur local ou « guest-… » (invité sans compte).'),
  rel(KIND.TONTINE_TOUR, 'groupId', 'property', 'relation', [KIND.TONTINE_GROUPE], true, 'Tontine du tour.'),
  rel(KIND.TONTINE_TOUR, 'beneficiaryMemberId', 'property', 'relation', [KIND.TONTINE_MEMBRE], true, 'Membre bénéficiaire (figé à la génération du tour).'),
  rel(KIND.TONTINE_COTISATION, 'groupId', 'property', 'relation', [KIND.TONTINE_GROUPE], true, 'Tontine de la cotisation.'),
  rel(KIND.TONTINE_COTISATION, 'tourId', 'property', 'relation', [KIND.TONTINE_TOUR], true, 'Tour concerné.'),
  rel(KIND.TONTINE_COTISATION, 'memberId', 'property', 'relation', [KIND.TONTINE_MEMBRE], true, 'Membre qui cotise.'),
  rel(KIND.TONTINE_CYCLE_HISTORIQUE, 'groupId', 'property', 'relation', [KIND.TONTINE_GROUPE], true, 'Ancien modèle, lecture seule.'),
  rel(KIND.TONTINE_CORRECTION_COTISATION, 'targetId', 'property', 'relation', [KIND.TONTINE_COTISATION], true, 'Cotisation initiale corrigée ou annulée (le fait initial n’est jamais modifié).'),
  rel(KIND.TONTINE_CORRECTION_COTISATION, 'createdBy', 'property', 'identity_ref', [], true, 'Identité locale de l’auteur.'),

  // ---- Formulaires (blocs historiques) ------------------------------------------------------------------------------
  rel(KIND.FORMS_FORMULAIRE, 'ownerId', 'property', 'identity_ref', [], true, 'Identité locale du créateur.'),
  rel(KIND.FORMS_FORMULAIRE, 'groupId', 'property', 'relation', [KIND.TONTINE_GROUPE], false, 'Tontine liée, facultative.'),
  rel(KIND.FORMS_FORMULAIRE, 'templateId', 'property', 'static_ref', [], false, 'Modèle fourni par l’application : jamais synchronisé.'),
  rel(KIND.FORMS_REPONSE, 'formId', 'property', 'relation', [KIND.FORMS_FORMULAIRE], true, 'Formulaire rempli.'),
  rel(KIND.FORMS_REPONSE, 'clientId', 'property', 'identity_ref', [], true, 'Identité de la personne qui répond.'),

  // ---- Moteur générique -----------------------------------------------------------------------------------------------
  rel(KIND.CORE_CONTACT, 'createdBy', 'property', 'identity_ref', [], true, 'Identité locale.'),
  rel(KIND.CORE_CONTACT, 'linkedUserId', 'property', 'identity_ref', [], false, 'Compte TakarDa lié plus tard (non construit à ce jour).'),
  rel(KIND.CORE_OUTIL, 'ownerId', 'property', 'identity_ref', [], true, 'Identité locale.'),
  rel(KIND.CORE_OUTIL, 'entityDefinitionIds', 'property', 'local_id', [], false, 'Liste d’identifiants de définitions propres à l’appareil (tableau) : jamais envoyés.'),
  rel(KIND.CORE_DEFINITION_ENTITE, 'toolId', 'property', 'relation', [KIND.CORE_OUTIL], true, 'Outil propriétaire (identifiant local).'),
  rel(KIND.CORE_ROLE, 'toolId', 'property', 'relation', [KIND.CORE_OUTIL], true, 'Outil propriétaire (identifiant local).'),
  rel(KIND.CORE_MEMBRE_OUTIL, 'toolId', 'property', 'relation', [KIND.CORE_OUTIL], true, 'Outil.'),
  rel(KIND.CORE_MEMBRE_OUTIL, 'roleId', 'property', 'relation', [KIND.CORE_ROLE], true, 'Rôle.'),
  rel(KIND.CORE_MEMBRE_OUTIL, 'userId', 'property', 'identity_ref', [], false, 'Utilisateur (accountType « user »).'),
  rel(KIND.CORE_MEMBRE_OUTIL, 'contactId', 'property', 'relation', [KIND.CORE_CONTACT], false, 'Contact (accountType « external »).'),
  rel(KIND.CORE_DOCUMENT, 'toolId', 'property', 'relation', [KIND.CORE_OUTIL], false, 'Outil.'),
  rel(KIND.CORE_DOCUMENT, 'recordId', 'property', 'relation', [KIND.IMMOBILIER_BIEN, KIND.IMMOBILIER_PAIEMENT, KIND.UTILITY_FACTURE, KIND.UTILITY_FACTURE_PARTAGEE], false, 'Enregistrement porteur de la pièce jointe (type variable).'),
  rel(KIND.CORE_REGLE, 'toolId', 'property', 'relation', [KIND.CORE_OUTIL], true, 'Outil.'),
  rel(KIND.CORE_REGLE, 'entityDefinitionId', 'property', 'relation', [KIND.CORE_DEFINITION_ENTITE], true, 'Définition visée (identifiant local).'),
  rel(KIND.CORE_EVENEMENT, 'toolId', 'property', 'relation', [KIND.CORE_OUTIL], false, 'Journal local.'),
  rel(KIND.CORE_EVENEMENT, 'entityDefinitionId', 'property', 'relation', [KIND.CORE_DEFINITION_ENTITE], false, 'Journal local.'),
  rel(KIND.CORE_EVENEMENT, 'recordId', 'property', 'text_ref', [], false, 'Enregistrement concerné (type variable) ; journal local, non synchronisé.'),
  rel(KIND.CORE_EVENEMENT, 'actorId', 'property', 'identity_ref', [], false, 'Auteur.'),

  // ---- Journaux et profil local ----------------------------------------------------------------------------------------
  rel(KIND.ACTIVITE_EVENEMENT, 'groupId', 'property', 'relation', [KIND.TONTINE_GROUPE], false, 'Tontine concernée.'),
  rel(KIND.ACTIVITE_EVENEMENT, 'toolId', 'property', 'relation', [KIND.CORE_OUTIL], false, 'Outil concerné (identifiant local).'),
  rel(KIND.ACTIVITE_EVENEMENT, 'userId', 'property', 'identity_ref', [], false, 'Auteur.'),
  rel(KIND.ACTIVITE_EVENEMENT, 'entityId', 'property', 'text_ref', [], false, 'Objet concerné, de type variable (voir `entityType`) ; journal local, non synchronisé.'),
];

/**
 * Champs dont le nom ressemble à une référence mais qui n'en sont PAS (poignée de partage, identifiant propre à l'objet…).
 * Chaque exception est justifiée : sans elle, la détection de références inconnues la signalerait.
 */
export const NON_REFERENCE_FIELDS: Readonly<Partial<Record<Kind, Readonly<Record<string, string>>>>> = {
  [KIND.PROFIL_LOCAL]: { formeaseId: 'Poignée de partage lisible (« FE-4821 »), pas un identifiant d’enregistrement.' },
  [KIND.FORMS_REPONSE]: { qrToken: 'Jeton du QR de la réponse, pas une référence.' },
};

const BY_KIND = new Map<Kind, RelationDef[]>();
for (const r of RELATIONS) BY_KIND.set(r.kind, [...(BY_KIND.get(r.kind) ?? []), r]);

export const relationsOf = (kind: Kind): readonly RelationDef[] => BY_KIND.get(kind) ?? [];
export const findRelation = (kind: Kind, field: string): RelationDef | undefined => relationsOf(kind).find((r) => r.field === field);

/** Références vers d'autres ENREGISTREMENTS (exclut identités, contenus fournis par l'application et identifiants locaux). */
export const entityReferencesOf = (kind: Kind): readonly RelationDef[] => relationsOf(kind).filter((r) => r.type === 'relation' || r.type === 'text_ref');

export interface ExtractedReference {
  field: string;
  type: ReferenceType;
  /** Type visé après résolution des références de type variable ; null si aucune entité n'est visée (saisie libre, journal). */
  targetKind: Kind | null;
  /** Valeur textuelle trouvée (jamais interprétée comme une autorisation). */
  id: string;
}

const read = (item: Record<string, unknown>, def: RelationDef, field: string): unknown => {
  if (def.location === 'values') {
    const v = item.values;
    return v && typeof v === 'object' ? (v as Record<string, unknown>)[field] : undefined;
  }
  return item[field];
};

/**
 * Références d'entité PRÉSENTES dans un élément (valeur texte non vide). Ne modifie rien. Une référence de type variable est
 * résolue par son champ discriminant ; si le discriminant est inconnu ou « saisie libre », `targetKind` vaut null.
 */
export function extractReferences(kind: Kind, item: Record<string, unknown>): ExtractedReference[] {
  const out: ExtractedReference[] = [];
  for (const def of entityReferencesOf(kind)) {
    const raw = read(item, def, def.field);
    if (typeof raw !== 'string' || raw === '') continue;
    let targetKind: Kind | null = def.targets.length === 1 ? def.targets[0] : null;
    if (def.polymorphic) {
      const discriminator = read(item, def, def.polymorphic.discriminator);
      targetKind = typeof discriminator === 'string' ? def.polymorphic.map[discriminator] ?? null : null;
    }
    out.push({ field: def.field, type: def.type, targetKind, id: raw });
  }
  return out;
}

/** Heuristique de détection : le nom du champ ressemble-t-il à une référence (« …Id », « …_id », « …Ids ») ? */
export const looksLikeReference = (field: string): boolean => field !== 'id' && /(^|[a-z0-9])(Id|Ids|_id|_ids)$/.test(field);

/**
 * Champs de l'élément qui ressemblent à des références mais ne sont NI déclarés dans le manifeste NI listés comme exceptions.
 * Sert de garde : un nouveau champ de référence ajouté sans déclaration est repéré. Aucune conversion automatique.
 */
export function findUndeclaredReferenceFields(kind: Kind, item: Record<string, unknown>): string[] {
  const declared = new Set(relationsOf(kind).map((r) => r.field));
  const exceptions = NON_REFERENCE_FIELDS[kind] ?? {};
  const names = new Set<string>(Object.keys(item));
  const nested = item.values;
  if (nested && typeof nested === 'object') for (const key of Object.keys(nested as object)) names.add(key);
  return [...names].filter((name) => looksLikeReference(name) && !declared.has(name) && !(name in exceptions)).sort();
}

export interface DanglingReference extends ExtractedReference {
  kind: Kind;
  itemId: string;
}

/** Références d'entité qui ne pointent vers rien (orphelins), d'après un résolveur fourni par l'appelant. Lecture seule. */
export function findDanglingReferences(kind: Kind, item: Record<string, unknown>, exists: (targetKind: Kind, id: string) => boolean): DanglingReference[] {
  return extractReferences(kind, item)
    .filter((ref) => ref.targetKind !== null && !exists(ref.targetKind, ref.id))
    .map((ref) => ({ ...ref, kind, itemId: typeof item.id === 'string' ? item.id : '' }));
}

/**
 * Ordre d'envoi : les types référencés AVANT ceux qui les référencent (parents d'abord), limité aux types à synchroniser.
 * Lève une erreur si les dépendances forment un cycle (le manifeste serait alors inutilisable pour ordonner l'envoi).
 */
export function syncOrder(): Kind[] {
  const nodes = kindsToSync();
  const set = new Set<Kind>(nodes);
  const deps = new Map<Kind, Set<Kind>>(nodes.map((k) => [k, new Set<Kind>()]));
  for (const k of nodes) {
    for (const def of entityReferencesOf(k)) {
      const targets = def.polymorphic ? Object.values(def.polymorphic.map).filter((t): t is Kind => t !== null) : def.targets;
      for (const t of targets) if (set.has(t) && t !== k) deps.get(k)!.add(t);
    }
  }
  const order: Kind[] = [];
  const state = new Map<Kind, 'visiting' | 'done'>();
  const visit = (k: Kind, path: Kind[]) => {
    if (state.get(k) === 'done') return;
    if (state.get(k) === 'visiting') throw new Error(`Cycle de dépendances entre types : ${[...path, k].join(' → ')}`);
    state.set(k, 'visiting');
    for (const dep of deps.get(k)!) visit(dep, [...path, k]);
    state.set(k, 'done');
    order.push(k);
  };
  for (const k of nodes) visit(k, []);
  return order;
}

/** Vrai si le type est déclaré comme financier dans le registre (utile aux politiques de conflit de P3). */
export const isFinancialFact = (kind: Kind): boolean => getKindDefinition(kind).financialFact;
