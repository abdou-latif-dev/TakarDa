// Participants et relevés par période des modules CEET et TDE.
//
// Modèle (voir aussi services/facturesService.ts, entité `participation`) :
//   - Une PERSONNE est un `ExternalContact` : il n'appartient à aucun module et
//     peut participer à CEET, à TDE, à Immobilier ou à un autre outil.
//   - Le lien « cette personne participe à CEET » est une PARTICIPATION
//     (fournisseur + participant_type + participant_id). Une personne dans CEET
//     et TDE a donc deux participations, jamais un contact « de CEET ».
//   - Un participant Immobilier est un contrat actif (participant_type
//     'contrat') : jamais ressaisi, et facultatif — CEET/TDE fonctionne sans
//     Immobilier (participants « autonomes » = contacts créés ici).
//   - Archiver une participation ne supprime rien : relevés et parts restent.
//   - Aucune participation n'est créée implicitement par l'existence d'un relevé.
//
// Les relevés eux-mêmes restent gérés par utilityBillingService (validation
// stricte, jamais d'écrasement) ; ce fichier ajoute la saisie par période pour
// des participants identifiés et la vue en lecture d'une période.

import { coreService } from './coreService';
import { ensureFacturesToolCached } from './facturesService';
import { ensureImmobilierTool, isValidPhone } from './immobilierService';
import {
  fournisseurKey,
  loadLockedReleveIds,
  resolveParticipantReleves,
  resolvePreviousReleve,
  saveReleve,
  UtilityBillingError,
  validateReleveInput,
  resolveParticipantLabel,
  type Participant,
  type ParticipantReleves,
} from './utilityBillingService';
import type { RecordItem } from '@/types/entities';

export type UtilityModule = 'ceet' | 'tde';
export const UTILITY_MODULES: readonly UtilityModule[] = ['ceet', 'tde'];

function assertModule(fournisseur: string): UtilityModule {
  const key = fournisseurKey(fournisseur);
  if (key !== 'ceet' && key !== 'tde') throw new UtilityBillingError('FOURNISSEUR_INVALIDE', 'Module invalide (CEET ou TDE attendu).');
  return key;
}

export interface UtilityParticipation {
  record: RecordItem;
  fournisseur: UtilityModule;
  /** Identité = type + id (ExternalContact.id ou Contrat.id). `participant.label`
   * reprend toujours `displayName` (nom ACTUEL de la personne). */
  participant: Participant;
  /** Nom actuel de la personne, résolu depuis `ExternalContact` à chaque lecture
   * (jamais une copie figée). Repli : ancien libellé enregistré, sinon « Participant inconnu ». */
  displayName: string;
  /** Téléphone de la personne s'il existe : simple repère pour distinguer des homonymes. */
  phone: string | null;
  /** ExternalContact.id de la personne concernée (pour un contrat : son locataire). */
  contactId: string | null;
  archived: boolean;
  source: 'immobilier' | 'autonome';
}

function toParticipation(record: RecordItem): UtilityParticipation | null {
  const fournisseur = fournisseurKey(record.values.fournisseur);
  const type = record.values.participant_type;
  if ((fournisseur !== 'ceet' && fournisseur !== 'tde') || (type !== 'contrat' && type !== 'contact')) return null;
  const legacyLabel = String(record.values.label ?? '');
  const id = String(record.values.participant_id ?? '');
  return {
    record,
    fournisseur,
    participant: { type, id, label: legacyLabel },
    displayName: legacyLabel,
    phone: null,
    contactId: type === 'contact' ? id : null,
    archived: record.statusKey === 'archive',
    source: record.values.source === 'immobilier' ? 'immobilier' : 'autonome',
  };
}

/** Résout le nom et le téléphone ACTUELS de chaque personne depuis `ExternalContact`
 * (un contrat Immobilier → son locataire). Aucune copie servant de source de vérité. */
async function hydrate(items: UtilityParticipation[]): Promise<UtilityParticipation[]> {
  const contacts = new Map((await coreService.getExternalContacts()).map((c) => [c.id, c]));
  const out: UtilityParticipation[] = [];
  for (const item of items) {
    let contactId = item.contactId;
    if (item.participant.type === 'contrat') {
      const contrat = await coreService.getRecord(item.participant.id!);
      contactId = typeof contrat?.values.locataire_id === 'string' ? contrat.values.locataire_id : null;
    }
    const contact = contactId ? contacts.get(contactId) : undefined;
    let name = contact?.name ?? '';
    if (!name && item.participant.type === 'contrat') name = await resolveParticipantLabel({ type: 'contrat', id: item.participant.id }, '');
    const displayName = name || item.displayName || 'Participant inconnu';
    out.push({ ...item, contactId, displayName, phone: contact?.phone ?? null, participant: { ...item.participant, label: displayName } });
  }
  return out;
}

async function loadAllParticipations(): Promise<{ toolId: string; definitionId: string; items: UtilityParticipation[] }> {
  const ents = await ensureFacturesToolCached();
  const records = await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.participationDefinition.id });
  return {
    toolId: ents.tool.id,
    definitionId: ents.participationDefinition.id,
    items: await hydrate(records.map(toParticipation).filter((p): p is UtilityParticipation => p !== null)),
  };
}

/** Participants d'un module (actifs par défaut), dans l'ordre d'ajout. */
export async function listParticipations(fournisseur: string, opts: { includeArchived?: boolean } = {}): Promise<UtilityParticipation[]> {
  const module = assertModule(fournisseur);
  const { items } = await loadAllParticipations();
  return items
    .filter((p) => p.fournisseur === module && (opts.includeArchived || !p.archived))
    .sort((a, b) => (a.record.createdAt < b.record.createdAt ? -1 : a.record.createdAt > b.record.createdAt ? 1 : 0));
}

const sameIdentity = (a: Participant, b: Participant) => a.type === b.type && a.id === b.id;
const enCours = new Set<string>();

async function createParticipation(module: UtilityModule, participant: Participant, source: 'immobilier' | 'autonome'): Promise<UtilityParticipation> {
  const key = `${module}|${participant.type}|${participant.id}`;
  if (enCours.has(key)) throw new UtilityBillingError('PARTICIPANT_DEJA_PRESENT', `${participant.label} est déjà en cours d'ajout.`);
  enCours.add(key);
  try {
    const { toolId, definitionId, items } = await loadAllParticipations();
    const existing = items.find((p) => p.fournisseur === module && sameIdentity(p.participant, participant));
    if (existing) {
      if (!existing.archived) throw new UtilityBillingError('PARTICIPANT_DEJA_PRESENT', `${participant.label} participe déjà à ${module.toUpperCase()}.`);
      // Retour d'un participant archivé : on réactive sa participation (historique intact).
      return (await hydrate([toParticipation(await coreService.updateRecord(existing.record.id, { statusKey: 'actif' }))!]))[0];
    }
    const record = await coreService.createRecord({
      toolId,
      entityDefinitionId: definitionId,
      statusKey: 'actif',
      // Pas de copie du nom : il est lu depuis la personne (ExternalContact) à l'affichage.
      values: { fournisseur: module, participant_type: participant.type, participant_id: participant.id!, source },
    });
    return (await hydrate([toParticipation(record)!]))[0];
  } finally {
    enCours.delete(key);
  }
}

/** Participant « autonome » : crée la personne (ExternalContact, sans compte
 * TakarDa) puis sa participation au module. Nom obligatoire, téléphone facultatif. */
export async function addParticipant(fournisseur: string, input: { name: string; phone?: string }): Promise<UtilityParticipation> {
  const module = assertModule(fournisseur);
  const name = input.name?.trim() ?? '';
  if (!name) throw new UtilityBillingError('PARTICIPANT_INVALIDE', 'Le nom du participant est obligatoire.');
  const phone = input.phone?.trim() ?? '';
  if (phone && !isValidPhone(phone)) throw new UtilityBillingError('PARTICIPANT_INVALIDE', 'Le numéro de téléphone n’est pas valide (8 à 15 chiffres).');
  const contact = await coreService.createExternalContact({ name, phone: phone || undefined });
  try {
    return await createParticipation(module, { type: 'contact', id: contact.id, label: contact.name }, 'autonome');
  } catch (error) {
    await coreService.deleteExternalContact(contact.id);
    throw error;
  }
}

/** Ajoute une personne déjà connue (ExternalContact existant, ex. déjà dans TDE
 * ou Immobilier) à ce module — sans la recréer ni ressaisir son nom. */
export async function addExistingContact(fournisseur: string, contactId: string): Promise<UtilityParticipation> {
  const module = assertModule(fournisseur);
  const contact = await coreService.getExternalContact(contactId);
  if (!contact) throw new UtilityBillingError('PARTICIPANT_INVALIDE', 'Personne introuvable.');
  return createParticipation(module, { type: 'contact', id: contact.id, label: contact.name }, 'autonome');
}

/** Ajoute le locataire d'un contrat Immobilier actif comme participant : aucune
 * ressaisie. Facilité facultative — le module n'en dépend pas. */
export async function addContratParticipant(fournisseur: string, contratId: string): Promise<UtilityParticipation> {
  const module = assertModule(fournisseur);
  const contrat = await coreService.getRecord(contratId);
  if (!contrat || contrat.statusKey !== 'actif') throw new UtilityBillingError('PARTICIPANT_INVALIDE', 'Contrat introuvable ou terminé.');
  const label = await resolveParticipantLabel({ type: 'contrat', id: contrat.id }, 'Locataire');
  return createParticipation(module, { type: 'contrat', id: contrat.id, label }, 'immobilier');
}

export interface ImmobilierCandidate {
  contratId: string;
  label: string;
}

/** Locataires des contrats Immobilier actifs pas encore participants du module.
 * Vide (sans rien provisionner) si l'outil Immobilier n'existe pas. */
export async function listImmobilierCandidates(fournisseur: string): Promise<ImmobilierCandidate[]> {
  const module = assertModule(fournisseur);
  const immobilier = (await coreService.getTools({ kind: 'immobilier' }))[0];
  if (!immobilier) return [];
  const { contrat } = await ensureImmobilierTool(); // l'outil existe déjà : rien n'est créé
  const [records, { items }] = await Promise.all([coreService.getRecords({ toolId: immobilier.id, entityDefinitionId: contrat.id }), loadAllParticipations()]);
  const already = new Set(items.filter((p) => p.fournisseur === module && !p.archived && p.participant.type === 'contrat').map((p) => p.participant.id));
  // Un locataire déjà participant en tant que personne (même ExternalContact) n'est pas reproposé : une seule identité.
  const alreadyPeople = new Set(items.filter((p) => p.fournisseur === module && !p.archived && p.contactId).map((p) => p.contactId));
  const contrats = records.filter((r) => r.statusKey === 'actif' && !already.has(r.id) && !alreadyPeople.has(String(r.values.locataire_id ?? '')));
  const out: ImmobilierCandidate[] = [];
  for (const c of contrats) out.push({ contratId: c.id, label: await resolveParticipantLabel({ type: 'contrat', id: c.id }, 'Locataire') });
  return out;
}

export interface KnownContact {
  id: string;
  name: string;
  phone: string | null;
}

/** Personnes déjà connues (ExternalContact) qui n'ont pas encore de participation
 * à CE module — active ou archivée (les archivées se rétablissent depuis la liste
 * « Retirés »). Un locataire déjà participant via son contrat n'est pas reproposé. */
export async function listKnownContacts(fournisseur: string): Promise<KnownContact[]> {
  const module = assertModule(fournisseur);
  const [contacts, { items }] = await Promise.all([coreService.getExternalContacts(), loadAllParticipations()]);
  const taken = new Set(items.filter((p) => p.fournisseur === module && p.contactId).map((p) => p.contactId));
  return contacts
    .filter((c) => !taken.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, phone: c.phone ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function archiveParticipation(participationId: string): Promise<void> {
  const record = await coreService.getRecord(participationId);
  if (!record || !toParticipation(record)) throw new UtilityBillingError('PARTICIPANT_INVALIDE', 'Participant introuvable.');
  await coreService.updateRecord(participationId, { statusKey: 'archive' });
}

export async function restoreParticipation(participationId: string): Promise<void> {
  const record = await coreService.getRecord(participationId);
  if (!record || !toParticipation(record)) throw new UtilityBillingError('PARTICIPANT_INVALIDE', 'Participant introuvable.');
  await coreService.updateRecord(participationId, { statusKey: 'actif' });
}

// ---- Relevés par période ----------------------------------------------------------

export interface PeriodEntry {
  participationId: string;
  index: number;
}

export interface PeriodEntryIssue {
  participationId: string;
  label: string;
  code: 'INDEX_INVALIDE' | 'RELEVE_DEJA_ENREGISTRE' | 'PARTICIPANT_INVALIDE';
  message: string;
}

/** Enregistre les index d'une période pour des participants identifiés du module.
 * Tout est vérifié AVANT la moindre écriture (index fini ≥ 0, participant actif
 * de CE module, aucun relevé déjà enregistré avec une autre valeur) : en cas de
 * problème rien n'est écrit et les problèmes sont listés par participant dans
 * `details`. Un relevé déjà enregistré avec la même valeur est ignoré. Jamais
 * d'écrasement. */
export async function saveRelevesPeriode(input: { fournisseur: string; periode: string; entries: PeriodEntry[] }): Promise<RecordItem[]> {
  const module = assertModule(input.fournisseur);
  validateReleveInput({ fournisseur: module, periode: input.periode, index: 0 });
  if (input.entries.length === 0) throw new UtilityBillingError('RELEVES_INVALIDES', 'Aucun index à enregistrer.');

  const ents = await ensureFacturesToolCached();
  const [{ items }, existing] = await Promise.all([
    loadAllParticipations(),
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.releveDefinition.id }),
  ]);
  const issues: PeriodEntryIssue[] = [];
  const toWrite: { participant: Participant; index: number }[] = [];
  for (const entry of input.entries) {
    const participation = items.find((p) => p.record.id === entry.participationId);
    const label = participation?.participant.label ?? 'Participant';
    if (!participation || participation.fournisseur !== module || participation.archived) {
      issues.push({ participationId: entry.participationId, label, code: 'PARTICIPANT_INVALIDE', message: `${label} ne participe pas (ou plus) à ${module.toUpperCase()}.` });
      continue;
    }
    if (typeof entry.index !== 'number' || !Number.isFinite(entry.index) || entry.index < 0) {
      issues.push({ participationId: entry.participationId, label, code: 'INDEX_INVALIDE', message: `Index invalide pour ${label}.` });
      continue;
    }
    const found = existing.find(
      (r) =>
        fournisseurKey(r.values.fournisseur) === module &&
        r.values.mois === input.periode &&
        r.values.participant_type === participation.participant.type &&
        r.values.participant_id === participation.participant.id,
    );
    if (found) {
      if (found.values.index !== entry.index) {
        issues.push({ participationId: entry.participationId, label, code: 'RELEVE_DEJA_ENREGISTRE', message: `Relevé déjà enregistré pour ${label} (index ${String(found.values.index)}).` });
      }
      continue; // même valeur : déjà là
    }
    toWrite.push({ participant: participation.participant, index: entry.index });
  }
  if (issues.length > 0) throw new UtilityBillingError('RELEVES_INVALIDES', 'Certains index ne peuvent pas être enregistrés : rien n’a été enregistré.', issues);

  const saved: RecordItem[] = [];
  for (const { participant, index } of toWrite) {
    saved.push(
      await saveReleve({ toolId: ents.tool.id, releveEntityDefinitionId: ents.releveDefinition.id, fournisseur: module, periode: input.periode, participant, index }),
    );
  }
  return saved;
}

export interface IndexPeriodRow {
  participation: UtilityParticipation;
  /** Relevé enregistré pour la période, ou null. */
  actuel: RecordItem | null;
  /** Relevé chronologiquement précédent, ou null. */
  precedent: RecordItem | null;
  /** Mois sans relevé entre le précédent et la période (jamais comblés). */
  missingMonths: string[];
  /** Renseignée seulement si les deux relevés existent et sont cohérents. */
  consommation: number | null;
  /** Problème de cohérence (ex. index actuel inférieur au précédent), sinon null. */
  issue: 'INDEX_ACTUEL_INFERIEUR' | null;
  /** true si le relevé actuel est utilisé par une facture validée : immuable. */
  locked: boolean;
}

/** Vue en lecture d'une période : pour chaque participant du module, ce qui est
 * réellement enregistré — rien n'est deviné ni comblé. Fonction pure. */
export function buildIndexPeriodView(participations: UtilityParticipation[], releves: RecordItem[], fournisseur: string, periode: string, lockedIds: ReadonlySet<string> = new Set()): IndexPeriodRow[] {
  return participations.map((participation) => {
    const r: ParticipantReleves = resolveParticipantReleves(participation.participant, fournisseur, periode, releves);
    // Le relevé précédent n'est jamais « résolu » sans relevé actuel : on le cherche à part pour l'affichage.
    const precedent = r.precedent ?? resolvePreviousReleve(participation.participant, fournisseur, periode, releves).releve;
    return {
      participation,
      actuel: r.actuel,
      precedent,
      missingMonths: r.ok ? r.missingMonths : r.precedent ? r.missingMonths : resolvePreviousReleve(participation.participant, fournisseur, periode, releves).missingMonths,
      consommation: r.ok ? r.consommation : null,
      issue: !r.ok && r.issue.code === 'INDEX_ACTUEL_INFERIEUR' ? 'INDEX_ACTUEL_INFERIEUR' : null,
      locked: r.actuel !== null && lockedIds.has(r.actuel.id),
    };
  });
}

/** Tout ce qu'il faut pour afficher une période : participants (noms actuels),
 * relevés enregistrés et verrous. Lecture seule. */
export async function loadIndexData(fournisseur: string): Promise<{ participations: UtilityParticipation[]; releves: RecordItem[]; locked: Set<string> }> {
  const ents = await ensureFacturesToolCached();
  const [participations, releves] = await Promise.all([
    listParticipations(fournisseur),
    coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.releveDefinition.id }),
  ]);
  return { participations, releves, locked: await loadLockedReleveIds(releves) };
}
