// Projection des données d'un contrat en VUE DU LOCATAIRE — F3c. Côté PROPRIÉTAIRE, lecture locale seule, aucune écriture, aucun réseau.
//
// Le locataire ne reçoit jamais les enregistrements du propriétaire : il reçoit des éléments de vue construits ici, avec UNIQUEMENT les champs que les
// décisions autorisent (section 4.1) et celles que le propriétaire du projet a rendues visibles (points 4.3 : nom du bien, mode de paiement, e-mail et note du
// contact, nom du propriétaire, loyer de référence). Restent PRIVÉS, donc absents : notes libres du contrat et des paiements, raisons de correction ou
// d'annulation, champs personnalisés, dépenses, statistiques, autres locataires et contrats, journal d'activité brut. Les règles candidates refusent de toute
// façon un champ hors liste (TENANT_BODY_FIELDS).
//
// Les paiements sont ceux « effectifs » (corrections appliquées) : un paiement annulé est présenté « rejeté », sans motif.

import type { ExternalContact, RecordItem } from '@/types/entities';
import { CURRENT_USER_ID, users } from './db';
import { buildPaiementTimeline, loadContratDetail, toIsoDay } from './immobilierService';
import { arrearsAtPayment, receiptReference } from './rentReceiptService';
import { coveragesOf, getAdvanceStatus } from './rentAdvanceService';
import { contractEndDay } from './sharedModuleContracts';
import type { TenantItemKind } from './sharedModules/model';

export interface BuiltTenantItem {
  id: string;
  kind: TenantItemKind;
  body: Record<string, unknown>;
}

export interface TenantViewSource {
  contrat: RecordItem;
  logement: RecordItem | null;
  bien: RecordItem | null;
  locataire: ExternalContact | null;
  /** Paiements EFFECTIFS de ce contrat (tous statuts). */
  paiements: RecordItem[];
  /** Nom du propriétaire (profil local) ; absent s'il n'est pas renseigné. */
  ownerName?: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}/;
const day = (value: unknown): string | null => (typeof value === 'string' && DAY.test(value) ? value.slice(0, 10) : null);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const amount = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const safeId = (raw: string): string => raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);

/** Retire les valeurs absentes : un champ sans valeur n'existe pas dans la vue. */
const clean = (body: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null && v !== undefined));

const PAYMENT_STATUSES = new Set(['paye', 'en_attente', 'rejete', 'couvert']);

/** Éléments de la vue d'UN locataire pour son contrat. Pur : mêmes entrées, mêmes éléments (l'identifiant de chaque élément est stable). */
export function buildTenantView(source: TenantViewSource, now: Date): BuiltTenantItem[] {
  const { contrat, logement, bien, locataire } = source;
  const mine = source.paiements.filter((p) => p.values.contrat === contrat.id);
  const items: BuiltTenantItem[] = [];
  const v = contrat.values;

  items.push({
    id: 'contrat',
    kind: 'contrat',
    body: clean({
      statut: contrat.statusKey ?? null,
      locataireNom: text(locataire?.name) ?? text(v.locataire_nom),
      locataireTelephone: text(locataire?.phone) ?? text(v.locataire_telephone),
      locataireEmail: text(locataire?.email),
      locataireNote: text(locataire?.note),
      proprietaireNom: text(source.ownerName),
      loyerMensuel: amount(v.loyer_mensuel),
      dateEntree: day(v.date_entree),
      dateSortie: day(v.date_sortie),
      jourEcheance: amount(v.jour_echeance),
      dernierLoyerPaye: text(v.dernier_loyer_paye),
      caution: amount(v.caution),
      avance: amount(v.avance),
    }),
  });

  if (logement) {
    items.push({
      id: 'logement',
      kind: 'logement',
      body: clean({
        nom: text(logement.values.nom),
        type: text(logement.values.type),
        cuisine: text(logement.values.cuisine),
        wc: text(logement.values.wc),
        // l'adresse du bien qui contient SON logement (décision 1.3), son nom (point 4.3) et le loyer de référence du logement (point 4.3)
        adresse: text(bien?.values.adresse),
        nomBien: text(bien?.values.nom),
        loyerReference: amount(logement.values.loyer_reference),
      }),
    });
  }

  for (const p of mine) {
    const statut = p.statusKey ?? '';
    const mois = text(p.values.mois);
    if (!PAYMENT_STATUSES.has(statut) || !mois) continue;
    const paid = statut === 'paye';
    items.push({
      id: `paiement_${safeId(p.id)}`,
      kind: 'paiement',
      body: clean({
        mois,
        montant: amount(p.values.montant),
        statut,
        dateValidation: day(p.values.date_validation),
        modePaiement: text(p.values.mode_paiement),
        reference: paid ? receiptReference(p.id) : null,
        retardsALaDate: paid ? arrearsAtPayment(contrat, p, mine) : null,
      }),
    });
  }

  const advance = getAdvanceStatus(contrat, mine);
  if (advance.avance > 0 || advance.coveredMonths > 0) {
    items.push({
      id: 'avance',
      kind: 'avance',
      body: { montant: advance.avance, consomme: advance.consumed, disponible: advance.balance, moisCouverts: coveragesOf(contrat.id, mine).map((c) => String(c.values.mois)).sort() },
    });
  }

  // Retards : seulement si le calcul est FIABLE et explicable (contrat en cours, loyer, date d'entrée et jour d'échéance connus) ; sinon rien n'est affirmé.
  const reliable = contrat.statusKey === 'actif' && (amount(v.loyer_mensuel) ?? 0) > 0 && day(v.date_entree) !== null && amount(v.jour_echeance) !== null;
  const lateMonths = reliable
    ? buildPaiementTimeline(contrat, mine, now)
        .filter((r) => r.status === 'en_retard')
        .map((r) => r.mois)
        .sort()
    : [];
  items.push({ id: 'retards', kind: 'retards', body: clean({ fiable: reliable, mois: lateMonths, jourEcheance: reliable ? amount(v.jour_echeance) : null, calculeLe: toIsoDay(now) }) });

  // Historique : liste d'événements AUTORISÉS construite à partir des faits (jamais les résumés bruts du journal d'activité, qui peuvent contenir des notes).
  const created = day(v.date_entree) ?? day(contrat.createdAt);
  if (created) items.push({ id: 'evt_contrat_cree', kind: 'evenement', body: { type: 'contrat_cree', date: created } });
  for (const p of mine) {
    const date = day(p.values.date_validation) ?? day(p.createdAt);
    if (p.statusKey === 'paye' && date) items.push({ id: `evt_loyer_${safeId(p.id)}`, kind: 'evenement', body: clean({ type: 'loyer_enregistre', date, mois: text(p.values.mois) }) });
  }
  const ended = endedDay(contrat);
  if (ended) items.push({ id: 'evt_contrat_termine', kind: 'evenement', body: { type: 'contrat_termine', date: ended } });

  return items;
}

const endedDay = (contrat: RecordItem): string | null => (contrat.statusKey === 'actif' ? null : contractEndDay(contrat));

/** Nom du propriétaire : celui du profil local, sauf le nom par défaut (« Utilisateur »), qui n'identifie personne. */
export function localOwnerName(): string | null {
  const name = users.find((u) => u.id === CURRENT_USER_ID)?.name?.trim();
  return name && name !== 'Utilisateur' ? name : null;
}

/** Charge les données locales du contrat (effectives) et construit sa vue. Null si le contrat n'existe plus. Lecture seule. */
export async function buildTenantViewForContract(contractId: string, now: Date = new Date(), ownerName: string | null = localOwnerName()): Promise<BuiltTenantItem[] | null> {
  const detail = await loadContratDetail(contractId);
  if (!detail) return null;
  return buildTenantView({ contrat: detail.contrat, logement: detail.logement, bien: detail.bien, locataire: detail.locataire, paiements: detail.paiements, ownerName }, now);
}
