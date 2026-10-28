// Activités du module Immobilier. Appelées par immobilierService APRÈS la réussite
// d'une action, avec les enregistrements qu'elle vient de produire. Ce fichier ne
// contient ni règle métier ni écriture de données : il lit seulement les noms
// nécessaires à une phrase lisible. Chaque fonction est sans échec (jamais de
// rejet) pour ne jamais faire échouer une action déjà réussie.

import { coreService } from './coreService';
import { recordActivity } from './activityService';
import { periodeLabel } from './utilityBillingService';
import { formatFcfa } from '@/utils/format';
import type { RecordItem } from '@/types/entities';

const text = (value: unknown, fallback = '') => (typeof value === 'string' && value.trim() ? value.trim() : fallback);

interface ContratNames {
  locataire: string;
  logement: string;
  bien: string;
}

async function namesOfContrat(contrat: RecordItem): Promise<ContratNames> {
  const [logement, contact] = await Promise.all([
    typeof contrat.values.logement === 'string' ? coreService.getRecord(contrat.values.logement) : null,
    typeof contrat.values.locataire_id === 'string' ? coreService.getExternalContact(contrat.values.locataire_id) : null,
  ]);
  const bien = logement && typeof logement.values.bien === 'string' ? await coreService.getRecord(logement.values.bien) : null;
  return {
    locataire: contact?.name ?? 'Locataire',
    logement: text(logement?.values.nom, 'Logement'),
    bien: text(bien?.values.nom, 'Bien'),
  };
}

const describeContrat = (n: ContratNames) => `${n.locataire} — ${n.logement} (${n.bien})`;

export async function recordBienCreated(bien: RecordItem): Promise<void> {
  recordActivity({
    type: 'immobilier.bien_created',
    title: 'Bien ajouté',
    description: text(bien.values.nom, 'Bien'),
    module: 'immobilier',
    toolId: bien.toolId,
    entityType: 'bien',
    entityId: bien.id,
    dedupeKey: `bien-created:${bien.id}`,
  });
}

export async function recordBienDeleted(bienId: string, nom: string): Promise<void> {
  recordActivity({
    type: 'immobilier.bien_deleted',
    title: 'Bien supprimé',
    description: nom,
    module: 'immobilier',
    entityType: 'bien',
    entityId: bienId,
    dedupeKey: `bien-deleted:${bienId}`,
  });
}

export async function recordLogementCreated(logement: RecordItem): Promise<void> {
  try {
    const bien = typeof logement.values.bien === 'string' ? await coreService.getRecord(logement.values.bien) : null;
    recordActivity({
      type: 'immobilier.logement_created',
      title: 'Logement ajouté',
      description: `${text(logement.values.nom, 'Logement')} (${text(bien?.values.nom, 'Bien')})`,
      module: 'immobilier',
      toolId: logement.toolId,
      entityType: 'logement',
      entityId: logement.id,
      dedupeKey: `logement-created:${logement.id}`,
    });
  } catch {
    /* journal indisponible : l'action métier reste réussie */
  }
}

export async function recordContratCreated(contrat: RecordItem, names: ContratNames): Promise<void> {
  recordActivity({
    type: 'immobilier.contrat_created',
    title: 'Contrat créé',
    description: describeContrat(names),
    module: 'immobilier',
    toolId: contrat.toolId,
    entityType: 'contrat',
    entityId: contrat.id,
    dedupeKey: `contrat-created:${contrat.id}`,
  });
}

export async function recordContratEnded(contrat: RecordItem): Promise<void> {
  try {
    recordActivity({
      type: 'immobilier.contrat_ended',
      title: 'Contrat terminé',
      description: describeContrat(await namesOfContrat(contrat)),
      module: 'immobilier',
      toolId: contrat.toolId,
      entityType: 'contrat',
      entityId: contrat.id,
      dedupeKey: `contrat-ended:${contrat.id}`,
    });
  } catch {
    /* journal indisponible : l'action métier reste réussie */
  }
}

export async function recordLoyerPaid(paiement: RecordItem, contrat: RecordItem): Promise<void> {
  try {
    const names = await namesOfContrat(contrat);
    const mois = text(paiement.values.mois);
    const amount = typeof paiement.values.montant === 'number' ? paiement.values.montant : undefined;
    recordActivity({
      type: 'immobilier.loyer_paid',
      title: 'Loyer enregistré',
      description: `${names.locataire} — ${names.logement}${mois ? ` · ${periodeLabel(mois)}` : ''}${amount !== undefined ? ` · ${formatFcfa(amount)}` : ''}`,
      module: 'immobilier',
      toolId: paiement.toolId,
      entityType: 'paiement',
      entityId: paiement.id,
      amount,
      dedupeKey: `loyer-paid:${paiement.id}`,
    });
  } catch {
    /* journal indisponible : l'action métier reste réussie */
  }
}

export type { ContratNames };
