import { create } from 'zustand';
import { formTemplateService } from '@/services/formTemplateService';
import type { AsyncStatus } from './asyncStatus';
import type { FormDefinition, FormTemplate } from '@/types/entities';

interface FormTemplateState {
  templates: FormTemplate[];
  status: AsyncStatus;
  fetchTemplates: () => Promise<void>;
  useTemplate: (templateId: string) => Promise<FormDefinition>;
}

export const useFormTemplateStore = create<FormTemplateState>((set) => ({
  templates: [],
  status: 'idle',

  fetchTemplates: async () => {
    set({ status: 'loading' });
    try {
      const templates = await formTemplateService.listTemplates();
      set({ templates, status: 'success' });
    } catch {
      set({ status: 'error' });
    }
  },

  useTemplate: async (templateId) => {
    return formTemplateService.useTemplate(templateId);
  },
}));
