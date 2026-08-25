import { CURRENT_USER_ID, delay, forms, genId } from './db';
import type { FormDefinition, FormField } from '@/types/entities';

export const formService = {
  async listMyForms(): Promise<FormDefinition[]> {
    await delay();
    return forms
      .filter((f) => f.ownerId === CURRENT_USER_ID)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  },

  async getForm(formId: string): Promise<FormDefinition | null> {
    await delay(250);
    return forms.find((f) => f.id === formId) ?? null;
  },

  async createForm(input: { title: string; description?: string; groupId?: string }): Promise<FormDefinition> {
    await delay();
    const form: FormDefinition = {
      id: genId('f'),
      title: input.title,
      description: input.description,
      groupId: input.groupId,
      ownerId: CURRENT_USER_ID,
      fields: [],
      responseCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    forms.unshift(form);
    return form;
  },

  async updateForm(formId: string, patch: { title?: string; description?: string }): Promise<FormDefinition> {
    await delay(150);
    const form = forms.find((f) => f.id === formId);
    if (!form) throw new Error('Formulaire introuvable.');
    Object.assign(form, patch);
    form.updatedAt = new Date().toISOString();
    return form;
  },

  async addField(formId: string, field: Omit<FormField, 'id' | 'order'>): Promise<{ form: FormDefinition; field: FormField }> {
    await delay(200);
    const form = forms.find((f) => f.id === formId);
    if (!form) throw new Error('Formulaire introuvable.');
    const newField: FormField = { ...field, id: genId('ff'), order: form.fields.length };
    form.fields.push(newField);
    form.updatedAt = new Date().toISOString();
    return { form, field: newField };
  },

  async updateField(formId: string, fieldId: string, patch: Partial<FormField>): Promise<FormDefinition> {
    await delay(200);
    const form = forms.find((f) => f.id === formId);
    if (!form) throw new Error('Formulaire introuvable.');
    const field = form.fields.find((f) => f.id === fieldId);
    if (field) Object.assign(field, patch);
    form.updatedAt = new Date().toISOString();
    return form;
  },

  async removeField(formId: string, fieldId: string): Promise<FormDefinition> {
    await delay(200);
    const form = forms.find((f) => f.id === formId);
    if (!form) throw new Error('Formulaire introuvable.');
    form.fields = form.fields.filter((f) => f.id !== fieldId);
    form.updatedAt = new Date().toISOString();
    return form;
  },
};
