import { activityEvents, CURRENT_USER_ID, delay, forms, genId, submissions } from './db';
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
    activityEvents.unshift({
      id: genId('a'),
      type: 'form_created',
      title: 'Formulaire créé',
      description: `${form.title} a été créé.`,
      at: form.createdAt,
    });
    return form;
  },

  async updateForm(formId: string, patch: { title?: string; description?: string }): Promise<FormDefinition> {
    await delay(150);
    const form = forms.find((f) => f.id === formId);
    if (!form) throw new Error('Formulaire introuvable.');
    Object.assign(form, patch);
    form.updatedAt = new Date().toISOString();
    activityEvents.unshift({
      id: genId('a'),
      type: 'form_updated',
      title: 'Modèle modifié',
      description: `${form.title} a été mis à jour.`,
      at: form.updatedAt,
    });
    return form;
  },

  /** Deletes a user's model and its collected submissions. Never touches formTemplates. */
  async deleteForm(formId: string): Promise<void> {
    await delay();
    const index = forms.findIndex((f) => f.id === formId);
    if (index === -1) return;
    const [removed] = forms.splice(index, 1);
    for (let i = submissions.length - 1; i >= 0; i--) {
      if (submissions[i].formId === formId) submissions.splice(i, 1);
    }
    activityEvents.unshift({
      id: genId('a'),
      type: 'form_deleted',
      title: 'Modèle supprimé',
      description: `${removed.title} a été supprimé.`,
      at: new Date().toISOString(),
    });
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
