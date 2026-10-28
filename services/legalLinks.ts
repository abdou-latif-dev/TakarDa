// Liens légaux affichables dans Profil : logique pure, testable. Un lien n'est proposé que si son adresse est une vraie
// adresse https:// ; une valeur absente, mal formée ou d'exemple n'active rien.

import type { ComponentProps } from 'react';
import type { MaterialIcons } from '@expo/vector-icons';

export interface LegalLink {
  id: 'privacy' | 'account-deletion';
  label: string;
  subtitle: string;
  icon: ComponentProps<typeof MaterialIcons>['name'];
  url: string;
}

const PLACEHOLDER_HOSTS = /(^|\.)(example\.(com|org|net)|localhost|test|invalid|local)$/i;

/** Vraie adresse publique : https, un nom de domaine avec un point, aucun espace, pas un domaine d'exemple ni local. */
export function isValidPublicUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const url = value.trim();
  if (url !== value || /\s/.test(url)) return false;
  const match = /^https:\/\/([^/?#:@]+)(:\d+)?(\/[^\s]*)?$/i.exec(url);
  if (!match) return false;
  const host = match[1];
  return host.includes('.') && !PLACEHOLDER_HOSTS.test(host) && !/^\d+(\.\d+){3}$/.test(host);
}

export function buildLegalLinks(urls: { privacy: string | null; accountDeletion: string | null }): LegalLink[] {
  const links: LegalLink[] = [];
  if (isValidPublicUrl(urls.privacy)) {
    links.push({ id: 'privacy', label: 'Politique de confidentialité', subtitle: 'Ouvre la page dans votre navigateur', icon: 'policy', url: urls.privacy });
  }
  if (isValidPublicUrl(urls.accountDeletion)) {
    links.push({ id: 'account-deletion', label: 'Demander la suppression d’un compte', subtitle: 'Sans avoir besoin de l’application', icon: 'delete-outline', url: urls.accountDeletion });
  }
  return links;
}
