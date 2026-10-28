// Configuration Firebase Web : lue dans l'environnement (EXPO_PUBLIC_FIREBASE_*), validée avant toute initialisation. Les tests unitaires utilisent une configuration
// FICTIVE ; la vérification des VRAIES valeurs locales (.env, google-services.json) n'a lieu que si ces fichiers existent, et est sinon explicitement IGNORÉE.

import fs from 'fs';
import path from 'path';
import { assertFirebaseWebConfig, FIREBASE_WEB_ENV_NAMES, firebaseWebConfig, validateFirebaseWebConfig, type FirebaseWebConfig } from '@/constants/firebaseWebConfig';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

// Valeurs MANIFESTEMENT FICTIVES : aucun projet réel.
const FAKE: FirebaseWebConfig = {
  apiKey: 'AIzaFAKE-WEB-KEY-NOT-REAL-0000000000',
  authDomain: 'projet-fictif.firebaseapp.com',
  projectId: 'projet-fictif',
  storageBucket: 'projet-fictif.firebasestorage.app',
  messagingSenderId: '111111111111',
  appId: '1:111111111111:web:0123456789abcdef',
};

const NAMES = Object.values(FIREBASE_WEB_ENV_NAMES);

/** Charge le module avec un environnement précis (sans toucher à l'environnement des autres tests). */
function loadWith(env: Record<string, string | undefined>): typeof import('@/constants/firebaseWebConfig') {
  const saved: Record<string, string | undefined> = {};
  for (const name of NAMES) {
    saved[name] = process.env[name];
    if (env[name] === undefined) delete process.env[name];
    else process.env[name] = env[name];
  }
  try {
    let loaded!: typeof import('@/constants/firebaseWebConfig');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require('@/constants/firebaseWebConfig');
    });
    return loaded;
  } finally {
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

// Fichiers locaux réels (jamais versionnés) : présents sur la machine du propriétaire, absents d'un clone neuf.
const hasLocalEnv = fs.existsSync(path.join(root, '.env'));
const hasLocalAndroid = fs.existsSync(path.join(root, 'google-services.json'));
const itLocal = hasLocalEnv && hasLocalAndroid ? it : it.skip;

function localConfigFromEnvFile(): FirebaseWebConfig {
  const text = read('.env');
  const value = (name: string): string => text.match(new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'\\r\\n]*)["']?\\s*$`, 'm'))?.[1] ?? '';
  return Object.fromEntries(Object.entries(FIREBASE_WEB_ENV_NAMES).map(([field, name]) => [field, value(name)])) as unknown as FirebaseWebConfig;
}

describe('Configuration Firebase Web', () => {
  it('contient exactement les six valeurs, lues depuis EXPO_PUBLIC_FIREBASE_* (accès littéraux), sans aucune valeur écrite dans le fichier', () => {
    expect(Object.keys(firebaseWebConfig)).toHaveLength(6);
    expect(NAMES).toHaveLength(6);
    const src = read('constants/firebaseWebConfig.ts');
    for (const name of NAMES) expect(src).toContain(`process.env.${name}`); // Expo ne remplace que les accès littéraux
    expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/); // aucune clé d'API écrite
    expect(src).not.toMatch(/1:\d{6,}:(web|android|ios):[0-9a-f]+/); // aucun identifiant d'application écrit
    expect(src).not.toMatch(/takarda-[a-z0-9]+-?[a-z0-9]*\.(firebaseapp\.com|firebasestorage\.app)/);
  });

  it('les variables d’environnement alimentent les six champs ; sans variables, la configuration est vide et refusée AVANT toute initialisation, avec un message clair', () => {
    const filled = loadWith({
      EXPO_PUBLIC_FIREBASE_API_KEY: FAKE.apiKey,
      EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: FAKE.authDomain,
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: FAKE.projectId,
      EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: FAKE.storageBucket,
      EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: FAKE.messagingSenderId,
      EXPO_PUBLIC_FIREBASE_APP_ID: FAKE.appId,
    });
    expect(filled.firebaseWebConfig).toEqual(FAKE);
    expect(filled.validateFirebaseWebConfig(filled.firebaseWebConfig)).toEqual([]);
    const empty = loadWith({});
    expect(Object.values(empty.firebaseWebConfig).every((v) => v === '')).toBe(true);
    expect(empty.validateFirebaseWebConfig(empty.firebaseWebConfig)).toHaveLength(6);
    expect(() => empty.assertFirebaseWebConfig(empty.firebaseWebConfig)).toThrow(/Configuration Firebase invalide.*EXPO_PUBLIC_FIREBASE_.*\.env\.example/);
  });

  it('une configuration (fictive) cohérente est valide', () => {
    expect(validateFirebaseWebConfig(FAKE)).toEqual([]);
    expect(assertFirebaseWebConfig(FAKE)).toBe(FAKE);
  });

  itLocal('(ignoré sans .env et google-services.json locaux) la configuration locale réelle est valide et cohérente avec google-services.json (même projet, même numéro)', () => {
    const local = localConfigFromEnvFile();
    expect(validateFirebaseWebConfig(local)).toEqual([]);
    const android = JSON.parse(read('google-services.json'));
    expect(local.projectId).toBe(android.project_info.project_id);
    expect(local.messagingSenderId).toBe(android.project_info.project_number);
    expect(local.storageBucket).toBe(android.project_info.storage_bucket);
  });

  it('refuse un appId Android, une valeur vide ou un projet incohérent', () => {
    const base: FirebaseWebConfig = { ...FAKE };
    expect(validateFirebaseWebConfig({ ...base, appId: '1:111111111111:android:0123456789abcdef' }).join(' ')).toMatch(/WEB/);
    expect(validateFirebaseWebConfig({ ...base, apiKey: '' }).join(' ')).toMatch(/apiKey est vide/);
    expect(validateFirebaseWebConfig({ ...base, apiKey: 'pas-une-cle' }).join(' ')).toMatch(/apiKey/);
    expect(validateFirebaseWebConfig({ ...base, messagingSenderId: '999' }).join(' ')).toMatch(/même projet/);
    expect(validateFirebaseWebConfig({ ...base, authDomain: 'autre.firebaseapp.com' }).join(' ')).toMatch(/authDomain/);
    expect(validateFirebaseWebConfig({ ...base, storageBucket: 'autre.firebasestorage.app' }).join(' ')).toMatch(/storageBucket/);
    expect(() => assertFirebaseWebConfig({ ...base, appId: '' })).toThrow(/Configuration Firebase invalide/);
  });

  it('ne contient aucun secret : seulement des lectures d’environnement, sans import du SDK', () => {
    const src = read('constants/firebaseWebConfig.ts');
    expect(src).not.toMatch(/private_key|client_secret|service[_-]?account|password|BEGIN (RSA )?PRIVATE/i);
    expect(src).not.toMatch(/from ['"](firebase|@firebase)/);
  });

  it('le modèle .env.example est versionnable : six variables, valeurs fictives, aucun secret ; .env et google-services.json sont ignorés par Git', () => {
    const example = read('.env.example');
    for (const name of NAMES) expect(example).toMatch(new RegExp(`^${name}=.+$`, 'm'));
    expect(example).not.toMatch(/takarda/i);
    expect(example).not.toMatch(/AIza[0-9A-Za-z_-]{30,}/);
    expect(example).not.toMatch(/private_key|client_secret|BEGIN (RSA )?PRIVATE/i);
    const ignore = read('.gitignore').split(/\r?\n/).map((l) => l.trim());
    for (const rule of ['.env', '.env.*', '!.env.example', 'google-services.json', 'GoogleService-Info.plist', 'service-account*.json', '*-adminsdk-*.json', 'credentials.json', '*.keystore']) {
      expect(ignore).toContain(rule);
    }
    expect(ignore.indexOf('!.env.example')).toBeGreaterThan(ignore.indexOf('.env.*')); // la négation doit suivre la règle qu'elle excepte
  });
});
