// Flux de la vue du locataire — F3c : lecture de MA vue (locataire) et publication de la vue d'un locataire (propriétaire). Logique pure au-dessus du port ;
// aucun SDK, aucun réseau direct. Le locataire n'écrit jamais rien dans le cloud ; il ne lit que sa propre vue, tant que son accès est actif.

import { explain, checkMyAccess, type AccessStatus, type FlowDeps, type FlowResult } from './moduleFlows';
import { isTenantAccessActive, validateTenantItem, type MemberDoc } from './model';
import { syncTenantView, type DesiredItem, type PublishReport } from './tenantViewPublisher';
import { loadPublishedState, savePublishedState, type ReceivedItem, type TenantViewCopy } from './tenantViewLocal';

// ---- Locataire : lire MA vue ---------------------------------------------------------------------------------------------------------

export interface ViewFetch {
  status: AccessStatus;
  /** La copie lue ; null quand l'accès n'est pas actif (rien n'est lu). */
  copy: TenantViewCopy | null;
  /** Éléments reçus mais ignorés car invalides (jamais affichés). */
  skipped: number;
}

/** Lit MA vue dans le cloud. Si mon accès n'est pas actif (retiré, quitté, expiré, en attente…), rien n'est lu et l'état est rendu pour que l'appelant retire ma copie locale. */
export async function fetchMyView(deps: FlowDeps, moduleId: string): Promise<FlowResult<ViewFetch>> {
  const access = await checkMyAccess(deps, moduleId);
  if (!access.ok) return access;
  if (access.value.status !== 'active') return { ok: true, value: { status: access.value.status, copy: null, skipped: 0 } };
  try {
    const records = await deps.backend.listTenantItems(moduleId, deps.uid);
    const items: Record<string, ReceivedItem> = {};
    let skipped = 0;
    for (const { id, doc } of records) {
      if (validateTenantItem(doc).length > 0) {
        skipped += 1;
        continue;
      }
      items[id] = { kind: doc.kind, body: doc.body, updatedAt: doc.updatedAt };
    }
    const at = (deps.now ?? (() => new Date()))().toISOString();
    return { ok: true, value: { status: 'active', copy: { moduleId, fetchedAt: at, accessUntil: access.value.accessUntil, moduleName: access.value.moduleName, items }, skipped } };
  } catch (error) {
    return explain(error, 'Votre espace n’a pas pu être lu : votre accès a peut-être changé. Actualisez.');
  }
}

/** La copie locale peut-elle encore être montrée ? Au-delà de la fin d'accès connue, non : elle est à retirer (même hors ligne, à l'heure de l'appareil). */
export function copyGate(copy: Pick<TenantViewCopy, 'accessUntil'>, now: Date): 'ok' | 'expired' {
  if (copy.accessUntil === null) return 'ok';
  const until = Date.parse(copy.accessUntil);
  return Number.isFinite(until) && now.getTime() < until ? 'ok' : 'expired';
}

// ---- Propriétaire : publier la vue d'un locataire ------------------------------------------------------------------------------------

/** Ce que la vue d'un membre doit contenir MAINTENANT : sa projection s'il a un accès actif et un contrat, sinon rien (la vue est retirée). */
export function wantsView(member: Pick<MemberDoc, 'role' | 'state' | 'accessUntil' | 'contractId'>, now: Date): boolean {
  return isTenantAccessActive(member, now) && !!member.contractId;
}

export async function publishMemberView(
  deps: FlowDeps,
  moduleId: string,
  member: MemberDoc,
  buildView: (contractId: string) => Promise<DesiredItem[] | null>,
): Promise<FlowResult<PublishReport>> {
  const now = deps.now ?? (() => new Date());
  try {
    let desired: DesiredItem[] = [];
    if (wantsView(member, now()) && member.contractId) desired = (await buildView(member.contractId)) ?? []; // contrat disparu : vue vidée
    const previous = await loadPublishedState(moduleId, member.uid);
    const report = await syncTenantView({ backend: deps.backend, now }, moduleId, member.uid, desired, previous, (state) => savePublishedState(moduleId, member.uid, state));
    return { ok: true, value: report };
  } catch (error) {
    return explain(error, 'Publication refusée : vérifiez que vous êtes bien le propriétaire de cet espace.');
  }
}
