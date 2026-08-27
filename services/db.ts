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
  FormTemplate,
  Group,
  Membership,
  Submission,
  TontineCycle,
  User,
} from '@/types/entities';

export const delay = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));

export const CURRENT_USER_ID = 'u-me';

export const users: User[] = [
  { id: CURRENT_USER_ID, formeaseId: 'FE-4821', name: 'Utilisateur', email: '', createdAt: new Date().toISOString() },
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

// Templates are app-provided content (not user data), so — unlike every
// other collection above — they ship pre-seeded: a template library with
// nothing in it isn't useful to browse.
export const formTemplates: FormTemplate[] = [
  {
    id: 'tpl-tontine',
    name: 'Cotisation Mensuelle',
    description: 'Gérez les apports et les retraits de votre groupe de tontine facilement.',
    category: 'tontine',
    icon: 'savings',
    fields: [
      { type: 'text', label: 'Nom du membre', required: true },
      { type: 'number', label: 'Montant cotisé', required: true },
      { type: 'date', label: 'Date de la cotisation', required: true },
      { type: 'select', label: 'Statut', required: true, options: [{ id: 'o1', label: 'Payé' }, { id: 'o2', label: 'En attente' }] },
    ],
  },
  {
    id: 'tpl-commerce',
    name: 'Commande Client',
    description: 'Formulaire de prise de commande avec calcul automatique des totaux.',
    category: 'commerce',
    icon: 'storefront',
    fields: [
      { type: 'text', label: 'Nom du client', required: true },
      { type: 'phone', label: 'Téléphone', required: true },
      { type: 'text', label: 'Article commandé', required: true },
      { type: 'number', label: 'Quantité', required: true },
      { type: 'number', label: 'Prix unitaire', required: true },
    ],
  },
  {
    id: 'tpl-inventaire',
    name: 'Relevé de Stock',
    description: 'Outil rapide pour le comptage physique de vos articles en entrepôt.',
    category: 'inventaire',
    icon: 'inventory-2',
    fields: [
      { type: 'text', label: 'Référence article', required: true },
      { type: 'text', label: 'Emplacement', required: false },
      { type: 'number', label: 'Quantité comptée', required: true },
      { type: 'image', label: 'Photo (optionnel)', required: false },
    ],
  },
  {
    id: 'tpl-stock',
    name: 'Mouvement de Stock',
    description: 'Enregistrez les entrées et sorties de marchandises.',
    category: 'inventaire',
    icon: 'move-to-inbox',
    fields: [
      { type: 'text', label: 'Article', required: true },
      { type: 'select', label: 'Type de mouvement', required: true, options: [{ id: 'o1', label: 'Entrée' }, { id: 'o2', label: 'Sortie' }] },
      { type: 'number', label: 'Quantité', required: true },
      { type: 'date', label: 'Date', required: true },
    ],
  },
  {
    id: 'tpl-produit',
    name: 'Fiche Produit',
    description: 'Cataloguez rapidement un nouveau produit.',
    category: 'commerce',
    icon: 'sell',
    fields: [
      { type: 'text', label: 'Nom du produit', required: true },
      { type: 'text', label: 'Catégorie', required: false },
      { type: 'number', label: 'Prix de vente', required: true },
      { type: 'image', label: 'Photo du produit', required: false },
    ],
  },
  {
    id: 'tpl-evenement',
    name: 'Événement Annuel',
    description: 'Collectez les informations des participants pour votre prochain grand événement.',
    category: 'inscription',
    icon: 'event',
    fields: [
      { type: 'text', label: 'Nom complet', required: true },
      { type: 'phone', label: 'Téléphone', required: true },
      { type: 'email', label: 'Email', required: false },
      { type: 'select', label: "Type de billet", required: true, options: [{ id: 'o1', label: 'Standard' }, { id: 'o2', label: 'VIP' }] },
    ],
  },
  {
    id: 'tpl-presence',
    name: 'Feuille de Présence',
    description: 'Suivez la présence des membres à vos réunions ou activités.',
    category: 'association',
    icon: 'how-to-reg',
    fields: [
      { type: 'text', label: 'Nom du participant', required: true },
      { type: 'date', label: 'Date', required: true },
      { type: 'checkbox', label: 'Présent', required: false },
      { type: 'signature', label: 'Signature', required: false },
    ],
  },
  {
    id: 'tpl-association',
    name: "Adhésion Association",
    description: "Formulaire d'adhésion pour les nouveaux membres de votre association.",
    category: 'association',
    icon: 'diversity-3',
    fields: [
      { type: 'text', label: 'Nom complet', required: true },
      { type: 'phone', label: 'Téléphone', required: true },
      { type: 'select', label: 'Type de membre', required: true, options: [{ id: 'o1', label: 'Actif' }, { id: 'o2', label: 'Bienfaiteur' }] },
      { type: 'signature', label: 'Signature', required: true },
    ],
  },
  {
    id: 'tpl-equipe',
    name: 'Inscription Équipe',
    description: 'Enregistrez les membres de votre équipe sportive ou de travail.',
    category: 'inscription',
    icon: 'groups',
    fields: [
      { type: 'text', label: 'Nom du joueur', required: true },
      { type: 'number', label: 'Numéro de maillot', required: false },
      { type: 'text', label: 'Poste', required: false },
      { type: 'phone', label: 'Contact', required: true },
    ],
  },
  {
    id: 'tpl-football',
    name: 'Match de Football',
    description: 'Organisez vos matchs : composition, score et présence.',
    category: 'association',
    icon: 'sports-soccer',
    fields: [
      { type: 'text', label: 'Adversaire', required: true },
      { type: 'date', label: 'Date du match', required: true },
      { type: 'time', label: "Heure de coup d'envoi", required: true },
      { type: 'text', label: 'Lieu', required: false },
    ],
  },
  {
    id: 'tpl-inscription',
    name: 'Inscription Générale',
    description: 'Formulaire d\'inscription simple et polyvalent.',
    category: 'inscription',
    icon: 'app-registration',
    fields: [
      { type: 'text', label: 'Nom complet', required: true },
      { type: 'phone', label: 'Téléphone', required: true },
      { type: 'email', label: 'Email', required: false },
    ],
  },
  {
    id: 'tpl-collecte',
    name: 'Collecte de Fonds',
    description: 'Suivez les dons reçus pour une cause ou un projet.',
    category: 'tontine',
    icon: 'volunteer-activism',
    fields: [
      { type: 'text', label: 'Nom du donateur', required: false },
      { type: 'number', label: 'Montant du don', required: true },
      { type: 'date', label: 'Date', required: true },
      { type: 'text', label: 'Message (optionnel)', required: false },
    ],
  },
  {
    id: 'tpl-employe',
    name: 'Fiche Employé',
    description: 'Centralisez les informations de base de vos employés.',
    category: 'autre',
    icon: 'badge',
    fields: [
      { type: 'text', label: 'Nom complet', required: true },
      { type: 'text', label: 'Poste', required: true },
      { type: 'phone', label: 'Téléphone', required: true },
      { type: 'date', label: "Date d'embauche", required: false },
    ],
  },
  {
    id: 'tpl-client',
    name: 'Fiche Client',
    description: 'Enregistrement client avec pièce jointe.',
    category: 'commerce',
    icon: 'person',
    fields: [
      { type: 'text', label: 'Nom', required: true },
      { type: 'text', label: 'Prénom', required: true },
      { type: 'email', label: 'Adresse Email', required: true },
      { type: 'phone', label: 'Numéro de téléphone', required: true },
      { type: 'file', label: "Pièce d'identité", required: false },
    ],
  },
  {
    id: 'tpl-couture',
    name: 'Fiche Client Couture',
    description: 'Prenez les mesures et le suivi de commande de vos clients couture.',
    category: 'couture',
    icon: 'checkroom',
    fields: [
      { type: 'text', label: 'Nom de la cliente / du client', required: true },
      { type: 'phone', label: 'Téléphone', required: true },
      { type: 'number', label: 'Tour de poitrine (cm)', required: false },
      { type: 'number', label: 'Tour de taille (cm)', required: false },
      { type: 'number', label: 'Tour de hanches (cm)', required: false },
      { type: 'number', label: 'Longueur (cm)', required: false },
      { type: 'text', label: 'Modèle souhaité', required: false },
      { type: 'image', label: "Photo du modèle", required: false },
      { type: 'date', label: 'Date de livraison prévue', required: false },
    ],
  },
  {
    id: 'tpl-feedback',
    name: 'Satisfaction Client',
    description: 'Recueillez les avis et suggestions pour améliorer vos services.',
    category: 'feedback',
    icon: 'reviews',
    fields: [
      { type: 'select', label: 'Niveau de satisfaction', required: true, options: [{ id: 'o1', label: 'Très satisfait' }, { id: 'o2', label: 'Satisfait' }, { id: 'o3', label: 'Insatisfait' }] },
      { type: 'text', label: 'Suggestion (optionnel)', required: false },
    ],
  },
];
