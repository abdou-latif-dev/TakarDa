// Immobilier — module bâti sur le moteur Core (Tool/EntityDefinition/Record),
// informé par H-PAY (application de gestion locative) sans copier son
// architecture Firestore. Voir l'audit Immobilier du 2026-10-04.
//
// Hiérarchie (refonte du 2026-10-04) :
//
//   Bien ──< Logement ──< Contrat ──> Locataire (ExternalContact)
//                           └──< Paiement
//   Bien ──< Dépense
//
// - Le LOGEMENT est une vraie entité persistante, indépendante du contrat :
//   il existe même vacant, et plusieurs contrats successifs peuvent s'y
//   suivre sans jamais recréer le logement.
// - L'OCCUPATION n'est jamais stockée : un logement est occupé s'il a un
//   contrat 'actif', vacant sinon (voir getActiveContrat()).
// - Le LOCATAIRE est un ExternalContact référencé par `contrat.locataire_id`
//   (aucun compte TakarDa requis). Plus de ToolMember créé pour les nouveaux
//   locataires — il n'était jamais relu ; les existants sont conservés.
// - `contrat.bien` reste renseigné (= logement.bien) : dénormalisation
//   volontaire conservée parce que le module Factures (relevés, répartition)
//   regroupe les contrats par bien.
//
// Les champs hérités de l'ancien modèle (nom_logement, type_logement,
// locataire_member_id, locataire_nom, locataire_telephone) restent dans la
// définition du contrat et sur les anciens enregistrements — jamais supprimés —
// pour la compatibilité et l'idempotence de la migration.

import { coreService } from './coreService';
import { ensureFacturesTool } from './facturesService';
import type {
  EntityDefinition,
  ExternalContact,
  FieldDefinition,
  FieldValue,
  RecordItem,
  RoleDefinition,
  Tool,
} from '@/types/entities';

const BIEN_KEY = 'bien';
const LOGEMENT_KEY = 'logement';
const CONTRAT_KEY = 'contrat';
const PAIEMENT_KEY = 'paiement';
const DEPENSE_KEY = 'depense';
const LOCATAIRE_ROLE_KEY = 'locataire';

export const BIEN_TYPES = ['Maison', 'Immeuble', 'Résidence', 'Autre'] as const;
/** Types proposés par H-PAY pour une chambre/un logement. Le type, la cuisine
 * et les WC décrivent le LOGEMENT (pas le locataire) : ils survivent aux
 * changements de locataire. Les anciennes valeurs (« Chambre », « Studio »…)
 * déjà enregistrées restent affichées telles quelles. */
export const LOGEMENT_TYPES = [
  'Chambre simple',
  'Chambre + Salon',
  '2 Chambres + Salon',
  '3 Chambres + Salon',
  'Appartement',
  'Villa',
  'Boutique',
  'Local',
  'Autre',
] as const;
export const CUISINE_OPTIONS = ['Cuisine interne', 'Cuisine externe', 'Sans cuisine'] as const;
export const WC_OPTIONS = ['WC interne', 'WC externe', 'Sans WC'] as const;

const toOptions = (labels: readonly string[]) => labels.map((label) => ({ id: label.toLowerCase(), label }));

export interface ImmobilierEntities {
  tool: Tool;
  bien: EntityDefinition;
  logement: EntityDefinition;
  contrat: EntityDefinition;
  paiement: EntityDefinition;
  depense: EntityDefinition;
  locataireRole: RoleDefinition;
}

// ============================================================================
// Dates & périodes (saisie historiquement libre → parsing tolérant et explicite)
// ============================================================================

/** ISO (`AAAA-MM-JJ` ou `AAAA-MM`) ou `JJ/MM/AAAA` (jour d'abord — le format
 * annoncé par l'ancien placeholder). Retourne null plutôt qu'une date invalide. */
export function parseDay(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(text);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, iso[3] ? Number(iso[3]) : 1);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (fr) {
    const date = new Date(Number(fr[3]), Number(fr[2]) - 1, Number(fr[1]));
    if (Number.isNaN(date.getTime()) || date.getMonth() !== Number(fr[2]) - 1) return null;
    return date;
  }
  return null;
}

/** `AAAA-MM-JJ` en heure locale (jamais décalé par le fuseau). */
export function toIsoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** `JJ/MM/AAAA`, ou « — » si la valeur n'est pas une date lisible. */
export function formatDay(value: unknown): string {
  const date = parseDay(value);
  if (!date) return typeof value === 'string' && value.trim() ? value : '—';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

/** Normalise un mois saisi (`AAAA-MM`, `MM/AAAA`, `MM-AAAA`) en `AAAA-MM`, sinon null. */
export function normalizeMois(input: string): string | null {
  const text = input.trim();
  const iso = /^(\d{4})-(\d{1,2})$/.exec(text);
  const fr = /^(\d{1,2})[/-](\d{4})$/.exec(text);
  const [year, month] = iso ? [iso[1], iso[2]] : fr ? [fr[2], fr[1]] : [null, null];
  if (!year || !month) return null;
  const m = Number(month);
  if (m < 1 || m > 12) return null;
  return `${year}-${String(m).padStart(2, '0')}`;
}

/** Montant saisi (« 25 000 », « 25000 ») → nombre, ou null si vide. */
export function parseAmount(text: string): number | null {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

// ============================================================================
// Provisionnement du Tool (idempotent, mis en cache)
// ============================================================================

let ensurePromise: Promise<ImmobilierEntities> | null = null;

/** Idempotent. Le résultat est mis en cache (une seule initialisation, même si
 * plusieurs écrans l'appellent en même temps — évite à la fois la latence
 * cumulée de ~0,85 s par appel constatée à l'audit et la création possible de
 * deux Tools concurrents). Exécute aussi la migration des anciens contrats. */
export function ensureImmobilierTool(): Promise<ImmobilierEntities> {
  if (!ensurePromise) {
    ensurePromise = provisionImmobilier().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

const missing = (def: EntityDefinition, key: string) => !def.fields.some((f) => f.key === key);

function withIds(fields: Omit<FieldDefinition, 'id' | 'order'>[], from: number): FieldDefinition[] {
  return fields.map((field, index) => ({ ...field, id: `added-${field.key}`, order: from + index }));
}

async function provisionImmobilier(): Promise<ImmobilierEntities> {
  let tool = (await coreService.getTools({ kind: 'immobilier' }))[0] ?? null;
  if (!tool) tool = await coreService.createTool({ name: 'Immobilier', icon: 'home-work', kind: 'immobilier' });

  const existing = await coreService.getEntityDefinitions(tool.id);
  const byKey = (key: string) => existing.find((e) => e.key === key) ?? null;

  // ---- bien ----
  let bien =
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
        { key: 'type', type: 'select', label: 'Type de bien', required: false, options: BIEN_TYPES.map((label) => ({ id: label.toLowerCase(), label })) },
      ],
    }));
  if (missing(bien, 'type')) {
    bien = await coreService.updateEntityDefinition(bien.id, {
      fields: [...bien.fields, ...withIds([{ key: 'type', type: 'select', label: 'Type de bien', required: false, options: BIEN_TYPES.map((label) => ({ id: label.toLowerCase(), label })) }], bien.fields.length)],
    });
  }

  // ---- logement (nouvelle entité) ----
  const logementExtraFields: Omit<FieldDefinition, 'id' | 'order'>[] = [
    { key: 'cuisine', type: 'select', label: 'Cuisine', required: false, options: toOptions(CUISINE_OPTIONS) },
    { key: 'wc', type: 'select', label: 'WC', required: false, options: toOptions(WC_OPTIONS) },
  ];
  let logement =
    byKey(LOGEMENT_KEY) ??
    (await coreService.createEntityDefinition({
      toolId: tool.id,
      key: LOGEMENT_KEY,
      label: 'Logement',
      labelPlural: 'Logements',
      icon: 'meeting-room',
      isSystem: true,
      fields: [
        { key: 'bien', type: 'relation', label: 'Bien', required: true, relationTarget: bien.id },
        { key: 'nom', type: 'text', label: 'Nom du logement', required: true },
        { key: 'type', type: 'select', label: 'Type', required: false, options: toOptions(LOGEMENT_TYPES) },
        { key: 'loyer_reference', type: 'amount', label: 'Loyer de référence', required: false },
        ...logementExtraFields,
      ],
    }));
  {
    // Définition déjà persistée avant l'ajout de cuisine/WC ou des types H-PAY :
    // mise à jour additive (jamais de champ supprimé).
    const typeField = logement.fields.find((f) => f.key === 'type');
    const typeOutdated = !!typeField && (typeField.options ?? []).length !== LOGEMENT_TYPES.length;
    const extrasMissing = logementExtraFields.filter((f) => missing(logement, f.key));
    if (typeOutdated || extrasMissing.length) {
      logement = await coreService.updateEntityDefinition(logement.id, {
        fields: [
          ...logement.fields.map((f) => (f.key === 'type' && typeOutdated ? { ...f, options: toOptions(LOGEMENT_TYPES) } : f)),
          ...withIds(extrasMissing, logement.fields.length),
        ],
      });
    }
  }

  // ---- contrat ----
  const contratStatuses = [
    { key: 'actif', label: 'Actif', color: 'success', order: 0 },
    { key: 'termine', label: 'Terminé', color: 'muted', isTerminal: true, order: 1 },
    { key: 'archive', label: 'Archivé', color: 'muted', isTerminal: true, order: 2 },
  ];
  let contrat = byKey(CONTRAT_KEY);
  if (!contrat) {
    contrat = await coreService.createEntityDefinition({
      toolId: tool.id,
      key: CONTRAT_KEY,
      label: 'Contrat',
      labelPlural: 'Contrats',
      icon: 'description',
      isSystem: true,
      statuses: contratStatuses,
      fields: [
        { key: 'bien', type: 'relation', label: 'Bien', required: true, relationTarget: bien.id },
        { key: 'logement', type: 'relation', label: 'Logement', required: true, relationTarget: logement.id },
        { key: 'locataire_id', type: 'text', label: 'Locataire (contact)', required: true },
        { key: 'loyer_mensuel', type: 'amount', label: 'Loyer mensuel', required: true },
        { key: 'caution', type: 'amount', label: 'Caution', required: false },
        { key: 'avance', type: 'amount', label: 'Avance', required: false },
        { key: 'date_entree', type: 'date', label: "Date d'entrée", required: false },
        { key: 'date_sortie', type: 'date', label: 'Date de sortie', required: false },
        { key: 'jour_echeance', type: 'number', label: "Jour d'échéance", required: false },
        { key: 'dernier_loyer_paye', type: 'text', label: 'Dernier loyer payé (AAAA-MM)', required: false },
      ],
    });
  } else {
    // Migration additive de la définition : jamais de champ supprimé.
    const additions: Omit<FieldDefinition, 'id' | 'order'>[] = [
      ...(missing(contrat, 'logement') ? [{ key: 'logement', type: 'relation' as const, label: 'Logement', required: false, relationTarget: logement.id }] : []),
      ...(missing(contrat, 'locataire_id') ? [{ key: 'locataire_id', type: 'text' as const, label: 'Locataire (contact)', required: false }] : []),
      ...(missing(contrat, 'date_sortie') ? [{ key: 'date_sortie', type: 'date' as const, label: 'Date de sortie', required: false }] : []),
      ...(missing(contrat, 'jour_echeance') ? [{ key: 'jour_echeance', type: 'number' as const, label: "Jour d'échéance", required: false }] : []),
      ...(missing(contrat, 'dernier_loyer_paye') ? [{ key: 'dernier_loyer_paye', type: 'text' as const, label: 'Dernier loyer payé (AAAA-MM)', required: false }] : []),
    ];
    const needsLegacyRelax = contrat.fields.some((f) => f.key === 'nom_logement' && f.required);
    const needsStatuses = !contrat.statuses?.some((s) => s.key === 'termine');
    if (additions.length || needsLegacyRelax || needsStatuses) {
      contrat = await coreService.updateEntityDefinition(contrat.id, {
        fields: [
          ...contrat.fields.map((f) => (f.key === 'nom_logement' ? { ...f, required: false } : f)),
          ...withIds(additions, contrat.fields.length),
        ],
        ...(needsStatuses ? { statuses: contratStatuses } : {}),
      });
    }
  }

  // ---- paiement ----
  let paiement =
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
  const paiementAdditions = [
    { key: 'mode_paiement', type: 'text' as const, label: 'Mode de paiement (note)', required: false },
    { key: 'date_validation', type: 'date' as const, label: 'Date de validation', required: false },
  ].filter((field) => missing(paiement, field.key));
  if (paiementAdditions.length) {
    paiement = await coreService.updateEntityDefinition(paiement.id, {
      fields: [...paiement.fields, ...withIds(paiementAdditions, paiement.fields.length)],
    });
  }

  // ---- dépense ----
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

  // La répartition de factures CEET/TDE vit dans le Tool Factures
  // (services/facturesService.ts) — non provisionnée ici.

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

  const entities: ImmobilierEntities = { tool, bien, logement, contrat, paiement, depense, locataireRole };
  await runLegacyMigration(entities);
  await alignContratBien(entities);
  return entities;
}

// ============================================================================
// Occupation — toujours déduite du contrat actif, jamais stockée
// ============================================================================

function contratEntryTime(contrat: RecordItem): number {
  return (parseDay(contrat.values.date_entree) ?? new Date(contrat.createdAt)).getTime();
}

/** Le contrat 'actif' d'un logement, s'il existe (le plus récent si, par
 * erreur de données, il y en avait plusieurs). Aucun contrat actif = vacant. */
export function getActiveContrat(logementId: string, contrats: RecordItem[]): RecordItem | null {
  const actifs = contrats.filter((c) => c.values.logement === logementId && c.statusKey === 'actif');
  if (actifs.length === 0) return null;
  return actifs.sort((a, b) => contratEntryTime(b) - contratEntryTime(a))[0];
}

export interface ContratLateness {
  key: 'a_jour' | 'retard' | 'sans_paiement';
  label: string;
  lateMonths: number;
}

const MOIS_FORMAT = /^\d{4}-\d{2}$/;

/** Adapté de H-PAY (src/utils/tenantStatus.js) — calculé à la lecture à partir
 * des vrais paiements validés, jamais stocké. Corrections de l'audit du
 * 2026-10-04 : un contrat terminé/archivé n'est jamais « en retard » ; les
 * dates et les mois mal formés sont ignorés au lieu de produire un NaN lu
 * comme « À jour » ; `jour_echeance` repousse le début du retard du mois
 * courant (par défaut : dès le 1er). */
export function computeContratLateness(contrat: RecordItem, paiements: RecordItem[], now = new Date()): ContratLateness {
  if (contrat.statusKey === 'termine' || contrat.statusKey === 'archive') {
    return { key: 'sans_paiement', label: 'Terminé', lateMonths: 0 };
  }
  const rawJour = contrat.values.jour_echeance;
  const jour = typeof rawJour === 'number' && rawJour >= 1 && rawJour <= 31 ? rawJour : 1;
  const currentIndex = now.getFullYear() * 12 + now.getMonth() - (now.getDate() < jour ? 1 : 0);

  const paidMonths = paiements
    .filter((p) => p.values.contrat === contrat.id && p.statusKey === 'paye' && typeof p.values.mois === 'string' && MOIS_FORMAT.test(p.values.mois))
    .map((p) => p.values.mois as string);
  // « Dernier loyer payé » déclaré à l'enregistrement du locataire (loyers réglés
  // avant l'arrivée dans TakarDa) : même rôle qu'un paiement validé. Une valeur
  // mal formée est ignorée — jamais lue comme « À jour ».
  const declared = contrat.values.dernier_loyer_paye;
  if (typeof declared === 'string' && MOIS_FORMAT.test(declared)) paidMonths.push(declared);
  paidMonths.sort();
  const lastPaidMonth = paidMonths.at(-1);

  if (!lastPaidMonth) {
    const entree = parseDay(contrat.values.date_entree) ?? new Date(contrat.createdAt);
    const entreeIndex = Number.isNaN(entree.getTime()) ? currentIndex : entree.getFullYear() * 12 + entree.getMonth();
    const lateMonths = Math.max(0, currentIndex - entreeIndex);
    return lateMonths > 0
      ? { key: 'retard', label: 'En retard', lateMonths }
      : { key: 'sans_paiement', label: 'Aucun paiement', lateMonths: 0 };
  }

  const [y, m] = lastPaidMonth.split('-').map(Number);
  const lastPaidIndex = y * 12 + (m - 1);
  const lateMonths = Math.max(0, currentIndex - lastPaidIndex);
  return lateMonths > 0 ? { key: 'retard', label: 'En retard', lateMonths } : { key: 'a_jour', label: 'À jour', lateMonths: 0 };
}

export interface LogementView {
  logement: RecordItem;
  /** Contrat actif, ou null si le logement est vacant. */
  contrat: RecordItem | null;
  locataire: ExternalContact | null;
  occupied: boolean;
  /** Loyer du contrat actif, sinon le loyer de référence du logement. */
  loyer: number | null;
  lateness: ContratLateness | null;
}

const asNumber = (value: FieldValue | undefined): number | null => (typeof value === 'number' ? value : null);

/** Fonction pure (aucun accès aux données) : tout ce que l'écran d'un Bien a
 * besoin de savoir, dérivé des enregistrements déjà chargés. */
export function buildLogementViews(
  logements: RecordItem[],
  contrats: RecordItem[],
  contacts: ExternalContact[],
  paiements: RecordItem[],
  now = new Date(),
): LogementView[] {
  const contactsById = new Map(contacts.map((c) => [c.id, c]));
  return [...logements]
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    .map((logement) => {
      const contrat = getActiveContrat(logement.id, contrats);
      const locataireId = contrat ? String(contrat.values.locataire_id ?? '') : '';
      return {
        logement,
        contrat,
        locataire: locataireId ? (contactsById.get(locataireId) ?? null) : null,
        occupied: contrat !== null,
        loyer: contrat ? asNumber(contrat.values.loyer_mensuel) : asNumber(logement.values.loyer_reference),
        lateness: contrat ? computeContratLateness(contrat, paiements, now) : null,
      };
    });
}

export interface OccupancySummary {
  total: number;
  occupes: number;
  vacants: number;
}

export function summarizeOccupancy(views: Pick<LogementView, 'occupied'>[]): OccupancySummary {
  const occupes = views.filter((v) => v.occupied).length;
  return { total: views.length, occupes, vacants: views.length - occupes };
}

export function formatOccupancySummary(summary: OccupancySummary): string {
  if (summary.total === 0) return 'Aucun logement';
  const logements = `${summary.total} logement${summary.total > 1 ? 's' : ''}`;
  const occupes = `${summary.occupes} occupé${summary.occupes > 1 ? 's' : ''}`;
  const vacants = `${summary.vacants} vacant${summary.vacants > 1 ? 's' : ''}`;
  return `${logements} · ${occupes} · ${vacants}`;
}

// ============================================================================
// Chargements (appels Core en parallèle — l'audit relevait une cascade séquentielle)
// ============================================================================

export interface BienSummary {
  bien: RecordItem;
  summary: OccupancySummary;
}

export async function listBiensWithSummary(): Promise<BienSummary[]> {
  const ents = await ensureImmobilierTool();
  const [biens, logements, contrats] = await Promise.all([
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.bien.id }),
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.logement.id }),
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.contrat.id }),
  ]);
  return biens.map((bien) => {
    const own = logements.filter((l) => l.values.bien === bien.id);
    const occupes = own.filter((l) => getActiveContrat(l.id, contrats) !== null).length;
    return { bien, summary: { total: own.length, occupes, vacants: own.length - occupes } };
  });
}

export interface BienOverview {
  bien: RecordItem | null;
  views: LogementView[];
  summary: OccupancySummary;
  depenses: RecordItem[];
}

/** Vue d'un bien. Le module Immobilier ne charge plus rien de CEET/TDE : ce
 * module (Factures) est indépendant. La relation canonique est
 * contrat → logement → bien : les contrats d'un bien sont ceux de SES
 * logements, quelle que soit la valeur dénormalisée `contrat.bien`. */
export async function loadBienOverview(bienId: string): Promise<BienOverview> {
  const ents = await ensureImmobilierTool();
  const toolId = ents.tool.id;
  const [bien, logements, contrats, contacts, paiements, depenses] = await Promise.all([
    coreService.getRecord(bienId),
    coreService.getRecords({ toolId, entityDefinitionId: ents.logement.id }),
    coreService.getRecords({ toolId, entityDefinitionId: ents.contrat.id }),
    coreService.getExternalContacts(),
    coreService.getRecords({ toolId, entityDefinitionId: ents.paiement.id }),
    coreService.getRecords({ toolId, entityDefinitionId: ents.depense.id }),
  ]);
  const ownLogements = logements.filter((l) => l.values.bien === bienId);
  const logementIds = new Set(ownLogements.map((l) => l.id));
  const ownContrats = contrats.filter((c) => logementIds.has(String(c.values.logement)));
  const views = buildLogementViews(ownLogements, ownContrats, contacts, paiements);
  return {
    bien,
    views,
    summary: summarizeOccupancy(views),
    depenses: depenses.filter((d) => d.values.bien === bienId),
  };
}

export interface LogementDetail {
  logement: RecordItem;
  bien: RecordItem | null;
  view: LogementView;
  paiements: RecordItem[];
  /** Contrats précédents (terminés/archivés) — l'historique d'occupation. */
  history: { contrat: RecordItem; locataire: ExternalContact | null }[];
  canDelete: boolean;
}

export async function loadLogementDetail(logementId: string): Promise<LogementDetail | null> {
  const ents = await ensureImmobilierTool();
  const logement = await coreService.getRecord(logementId);
  if (!logement) return null;
  const toolId = ents.tool.id;
  const [bien, contrats, contacts, paiements] = await Promise.all([
    coreService.getRecord(String(logement.values.bien)),
    coreService.getRecords({ toolId, entityDefinitionId: ents.contrat.id }),
    coreService.getExternalContacts(),
    coreService.getRecords({ toolId, entityDefinitionId: ents.paiement.id }),
  ]);
  const own = contrats.filter((c) => c.values.logement === logementId);
  const [view] = buildLogementViews([logement], own, contacts, paiements);
  const contactsById = new Map(contacts.map((c) => [c.id, c]));
  const history = own
    .filter((c) => c.id !== view.contrat?.id)
    .sort((a, b) => contratEntryTime(b) - contratEntryTime(a))
    .map((contrat) => ({ contrat, locataire: contactsById.get(String(contrat.values.locataire_id ?? '')) ?? null }));
  const activePaiements = view.contrat
    ? paiements
        .filter((p) => p.values.contrat === view.contrat!.id)
        .sort((a, b) => String(b.values.mois ?? '').localeCompare(String(a.values.mois ?? '')))
    : [];
  return { logement, bien, view, paiements: activePaiements, history, canDelete: own.length === 0 };
}

export interface ContratDetail {
  contrat: RecordItem;
  logement: RecordItem | null;
  bien: RecordItem | null;
  locataire: ExternalContact | null;
  paiements: RecordItem[];
  lateness: ContratLateness;
  events: Awaited<ReturnType<typeof coreService.getEvents>>;
}

export async function loadContratDetail(contratId: string): Promise<ContratDetail | null> {
  const ents = await ensureImmobilierTool();
  const contrat = await coreService.getRecord(contratId);
  if (!contrat) return null;
  const logementId = typeof contrat.values.logement === 'string' ? contrat.values.logement : '';
  const locataireId = typeof contrat.values.locataire_id === 'string' ? contrat.values.locataire_id : '';
  const [allPaiements, logement, bien, locataire] = await Promise.all([
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.paiement.id }),
    logementId ? coreService.getRecord(logementId) : Promise.resolve(null),
    coreService.getRecord(String(contrat.values.bien ?? '')),
    locataireId ? coreService.getExternalContact(locataireId) : Promise.resolve(null),
  ]);
  const paiements = allPaiements
    .filter((p) => p.values.contrat === contratId)
    .sort((a, b) => String(b.values.mois ?? '').localeCompare(String(a.values.mois ?? '')));
  // L'historique du contrat inclut aussi la validation/le rejet de ses
  // paiements (leurs événements ont pour recordId le paiement, pas le contrat).
  const eventLists = await Promise.all([contratId, ...paiements.map((p) => p.id)].map((id) => coreService.getEvents({ recordId: id })));
  const events = eventLists.flat().sort((a, b) => (a.at < b.at ? 1 : -1));
  return { contrat, logement, bien, locataire, paiements, lateness: computeContratLateness(contrat, paiements), events };
}

// ============================================================================
// Écritures
// ============================================================================

export async function createBien(input: { nom: string; adresse: string; type?: string }): Promise<RecordItem> {
  const ents = await ensureImmobilierTool();
  if (!input.nom.trim()) throw new Error('Le nom du bien est obligatoire.');
  return coreService.createRecord({
    toolId: ents.tool.id,
    entityDefinitionId: ents.bien.id,
    values: { nom: input.nom.trim(), adresse: input.adresse.trim(), type: input.type ?? null },
  });
}

async function assertLogementNameFree(bienId: string, nom: string, exceptId?: string): Promise<void> {
  const ents = await ensureImmobilierTool();
  const all = await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.logement.id });
  const wanted = normalizeName(nom);
  const clash = all.find((l) => l.values.bien === bienId && l.id !== exceptId && normalizeName(String(l.values.nom ?? '')) === wanted);
  if (clash) throw new Error('Un logement porte déjà ce nom dans ce bien.');
}

export interface LogementInput {
  nom: string;
  type?: string | null;
  cuisine?: string | null;
  wc?: string | null;
  loyerReference?: number | null;
}

export async function createLogement(input: LogementInput & { bienId: string }): Promise<RecordItem> {
  const ents = await ensureImmobilierTool();
  if (!input.nom.trim()) throw new Error('Le nom du logement est obligatoire.');
  const bien = await coreService.getRecord(input.bienId);
  if (!bien) throw new Error('Bien introuvable.');
  await assertLogementNameFree(input.bienId, input.nom);
  return coreService.createRecord({
    toolId: ents.tool.id,
    entityDefinitionId: ents.logement.id,
    values: {
      bien: input.bienId,
      nom: input.nom.trim(),
      type: input.type ?? null,
      cuisine: input.cuisine ?? null,
      wc: input.wc ?? null,
      loyer_reference: input.loyerReference ?? null,
    },
  });
}

/** Le bien d'un logement ne change jamais ici : c'est la relation canonique. */
export async function updateLogement(logementId: string, input: LogementInput): Promise<RecordItem> {
  const current = await coreService.getRecord(logementId);
  if (!current) throw new Error('Logement introuvable.');
  if (!input.nom.trim()) throw new Error('Le nom du logement est obligatoire.');
  await assertLogementNameFree(String(current.values.bien), input.nom, logementId);
  return coreService.updateRecord(logementId, {
    values: {
      nom: input.nom.trim(),
      type: input.type ?? null,
      cuisine: input.cuisine ?? null,
      wc: input.wc ?? null,
      loyer_reference: input.loyerReference ?? null,
    },
  });
}

/** Dernier loyer payé déclaré : toujours `AAAA-MM` normalisé, jamais une chaîne
 * libre. Un mois illisible est refusé (au lieu d'être lu comme « à jour »),
 * de même qu'une année manifestement fausse (plus de 12 mois dans le futur). */
export function normalizeDernierLoyerPaye(input: string | null | undefined, now = new Date()): string | null {
  if (input == null || !input.trim()) return null;
  const mois = normalizeMois(input);
  if (!mois) throw new Error('Le dernier loyer payé est invalide : choisissez un mois et une année.');
  const [y, m] = mois.split('-').map(Number);
  const ahead = y * 12 + (m - 1) - (now.getFullYear() * 12 + now.getMonth());
  if (ahead > 12) throw new Error('Le dernier loyer payé ne peut pas être aussi loin dans le futur.');
  return mois;
}

export interface NouveauLogementInput {
  nom: string;
  type?: string | null;
  cuisine?: string | null;
  wc?: string | null;
}

export interface CreateLocataireContratInput {
  bienId: string;
  /** Logement existant… */
  logementId?: string;
  /** …ou logement à créer/récupérer par son nom, dans le même enregistrement. */
  nouveauLogement?: NouveauLogementInput;
  nom: string;
  telephone: string;
  loyerMensuel: number;
  dateEntree?: Date | null;
  caution?: number | null;
  avance?: number | null;
  jourEcheance?: number | null;
  /** Dernier mois de loyer déjà payé (`AAAA-MM`), pour calculer la situation locative. */
  dernierLoyerPaye?: string | null;
}

/** Un numéro est exploitable s'il compte 8 à 15 chiffres (espaces, +, -, ( ) tolérés). */
export function isValidPhone(value: string): boolean {
  if (!/^[0-9+\s().-]+$/.test(value.trim())) return false;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

/**
 * « Ajouter un locataire » en UNE opération — le propriétaire ne voit ni
 * « contrat » ni « contact » :
 *  1. toute la validation a lieu AVANT la première écriture ;
 *  2. le logement est celui choisi, ou retrouvé par son nom dans ce bien
 *     (jamais dupliqué ; refusé s'il est occupé), ou créé ;
 *  3. le locataire devient un ExternalContact (aucun compte requis) ;
 *  4. le contrat 'actif' relie logement + locataire (+ loyer, caution, avance,
 *     dates). L'occupation en découle, elle n'est pas stockée ;
 *  5. si une écriture échoue, ce qui vient d'être créé est annulé : un nouvel
 *     essai ne bute jamais sur un logement ou un contact « fantôme ».
 */
export async function createLocataireEtContrat(input: CreateLocataireContratInput): Promise<{ contrat: RecordItem; contact: ExternalContact; logement: RecordItem }> {
  const ents = await ensureImmobilierTool();
  if (!input.nom.trim()) throw new Error('Le nom du locataire est obligatoire.');
  if (!input.telephone.trim()) throw new Error('Le téléphone du locataire est obligatoire.');
  if (!isValidPhone(input.telephone)) throw new Error('Le numéro de téléphone est invalide (8 à 15 chiffres).');
  if (!(input.loyerMensuel > 0)) throw new Error('Le loyer mensuel est obligatoire.');
  for (const [label, value] of [['La caution', input.caution], ['L’avance', input.avance]] as const) {
    if (value != null && !(value >= 0)) throw new Error(`${label} doit être un montant positif.`);
  }
  if (input.jourEcheance != null && (!Number.isInteger(input.jourEcheance) || input.jourEcheance < 1 || input.jourEcheance > 31)) {
    throw new Error("Le jour d'échéance doit être compris entre 1 et 31.");
  }
  if (!input.logementId && !input.nouveauLogement?.nom.trim()) throw new Error('Le logement est obligatoire.');
  const dernierLoyerPaye = normalizeDernierLoyerPaye(input.dernierLoyerPaye);

  const [bien, allLogements, contrats] = await Promise.all([
    coreService.getRecord(input.bienId),
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.logement.id }),
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.contrat.id }),
  ]);
  if (!bien) throw new Error('Bien introuvable.');

  let logement: RecordItem | null = null;
  let createNew: NouveauLogementInput | null = null;
  if (input.logementId) {
    logement = allLogements.find((l) => l.id === input.logementId) ?? null;
    if (!logement) throw new Error('Logement introuvable.');
    if (logement.values.bien !== input.bienId) throw new Error("Ce logement n'appartient pas à ce bien.");
  } else {
    const wanted = normalizeName(input.nouveauLogement!.nom);
    logement = allLogements.find((l) => l.values.bien === input.bienId && normalizeName(String(l.values.nom ?? '')) === wanted) ?? null;
    if (!logement) createNew = input.nouveauLogement!;
  }
  if (logement && getActiveContrat(logement.id, contrats)) throw new Error('Ce logement est déjà occupé.');

  let createdLogement: RecordItem | null = null;
  let contact: ExternalContact | null = null;
  try {
    if (createNew) {
      createdLogement = await createLogement({
        bienId: input.bienId,
        nom: createNew.nom,
        type: createNew.type,
        cuisine: createNew.cuisine,
        wc: createNew.wc,
        loyerReference: input.loyerMensuel,
      });
      logement = createdLogement;
    }
    contact = await coreService.createExternalContact({ name: input.nom.trim(), phone: input.telephone.trim() });
    const contrat = await coreService.createRecord({
      toolId: ents.tool.id,
      entityDefinitionId: ents.contrat.id,
      statusKey: 'actif',
      values: {
        // `bien` est dénormalisé pour la compatibilité : toujours copié du logement (relation canonique).
        bien: logement!.values.bien as string,
        logement: logement!.id,
        locataire_id: contact.id,
        loyer_mensuel: input.loyerMensuel,
        date_entree: toIsoDay(input.dateEntree ?? new Date()),
        caution: input.caution ?? null,
        avance: input.avance ?? null,
        jour_echeance: input.jourEcheance ?? null,
        dernier_loyer_paye: dernierLoyerPaye,
      },
    });
    return { contrat, contact, logement: logement! };
  } catch (error) {
    await Promise.allSettled([
      contact ? coreService.deleteExternalContact(contact.id) : Promise.resolve(),
      createdLogement ? coreService.deleteRecord(createdLogement.id) : Promise.resolve(),
    ]);
    throw error;
  }
}

/** Départ d'un locataire : le contrat devient 'termine' (et reste consultable),
 * le logement n'est jamais supprimé — il redevient simplement vacant. */
export async function terminerContrat(contratId: string, dateSortie: Date = new Date()): Promise<RecordItem> {
  const contrat = await coreService.getRecord(contratId);
  if (!contrat) throw new Error('Contrat introuvable.');
  if (contrat.statusKey !== 'actif') throw new Error("Ce contrat n'est pas actif.");
  return coreService.updateRecord(contratId, { statusKey: 'termine', values: { date_sortie: toIsoDay(dateSortie) } });
}

export async function updateLocataire(contactId: string, input: { name: string; phone?: string }): Promise<ExternalContact> {
  if (!input.name.trim()) throw new Error('Le nom du locataire est obligatoire.');
  return coreService.updateExternalContact(contactId, { name: input.name.trim(), phone: input.phone?.trim() || undefined });
}

export async function deleteLogement(logementId: string): Promise<void> {
  const ents = await ensureImmobilierTool();
  const contrats = await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.contrat.id });
  if (contrats.some((c) => c.values.logement === logementId)) {
    throw new Error("Ce logement a un historique de contrats : il ne peut pas être supprimé seul.");
  }
  await coreService.deleteRecord(logementId);
}

// ============================================================================
// Suppression en cascade — jamais de paiements ni de contacts orphelins
// ============================================================================

interface ContratGraph {
  contrats: RecordItem[];
  paiements: RecordItem[];
  /** Contacts qui ne sont référencés par AUCUN contrat extérieur à la suppression. */
  exclusiveContactIds: string[];
  memberIds: string[];
}

async function collectContratGraph(contratIds: Set<string>): Promise<ContratGraph> {
  const ents = await ensureImmobilierTool();
  const toolId = ents.tool.id;
  const [allContrats, allPaiements, members] = await Promise.all([
    coreService.getRecords({ toolId, entityDefinitionId: ents.contrat.id }),
    coreService.getRecords({ toolId, entityDefinitionId: ents.paiement.id }),
    coreService.getToolMembers(toolId),
  ]);
  const contrats = allContrats.filter((c) => contratIds.has(c.id));
  const others = allContrats.filter((c) => !contratIds.has(c.id));
  const memberById = new Map(members.map((m) => [m.id, m]));
  const contactOf = (c: RecordItem): string | null => {
    if (typeof c.values.locataire_id === 'string' && c.values.locataire_id) return c.values.locataire_id;
    const member = memberById.get(String(c.values.locataire_member_id ?? ''));
    return member?.contactId ?? null;
  };
  const usedElsewhere = new Set(others.map(contactOf).filter((id): id is string => !!id));
  const exclusiveContactIds = [...new Set(contrats.map(contactOf).filter((id): id is string => !!id))].filter((id) => !usedElsewhere.has(id));
  const memberIds = members.filter((m) => m.contactId && exclusiveContactIds.includes(m.contactId)).map((m) => m.id);
  return { contrats, paiements: allPaiements.filter((p) => contratIds.has(String(p.values.contrat))), exclusiveContactIds, memberIds };
}

async function deleteContratGraph(graph: ContratGraph): Promise<void> {
  await Promise.all([
    ...graph.paiements.map((p) => coreService.deleteRecord(p.id)),
    ...graph.contrats.map((c) => coreService.deleteRecord(c.id)),
    ...graph.exclusiveContactIds.map((id) => coreService.deleteExternalContact(id)),
    ...graph.memberIds.map((id) => coreService.removeToolMember(id)),
  ]);
}

export interface BienDeletionImpact {
  logements: number;
  contrats: number;
  paiements: number;
  depenses: number;
  facturesPartagees: number;
}

/** Compat : les factures partagées CEET/TDE (module Factures, indépendant) qui
 * référencent ce bien. Immobilier ne les affiche pas ; on ne les connaît que
 * pour ne pas laisser de facture pointant vers un bien supprimé. */
async function loadFacturesDuBien(bienId: string) {
  const factures = await ensureFacturesTool();
  const [facturesPartagees, releves, parts] = await Promise.all([
    coreService.getRecords({ toolId: factures.tool.id, entityDefinitionId: factures.facturePartageeDefinition.id }),
    coreService.getRecords({ toolId: factures.tool.id, entityDefinitionId: factures.releveDefinition.id }),
    coreService.getRecords({ toolId: factures.tool.id, entityDefinitionId: factures.partLocataireDefinition.id }),
  ]);
  return { ownFactures: facturesPartagees.filter((f) => f.values.bien === bienId), releves, parts };
}

/** Contrats d'un bien : ceux de ses logements (relation canonique), plus les
 * éventuels contrats dont seul le champ dénormalisé `bien` pointe ici. */
function contratsDuBien(bienId: string, logements: RecordItem[], contrats: RecordItem[]): RecordItem[] {
  const logementIds = new Set(logements.filter((l) => l.values.bien === bienId).map((l) => l.id));
  return contrats.filter((c) => logementIds.has(String(c.values.logement)) || c.values.bien === bienId);
}

export async function getBienDeletionImpact(bienId: string): Promise<BienDeletionImpact> {
  const ents = await ensureImmobilierTool();
  const toolId = ents.tool.id;
  const [logements, contrats, depenses, { ownFactures }] = await Promise.all([
    coreService.getRecords({ toolId, entityDefinitionId: ents.logement.id }),
    coreService.getRecords({ toolId, entityDefinitionId: ents.contrat.id }),
    coreService.getRecords({ toolId, entityDefinitionId: ents.depense.id }),
    loadFacturesDuBien(bienId),
  ]);
  const ownContrats = contratsDuBien(bienId, logements, contrats);
  const graph = await collectContratGraph(new Set(ownContrats.map((c) => c.id)));
  return {
    logements: logements.filter((l) => l.values.bien === bienId).length,
    contrats: ownContrats.length,
    paiements: graph.paiements.length,
    depenses: depenses.filter((d) => d.values.bien === bienId).length,
    facturesPartagees: ownFactures.length,
  };
}

/** Supprime un bien ET tout ce qui en dépend : logements, contrats, paiements,
 * dépenses, contacts locataires qui n'ont plus aucun contrat — et, par
 * compatibilité, les factures partagées CEET/TDE (+ relevés/parts liés) qui
 * référencent ce bien. L'appelant doit avoir demandé confirmation
 * (voir getBienDeletionImpact pour le détail à afficher). */
export async function deleteBienCascade(bienId: string): Promise<void> {
  const ents = await ensureImmobilierTool();
  const toolId = ents.tool.id;
  const [logements, contrats, depenses, { ownFactures, releves, parts }] = await Promise.all([
    coreService.getRecords({ toolId, entityDefinitionId: ents.logement.id }),
    coreService.getRecords({ toolId, entityDefinitionId: ents.contrat.id }),
    coreService.getRecords({ toolId, entityDefinitionId: ents.depense.id }),
    loadFacturesDuBien(bienId),
  ]);
  const ownContrats = contratsDuBien(bienId, logements, contrats);
  const contratIds = new Set(ownContrats.map((c) => c.id));
  const factureIds = new Set(ownFactures.map((f) => f.id));
  const graph = await collectContratGraph(contratIds);

  await Promise.all([
    ...releves.filter((r) => r.values.participant_type === 'contrat' && contratIds.has(String(r.values.participant_id))).map((r) => coreService.deleteRecord(r.id)),
    ...parts.filter((p) => factureIds.has(String(p.values.facture_partagee))).map((p) => coreService.deleteRecord(p.id)),
    ...ownFactures.map((f) => coreService.deleteRecord(f.id)),
    ...depenses.filter((d) => d.values.bien === bienId).map((d) => coreService.deleteRecord(d.id)),
    ...logements.filter((l) => l.values.bien === bienId).map((l) => coreService.deleteRecord(l.id)),
    deleteContratGraph(graph),
  ]);
  await coreService.deleteRecord(bienId);
}

/** Supprime un contrat, ses paiements et — s'il n'est plus référencé — son locataire. */
export async function deleteContratCascade(contratId: string): Promise<void> {
  const graph = await collectContratGraph(new Set([contratId]));
  await deleteContratGraph(graph);
}

// ============================================================================
// Libellés d'un contrat pour les autres modules (Factures/CEET-TDE)
// ============================================================================

export interface ImmobilierLookup {
  logements: Map<string, RecordItem>;
  contacts: Map<string, ExternalContact>;
}

export async function loadImmobilierLookup(): Promise<ImmobilierLookup> {
  const ents = await ensureImmobilierTool();
  const [logements, contacts] = await Promise.all([
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.logement.id }),
    coreService.getExternalContacts(),
  ]);
  return { logements: new Map(logements.map((l) => [l.id, l])), contacts: new Map(contacts.map((c) => [c.id, c])) };
}

/** Nom du locataire, sinon nom du logement ; repli sur les champs hérités des
 * contrats qui n'auraient pas (encore) été migrés. */
export function contratLabel(contrat: RecordItem, lookup: ImmobilierLookup): string {
  const contact = lookup.contacts.get(String(contrat.values.locataire_id ?? ''));
  if (contact?.name) return contact.name;
  if (typeof contrat.values.locataire_nom === 'string' && contrat.values.locataire_nom) return contrat.values.locataire_nom;
  const logement = lookup.logements.get(String(contrat.values.logement ?? ''));
  if (typeof logement?.values.nom === 'string' && logement.values.nom) return logement.values.nom;
  return String(contrat.values.nom_logement ?? 'Locataire');
}

// ============================================================================
// Migration des anciens contrats (logement + locataire intégrés au contrat)
// ============================================================================

export interface MigrationReport {
  logementsCreated: number;
  contratsLinked: number;
  contactsCreated: number;
  /** Anciens contrats « actifs » en doublon sur un même logement, passés à 'termine'. */
  terminated: number;
  /** Anciens contrats sans locataire (ex-« vacants »), passés à 'archive'. */
  archived: number;
  skipped: number;
}

function legacyLogementType(value: unknown): string {
  const text = typeof value === 'string' ? normalizeName(value) : '';
  if (text.includes('salon')) {
    if (/\b3\b/.test(text)) return '3 Chambres + Salon';
    if (/\b2\b/.test(text)) return '2 Chambres + Salon';
    return 'Chambre + Salon';
  }
  if (text.includes('chambre')) return 'Chambre simple';
  if (text.includes('appartement')) return 'Appartement';
  if (text.includes('villa')) return 'Villa';
  if (text.includes('boutique')) return 'Boutique';
  if (text.includes('local')) return 'Local';
  return 'Autre';
}

/**
 * Idempotente : ne traite que les contrats sans `logement`. Pour chacun :
 *  1. retrouve (ou crée UNE fois) le logement du bien portant ce nom ;
 *  2. rattache le contrat au logement, sans changer l'ID du contrat ni du bien ;
 *  3. reprend le locataire existant (ToolMember → ExternalContact) dans
 *     `locataire_id`, ou crée le contact depuis le nom sinon ;
 *  4. garantit au plus UN contrat actif par logement (voir MigrationReport).
 * Les anciens champs (nom_logement, locataire_nom…) ne sont jamais effacés.
 * Un ancien contrat sans bien est ignoré (compté dans `skipped`).
 */
async function runLegacyMigration(ents: ImmobilierEntities): Promise<MigrationReport> {
  const report: MigrationReport = { logementsCreated: 0, contratsLinked: 0, contactsCreated: 0, terminated: 0, archived: 0, skipped: 0 };
  const toolId = ents.tool.id;
  const [contrats, logements, members, contacts] = await Promise.all([
    coreService.getRecords({ toolId, entityDefinitionId: ents.contrat.id }),
    coreService.getRecords({ toolId, entityDefinitionId: ents.logement.id }),
    coreService.getToolMembers(toolId),
    coreService.getExternalContacts(),
  ]);
  const legacy = contrats.filter((c) => !c.values.logement).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  if (legacy.length === 0) return report;

  const keyOf = (bienId: string, nom: string) => `${bienId}::${normalizeName(nom)}`;
  const logementByKey = new Map(logements.map((l) => [keyOf(String(l.values.bien), String(l.values.nom ?? '')), l]));
  const memberById = new Map(members.map((m) => [m.id, m]));
  const contactIds = new Set(contacts.map((c) => c.id));
  // Contrats déjà conformes qui occupent un logement (le nouveau flux gagne toujours).
  const occupiedByNewFlow = new Set(contrats.filter((c) => c.values.logement && c.statusKey === 'actif').map((c) => String(c.values.logement)));
  const winnerByLogement = new Map<string, RecordItem>();

  type Plan = { contrat: RecordItem; logementId: string; locataireId: string | null; hasTenant: boolean };
  const plans: Plan[] = [];

  for (const contrat of legacy) {
    const bienId = typeof contrat.values.bien === 'string' ? contrat.values.bien : '';
    if (!bienId) {
      report.skipped += 1;
      continue;
    }
    const nom = String(contrat.values.nom_logement ?? '').trim() || 'Logement';
    const key = keyOf(bienId, nom);
    let logement = logementByKey.get(key);
    if (!logement) {
      logement = await coreService.createRecord({
        toolId,
        entityDefinitionId: ents.logement.id,
        values: {
          bien: bienId,
          nom,
          type: legacyLogementType(contrat.values.type_logement),
          loyer_reference: asNumber(contrat.values.loyer_mensuel),
        },
      });
      logementByKey.set(key, logement);
      report.logementsCreated += 1;
    }

    let locataireId: string | null = null;
    const memberContact = memberById.get(String(contrat.values.locataire_member_id ?? ''))?.contactId;
    if (memberContact && contactIds.has(memberContact)) {
      locataireId = memberContact;
    } else if (typeof contrat.values.locataire_nom === 'string' && contrat.values.locataire_nom.trim()) {
      const contact = await coreService.createExternalContact({
        name: contrat.values.locataire_nom.trim(),
        phone: typeof contrat.values.locataire_telephone === 'string' ? contrat.values.locataire_telephone : undefined,
      });
      contactIds.add(contact.id);
      locataireId = contact.id;
      report.contactsCreated += 1;
    }
    plans.push({ contrat, logementId: logement.id, locataireId, hasTenant: !!locataireId });

    // Parmi les anciens contrats actifs d'un même logement, le plus récent gagne.
    if (contrat.statusKey !== 'archive' && locataireId && !occupiedByNewFlow.has(logement.id)) {
      const current = winnerByLogement.get(logement.id);
      if (!current || contratEntryTime(contrat) >= contratEntryTime(current)) winnerByLogement.set(logement.id, contrat);
    }
  }

  for (const plan of plans) {
    const { contrat, logementId, locataireId, hasTenant } = plan;
    let statusKey = contrat.statusKey;
    if (contrat.statusKey === 'archive') {
      statusKey = 'archive';
    } else if (!hasTenant) {
      statusKey = 'archive';
      report.archived += 1;
    } else if (winnerByLogement.get(logementId)?.id === contrat.id) {
      statusKey = 'actif';
    } else {
      statusKey = 'termine';
      report.terminated += 1;
    }
    await coreService.updateRecord(contrat.id, {
      statusKey,
      values: { logement: logementId, ...(locataireId ? { locataire_id: locataireId } : {}) },
    });
    report.contratsLinked += 1;
  }
  return report;
}

/** Relance explicite de la migration (idempotente) — utilisée par les tests. */
export async function migrateLegacyContrats(): Promise<MigrationReport> {
  const ents = await ensureImmobilierTool();
  return runLegacyMigration(ents);
}

async function alignContratBien(ents: ImmobilierEntities): Promise<void> {
  const toolId = ents.tool.id;
  const [contrats, logements] = await Promise.all([
    coreService.getRecords({ toolId, entityDefinitionId: ents.contrat.id }),
    coreService.getRecords({ toolId, entityDefinitionId: ents.logement.id }),
  ]);
  const bienOfLogement = new Map(logements.map((l) => [l.id, l.values.bien as string]));
  await Promise.all(
    findBienMismatches(contrats, logements).map((c) => coreService.updateRecord(c.id, { values: { bien: bienOfLogement.get(String(c.values.logement)) as string } })),
  );
}

// ============================================================================
// Cohérence contrat.bien (dénormalisé) ↔ logement.bien (canonique)
// ============================================================================

/** Contrats dont le champ dénormalisé `bien` diffère du bien de leur logement. */
export function findBienMismatches(contrats: RecordItem[], logements: RecordItem[]): RecordItem[] {
  const bienOfLogement = new Map(logements.map((l) => [l.id, l.values.bien]));
  return contrats.filter((c) => {
    const logementId = typeof c.values.logement === 'string' ? c.values.logement : '';
    return !!logementId && bienOfLogement.has(logementId) && bienOfLogement.get(logementId) !== c.values.bien;
  });
}

/** Réaligne `contrat.bien` sur `logement.bien` (la relation canonique) et
 * retourne le nombre de contrats corrigés. Idempotente. */
export async function reconcileContratBien(): Promise<number> {
  const ents = await ensureImmobilierTool();
  const toolId = ents.tool.id;
  const [contrats, logements] = await Promise.all([
    coreService.getRecords({ toolId, entityDefinitionId: ents.contrat.id }),
    coreService.getRecords({ toolId, entityDefinitionId: ents.logement.id }),
  ]);
  const count = findBienMismatches(contrats, logements).length;
  if (count) await alignContratBien(ents);
  return count;
}
