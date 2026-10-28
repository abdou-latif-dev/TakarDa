// Journal d'activités : ce que l'utilisateur veut retrouver (une tontine créée, un
// loyer enregistré, une facture validée…), pas ce qu'il a touché à l'écran.
//
// RÈGLES
//  - Les services MÉTIER appellent recordActivity(), jamais les écrans, et seulement
//    APRÈS la réussite de l'action : action échouée ⇒ aucune activité.
//  - recordActivity() ne lève jamais d'erreur : une panne du journal ne doit pas
//    annuler ni faire échouer une action métier déjà réussie.
//  - Pas de consultation, navigation, filtre, recherche ni ouverture d'écran.
//  - ActivityEvent (ici) est le journal visible ; CoreEvent (coreService) reste la trace
//    technique par enregistrement. Le Core n'enregistre pas d'activité : aucun doublon.
//  - Stockage : le tableau `activityEvents` de db.ts, déjà persisté par persistence.ts.

import { activityEvents, delay, genId, records, tools } from './db';
import { getActiveCloudUid, getCloudStampUid, hiddenRecordIds } from './cloudVisibility';
import { getCurrentUserId } from './identityService';
import { assertModuleAvailable, isActivityLocked, isMultiAccountContext } from './moduleLock';
import { formatDayGroup } from '@/utils/format';
import type { ActivityEvent, ActivityModule, ActivityType } from '@/types/entities';

export interface RecordActivityInput {
  type: ActivityType;
  title: string;
  description?: string;
  /** Si absent, déduit du type (voir activityModule). */
  module?: ActivityModule;
  toolId?: string;
  entityType?: string;
  entityId?: string;
  groupId?: string;
  userName?: string;
  amount?: number;
  /** Date de l'action ; maintenant par défaut. */
  at?: string;
  /** Une même clé ne crée qu'une activité (double appel, écran remonté…). */
  dedupeKey?: string;
}

/** Outil (Mes Outils) du module, s'il est installé : les activités Tontine, CEET, TDE et
 * Immobilier portent ainsi le toolId de leur outil sans que les services l'aient à connaître. */
function toolIdOfModule(module: ActivityModule | null): string | undefined {
  if (!module || module === 'formulaires') return undefined;
  const userId = getCurrentUserId();
  return tools.find((t) => t.kind === module && t.ownerId === userId)?.id;
}

/** Enregistre une activité et la renvoie (ou renvoie celle qui existe déjà pour la
 * même `dedupeKey`). Renvoie null — sans lever — si l'enregistrement a échoué. */
export function recordActivity(input: RecordActivityInput): ActivityEvent | null {
  try {
    if (input.dedupeKey) {
      const existing = activityEvents.find((e) => e.dedupeKey === input.dedupeKey);
      if (existing) return existing;
    }
    const event: ActivityEvent = {
      id: genId('a'),
      type: input.type,
      title: input.title,
      description: input.description ?? '',
      at: input.at ?? new Date().toISOString(),
      userId: getCurrentUserId(),
    };
    const optional = {
      module: input.module,
      toolId: input.toolId ?? toolIdOfModule(activityModule({ type: input.type, module: input.module })),
      entityType: input.entityType,
      entityId: input.entityId,
      groupId: input.groupId,
      userName: input.userName,
      amount: input.amount,
      dedupeKey: input.dedupeKey,
    };
    for (const [key, value] of Object.entries(optional)) {
      if (value !== undefined) (event as unknown as Record<string, unknown>)[key] = value;
    }
    const stamp = getCloudStampUid(); // synchronisation activée : l'activité appartient à ce compte (masquée pour les autres)
    if (stamp) event.cloudOwnerUid = stamp;
    activityEvents.unshift(event);
    return event;
  } catch {
    return null;
  }
}

// ---- Lecture (fonctions pures, testables sans React Native) -------------------

/** Plus récente d'abord ; à date égale, l'ordre d'enregistrement est conservé. */
export function sortActivities(events: readonly ActivityEvent[]): ActivityEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (a.event.at === b.event.at ? a.index - b.index : a.event.at < b.event.at ? 1 : -1))
    .map((entry) => entry.event);
}

const LEGACY_TONTINE: ReadonlySet<string> = new Set([
  'group_created', 'group_updated', 'member_joined', 'member_invited', 'contribution_added',
  'order_updated', 'cycle_completed', 'tontine_deleted', 'activity_created',
]);
const LEGACY_FORMS: ReadonlySet<string> = new Set([
  'submission_validated', 'submission_rejected', 'form_submitted', 'form_created', 'form_updated', 'form_deleted', 'qr_scanned',
]);

/** Module d'une activité : celui qui est enregistré, sinon déduit du type (anciennes lignes). */
export function activityModule(event: Pick<ActivityEvent, 'type' | 'module'>): ActivityModule | null {
  if (event.module) return event.module;
  if (LEGACY_TONTINE.has(event.type)) return 'tontine';
  if (LEGACY_FORMS.has(event.type)) return 'formulaires';
  if (event.type.startsWith('immobilier.')) return 'immobilier';
  return null;
}

/** Module d'une facture partagée à partir de son fournisseur : CEET et TDE ont leur
 * espace ; tout autre fournisseur n'existe que dans le parcours Immobilier. */
export function moduleOfFournisseur(fournisseur: unknown): ActivityModule {
  const key = typeof fournisseur === 'string' ? fournisseur.trim().toLowerCase() : '';
  return key === 'ceet' || key === 'tde' ? key : 'immobilier';
}

export interface ActivityQuery {
  limit?: number;
  module?: ActivityModule;
  toolId?: string;
}

export function selectRecentActivities(events: readonly ActivityEvent[], query: ActivityQuery = {}): ActivityEvent[] {
  const filtered = events.filter((e) => (!query.module || activityModule(e) === query.module) && (!query.toolId || e.toolId === query.toolId));
  const sorted = sortActivities(filtered);
  return typeof query.limit === 'number' ? sorted.slice(0, Math.max(0, query.limit)) : sorted;
}

/**
 * Activités visibles pour le compte actif : jamais celles d'un autre compte (marque `cloudOwnerUid`), ni celles d'un enregistrement masqué
 * (nom du locataire, montants…). Les activités locales historiques restent visibles pour tous, comme avant.
 */
export function visibleActivities(events: readonly ActivityEvent[]): ActivityEvent[] {
  const uid = getActiveCloudUid();
  const hidden = hiddenRecordIds(records, uid);
  const multi = isMultiAccountContext(); // une seule fois pour toute la liste
  // en contexte multi-compte, les activités des modules sans propriétaire (tontines, formulaires, CEET/TDE) sont masquées (voir moduleLock.ts)
  return events.filter((e) => !(e.cloudOwnerUid && e.cloudOwnerUid !== uid) && !(e.entityId && hidden.has(e.entityId)) && !isActivityLocked(e, multi));
}

export function getRecentActivities(query: ActivityQuery = {}): ActivityEvent[] {
  return selectRecentActivities(visibleActivities(activityEvents), query);
}

export interface ActivityDayGroup {
  /** « Aujourd'hui », « Hier » ou « 12 octobre ». */
  label: string;
  events: ActivityEvent[];
}

/** Regroupe des activités déjà triées par jour, en gardant l'ordre. */
export function groupActivitiesByDay(events: readonly ActivityEvent[]): ActivityDayGroup[] {
  const groups: ActivityDayGroup[] = [];
  for (const event of events) {
    const label = formatDayGroup(event.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.events.push(event);
    else groups.push({ label, events: [event] });
  }
  return groups;
}

export const activityService = {
  async list(filterGroupId?: string): Promise<ActivityEvent[]> {
    await delay();
    const sorted = sortActivities(visibleActivities(activityEvents));
    return filterGroupId ? sorted.filter((e) => e.groupId === filterGroupId) : sorted;
  },

  async createEvent(input: { groupId: string; title: string; description: string }): Promise<ActivityEvent> {
    assertModuleAvailable('tontine'); // les groupes (tontines) sont indisponibles en contexte multi-compte
    await delay();
    const event = recordActivity({ type: 'activity_created', title: input.title, description: input.description, groupId: input.groupId });
    if (!event) throw new Error("Impossible d'enregistrer l'activité.");
    return event;
  },
};
