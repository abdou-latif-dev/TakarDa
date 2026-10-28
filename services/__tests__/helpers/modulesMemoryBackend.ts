// Cloud EN MÉMOIRE des modules partagés pour les tests de flux (F3b) : chaque opération est jugée par la politique de référence
// (sharedModules/accessPolicy.ts), comme le feraient les règles candidates. Les flux sont donc joués contre les MÊMES décisions que la matrice
// de F3a — mais cela ne prouve pas les vraies règles (voir docs/f3a-espaces-partages.md).

import { decide, type Operation, type Patch, type PolicyActor, type PolicyWorld, type RecordLite } from '../../sharedModules/accessPolicy';
import type { ModuleDocPath, ModuleErasureBackend } from '../../firebase/moduleErasure';
import { ModulesError, type ModulesBackend, type RequestDecision } from '../../sharedModules/modulesPort';
import type { MemberDoc, ModuleDoc, RequestDoc, TenantItemDoc } from '../../sharedModules/model';
import { cloudFinancialKinds, cloudKinds } from '../../firebase/syncDocModel';

export interface MemoryModulesCloud {
  modules: Record<string, ModuleDoc>;
  members: Record<string, MemberDoc>;
  requests: Record<string, RequestDoc>;
  /** Vues publiées, clé « moduleId/uid/itemId ». */
  tenantItems: Record<string, TenantItemDoc>;
  /** Données du module (syncRecords), clé « moduleId/recordId » : seulement pour les essais d'effacement. */
  records: Record<string, RecordLite>;
  /** Journal des écritures acceptées (type d'opération). */
  writes: string[];
  /** Horloge du « serveur » (pour l'expiration d'accès). */
  now: () => Date;
  /** Vue d'un compte connecté par mot de passe. */
  as(uid: string, provider?: string): ModulesBackend;
  /** Port d'effacement des espaces partagés de ce compte (chaque opération est jugée par la politique de référence). */
  erasure(uid: string): ModuleErasureBackend;
  /** Panne simulée : toute opération échoue en erreur réseau tant que vrai. */
  offline: boolean;
}

export function createMemoryModulesCloud(now: () => Date = () => new Date()): MemoryModulesCloud {
  const cloud: MemoryModulesCloud = {
    modules: {},
    members: {},
    requests: {},
    tenantItems: {},
    records: {},
    writes: [],
    now,
    offline: false,
    erasure(uid) {
      const actor: PolicyActor = { uid, provider: 'password' };
      const world = (): PolicyWorld => ({ now: now(), syncKinds: cloudKinds(), financialKinds: cloudFinancialKinds(), modules: cloud.modules, members: cloud.members, requests: cloud.requests, records: cloud.records });
      const check = (op: Operation): void => {
        if (cloud.offline) throw new ModulesError('network', 'hors ligne');
        const decision = decide(op, actor, world());
        if (!decision.allow) throw new ModulesError('permission', decision.reason);
      };
      const under = (moduleId: string, table: Record<string, unknown>): string[] => Object.keys(table).filter((k) => k.startsWith(`${moduleId}/`)).map((k) => k.slice(moduleId.length + 1));
      return {
        async listOwnedModuleIds() {
          check({ type: 'listOwnModules' });
          return Object.keys(cloud.modules).filter((id) => cloud.modules[id].ownerUid === uid);
        },
        async readModule(moduleId) {
          const m = cloud.modules[moduleId];
          if (!m) return { exists: false, ownerUid: null, locked: false };
          check({ type: 'getModule', moduleId });
          return { exists: true, ownerUid: m.ownerUid, locked: !!m.deletionLockedAt };
        },
        async lockModule(moduleId, at) {
          check({ type: 'updateModule', moduleId, patch: { deletionLockedAt: at } });
          cloud.modules[moduleId] = { ...cloud.modules[moduleId], deletionLockedAt: at };
          cloud.writes.push('lockModule');
        },
        async listModuleDocs(moduleId, limit) {
          const found: ModuleDocPath[] = [];
          const owners = [...new Set([...under(moduleId, cloud.members), ...under(moduleId, cloud.requests)])];
          for (const owner of owners) for (const k of Object.keys(cloud.tenantItems).filter((key) => key.startsWith(`${moduleId}/${owner}/`))) found.push(['tenantViews', owner, 'items', k.slice(`${moduleId}/${owner}/`.length)]);
          if (found.length === 0) {
            for (const id of under(moduleId, cloud.records)) found.push(['syncRecords', id]);
            if (found.length === 0) for (const id of under(moduleId, cloud.requests)) found.push(['requests', id]);
            if (found.length === 0) for (const id of under(moduleId, cloud.members)) found.push(['members', id]);
          }
          return found.slice(0, limit);
        },
        async removeModuleDocs(moduleId, paths) {
          for (const p of paths) {
            if (p[0] === 'tenantViews') check({ type: 'deleteTenantItem', moduleId, uid: p[1], id: p[3] });
            else if (p[0] === 'syncRecords') check({ type: 'deleteRecord', moduleId, id: p[1] });
            else if (p[0] === 'requests') check({ type: 'deleteRequest', moduleId, uid: p[1] });
            else check({ type: 'deleteMember', moduleId, uid: p[1] });
          }
          for (const p of paths) {
            if (p[0] === 'tenantViews') delete cloud.tenantItems[`${moduleId}/${p[1]}/${p[3]}`];
            else if (p[0] === 'syncRecords') delete cloud.records[`${moduleId}/${p[1]}`];
            else if (p[0] === 'requests') delete cloud.requests[`${moduleId}/${p[1]}`];
            else delete cloud.members[`${moduleId}/${p[1]}`];
          }
          cloud.writes.push('removeModuleDocs');
        },
        async deleteModule(moduleId) {
          check({ type: 'deleteModule', moduleId });
          delete cloud.modules[moduleId];
          cloud.writes.push('deleteModule');
        },
      };
    },
    as(uid, provider = 'password') {
      const actor: PolicyActor = { uid, provider };
      const world = (): PolicyWorld => ({ now: now(), syncKinds: cloudKinds(), financialKinds: cloudFinancialKinds(), modules: cloud.modules, members: cloud.members, requests: cloud.requests, records: cloud.records });
      const check = (op: Operation): void => {
        if (cloud.offline) throw new ModulesError('network', 'hors ligne');
        const decision = decide(op, actor, world());
        if (!decision.allow) throw new ModulesError('permission', decision.reason);
      };
      const key = (moduleId: string, id: string) => `${moduleId}/${id}`;
      const inModule = (moduleId: string, table: Record<string, unknown>): string[] => Object.keys(table).filter((k) => k.startsWith(`${moduleId}/`));

      const backend: ModulesBackend = {
        async createModule(moduleId, doc) {
          check({ type: 'createModule', moduleId, doc: doc as unknown as Patch });
          cloud.modules[moduleId] = { ...doc };
          cloud.writes.push('createModule');
        },
        async getModule(moduleId) {
          check({ type: 'getModule', moduleId });
          return cloud.modules[moduleId] ? { ...cloud.modules[moduleId] } : null;
        },
        async renameModule(moduleId, name) {
          check({ type: 'updateModule', moduleId, patch: { name } });
          cloud.modules[moduleId] = { ...cloud.modules[moduleId], name };
          cloud.writes.push('renameModule');
        },
        async createRequest(moduleId, doc) {
          check({ type: 'createRequest', moduleId, uid: doc.uid, doc: doc as unknown as Patch });
          cloud.requests[key(moduleId, doc.uid)] = { ...doc };
          cloud.writes.push('createRequest');
        },
        async getRequest(moduleId, uid) {
          check({ type: 'getRequest', moduleId, uid });
          const found = cloud.requests[key(moduleId, uid)];
          return found ? { ...found } : null;
        },
        async listRequests(moduleId) {
          check({ type: 'listRequests', moduleId });
          return inModule(moduleId, cloud.requests).map((k) => ({ ...cloud.requests[k] }));
        },
        async deleteRequest(moduleId, uid) {
          check({ type: 'deleteRequest', moduleId, uid });
          delete cloud.requests[key(moduleId, uid)];
          cloud.writes.push('deleteRequest');
        },
        async decideRequest(moduleId, uid, decision: RequestDecision, member) {
          // opération ATOMIQUE : tout est jugé avant la moindre écriture
          const patch = { state: decision.state, decidedBy: decision.decidedBy, updatedAt: decision.at };
          check({ type: 'updateRequest', moduleId, uid, patch });
          if (decision.state === 'approved') {
            if (!member) throw new ModulesError('unknown', 'approbation sans fiche de membre');
            check({ type: 'createMember', moduleId, uid, doc: member as unknown as Patch, withApprovedRequest: true });
          }
          cloud.requests[key(moduleId, uid)] = { ...cloud.requests[key(moduleId, uid)], ...patch };
          if (decision.state === 'approved' && member) cloud.members[key(moduleId, uid)] = { ...member };
          cloud.writes.push(decision.state === 'approved' ? 'approve' : 'refuse');
        },
        async getMember(moduleId, uid) {
          check({ type: 'getMember', moduleId, uid });
          const found = cloud.members[key(moduleId, uid)];
          return found ? { ...found } : null;
        },
        async listMembers(moduleId) {
          check({ type: 'listMembers', moduleId });
          return inModule(moduleId, cloud.members).map((k) => ({ ...cloud.members[k] }));
        },
        async updateMember(moduleId, uid, patch) {
          check({ type: 'updateMember', moduleId, uid, patch: patch as Patch });
          cloud.members[key(moduleId, uid)] = { ...cloud.members[key(moduleId, uid)], ...patch };
          cloud.writes.push('updateMember');
        },
        async putTenantItems(moduleId, uid, items) {
          for (const item of items) check({ type: 'writeTenantItem', moduleId, uid, id: item.id, doc: item.doc as unknown as Patch }); // tout est jugé avant la moindre écriture
          for (const item of items) cloud.tenantItems[`${moduleId}/${uid}/${item.id}`] = JSON.parse(JSON.stringify(item.doc));
          if (items.length > 0) cloud.writes.push('putTenantItems');
        },
        async deleteTenantItems(moduleId, uid, ids) {
          for (const id of ids) check({ type: 'deleteTenantItem', moduleId, uid, id });
          for (const id of ids) delete cloud.tenantItems[`${moduleId}/${uid}/${id}`];
          if (ids.length > 0) cloud.writes.push('deleteTenantItems');
        },
        async listTenantItems(moduleId, uid) {
          check({ type: 'listTenantItems', moduleId, uid });
          const prefix = `${moduleId}/${uid}/`;
          return Object.keys(cloud.tenantItems).filter((k) => k.startsWith(prefix)).map((k) => ({ id: k.slice(prefix.length), doc: JSON.parse(JSON.stringify(cloud.tenantItems[k])) as TenantItemDoc }));
        },
      };
      return backend;
    },
  };
  return cloud;
}
