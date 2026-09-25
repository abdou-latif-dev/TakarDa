// Factures — first real proof that a business module can be built entirely on
// the generic Core engine. No `factures[]` array, no parallel service — every
// read/write here goes through coreService (Tool/EntityDefinition/RecordItem).
//
// This file only knows how to provision the "Factures" Tool + "Facture"
// EntityDefinition once, idempotently. Screens then talk to coreService /
// store/coreStore.ts directly like any other Core-backed module.
//
// Models the useful H-PAY bill workflow on TakarDa's Core engine: CEET/TDE
// invoice entry, meter or equal-share allocation across active leases, then
// owner-entered manual payment validation per tenant. No payment provider is
// involved; the owner records what they verified in the real world.

import { coreService } from './coreService';
import type { EntityDefinition, Tool } from '@/types/entities';

const FACTURE_ENTITY_KEY = 'facture';
const RELEVE_ENTITY_KEY = 'releve';

async function findFacturesTool(): Promise<Tool | null> {
  const found = await coreService.getTools({ kind: 'facture' });
  return found[0] ?? null;
}

/** Idempotent — creates the Tool + EntityDefinition on first call, reuses them afterwards. */
export async function ensureFacturesTool(): Promise<{ tool: Tool; entityDefinition: EntityDefinition; releveDefinition: EntityDefinition }> {
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

  const releveDefinition =
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
        { key: 'compteur', type: 'text', label: 'Nom / repère du compteur', required: true },
        { key: 'index', type: 'number', label: 'Index relevé', required: true },
        { key: 'note', type: 'text', label: 'Note', required: false },
      ],
    }));

  return { tool, entityDefinition, releveDefinition };
}
