// Cible de la version : « local » (défaut), « test » ou « production ». Fonctions pures + lecture de UNE variable de build.
//
// Pourquoi : jusqu'ici la seule distinction était `__DEV__` (Expo Go / serveur de développement). Or une version installée sur un téléphone (APK ou AAB) n'est jamais en mode
// développement : elle ne pouvait donc viser que la production, et aucun APK ne pouvait être essayé contre le projet de TEST sans risquer la production. La cible est maintenant
// DÉCLARÉE au moment du build (`EXPO_PUBLIC_BUILD_TARGET`, fixée par le profil de build de eas.json) et vérifiée trois fois :
//   1. ici : sans cible valide, la version est « local » : comptes fermés, aucun appel Firebase (comportement actuel, y compris dans les tests) ;
//   2. avant le build : scripts/release/build-gate.js refuse un projet Firebase qui ne correspond pas à la cible, ou une production avec des textes légaux incomplets ;
//   3. à l'exécution : services/firebase/firebaseEnvironment.ts refuse d'initialiser Firebase si le projet de la configuration ne correspond pas à la cible.
// Une valeur inconnue ne « s'ouvre » JAMAIS par erreur : elle vaut « local ».

export type BuildTarget = 'local' | 'test' | 'production';

export const BUILD_TARGET_VARIABLE = 'EXPO_PUBLIC_BUILD_TARGET';

export function resolveBuildTarget(raw: string | undefined | null): BuildTarget {
  return raw === 'test' || raw === 'production' ? raw : 'local';
}

/** Les comptes et la synchronisation ne sont ouverts que par une cible explicite. */
export const cloudEnabledFor = (target: BuildTarget): boolean => target !== 'local';

// L'expression littérale `process.env.EXPO_PUBLIC_…` est remplacée par la valeur au moment du build (Metro) : ne pas la remplacer par une lecture dynamique.
export const BUILD_TARGET: BuildTarget = resolveBuildTarget(process.env.EXPO_PUBLIC_BUILD_TARGET);
