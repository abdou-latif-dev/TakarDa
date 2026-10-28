'use strict';
// Référence de la configuration Firebase de PRODUCTION, utilisée par les garde-fous N2 UNIQUEMENT pour REFUSER qu'elle serve de cible de test.
// JavaScript pur, sans dépendance, sans accès au disque ni au réseau : les appelants (guardsReal.ts, verify-target.js) fournissent le texte du `.env`,
// l'environnement et les constantes de production VERSIONNÉES (identifiants et numéros de projet).
//
// Principe : la clé d'API de production n'est plus écrite dans le dépôt ; sa seule source est le `.env` local (ou l'environnement). Elle n'est donc
// acceptée comme RÉFÉRENCE que si la configuration dont elle provient est complète, cohérente et reconnue comme la production par les constantes
// versionnées. Toute autre situation (absente, incomplète, copiée du modèle, projet inconnu, sources contradictoires) est une ERREUR : on ne peut alors pas
// affirmer que la clé de test n'est pas celle de la production, donc rien ne s'exécute. Aucune valeur n'est jamais reprise dans les messages (noms de champs seulement).

const ENV_NAMES = {
  apiKey: 'EXPO_PUBLIC_FIREBASE_API_KEY',
  authDomain: 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  storageBucket: 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'EXPO_PUBLIC_FIREBASE_APP_ID',
};
const FIELDS = Object.keys(ENV_NAMES);

/** Lit les lignes `NOM=valeur` d'un fichier `.env` (guillemets et préfixe `export` admis). Une variable définie deux fois avec des valeurs différentes est signalée. */
function parseEnvText(text) {
  const values = {};
  const conflicts = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    const name = match[1];
    let value = match[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (name in values && values[name] !== value) conflicts.push(name);
    values[name] = value;
  }
  return { values, conflicts };
}

const configFrom = (get) => Object.fromEntries(FIELDS.map((field) => [field, String(get(ENV_NAMES[field]) || '').trim()]));
const isPresent = (config) => FIELDS.some((field) => config[field] !== '');

// Valeurs typiques d'un modèle ou d'une fausse clé : refusées comme clé de production.
const PLACEHOLDER = /REMPLAC|FAKE|FICTI|EXAMPLE|PLACEHOLDER|CHANGE.?ME|YOUR[_-]?KEY/i;

/** Problèmes d'une configuration candidate à servir de référence de production (noms de champs seulement, jamais de valeur). */
function problemsOf(label, config, constants) {
  const problems = [];
  const missing = FIELDS.filter((field) => config[field] === '');
  if (missing.length > 0) {
    problems.push(`${label} : configuration INCOMPLÈTE (manquant : ${missing.map((f) => ENV_NAMES[f]).join(', ')})`);
    return problems; // inutile d'aller plus loin
  }
  if (!constants.projectIds.includes(config.projectId)) problems.push(`${label} : l'identifiant de projet n'est pas celui d'un projet de production connu`);
  if (!constants.projectNumbers.includes(config.messagingSenderId)) problems.push(`${label} : le numéro de projet n'est pas celui d'un projet de production connu`);
  if (!new RegExp(`^1:${config.messagingSenderId.replace(/[^0-9]/g, '')}:web:[0-9a-f]{8,}$`).test(config.appId)) {
    problems.push(`${label} : l'identifiant d'application n'est pas celui d'une application WEB du même projet`);
  }
  if (config.authDomain !== `${config.projectId}.firebaseapp.com`) problems.push(`${label} : le domaine d'authentification ne correspond pas au projet`);
  if (!config.storageBucket.startsWith(`${config.projectId}.`)) problems.push(`${label} : le bucket ne correspond pas au projet`);
  const key = config.apiKey;
  if (!/^AIza[0-9A-Za-z_-]{35}$/.test(key)) problems.push(`${label} : la clé d'API est mal formée ou tronquée (39 caractères attendus, préfixe « AIza »)`);
  else if (PLACEHOLDER.test(key) || new Set(key.slice(4)).size < 10 || /(.)\1{7,}/.test(key)) problems.push(`${label} : la clé d'API est manifestement fictive (modèle ou valeur de remplissage)`);
  for (const field of FIELDS) if (PLACEHOLDER.test(config[field])) problems.push(`${label} : ${ENV_NAMES[field]} contient une valeur de modèle`);
  return problems;
}

/**
 * Détermine la référence de production fiable.
 *  - `env`      : variables d'environnement (objet nom → valeur) ;
 *  - `envFile`  : texte du fichier `.env` local, ou null s'il est absent ;
 *  - `constants`: { projectIds: string[], projectNumbers: string[] } — identités de production VERSIONNÉES.
 * Retourne { ok: true, apiKeys: [clé] } ou { ok: false, problems: [...] }. Les deux sources, quand elles existent, sont validées SÉPARÉMENT puis comparées champ
 * par champ : jamais de fusion silencieuse (une source partielle ne complète pas l'autre).
 */
function resolveProductionReference(env, envFile, constants) {
  const problems = [];
  const sources = [];
  const fromEnv = configFrom((name) => (env || {})[name]);
  if (isPresent(fromEnv)) sources.push({ label: 'environnement', config: fromEnv });
  if (envFile !== null && envFile !== undefined) {
    const parsed = parseEnvText(envFile);
    for (const name of parsed.conflicts) if (Object.values(ENV_NAMES).includes(name)) problems.push(`fichier .env : ${name} est définie plusieurs fois avec des valeurs différentes`);
    const fromFile = configFrom((name) => parsed.values[name]);
    if (isPresent(fromFile)) sources.push({ label: 'fichier .env', config: fromFile });
  }
  if (sources.length === 0) {
    return { ok: false, problems: ['aucune configuration de production (variables EXPO_PUBLIC_FIREBASE_* ou fichier .env local) : référence introuvable'] };
  }
  for (const source of sources) problems.push(...problemsOf(source.label, source.config, constants));
  if (sources.length === 2) {
    const different = FIELDS.filter((field) => sources[0].config[field] !== sources[1].config[field]);
    if (different.length > 0) problems.push(`contradiction entre l'environnement et le fichier .env (champs : ${different.map((f) => ENV_NAMES[f]).join(', ')})`);
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, apiKeys: [sources[0].config.apiKey] };
}

module.exports = { ENV_NAMES, parseEnvText, resolveProductionReference };
