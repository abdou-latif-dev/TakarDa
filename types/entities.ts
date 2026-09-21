// Core domain entities for FormEase.
// These model the data the mock services return today and that a real
// backend would serve tomorrow — keep this file the single source of truth
// for shapes shared across features/, store/ and services/.

export type ID = string;
export type ISODateString = string;

export type UserRole = 'admin' | 'member' | 'agent';

export interface User {
  id: ID;
  formeaseId: string; // short, shareable handle (e.g. "FE-4821") used to find a person by ID
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  createdAt: ISODateString;
}

// ---- Groups & memberships -------------------------------------------------
// "Group" is an internal storage abstraction, not a user-facing concept in
// V1 — the only kind a person actually creates and sees is a Tontine. A user
// can belong to (and create) many, with a role per membership — never assume
// a single global role for a user.

export type GroupKind = 'general' | 'tontine';
export type TontineFrequency = 'daily' | 'weekly' | 'monthly' | 'custom';
export type TontineOrderMethod = 'join_order' | 'draw' | 'manual';
export type TontineStatus = 'active' | 'completed';

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
  // Tontine-specific — present when kind === 'tontine'.
  contributionAmount?: number;
  frequency?: TontineFrequency;
  startDate?: ISODateString;
  orderMethod?: TontineOrderMethod;
  currentRound?: number;
  tontineStatus?: TontineStatus;
}

export type MemberAccountType = 'formease_user' | 'guest';

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
  // Tontine rotation & guest-member support.
  accountType?: MemberAccountType;
  phone?: string;
  position?: number;
  hasReceivedPayout?: boolean;
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
  reference: string; // digital-receipt reference, e.g. "FE-98234"
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
  | 'time'
  | 'choice'
  | 'select'
  | 'checkbox'
  | 'image'
  | 'file'
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

/** A pre-built, clonable form — the starting point offered by the template library. */
export interface FormTemplate {
  id: ID;
  name: string;
  description: string;
  category: 'tontine' | 'commerce' | 'inventaire' | 'inscription' | 'feedback' | 'association' | 'couture' | 'autre';
  icon: string; // MaterialIcons glyph name
  fields: Omit<FormField, 'id' | 'order'>[];
}

export interface FormDefinition {
  id: ID;
  title: string;
  description?: string;
  fields: FormField[];
  ownerId: ID;
  groupId?: ID;
  templateId?: ID;
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
  | 'form_created'
  | 'form_updated'
  | 'qr_scanned'
  | 'group_created'
  | 'activity_created'
  | 'order_updated'
  | 'cycle_completed'
  | 'form_deleted'
  | 'tontine_deleted';

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
  tontinesCount: number;
  tontinesTrend: number | null;
  activitiesCount: number;
  activitiesTrend: number | null;
  weeklyActivity: { label: string; value: number }[];
}

// ================================================================================
// CORE — generic engine (Tool / EntityDefinition / Record)
// --------------------------------------------------------------------------------
// Additive only. Nothing above this line is touched. Tontine (Group/Membership/
// TontineCycle/Contribution) and Forms (FormDefinition/FormField/Submission) keep
// working exactly as before and do NOT go through these types yet — see
// services/coreService.ts's header comment for the migration boundary.
//
// `FieldType` (legacy form engine) already exists above — the Core field-type
// union is named `CoreFieldType` specifically to avoid colliding with it or with
// FieldRenderer.tsx, which must keep working untouched.
// `Record` is a reserved TS utility type — the Core entity-instance type is named
// `RecordItem` to avoid shadowing it.
// ================================================================================

export type ToolKind = 'tontine' | 'immobilier' | 'facture' | 'commerce' | 'custom';

export interface Tool {
  id: ID;
  name: string;
  icon: string;
  kind: ToolKind;
  ownerId: ID;
  templateKey?: string;
  entityDefinitionIds: ID[];
  settings?: Record<string, FieldValue>;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type FieldValue = string | number | boolean | string[] | null;

export type CoreFieldType =
  | 'text'
  | 'number'
  | 'amount'
  | 'phone'
  | 'email'
  | 'date'
  | 'time'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'image'
  | 'file'
  | 'signature'
  | 'relation'
  | 'computed'
  | 'section';

export interface ValidationRule {
  kind: 'minLength' | 'maxLength' | 'min' | 'max' | 'regex';
  value: number | string;
  message?: string;
}

/** Deliberately NOT a free-form expression parser — 4 predefined computation
 * kinds cover the V1 needs (Commerce line totals, related-record sums/counts)
 * without the security/complexity risk of evaluating arbitrary user formulas. */
export type ComputedSpec =
  | { kind: 'multiply'; fields: [string, string] }
  | { kind: 'sum'; fields: string[] }
  | { kind: 'countRelated'; relationField: string }
  | { kind: 'sumRelated'; relationField: string; targetField: string };

export type ConditionExpr =
  | { field: string; op: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'isEmpty' | 'isNotEmpty'; value?: FieldValue }
  | { all: ConditionExpr[] }
  | { any: ConditionExpr[] };

export interface FieldDefinition {
  id: ID;
  key: string; // stable machine key (e.g. "montant") — independent of the display label
  type: CoreFieldType;
  label: string;
  required: boolean;
  defaultValue?: FieldValue;
  options?: FieldOption[]; // select / multiselect — reuses the existing FieldOption shape
  relationTarget?: ID; // EntityDefinition.id this field points to, when type === 'relation'
  computed?: ComputedSpec; // when type === 'computed'
  visibleWhen?: ConditionExpr;
  validation?: ValidationRule[];
  order: number;
}

export interface StatusDefinition {
  key: string; // free string, scoped to one EntityDefinition — never a global enum
  label: string;
  color?: string;
  isTerminal?: boolean;
  order: number;
}

export interface EntityDefinition {
  id: ID;
  toolId: ID;
  key: string;
  label: string;
  labelPlural?: string;
  icon?: string;
  fields: FieldDefinition[];
  statuses?: StatusDefinition[]; // optional — not every entity has a status lifecycle
  isSystem?: boolean; // true for the 4 V1 solutions' built-in entities
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface RecordItem {
  id: ID;
  entityDefinitionId: ID;
  toolId: ID; // denormalized for fast filtering without a join
  values: Record<string, FieldValue>; // keyed by FieldDefinition.key
  statusKey?: string; // references one of EntityDefinition.statuses[].key
  createdBy: ID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface PermissionSet {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canManageTool: boolean;
  canInvite: boolean;
  scope: 'all' | 'own';
}

export interface RoleDefinition {
  id: ID;
  toolId: ID;
  key: string; // "proprietaire" | "gestionnaire" | "enseignant"... — free per Tool, not a global enum
  label: string;
  permissions: PermissionSet;
  isDefault?: boolean;
}

export type ToolMemberAccountType = 'user' | 'external';

export interface ToolMember {
  id: ID;
  toolId: ID;
  roleId: ID;
  accountType: ToolMemberAccountType;
  userId?: ID; // set when accountType === 'user'
  contactId?: ID; // set when accountType === 'external'
  displayName: string;
  status: 'active' | 'invited' | 'inactive';
  joinedAt: ISODateString;
  meta?: Record<string, FieldValue>; // domain-specific extras (e.g. tontine rotation position), kept out of the core shape
}

export interface ExternalContact {
  id: ID;
  name: string;
  phone?: string;
  email?: string;
  note?: string;
  createdBy: ID;
  linkedUserId?: ID; // filled in later if this person ever creates a real TakarDa account — not built yet
  createdAt: ISODateString;
}

export interface DocumentRef {
  id: ID;
  recordId?: ID;
  toolId?: ID;
  fieldKey?: string;
  kind: 'image' | 'file' | 'signature';
  uri: string; // local URI today, remote URL once a backend exists
  name?: string;
  createdAt: ISODateString;
}

export type CoreEventType =
  | 'tool_created'
  | 'record_created'
  | 'record_updated'
  | 'record_deleted'
  | 'status_changed'
  | 'member_added'
  | 'member_removed';

/** Generic, cross-domain event log — deliberately separate from the legacy
 * ActivityEvent (still used by Tontine/Forms) rather than merging the two now. */
export interface CoreEvent {
  id: ID;
  toolId?: ID;
  entityDefinitionId?: ID;
  recordId?: ID;
  type: CoreEventType;
  actorId?: ID;
  actorName?: string;
  summary: string;
  diff?: { field: string; from: FieldValue; to: FieldValue }[]; // only for meaningful changes, never per keystroke
  at: ISODateString;
}

export type WorkflowTrigger = 'record_created' | 'record_updated' | 'status_changed' | 'date_reached';

export type WorkflowAction =
  | { kind: 'setStatus'; statusKey: string }
  | { kind: 'setField'; fieldKey: string; value: FieldValue }
  | { kind: 'createRecord'; entityDefinitionId: ID; values: Record<string, FieldValue> }
  | { kind: 'adjustRelatedField'; relationField: string; targetField: string; delta: number }
  | { kind: 'notify'; message: string; toRoleId?: ID };

export interface WorkflowRule {
  id: ID;
  toolId: ID;
  entityDefinitionId: ID;
  trigger: WorkflowTrigger;
  when?: ConditionExpr;
  actions: WorkflowAction[];
}

export interface StatQuery {
  entityDefinitionId: ID;
  filter?: ConditionExpr;
  groupBy?: 'status' | string;
  aggregate: 'count' | 'sum' | 'avg';
  aggregateField?: string;
}
