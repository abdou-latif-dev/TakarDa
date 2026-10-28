// Configuration Firebase Web de TakarDa — lue dans l'ENVIRONNEMENT, jamais écrite dans le dépôt.
//
// Les six valeurs viennent des variables `EXPO_PUBLIC_FIREBASE_*`. En local elles sont dans le fichier `.env` (ignoré par Git, voir
// `.env.example` pour le modèle) ; pour un build EAS elles se définissent comme variables d'environnement du build. Expo ne remplace que les
// accès LITTÉRAUX `process.env.EXPO_PUBLIC_…` : ne pas les écrire autrement.
//
// Ces valeurs sont des IDENTIFIANTS PUBLICS (elles se retrouvent dans l'application distribuée) : elles disent à quel projet parler, elles ne
// protègent rien. La sécurité des données repose sur les règles de sécurité Firestore et sur Authentication, définies côté serveur dans la
// console Firebase. Aucun secret (clé privée, compte de service, mot de passe) ne doit jamais être ajouté ici ni dans `.env`.
//
// Sans ces variables (clone neuf, build sans cloud) la configuration est VIDE : l'application se compile et fonctionne sans compte ; Firebase
// n'est de toute façon jamais initialisé tant que `CLOUD_ACCOUNT_ENABLED` est faux. Si les comptes sont ouverts sans configuration,
// `assertFirebaseWebConfig` lève une erreur claire AVANT toute initialisation.
//
// `google-services.json` (racine du projet, ignoré par Git) est la configuration de l'application ANDROID : il n'est pas lu par le client
// JavaScript et reste en local pour un éventuel passage au natif.

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

/** Noms des variables d'environnement, dans l'ordre des six valeurs (utilisés par les tests et les scripts de garde). */
export const FIREBASE_WEB_ENV_NAMES = {
  apiKey: 'EXPO_PUBLIC_FIREBASE_API_KEY',
  authDomain: 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  storageBucket: 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'EXPO_PUBLIC_FIREBASE_APP_ID',
} as const satisfies Record<keyof FirebaseWebConfig, string>;

export const firebaseWebConfig: FirebaseWebConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

/** Problèmes de la configuration (liste vide = valide). Fonction pure : aucune connexion n'est tentée. */
export function validateFirebaseWebConfig(config: FirebaseWebConfig): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || value.trim() === '') problems.push(`${key} est vide.`);
  }
  if (problems.length > 0) return problems;
  if (!config.apiKey.startsWith('AIza')) problems.push('apiKey ne ressemble pas à une clé d’API Firebase (AIza…).');
  if (!/^1:\d+:web:[0-9a-f]+$/.test(config.appId)) problems.push('appId doit être celui d’une application WEB (1:<numéro>:web:<identifiant>), pas Android ou iOS.');
  if (!/^\d+$/.test(config.messagingSenderId)) problems.push('messagingSenderId doit être numérique.');
  if (config.appId.split(':')[1] !== config.messagingSenderId) problems.push('appId et messagingSenderId ne correspondent pas au même projet.');
  if (config.authDomain !== `${config.projectId}.firebaseapp.com`) problems.push('authDomain ne correspond pas à projectId.');
  if (!config.storageBucket.startsWith(`${config.projectId}.`)) problems.push('storageBucket ne correspond pas à projectId.');
  return problems;
}

/** Lève une erreur claire si la configuration est incomplète ou incohérente (avant toute initialisation de Firebase). */
export function assertFirebaseWebConfig(config: FirebaseWebConfig): FirebaseWebConfig {
  const problems = validateFirebaseWebConfig(config);
  if (problems.length > 0) throw new Error(`Configuration Firebase invalide : ${problems.join(' ')} Renseignez les variables EXPO_PUBLIC_FIREBASE_* (voir .env.example).`);
  return config;
}
