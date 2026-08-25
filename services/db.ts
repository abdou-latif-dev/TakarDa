// In-memory mock "database", seeded with realistic sample data.
// Every service module in services/ reads and mutates these arrays instead
// of hitting a real API. Swapping to a real backend later means rewriting
// the functions in services/*.ts — nothing in features/ or store/ should
// import this file directly.

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

export const delay = (ms = 450) => new Promise((resolve) => setTimeout(resolve, ms));

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

export const CURRENT_USER_ID = 'u-amina';

export const users: User[] = [
  { id: 'u-amina', name: 'Amina Traoré', email: 'amina@formease.app', phone: '+225 07 12 34 56', createdAt: daysAgo(120) },
  { id: 'u-kossi', name: 'Kossi Mensah', email: 'kossi@formease.app', createdAt: daysAgo(110) },
  { id: 'u-ama', name: 'Ama Koffi', email: 'ama@formease.app', createdAt: daysAgo(100) },
  { id: 'u-fatou', name: 'Fatou Diallo', email: 'fatou@formease.app', createdAt: daysAgo(90) },
  { id: 'u-yawa', name: 'Yawa Adjovi', email: 'yawa@formease.app', createdAt: daysAgo(20) },
  { id: 'u-marc', name: 'Marc Lemaire', email: 'marc@formease.app', createdAt: daysAgo(80) },
  { id: 'u-sophie', name: 'Sophie Martin', email: 'sophie@formease.app', createdAt: daysAgo(75) },
  { id: 'u-lucas', name: 'Lucas Bernard', email: 'lucas@formease.app', createdAt: daysAgo(70) },
];

export const groups: Group[] = [
  {
    id: 'g-tontine-copines',
    name: 'Tontine des Copines',
    description: "Cotisation mensuelle entre amies, cycle d'août 2024.",
    kind: 'tontine',
    ownerId: 'u-amina',
    memberCount: 10,
    createdAt: daysAgo(200),
    updatedAt: hoursAgo(3),
  },
  {
    id: 'g-fc-lome',
    name: 'FC Lomé',
    description: 'Club de football amateur — inscriptions et cotisations.',
    kind: 'general',
    ownerId: 'u-amina',
    memberCount: 18,
    createdAt: daysAgo(160),
    updatedAt: daysAgo(2),
  },
  {
    id: 'g-asso-jeunesse',
    name: 'Association Jeunesse',
    description: "Association à but non lucratif d'insertion des jeunes.",
    kind: 'general',
    ownerId: 'u-kossi',
    memberCount: 32,
    createdAt: daysAgo(300),
    updatedAt: daysAgo(5),
  },
  {
    id: 'g-caisse-solidarite',
    name: 'Caisse de Solidarité',
    description: 'Entraide financière pour le quartier.',
    kind: 'tontine',
    ownerId: 'u-amina',
    memberCount: 4,
    createdAt: daysAgo(30),
    updatedAt: hoursAgo(20),
  },
];

export const memberships: Membership[] = [
  // Tontine des Copines (10 members, current user is admin)
  { id: 'm-1', groupId: 'g-tontine-copines', userId: 'u-amina', role: 'admin', displayName: 'Amina', joinedAt: daysAgo(200), lastActiveAt: hoursAgo(0.2), status: 'active' },
  { id: 'm-2', groupId: 'g-tontine-copines', userId: 'u-kossi', role: 'member', displayName: 'Kossi', joinedAt: daysAgo(195), lastActiveAt: hoursAgo(1), status: 'active' },
  { id: 'm-3', groupId: 'g-tontine-copines', userId: 'u-ama', role: 'member', displayName: 'Ama', joinedAt: daysAgo(190), lastActiveAt: daysAgo(1), status: 'active' },
  { id: 'm-4', groupId: 'g-tontine-copines', userId: 'u-fatou', role: 'member', displayName: 'Fatou', joinedAt: daysAgo(180), lastActiveAt: daysAgo(3), status: 'active' },
  { id: 'm-5', groupId: 'g-tontine-copines', userId: 'u-yawa', role: 'member', displayName: 'Yawa', joinedAt: daysAgo(2), lastActiveAt: hoursAgo(4), status: 'active' },
  ...['Alice Dubois', 'Marc Lemaire', 'Sophie Martin', 'Lucas Bernard', 'Grace Kone'].map((name, i) => ({
    id: `m-extra-${i}`,
    groupId: 'g-tontine-copines',
    userId: `u-extra-${i}`,
    role: 'member' as const,
    displayName: name,
    joinedAt: daysAgo(150 - i * 5),
    lastActiveAt: i % 3 === 0 ? daysAgo(1) : hoursAgo(i + 1),
    status: 'active' as const,
  })),

  // FC Lomé
  { id: 'm-fc-1', groupId: 'g-fc-lome', userId: 'u-amina', role: 'admin', displayName: 'Amina', joinedAt: daysAgo(160), status: 'active' },
  { id: 'm-fc-2', groupId: 'g-fc-lome', userId: 'u-marc', role: 'member', displayName: 'Marc', joinedAt: daysAgo(150), status: 'active' },
  { id: 'm-fc-3', groupId: 'g-fc-lome', userId: 'u-lucas', role: 'member', displayName: 'Lucas', joinedAt: daysAgo(140), status: 'active' },

  // Association Jeunesse
  { id: 'm-aj-1', groupId: 'g-asso-jeunesse', userId: 'u-amina', role: 'member', displayName: 'Amina', joinedAt: daysAgo(60), status: 'active' },
  { id: 'm-aj-2', groupId: 'g-asso-jeunesse', userId: 'u-kossi', role: 'admin', displayName: 'Kossi', joinedAt: daysAgo(300), status: 'active' },

  // Caisse de Solidarité (4 members)
  { id: 'm-cs-1', groupId: 'g-caisse-solidarite', userId: 'u-amina', role: 'admin', displayName: 'Amina', joinedAt: daysAgo(30), status: 'active' },
  { id: 'm-cs-2', groupId: 'g-caisse-solidarite', userId: 'u-fatou', role: 'member', displayName: 'Fatou', joinedAt: daysAgo(28), status: 'active' },
  { id: 'm-cs-3', groupId: 'g-caisse-solidarite', userId: 'u-sophie', role: 'member', displayName: 'Sophie', joinedAt: daysAgo(25), status: 'inactive', lastActiveAt: daysAgo(9) },
  { id: 'm-cs-4', groupId: 'g-caisse-solidarite', userId: 'u-yawa', role: 'member', displayName: 'Yawa', joinedAt: daysAgo(1), status: 'invited' },
];

export const tontineCycles: TontineCycle[] = [
  { id: 'c-copines-aug', groupId: 'g-tontine-copines', label: "Cycle d'Août 2024", amountExpectedPerMember: 10000, dueDate: daysAgo(-1), createdAt: daysAgo(20) },
  { id: 'c-solidarite-aug', groupId: 'g-caisse-solidarite', label: "Cycle d'Août 2024", amountExpectedPerMember: 25000, dueDate: daysAgo(-5), createdAt: daysAgo(15) },
];

const copinesMemberIds = memberships.filter((m) => m.groupId === 'g-tontine-copines').map((m) => m.id);
export const contributions: Contribution[] = [
  { id: 'ct-1', groupId: 'g-tontine-copines', cycleId: 'c-copines-aug', memberId: 'm-1', amount: 10000, status: 'paid', paidAt: hoursAgo(0.5), createdAt: hoursAgo(0.5) },
  { id: 'ct-2', groupId: 'g-tontine-copines', cycleId: 'c-copines-aug', memberId: 'm-2', amount: 10000, status: 'paid', paidAt: daysAgo(1), createdAt: daysAgo(1) },
  { id: 'ct-3', groupId: 'g-tontine-copines', cycleId: 'c-copines-aug', memberId: 'm-3', amount: 10000, status: 'pending', createdAt: daysAgo(3) },
  { id: 'ct-4', groupId: 'g-tontine-copines', cycleId: 'c-copines-aug', memberId: 'm-4', amount: 10000, status: 'late', createdAt: daysAgo(10) },
  ...copinesMemberIds.slice(4, 9).map((memberId, i) => ({
    id: `ct-extra-${i}`,
    groupId: 'g-tontine-copines',
    cycleId: 'c-copines-aug',
    memberId,
    amount: 10000,
    status: 'paid' as const,
    paidAt: daysAgo(i + 1),
    createdAt: daysAgo(i + 1),
  })),
  { id: 'ct-cs-1', groupId: 'g-caisse-solidarite', cycleId: 'c-solidarite-aug', memberId: 'm-cs-1', amount: 25000, status: 'paid', paidAt: daysAgo(2), createdAt: daysAgo(2) },
  { id: 'ct-cs-2', groupId: 'g-caisse-solidarite', cycleId: 'c-solidarite-aug', memberId: 'm-cs-2', amount: 25000, status: 'pending', createdAt: daysAgo(1) },
];

export const forms: FormDefinition[] = [
  {
    id: 'f-inscription-membre',
    title: 'Inscription membre',
    description: 'Formulaire d\'adhésion pour les nouveaux membres.',
    ownerId: 'u-amina',
    groupId: 'g-tontine-copines',
    responseCount: 42,
    createdAt: daysAgo(60),
    updatedAt: hoursAgo(2),
    fields: [
      { id: 'ff-1', type: 'text', label: 'Nom complet', placeholder: 'Ex: Jean Dupont', required: true, order: 0 },
      { id: 'ff-2', type: 'phone', label: 'Téléphone', placeholder: '+225 00 00 00 00', required: true, order: 1 },
      { id: 'ff-3', type: 'email', label: 'Email', placeholder: 'jean.dupont@example.com', required: false, order: 2 },
      { id: 'ff-4', type: 'date', label: 'Date de naissance', required: false, order: 3 },
    ],
  },
  {
    id: 'f-demande-adhesion',
    title: "Demande d'adhésion",
    ownerId: 'u-kossi',
    groupId: 'g-asso-jeunesse',
    responseCount: 12,
    createdAt: daysAgo(40),
    updatedAt: daysAgo(2),
    fields: [
      { id: 'ff-5', type: 'text', label: 'Nom complet', required: true, order: 0 },
      { id: 'ff-6', type: 'choice', label: 'Type de membre', required: true, order: 1, options: [{ id: 'o1', label: 'Actif' }, { id: 'o2', label: "Bienfaiteur" }] },
      { id: 'ff-7', type: 'signature', label: 'Signature', required: true, order: 2 },
    ],
  },
  {
    id: 'f-enregistrement-client',
    title: 'Enregistrement client',
    ownerId: 'u-amina',
    responseCount: 89,
    createdAt: daysAgo(90),
    updatedAt: daysAgo(7),
    fields: [
      { id: 'ff-8', type: 'text', label: 'Nom', required: true, order: 0 },
      { id: 'ff-9', type: 'text', label: 'Prénom', required: true, order: 1 },
      { id: 'ff-10', type: 'email', label: 'Adresse Email', required: true, order: 2 },
      { id: 'ff-11', type: 'phone', label: 'Numéro de téléphone', required: true, order: 3 },
      { id: 'ff-12', type: 'image', label: "Pièce d'identité", required: true, order: 4 },
    ],
  },
  {
    id: 'f-expedition',
    title: 'Expédition',
    ownerId: 'u-amina',
    responseCount: 5,
    createdAt: daysAgo(15),
    updatedAt: daysAgo(30),
    fields: [
      { id: 'ff-13', type: 'text', label: 'Adresse de livraison', required: true, order: 0 },
      { id: 'ff-14', type: 'select', label: 'Mode de livraison', required: true, order: 1, options: [{ id: 'o3', label: 'Standard' }, { id: 'o4', label: 'Express' }] },
    ],
  },
];

export const submissions: Submission[] = [
  {
    id: 's-1',
    formId: 'f-enregistrement-client',
    formTitle: 'Enregistrement client',
    clientId: 'u-extra-jean',
    clientName: 'Jean Dupont',
    answers: [
      { fieldId: 'ff-8', value: 'Dupont' },
      { fieldId: 'ff-9', value: 'Jean' },
      { fieldId: 'ff-10', value: 'jean.dupont@example.com' },
      { fieldId: 'ff-11', value: '+225 07 00 00 01' },
    ],
    status: 'pending',
    qrToken: 'FE-8924-TOK',
    qrExpiresAt: hoursAgo(-20),
    history: [{ id: 'h-1', status: 'pending', actorName: 'Jean Dupont', at: daysAgo(1) }],
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  },
  {
    id: 's-2',
    formId: 'f-inscription-membre',
    formTitle: 'Inscription membre',
    clientId: 'u-extra-marie',
    clientName: 'Marie Dubois',
    answers: [{ fieldId: 'ff-1', value: 'Marie Dubois' }, { fieldId: 'ff-2', value: '+225 07 00 00 02' }],
    status: 'pending',
    qrToken: 'FE-7711-TOK',
    qrExpiresAt: hoursAgo(-18),
    history: [{ id: 'h-2', status: 'pending', actorName: 'Marie Dubois', at: daysAgo(2) }],
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
  },
  {
    id: 's-3',
    formId: 'f-enregistrement-client',
    formTitle: 'Enregistrement client',
    clientId: 'u-extra-luc',
    clientName: 'Luc Martin',
    answers: [{ fieldId: 'ff-8', value: 'Martin' }, { fieldId: 'ff-9', value: 'Luc' }],
    status: 'rejected',
    qrToken: 'FE-5533-TOK',
    qrExpiresAt: daysAgo(1),
    history: [
      { id: 'h-3', status: 'pending', actorName: 'Luc Martin', at: daysAgo(4) },
      { id: 'h-4', status: 'rejected', note: 'Document manquant', actorName: 'Amina', at: daysAgo(3) },
    ],
    createdAt: daysAgo(4),
    updatedAt: daysAgo(3),
  },
  {
    id: 's-4',
    formId: 'f-inscription-membre',
    formTitle: 'Inscription membre',
    clientId: 'u-extra-paul',
    clientName: 'Paul Kouassi',
    answers: [{ fieldId: 'ff-1', value: 'Paul Kouassi' }, { fieldId: 'ff-2', value: '+225 07 00 00 04' }],
    status: 'validated',
    qrToken: 'FE-3391-TOK',
    qrExpiresAt: daysAgo(5),
    history: [
      { id: 'h-5', status: 'pending', actorName: 'Paul Kouassi', at: daysAgo(6) },
      { id: 'h-6', status: 'validated', actorName: 'Amina', at: daysAgo(5) },
    ],
    createdAt: daysAgo(6),
    updatedAt: daysAgo(5),
  },
];

export const activityEvents: ActivityEvent[] = [
  { id: 'a-1', type: 'contribution_added', title: 'Cotisation enregistrée', description: 'Amina a payé 10 000 FCFA pour Tontine des Copines.', groupId: 'g-tontine-copines', userName: 'Amina', amount: 10000, at: hoursAgo(0.5) },
  { id: 'a-2', type: 'form_submitted', title: 'Formulaire soumis', description: 'Jean Dupont a complété Enregistrement client.', at: hoursAgo(1) },
  { id: 'a-3', type: 'member_joined', title: 'Nouveau membre', description: 'Yawa a rejoint Tontine des Copines.', groupId: 'g-tontine-copines', userName: 'Yawa', at: hoursAgo(4) },
  { id: 'a-4', type: 'submission_validated', title: 'Dossier validé', description: 'Le dossier de Paul Kouassi a été approuvé.', at: daysAgo(5) },
  { id: 'a-5', type: 'qr_scanned', title: 'QR code scanné', description: "Validation de présence pour l'événement de collecte.", at: daysAgo(1) },
  { id: 'a-6', type: 'submission_rejected', title: 'Dossier rejeté', description: 'Le dossier de Luc Martin a été rejeté (document manquant).', at: daysAgo(3) },
  { id: 'a-7', type: 'group_created', title: 'Groupe créé', description: 'Caisse de Solidarité a été créée.', groupId: 'g-caisse-solidarite', at: daysAgo(30) },
  { id: 'a-8', type: 'member_invited', title: 'Membre invité', description: 'Fatou a été invitée à rejoindre Caisse de Solidarité.', groupId: 'g-caisse-solidarite', at: daysAgo(28) },
];

export const notifications: AppNotification[] = [
  { id: 'n-1', type: 'contribution_due', title: 'Votre cotisation arrive à échéance demain', description: 'Veuillez renouveler votre paiement pour maintenir vos accès.', read: false, at: hoursAgo(2) },
  { id: 'n-2', type: 'form_validated', title: 'Votre formulaire a été validé', description: "Le formulaire d'inscription annuelle a été approuvé par l'administration.", read: false, at: daysAgo(1) },
  { id: 'n-3', type: 'member_joined', title: 'Yawa a rejoint votre groupe', description: 'Souhaitez la bienvenue à Yawa dans "Tontine des Copines".', read: true, at: hoursAgo(4) },
  { id: 'n-4', type: 'system', title: 'Bienvenue sur FormEase', description: 'Découvrez comment créer votre premier formulaire.', read: true, at: daysAgo(5) },
];

export const genId = (prefix: string) => `${prefix}-${nanoid(8)}`;
