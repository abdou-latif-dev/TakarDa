import { activityEvents, CURRENT_USER_ID, delay, formTemplates, genId, forms } from './db';
import type { FormDefinition, FormTemplate } from '@/types/entities';

export const formTemplateService = {
  async listTemplates(): Promise<FormTemplate[]> {
    await delay(300);
    return formTemplates;
  },

  /** Clones a template's fields into a brand new, editable form. */
  async useTemplate(templateId: string): Promise<FormDefinition> {
    await delay();
    const template = formTemplates.find((t) => t.id === templateId);
    if (!template) throw new Error('Modèle introuvable.');

    const now = new Date().toISOString();
    const form: FormDefinition = {
      id: genId('f'),
      title: template.name,
      description: template.description,
      ownerId: CURRENT_USER_ID,
      templateId: template.id,
      fields: template.fields.map((field, i) => ({ ...field, id: genId('ff'), order: i })),
      responseCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    forms.unshift(form);
    activityEvents.unshift({
      id: genId('a'),
      type: 'form_created',
      title: 'Formulaire créé depuis un modèle',
      description: `${form.title} a été créé à partir du modèle "${template.name}".`,
      at: now,
    });
    return form;
  },
};
