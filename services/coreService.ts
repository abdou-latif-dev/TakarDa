// Generic Core engine service — Tool / EntityDefinition / Record / ToolMember /
// ExternalContact / DocumentRef / Event CRUD.
//
// This file must stay domain-agnostic: no Tontine rotation logic, no CEET/TDE
// specifics, no shop/stock logic. Those belong in domain services (e.g.
// services/facturesService.ts) that call into this one, never the other way
// around. See the "TakarDa — Étape 1" architecture report for the full
// Core → Domain Service → Store → Screen layering this file is part of.
//
// Tontine (groupService.ts/tontineService.ts) and Forms (formService.ts/
// submissionService.ts) are NOT touched and do not read this file.

import {
  CURRENT_USER_ID,
  delay,
  documents,
  entityDefinitions,
  events,
  externalContacts,
  genId,
  records,
  roleDefinitions,
  toolMembers,
  tools,
} from './db';
import { assertDocumentTargetAvailable, isDocumentLocked, assertToolAvailable, assertToolKindAvailable, isContactLockedOut, isToolLockedForAccount, lockedToolIds, ownerForNewContact } from './moduleLock';
import { getActiveCloudUid, isContactVisible, isRecordVisible, ownerForNewRecord, visibleContactsFor, visibleEventsFor, visibleRecordsFor } from './cloudVisibility';
import type {
  CoreEventType,
  DocumentRef,
  EntityDefinition,
  ExternalContact,
  FieldDefinition,
  FieldValue,
  PermissionSet,
  RecordItem,
  RoleDefinition,
  Tool,
  ToolKind,
  ToolMember,
  ToolMemberAccountType,
} from '@/types/entities';

function logEvent(input: {
  toolId?: string;
  entityDefinitionId?: string;
  recordId?: string;
  type: CoreEventType;
  summary: string;
  diff?: { field: string; from: FieldValue; to: FieldValue }[];
}) {
  events.unshift({
    id: genId('evt'),
    toolId: input.toolId,
    entityDefinitionId: input.entityDefinitionId,
    recordId: input.recordId,
    type: input.type,
    actorId: CURRENT_USER_ID,
    summary: input.summary,
    diff: input.diff,
    at: new Date().toISOString(),
  });
}

export const coreService = {
  // ================= Tools =================
  async createTool(input: {
    name: string;
    icon: string;
    kind: ToolKind;
    templateKey?: string;
    settings?: Record<string, FieldValue>;
  }): Promise<Tool> {
    assertToolKindAvailable(input.kind);
    await delay();
    const now = new Date().toISOString();
    const tool: Tool = {
      id: genId('tool'),
      name: input.name,
      icon: input.icon,
      kind: input.kind,
      ownerId: CURRENT_USER_ID,
      templateKey: input.templateKey,
      entityDefinitionIds: [],
      settings: input.settings,
      createdAt: now,
      updatedAt: now,
    };
    tools.unshift(tool);
    logEvent({ toolId: tool.id, type: 'tool_created', summary: `${tool.name} a été créé.` });
    return tool;
  },

  async getTool(id: string): Promise<Tool | null> {
    await delay(150);
    return isToolLockedForAccount(id) ? null : (tools.find((t) => t.id === id) ?? null); // outil verrouillé en contexte multi-compte : introuvable
  },

  async getTools(filter?: { kind?: ToolKind }): Promise<Tool[]> {
    await delay();
    const locked = lockedToolIds();
    return tools.filter((t) => !locked.has(t.id) && t.ownerId === CURRENT_USER_ID && (!filter?.kind || t.kind === filter.kind));
  },

  async updateTool(id: string, patch: Partial<Pick<Tool, 'name' | 'icon' | 'settings'>>): Promise<Tool> {
    await delay();
    const tool = tools.find((t) => t.id === id);
    if (!tool) throw new Error('Outil introuvable.');
    assertToolAvailable(id);
    Object.assign(tool, patch);
    tool.updatedAt = new Date().toISOString();
    return tool;
  },

  async deleteTool(id: string): Promise<void> {
    await delay();
    const index = tools.findIndex((t) => t.id === id);
    if (index === -1) return;
    assertToolAvailable(id); // module verrouillé : l'outil, ses enregistrements et ses membres ne sont jamais supprimés
    const [removed] = tools.splice(index, 1);
    const edIds = entityDefinitions.filter((ed) => ed.toolId === id).map((ed) => ed.id);
    for (let i = entityDefinitions.length - 1; i >= 0; i--) if (entityDefinitions[i].toolId === id) entityDefinitions.splice(i, 1);
    for (let i = records.length - 1; i >= 0; i--) if (edIds.includes(records[i].entityDefinitionId)) records.splice(i, 1);
    for (let i = toolMembers.length - 1; i >= 0; i--) if (toolMembers[i].toolId === id) toolMembers.splice(i, 1);
    logEvent({ type: 'record_deleted', summary: `${removed.name} a été supprimé.` });
  },

  // ================= EntityDefinitions =================
  async createEntityDefinition(input: {
    toolId: string;
    key: string;
    label: string;
    labelPlural?: string;
    icon?: string;
    fields: Omit<FieldDefinition, 'id' | 'order'>[];
    statuses?: EntityDefinition['statuses'];
    isSystem?: boolean;
  }): Promise<EntityDefinition> {
    await delay();
    const now = new Date().toISOString();
    const entityDefinition: EntityDefinition = {
      id: genId('ed'),
      toolId: input.toolId,
      key: input.key,
      label: input.label,
      labelPlural: input.labelPlural,
      icon: input.icon,
      fields: input.fields.map((field, i) => ({ ...field, id: genId('fld'), order: i })),
      statuses: input.statuses,
      isSystem: input.isSystem,
      createdAt: now,
      updatedAt: now,
    };
    entityDefinitions.push(entityDefinition);
    const tool = tools.find((t) => t.id === input.toolId);
    if (tool) tool.entityDefinitionIds.push(entityDefinition.id);
    return entityDefinition;
  },

  async getEntityDefinition(id: string): Promise<EntityDefinition | null> {
    await delay(150);
    return entityDefinitions.find((e) => e.id === id) ?? null;
  },

  async getEntityDefinitions(toolId: string): Promise<EntityDefinition[]> {
    await delay();
    return entityDefinitions.filter((e) => e.toolId === toolId);
  },

  async updateEntityDefinition(
    id: string,
    patch: Partial<Pick<EntityDefinition, 'label' | 'labelPlural' | 'icon' | 'fields' | 'statuses'>>,
  ): Promise<EntityDefinition> {
    await delay();
    const entityDefinition = entityDefinitions.find((e) => e.id === id);
    if (!entityDefinition) throw new Error('Entité introuvable.');
    assertToolAvailable(entityDefinition.toolId);
    Object.assign(entityDefinition, patch);
    entityDefinition.updatedAt = new Date().toISOString();
    return entityDefinition;
  },

  async deleteEntityDefinition(id: string): Promise<void> {
    await delay();
    const index = entityDefinitions.findIndex((e) => e.id === id);
    if (index === -1) return;
    assertToolAvailable(entityDefinitions[index].toolId);
    const [removed] = entityDefinitions.splice(index, 1);
    for (let i = records.length - 1; i >= 0; i--) if (records[i].entityDefinitionId === id) records.splice(i, 1);
    const tool = tools.find((t) => t.id === removed.toolId);
    if (tool) tool.entityDefinitionIds = tool.entityDefinitionIds.filter((edId) => edId !== id);
  },

  // ================= Records =================
  async createRecord(input: {
    /** Identifiant imposé, réservé aux enregistrements DÉRIVÉS à clé logique unique (voir services/sync/derivedIds.ts). Si un
     * enregistrement porte déjà cet identifiant, il est renvoyé tel quel : rien n'est créé, écrasé ni journalisé. */
    id?: string;
    entityDefinitionId: string;
    toolId: string;
    values: Record<string, FieldValue>;
    statusKey?: string;
  }): Promise<RecordItem> {
    assertToolAvailable(input.toolId); // module verrouillé en contexte multi-compte : aucune création
    await delay();
    if (input.id !== undefined) {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(input.id)) throw new Error('Identifiant d’enregistrement invalide.');
      const existing = records.find((r) => r.id === input.id);
      if (existing) {
        if (existing.entityDefinitionId !== input.entityDefinitionId || existing.toolId !== input.toolId) throw new Error('Identifiant déjà utilisé par un autre type d’enregistrement.');
        return existing; // idempotent : le même fait logique n'est jamais créé deux fois
      }
    }
    const now = new Date().toISOString();
    const record: RecordItem = {
      id: input.id ?? genId('rec'),
      entityDefinitionId: input.entityDefinitionId,
      toolId: input.toolId,
      values: input.values,
      statusKey: input.statusKey,
      createdBy: CURRENT_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    const owner = ownerForNewRecord(record); // marquage dès la création pour le compte dont la synchronisation est activée
    if (owner) record.cloudOwnerUid = owner;
    records.push(record);
    logEvent({
      toolId: input.toolId,
      entityDefinitionId: input.entityDefinitionId,
      recordId: record.id,
      type: 'record_created',
      summary: 'Enregistrement créé.',
    });
    return record;
  },

  async getRecord(id: string): Promise<RecordItem | null> {
    await delay(150);
    const found = records.find((r) => r.id === id);
    return found && !isToolLockedForAccount(found.toolId) && isRecordVisible(found, records, getActiveCloudUid()) ? found : null;
  },

  async getRecords(filter: { toolId?: string; entityDefinitionId?: string; statusKey?: string }): Promise<RecordItem[]> {
    await delay();
    const locked = lockedToolIds();
    return visibleRecordsFor(records, getActiveCloudUid())
      .filter(
        (r) =>
          !locked.has(r.toolId) &&
          (!filter.toolId || r.toolId === filter.toolId) &&
          (!filter.entityDefinitionId || r.entityDefinitionId === filter.entityDefinitionId) &&
          (!filter.statusKey || r.statusKey === filter.statusKey),
      )
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  async updateRecord(id: string, patch: { values?: Record<string, FieldValue>; statusKey?: string }): Promise<RecordItem> {
    await delay();
    const record = records.find((r) => r.id === id);
    // un enregistrement masqué (d'un autre compte) est introuvable : jamais modifiable (écran resté ouvert, identifiant connu…)
    if (!record || !isRecordVisible(record, records, getActiveCloudUid())) throw new Error('Enregistrement introuvable.');
    assertToolAvailable(record.toolId);
    const statusChanged = patch.statusKey !== undefined && patch.statusKey !== record.statusKey;
    const previousStatus = record.statusKey ?? null;
    const valueDiff = patch.values
      ? Object.entries(patch.values)
          .filter(([key, value]) => JSON.stringify(record.values[key]) !== JSON.stringify(value))
          .map(([field, to]) => ({ field, from: record.values[field] ?? null, to }))
      : [];
    if (patch.values) record.values = { ...record.values, ...patch.values };
    if (patch.statusKey !== undefined) record.statusKey = patch.statusKey;
    record.updatedAt = new Date().toISOString();
    if (statusChanged) {
      const definition = entityDefinitions.find((item) => item.id === record.entityDefinitionId);
      const previousLabel = definition?.statuses?.find((status) => status.key === previousStatus)?.label ?? 'Sans statut';
      const nextLabel = definition?.statuses?.find((status) => status.key === record.statusKey)?.label ?? record.statusKey;
      logEvent({
        toolId: record.toolId,
        entityDefinitionId: record.entityDefinitionId,
        recordId: record.id,
        type: 'status_changed',
        summary: `Statut changé : ${previousLabel} → ${nextLabel}.`,
        diff: [{ field: 'statusKey', from: previousStatus, to: record.statusKey ?? null }],
      });
    }
    if (valueDiff.length > 0) {
      logEvent({
        toolId: record.toolId,
        entityDefinitionId: record.entityDefinitionId,
        recordId: record.id,
        type: 'record_updated',
        summary: `Enregistrement modifié (${valueDiff.length} champ${valueDiff.length > 1 ? 's' : ''}).`,
        diff: valueDiff,
      });
    }
    return record;
  },

  async deleteRecord(id: string): Promise<void> {
    await delay();
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) return;
    if (!isRecordVisible(records[index], records, getActiveCloudUid())) return; // masqué (autre compte) : jamais supprimé
    assertToolAvailable(records[index].toolId); // module verrouillé : aucune suppression
    const [removed] = records.splice(index, 1);
    logEvent({
      toolId: removed.toolId,
      entityDefinitionId: removed.entityDefinitionId,
      recordId: removed.id,
      type: 'record_deleted',
      summary: 'Enregistrement supprimé.',
    });
  },

  // ================= ToolMembers =================
  async addToolMember(input: {
    toolId: string;
    roleId: string;
    accountType: ToolMemberAccountType;
    userId?: string;
    contactId?: string;
    displayName: string;
  }): Promise<ToolMember> {
    assertToolAvailable(input.toolId);
    await delay();
    const member: ToolMember = {
      id: genId('mem'),
      toolId: input.toolId,
      roleId: input.roleId,
      accountType: input.accountType,
      userId: input.userId,
      contactId: input.contactId,
      displayName: input.displayName,
      status: 'active',
      joinedAt: new Date().toISOString(),
    };
    toolMembers.push(member);
    logEvent({ toolId: input.toolId, type: 'member_added', summary: `${input.displayName} a été ajouté·e.` });
    return member;
  },

  async getToolMembers(toolId: string): Promise<ToolMember[]> {
    await delay();
    if (isToolLockedForAccount(toolId)) return [];
    return toolMembers.filter((m) => m.toolId === toolId);
  },

  async updateToolMember(id: string, patch: Partial<Pick<ToolMember, 'roleId' | 'displayName' | 'status' | 'meta'>>): Promise<ToolMember> {
    await delay();
    const member = toolMembers.find((m) => m.id === id);
    if (!member) throw new Error('Membre introuvable.');
    assertToolAvailable(member.toolId);
    Object.assign(member, patch);
    return member;
  },

  async removeToolMember(id: string): Promise<void> {
    await delay();
    const index = toolMembers.findIndex((m) => m.id === id);
    if (index === -1) return;
    assertToolAvailable(toolMembers[index].toolId);
    const [removed] = toolMembers.splice(index, 1);
    logEvent({ toolId: removed.toolId, type: 'member_removed', summary: `${removed.displayName} a été retiré·e.` });
  },

  // ================= RoleDefinitions (minimal — no permission enforcement yet) =================
  async createRoleDefinition(input: { toolId: string; key: string; label: string; permissions: PermissionSet; isDefault?: boolean }): Promise<RoleDefinition> {
    await delay(150);
    const role: RoleDefinition = { id: genId('role'), toolId: input.toolId, key: input.key, label: input.label, permissions: input.permissions, isDefault: input.isDefault };
    roleDefinitions.push(role);
    return role;
  },

  async getRoleDefinitions(toolId: string): Promise<RoleDefinition[]> {
    await delay(150);
    if (isToolLockedForAccount(toolId)) return [];
    return roleDefinitions.filter((r) => r.toolId === toolId);
  },

  // ================= ExternalContacts =================
  async createExternalContact(input: { name: string; phone?: string; email?: string; note?: string }): Promise<ExternalContact> {
    await delay();
    const contact: ExternalContact = {
      id: genId('contact'),
      name: input.name,
      phone: input.phone,
      email: input.email,
      note: input.note,
      createdBy: CURRENT_USER_ID,
      createdAt: new Date().toISOString(),
      ...(ownerForNewContact() ? { cloudOwnerUid: ownerForNewContact() } : {}), // contexte multi-compte : visible pour son créateur seul
    };
    externalContacts.push(contact);
    return contact;
  },

  async getExternalContact(id: string): Promise<ExternalContact | null> {
    await delay(150);
    const found = externalContacts.find((c) => c.id === id);
    return found && isContactVisible(found, externalContacts, records, getActiveCloudUid()) && !isContactLockedOut(found) ? found : null;
  },

  async getExternalContacts(): Promise<ExternalContact[]> {
    await delay();
    return visibleContactsFor(externalContacts, records, getActiveCloudUid()).filter((c) => c.createdBy === CURRENT_USER_ID && !isContactLockedOut(c));
  },

  async updateExternalContact(
    id: string,
    patch: Partial<Pick<ExternalContact, 'name' | 'phone' | 'email' | 'note' | 'linkedUserId'>>,
  ): Promise<ExternalContact> {
    await delay();
    const contact = externalContacts.find((c) => c.id === id);
    if (!contact || !isContactVisible(contact, externalContacts, records, getActiveCloudUid()) || isContactLockedOut(contact)) throw new Error('Contact introuvable.');
    Object.assign(contact, patch);
    return contact;
  },

  async deleteExternalContact(id: string): Promise<void> {
    await delay();
    const index = externalContacts.findIndex((c) => c.id === id);
    if (index !== -1 && isContactVisible(externalContacts[index], externalContacts, records, getActiveCloudUid()) && !isContactLockedOut(externalContacts[index])) externalContacts.splice(index, 1);
  },

  // ================= Documents =================
  async createDocument(input: {
    recordId?: string;
    toolId?: string;
    fieldKey?: string;
    kind: 'image' | 'file' | 'signature';
    uri: string;
    name?: string;
  }): Promise<DocumentRef> {
    assertDocumentTargetAvailable(input);
    await delay(200);
    const doc: DocumentRef = {
      id: genId('doc'),
      recordId: input.recordId,
      toolId: input.toolId,
      fieldKey: input.fieldKey,
      kind: input.kind,
      uri: input.uri,
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    documents.push(doc);
    return doc;
  },

  async getDocument(id: string): Promise<DocumentRef | null> {
    await delay(150);
    const found = documents.find((d) => d.id === id) ?? null;
    return found && !isDocumentLocked(found) ? found : null; // pièce jointe d'un module verrouillé : introuvable
  },

  // ================= Events (read-only from here — logEvent above is internal) =================
  async getEvents(filter: { toolId?: string; recordId?: string }) {
    await delay(200);
    const locked = lockedToolIds();
    return visibleEventsFor(events, records, getActiveCloudUid())
      .filter((e) => !(e.toolId && locked.has(e.toolId)) && (!filter.toolId || e.toolId === filter.toolId) && (!filter.recordId || e.recordId === filter.recordId))
      .sort((a, b) => (a.at < b.at ? 1 : -1));
  },
};
