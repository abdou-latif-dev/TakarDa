// Registre « Mes Outils » : quels modèles du catalogue l'utilisateur a ajoutés.
//
// Aucun système parallèle : un outil installé EST un `Tool` du Core.
//   - Immobilier : le Tool existant (ensureImmobilierTool), avec toutes ses données.
//   - CEET / TDE / Tontine : un Tool « enveloppe » de type 'ceet' | 'tde' | 'tontine'.
//     Il ne contient aucune donnée : celles de CEET/TDE restent dans l'outil Factures
//     (moteur interne, inchangé) et celles de la Tontine dans Group/Tour/Contribution.
//   Les types 'ceet'/'tde'/'tontine' sont distincts de 'facture' et 'immobilier', que le
//   moteur cherche par type : une enveloppe ne peut jamais le détourner.
//
// ÉTAT D'UN OUTIL (Tool.settings, persisté avec core_tools) :
//   installedAt : date d'ajout à Mes Outils      hidden : true quand l'utilisateur l'a retiré
//   Retirer = MASQUER. Jamais coreService.deleteTool (il supprime en cascade les
//   entités, enregistrements et membres) : retirer un outil ne supprime aucune donnée.
//
// Le propriétaire (Tool.ownerId = getCurrentUserId()) reçoit un ToolMember et les deux
// rôles V1 (admin, member). Le partage n'existe pas encore : « partagés avec moi » est
// calculé (outils d'un autre propriétaire où je suis membre) et reste vide en V1.

import { assertToolAvailable, assertToolKindAvailable, isMultiAccountContext, lockedToolIds } from './moduleLock';
import { recordActivity } from './activityService';
import { coreService } from './coreService';
import { toolMembers, tools } from './db';
import { ensureImmobilierTool } from './immobilierService';
import { getCatalogModel, getCatalogModels, isInstallableModel, type CatalogModel, type ToolModelKey } from './toolCatalogService';
import { groupService } from './groupService';
import { getCurrentUserId, ensureLocalUser } from './identityService';
import { fournisseurKey } from './utilityBillingService';
import type { FieldValue, PermissionSet, Tool, ToolMember } from '@/types/entities';

export interface MyTool {
  tool: Tool;
  model: CatalogModel;
  route: string;
}

export interface MyTools {
  /** Mes outils : possédés, installés, visibles. */
  owned: MyTool[];
  /** Partagés avec moi : propriétaire différent, je suis membre. Vide en V1. */
  shared: MyTool[];
  /** Possédés mais retirés de Mes Outils (données conservées) — pour les réafficher. */
  hidden: MyTool[];
}

// ---- Lecture de l'état d'un outil (fonctions pures) ---------------------------------

export const isToolInstalled = (tool: Tool): boolean => typeof tool.settings?.installedAt === 'string';
export const isToolHidden = (tool: Tool): boolean => tool.settings?.hidden === true;

/** Modèle du catalogue auquel correspond un Tool, ou null (ex. l'outil interne Factures). */
export function modelKeyOfTool(tool: Pick<Tool, 'kind'>): ToolModelKey | null {
  return isInstallableModel(tool.kind) ? tool.kind : null;
}

export function selectOwnedTools(all: readonly Tool[], userId: string): Tool[] {
  return all.filter((t) => t.ownerId === userId);
}

export function selectSharedTools(all: readonly Tool[], members: readonly ToolMember[], userId: string): Tool[] {
  const mine = new Set(members.filter((m) => m.userId === userId && m.status === 'active').map((m) => m.toolId));
  return all.filter((t) => t.ownerId !== userId && mine.has(t.id));
}

const ORDER = getCatalogModels().map((m) => m.key as string);
const byCatalogOrder = (a: MyTool, b: MyTool) => ORDER.indexOf(a.model.key) - ORDER.indexOf(b.model.key);

function toMyTool(tool: Tool): MyTool | null {
  const model = getCatalogModel(tool.kind);
  if (!model || !model.installable || !model.route) return null;
  return { tool, model, route: model.route };
}

function collect(list: readonly Tool[]): MyTool[] {
  return list.map(toMyTool).filter((t): t is MyTool => t !== null).sort(byCatalogOrder);
}

export async function getMyTools(): Promise<MyTools> {
  const me = getCurrentUserId();
  const locked = lockedToolIds(); // contexte multi-compte : seuls les outils Immobilier sont listés
  const installedOwned = selectOwnedTools(tools, me).filter(isToolInstalled).filter((t) => !locked.has(t.id));
  return {
    owned: collect(installedOwned.filter((t) => !isToolHidden(t))),
    hidden: collect(installedOwned.filter(isToolHidden)),
    shared: collect(selectSharedTools(tools, toolMembers, me).filter((t) => !isToolHidden(t) && !locked.has(t.id))),
  };
}

/** true si le modèle est dans Mes Outils (installé et visible). */
export async function isModelInstalled(key: ToolModelKey): Promise<boolean> {
  return (await getMyTools()).owned.some((t) => t.model.key === key);
}

// ---- Écritures : sérialisées (jamais deux outils pour un même modèle) ---------------

let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => undefined);
  return run;
}

const ADMIN: PermissionSet = { canView: true, canCreate: true, canEdit: true, canDelete: true, canManageTool: true, canInvite: true, scope: 'all' };
const MEMBER: PermissionSet = { canView: true, canCreate: true, canEdit: true, canDelete: false, canManageTool: false, canInvite: false, scope: 'own' };

/** Rôles V1 (admin, member) et membre propriétaire de l'outil : créés s'ils manquent, jamais dupliqués. */
async function ensureOwnerMembership(tool: Tool): Promise<void> {
  const roles = await coreService.getRoleDefinitions(tool.id);
  const admin = roles.find((r) => r.key === 'admin') ?? (await coreService.createRoleDefinition({ toolId: tool.id, key: 'admin', label: 'Administrateur', permissions: ADMIN }));
  if (!roles.some((r) => r.key === 'member')) {
    // Rôle par défaut seulement si l'outil n'en a pas déjà un (ex. « locataire » d'Immobilier).
    await coreService.createRoleDefinition({ toolId: tool.id, key: 'member', label: 'Membre', permissions: MEMBER, isDefault: !roles.some((r) => r.isDefault) });
  }
  const me = getCurrentUserId();
  const members = await coreService.getToolMembers(tool.id);
  if (!members.some((m) => m.accountType === 'user' && m.userId === me)) {
    await coreService.addToolMember({ toolId: tool.id, roleId: admin.id, accountType: 'user', userId: me, displayName: ensureLocalUser().name || 'Vous' });
  }
}

const ownTool = async (kind: ToolModelKey): Promise<Tool | null> => (await coreService.getTools({ kind }))[0] ?? null;

/** L'outil du modèle : l'existant, sinon créé (une seule fois). Réutilise ensureImmobilierTool pour Immobilier. */
async function findOrCreateTool(key: ToolModelKey): Promise<Tool> {
  if (key === 'immobilier') return (await ensureImmobilierTool()).tool;
  const existing = await ownTool(key);
  if (existing) return existing;
  const model = getCatalogModel(key)!;
  return coreService.createTool({ name: model.title, icon: model.icon, kind: key });
}

async function setState(tool: Tool, patch: Record<string, FieldValue>): Promise<Tool> {
  return coreService.updateTool(tool.id, { settings: { ...(tool.settings ?? {}), ...patch } });
}

/** Ajoute le modèle à Mes Outils. Idempotent : un seul outil par modèle ; si l'outil
 * existe (même masqué) il est retrouvé et réaffiché, jamais recréé ni dupliqué. */
export function installTool(key: ToolModelKey): Promise<Tool> {
  return serialize(async () => {
    assertToolKindAvailable(key); // contexte multi-compte : seul Immobilier peut être installé
    if (!isInstallableModel(key)) throw new Error('Ce modèle n’est pas encore disponible.');
    const tool = await findOrCreateTool(key);
    await ensureOwnerMembership(tool);
    if (isToolInstalled(tool) && !isToolHidden(tool)) return tool;
    const wasInstalled = isToolInstalled(tool);
    const updated = await setState(tool, { installedAt: String(tool.settings?.installedAt ?? new Date().toISOString()), hidden: false });
    const model = getCatalogModel(key)!;
    recordActivity({
      type: wasInstalled ? 'tool.restored' : 'tool.installed',
      title: wasInstalled ? 'Outil réaffiché' : 'Outil ajouté',
      description: `${model.title} est dans Mes outils.`,
      toolId: updated.id,
      entityType: 'outil',
      entityId: updated.id,
      dedupeKey: `tool-${wasInstalled ? 'restored' : 'installed'}:${updated.id}:${updated.updatedAt}`,
    });
    return updated;
  });
}

async function ownedCatalogTool(toolId: string): Promise<Tool> {
  const tool = tools.find((t) => t.id === toolId && t.ownerId === getCurrentUserId());
  if (!tool || !modelKeyOfTool(tool)) throw new Error('Outil introuvable.');
  return tool;
}

/** Retire l'outil de Mes Outils : il est MASQUÉ, ses données ne sont pas touchées. */
export function hideTool(toolId: string): Promise<Tool> {
  assertToolAvailable(toolId);
  return serialize(async () => {
    const tool = await ownedCatalogTool(toolId);
    if (isToolHidden(tool)) return tool;
    const updated = await setState(tool, { hidden: true });
    recordActivity({
      type: 'tool.hidden',
      title: 'Outil retiré de Mes outils',
      description: `${getCatalogModel(tool.kind)?.title ?? tool.name} — vos données sont conservées.`,
      toolId: updated.id,
      entityType: 'outil',
      entityId: updated.id,
      dedupeKey: `tool-hidden:${updated.id}:${updated.updatedAt}`,
    });
    return updated;
  });
}

/** Réaffiche un outil masqué : c'est le même Tool, aucune donnée recréée. */
export function restoreTool(toolId: string): Promise<Tool> {
  assertToolAvailable(toolId);
  return serialize(async () => {
    const tool = await ownedCatalogTool(toolId);
    if (!isToolHidden(tool)) return tool;
    const updated = await setState(tool, { hidden: false });
    recordActivity({
      type: 'tool.restored',
      title: 'Outil réaffiché',
      description: `${getCatalogModel(tool.kind)?.title ?? tool.name} est de nouveau dans Mes outils.`,
      toolId: updated.id,
      entityType: 'outil',
      entityId: updated.id,
      dedupeKey: `tool-restored:${updated.id}:${updated.updatedAt}`,
    });
    return updated;
  });
}

// ---- Installations existantes -----------------------------------------------------

/** L'utilisateur a-t-il déjà des données pour ce modèle ? Lecture seule : ne provisionne rien. */
async function hasExistingData(key: ToolModelKey, tool: Tool | null): Promise<boolean> {
  if (key === 'immobilier') return tool !== null && (await coreService.getRecords({ toolId: tool.id })).length > 0;
  if (key === 'tontine') return (await groupService.listMyGroups()).some((g) => g.kind === 'tontine');
  if (key === 'ceet' || key === 'tde') {
    const factures = (await coreService.getTools({ kind: 'facture' }))[0];
    if (!factures) return false;
    const definitions = await coreService.getEntityDefinitions(factures.id);
    const engineIds = new Set(definitions.filter((d) => ['releve', 'facture_partagee', 'participation'].includes(d.key)).map((d) => d.id));
    const records = await coreService.getRecords({ toolId: factures.id });
    return records.some((r) => engineIds.has(r.entityDefinitionId) && fournisseurKey(r.values.fournisseur) === key);
  }
  return false;
}

/** Reconstruit le registre d'une installation qui existait avant Mes Outils : un module
 * qui a déjà des données est considéré comme installé. Idempotent, non destructif,
 * sans effet sur les outils déjà installés ou masqués (un outil retiré le reste), et
 * sans aucune donnée métier modifiée. Renvoie les modèles ajoutés cette fois-ci. */
export function ensureInstalledTools(): Promise<ToolModelKey[]> {
  return serialize(async () => {
    if (isMultiAccountContext()) return []; // aucun outil n'est créé en contexte multi-compte
    const added: ToolModelKey[] = [];
    for (const model of getCatalogModels()) {
      if (!model.installable) continue;
      const key = model.key;
      const existing = await ownTool(key);
      if (existing && isToolInstalled(existing)) {
        await ensureOwnerMembership(existing); // rattrapage du membre propriétaire des outils déjà là
        continue;
      }
      if (!(await hasExistingData(key, existing))) continue;
      const tool = existing ?? (await findOrCreateTool(key));
      await ensureOwnerMembership(tool);
      await setState(tool, { installedAt: new Date().toISOString(), hidden: false });
      added.push(key);
    }
    return added;
  });
}
