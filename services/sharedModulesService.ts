// Façade des espaces partagés pour l'interface — F3b. Seul point d'entrée des écrans : applique les gardes (drapeau cloud, espace personnel, adresse e-mail
// vérifiée, compte actif), compose le cloud À LA DEMANDE (aucun import statique de Firebase), tient le carnet local et délègue la logique aux flux.
// Entièrement derrière CLOUD_ACCOUNT_ENABLED (fermé) : sans le drapeau, chaque fonction refuse et rien n'est chargé ni appelé.
//
// Rien ici n'envoie de données d'Immobilier : créer un espace, demander l'accès, approuver ou révoquer n'écrivent que des fiches de gestion d'accès.
// F3c : le propriétaire publie la VUE de chaque locataire (projection sans champ privé : tenantViewBuilder.ts) ; le locataire lit SA vue, la garde en copie
// locale à part et la perd dès que son accès n'est plus actif. Un locataire n'écrit jamais rien dans le cloud.

import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { AUTH_MESSAGES } from './cloudAuthErrors';
import { isEmailVerified } from './accountVerification';
import { workspaceId } from './persistence';
import { getSyncAccount } from './sync/syncAccount';
import { loadContractChoices, type ContractChoice } from './sharedModuleContracts';
import { buildTenantViewForContract } from './tenantViewBuilder';
import { ModulesError } from './sharedModules/modulesPort';
import { toViewModel, type TenantViewModel } from './sharedModules/tenantViewModel';
import { loadViewCopy, purgePublishedForModule, purgeViewCopy, saveViewCopy, type TenantViewCopy } from './sharedModules/tenantViewLocal';
import { eraseOwnedModules, type ModuleErasureBackend } from './firebase/moduleErasure';
import * as viewFlows from './sharedModules/tenantViewFlows';
import type { DesiredItem } from './sharedModules/tenantViewPublisher';
import type { ModulesBackend } from './sharedModules/modulesPort';
import type { MemberDoc } from './sharedModules/model';
import * as flows from './sharedModules/moduleFlows';
import * as local from './sharedModules/localModules';
import type { AccessStatus, FlowDeps, FlowResult, OwnerView } from './sharedModules/moduleFlows';

export type { ContractChoice, FlowResult, OwnerView, TenantViewModel, TenantViewCopy };

/** Ce que l'écran du locataire peut montrer : rien encore, un accès terminé, ma vue, ou « indisponible » (accès non actif : la copie locale est retirée). */
export type ViewState =
  | { state: 'none' }
  | { state: 'expired' }
  | { state: 'ok'; copy: TenantViewCopy; model: TenantViewModel }
  | { state: 'unavailable'; status: AccessStatus };

export interface PublishViewsReport {
  members: number;
  written: number;
  deleted: number;
  failed: number;
}

export interface SharedModulesDeps {
  enabled?: () => boolean;
  backend?: (uid: string) => ModulesBackend;
  /** Port d'effacement d'un espace (défaut : composition de production, chargée à la demande). */
  erasure?: (uid: string) => ModuleErasureBackend;
  contracts?: () => Promise<ContractChoice[]>;
  /** Projection d'un contrat en éléments de vue (défaut : tenantViewBuilder). */
  buildView?: (contractId: string, now: Date) => Promise<DesiredItem[] | null>;
  now?: () => Date;
}

interface BootModule {
  bootModulesBackend: (uid: string) => ModulesBackend;
  bootModuleErasureBackend: (uid: string) => ModuleErasureBackend;
}
let boot: BootModule | null = null;
const loadBoot = (): BootModule => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  boot = boot ?? (require('./firebase/modulesBoot') as BootModule);
  return boot;
};

const failure = (message: string): { ok: false; message: string } => ({ ok: false, message });

export function createSharedModulesService(deps: SharedModulesDeps = {}) {
  const enabled = deps.enabled ?? (() => CLOUD_ACCOUNT_ENABLED);
  const now = deps.now ?? (() => new Date());
  const contracts = deps.contracts ?? loadContractChoices;
  const buildView = deps.buildView ?? buildTenantViewForContract;

  /** Gardes communes ; retourne les dépendances des flux, ou le message de refus. */
  function context(uid: string): { ok: true; flow: FlowDeps } | { ok: false; message: string } {
    if (!enabled()) return failure('Les comptes cloud ne sont pas ouverts dans cette version.');
    if (workspaceId() !== 'personal') return failure('Les espaces partagés ne sont pas disponibles dans la démonstration.');
    if (getSyncAccount() !== uid) return failure('Le compte actif a changé : réessayez.');
    if (!isEmailVerified(uid)) return failure(AUTH_MESSAGES['app/email-not-verified']);
    try {
      return { ok: true, flow: { backend: deps.backend ? deps.backend(uid) : loadBoot().bootModulesBackend(uid), uid, now } };
    } catch {
      return failure('Connexion au compte impossible : reconnectez-vous puis réessayez.');
    }
  }

  const unexpected = (): { ok: false; message: string } => failure('Une erreur est survenue. Vérifiez vos données puis réessayez.');
  /** Carnet local : meilleur effort après un succès du cloud (son échec ne doit pas faire croire que l'opération a échoué). */
  const bestEffort = async (write: () => Promise<unknown>): Promise<void> => {
    try {
      await write();
    } catch {
      // le cloud fait foi ; le carnet local se reconstruit à la prochaine actualisation
    }
  };
  const withContext = async <T,>(uid: string, run: (flow: FlowDeps) => Promise<FlowResult<T>>): Promise<FlowResult<T>> => {
    const ctx = context(uid);
    if (!ctx.ok) return ctx;
    try {
      return await run(ctx.flow);
    } catch (error) {
      return error instanceof ModulesError ? flows.explain(error) : unexpected();
    }
  };
  /** Publie (ou retire) la vue d'un locataire : meilleur effort après une action du propriétaire ; l'écran du propriétaire republie et signale les échecs. */
  const publishAfter = (flow: FlowDeps, moduleId: string, memberUid: string): Promise<void> =>
    bestEffort(async () => {
      const member = await flow.backend.getMember(moduleId, memberUid);
      if (member) await viewFlows.publishMemberView(flow, moduleId, member, (contractId) => buildView(contractId, now()));
    });
  const endDayOf = async (contractId: string): Promise<string | null> => (await contracts()).find((c) => c.id === contractId)?.endDay ?? null;

  /** Lecture LOCALE de ma vue (aucun réseau) : refuse de la montrer au-delà de la fin d'accès connue, et la retire alors. */
  async function localView(uid: string, moduleId: string): Promise<FlowResult<ViewState>> {
    if (!enabled()) return failure('Les comptes cloud ne sont pas ouverts dans cette version.');
    if (workspaceId() !== 'personal') return failure('Les espaces partagés ne sont pas disponibles dans la démonstration.');
    if (getSyncAccount() !== uid) return failure('Le compte actif a changé : réessayez.');
    try {
      const copy = await loadViewCopy(moduleId);
      if (!copy) return { ok: true, value: { state: 'none' } };
      if (viewFlows.copyGate(copy, now()) === 'expired') {
        await purgeViewCopy(moduleId);
        return { ok: true, value: { state: 'expired' } };
      }
      return { ok: true, value: { state: 'ok', copy, model: toViewModel(copy.items) } };
    } catch {
      return failure('Votre espace enregistré sur cet appareil est illisible : actualisez-le.');
    }
  }

  return {
    // ---- Carnet local (aucun réseau) ---------------------------------------------------------------------------------------------
    async listLocal() {
      return local.listLocalModules();
    },
    async forgetJoined(moduleId: string): Promise<void> {
      await local.forgetJoinedModule(moduleId);
    },
    contracts,

    // ---- Propriétaire ------------------------------------------------------------------------------------------------------------
    createModule: (uid: string, name: string) =>
      withContext(uid, async (flow) => {
        const result = await flows.createOwnedModule(flow, name);
        if (!result.ok) return result;
        try {
          await local.rememberOwnedModule({ moduleId: result.value.moduleId, name: result.value.name, createdAt: now().toISOString() });
        } catch {
          // l'espace existe dans le cloud : on ne dit jamais « échec », et on donne l'identifiant pour ne pas le perdre
          return failure(`L’espace a bien été créé (identifiant : ${result.value.moduleId}) mais n’a pas pu être enregistré sur cet appareil. Notez cet identifiant.`);
        }
        return result;
      }),
    renameModule: (uid: string, moduleId: string, name: string) =>
      withContext(uid, async (flow) => {
        const result = await flows.renameOwnedModule(flow, moduleId, name);
        if (result.ok) await bestEffort(() => local.renameOwnedEntry(moduleId, name.trim()));
        return result;
      }),
    /**
     * SUPPRIME cet espace : verrouillé (les locataires perdent aussitôt leur accès), vidé, vérifié, puis supprimé dans le cloud ; retiré du carnet local. Vos données locales
     * d'Immobilier ne sont pas touchées. Une suppression non terminée laisse l'espace verrouillé : on peut relancer.
     */
    deleteModule: (uid: string, moduleId: string) =>
      withContext<{ docsDeleted: number }>(uid, async () => {
        const backend = deps.erasure ? deps.erasure(uid) : loadBoot().bootModuleErasureBackend(uid);
        const report = await eraseOwnedModules({ backend, uid, only: [moduleId] });
        if (report.status === 'purged' || report.status === 'none') {
          // « none » : l'espace n'est plus dans la liste serveur de vos espaces (déjà supprimé) ; le carnet local l'oublie dans les deux cas
          await bestEffort(() => local.forgetOwnedModule(moduleId));
          await bestEffort(() => purgePublishedForModule(moduleId));
          return { ok: true as const, value: { docsDeleted: report.docsDeleted } };
        }
        return failure('La suppression n’est pas terminée : l’espace est verrouillé (vos locataires n’y ont déjà plus accès). Réessayez.');
      }),
    ownerView: (uid: string, moduleId: string) => withContext(uid, (flow) => flows.loadOwnerView(flow, moduleId)),
    approve: (uid: string, moduleId: string, requesterUid: string, contractId: string) =>
      withContext<MemberDoc>(uid, async (flow) => {
        const result = await flows.approveRequest(flow, { moduleId, requesterUid, contractId, contractEndDay: await endDayOf(contractId) });
        if (result.ok) await publishAfter(flow, moduleId, requesterUid);
        return result;
      }),
    refuse: (uid: string, moduleId: string, requesterUid: string) => withContext(uid, (flow) => flows.refuseRequest(flow, moduleId, requesterUid)),
    clearRequest: (uid: string, moduleId: string, requesterUid: string) => withContext(uid, (flow) => flows.clearRequest(flow, moduleId, requesterUid)),
    revoke: (uid: string, moduleId: string, memberUid: string) =>
      withContext(uid, async (flow) => {
        const result = await flows.revokeMember(flow, moduleId, memberUid);
        if (result.ok) await publishAfter(flow, moduleId, memberUid); // la vue est retirée du cloud : plus rien à lire, même par le cache d'un autre appareil du propriétaire
        return result;
      }),
    reactivate: (uid: string, moduleId: string, member: Pick<MemberDoc, 'uid' | 'contractId'>) =>
      withContext(uid, async (flow) => {
        const result = await flows.reactivateMember(flow, moduleId, member.uid, member.contractId ? await endDayOf(member.contractId) : null);
        if (result.ok) await publishAfter(flow, moduleId, member.uid);
        return result;
      }),
    setContract: (uid: string, moduleId: string, memberUid: string, contractId: string) =>
      withContext(uid, async (flow) => {
        const result = await flows.setMemberContract(flow, moduleId, memberUid, contractId, await endDayOf(contractId));
        if (result.ok) await publishAfter(flow, moduleId, memberUid);
        return result;
      }),
    /** À l'ouverture de l'écran d'un espace : pose la fin d'accès des contrats terminés (aucune fonction cloud : c'est l'application du propriétaire qui le fait). */
    reconcileAccessEnds: (uid: string, moduleId: string) =>
      withContext(uid, async (flow) => {
        const days = new Map((await contracts()).map((c) => [c.id, c.endDay] as const));
        return flows.reconcileAccessEnds(flow, moduleId, (contractId) => days.get(contractId) ?? null);
      }),

    /**
     * Publie la vue de CHAQUE membre : projection pour un accès actif, retrait sinon (révoqué, parti, expiré, contrat disparu). N'écrit que ce qui a changé. Un échec sur un
     * membre n'empêche pas les autres ; `failed` les compte.
     */
    publishViews: (uid: string, moduleId: string) =>
      withContext<PublishViewsReport>(uid, async (flow) => {
        const members = await flow.backend.listMembers(moduleId);
        const report: PublishViewsReport = { members: members.length, written: 0, deleted: 0, failed: 0 };
        for (const member of members) {
          const result = await viewFlows.publishMemberView(flow, moduleId, member, (contractId) => buildView(contractId, now()));
          if (result.ok) {
            report.written += result.value.written;
            report.deleted += result.value.deleted;
          } else report.failed += 1;
        }
        return { ok: true as const, value: report };
      }),

    // ---- Demandeur / locataire ---------------------------------------------------------------------------------------------------
    /** Ma vue enregistrée sur l'appareil (lecture locale seule). */
    viewCopy: localView,
    /** Relit MA vue dans le cloud (accès actif seulement), la range à part sur l'appareil ; accès non actif : ma copie locale est retirée. */
    refreshMyView: (uid: string, moduleId: string) =>
      withContext<ViewState>(uid, async (flow) => {
        const fetched = await viewFlows.fetchMyView(flow, moduleId);
        if (!fetched.ok) return fetched;
        if (fetched.value.copy) {
          await saveViewCopy(fetched.value.copy);
          await bestEffort(() => local.updateJoinedStatus(moduleId, { status: 'active', moduleName: fetched.value.copy?.moduleName ?? null, checkedAt: now().toISOString() }));
          return { ok: true as const, value: { state: 'ok' as const, copy: fetched.value.copy, model: toViewModel(fetched.value.copy.items) } };
        }
        await bestEffort(() => purgeViewCopy(moduleId));
        await bestEffort(() => local.updateJoinedStatus(moduleId, { status: fetched.value.status, checkedAt: now().toISOString() }));
        return { ok: true as const, value: { state: 'unavailable' as const, status: fetched.value.status } };
      }),
    requestAccess: (uid: string, moduleIdText: string, label: string) =>
      withContext(uid, async (flow) => {
        const result = await flows.requestAccess(flow, moduleIdText, label);
        if (result.ok) {
          const at = now().toISOString();
          await bestEffort(() => local.rememberJoinedModule({ moduleId: result.value.moduleId, label: result.value.label, requestedAt: at, status: 'pending', moduleName: null, checkedAt: at }));
        }
        return result;
      }),
    /** Relit l'état de chaque espace rejoint (réseau) ; un échec sur un espace n'empêche pas les autres. */
    refreshJoined: (uid: string) =>
      withContext(uid, async (flow) => {
        const entries = (await local.listLocalModules()).joined;
        let failed = 0;
        for (const entry of entries) {
          const access = await flows.checkMyAccess(flow, entry.moduleId);
          if (!access.ok) {
            failed += 1;
            continue;
          }
          await bestEffort(() => local.updateJoinedStatus(entry.moduleId, { status: access.value.status, moduleName: access.value.moduleName ?? entry.moduleName, checkedAt: now().toISOString() }));
          if (access.value.status !== 'active') await bestEffort(() => purgeViewCopy(entry.moduleId)); // accès retiré, quitté, expiré ou jamais ouvert : la copie locale de ma vue est retirée
        }
        return { ok: true as const, value: { checked: entries.length - failed, failed } };
      }),
    cancelRequest: (uid: string, moduleId: string) =>
      withContext(uid, async (flow) => {
        const result = await flows.cancelMyRequest(flow, moduleId);
        if (result.ok) await bestEffort(() => local.forgetJoinedModule(moduleId));
        return result;
      }),
    leave: (uid: string, moduleId: string) =>
      withContext(uid, async (flow) => {
        const result = await flows.leaveModule(flow, moduleId);
        if (result.ok) await bestEffort(() => purgeViewCopy(moduleId));
        // quitter retire aussi le nom saisi dans la demande ; la fiche d'accès (identifiant, contrat lié, état) reste chez le propriétaire comme historique
        if (result.ok) await bestEffort(() => flows.cancelMyRequest(flow, moduleId));
        if (result.ok) await bestEffort(() => local.updateJoinedStatus(moduleId, { status: 'left', checkedAt: now().toISOString() }));
        return result;
      }),
  };
}

/** Service de production : drapeau cloud, cloud composé à la demande. */
export const sharedModules = createSharedModulesService();

