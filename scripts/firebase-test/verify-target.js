/* global __dirname */
// Vérification HORS LIGNE de la cible N2 : n'ouvre AUCUNE connexion, ne lit que des fichiers locaux, n'écrit rien.
// Prouve (avant tout test réel) que la configuration ne vise que le projet de TEST « takarda-n2-test ».
//
// Usage (PowerShell) :
//   $env:TAKARDA_TEST_PROJECT_ID = "takarda-n2-test"
//   $env:TAKARDA_CONFIRM_TEST_PROJECT = "takarda-n2-test"
//   $env:TAKARDA_TEST_FIREBASE_CONFIG_FILE = "C:\Users\ousma\n2-local\web-config.json"
//   node scripts/firebase-test/verify-target.js
// Facultatif : TAKARDA_EXPECTED_RULES_SHA (préfixe SHA-256 attendu des règles locales).
// Code de sortie 0 = tout est conforme ; 1 = au moins un contrôle échoue (rien ne doit alors être lancé).
//
// Ces contrôles dupliquent ceux de services/__tests__/firebaseTestProject/real/guardsReal.ts (un test statique vérifie que les
// constantes sont identiques) : ce script est volontairement en JavaScript pur, sans dépendance, exécutable sans Jest.

const crypto = require('crypto');
const { resolveProductionReference } = require('./productionReference');
const fs = require('fs');
const path = require('path');

const TEST_PROJECT_ID = 'takarda-n2-test';
const TEST_PROJECT_NUMBER = '438284688014';
const PRODUCTION_PROJECT_IDS = ['takarda-c8cd8'];
const PRODUCTION_PROJECT_NUMBERS = ['150945512965'];
const FORBIDDEN_ENV_VARS = ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'];
const CONFIG_KEYS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];

const root = path.join(__dirname, '..', '..');
const env = process.env;
const results = [];
const check = (label, ok, detail = '') => results.push({ label, ok: !!ok, detail });

// 1. Variables
check('TAKARDA_TEST_PROJECT_ID = projet de test autorisé', env.TAKARDA_TEST_PROJECT_ID === TEST_PROJECT_ID, `valeur : ${env.TAKARDA_TEST_PROJECT_ID ?? '(absente)'}`);
check('l’identifiant n’est pas un projet de production', !PRODUCTION_PROJECT_IDS.includes(env.TAKARDA_TEST_PROJECT_ID ?? ''));
check('TAKARDA_CONFIRM_TEST_PROJECT répète l’identifiant', !!env.TAKARDA_CONFIRM_TEST_PROJECT && env.TAKARDA_CONFIRM_TEST_PROJECT === env.TAKARDA_TEST_PROJECT_ID);
const forbidden = FORBIDDEN_ENV_VARS.filter((n) => env[n]);
check('aucune variable de compte de service, de jeton CLI ou d’émulateur', forbidden.length === 0, forbidden.join(', '));
const strayProject = ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT'].filter((n) => env[n] && env[n] !== TEST_PROJECT_ID);
check('aucun autre projet par variable d’environnement', strayProject.length === 0, strayProject.join(', '));

// 2. Dépôt : aucun projet par défaut pour la ligne de commande
check('pas de .firebaserc (aucun projet par défaut : --project reste explicite)', !fs.existsSync(path.join(root, '.firebaserc')));

// 3. Configuration web de test (fichier HORS dépôt)
const file = env.TAKARDA_TEST_FIREBASE_CONFIG_FILE;
let config = null;
if (!file) check('fichier de configuration web de test fourni', false, 'TAKARDA_TEST_FIREBASE_CONFIG_FILE absent');
else {
  const resolved = path.resolve(file);
  check('le fichier de configuration est HORS du dépôt', !resolved.toLowerCase().startsWith(root.toLowerCase()), resolved);
  try {
    config = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    check('exactement les six valeurs publiques, non vides', CONFIG_KEYS.every((k) => typeof config[k] === 'string' && config[k].trim()) && Object.keys(config).every((k) => CONFIG_KEYS.includes(k)));
  } catch (error) {
    check('le fichier de configuration est lisible (JSON)', false, String(error.message));
  }
}
if (config && CONFIG_KEYS.every((k) => typeof config[k] === 'string')) {
  check('projectId = projet de test', config.projectId === TEST_PROJECT_ID, `valeur : ${config.projectId}`);
  check('authDomain cohérent', config.authDomain === `${TEST_PROJECT_ID}.firebaseapp.com`);
  check('storageBucket cohérent', config.storageBucket.startsWith(`${TEST_PROJECT_ID}.`));
  check('messagingSenderId = numéro du projet de test', config.messagingSenderId === TEST_PROJECT_NUMBER && !PRODUCTION_PROJECT_NUMBERS.includes(config.messagingSenderId));
  check('appId = application WEB du projet de test', new RegExp(`^1:${TEST_PROJECT_NUMBER}:web:[0-9a-f]+$`).test(config.appId));
  check('apiKey de forme Firebase (AIza…)', config.apiKey.startsWith('AIza'));
  // 4. Clé de production : référence FIABLE seulement (voir productionReference.js) — complète, cohérente et reconnue comme la production par les constantes
  // versionnées ci-dessus. Absente, incomplète, copiée du modèle, de projet inconnu ou contradictoire : contrôle IMPOSSIBLE = échec explicite (sortie 1).
  const envFile = path.join(root, '.env');
  let envText = null;
  let envReadError = false;
  if (fs.existsSync(envFile)) {
    try {
      envText = fs.readFileSync(envFile, 'utf8');
    } catch {
      envReadError = true;
    }
  }
  check('le fichier .env local est lisible (s’il existe)', !envReadError);
  const reference = envReadError ? { ok: false, problems: ['fichier .env illisible'] } : resolveProductionReference(env, envText, { projectIds: PRODUCTION_PROJECT_IDS, projectNumbers: PRODUCTION_PROJECT_NUMBERS });
  check('référence de production FIABLE (configuration complète, cohérente, projet de production reconnu)', reference.ok, reference.ok ? '' : reference.problems.join(' ; '));
  const prodKeys = new Set(reference.ok ? reference.apiKeys : []);
  check('la clé d’API de test n’est PAS celle de la production', prodKeys.size > 0 && !prodKeys.has(config.apiKey), prodKeys.size ? '' : 'clé de production introuvable (variable EXPO_PUBLIC_FIREBASE_API_KEY ou fichier .env local) : contrôle impossible');
}

// 5. Règles locales : empreinte
const rules = fs.readFileSync(path.join(root, 'firestore.rules'));
const sha = crypto.createHash('sha256').update(rules).digest('hex');
const expected = env.TAKARDA_EXPECTED_RULES_SHA;
check('règles locales : empreinte attendue', !expected || sha.startsWith(expected.toLowerCase()), `SHA-256 ${sha.slice(0, 16)}…${expected ? ` (attendu ${expected})` : ' (aucune empreinte attendue fournie : à comparer à la main)'}`);
check('les règles locales contiennent le verrou de suppression (N1.1)', rules.toString('utf8').includes('deletionLockedAt'));

// 6. Configuration d'émulateurs / publication
try {
  const n2 = JSON.parse(fs.readFileSync(path.join(root, 'firebase.n2.json'), 'utf8'));
  check('firebase.n2.json : uniquement les règles, aucun émulateur', Object.keys(n2).join() === 'firestore' && Object.keys(n2.firestore).join() === 'rules' && n2.firestore.rules === 'firestore.rules');
} catch (error) {
  check('firebase.n2.json lisible', false, String(error.message));
}

const width = Math.max(...results.map((r) => r.label.length));
for (const r of results) console.log(`${r.ok ? 'OK    ' : 'ÉCHEC '} ${r.label.padEnd(width)}${r.detail ? `  ${r.detail}` : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? '\nCible conforme : projet de test uniquement (aucune connexion ouverte par ce script).' : `\n${failed} contrôle(s) en échec : NE RIEN LANCER.`);
process.exit(failed === 0 ? 0 : 1);
