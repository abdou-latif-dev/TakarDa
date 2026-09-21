import { create } from 'zustand';
import { coreService } from '@/services/coreService';
import type { AsyncStatus } from './asyncStatus';
import type {
  DocumentRef,
  EntityDefinition,
  ExternalContact,
  FieldValue,
  RecordItem,
  Tool,
  ToolKind,
  ToolMember,
} from '@/types/entities';

const recordsKey = (toolId: string, entityDefinitionId: string) => `${toolId}:${entityDefinitionId}`;

interface CoreState {
  tools: Tool[];
  toolsStatus: AsyncStatus;

  entityDefinitions: Record<string, EntityDefinition[]>; // keyed by toolId
  entityDefinitionsStatus: Record<string, AsyncStatus>;

  records: Record<string, RecordItem[]>; // keyed by `${toolId}:${entityDefinitionId}`
  recordsStatus: Record<string, AsyncStatus>;

  toolMembers: Record<string, ToolMember[]>; // keyed by toolId

  externalContacts: ExternalContact[];
  externalContactsStatus: AsyncStatus;

  fetchTools: (filter?: { kind?: ToolKind }) => Promise<void>;
  createTool: (input: Parameters<typeof coreService.createTool>[0]) => Promise<Tool>;

  fetchEntityDefinitions: (toolId: string) => Promise<void>;
  createEntityDefinition: (input: Parameters<typeof coreService.createEntityDefinition>[0]) => Promise<EntityDefinition>;

  fetchRecords: (filter: { toolId: string; entityDefinitionId: string; statusKey?: string }) => Promise<void>;
  createRecord: (input: Parameters<typeof coreService.createRecord>[0]) => Promise<RecordItem>;
  updateRecord: (
    id: string,
    patch: { values?: Record<string, FieldValue>; statusKey?: string },
    refetch: { toolId: string; entityDefinitionId: string },
  ) => Promise<RecordItem>;
  deleteRecord: (id: string, refetch: { toolId: string; entityDefinitionId: string }) => Promise<void>;

  fetchToolMembers: (toolId: string) => Promise<void>;
  addToolMember: (input: Parameters<typeof coreService.addToolMember>[0]) => Promise<ToolMember>;
  removeToolMember: (id: string, toolId: string) => Promise<void>;

  fetchExternalContacts: () => Promise<void>;
  createExternalContact: (input: Parameters<typeof coreService.createExternalContact>[0]) => Promise<ExternalContact>;

  createDocument: (input: Parameters<typeof coreService.createDocument>[0]) => Promise<DocumentRef>;
  getDocument: (id: string) => Promise<DocumentRef | null>;
}

/** Generic Core store — screens for Tool-based modules (Factures today, later
 * Immobilier/Commerce) go through this, never through coreService directly.
 * Mirrors the existing screen → store → service → db pattern used everywhere
 * else in the app. */
export const useCoreStore = create<CoreState>((set, get) => ({
  tools: [],
  toolsStatus: 'idle',
  entityDefinitions: {},
  entityDefinitionsStatus: {},
  records: {},
  recordsStatus: {},
  toolMembers: {},
  externalContacts: [],
  externalContactsStatus: 'idle',

  fetchTools: async (filter) => {
    set({ toolsStatus: 'loading' });
    try {
      const tools = await coreService.getTools(filter);
      set({ tools, toolsStatus: 'success' });
    } catch {
      set({ toolsStatus: 'error' });
    }
  },

  createTool: async (input) => {
    const tool = await coreService.createTool(input);
    set((s) => ({ tools: [tool, ...s.tools] }));
    return tool;
  },

  fetchEntityDefinitions: async (toolId) => {
    set((s) => ({ entityDefinitionsStatus: { ...s.entityDefinitionsStatus, [toolId]: 'loading' } }));
    try {
      const list = await coreService.getEntityDefinitions(toolId);
      set((s) => ({
        entityDefinitions: { ...s.entityDefinitions, [toolId]: list },
        entityDefinitionsStatus: { ...s.entityDefinitionsStatus, [toolId]: 'success' },
      }));
    } catch {
      set((s) => ({ entityDefinitionsStatus: { ...s.entityDefinitionsStatus, [toolId]: 'error' } }));
    }
  },

  createEntityDefinition: async (input) => {
    const entityDefinition = await coreService.createEntityDefinition(input);
    set((s) => ({
      entityDefinitions: {
        ...s.entityDefinitions,
        [input.toolId]: [...(s.entityDefinitions[input.toolId] ?? []), entityDefinition],
      },
    }));
    return entityDefinition;
  },

  fetchRecords: async (filter) => {
    const key = recordsKey(filter.toolId, filter.entityDefinitionId);
    set((s) => ({ recordsStatus: { ...s.recordsStatus, [key]: 'loading' } }));
    try {
      const list = await coreService.getRecords(filter);
      set((s) => ({
        records: { ...s.records, [key]: list },
        recordsStatus: { ...s.recordsStatus, [key]: 'success' },
      }));
    } catch {
      set((s) => ({ recordsStatus: { ...s.recordsStatus, [key]: 'error' } }));
    }
  },

  createRecord: async (input) => {
    const record = await coreService.createRecord(input);
    const key = recordsKey(input.toolId, input.entityDefinitionId);
    set((s) => ({ records: { ...s.records, [key]: [record, ...(s.records[key] ?? [])] } }));
    return record;
  },

  updateRecord: async (id, patch, refetch) => {
    const record = await coreService.updateRecord(id, patch);
    await get().fetchRecords(refetch);
    return record;
  },

  deleteRecord: async (id, refetch) => {
    await coreService.deleteRecord(id);
    await get().fetchRecords(refetch);
  },

  fetchToolMembers: async (toolId) => {
    const members = await coreService.getToolMembers(toolId);
    set((s) => ({ toolMembers: { ...s.toolMembers, [toolId]: members } }));
  },

  addToolMember: async (input) => {
    const member = await coreService.addToolMember(input);
    await get().fetchToolMembers(input.toolId);
    return member;
  },

  removeToolMember: async (id, toolId) => {
    await coreService.removeToolMember(id);
    await get().fetchToolMembers(toolId);
  },

  fetchExternalContacts: async () => {
    set({ externalContactsStatus: 'loading' });
    try {
      const contacts = await coreService.getExternalContacts();
      set({ externalContacts: contacts, externalContactsStatus: 'success' });
    } catch {
      set({ externalContactsStatus: 'error' });
    }
  },

  createExternalContact: async (input) => {
    const contact = await coreService.createExternalContact(input);
    set((s) => ({ externalContacts: [contact, ...s.externalContacts] }));
    return contact;
  },

  createDocument: (input) => coreService.createDocument(input),
  getDocument: (id) => coreService.getDocument(id),
}));
