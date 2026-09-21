// Factures — first real proof that a business module can be built entirely on
// the generic Core engine. No `factures[]` array, no parallel service — every
// read/write here goes through coreService (Tool/EntityDefinition/RecordItem).
//
// This file only knows how to provision the "Factures" Tool + "Facture"
// EntityDefinition once, idempotently. Screens then talk to coreService /
// store/coreStore.ts directly like any other Core-backed module.
//
// Reviewed against the H-PAY audit (Étape 2): its CEET/TDE "calculateur"
// splits one already-known invoice across several tenants sharing a meter —
// a genuinely different feature (Immobilier × Factures territory, see §9 of
// the report) that this "suivi de facture" module deliberately does not
// absorb. H-PAY itself has no due-date, no compteur reference and no
// justificatif for utility bills — this module already has all three, so
// nothing was missing to port. The one real fix: StatusDefinition.color used
// to hardcode this module's own hex value (#FF7A00), duplicating the app's
// accent color in a domain file — now a semantic token key resolved by the
// UI via constants/theme.ts, so it follows the theme like everything else.

import { coreService } from './coreService';
import type { EntityDefinition, Tool } from '@/types/entities';

const FACTURE_ENTITY_KEY = 'facture';

async function findFacturesTool(): Promise<Tool | null> {
  const found = await coreService.getTools({ kind: 'facture' });
  return found[0] ?? null;
}

/** Idempotent — creates the Tool + EntityDefinition on first call, reuses them afterwards. */
export async function ensureFacturesTool(): Promise<{ tool: Tool; entityDefinition: EntityDefinition }> {
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
        { key: 'payee', label: 'Payée', color: 'success', isTerminal: true, order: 1 },
        { key: 'en_retard', label: 'En retard', color: 'danger', order: 2 },
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
        { key: 'client', type: 'text', label: 'Client', required: false },
        { key: 'montant', type: 'amount', label: 'Montant', required: true },
        { key: 'date_emission', type: 'date', label: "Date d'émission", required: true },
        { key: 'echeance', type: 'date', label: "Date d'échéance", required: false },
        { key: 'justificatif', type: 'file', label: 'Justificatif (photo ou fichier)', required: false },
      ],
    });
  }

  return { tool, entityDefinition };
}
