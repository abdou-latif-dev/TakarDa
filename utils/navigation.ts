// Retour de navigation avec repli : logique pure, testable sans rendu.

export const HOME_ROUTE = '/(tabs)' as const;

export interface BackNavigator {
  canGoBack(): boolean;
  back(): void;
  replace(href: typeof HOME_ROUTE): void;
}

/** Retourne à l'écran précédent s'il existe ; sinon (écran atteint par un remplacement, un lien direct…) va à l'accueil.
 * Évite l'action de retour sans effet (« GO_BACK was not handled ») sans empiler un écran de plus. */
export function goBackOrHome(nav: BackNavigator): void {
  if (nav.canGoBack()) nav.back();
  else nav.replace(HOME_ROUTE);
}
