// Fenêtre « un compte est nécessaire » : textes et décision, sans interface (testable).
//
// Elle apparaît quand l'utilisateur veut enregistrer durablement son travail personnel, le retrouver plus tard ou utiliser la
// synchronisation. Tant que les comptes ne sont pas ouverts (constants/features.ts), « S'inscrire » et « Se connecter » ne mènent
// à AUCUN écran de compte : ils expliquent que les comptes ouvrent bientôt. Rien n'est envoyé nulle part.

export type AccountPromptReason = 'sync' | 'demo_save' | 'personal_start';
export type AccountChoice = 'sign-up' | 'login';

export interface AccountPromptCopy {
  title: string;
  message: string;
}

export function accountPromptCopy(reason: AccountPromptReason): AccountPromptCopy {
  if (reason === 'personal_start') {
    return {
      title: 'Un compte est nécessaire',
      message:
        'Pour commencer votre travail personnel et le retrouver plus tard, un compte est nécessaire. Vous pouvez continuer à explorer la démonstration sans compte : ce que vous y faites n’est pas enregistré comme votre travail.',
    };
  }
  if (reason === 'demo_save') {
    return {
      title: 'Un compte est nécessaire',
      message:
        'Les exemples de démonstration sont séparés de vos données personnelles : ils ne sont pas enregistrés comme votre travail. Pour enregistrer votre travail durablement et le retrouver plus tard, un compte est nécessaire.',
    };
  }
  return {
    title: 'Un compte est nécessaire',
    message:
      'Pour retrouver vos données sur un autre téléphone ou utiliser la synchronisation, un compte est nécessaire. Sans compte, TakarDa continue de fonctionner sur ce téléphone et vos données y restent.',
  };
}

export const ACCOUNT_UNAVAILABLE_COPY: AccountPromptCopy = {
  title: 'Comptes bientôt disponibles',
  message:
    'L’ouverture des comptes n’est pas encore activée dans cette version de démonstration. Vos exemples restent disponibles ici et vos données personnelles ne sont pas touchées.',
};

export type CloudAuthStatus = 'initializing' | 'signedOut' | 'signedIn';

/** Accueil : texte du bloc « S'inscrire / Se connecter ». L'inscription reste facultative : on découvre l'application sans compte. */
export const HOME_ACCOUNT_PROMPT_COPY: AccountPromptCopy = {
  title: 'Créez votre compte',
  message: 'Facultatif : vous pouvez explorer TakarDa sans compte.',
};

/**
 * Le bloc « S'inscrire / Se connecter » de l'accueil s'affiche tant que personne n'est connecté, et disparaît une fois connecté.
 * Comptes fermés : personne ne peut être connecté, il s'affiche toujours. Comptes ouverts : jamais pendant la restauration de la
 * session (aucun clignotement pour quelqu'un qui est déjà connecté).
 */
export function showHomeAccountPrompt(cloudAccountEnabled: boolean, authStatus: CloudAuthStatus): boolean {
  if (!cloudAccountEnabled) return true;
  return authStatus === 'signedOut';
}

export type AccountChoiceResult = { kind: 'navigate'; route: '/(auth)/sign-up' | '/(auth)/login' } | { kind: 'unavailable' };

/** Que faire quand l'utilisateur appuie sur « S'inscrire » ou « Se connecter » ? Jamais d'écran de compte si les comptes sont fermés. */
export function resolveAccountChoice(choice: AccountChoice, cloudAccountEnabled: boolean): AccountChoiceResult {
  if (!cloudAccountEnabled) return { kind: 'unavailable' };
  return { kind: 'navigate', route: choice === 'sign-up' ? '/(auth)/sign-up' : '/(auth)/login' };
}
