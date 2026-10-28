// Garde d'ENVIRONNEMENT Firebase — F1. Fonctions pures, sans SDK ni réseau.
//
// Règle : une version PUBLIÉE ne parle qu'au projet de PRODUCTION ; une version de DÉVELOPPEMENT (Expo Go, build de développement) ne parle qu'au projet de TEST.
// Un projet inconnu est refusé dans tous les cas. Ainsi un build de production ne peut jamais embarquer la configuration de test par erreur, et un essai sur
// téléphone ne peut jamais écrire dans la production sans une autorisation explicite et volontaire.
//
// Les identifiants ci-dessous sont des identifiants de projet PUBLICS (ils figurent déjà dans les gardes N2) ; un test vérifie qu'ils sont identiques à ceux de
// services/__tests__/firebaseTestProject/real/guardsReal.ts.

export const PRODUCTION_PROJECT_ID = 'takarda-c8cd8';
export const TEST_PROJECT_ID = 'takarda-n2-test';

/** Cible déclarée au build (constants/buildTarget.ts). Absente = comportement historique : une version publiée ne parle qu'à la production. */
export type DeclaredBuildTarget = 'local' | 'test' | 'production';

export interface EnvironmentContext {
  /** `__DEV__` : vrai en développement (Expo Go, serveur de développement), faux dans une version publiée. */
  isDev: boolean;
  /** Autorisation EXPLICITE d'utiliser la production depuis une version de développement (`EXPO_PUBLIC_ALLOW_PRODUCTION_IN_DEV=true`). */
  allowProductionInDev?: boolean;
  /**
   * Cible déclarée au build. « test » : la version (même publiée, par exemple un APK interne) ne peut viser QUE le projet de test ; « production » : QUE la production ;
   * « local » : aucun cloud, donc refus ; absente : comportement historique (version publiée = production seulement).
   */
  buildTarget?: DeclaredBuildTarget;
}

/** Problèmes d'environnement (liste vide = autorisé). Aucun message ne contient autre chose que des noms de projets publics. */
export function environmentProblems(projectId: string, context: EnvironmentContext): string[] {
  if (projectId !== PRODUCTION_PROJECT_ID && projectId !== TEST_PROJECT_ID) return ['le projet de la configuration n’est ni la production ni le projet de test'];
  if (context.buildTarget === 'local') return ['cette version est « locale » : aucune connexion Firebase n’est permise'];
  if (context.buildTarget === 'test') {
    // une version de TEST (APK interne) ne parle qu'au projet de test, en développement comme une fois installée ; jamais à la production, même avec l'autorisation de développement
    return projectId === TEST_PROJECT_ID ? [] : ['une version de TEST ne peut utiliser que la configuration du projet de TEST'];
  }
  if (context.buildTarget === 'production' && projectId !== PRODUCTION_PROJECT_ID && !context.isDev) {
    return ['une version de PRODUCTION ne peut pas utiliser la configuration du projet de TEST'];
  }
  if (!context.isDev) {
    return projectId === PRODUCTION_PROJECT_ID ? [] : ['une version publiée ne peut pas utiliser la configuration du projet de TEST'];
  }
  if (projectId === TEST_PROJECT_ID) return [];
  return context.allowProductionInDev === true ? [] : ['une version de développement ne peut pas utiliser la PRODUCTION sans autorisation explicite'];
}

/** Lève une erreur claire si la configuration ne convient pas à cet environnement (appelé avant toute initialisation de Firebase). */
export function assertFirebaseEnvironment(projectId: string, context: EnvironmentContext): void {
  const problems = environmentProblems(projectId, context);
  if (problems.length > 0) throw new Error(`Environnement Firebase refusé : ${problems.join(' ; ')}.`);
}
