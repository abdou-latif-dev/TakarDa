import { create } from 'zustand';
import { formService } from '@/services/formService';
import type { AsyncStatus } from './asyncStatus';
import type { FormDefinition, FormField } from '@/types/entities';

interface FormState {
  forms: FormDefinition[];
  status: AsyncStatus;
  error: string | null;
  activeForm: FormDefinition | null;

  fetchForms: () => Promise<void>;
  fetchForm: (formId: string) => Promise<void>;
  createForm: (input: { title: string; description?: string; groupId?: string }) => Promise<FormDefinition>;
  updateForm: (formId: string, patch: { title?: string; description?: string }) => Promise<void>;
  addField: (formId: string, field: Omit<FormField, 'id' | 'order'>) => Promise<FormField>;
  updateField: (formId: string, fieldId: string, patch: Partial<FormField>) => Promise<void>;
  removeField: (formId: string, fieldId: string) => Promise<void>;
}

export const useFormStore = create<FormState>((set) => ({
  forms: [],
  status: 'idle',
  error: null,
  activeForm: null,

  fetchForms: async () => {
    set({ status: 'loading', error: null });
    try {
      const forms = await formService.listMyForms();
      set({ forms, status: 'success' });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : 'Chargement impossible.' });
    }
  },

  fetchForm: async (formId) => {
    const form = await formService.getForm(formId);
    set({ activeForm: form });
  },

  createForm: async (input) => {
    const form = await formService.createForm(input);
    set((s) => ({ forms: [form, ...s.forms], activeForm: form }));
    return form;
  },

  updateForm: async (formId, patch) => {
    const form = await formService.updateForm(formId, patch);
    set((s) => ({
      activeForm: s.activeForm?.id === formId ? form : s.activeForm,
      forms: s.forms.map((f) => (f.id === formId ? form : f)),
    }));
  },

  addField: async (formId, field) => {
    const { form, field: createdField } = await formService.addField(formId, field);
    set((s) => ({
      activeForm: s.activeForm?.id === formId ? form : s.activeForm,
      forms: s.forms.map((f) => (f.id === formId ? form : f)),
    }));
    return createdField;
  },

  updateField: async (formId, fieldId, patch) => {
    const form = await formService.updateField(formId, fieldId, patch);
    set((s) => ({
      activeForm: s.activeForm?.id === formId ? form : s.activeForm,
      forms: s.forms.map((f) => (f.id === formId ? form : f)),
    }));
  },

  removeField: async (formId, fieldId) => {
    const form = await formService.removeField(formId, fieldId);
    set((s) => ({
      activeForm: s.activeForm?.id === formId ? form : s.activeForm,
      forms: s.forms.map((f) => (f.id === formId ? form : f)),
    }));
  },
}));
