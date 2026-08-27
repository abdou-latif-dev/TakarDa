import { create } from 'zustand';
import { submissionService, type ScanOutcome } from '@/services/submissionService';
import { useFormStore } from './formStore';
import type { AsyncStatus } from './asyncStatus';
import type { Submission, SubmissionAnswer, SubmissionStatus } from '@/types/entities';

interface SubmissionState {
  submissions: Submission[];
  status: AsyncStatus;
  error: string | null;
  activeSubmission: Submission | null;
  lastScanOutcome: ScanOutcome | null;

  fetchAll: () => Promise<void>;
  fetchOne: (id: string) => Promise<void>;
  createSubmission: (input: { formId: string; clientName: string; answers: SubmissionAnswer[] }) => Promise<Submission>;
  scan: (token: string) => Promise<ScanOutcome>;
  setStatus: (id: string, status: SubmissionStatus, note?: string) => Promise<Submission>;
}

export const useSubmissionStore = create<SubmissionState>((set) => ({
  submissions: [],
  status: 'idle',
  error: null,
  activeSubmission: null,
  lastScanOutcome: null,

  fetchAll: async () => {
    set({ status: 'loading', error: null });
    try {
      const submissions = await submissionService.listAll();
      set({ submissions, status: 'success' });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : 'Chargement impossible.' });
    }
  },

  fetchOne: async (id) => {
    const submission = await submissionService.getById(id);
    set({ activeSubmission: submission });
  },

  createSubmission: async (input) => {
    const submission = await submissionService.createSubmission(input);
    set((s) => ({ submissions: [submission, ...s.submissions], activeSubmission: submission }));
    // The submission bumped the form's responseCount in db.ts — refresh formStore's
    // cached copy (activeForm/forms) so FormPreviewScreen/MesModelesScreen reflect it immediately.
    await useFormStore.getState().refreshForm(input.formId);
    return submission;
  },

  scan: async (token) => {
    const outcome = await submissionService.scanToken(token);
    set({ lastScanOutcome: outcome, activeSubmission: 'submission' in outcome ? outcome.submission : null });
    return outcome;
  },

  setStatus: async (id, status, note) => {
    const submission = await submissionService.setStatus(id, status, note);
    set((s) => ({
      activeSubmission: s.activeSubmission?.id === id ? submission : s.activeSubmission,
      submissions: s.submissions.map((sub) => (sub.id === id ? submission : sub)),
    }));
    return submission;
  },
}));
