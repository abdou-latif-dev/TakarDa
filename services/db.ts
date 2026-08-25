// In-memory "database" for FormEase.
// Every service module in services/ reads and mutates these arrays instead
// of hitting a real API. Swapping to a real backend later means rewriting
// the functions in services/*.ts — nothing in features/ or store/ should
// import this file directly.
//
// The app ships with an EMPTY dataset on purpose: a real user (or evaluator)
// should build up their own groups, tontines, forms and submissions from a
// clean slate rather than see canned demo content.

import { nanoid } from 'nanoid';
import type {
  ActivityEvent,
  AppNotification,
  Contribution,
  FormDefinition,
  Group,
  Membership,
  Submission,
  TontineCycle,
  User,
} from '@/types/entities';

export const delay = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));

export const CURRENT_USER_ID = 'u-me';

export const users: User[] = [
  { id: CURRENT_USER_ID, name: 'Utilisateur', email: '', createdAt: new Date().toISOString() },
];

export const groups: Group[] = [];
export const memberships: Membership[] = [];
export const tontineCycles: TontineCycle[] = [];
export const contributions: Contribution[] = [];
export const forms: FormDefinition[] = [];
export const submissions: Submission[] = [];
export const activityEvents: ActivityEvent[] = [];
export const notifications: AppNotification[] = [];

export const genId = (prefix: string) => `${prefix}-${nanoid(8)}`;
