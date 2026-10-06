// Rattachement des anciens relevés « saisie libre » à une personne.
//
// L'ancien écran « Cahier d'index » enregistrait des relevés sans identité réelle
// (participant_type 'manuel', participant_id null, nom tapé dans `compteur`). Le
// nouveau flux CEET/TDE n'utilise que des relevés rattachés à une personne
// (ExternalContact) ou à un contrat. Ce service propose une action EXPLICITE de
// rattachement : jamais automatique, jamais par simple ressemblance de nom.
//
// Garde-fous :
//  - tout ou rien par groupe de relevés (même nom) : rien n'est modifié si un seul
//    problème est détecté ;
//  - un relevé utilisé par une facture validée n'est JAMAIS rattaché : changer son
//    identité ferait perdre le verrouillage des anciennes parts, qui le retrouvent
//    par identité ;
//  - aucun écrasement : si la personne a déjà un relevé pour une même période, le
//    rattachement est refusé et les périodes en conflit sont listées ;
//  - les relevés gardent leur identifiant ; le Core conserve l'historique de la
//    modification ; rien n'est supprimé ni inventé.

import { coreService } from './coreService';
import { ensureFacturesToolCached } from './facturesService';
import { normalizeName } from './immobilierService';
import { fournisseurKey, loadLockedReleveIds, UtilityBillingError } from './utilityBillingService';
import { addExistingContact, addParticipant, listParticipations, type UtilityModule, type UtilityParticipation } from './utilityParticipantsService';
import type { RecordItem } from '@/types/entities';

export interface LegacyGroup {
  /** Clé de regroupement : nom normalisé (sans casse ni accents). */
  key: string;
  /** Nom tel qu'il avait été tapé (celui du relevé le plus récent du groupe). */
  label: string;
  releves: RecordItem[];
  /** Périodes concernées, de la plus ancienne à la plus récente. */
  periodes: string[];
  /** Relevés du groupe déjà utilisés par une facture validée. */
  lockedCount: number;
  /** Périodes saisies deux fois dans le groupe (anciennes données) : le groupe n'est pas rattachable. */
  doublons: string[];
}

const isLegacyManual = (r: RecordItem, module: UtilityModule) =>
  fournisseurKey(r.values.fournisseur) === module && r.values.participant_type === 'manuel' && typeof r.values.compteur === 'string' && r.values.compteur.trim() !== '' && typeof r.values.mois === 'string';

/** Regroupe, pour un module, les anciens relevés « saisie libre » par nom. Fonction pure. */
export function groupLegacyReleves(releves: RecordItem[], module: UtilityModule, lockedIds: ReadonlySet<string> = new Set()): LegacyGroup[] {
  const groups = new Map<string, RecordItem[]>();
  for (const r of releves.filter((x) => isLegacyManual(x, module))) {
    const key = normalizeName(String(r.values.compteur));
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => String(a.values.mois).localeCompare(String(b.values.mois)));
      return {
        key,
        label: String(sorted[sorted.length - 1].values.compteur).trim(),
        releves: sorted,
        periodes: sorted.map((r) => String(r.values.mois)),
        lockedCount: sorted.filter((r) => lockedIds.has(r.id)).length,
        doublons: [...new Set(sorted.map((r) => String(r.values.mois)).filter((p, i, all) => all.indexOf(p) !== i))],
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

/** Anciens relevés « saisie libre » d'un module, groupés, avec le nombre de relevés
 * verrouillés (donc non rattachables) de chaque groupe. */
export async function listLegacyGroups(fournisseur: string): Promise<LegacyGroup[]> {
  const module = fournisseurKey(fournisseur) as UtilityModule;
  const ents = await ensureFacturesToolCached();
  const releves = await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.releveDefinition.id });
  const legacy = releves.filter((r) => isLegacyManual(r, module));
  if (legacy.length === 0) return [];
  return groupLegacyReleves(releves, module, await loadLockedReleveIds(legacy));
}

export type AttachTarget =
  | { type: 'participation'; participationId: string }
  | { type: 'contact'; contactId: string }
  | { type: 'nouvelle' };

const rattachementsEnCours = new Set<string>();

/** Rattache TOUS les relevés d'un groupe (même nom) à une personne, en conservant leurs
 * identifiants. Cibles : un participant du module, une personne déjà connue (sa
 * participation est créée si besoin, sans doublon de personne) ou une nouvelle personne
 * portant le nom du groupe. Retourne le nombre de relevés rattachés. */
export async function attachLegacyGroup(input: { fournisseur: string; groupKey: string; target: AttachTarget }): Promise<{ attached: number; participation: UtilityParticipation }> {
  const module = fournisseurKey(input.fournisseur);
  if (module !== 'ceet' && module !== 'tde') throw new UtilityBillingError('FOURNISSEUR_INVALIDE', 'Module invalide (CEET ou TDE attendu).');
  // Un seul rattachement à la fois par module : deux groupes visant la même personne pourraient
  // sinon créer, ensemble, deux relevés pour une même période.
  const lockKey = module;
  if (rattachementsEnCours.has(lockKey)) throw new UtilityBillingError('RELEVES_INVALIDES', 'Un rattachement est déjà en cours. Patientez un instant.');
  rattachementsEnCours.add(lockKey);
  try {
    const ents = await ensureFacturesToolCached();
    const releves = await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.releveDefinition.id });
    const locked = await loadLockedReleveIds(releves.filter((r) => isLegacyManual(r, module)));
    const group = groupLegacyReleves(releves, module, locked).find((g) => g.key === input.groupKey);
    if (!group) throw new UtilityBillingError('RELEVE_INTROUVABLE', 'Ces relevés n’existent plus ou ont déjà été rattachés. Actualisez l’écran.');
    if (group.lockedCount > 0) {
      throw new UtilityBillingError(
        'RELEVE_UTILISE',
        `${group.lockedCount === group.releves.length ? 'Ces relevés ont' : `${group.lockedCount} de ces relevés ont`} déjà été utilisé${group.lockedCount > 1 ? 's' : ''} dans une facture validée : ils ne peuvent plus être modifiés ni rattachés.`,
      );
    }

    if (group.doublons.length > 0) {
      throw new UtilityBillingError('RELEVES_INVALIDES', `Ces relevés contiennent deux saisies pour ${group.doublons.join(', ')} : rattachement refusé, rien n’a été modifié.`);
    }

    // Résolution de la cible SANS rien créer tant que les contrôles ne sont pas passés.
    const all = await listParticipations(module, { includeArchived: true });
    let participation: UtilityParticipation | undefined;
    if (input.target.type === 'participation') {
      const id = input.target.participationId;
      participation = all.find((p) => p.record.id === id);
      if (!participation || participation.archived) throw new UtilityBillingError('PARTICIPANT_INVALIDE', 'Ce participant n’existe pas (ou plus) dans ce module.');
    } else if (input.target.type === 'contact') {
      const contactId = input.target.contactId;
      if (!(await coreService.getExternalContact(contactId))) throw new UtilityBillingError('PARTICIPANT_INVALIDE', 'Personne introuvable.');
      participation = all.find((p) => p.participant.type === 'contact' && p.participant.id === contactId);
    }

    // Aucun écrasement : la cible ne doit pas avoir déjà un relevé pour une même période.
    if (participation) {
      const target = participation.participant;
      const existing = new Set(
        releves.filter((r) => fournisseurKey(r.values.fournisseur) === module && r.values.participant_type === target.type && r.values.participant_id === target.id).map((r) => String(r.values.mois)),
      );
      const conflits = group.periodes.filter((p) => existing.has(p));
      if (conflits.length > 0) {
        throw new UtilityBillingError('RELEVES_INVALIDES', `${participation.displayName} a déjà un relevé pour ${conflits.join(', ')} : rattachement refusé, rien n’a été modifié.`);
      }
    }

    // Création de la participation seulement maintenant (une seule personne, jamais dupliquée).
    if (!participation || participation.archived) {
      if (input.target.type === 'contact') participation = await addExistingContact(module, input.target.contactId);
      else if (input.target.type === 'nouvelle') participation = await addParticipant(module, { name: group.label });
    }
    if (!participation) throw new UtilityBillingError('PARTICIPANT_INVALIDE', 'Participant introuvable.');

    // Tout ou rien : si une mise à jour échoue, les relevés déjà rattachés retrouvent leur état d'origine.
    // (Le Core renvoie des objets partagés que `updateRecord` modifie sur place : l'état d'origine
    // est donc copié AVANT la première mise à jour.)
    const identity = participation.participant;
    const originals = group.releves.map((r) => ({ id: r.id, type: r.values.participant_type, pid: r.values.participant_id ?? null, compteur: r.values.compteur ?? null }));
    const done: typeof originals = [];
    try {
      for (const o of originals) {
        await coreService.updateRecord(o.id, { values: { participant_type: identity.type, participant_id: identity.id!, compteur: participation.displayName } });
        done.push(o);
      }
    } catch (error) {
      for (const o of done) {
        await coreService.updateRecord(o.id, { values: { participant_type: o.type, participant_id: o.pid, compteur: o.compteur } });
      }
      throw error;
    }
    return { attached: group.releves.length, participation };
  } finally {
    rattachementsEnCours.delete(lockKey);
  }
}
