// Core domain entities for FormEase.
// These model the data the mock services return today and that a real
// backend would serve tomorrow — keep this file the single source of truth
// for shapes shared across features/, store/ and services/.

export type ID = string;
export type ISODateString = string;

export type UserRole = 'admin' | 'member' | 'agent';

export interface User {
  id: ID;
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  createdAt: ISODateString;
}

// ---- Groups & memberships -------------------------------------------------
// A user can belong to (and create) many groups, with a role per membership —
// never assume a single global role for a user.

export type GroupKind = 'general' | 'tontine';

export interface Group {
  id: ID;
  name: string;
  description?: string;
  kind: GroupKind;
  avatarUrl?: string;
  ownerId: ID;
  memberCount: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Membership {
  id: ID;
  groupId: ID;
  userId: ID;
  role: 'admin' | 'member';
  displayName: string;
  avatarUrl?: string;
  joinedAt: ISODateString;
  lastActiveAt?: ISODateString;
  status: 'active' | 'invited' | 'inactive';
}

// ---- Tontine / contributions -----------------------------------------------

export type ContributionStatus = 'paid' | 'pending' | 'late';

export interface TontineCycle {
  id: ID;
  groupId: ID;
  label: string; // e.g. "Cycle d'Août 2024"
  amountExpectedPerMember: number;
  dueDate: ISODateString;
  createdAt: ISODateString;
}

export interface Contribution {
  id: ID;
  groupId: ID;
  cycleId: ID;
  memberId: ID; // Membership.id
  amount: number;
  status: ContributionStatus;
  note?: string;
  paidAt?: ISODateString;
  createdAt: ISODateString;
}

// ---- Dynamic forms ----------------------------------------------------------

export type FieldType =
  | 'text'
  | 'number'
  | 'phone'
  | 'email'
  | 'date'
  | 'choice'
  | 'select'
  | 'checkbox'
  | 'image'
  | 'signature'
  | 'section';

export interface FieldOption {
  id: ID;
  label: string;
}

export interface FormField {
  id: ID;
  type: FieldType;
  label: string;
  placeholder?: string;
  description?: string;
  required: boolean;
  options?: FieldOption[]; // for 'choice' | 'select'
  validation?: 'none' | 'letters_only' | 'email' | 'custom_regex';
  validationRegex?: string;
  order: number;
}

export interface FormDefinition {
  id: ID;
  title: string;
  description?: string;
  fields: FormField[];
  ownerId: ID;
  groupId?: ID;
  responseCount: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// ---- Submissions / dossiers ---------------------------------------------------

export type SubmissionStatus = 'pending' | 'validated' | 'rejected' | 'correction_requested';

export interface SubmissionAnswer {
  fieldId: ID;
  value: string | number | boolean | string[] | null;
}

export interface SubmissionHistoryEntry {
  id: ID;
  status: SubmissionStatus;
  note?: string;
  actorName: string;
  at: ISODateString;
}

export interface Submission {
  id: ID;
  formId: ID;
  formTitle: string;
  clientId: ID;
  clientName: string;
  answers: SubmissionAnswer[];
  status: SubmissionStatus;
  qrToken: string;
  qrExpiresAt: ISODateString;
  history: SubmissionHistoryEntry[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// ---- Activity feed ----------------------------------------------------------

export type ActivityType =
  | 'submission_validated'
  | 'submission_rejected'
  | 'contribution_added'
  | 'member_joined'
  | 'member_invited'
  | 'form_submitted'
  | 'qr_scanned'
  | 'group_created'
  | 'activity_created';

export interface ActivityEvent {
  id: ID;
  type: ActivityType;
  title: string;
  description: string;
  groupId?: ID;
  userName?: string;
  amount?: number;
  at: ISODateString;
}

// ---- Notifications ----------------------------------------------------------

export type NotificationType = 'contribution_due' | 'form_validated' | 'member_joined' | 'system';

export interface AppNotification {
  id: ID;
  type: NotificationType;
  title: string;
  description: string;
  read: boolean;
  at: ISODateString;
}

// ---- Statistics --------------------------------------------------------------

export interface StatisticsOverview {
  formsCount: number;
  formsTrend: number | null;
  qrScannedCount: number;
  qrScannedTrend: number | null;
  groupsCount: number;
  groupsTrend: number | null;
  activitiesCount: number;
  activitiesTrend: number | null;
  weeklyActivity: { label: string; value: number }[];
}
