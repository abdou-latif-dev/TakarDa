// Ce que montre l'écran Profil en V1 — construit à partir du profil LOCAL existant (User du
// stockage local, lu via authStore/authService) : aucune seconde source de vérité pour l'identité.
//
// TakarDa V1 fonctionne sans compte : ce profil n'existe que sur cet appareil. Rien ici ne présente
// une connexion, une synchronisation, une sauvegarde en ligne ou un partage comme actifs.

import type { ComponentProps } from 'react';
import type { MaterialIcons } from '@expo/vector-icons';
import type { User } from '@/types/entities';

export const LOCAL_PROFILE_NOTE =
  'Profil local : vos informations restent sur cet appareil. Un compte cloud est facultatif ; le partage avec d’autres personnes arrivera dans une prochaine version.';

export interface ProfileView {
  name: string;
  /** Email et téléphone renseignés, sans ligne vide. */
  contact: string[];
  avatarUri: string | undefined;
  /** Identifiant local de l'utilisateur ; null s'il n'y en a pas. */
  localIdLabel: string | null;
  note: string;
}

export function buildProfileView(user: Pick<User, 'name' | 'email' | 'phone' | 'formeaseId' | 'avatarUrl'> | null | undefined): ProfileView {
  const clean = (value: string | undefined) => (typeof value === 'string' ? value.trim() : '');
  return {
    name: clean(user?.name) || 'Utilisateur',
    contact: [clean(user?.email), clean(user?.phone)].filter(Boolean),
    avatarUri: user?.avatarUrl || undefined,
    localIdLabel: clean(user?.formeaseId) ? `ID local : ${clean(user?.formeaseId)}` : null,
    note: LOCAL_PROFILE_NOTE,
  };
}

/** Nom affiché après « Bonjour, » : le prénom (premier mot du nom) ; à défaut « Vous ». Une seule ligne côté écran :
 * un nom très long est tronqué par l'interface, pas ici. */
export function greetingName(user: Pick<User, 'name'> | null | undefined): string {
  const first = (user?.name ?? '').trim().split(/\s+/)[0];
  return first || 'Vous';
}

export interface ProfileEntry {
  id: 'profil' | 'outils' | 'apparence' | 'cloud' | 'stockage' | 'donnees';
  label: string;
  subtitle: string;
  icon: ComponentProps<typeof MaterialIcons>['name'];
  route: string;
}

/** Entrées du Profil V1 : uniquement ce qui fonctionne réellement. Les anciens raccourcis (Immobilier,
 * Factures simples, Statistiques globales) font doublon avec Mes Outils ou mènent à des écrans gelés ;
 * Notifications et Sécurité n'ont pas d'effet réel en V1 et ne sont donc pas présentées. Leurs routes
 * restent en place. « Mes données » (F6) est une information intégrée à l'application, sans lien vers un site : elle existe donc réellement. Il n'existe pas de page d'aide. */
export const PROFILE_ENTRIES: readonly ProfileEntry[] = [
  { id: 'profil', label: 'Mon profil', subtitle: 'Nom, email, téléphone et photo', icon: 'person-outline', route: '/account' },
  { id: 'outils', label: 'Mes Outils', subtitle: 'Vos outils installés et le catalogue', icon: 'dashboard-customize', route: '/(tabs)/outils' },
  { id: 'apparence', label: 'Apparence', subtitle: 'Clair, sombre ou selon le téléphone', icon: 'brightness-6', route: '/account/appearance' },
  { id: 'cloud', label: 'Compte et synchronisation', subtitle: 'Compte facultatif, biens et logements', icon: 'cloud-queue', route: '/account/cloud' },
  { id: 'stockage', label: 'Stockage', subtitle: 'Données sur cet appareil et sauvegarde', icon: 'folder', route: '/account/storage' },
  { id: 'donnees', label: 'Mes données', subtitle: 'Ce qui reste sur votre téléphone et ce qui part dans le cloud', icon: 'shield', route: '/privacy' },
];
