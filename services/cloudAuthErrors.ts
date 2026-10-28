// Messages français pour les erreurs de Firebase Authentication et règles de saisie du compte — sans SDK, testable.
// Aucun message destiné à l'utilisateur ne parle de la console Firebase ni d'un réglage technique : ces détails restent dans les journaux de développement.

export const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'Cette adresse e-mail n’est pas valide.',
  'auth/missing-email': 'Indiquez votre adresse e-mail.',
  'auth/missing-password': 'Indiquez votre mot de passe.',
  'auth/user-not-found': 'Aucun compte ne correspond à cette adresse.',
  'auth/wrong-password': 'Mot de passe incorrect.',
  'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
  'auth/invalid-login-credentials': 'E-mail ou mot de passe incorrect.',
  'auth/email-already-in-use': 'Un compte existe déjà avec cette adresse. Connectez-vous plutôt.',
  'auth/weak-password': 'Mot de passe trop faible : au moins 8 caractères, avec une lettre et un chiffre.',
  'auth/network-request-failed': 'Pas de connexion Internet. Réessayez quand vous êtes en ligne.',
  'auth/too-many-requests': 'Trop de tentatives. Patientez quelques minutes puis réessayez.',
  'auth/user-disabled': 'Ce compte a été désactivé.',
  'auth/operation-not-allowed': 'La connexion par e-mail est momentanément indisponible. Réessayez plus tard.',
  'auth/requires-recent-login': 'Reconnectez-vous pour effectuer cette action.',
  'auth/user-mismatch': 'Ce mot de passe ne correspond pas au compte connecté.',
  'auth/user-token-expired': 'Votre session a expiré. Reconnectez-vous puis réessayez.',
  'auth/quota-exceeded': 'Le service est très sollicité en ce moment. Réessayez plus tard.',
  'auth/internal-error': 'Le service de compte a rencontré une erreur. Réessayez dans un instant.',
  'auth/invalid-api-key': 'Le service de compte n’est pas disponible dans cette version de l’application.',
  'auth/api-key-not-valid': 'Le service de compte n’est pas disponible dans cette version de l’application.',
  'auth/app-not-authorized': 'Le service de compte n’est pas disponible dans cette version de l’application.',
  'auth/unauthorized-domain': 'Le service de compte n’est pas disponible dans cette version de l’application.',
  'app/no-session': 'Aucune session active. Connectez-vous puis réessayez.',
  'app/cloud-not-configured': 'Le service de compte n’est pas configuré dans cette version de l’application.',
  'app/environment-refused': 'Le service de compte n’est pas disponible dans cette version de l’application.',
  'app/email-not-verified': 'Vérifiez d’abord votre adresse e-mail (lien reçu par e-mail), puis réessayez.',
  'app/verification-too-soon': 'Un e-mail vient d’être envoyé. Patientez une minute avant d’en demander un autre.',
};

/** Code d’une erreur Firebase (`auth/...`), ou null. */
export function authErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/** Erreurs levées par NOTRE code (configuration ou environnement refusés) : reconnues à leur message, sans code Firebase. */
export function appErrorCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('Configuration Firebase invalide')) return 'app/cloud-not-configured';
  if (message.startsWith('Environnement Firebase refusé')) return 'app/environment-refused';
  return null;
}

export function mapAuthError(error: unknown): string {
  const code = authErrorCode(error) ?? appErrorCode(error);
  if (code && AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  // codes Firebase « à rallonge » (ex. auth/api-key-not-valid.-please-pass-a-valid-api-key.) : on retient le début
  if (code) {
    const base = Object.keys(AUTH_MESSAGES).find((known) => code.startsWith(`${known}.`));
    if (base) return AUTH_MESSAGES[base];
  }
  return 'Une erreur est survenue. Réessayez.';
}

export interface EmailPasswordCheck {
  ok: boolean;
  message: string | null;
}

export const PASSWORD_MIN_LENGTH = 8;

/**
 * Règle de mot de passe à l'INSCRIPTION (la connexion n'impose rien : les comptes existants gardent leur mot de passe) :
 * au moins 8 caractères, au moins une lettre et un chiffre, différent de l'adresse e-mail. Le serveur reste l'arbitre.
 */
export function passwordProblem(password: string, email = ''): string | null {
  if (password.length < PASSWORD_MIN_LENGTH || !/[A-Za-zÀ-ÿ]/.test(password) || !/[0-9]/.test(password)) return AUTH_MESSAGES['auth/weak-password'];
  if (email.trim() && password.toLowerCase() === email.trim().toLowerCase()) return 'Le mot de passe ne doit pas être votre adresse e-mail.';
  return null;
}

/** Vérifications locales avant d’appeler Firebase (le serveur reste l’arbitre). */
export function checkEmailPassword(email: string, password: string, opts: { confirm?: string } = {}): EmailPasswordCheck {
  const e = email.trim();
  if (!e) return { ok: false, message: AUTH_MESSAGES['auth/missing-email'] };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, message: AUTH_MESSAGES['auth/invalid-email'] };
  if (!password) return { ok: false, message: AUTH_MESSAGES['auth/missing-password'] };
  if (opts.confirm !== undefined) {
    const problem = passwordProblem(password, e);
    if (problem) return { ok: false, message: problem };
    if (password !== opts.confirm) return { ok: false, message: 'Les deux mots de passe ne sont pas identiques.' };
  }
  return { ok: true, message: null };
}
