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
import { ensureFacturesToolCached } from './facturesService';
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
      // Modèle Immobilier actuel : locataire = ExternalContact (`locataire_id`),
      // logement = enregistrement `logement`. Repli sur les champs hérités des
      // contrats antérieurs à la refonte du 2026-10-04.
      const locataireId = contrat.values.locataire_id;
      if (typeof locataireId === 'string' && locataireId) {
        const contact = await coreService.getExternalContact(locataireId);
        if (contact?.name) return contact.name;
      }
      const nom = contrat.values.locataire_nom;
      if (typeof nom === 'string' && nom.trim()) return nom;
      const logementId = contrat.values.logement;
      if (typeof logementId === 'string' && logementId) {
        const logement = await coreService.getRecord(logementId);
        if (typeof logement?.values.nom === 'string' && logement.values.nom.trim()) return logement.values.nom;
      }
      const legacyLogement = contrat.values.nom_logement;
      if (typeof legacyLogement === 'string' && legacyLogement.trim()) return legacyLogement;
    }
  }
  if (participant.type === 'contact' && participant.id) {
    const contact = await coreService.getExternalContact(participant.id);
    if (contact?.name) return contact.name;
  }
  return fallback;
}

// ---- Erreurs métier ------------------------------------------------------------

export type UtilityBillingErrorCode =
  | 'INDEX_INVALIDE'
  | 'PERIODE_INVALIDE'
  | 'FOURNISSEUR_INVALIDE'
  | 'PARTICIPANT_INVALIDE'
  | 'PARTICIPANT_DEJA_PRESENT'
  | 'RELEVES_INVALIDES'
  | 'RELEVE_UTILISE'
  | 'RELEVE_INTROUVABLE'
  | 'RELEVE_DEJA_ENREGISTRE'
  | 'INDEX_ACTUEL_INFERIEUR'
  | 'INDEX_PRECEDENT_MANQUANT'
  | 'INDEX_ACTUEL_MANQUANT'
  | 'CONSOMMATION_TOTALE_NULLE'
  | 'MONTANT_INVALIDE'
  | 'AUCUN_PARTICIPANT'
  | 'REPARTITION_INCOMPLETE'
  | 'SNAPSHOT_INCOMPLET'
  | 'FACTURE_INTROUVABLE'
  | 'FACTURE_DEJA_REPARTIE'
  | 'PART_INTROUVABLE'
  | 'PART_DEJA_PAYEE'
  | 'PAIEMENT_EN_COURS'
  | 'PAIEMENT_IMMUTABLE';

/** Erreur métier avec un `code` stable : l'interface future s'appuie sur le code
 * (jamais sur le texte) pour expliquer le problème à l'utilisateur. */
export class UtilityBillingError extends Error {
  readonly code: UtilityBillingErrorCode;
  readonly details?: unknown;
  constructor(code: UtilityBillingErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'UtilityBillingError';
    this.code = code;
    this.details = details;
  }
}

export const FOURNISSEURS = ['ceet', 'tde', 'autre'] as const;

/** Clé de comparaison d'un fournisseur. Les anciens relevés (écran Relevés) ont
 * été enregistrés en « CEET »/« TDE » alors que les factures utilisent « ceet »/
 * « tde » : toutes les comparaisons sont insensibles à la casse (les anciennes
 * données ne sont pas modifiées ; les nouveaux relevés sont écrits en minuscules). */
export const fournisseurKey = (value: unknown): string => String(value ?? '').trim().toLowerCase();
const PERIODE_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;
const periodeIndex = (periode: string): number => {
  const [y, m] = periode.split('-').map(Number);
  return y * 12 + (m - 1);
};
const periodeFromIndex = (index: number): string => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

/** « septembre 2026 » — pour les messages métier. */
export function periodeLabel(periode: string): string {
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const [y, m] = periode.split('-').map(Number);
  return `${MOIS[m - 1] ?? periode} ${y}`;
}

// ---- Relevés : cahier d'index, scopé par participant réel (Phase F / §9) ----

export interface PreviousReleveResult {
  releve: RecordItem | null;
  /** Mois sans relevé entre le relevé précédent trouvé et la période demandée
   * (jamais comblés : aucun relevé intermédiaire n'est inventé). */
  missingMonths: string[];
}

/** Relevé chronologiquement antérieur (strictement) à `periode` pour ce
 * participant et ce fournisseur : le plus récent d'entre eux. Un relevé de la
 * même période ou futur n'est JAMAIS retenu. Si des mois manquent entre les
 * deux, ils sont listés dans `missingMonths` (écart signalé, pas comblé). */
export function resolvePreviousReleve(participant: Participant, fournisseur: string, periode: string, releves: RecordItem[]): PreviousReleveResult {
  if (!PERIODE_FORMAT.test(periode)) return { releve: null, missingMonths: [] };
  const candidates = releves.filter(
    (r) =>
      fournisseurKey(r.values.fournisseur) === fournisseurKey(fournisseur) &&
      typeof r.values.mois === 'string' &&
      PERIODE_FORMAT.test(r.values.mois) &&
      r.values.mois < periode &&
      typeof r.values.index === 'number' &&
      sameParticipant(r.values, participant),
  );
  if (candidates.length === 0) return { releve: null, missingMonths: [] };
  const previous = candidates.reduce((a, b) => (String(b.values.mois) > String(a.values.mois) ? b : a));
  const missingMonths: string[] = [];
  for (let i = periodeIndex(String(previous.values.mois)) + 1; i < periodeIndex(periode); i += 1) missingMonths.push(periodeFromIndex(i));
  return { releve: previous, missingMonths };
}

/** Compatibilité : retourne seulement le relevé précédent (voir `resolvePreviousReleve`
 * pour connaître aussi les mois manquants). Ne fabrique jamais de valeur. */
export function findPreviousReleve(participant: Participant, fournisseur: string, periode: string, releves: RecordItem[]): RecordItem | null {
  return resolvePreviousReleve(participant, fournisseur, periode, releves).releve;
}

/** Relevé EXACT d'un participant pour une période (ou null). */
export function findReleve(participant: Participant, fournisseur: string, periode: string, releves: RecordItem[]): RecordItem | null {
  return releves.find((r) => fournisseurKey(r.values.fournisseur) === fournisseurKey(fournisseur) && r.values.mois === periode && sameParticipant(r.values, participant)) ?? null;
}

/** Compatibilité d'affichage (écrans existants) : consommation, jamais négative.
 * ⚠ Ne l'utilisez PAS pour valider un calcul : un index actuel inférieur est
 * ramené à 0 ici. Le moteur utilise `computeConsommationChecked`. */
export function computeConsommation(indexPrecedent: number, indexActuel: number): number {
  return Math.max(0, indexActuel - indexPrecedent);
}

export type ConsommationResult = { valid: true; consommation: number } | { valid: false; error: 'INDEX_INVALIDE' | 'INDEX_ACTUEL_INFERIEUR'; message: string };

/** consommation = actuel − précédent. Un index actuel inférieur au précédent est
 * une erreur métier explicite (jamais « 0 »). */
export function computeConsommationChecked(indexPrecedent: number, indexActuel: number): ConsommationResult {
  if (![indexPrecedent, indexActuel].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
    return { valid: false, error: 'INDEX_INVALIDE', message: 'Les index doivent être des nombres positifs.' };
  }
  if (indexActuel < indexPrecedent) {
    return { valid: false, error: 'INDEX_ACTUEL_INFERIEUR', message: "L'index actuel ne peut pas être inférieur à l'index précédent." };
  }
  return { valid: true, consommation: indexActuel - indexPrecedent };
}

/** Comme `computeConsommation` mais lève `UtilityBillingError` au lieu de renvoyer 0. */
export function computeConsommationStrict(indexPrecedent: number, indexActuel: number): number {
  const result = computeConsommationChecked(indexPrecedent, indexActuel);
  if (!result.valid) throw new UtilityBillingError(result.error, result.message);
  return result.consommation;
}

/** Valide l'identité d'un participant : le type est connu et l'identifiant
 * référence un vrai enregistrement (contrat ou contact) ; la saisie libre
 * exige un libellé. */
export async function assertParticipantValid(participant: Participant): Promise<void> {
  const fail = (message: string): never => {
    throw new UtilityBillingError('PARTICIPANT_INVALIDE', message);
  };
  if (!participant || !participant.label || !participant.label.trim()) fail('Participant invalide : nom manquant.');
  if (participant.type === 'manuel') return;
  if (participant.type !== 'contrat' && participant.type !== 'contact') fail('Participant invalide : type inconnu.');
  if (!participant.id) fail('Participant invalide : identifiant manquant.');
  const found = participant.type === 'contrat' ? await coreService.getRecord(participant.id!) : await coreService.getExternalContact(participant.id!);
  if (!found) fail('Participant introuvable.');
}

/** Valide les données d'un relevé (hors existence du participant, async). */
export function validateReleveInput(input: { fournisseur: string; periode: string; index: unknown }): void {
  if (!(FOURNISSEURS as readonly string[]).includes(fournisseurKey(input.fournisseur))) {
    throw new UtilityBillingError('FOURNISSEUR_INVALIDE', 'Fournisseur invalide (CEET ou TDE attendu).');
  }
  if (typeof input.periode !== 'string' || !PERIODE_FORMAT.test(input.periode)) {
    throw new UtilityBillingError('PERIODE_INVALIDE', 'Période invalide (AAAA-MM attendu).');
  }
  if (typeof input.index !== 'number' || !Number.isFinite(input.index) || input.index < 0) {
    throw new UtilityBillingError('INDEX_INVALIDE', "L'index doit être un nombre positif ou nul.");
  }
}

const relevesEnCours = new Set<string>();

/** Enregistre le relevé d'un participant pour une période. Validé strictement
 * (index fini et ≥ 0, période AAAA-MM, fournisseur, participant réel). Un seul
 * relevé par (fournisseur, période, participant) : s'il en existe déjà un,
 * l'ancien n'est JAMAIS écrasé — la même valeur est renvoyée telle quelle
 * (idempotent), une valeur différente est refusée (RELEVE_DEJA_ENREGISTRE).
 * Une correction est une opération distincte, non prévue ici. */
export async function saveReleve(input: {
  toolId: string;
  releveEntityDefinitionId: string;
  fournisseur: string;
  periode: string;
  participant: Participant;
  index: number;
  note?: string | null;
  /** Conservé pour compatibilité : l'unicité est vérifiée sur les données fraîches. */
  existing?: RecordItem[];
}): Promise<RecordItem> {
  validateReleveInput(input);
  await assertParticipantValid(input.participant);
  const key = `${fournisseurKey(input.fournisseur)}|${input.periode}|${input.participant.type}|${input.participant.id ?? input.participant.label.trim().toLowerCase()}`;
  if (relevesEnCours.has(key)) {
    throw new UtilityBillingError('RELEVE_DEJA_ENREGISTRE', `Relevé déjà en cours d'enregistrement pour ${input.participant.label} — ${periodeLabel(input.periode)}.`);
  }
  relevesEnCours.add(key);
  try {
    const fresh = await coreService.getRecords({ toolId: input.toolId, entityDefinitionId: input.releveEntityDefinitionId });
    const found = findReleve(input.participant, input.fournisseur, input.periode, fresh);
    if (found) {
      if (found.values.index === input.index) return found;
      throw new UtilityBillingError(
        'RELEVE_DEJA_ENREGISTRE',
        `Relevé déjà enregistré pour ${input.participant.label} — ${periodeLabel(input.periode)}.`,
        { existingId: found.id, existingIndex: found.values.index },
      );
    }
    return await coreService.createRecord({
      toolId: input.toolId,
      entityDefinitionId: input.releveEntityDefinitionId,
      values: {
        fournisseur: fournisseurKey(input.fournisseur),
        mois: input.periode,
        compteur: input.participant.label,
        index: input.index,
        note: input.note ?? null,
        participant_type: input.participant.type,
        participant_id: input.participant.id,
      },
    });
  } finally {
    relevesEnCours.delete(key);
  }
}

/** Un relevé est « utilisé » dès qu'une part validée s'appuie dessus : par
 * référence directe (nouvelles parts) ou, pour les anciennes parts sans
 * référence, parce qu'une facture proportionnelle du même fournisseur et de la
 * même période existe pour ce participant. Un relevé utilisé ne doit jamais
 * être modifié rétroactivement. */
export function isReleveUsed(releve: RecordItem, parts: RecordItem[], factures: RecordItem[]): boolean {
  const participant = { type: releve.values.participant_type as ParticipantType, id: (releve.values.participant_id as string) ?? null, label: String(releve.values.compteur ?? '') };
  return parts.some((p) => {
    if (p.values.releve_actuel_id === releve.id || p.values.releve_precedent_id === releve.id) return true;
    const facture = factures.find((f) => f.id === p.values.facture_partagee);
    return (
      !!facture &&
      facture.values.mode_repartition === 'proportionnel' &&
      fournisseurKey(facture.values.fournisseur) === fournisseurKey(releve.values.fournisseur) &&
      facture.values.mois === releve.values.mois &&
      p.values.participant_type === participant.type &&
      p.values.participant_id === participant.id &&
      (participant.type !== 'manuel' || String(p.values.label ?? '').trim().toLowerCase() === participant.label.trim().toLowerCase())
    );
  });
}

export const RELEVE_VERROUILLE_MESSAGE = 'Ce relevé a déjà été utilisé dans une facture validée et ne peut plus être modifié.';

/** Identifiants des relevés verrouillés (utilisés par une facture validée) parmi
 * `releves`, d'après les parts et factures enregistrées. Même logique que
 * `isReleveUsed` — aucune seconde détection. */
export async function loadLockedReleveIds(releves: RecordItem[]): Promise<Set<string>> {
  const ents = await ensureFacturesToolCached();
  const [parts, factures] = await Promise.all([
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.partLocataireDefinition.id }),
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.facturePartageeDefinition.id }),
  ]);
  return new Set(releves.filter((r) => isReleveUsed(r, parts, factures)).map((r) => r.id));
}

async function loadModifiableReleve(releveId: string): Promise<RecordItem> {
  const releve = await coreService.getRecord(releveId);
  const ents = await ensureFacturesToolCached();
  if (!releve || releve.entityDefinitionId !== ents.releveDefinition.id) throw new UtilityBillingError('RELEVE_INTROUVABLE', 'Relevé introuvable.');
  if ((await loadLockedReleveIds([releve])).has(releve.id)) throw new UtilityBillingError('RELEVE_UTILISE', RELEVE_VERROUILLE_MESSAGE);
  return releve;
}

/** Corrige l'index d'un relevé NON utilisé (même id, historique des modifications
 * conservé par le Core). Refusé dès qu'une facture validée s'appuie dessus. Un
 * index inférieur au précédent reste enregistrable (corrigeable) : il est signalé
 * comme incohérent et bloque toute validation de facture qui en dépend. */
export async function updateReleveIndex(releveId: string, index: number): Promise<RecordItem> {
  if (typeof index !== 'number' || !Number.isFinite(index) || index < 0) {
    throw new UtilityBillingError('INDEX_INVALIDE', "L'index doit être un nombre positif ou nul.");
  }
  const releve = await loadModifiableReleve(releveId);
  if (releve.values.index === index) return releve;
  return coreService.updateRecord(releve.id, { values: { index } });
}

/** Supprime un relevé NON utilisé. Refusé dès qu'une facture validée s'appuie dessus. */
export async function deleteReleve(releveId: string): Promise<void> {
  const releve = await loadModifiableReleve(releveId);
  await coreService.deleteRecord(releve.id);
}

// ---- Répartition (formules H-PAY, réconciliées exactement — voir le rapport
// de fusion Étape 4 pour la comparaison avec l'arrondi non réconcilié de H-PAY) --

export interface RepartitionLine {
  participant: Participant;
  consommation: number;
  montant: number;
  // Snapshot facultatif, présent quand la ligne vient du moteur (relevés
  // enregistrés) — écrit dans la part à la validation, jamais recalculé.
  indexPrecedent?: number;
  indexActuel?: number;
  prixUnitaire?: number;
  nbParticipants?: number;
  relevePrecedentId?: string;
  releveActuelId?: string;
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
  return participants.map((participant, i) => ({ participant, consommation: 0, montant: base + (i < remainder ? 1 : 0), nbParticipants: n }));
}

export interface ParticipantIssue {
  participant: Participant;
  code: 'INDEX_PRECEDENT_MANQUANT' | 'INDEX_ACTUEL_MANQUANT' | 'INDEX_ACTUEL_INFERIEUR';
  message: string;
}

export interface ReleveGapWarning {
  participant: Participant;
  /** Période du relevé précédent réellement utilisé. */
  previousPeriode: string;
  missingMonths: string[];
  message: string;
}

export type ParticipantReleves =
  | { ok: true; actuel: RecordItem; precedent: RecordItem; indexActuel: number; indexPrecedent: number; consommation: number; missingMonths: string[] }
  | { ok: false; actuel: RecordItem | null; precedent: RecordItem | null; missingMonths: string[]; issue: ParticipantIssue };

function gapWarning(participant: Participant, previousPeriode: string, missingMonths: string[]): ReleveGapWarning {
  return {
    participant,
    previousPeriode,
    missingMonths,
    message: `Relevé précédent disponible en ${periodeLabel(previousPeriode)}. Aucun relevé enregistré en ${missingMonths.map(periodeLabel).join(', ')}.`,
  };
}

/** Résout, à partir des relevés ENREGISTRÉS uniquement, le relevé actuel (exact)
 * et le relevé précédent (chronologique) d'un participant pour une période, puis
 * la consommation. Source unique utilisée par le calcul ET par l'affichage en
 * lecture seule : même résultat partout, aucun index saisi à la main. */
export function resolveParticipantReleves(participant: Participant, fournisseur: string, periode: string, releves: RecordItem[]): ParticipantReleves {
  const actuelRecord = findReleve(participant, fournisseur, periode, releves);
  const actuel = actuelRecord && typeof actuelRecord.values.index === 'number' ? actuelRecord : null;
  const { releve: precedent, missingMonths } = resolvePreviousReleve(participant, fournisseur, periode, releves);
  const issue = (code: ParticipantIssue['code'], message: string): ParticipantReleves => ({ ok: false, actuel, precedent, missingMonths, issue: { participant, code, message } });
  if (!actuel) return issue('INDEX_ACTUEL_MANQUANT', `Index actuel manquant pour ${participant.label} — ${periodeLabel(periode)}.`);
  if (!precedent) return issue('INDEX_PRECEDENT_MANQUANT', `Index précédent manquant pour ${participant.label}.`);
  const conso = computeConsommationChecked(precedent.values.index as number, actuel.values.index as number);
  if (!conso.valid) return issue('INDEX_ACTUEL_INFERIEUR', `${participant.label} : l'index actuel ne peut pas être inférieur à l'index précédent.`);
  return { ok: true, actuel, precedent, indexActuel: actuel.values.index as number, indexPrecedent: precedent.values.index as number, consommation: conso.consommation, missingMonths };
}

export type RepartitionParCompteurResult =
  | { ok: true; lines: RepartitionLine[]; prixUnitaire: number; totalConsommation: number; warnings: ReleveGapWarning[] }
  | { ok: false; error?: 'MONTANT_INVALIDE' | 'AUCUN_PARTICIPANT' | 'CONSOMMATION_TOTALE_NULLE'; issues: ParticipantIssue[]; warnings: ReleveGapWarning[] };

/** Répartition PAR COMPTEUR à partir des relevés DÉJÀ enregistrés — aucune
 * ressaisie d'index. Pour chaque participant : relevé actuel exact de la période
 * + relevé chronologiquement précédent (voir `resolvePreviousReleve`). Rien
 * n'est deviné : un index manquant ou incohérent est remonté dans `issues` et
 * `ok` vaut false (la validation d'une facture doit alors être bloquée). Un
 * écart entre deux relevés n'est pas une erreur : il est signalé dans `warnings`. */
export function computeRepartitionParCompteur(input: {
  participants: Participant[];
  fournisseur: string;
  periode: string;
  releves: RecordItem[];
  montantTotal: number;
}): RepartitionParCompteurResult {
  const { participants, fournisseur, periode, releves, montantTotal } = input;
  const issues: ParticipantIssue[] = [];
  const warnings: ReleveGapWarning[] = [];
  if (typeof montantTotal !== 'number' || !Number.isFinite(montantTotal) || montantTotal <= 0) return { ok: false, error: 'MONTANT_INVALIDE', issues, warnings };
  if (participants.length === 0) return { ok: false, error: 'AUCUN_PARTICIPANT', issues, warnings };

  const resolved: { participant: Participant; consommation: number; prec: RecordItem; actuel: RecordItem }[] = [];
  for (const participant of participants) {
    const r = resolveParticipantReleves(participant, fournisseur, periode, releves);
    if (!r.ok) {
      issues.push(r.issue);
      continue;
    }
    if (r.missingMonths.length > 0) warnings.push(gapWarning(participant, String(r.precedent.values.mois), r.missingMonths));
    resolved.push({ participant, consommation: r.consommation, prec: r.precedent, actuel: r.actuel });
  }
  if (issues.length > 0) return { ok: false, issues, warnings };

  const totalConsommation = resolved.reduce((sum, r) => sum + r.consommation, 0);
  if (totalConsommation <= 0) return { ok: false, error: 'CONSOMMATION_TOTALE_NULLE', issues, warnings };

  const prixUnitaire = montantTotal / totalConsommation;
  const amounts = computeRepartitionProportionnelle(resolved.map((r) => ({ participant: r.participant, consommation: r.consommation })), montantTotal);
  const lines: RepartitionLine[] = amounts.map((line, i) => ({
    ...line,
    indexPrecedent: resolved[i].prec.values.index as number,
    indexActuel: resolved[i].actuel.values.index as number,
    prixUnitaire,
    nbParticipants: resolved.length,
    relevePrecedentId: resolved[i].prec.id,
    releveActuelId: resolved[i].actuel.id,
  }));
  return { ok: true, lines, prixUnitaire, totalConsommation, warnings };
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
  // Le champ « sélection » du formulaire enregistre le libellé (« CEET », « TDE ») : on
  // normalise à l'identifiant (`ceet`, `tde`, `autre`) à la création. Les anciennes
  // factures restent lisibles (comparaisons insensibles à la casse partout).
  const key = fournisseurKey(input.values.fournisseur);
  const values = (FOURNISSEURS as readonly string[]).includes(key) ? { ...input.values, fournisseur: key } : input.values;
  return coreService.createRecord({
    toolId: input.toolId,
    entityDefinitionId: input.facturePartageeEntityDefinitionId,
    values,
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

/** Mode proportionnel : refuse toute ligne qui n'est pas entièrement adossée à
 * des relevés ENREGISTRÉS — index précédent/actuel, identifiants des deux
 * relevés, consommation et prix unitaire cohérents — et dont les index
 * correspondent exactement aux relevés référencés (même participant, même
 * fournisseur). Aucune part ne peut donc être créée avec un index « inventé »
 * (ancien appelant, écran, import…). */
async function assertProportionnelSnapshot(lines: RepartitionLine[], facture: RecordItem): Promise<void> {
  const fail = (message: string, details?: unknown): never => {
    throw new UtilityBillingError('SNAPSHOT_INCOMPLET', message, details);
  };
  const fournisseur = fournisseurKey(facture.values.fournisseur);
  for (const line of lines) {
    const who = line.participant.label;
    const { indexPrecedent, indexActuel, prixUnitaire, relevePrecedentId, releveActuelId } = line;
    const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    if (!finite(indexPrecedent) || !finite(indexActuel) || !finite(prixUnitaire) || !relevePrecedentId || !releveActuelId) {
      fail(`Répartition par compteur refusée : les relevés utilisés pour ${who} ne sont pas référencés.`);
    }
    if (indexActuel! < indexPrecedent! || line.consommation !== indexActuel! - indexPrecedent!) {
      fail(`Répartition par compteur refusée : consommation incohérente pour ${who}.`);
    }
    const [prec, actuel] = await Promise.all([coreService.getRecord(relevePrecedentId!), coreService.getRecord(releveActuelId!)]);
    const matches = (r: RecordItem | null, index: number) =>
      !!r &&
      r.values.index === index &&
      fournisseurKey(r.values.fournisseur) === fournisseur &&
      r.values.participant_type === line.participant.type &&
      (r.values.participant_id ?? null) === (line.participant.id ?? null) &&
      (line.participant.type !== 'manuel' || String(r.values.compteur ?? '').trim().toLowerCase() === who.trim().toLowerCase());
    if (!matches(prec, indexPrecedent!) || !matches(actuel, indexActuel!)) {
      fail(`Répartition par compteur refusée : les index de ${who} ne correspondent pas aux relevés enregistrés.`);
    }
    if (typeof facture.values.mois === 'string' && actuel!.values.mois !== facture.values.mois) {
      fail(`Répartition par compteur refusée : le relevé actuel de ${who} n'est pas celui de la période de la facture.`);
    }
  }
}

const validationsEnCours = new Set<string>();

/** Fige la répartition : crée une part_locataire — un vrai RecordItem, pas une
 * ligne dans un blob JSON — par participant, puis dérive le statut global de
 * la facture_partagee à partir de ces parts. Les montants (et, quand le moteur
 * les fournit, index précédent/actuel, consommation, prix unitaire, nombre de
 * participants, montant de la facture, fournisseur, période) sont FIGÉS dans la
 * part à cet instant : modifier un relevé ou la facture ensuite ne change ni la
 * part ni son reçu. Refuse une facture déjà répartie et une répartition dont la
 * somme ne vaut pas le montant de la facture. */
export async function validateRepartition(input: {
  toolId: string;
  partLocataireEntityDefinitionId: string;
  facturePartageeId: string;
  mode: RepartitionMode;
  lines: RepartitionLine[];
}): Promise<RecordItem[]> {
  if (validationsEnCours.has(input.facturePartageeId)) {
    throw new UtilityBillingError('FACTURE_DEJA_REPARTIE', 'Cette facture est déjà en cours de validation.');
  }
  validationsEnCours.add(input.facturePartageeId);
  try {
    const facture = await coreService.getRecord(input.facturePartageeId);
    if (!facture) throw new UtilityBillingError('FACTURE_INTROUVABLE', 'Facture introuvable.');
    if (input.lines.length === 0) throw new UtilityBillingError('AUCUN_PARTICIPANT', 'Aucun participant à répartir.');
    const existing = await coreService.getRecords({ toolId: input.toolId, entityDefinitionId: input.partLocataireEntityDefinitionId });
    if (existing.some((p) => p.values.facture_partagee === facture.id)) {
      throw new UtilityBillingError('FACTURE_DEJA_REPARTIE', 'Cette facture a déjà été répartie.');
    }
    const montantTotal = typeof facture.values.montant_total === 'number' ? facture.values.montant_total : null;
    if (montantTotal === null || !Number.isFinite(montantTotal) || montantTotal <= 0) {
      throw new UtilityBillingError('MONTANT_INVALIDE', 'Le montant de la facture est invalide.');
    }
    if (input.mode === 'proportionnel') await assertProportionnelSnapshot(input.lines, facture);
    if (input.lines.reduce((sum, l) => sum + l.montant, 0) !== montantTotal) {
      throw new UtilityBillingError('REPARTITION_INCOMPLETE', 'La somme des parts ne correspond pas au montant de la facture.');
    }

    const parts: RecordItem[] = [];
    for (const line of input.lines) {
      const values: Record<string, FieldValue> = {
        facture_partagee: facture.id,
        participant_type: line.participant.type,
        participant_id: line.participant.id,
        label: line.participant.label,
        consommation: line.consommation,
        montant_attribue: line.montant,
        fournisseur: typeof facture.values.fournisseur === 'string' ? facture.values.fournisseur : null,
        periode: typeof facture.values.mois === 'string' ? facture.values.mois : null,
        montant_facture: montantTotal,
        nb_participants: line.nbParticipants ?? input.lines.length,
      };
      if (line.indexPrecedent !== undefined) values.index_precedent = line.indexPrecedent;
      if (line.indexActuel !== undefined) values.index_actuel = line.indexActuel;
      if (line.prixUnitaire !== undefined) values.prix_unitaire = line.prixUnitaire;
      if (line.relevePrecedentId) values.releve_precedent_id = line.relevePrecedentId;
      if (line.releveActuelId) values.releve_actuel_id = line.releveActuelId;
      parts.push(
        await coreService.createRecord({ toolId: input.toolId, entityDefinitionId: input.partLocataireEntityDefinitionId, values, statusKey: 'a_payer' }),
      );
    }
    await coreService.updateRecord(facture.id, { statusKey: deriveFacturePartageeStatus(parts), values: { mode_repartition: input.mode } });
    return parts;
  } finally {
    validationsEnCours.delete(input.facturePartageeId);
  }
}

/** Validation d'une facture PAR COMPTEUR depuis les relevés déjà enregistrés
 * (aucune ressaisie). Bloquée si un participant n'a pas d'index exploitable :
 * on ne valide jamais une répartition où certains participants ne sont pas
 * réellement calculés. */
export async function validerFactureParCompteur(input: {
  toolId: string;
  releveEntityDefinitionId: string;
  partLocataireEntityDefinitionId: string;
  facturePartageeId: string;
  participants: Participant[];
}): Promise<RecordItem[]> {
  const facture = await coreService.getRecord(input.facturePartageeId);
  if (!facture) throw new UtilityBillingError('FACTURE_INTROUVABLE', 'Facture introuvable.');
  const releves = await coreService.getRecords({ toolId: input.toolId, entityDefinitionId: input.releveEntityDefinitionId });
  const result = computeRepartitionParCompteur({
    participants: input.participants,
    fournisseur: String(facture.values.fournisseur ?? ''),
    periode: String(facture.values.mois ?? ''),
    releves,
    montantTotal: typeof facture.values.montant_total === 'number' ? facture.values.montant_total : NaN,
  });
  if (!result.ok) {
    throw new UtilityBillingError(result.error ?? (result.issues[0]?.code ?? 'REPARTITION_INCOMPLETE'), 'Répartition par compteur impossible : relevés incomplets ou incohérents.', result.issues);
  }
  return validateRepartition({
    toolId: input.toolId,
    partLocataireEntityDefinitionId: input.partLocataireEntityDefinitionId,
    facturePartageeId: input.facturePartageeId,
    mode: 'proportionnel',
    lines: result.lines,
  });
}

// ---- Paiement : un seul geste, historique, immuable -----------------------------

const paiementsPartEnCours = new Set<string>();

async function refreshFactureStatus(facturePartageeId: string, toolId: string, partDefinitionId: string): Promise<void> {
  const all = await coreService.getRecords({ toolId, entityDefinitionId: partDefinitionId });
  await coreService.updateRecord(facturePartageeId, { statusKey: deriveFacturePartageeStatus(all.filter((p) => p.values.facture_partagee === facturePartageeId)) });
}

/** « Enregistrer le paiement » : la part passe `a_payer` → `payee` avec la date
 * réelle du paiement. Participant, montant, période et facture sont déjà dans la
 * part — rien à ressaisir. Une part déjà payée n'est jamais re-payée (aucun
 * second paiement) ; deux appels simultanés n'en produisent qu'un. */
export async function enregistrerPaiementPart(partId: string, now: Date = new Date()): Promise<RecordItem> {
  if (paiementsPartEnCours.has(partId)) throw new UtilityBillingError('PAIEMENT_EN_COURS', 'Un paiement est déjà en cours d’enregistrement.');
  paiementsPartEnCours.add(partId);
  try {
    const part = await coreService.getRecord(partId);
    if (!part || typeof part.values.facture_partagee !== 'string') throw new UtilityBillingError('PART_INTROUVABLE', 'Part introuvable.');
    if (part.statusKey === 'payee') throw new UtilityBillingError('PART_DEJA_PAYEE', 'Cette part est déjà payée.');
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const updated = await coreService.updateRecord(part.id, { statusKey: 'payee', values: { date_paiement: day } });
    await refreshFactureStatus(part.values.facture_partagee, part.toolId, part.entityDefinitionId);
    return updated;
  } finally {
    paiementsPartEnCours.delete(partId);
  }
}

/** Compatibilité : `a_payer` → `payee` passe par `enregistrerPaiementPart` (date
 * réelle). `payee` → `a_payer` est refusé : un paiement est historique. */
export async function markPartStatus(input: {
  toolId: string;
  facturePartageeId: string;
  partId: string;
  statusKey: 'a_payer' | 'payee';
  allParts: RecordItem[];
}): Promise<void> {
  const current = input.allParts.find((p) => p.id === input.partId);
  if (input.statusKey === 'a_payer') {
    if (current?.statusKey === 'payee') throw new UtilityBillingError('PAIEMENT_IMMUTABLE', 'Un paiement enregistré ne peut pas être annulé.');
    return;
  }
  await enregistrerPaiementPart(input.partId);
}

/** Date de paiement d'une part : la valeur enregistrée, ou « inconnue » pour une
 * ancienne part payée avant l'existence de ce champ — jamais la date du jour. */
export function getPartPaymentInfo(part: RecordItem): { paid: boolean; date: string | null; dateKnown: boolean } {
  const paid = part.statusKey === 'payee';
  const date = typeof part.values.date_paiement === 'string' && part.values.date_paiement ? part.values.date_paiement : null;
  return { paid, date: paid ? date : null, dateKnown: paid && date !== null };
}

const FOURNISSEUR_LABEL: Record<string, string> = { ceet: 'CEET', tde: 'TDE', autre: 'Autre' };

export interface ReceiptData {
  fournisseur: string;
  fournisseurLabel: string;
  periode: string;
  participant: string;
  mode: RepartitionMode | null;
  montant: number;
  montantFacture: number | null;
  statut: 'payee' | 'a_payer';
  datePaiement: string | null;
  datePaiementConnue: boolean;
  /** Renseignés seulement si la part les a figés (calcul par compteur récent). */
  indexPrecedent: number | null;
  indexActuel: number | null;
  consommation: number | null;
  prixUnitaire: number | null;
  nombreParticipants: number | null;
  /** false pour une ancienne part sans détail figé : rien n'est reconstruit. */
  detailFige: boolean;
}

/** Données de reçu d'une part, lues UNIQUEMENT dans la part (valeurs figées à la
 * validation) et, pour les anciennes parts, dans la facture — jamais relues
 * depuis les relevés actuels. */
export function buildReceiptData(facture: RecordItem, part: RecordItem): ReceiptData {
  const num = (v: FieldValue | undefined): number | null => (typeof v === 'number' ? v : null);
  const fournisseur = String(part.values.fournisseur ?? facture.values.fournisseur ?? '');
  const mode = facture.values.mode_repartition === 'proportionnel' || facture.values.mode_repartition === 'equitable' ? facture.values.mode_repartition : null;
  const pay = getPartPaymentInfo(part);
  const indexPrecedent = num(part.values.index_precedent);
  const indexActuel = num(part.values.index_actuel);
  const hasIndexes = indexPrecedent !== null && indexActuel !== null;
  return {
    fournisseur,
    fournisseurLabel: FOURNISSEUR_LABEL[fournisseur] ?? fournisseur,
    periode: String(part.values.periode ?? facture.values.mois ?? ''),
    participant: typeof part.values.label === 'string' && part.values.label ? part.values.label : 'Participant',
    mode,
    montant: num(part.values.montant_attribue) ?? 0,
    montantFacture: num(part.values.montant_facture) ?? num(facture.values.montant_total),
    statut: pay.paid ? 'payee' : 'a_payer',
    datePaiement: pay.date,
    datePaiementConnue: pay.dateKnown,
    indexPrecedent: hasIndexes ? indexPrecedent : null,
    indexActuel: hasIndexes ? indexActuel : null,
    consommation: hasIndexes ? num(part.values.consommation) : null,
    prixUnitaire: hasIndexes ? num(part.values.prix_unitaire) : null,
    nombreParticipants: num(part.values.nb_participants),
    detailFige: hasIndexes,
  };
}

/** Construit le reçu texte partageable (Share.share()) à partir des valeurs
 * figées dans les parts. N'invente rien : pour une ancienne part sans index
 * figés, aucun index n'est affiché (le 3ᵉ paramètre, hérité, n'est plus utilisé
 * — un reçu ne relit jamais les relevés actuels). */
export function buildReceiptText(facturePartagee: RecordItem, parts: RecordItem[], _releves?: RecordItem[]): string {
  void _releves;
  const fournisseur = FOURNISSEUR_LABEL[String(facturePartagee.values.fournisseur)] ?? String(facturePartagee.values.fournisseur ?? '');
  const periode = String(facturePartagee.values.mois ?? '');
  const montantTotal = typeof facturePartagee.values.montant_total === 'number' ? facturePartagee.values.montant_total : 0;
  const mode = facturePartagee.values.mode_repartition === 'proportionnel' ? 'Proportionnel (selon consommation)' : facturePartagee.values.mode_repartition === 'equitable' ? 'Équitable (parts égales)' : null;

  const lines = [`FACTURE ${fournisseur}${periode ? ` · ${periode}` : ''}`, `Total : ${montantTotal.toLocaleString('fr-FR')} FCFA`];
  if (mode) lines.push(`Mode : ${mode}`);
  lines.push('------------------------------');

  for (const part of parts) {
    const data = buildReceiptData(facturePartagee, part);
    const statut = data.statut === 'payee' ? `Payé${data.datePaiementConnue ? ` le ${data.datePaiement}` : ' (date inconnue)'}` : 'À payer';
    const detail = data.detailFige && data.indexPrecedent !== null && data.indexActuel !== null ? ` (index ${data.indexPrecedent} → ${data.indexActuel}, ${data.consommation ?? 0} unités)` : '';
    lines.push(`${data.participant} : ${data.montant.toLocaleString('fr-FR')} FCFA — ${statut}${detail}`);
  }

  return lines.join('\n');
}

// ---- Reçu individuel et résumé des paiements ----------------------------------------

const UNITE_PAR_FOURNISSEUR: Record<string, string> = { ceet: 'kWh', tde: 'm³' };

/** `AAAA-MM-JJ` → `JJ/MM/AAAA` ; « inconnue » si la date n'est pas connue (ancienne
 * part payée avant l'existence du champ) — jamais la date du jour. */
export function formatReceiptDate(day: string | null): string {
  const m = day ? /^(\d{4})-(\d{2})-(\d{2})/.exec(day) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : 'inconnue';
}

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

/** Lignes du reçu d'une part — source unique de l'affichage ET du texte partageable.
 * Lues uniquement dans les valeurs figées de la part (via `buildReceiptData`) :
 * un reçu ne change jamais si un relevé, la facture ou le nom de la personne changent
 * ensuite. Pour le partage équitable, aucun index n'est affiché. Une ancienne part
 * sans détail figé l'indique honnêtement au lieu d'inventer des index. */
export function buildReceiptLines(data: ReceiptData): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [
    { label: 'Module', value: data.fournisseurLabel },
    { label: 'Période', value: PERIODE_FORMAT.test(data.periode) ? periodeLabel(data.periode) : data.periode || '—' },
    { label: 'Participant', value: data.participant },
    { label: data.statut === 'payee' ? 'Montant payé' : 'Montant à payer', value: fcfa(data.montant) },
    { label: 'Statut', value: data.statut === 'payee' ? 'PAYÉ' : 'À PAYER' },
  ];
  if (data.statut === 'payee') lines.push({ label: 'Date du paiement', value: formatReceiptDate(data.datePaiement) });
  if (data.mode === 'proportionnel') {
    lines.push({ label: 'Méthode', value: 'Par compteur' });
    if (data.detailFige && data.indexPrecedent !== null && data.indexActuel !== null) {
      const unit = UNITE_PAR_FOURNISSEUR[fournisseurKey(data.fournisseur)] ?? 'unités';
      lines.push({ label: 'Index précédent', value: String(data.indexPrecedent) });
      lines.push({ label: 'Index actuel', value: String(data.indexActuel) });
      if (data.consommation !== null) lines.push({ label: 'Consommation', value: `${data.consommation} ${unit}` });
      if (data.prixUnitaire !== null) lines.push({ label: 'Prix unitaire', value: `${(Math.round(data.prixUnitaire * 100) / 100).toLocaleString('fr-FR')} FCFA / ${unit}` });
    } else {
      lines.push({ label: 'Détail des index', value: 'non conservé (facture antérieure)' });
    }
  } else if (data.mode === 'equitable') {
    lines.push({ label: 'Méthode', value: 'Partage équitable' });
    if (data.nombreParticipants !== null) lines.push({ label: 'Participants', value: String(data.nombreParticipants) });
  }
  if (data.montantFacture !== null) lines.push({ label: 'Facture totale', value: fcfa(data.montantFacture) });
  if (data.mode === 'equitable') lines.push({ label: 'Part', value: fcfa(data.montant) });
  return lines;
}

/** Reçu texte (partage) d'UNE part. */
export function buildPartReceiptText(facture: RecordItem, part: RecordItem): string {
  const data = buildReceiptData(facture, part);
  const title = data.statut === 'payee' ? 'REÇU DE PAIEMENT' : 'RELEVÉ DE PART (non payé)';
  return [`${title} — ${data.fournisseurLabel}`, '------------------------------', ...buildReceiptLines(data).map((l) => `${l.label} : ${l.value}`)].join('\n');
}

export interface PaymentSummary {
  total: number;
  paid: number;
  montantPaye: number;
  montantRestant: number;
}

/** « 3/5 payés » et les montants encaissés / restants, d'après l'état réel des parts. */
export function summarizePayments(parts: RecordItem[]): PaymentSummary {
  const amount = (p: RecordItem) => (typeof p.values.montant_attribue === 'number' ? p.values.montant_attribue : 0);
  const paidParts = parts.filter((p) => p.statusKey === 'payee');
  const montantPaye = paidParts.reduce((s, p) => s + amount(p), 0);
  return { total: parts.length, paid: paidParts.length, montantPaye, montantRestant: parts.reduce((s, p) => s + amount(p), 0) - montantPaye };
}

/** Parts dans l'ordre de leur création, puis (si deux parts sont créées dans la même
 * milliseconde) par nom affiché, puis par identifiant : déterministe et stable,
 * contrairement au tri par date de modification du Core qui fait remonter une part
 * dès qu'elle est payée. */
export function sortPartsForDisplay(parts: RecordItem[]): RecordItem[] {
  return [...parts].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    const byLabel = String(a.values.label ?? '').localeCompare(String(b.values.label ?? ''), 'fr');
    return byLabel !== 0 ? byLabel : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
