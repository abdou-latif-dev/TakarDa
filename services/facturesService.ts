// Factures — first real proof that a business module can be built entirely on
// the generic Core engine. No `factures[]` array, no parallel service — every
// read/write here goes through coreService (Tool/EntityDefinition/RecordItem).
//
// This file only knows how to provision the "Factures" Tool + its
// EntityDefinitions once, idempotently. Screens then talk to coreService /
// store/coreStore.ts directly like any other Core-backed module.
//
// Models the useful H-PAY bill workflow on TakarDa's Core engine: CEET/TDE
// invoice entry, meter or equal-share allocation across active leases, then
// owner-entered manual payment validation per tenant. No payment provider is
// involved; the owner records what they verified in the real world.
//
// Étape 4 (fusion CEET/TDE) — cette Tool est désormais le SEUL moteur de
// répartition de factures partagées de TakarDa, utilisable aussi bien depuis
// Immobilier (avec un `bien`/des `contrat`) que depuis Factures seul (sans
// bien). Voir services/utilityBillingService.ts pour les calculs et
// l'orchestration ; ce fichier ne fait que déclarer le schéma :
//   - `facture`   : facture simple, non répartie (comportement d'origine,
//                   inchangé — toujours valable pour une facture réglée par
//                   une seule personne, sans partage).
//   - `releve`    : un index de compteur par (fournisseur, mois, participant).
//   - `facture_partagee` : une facture CEET/TDE/autre à répartir.
//   - `part_locataire`   : une part individuelle de facture_partagee, un vrai
//                   RecordItem Core avec son propre statut et son historique
//                   (remplace le `repartitions_json` de la première tentative
//                   Factures — voir la section "compatibilité" plus bas).
//
// `facture.repartitions_json`/`bien_id`/`bien_nom`/`mode_repartition` restent
// déclarés pour la LECTURE d'anciennes factures qui les auraient déjà utilisés
// (FactureDetailScreen sait encore les afficher) — plus aucun nouveau code
// n'écrit dedans. Rien n'a été supprimé.

import { coreService } from './coreService';
import type { EntityDefinition, Tool } from '@/types/entities';

const FACTURE_ENTITY_KEY = 'facture';
const RELEVE_ENTITY_KEY = 'releve';
const FACTURE_PARTAGEE_ENTITY_KEY = 'facture_partagee';
const PART_LOCATAIRE_ENTITY_KEY = 'part_locataire';

export interface FacturesEntities {
  tool: Tool;
  entityDefinition: EntityDefinition;
  releveDefinition: EntityDefinition;
  facturePartageeDefinition: EntityDefinition;
  partLocataireDefinition: EntityDefinition;
}

async function findFacturesTool(): Promise<Tool | null> {
  const found = await coreService.getTools({ kind: 'facture' });
  return found[0] ?? null;
}

/** Idempotent — creates the Tool + EntityDefinitions on first call, reuses them afterwards. */
export async function ensureFacturesTool(): Promise<FacturesEntities> {
  let tool = await findFacturesTool();
  if (!tool) {
    tool = await coreService.createTool({ name: 'Factures', icon: 'receipt-long', kind: 'facture' });
  }

  const existingEntities = await coreService.getEntityDefinitions(tool.id);
  let entityDefinition = existingEntities.find((e) => e.key === FACTURE_ENTITY_KEY) ?? null;
  if (!entityDefinition) {
    entityDefinition = await coreService.createEntityDefinition({
      toolId: tool.id,
      key: FACTURE_ENTITY_KEY,
      label: 'Facture',
      labelPlural: 'Factures',
      icon: 'receipt-long',
      isSystem: true,
      statuses: [
        { key: 'a_payer', label: 'À payer', color: 'warning', order: 0 },
        { key: 'partielle', label: 'Partiellement payée', color: 'warning', order: 1 },
        { key: 'payee', label: 'Payée', color: 'success', isTerminal: true, order: 2 },
        { key: 'en_retard', label: 'En retard', color: 'danger', order: 3 },
      ],
      fields: [
        {
          key: 'fournisseur',
          type: 'select',
          label: 'Fournisseur',
          required: true,
          options: [
            { id: 'ceet', label: 'CEET' },
            { id: 'tde', label: 'TDE' },
            { id: 'autre', label: 'Autre' },
          ],
        },
        { key: 'reference_compteur', type: 'text', label: 'Référence / N° compteur', required: true },
        { key: 'mois', type: 'text', label: 'Mois de facture', required: true },
        { key: 'bien_id', type: 'text', label: 'Bien immobilier (interne)', required: false },
        { key: 'bien_nom', type: 'text', label: 'Bien', required: false },
        { key: 'mode_repartition', type: 'text', label: 'Mode de répartition', required: false },
        { key: 'repartitions_json', type: 'text', label: 'Lignes de répartition (historique)', required: false },
        { key: 'client', type: 'text', label: 'Client', required: false },
        { key: 'montant', type: 'amount', label: 'Montant', required: true },
        { key: 'date_emission', type: 'date', label: "Date d'émission", required: true },
        { key: 'echeance', type: 'date', label: "Date d'échéance", required: false },
        { key: 'mode_paiement', type: 'text', label: 'Mode de paiement (note)', required: false },
        { key: 'date_paiement', type: 'date', label: 'Date du paiement', required: false },
        { key: 'note', type: 'text', label: 'Note', required: false },
        { key: 'justificatif', type: 'file', label: 'Justificatif (photo ou fichier)', required: false },
      ],
    });
  }

  // Safe, additive migration for installations that already created the
  // invoice definition before manual payment details were available.
  const addedFields = [
    { key: 'mois', type: 'text' as const, label: 'Mois de facture', required: true },
    { key: 'bien_id', type: 'text' as const, label: 'Bien immobilier (interne)', required: false },
    { key: 'bien_nom', type: 'text' as const, label: 'Bien', required: false },
    { key: 'mode_repartition', type: 'text' as const, label: 'Mode de répartition', required: false },
    { key: 'repartitions_json', type: 'text' as const, label: 'Lignes de répartition (historique)', required: false },
    { key: 'mode_paiement', type: 'text' as const, label: 'Mode de paiement (note)', required: false },
    { key: 'date_paiement', type: 'date' as const, label: 'Date du paiement', required: false },
    { key: 'note', type: 'text' as const, label: 'Note', required: false },
  ].filter((field) => !entityDefinition!.fields.some((current) => current.key === field.key));
  if (addedFields.length) {
    entityDefinition = await coreService.updateEntityDefinition(entityDefinition.id, {
      fields: [...entityDefinition!.fields, ...addedFields.map((field, index) => ({ ...field, id: `legacy-${field.key}`, order: entityDefinition!.fields.length + index }))],
    });
  }
  const nextStatuses = [
    ...(entityDefinition.statuses ?? []),
    ...(!entityDefinition.statuses?.some((status) => status.key === 'partielle')
      ? [{ key: 'partielle', label: 'Partiellement payée', color: 'warning' as const, order: 1 }]
      : []),
  ];
  if (nextStatuses.length !== (entityDefinition.statuses ?? []).length) {
    entityDefinition = await coreService.updateEntityDefinition(entityDefinition.id, { statuses: nextStatuses });
  }

  let releveDefinition =
    existingEntities.find((e) => e.key === RELEVE_ENTITY_KEY) ??
    (await coreService.createEntityDefinition({
      toolId: tool.id,
      key: RELEVE_ENTITY_KEY,
      label: 'Relevé de compteur',
      labelPlural: 'Relevés de compteur',
      icon: 'speed',
      isSystem: true,
      fields: [
        { key: 'fournisseur', type: 'select', label: 'Type de compteur', required: true, options: [{ id: 'ceet', label: 'CEET' }, { id: 'tde', label: 'TDE' }, { id: 'autre', label: 'Autre' }] },
        { key: 'mois', type: 'text', label: 'Mois (AAAA-MM)', required: true },
        { key: 'compteur', type: 'text', label: 'Nom / repère du compteur (affichage)', required: true },
        { key: 'index', type: 'number', label: 'Index relevé', required: true },
        { key: 'note', type: 'text', label: 'Note', required: false },
        // Étape 4 — identité réelle du participant, en plus du libellé texte
        // `compteur` (qui reste un simple affichage, jamais une clé). Corrige
        // la collision possible entre deux biens ayant un compteur au même
        // nom : `participant_id` est toujours un id Core unique (Contrat.id ou
        // ExternalContact.id), jamais le libellé tapé par l'utilisateur.
        {
          key: 'participant_type',
          type: 'select',
          label: 'Type de participant',
          required: false,
          options: [
            { id: 'contrat', label: 'Contrat (Immobilier)' },
            { id: 'contact', label: 'Contact' },
            { id: 'manuel', label: 'Saisie libre' },
          ],
        },
        { key: 'participant_id', type: 'text', label: 'Participant (interne)', required: false },
      ],
    }));

  const releveFieldsToAdd = [
    { key: 'participant_type', type: 'select' as const, label: 'Type de participant', required: false, options: [{ id: 'contrat', label: 'Contrat (Immobilier)' }, { id: 'contact', label: 'Contact' }, { id: 'manuel', label: 'Saisie libre' }] },
    { key: 'participant_id', type: 'text' as const, label: 'Participant (interne)', required: false },
  ].filter((field) => !releveDefinition.fields.some((current) => current.key === field.key));
  if (releveFieldsToAdd.length) {
    releveDefinition = await coreService.updateEntityDefinition(releveDefinition.id, {
      fields: [...releveDefinition.fields, ...releveFieldsToAdd.map((field, index) => ({ ...field, id: `legacy-${field.key}`, order: releveDefinition.fields.length + index }))],
    });
  }

  // Facture répartie entre plusieurs participants — distincte de `facture`
  // (qui reste la facture simple, non répartie, à un seul payeur).
  const facturePartageeDefinition =
    existingEntities.find((e) => e.key === FACTURE_PARTAGEE_ENTITY_KEY) ??
    (await coreService.createEntityDefinition({
      toolId: tool.id,
      key: FACTURE_PARTAGEE_ENTITY_KEY,
      label: 'Facture partagée',
      labelPlural: 'Factures partagées',
      icon: 'bolt',
      isSystem: true,
      // Mêmes clés que `facture` (respect de la convention déjà en place) —
      // le statut global est dérivé de l'état réel des part_locataire.
      statuses: [
        { key: 'a_payer', label: 'À payer', color: 'warning', order: 0 },
        { key: 'partielle', label: 'Partiellement payée', color: 'warning', order: 1 },
        { key: 'payee', label: 'Payée', color: 'success', isTerminal: true, order: 2 },
      ],
      fields: [
        // Optionnel : présent quand la facture vient d'un Bien Immobilier,
        // absent en usage Factures autonome (atelier, boutique, association...).
        // `relationTarget` (EntityDefinition.id de "bien") n'est pas connu ici —
        // Factures ne dépend pas d'Immobilier. Il est renseigné une seule fois,
        // paresseusement, par services/utilityBillingService.ts la première
        // fois qu'une facture_partagee est réellement créée depuis un Bien.
        { key: 'bien', type: 'relation', label: 'Bien', required: false },
        {
          key: 'fournisseur',
          type: 'select',
          label: 'Fournisseur',
          required: true,
          options: [
            { id: 'ceet', label: 'CEET' },
            { id: 'tde', label: 'TDE' },
            { id: 'autre', label: 'Autre' },
          ],
        },
        { key: 'mois', type: 'text', label: 'Mois (AAAA-MM)', required: true },
        { key: 'montant_total', type: 'amount', label: 'Montant total de la facture', required: true },
        {
          key: 'mode_repartition',
          type: 'select',
          label: 'Mode de répartition',
          required: false,
          options: [
            { id: 'proportionnel', label: 'Proportionnel (selon consommation)' },
            { id: 'equitable', label: 'Équitable (parts égales)' },
          ],
        },
        { key: 'justificatif', type: 'file', label: 'Justificatif (photo ou fichier)', required: false },
        { key: 'note', type: 'text', label: 'Note', required: false },
      ],
    }));

  const partLocataireDefinition =
    existingEntities.find((e) => e.key === PART_LOCATAIRE_ENTITY_KEY) ??
    (await coreService.createEntityDefinition({
      toolId: tool.id,
      key: PART_LOCATAIRE_ENTITY_KEY,
      label: 'Part de facture',
      labelPlural: 'Parts de facture',
      icon: 'call-split',
      isSystem: true,
      statuses: [
        { key: 'a_payer', label: 'À payer', color: 'warning', order: 0 },
        { key: 'payee', label: 'Payée', color: 'success', isTerminal: true, order: 1 },
      ],
      fields: [
        { key: 'facture_partagee', type: 'relation', label: 'Facture partagée', required: true, relationTarget: facturePartageeDefinition.id },
        // Même identité de participant que `releve` ci-dessus (contrat, contact,
        // ou saisie libre) — jamais un simple libellé texte utilisé comme clé.
        {
          key: 'participant_type',
          type: 'select',
          label: 'Type de participant',
          required: true,
          options: [
            { id: 'contrat', label: 'Contrat (Immobilier)' },
            { id: 'contact', label: 'Contact' },
            { id: 'manuel', label: 'Saisie libre' },
          ],
        },
        { key: 'participant_id', type: 'text', label: 'Participant (interne)', required: false },
        // Figé au moment de la validation — un nom affiché reste stable même
        // si le contrat/contact change de nom plus tard (comme H-PAY snapshotte
        // tenantName sur chaque facture, voir l'audit H-PAY, Étape 3).
        { key: 'label', type: 'text', label: 'Nom affiché', required: true },
        { key: 'consommation', type: 'number', label: 'Consommation', required: false },
        { key: 'montant_attribue', type: 'amount', label: 'Montant attribué', required: true },
      ],
    }));

  return { tool, entityDefinition, releveDefinition, facturePartageeDefinition, partLocataireDefinition };
}
