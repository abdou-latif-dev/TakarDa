// Garde-fous du lot N2 — fonctions PURES (aucun SDK, aucun réseau), donc testables partout, y compris dans la suite normale.
//
// N2 parle à UN SEUL projet Firebase réel : le projet de TEST « takarda-n2-test ». Tout le reste est refusé : la production,
// tout autre projet, toute configuration incohérente, toute variable donnant accès à un compte de service ou à un émulateur.
// Ce module n'importe NI la configuration de production NI le client applicatif.

import { resolveProductionReference } from '../../../../scripts/firebase-test/productionReference';

export class RealGuardError extends Error {
  constructor(message: string) {
    super(`GARDE-FOU N2 : ${message}`);
    this.name = 'RealGuardError';
  }
}

/** Seul projet autorisé (liste d'autorisation, pas de liste de refus seule). */
export const TEST_PROJECT_ID = 'takarda-n2-test';
export const TEST_PROJECT_NUMBER = '438284688014';

/** Projets réels connus : jamais utilisables ici (refus explicite, message dédié). */
export const PRODUCTION_PROJECT_IDS: readonly string[] = ['takarda-c8cd8'];
export const PRODUCTION_PROJECT_NUMBERS: readonly string[] = ['150945512965'];

/** Seuls services joignables (avec la boucle locale) : Authentication, jeton, Firestore. Tout autre hôte est bloqué. */
export const ALLOWED_HOSTS: readonly string[] = ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com'];
const KEY_CHECKED_HOSTS = ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com'];

/** Au plus ce nombre de comptes jetables par exécution (limites anti-abus d'Authentication, quotas). */
export const MAX_TEST_ACCOUNTS = 40;
/** Budget d'opérations Firestore estimées par exécution (quota Spark : de l'ordre de 20 000 écritures et 50 000 lectures par jour). */
export const DEFAULT_OPERATION_BUDGET = 8000;

/** Variables qui donneraient un autre accès que celui d'un compte jetable du projet de test. */
export const FORBIDDEN_ENV_VARS_REAL: readonly string[] = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'FIREBASE_TOKEN',
  'FIREBASE_AUTH_EMULATOR_HOST',
  'FIRESTORE_EMULATOR_HOST',
];

export interface WebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}
const CONFIG_KEYS: readonly (keyof WebConfig)[] = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

export const isAllowedHost = (host: string): boolean => isLoopbackHost(host) || ALLOWED_HOSTS.includes(host.trim().toLowerCase());

/** Les six valeurs PUBLIQUES de l'application Web du projet de test : exactement ces six clés, toutes des chaînes non vides. */
export function parseWebConfig(raw: unknown): WebConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new RealGuardError('la configuration web doit être un objet JSON.');
  const record = raw as Record<string, unknown>;
  const unknown = Object.keys(record).filter((k) => !CONFIG_KEYS.includes(k as keyof WebConfig));
  if (unknown.length > 0) throw new RealGuardError(`clé(s) inattendue(s) dans la configuration web : ${unknown.join(', ')} (seules les six valeurs publiques sont admises).`);
  for (const key of CONFIG_KEYS) {
    if (typeof record[key] !== 'string' || (record[key] as string).trim() === '') throw new RealGuardError(`configuration web : « ${key} » manquant ou vide.`);
  }
  return Object.fromEntries(CONFIG_KEYS.map((k) => [k, (record[k] as string).trim()])) as unknown as WebConfig;
}

/**
 * Référence de la clé d'API de PRODUCTION, établie à partir de l'environnement (`EXPO_PUBLIC_FIREBASE_*`) et/ou du TEXTE du fichier `.env` local (jamais importé).
 * La clé n'est acceptée comme référence que si la configuration dont elle provient est COMPLÈTE, COHÉRENTE et reconnue comme la production par les constantes
 * versionnées ci-dessus (identifiant et numéro de projet) ; absente, incomplète, copiée du modèle, de projet inconnu, mal formée ou contradictoire entre
 * l'environnement et le `.env` : ce contrôle LÈVE (il ne passe jamais en silence). Aucune valeur n'apparaît dans les messages. Logique partagée avec
 * scripts/firebase-test/verify-target.js (scripts/firebase-test/productionReference.js).
 */
export function productionApiKeysFromEnvironment(env: Record<string, string | undefined>, envFileText: string | null): string[] {
  const reference = resolveProductionReference(env, envFileText, { projectIds: PRODUCTION_PROJECT_IDS, projectNumbers: PRODUCTION_PROJECT_NUMBERS });
  if (!reference.ok) {
    throw new RealGuardError(`référence de PRODUCTION non fiable : ${reference.problems.join(' ; ')}. Impossible de vérifier que la clé de test n’est pas celle de la production — ARRÊT.`);
  }
  return reference.apiKeys;
}

export interface RealEnvironment {
  projectId: string;
  config: WebConfig;
}

/** Valide l'environnement et la configuration ; lève une RealGuardError au moindre doute. Ne fait AUCUN appel réseau. */
export function assertRealTestEnvironment(env: Record<string, string | undefined>, config: WebConfig, productionApiKeys: readonly string[]): RealEnvironment {
  const requested = env.TAKARDA_TEST_PROJECT_ID;
  if (!requested) throw new RealGuardError('TAKARDA_TEST_PROJECT_ID absent : rien ne s’exécute contre un service réel par défaut.');
  if (PRODUCTION_PROJECT_IDS.includes(requested)) throw new RealGuardError(`le projet « ${requested} » est la PRODUCTION : interdit.`);
  if (requested !== TEST_PROJECT_ID) throw new RealGuardError(`le projet « ${requested} » n’est pas dans la liste d’autorisation (« ${TEST_PROJECT_ID} » seulement).`);
  if (env.TAKARDA_CONFIRM_TEST_PROJECT !== requested) throw new RealGuardError('TAKARDA_CONFIRM_TEST_PROJECT doit répéter, saisi à la main, l’identifiant du projet de test.');
  const present = FORBIDDEN_ENV_VARS_REAL.filter((name) => env[name] !== undefined && env[name] !== '');
  if (present.length > 0) throw new RealGuardError(`variable(s) interdite(s) présente(s) : ${present.join(', ')} (compte de service, jeton CLI ou émulateur : non admis en N2).`);
  for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT'] as const) {
    const value = env[name];
    if (value && value !== TEST_PROJECT_ID) throw new RealGuardError(`${name}=« ${value} » n’est pas le projet de test.`);
  }

  if (PRODUCTION_PROJECT_IDS.includes(config.projectId)) throw new RealGuardError('la configuration web désigne la PRODUCTION : interdit.');
  if (config.projectId !== TEST_PROJECT_ID) throw new RealGuardError(`configuration web : projectId « ${config.projectId} » ≠ « ${TEST_PROJECT_ID} ».`);
  if (config.authDomain !== `${TEST_PROJECT_ID}.firebaseapp.com`) throw new RealGuardError('configuration web : authDomain ne correspond pas au projet de test.');
  if (!config.storageBucket.startsWith(`${TEST_PROJECT_ID}.`)) throw new RealGuardError('configuration web : storageBucket ne correspond pas au projet de test.');
  if (PRODUCTION_PROJECT_NUMBERS.includes(config.messagingSenderId)) throw new RealGuardError('configuration web : messagingSenderId est celui de la PRODUCTION.');
  if (config.messagingSenderId !== TEST_PROJECT_NUMBER) throw new RealGuardError(`configuration web : messagingSenderId « ${config.messagingSenderId} » ≠ numéro du projet de test.`);
  if (!new RegExp(`^1:${TEST_PROJECT_NUMBER}:web:[0-9a-f]+$`).test(config.appId)) throw new RealGuardError('configuration web : appId n’est pas celui d’une application WEB du projet de test.');
  if (!config.apiKey.startsWith('AIza')) throw new RealGuardError('configuration web : apiKey ne ressemble pas à une clé d’API Firebase.');
  if (productionApiKeys.includes(config.apiKey)) throw new RealGuardError('configuration web : la clé d’API est celle de la PRODUCTION : interdit.');
  return { projectId: TEST_PROJECT_ID, config };
}

/** Décision du garde réseau pour une requête HTTP(S) : hôte autorisé, clé du projet de test, aucun autre projet dans le chemin. */
export function checkRequestUrl(raw: string, apiKey: string | null): { ok: true } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'adresse illisible' };
  }
  const host = url.hostname.toLowerCase();
  if (!isAllowedHost(host)) return { ok: false, reason: `hôte non autorisé (${host})` };
  if (KEY_CHECKED_HOSTS.includes(host)) {
    if (!apiKey) return { ok: false, reason: 'aucune clé de projet de test configurée' };
    if (url.searchParams.get('key') !== apiKey) return { ok: false, reason: 'la clé de la requête n’est pas celle du projet de test' };
  }
  for (const match of url.pathname.matchAll(/\/projects\/([^/]+)/g)) {
    if (match[1] !== TEST_PROJECT_ID) return { ok: false, reason: `projet « ${match[1]} » dans le chemin` };
  }
  return { ok: true };
}

/** Un jeton d'identité émis par Authentication doit appartenir au projet de test (audience et émetteur). */
export function assertTokenBelongsToTestProject(claims: { aud?: unknown; iss?: unknown }): void {
  if (claims.aud !== TEST_PROJECT_ID) throw new RealGuardError(`le jeton a pour audience « ${String(claims.aud)} », pas « ${TEST_PROJECT_ID} » : ARRÊT.`);
  if (claims.iss !== `https://securetoken.google.com/${TEST_PROJECT_ID}`) throw new RealGuardError(`le jeton a pour émetteur « ${String(claims.iss)} » : ARRÊT.`);
}
