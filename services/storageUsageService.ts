import { delay, forms, submissions } from './db';
import { isModuleLocked } from './moduleLock';

export interface LocalStorageUsage {
  formsCount: number;
  submissionsCount: number;
  attachmentFieldsCount: number;
}

/**
 * FormEase V1 is local-first with no real backend, so there is no server
 * quota to report. This counts what's actually on the device instead of
 * fabricating a cloud storage number.
 */
export const storageUsageService = {
  async getUsage(): Promise<LocalStorageUsage> {
    await delay(200);
    if (isModuleLocked('formulaires')) return { formsCount: 0, submissionsCount: 0, attachmentFieldsCount: 0 }; // compteurs sans propriétaire : masqués en contexte multi-compte
    const attachmentFieldsCount = forms.reduce(
      (sum, f) => sum + f.fields.filter((field) => field.type === 'image' || field.type === 'file' || field.type === 'signature').length,
      0,
    );
    return {
      formsCount: forms.length,
      submissionsCount: submissions.length,
      attachmentFieldsCount,
    };
  },
};
