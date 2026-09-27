// Répartition de factures CEET/TDE partagées — moteur unique (Étape 4).
//
// IMPORTANT (voir l'audit H-PAY) : ceci N'EST PAS un calculateur du tarif
// officiel CEET/TDE. TakarDa ne calcule jamais un montant de facture à partir
// d'une consommation — il aide à RÉPARTIR une facture déjà reçue, déjà
// chiffrée, entre plusieurs participants qui partagent un compteur.
//
// Ce fichier est LE seul moteur de calcul/orchestration CEET/TDE de TakarDa,
// utilisé aussi bien par Immobilier (features/immobilier/screens/RepartitionScreen.tsx,
// FacturePartageeFormScreen.tsx) que par Factures seul
// (features/factures/screens/RelevesScreen.tsx, FactureFormScreen.tsx). Le
// schéma (releve/facture_partagee/part_locataire) est déclaré dans
// services/facturesService.ts — ce fichier n'y touche jamais directement, il
// passe toujours par coreService.
//
// Identité de participant (corrige la collision "deux biens, un compteur du
// même nom" trouvée dans la première tentative Factures) : un relevé ou une
// part n'est jamais identifié par son libellé texte (`compteur`/`label`),
// toujours par un id Core réel et unique :
//   - participant_type: 'contrat'  → participant_id = Contrat.id (Immobilier)
//   - participant_type: 'contact'  → participant_id = ExternalContact.id
//   - participant_type: 'manuel'   → participant_id = null (Factures autonome
//     sans contact enregistré ; le libellé texte est alors la seule identité,
//     scopée par la combinaison (fournisseur, mois, label) — un choix délibéré
//     et documenté, pas un oubli : voir le rapport de fusion Étape 4).

import { coreService } from './coreService';
import type { FieldValue, RecordItem } from '@/types/entities';

export type RepartitionMode = 'proportionnel' | 'equitable';
export type ParticipantType = 'contrat' | 'contact' | 'manuel';

export interface Participant {
  type: ParticipantType;
  id: string | null;
  label: string;
}

// ---- Périodes : toujours "AAAA-MM", jamais de texte libre -------------------

export function currentPeriode(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function previousPeriode(periode: string): string {
  const [y, m] = periode.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 2, 1); // m est 1-indexé ; -2 recule d'un mois en base 0
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// ---- Identité de participant --------------------------------------------------

function sameParticipant(a: { participant_type?: FieldValue; participant_id?: FieldValue; compteur?: FieldValue; label?: FieldValue }, participant: Participant): boolean {
  if (participant.type !== 'manuel' && participant.id) {
    return a.participant_type === participant.type && a.participant_id === participant.id;
  }
  // Saisie libre sans contact : la seule identité disponible est le libellé,
  // dans le même (fournisseur, mois) déjà filtré par l'appelant.
  const displayed = typeof a.compteur === 'string' ? a.compteur : typeof a.label === 'string' ? a.label : '';
  return a.participant_type === 'manuel' && displayed.trim().toLowerCase() === participant.label.trim().toLowerCase();
}

/** Résout le libellé affiché d'un participant à partir des vraies données Core
 * (jamais un texte fabriqué) : nom du locataire du Contrat, nom de l'ExternalContact,
 * ou le libellé tel quel en saisie libre. */
export async function resolveParticipantLabel(participant: Pick<Participant, 'type' | 'id'>, fallback: string): Promise<string> {
  if (participant.type === 'contrat' && participant.id) {
    const contrat = await coreService.getRecord(participant.id);
    if (contrat) {
      const nom = contrat.values.locataire_nom;
      if (typeof nom === 'string' && nom.trim()) return nom;
      const logement = contrat.values.nom_logement;
      if (typeof logement === 'string' && logement.trim()) return logement;
    }
  }
  if (participant.type === 'contact' && participant.id) {
    const contact = await coreService.getExternalContact(participant.id);
    if (contact?.name) return contact.name;
  }
  return fallback;
}

// ---- Relevés : cahier d'index, scopé par participant réel (Phase F / §9) ----

/** Cherche le relevé du mois précédent pour ce participant ; à défaut, le
 * dernier relevé disponible avant la période donnée. Ne fabrique jamais de
 * valeur — retourne null si aucun relevé n'existe, l'écran doit alors demander
 * une saisie manuelle. Le filtrage se fait sur l'identité réelle du participant
 * (participant_type + participant_id, ou le libellé en dernier recours pour la
 * saisie libre), jamais sur le simple nom affiché — ceci évite la collision
 * "compteur du même nom dans deux biens différents". */
export function findPreviousReleve(participant: Participant, fournisseur: string, periode: string, releves: RecordItem[]): RecordItem | null {
  const forParticipant = releves.filter(
    (r) => r.values.fournisseur === fournisseur && typeof r.values.mois === 'string' && r.values.mois < periode && sameParticipant(r.values, participant),
  );
  if (forParticipant.length === 0) return null;

  const exact = forParticipant.find((r) => r.values.mois === previousPeriode(periode));
  if (exact) return exact;

  return forParticipant.sort((a, b) => String(b.values.mois).localeCompare(String(a.values.mois)))[0];
}

export function computeConsommation(indexPrecedent: number, indexActuel: number): number {
  return Math.max(0, indexActuel - indexPrecedent);
}

/** Crée ou met à jour le relevé d'un participant pour une période donnée (un
 * seul relevé par participant/période — upsert, pas de doublons). */
export async function saveReleve(input: {
  toolId: string;
  releveEntityDefinitionId: string;
  fournisseur: string;
  periode: string;
  participant: Participant;
  index: number;
  note?: string | null;
  existing: RecordItem[];
}): Promise<RecordItem> {
  const found = input.existing.find(
    (r) => r.values.fournisseur === input.fournisseur && r.values.mois === input.periode && sameParticipant(r.values, input.participant),
  );
  const values: Record<string, FieldValue> = {
    fournisseur: input.fournisseur,
    mois: input.periode,
    compteur: input.participant.label,
    index: input.index,
    note: input.note ?? null,
    participant_type: input.participant.type,
    participant_id: input.participant.id,
  };
  if (found) return coreService.updateRecord(found.id, { values });
  return coreService.createRecord({ toolId: input.toolId, entityDefinitionId: input.releveEntityDefinitionId, values });
}

// ---- Répartition (formules H-PAY, réconciliées exactement — voir le rapport
// de fusion Étape 4 pour la comparaison avec l'arrondi non réconcilié de H-PAY) --

export interface RepartitionLine {
  participant: Participant;
  consommation: number;
  montant: number;
}

/** montant = consommation × (montant_total / consommation_totale). Répartit une
 * facture déjà connue selon la consommation relevée — pas un tarif CEET/TDE. */
export function computeRepartitionProportionnelle(lines: { participant: Participant; consommation: number }[], montantTotal: number): RepartitionLine[] {
  const totalConsommation = lines.reduce((sum, l) => sum + l.consommation, 0);
  if (totalConsommation <= 0) {
    throw new Error('Répartition proportionnelle impossible : aucune consommation relevée.');
  }

  const unitPrice = montantTotal / totalConsommation;
  const raw = lines.map((l) => ({ participant: l.participant, consommation: l.consommation, montant: Math.round(l.consommation * unitPrice) }));

  // Ajuste la plus grosse part pour que la somme corresponde exactement au
  // montant total malgré les arrondis (le CFA n'a pas de centimes). H-PAY
  // arrondit chaque part au franc supérieur SANS réconcilier la somme (voir
  // l'audit comparatif) — la somme des parts peut donc y dépasser la facture
  // réelle. Ce choix (réconciliation exacte) est conservé de l'Étape 3 : les
  // tests de ce fichier (utility-billing-tests) montrent qu'il est correct.
  const sumRounded = raw.reduce((sum, l) => sum + l.montant, 0);
  const diff = montantTotal - sumRounded;
  if (diff !== 0 && raw.length > 0) {
    const biggest = raw.reduce((a, b) => (b.consommation > a.consommation ? b : a), raw[0]);
    biggest.montant += diff;
  }
  return raw;
}

/** montant = montant_total / nombre_de_participants, réparti au franc près (le
 * reste va aux premiers participants de la liste pour une somme exacte). */
export function computeRepartitionEquitable(participants: Participant[], montantTotal: number): RepartitionLine[] {
  const n = participants.length;
  if (n === 0) return [];
  const base = Math.floor(montantTotal / n);
  const remainder = montantTotal - base * n;
  return participants.map((participant, i) => ({ participant, consommation: 0, montant: base + (i < remainder ? 1 : 0) }));
}

// ---- Orchestration CRUD -------------------------------------------------------

/** Renseigne, une seule fois, le `relationTarget` du champ `facture_partagee.bien`
 * vers le vrai EntityDefinition.id de "bien" — Factures ne connaît pas
 * Immobilier par défaut (voir services/facturesService.ts), donc cette
 * information n'est disponible qu'ici, au moment où un appelant Immobilier
 * fournit réellement un bienEntityDefinitionId. Idempotent. */
async function ensureBienRelationTarget(facturePartageeDefinitionId: string, bienEntityDefinitionId: string): Promise<void> {
  const definition = await coreService.getEntityDefinition(facturePartageeDefinitionId);
  if (!definition) return;
  const bienField = definition.fields.find((f) => f.key === 'bien');
  if (!bienField || bienField.relationTarget === bienEntityDefinitionId) return;
  await coreService.updateEntityDefinition(facturePartageeDefinitionId, {
    fields: definition.fields.map((f) => (f.key === 'bien' ? { ...f, relationTarget: bienEntityDefinitionId } : f)),
  });
}

export async function createFacturePartagee(input: {
  toolId: string;
  facturePartageeEntityDefinitionId: string;
  bienEntityDefinitionId?: string;
  values: Record<string, FieldValue>;
}): Promise<RecordItem> {
  if (input.bienEntityDefinitionId) {
    await ensureBienRelationTarget(input.facturePartageeEntityDefinitionId, input.bienEntityDefinitionId);
  }
  return coreService.createRecord({
    toolId: input.toolId,
    entityDefinitionId: input.facturePartageeEntityDefinitionId,
    values: input.values,
    statusKey: 'a_payer',
  });
}

/** 0 part payée → a_payer ; certaines → partielle ; toutes → payee. Dérivé de
 * l'état réel des part_locataire, jamais stocké de façon indépendante (§11). */
export function deriveFacturePartageeStatus(parts: RecordItem[]): 'a_payer' | 'partielle' | 'payee' {
  if (parts.length === 0) return 'a_payer';
  const paidCount = parts.filter((p) => p.statusKey === 'payee').length;
  if (paidCount === 0) return 'a_payer';
  if (paidCount === parts.length) return 'payee';
  return 'partielle';
}

/** Fige la répartition : crée une part_locataire — un vrai RecordItem, pas une
 * ligne dans un blob JSON — par participant, puis dérive le statut global de
 * la facture_partagee à partir de ces parts. Les montants sont figés à cet
 * instant ; modifier la facture ensuite ne recalcule pas rétroactivement les
 * parts déjà créées. */
export async function validateRepartition(input: {
  toolId: string;
  partLocataireEntityDefinitionId: string;
  facturePartageeId: string;
  mode: RepartitionMode;
  lines: RepartitionLine[];
}): Promise<RecordItem[]> {
  const parts: RecordItem[] = [];
  for (const line of input.lines) {
    const part = await coreService.createRecord({
      toolId: input.toolId,
      entityDefinitionId: input.partLocataireEntityDefinitionId,
      values: {
        facture_partagee: input.facturePartageeId,
        participant_type: line.participant.type,
        participant_id: line.participant.id,
        label: line.participant.label,
        consommation: line.consommation,
        montant_attribue: line.montant,
      },
      statusKey: 'a_payer',
    });
    parts.push(part);
  }
  await coreService.updateRecord(input.facturePartageeId, { statusKey: deriveFacturePartageeStatus(parts), values: { mode_repartition: input.mode } });
  return parts;
}

/** Marque UNE part comme payée/à payer sans toucher aux autres, puis recalcule
 * le statut global de la facture_partagee à partir de l'ensemble réel des
 * parts (jamais une réécriture globale d'un tableau JSON — §11). */
export async function markPartStatus(input: {
  toolId: string;
  facturePartageeId: string;
  partId: string;
  statusKey: 'a_payer' | 'payee';
  allParts: RecordItem[];
}): Promise<void> {
  await coreService.updateRecord(input.partId, { statusKey: input.statusKey });
  const updatedParts = input.allParts.map((p) => (p.id === input.partId ? { ...p, statusKey: input.statusKey } : p));
  await coreService.updateRecord(input.facturePartageeId, { statusKey: deriveFacturePartageeStatus(updatedParts) });
}

const FOURNISSEUR_LABEL: Record<string, string> = { ceet: 'CEET', tde: 'TDE', autre: 'Autre' };

/** Construit le reçu texte partageable (Share.share()) à partir des vraies
 * données Core (facture_partagee + part_locataire), jamais de repartitions_json.
 * N'invente aucune donnée absente : les index précédent/actuel ne sont inclus
 * que si un relevé correspondant a réellement été trouvé pour ce participant. */
export function buildReceiptText(facturePartagee: RecordItem, parts: RecordItem[], releves: RecordItem[]): string {
  const fournisseur = FOURNISSEUR_LABEL[String(facturePartagee.values.fournisseur)] ?? String(facturePartagee.values.fournisseur ?? '');
  const periode = String(facturePartagee.values.mois ?? '');
  const montantTotal = typeof facturePartagee.values.montant_total === 'number' ? facturePartagee.values.montant_total : 0;
  const mode = facturePartagee.values.mode_repartition === 'proportionnel' ? 'Proportionnel (selon consommation)' : facturePartagee.values.mode_repartition === 'equitable' ? 'Équitable (parts égales)' : null;

  const lines = [`FACTURE ${fournisseur}${periode ? ` · ${periode}` : ''}`, `Total : ${montantTotal.toLocaleString('fr-FR')} FCFA`];
  if (mode) lines.push(`Mode : ${mode}`);
  lines.push('------------------------------');

  for (const part of parts) {
    const label = typeof part.values.label === 'string' && part.values.label ? part.values.label : 'Participant';
    const montant = typeof part.values.montant_attribue === 'number' ? part.values.montant_attribue : 0;
    const statut = part.statusKey === 'payee' ? 'Payé' : 'À payer';
    let indexLine = '';
    const releve = releves.find((r) => r.values.fournisseur === facturePartagee.values.fournisseur && r.values.mois === facturePartagee.values.mois && r.values.participant_type === part.values.participant_type && r.values.participant_id === part.values.participant_id);
    const previous = releve ? findPreviousReleve({ type: part.values.participant_type as ParticipantType, id: (part.values.participant_id as string) ?? null, label }, String(facturePartagee.values.fournisseur), String(facturePartagee.values.mois), releves) : null;
    if (releve && previous && typeof releve.values.index === 'number' && typeof previous.values.index === 'number') {
      indexLine = ` (index ${previous.values.index} → ${releve.values.index}, ${computeConsommation(previous.values.index, releve.values.index)} unités)`;
    }
    lines.push(`${label} : ${montant.toLocaleString('fr-FR')} FCFA — ${statut}${indexLine}`);
  }

  return lines.join('\n');
}
