import type { ComponentProps } from 'react';
import type { MaterialIcons } from '@expo/vector-icons';

/** Annonce LOCALE de nouveauté, écrite dans l'application. Ce n'est ni une notification ni un message
 * distant : rien n'est envoyé ni reçu, et afficher ou masquer une annonce n'enregistre aucune activité.
 * Plus tard, la source pourra devenir distante sans changer ce format. */
export interface LocalAnnouncement {
  id: string;
  title: string;
  description: string;
  icon: ComponentProps<typeof MaterialIcons>['name'];
  action?: { label: string; route: string };
}

export const ANNOUNCEMENTS: readonly LocalAnnouncement[] = [
  {
    id: 'v1-mes-outils',
    title: 'Nouveau : Mes Outils',
    description: 'Ajoutez Immobilier, Tontine, CEET ou TDE depuis le catalogue. Vous pouvez en retirer un sans perdre ses données.',
    icon: 'dashboard-customize',
    action: { label: 'Ouvrir le catalogue', route: '/mes-outils/catalogue' },
  },
  {
    id: 'v1-commerce-bientot',
    title: 'Commerce : bientôt',
    description: 'Un module Commerce est en préparation. Il n’est pas encore disponible.',
    icon: 'storefront',
  },
];
