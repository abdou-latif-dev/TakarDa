// Contrats d'Immobilier présentés au propriétaire pour lier un accès de locataire (F3b). Lecture locale seule, sans réseau.

import { coreService } from './coreService';
import { contratLabel, ensureImmobilierTool, loadImmobilierLookup } from './immobilierService';

export interface ContractChoice {
  id: string;
  /** Nom du locataire (sinon du logement). */
  label: string;
  statusKey: string | null;
  /** Jour de fin (AAAA-MM-JJ) d'un contrat terminé ; null pour un contrat en cours. Point de départ des 90 jours d'accès. */
  endDay: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Jour de fin d'un contrat : sa date de sortie si elle est renseignée, sinon (contrat terminé sans date) le jour de sa dernière mise à jour ; null s'il est en cours. */
export function contractEndDay(contrat: { statusKey?: string | null; updatedAt?: string; values: Record<string, unknown> }): string | null {
  if (contrat.statusKey === 'actif') return null;
  const exit = contrat.values.date_sortie;
  if (typeof exit === 'string' && DAY.test(exit.slice(0, 10))) return exit.slice(0, 10);
  if (contrat.statusKey === 'termine' && typeof contrat.updatedAt === 'string' && DAY.test(contrat.updatedAt.slice(0, 10))) return contrat.updatedAt.slice(0, 10);
  return null;
}

/** Tous les contrats (en cours d'abord), avec leur libellé et leur jour de fin. */
export async function loadContractChoices(): Promise<ContractChoice[]> {
  const ents = await ensureImmobilierTool();
  const [contrats, lookup] = await Promise.all([coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.contrat.id }), loadImmobilierLookup()]);
  return contrats
    .map((c) => ({ id: c.id, label: contratLabel(c, lookup), statusKey: c.statusKey ?? null, endDay: contractEndDay(c) }))
    .sort((a, b) => Number(b.statusKey === 'actif') - Number(a.statusKey === 'actif') || a.label.localeCompare(b.label));
}
