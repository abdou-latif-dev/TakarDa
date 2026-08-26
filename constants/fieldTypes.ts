import type { ComponentProps } from 'react';
import type { MaterialIcons } from '@expo/vector-icons';
import type { FieldType } from '@/types/entities';

export const FIELD_TYPE_META: Record<
  FieldType,
  { label: string; icon: ComponentProps<typeof MaterialIcons>['name']; description: string }
> = {
  text: { label: 'Texte', icon: 'short-text', description: 'Une ligne de texte libre' },
  number: { label: 'Nombre', icon: 'pin', description: 'Valeur numérique' },
  phone: { label: 'Téléphone', icon: 'call', description: 'Numéro de téléphone' },
  email: { label: 'Email', icon: 'mail-outline', description: 'Adresse email' },
  date: { label: 'Date', icon: 'calendar-today', description: 'Sélecteur de date' },
  time: { label: 'Heure', icon: 'schedule', description: "Sélecteur d'heure" },
  choice: { label: 'Choix', icon: 'radio-button-checked', description: 'Un seul choix parmi plusieurs' },
  select: { label: 'Liste', icon: 'arrow-drop-down-circle', description: 'Sélection dans une liste déroulante' },
  checkbox: { label: 'Case à cocher', icon: 'check-box', description: 'Réponse oui/non' },
  image: { label: 'Photo', icon: 'image', description: 'Photo prise ou choisie dans la galerie' },
  file: { label: 'Fichier', icon: 'attach-file', description: 'Document joint (PDF, etc.)' },
  signature: { label: 'Signature', icon: 'draw', description: 'Signature manuscrite' },
  section: { label: 'Section', icon: 'view-cozy', description: 'Regroupe plusieurs champs en section' },
};

export const FIELD_TYPE_ORDER: FieldType[] = [
  'text',
  'number',
  'phone',
  'email',
  'date',
  'time',
  'choice',
  'select',
  'checkbox',
  'image',
  'file',
  'signature',
  'section',
];
