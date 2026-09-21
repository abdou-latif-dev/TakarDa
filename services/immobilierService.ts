// Immobilier — second proof that a business module can be built entirely on
// the generic Core engine, informed by a real-world reference (H-PAY, a
// tenant/rent-management app) without copying its Firestore-specific
// architecture. See the "TakarDa — Étape 2" report for the full H-PAY audit
// and the reasoning behind the entity choices below.
//
// Deliberate deviation from the brief's indicative structure: no standalone
// "Logement" EntityDefinition. H-PAY's real data model proves a rental unit
// is never used independently of its lease in practice — every H-PAY
// `tenants` doc IS simultaneously the room, the tenant snapshot and the lease
// terms. TakarDa keeps that in one "Contrat" entity (room info + lease terms)
// and represents the actual person via ExternalContact/ToolMember instead —
// which H-PAY does NOT have (it force-creates a login-capable account for
// every tenant); this is a genuine improvement, not a regression.
//
// The tenant's identity fields (nom/téléphone) are captured directly in the
// Contrat creation form for a single-step flow (matching H-PAY's
// AddTenantScreen UX), then used to create the ExternalContact + ToolMember
// behind the scenes — see createContratWithLocataire() below.

import { coreService } from './coreService';
import type { EntityDefinition, FieldValue, RecordItem, RoleDefinition, Tool } from '@/types/entities';

const BIEN_KEY = 'bien';
const CONTRAT_KEY = 'contrat';
const PAIEMENT_KEY = 'paiement';
const DEPENSE_KEY = 'depense';
const LOCATAIRE_ROLE_KEY = 'locataire';

export interface ImmobilierEntities {
  tool: Tool;
  bien: EntityDefinition;
  contrat: EntityDefinition;
  paiement: EntityDefinition;
  depense: EntityDefinition;
  locataireRole: RoleDefinition;
}

async function findImmobilierTool(): Promise<Tool | null> {
  const found = await coreService.getTools({ kind: 'immobilier' });
  return found[0] ?? null;
}

/** Idempotent — provisions the Tool + 4 EntityDefinitions + the "Locataire" role on first call. */
export async function ensureImmobilierTool(): Promise<ImmobilierEntities> {
  let tool = await findImmobilierTool();
  if (!tool) {
    tool = await coreService.createTool({ name: 'Immobilier', icon: 'home-work', kind: 'immobilier' });
  }

  const existingEntities = await coreService.getEntityDefinitions(tool.id);
  const byKey = (key: string) => existingEntities.find((e) => e.key === key) ?? null;

  const bien =
    byKey(BIEN_KEY) ??
    (await coreService.createEntityDefinition({
      toolId: tool.id,
      key: BIEN_KEY,
      label: 'Bien',
      labelPlural: 'Biens',
      icon: 'home-work',
      isSystem: true,
      fields: [
        { key: 'nom', type: 'text', label: 'Nom du bien', required: true },
        { key: 'adresse', type: 'text', label: 'Adresse', required: true },
      ],
    }));

  const contrat =
    byKey(CONTRAT_KEY) ??
    (await coreService.createEntityDefinition({
      toolId: tool.id,
      key: CONTRAT_KEY,
      label: 'Contrat',
      labelPlural: 'Contrats',
      icon: 'description',
      isSystem: true,
      // H-PAY ROOM_TYPES (AddTenantScreen.js) — free select, not an enforced enum there either.
      statuses: [
        { key: 'actif', label: 'Actif', color: 'success', order: 0 },
        { key: 'vacant', label: 'Vacant', color: 'muted', order: 1 },
        { key: 'archive', label: 'Archivé', color: 'muted', isTerminal: true, order: 2 },
      ],
      fields: [
        { key: 'bien', type: 'relation', label: 'Bien', required: true, relationTarget: bien.id },
        { key: 'nom_logement', type: 'text', label: 'Logement (ex: Chambre A1)', required: true },
        {
          key: 'type_logement',
          type: 'select',
          label: 'Type',
          required: false,
          options: [
            { id: 'chambre_simple', label: 'Chambre simple' },
            { id: 'chambre_salon', label: 'Chambre salon' },
            { id: '2_chambres_salon', label: '2 chambres salon' },
            { id: 'appartement', label: 'Appartement' },
            { id: 'villa', label: 'Villa' },
            { id: 'boutique', label: 'Boutique' },
          ],
        },
        { key: 'loyer_mensuel', type: 'amount', label: 'Loyer mensuel', required: true },
        { key: 'caution', type: 'amount', label: 'Caution', required: false },
        { key: 'avance', type: 'amount', label: 'Avance', required: false },
        { key: 'date_entree', type: 'date', label: "Date d'entrée", required: false },
        // Not a visible form field — populated by createContratWithLocataire() once the
        // ExternalContact/ToolMember is created. See the header comment above.
        { key: 'locataire_member_id', type: 'text', label: 'Locataire (interne)', required: false },
        { key: 'locataire_nom', type: 'text', label: 'Nom du locataire', required: false },
        { key: 'locataire_telephone', type: 'phone', label: 'Téléphone du locataire', required: false },
      ],
    }));

  const paiement =
    byKey(PAIEMENT_KEY) ??
    (await coreService.createEntityDefinition({
      toolId: tool.id,
      key: PAIEMENT_KEY,
      label: 'Paiement',
      labelPlural: 'Paiements',
      icon: 'payments',
      isSystem: true,
      statuses: [
        { key: 'en_attente', label: 'En attente', color: 'warning', order: 0 },
        { key: 'paye', label: 'Payé', color: 'success', isTerminal: true, order: 1 },
        { key: 'rejete', label: 'Rejeté', color: 'danger', isTerminal: true, order: 2 },
      ],
      fields: [
        { key: 'contrat', type: 'relation', label: 'Contrat', required: true, relationTarget: contrat.id },
        { key: 'montant', type: 'amount', label: 'Montant', required: true },
        { key: 'mois', type: 'text', label: 'Mois (AAAA-MM)', required: true },
        { key: 'note', type: 'text', label: 'Note', required: false },
      ],
    }));

  const depense =
    byKey(DEPENSE_KEY) ??
    (await coreService.createEntityDefinition({
      toolId: tool.id,
      key: DEPENSE_KEY,
      label: 'Dépense',
      labelPlural: 'Dépenses',
      icon: 'receipt',
      isSystem: true,
      fields: [
        { key: 'bien', type: 'relation', label: 'Bien', required: true, relationTarget: bien.id },
        {
          key: 'categorie',
          type: 'select',
          label: 'Catégorie',
          required: false,
          options: [
            { id: 'entretien', label: 'Entretien' },
            { id: 'reparation', label: 'Réparation' },
            { id: 'taxe', label: 'Taxe' },
            { id: 'autre', label: 'Autre' },
          ],
        },
        { key: 'libelle', type: 'text', label: 'Libellé', required: true },
        { key: 'montant', type: 'amount', label: 'Montant', required: true },
        { key: 'date', type: 'date', label: 'Date', required: true },
      ],
    }));

  const existingRoles = await coreService.getRoleDefinitions(tool.id);
  const locataireRole =
    existingRoles.find((r) => r.key === LOCATAIRE_ROLE_KEY) ??
    (await coreService.createRoleDefinition({
      toolId: tool.id,
      key: LOCATAIRE_ROLE_KEY,
      label: 'Locataire',
      isDefault: true,
      permissions: { canView: true, canCreate: false, canEdit: false, canDelete: false, canManageTool: false, canInvite: false, scope: 'own' },
    }));

  return { tool, bien, contrat, paiement, depense, locataireRole };
}

/** Creates a Contrat and, if tenant details are given, an ExternalContact + ToolMember
 * for the tenant in one step — mirrors H-PAY's AddTenantScreen combined form (see report). */
export async function createContratWithLocataire(input: {
  toolId: string;
  contratEntityDefinitionId: string;
  locataireRoleId: string;
  values: Record<string, FieldValue>;
  locataireNom?: string;
  locataireTelephone?: string;
}): Promise<RecordItem> {
  let memberId: string | null = null;
  if (input.locataireNom?.trim()) {
    const contact = await coreService.createExternalContact({ name: input.locataireNom.trim(), phone: input.locataireTelephone?.trim() });
    const member = await coreService.addToolMember({
      toolId: input.toolId,
      roleId: input.locataireRoleId,
      accountType: 'external',
      contactId: contact.id,
      displayName: contact.name,
    });
    memberId = member.id;
  }

  return coreService.createRecord({
    toolId: input.toolId,
    entityDefinitionId: input.contratEntityDefinitionId,
    values: {
      ...input.values,
      locataire_member_id: memberId,
      locataire_nom: input.locataireNom ?? null,
      locataire_telephone: input.locataireTelephone ?? null,
    },
    statusKey: memberId ? 'actif' : 'vacant',
  });
}

export interface ContratLateness {
  key: 'a_jour' | 'retard' | 'sans_paiement';
  label: string;
  lateMonths: number;
}

/** Adapted from H-PAY's src/utils/tenantStatus.js (getTenantPaymentStatus) — computed at
 * read time from real Paiement records, never stored, to avoid the stale-derived-data class
 * of bug this project has already hit once (see the FormEase stabilization history). */
export function computeContratLateness(contrat: RecordItem, paiements: RecordItem[], now = new Date()): ContratLateness {
  const currentIndex = now.getFullYear() * 12 + now.getMonth();
  const paidMonths = paiements
    .filter((p) => p.values.contrat === contrat.id && p.statusKey === 'paye' && typeof p.values.mois === 'string')
    .map((p) => p.values.mois as string)
    .sort();
  const lastPaidMonth = paidMonths.at(-1);

  if (!lastPaidMonth) {
    const entreeRaw = contrat.values.date_entree;
    const entree = typeof entreeRaw === 'string' && entreeRaw ? new Date(entreeRaw) : contrat.createdAt ? new Date(contrat.createdAt) : now;
    const entreeIndex = entree.getFullYear() * 12 + entree.getMonth();
    const lateMonths = Math.max(0, currentIndex - entreeIndex);
    return lateMonths > 0
      ? { key: 'retard', label: 'En retard', lateMonths }
      : { key: 'sans_paiement', label: 'Aucun paiement', lateMonths: 0 };
  }

  const [y, m] = lastPaidMonth.split('-').map(Number);
  const lastPaidIndex = (y ?? now.getFullYear()) * 12 + ((m ?? 1) - 1);
  const lateMonths = Math.max(0, currentIndex - lastPaidIndex);
  return lateMonths > 0 ? { key: 'retard', label: 'En retard', lateMonths } : { key: 'a_jour', label: 'À jour', lateMonths: 0 };
}
