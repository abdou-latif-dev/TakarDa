// Raccourcis du « + » de Mes Outils : Formulaire, Scanner, Catalogue. Données pures, testables.
//
// Formulaire et Scanner ouvrent les VRAIS parcours existants (routes conservées depuis les premières
// versions). Le Scanner a besoin de la caméra : si la configuration Android bloque cette permission
// (c'est le cas de la V1), il n'est PAS proposé (`visibleShortcuts`) : on ne montre pas une fonction qui ne peut pas marcher. Le code du scanner est conservé : il réapparaît
// de lui-même le jour où la caméra est autorisée dans la configuration.

import type { ComponentProps } from 'react';
import type { MaterialIcons } from '@expo/vector-icons';

export const CAMERA_PERMISSION = 'android.permission.CAMERA';

export interface AddShortcut {
  id: 'formulaire' | 'scanner' | 'catalogue';
  title: string;
  description: string;
  icon: ComponentProps<typeof MaterialIcons>['name'];
  route: string;
  /** Nécessite la caméra de l'appareil. */
  needsCamera?: boolean;
}

export const ADD_SHORTCUTS: readonly AddShortcut[] = [
  { id: 'formulaire', title: 'Formulaire', description: 'Créer un formulaire à remplir ou à partager.', icon: 'assignment', route: '/form/new' },
  { id: 'scanner', title: 'Scanner', description: 'Scanner un QR code avec la caméra.', icon: 'qr-code-scanner', route: '/scan', needsCamera: true },
  { id: 'catalogue', title: 'Catalogue', description: 'Découvrir, ajouter et gérer les outils disponibles.', icon: 'dashboard-customize', route: '/mes-outils/catalogue' },
];

/** Le raccourci est-il utilisable ? Sur Android, la caméra est indisponible si la permission est bloquée dans la configuration. */
export function shortcutAvailability(shortcut: AddShortcut, platform: string, blockedAndroidPermissions: readonly string[] | undefined): { available: boolean; reason?: string } {
  if (shortcut.needsCamera && platform === 'android' && (blockedAndroidPermissions ?? []).includes(CAMERA_PERMISSION)) {
    return { available: false, reason: 'Indisponible dans cette version : l’accès à la caméra n’est pas activé sur Android.' };
  }
  return { available: true };
}

/** Raccourcis proposés à l'utilisateur : ceux dont la fonction est réellement utilisable sur cette plateforme avec cette configuration. */
export function visibleShortcuts(platform: string, blockedAndroidPermissions: readonly string[] | undefined): AddShortcut[] {
  return ADD_SHORTCUTS.filter((shortcut) => shortcutAvailability(shortcut, platform, blockedAndroidPermissions).available);
}
