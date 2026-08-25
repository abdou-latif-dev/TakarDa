import { activityEvents, delay, forms, genId, submissions } from './db';
import type { Submission, SubmissionAnswer, SubmissionStatus } from '@/types/entities';

const QR_VALIDITY_HOURS = 24;

export type ScanOutcome =
  | { kind: 'found'; submission: Submission }
  | { kind: 'not_found' }
  | { kind: 'expired'; submission: Submission }
  | { kind: 'already_processed'; submission: Submission };

export const submissionService = {
  async listAll(): Promise<Submission[]> {
    await delay();
    return [...submissions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  async getById(id: string): Promise<Submission | null> {
    await delay(250);
    return submissions.find((s) => s.id === id) ?? null;
  },

  async createSubmission(input: {
    formId: string;
    clientName: string;
    answers: SubmissionAnswer[];
  }): Promise<Submission> {
    await delay();
    const form = forms.find((f) => f.id === input.formId);
    if (!form) throw new Error('Formulaire introuvable.');
    const now = new Date();
    const submission: Submission = {
      id: genId('s'),
      formId: form.id,
      formTitle: form.title,
      clientId: genId('u'),
      clientName: input.clientName,
      answers: input.answers,
      status: 'pending',
      qrToken: `FE-${Math.floor(1000 + Math.random() * 9000)}-${nanoidLike()}`,
      qrExpiresAt: new Date(now.getTime() + QR_VALIDITY_HOURS * 3600_000).toISOString(),
      history: [{ id: genId('h'), status: 'pending', actorName: input.clientName, at: now.toISOString() }],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    submissions.unshift(submission);
    form.responseCount += 1;
    activityEvents.unshift({
      id: genId('a'),
      type: 'form_submitted',
      title: 'Formulaire soumis',
      description: `${input.clientName} a complété ${form.title}.`,
      at: now.toISOString(),
    });
    return submission;
  },

  async scanToken(token: string): Promise<ScanOutcome> {
    await delay(600);
    const submission = submissions.find((s) => s.qrToken === token.trim());
    if (!submission) return { kind: 'not_found' };
    if (submission.status !== 'pending') return { kind: 'already_processed', submission };
    if (new Date(submission.qrExpiresAt).getTime() < Date.now()) return { kind: 'expired', submission };
    activityEvents.unshift({
      id: genId('a'),
      type: 'qr_scanned',
      title: 'QR code scanné',
      description: `Dossier de ${submission.clientName} ouvert par scan.`,
      at: new Date().toISOString(),
    });
    return { kind: 'found', submission };
  },

  async setStatus(id: string, status: SubmissionStatus, note?: string, actorName = 'Vous'): Promise<Submission> {
    await delay();
    const submission = submissions.find((s) => s.id === id);
    if (!submission) throw new Error('Dossier introuvable.');
    submission.status = status;
    submission.updatedAt = new Date().toISOString();
    submission.history.push({ id: genId('h'), status, note, actorName, at: submission.updatedAt });
    activityEvents.unshift({
      id: genId('a'),
      type: status === 'validated' ? 'submission_validated' : 'submission_rejected',
      title: status === 'validated' ? 'Dossier validé' : 'Dossier rejeté',
      description: `Le dossier de ${submission.clientName} a été ${status === 'validated' ? 'approuvé' : 'rejeté'}${note ? ` (${note})` : ''}.`,
      at: submission.updatedAt,
    });
    return submission;
  },
};

function nanoidLike() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}
