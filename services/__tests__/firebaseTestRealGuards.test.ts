/**
 * @jest-environment node
 */
// Garde-fous du lot N2 (projet de test réel) : fonctions pures, contrôles statiques et garde réseau. Aucun SDK, aucun réseau :
// le garde réseau n'est testé que sur des destinations REFUSÉES avant l'envoi (plage RFC 5737, domaine .invalid, chemins d'un autre
// projet), puis désinstallé. Tourne dans la suite habituelle.

import dns from 'dns';
import fs from 'fs';
import net from 'net';
import path from 'path';
import {
  ALLOWED_HOSTS,
  assertRealTestEnvironment,
  assertTokenBelongsToTestProject,
  checkRequestUrl,
  FORBIDDEN_ENV_VARS_REAL,
  isAllowedHost,
  MAX_TEST_ACCOUNTS,
  parseWebConfig,
  PRODUCTION_PROJECT_IDS,
  PRODUCTION_PROJECT_NUMBERS,
  productionApiKeysFromEnvironment,
  RealGuardError,
  TEST_PROJECT_ID,
  TEST_PROJECT_NUMBER,
  type WebConfig,
} from './firebaseTestProject/real/guardsReal';
import { FORBIDDEN_ENV_VARS as N1_FORBIDDEN } from './firebaseTestProject/guards';
import { readProductionApiKeys } from './firebaseTestProject/real/productionKeys';
import { configureGuard, getBlockedAttempts, installNetworkGuard, isAllowedSocketDestination, resetBlockedAttempts, uninstallNetworkGuard } from './firebaseTestProject/real/networkGuardReal';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const realDir = 'services/__tests__/firebaseTestProject/real';

// Valeurs MANIFESTEMENT FICTIVES (seul le préfixe « AIza » est exigé par les gardes ; aucune longueur n'est vérifiée).
const TEST_KEY = 'AIzaFAKE-TEST-KEY-NOT-REAL-0000000000';
const FAKE_PROD_KEY = 'AIzaFAKE-PROD-KEY-NOT-REAL-0000000000';
const GOOD_CONFIG: WebConfig = {
  apiKey: TEST_KEY,
  authDomain: `${TEST_PROJECT_ID}.firebaseapp.com`,
  projectId: TEST_PROJECT_ID,
  storageBucket: `${TEST_PROJECT_ID}.firebasestorage.app`,
  messagingSenderId: TEST_PROJECT_NUMBER,
  appId: `1:${TEST_PROJECT_NUMBER}:web:0123456789abcdef`,
};
const GOOD_ENV = { TAKARDA_TEST_PROJECT_ID: TEST_PROJECT_ID, TAKARDA_CONFIRM_TEST_PROJECT: TEST_PROJECT_ID };
// Clé(s) de production RÉELLE(S) : seulement si un `.env` local (ou la variable d'environnement) existe ; sinon liste vide et les tests qui en ont besoin sont
// explicitement IGNORÉS (jamais présentés comme réussis). Les contrôles de LOGIQUE utilisent une fausse clé de production : même couverture, sans clé réelle.
const REAL_PROD_KEYS: string[] = (() => {
  try {
    return readProductionApiKeys();
  } catch {
    return [];
  }
})();
const PROD_KEYS = [FAKE_PROD_KEY, ...REAL_PROD_KEYS];
const itWithLocalProdKey = REAL_PROD_KEYS.length > 0 ? it : it.skip;

describe('N2 · environnement et configuration', () => {
  it('accepte uniquement le projet de test, avec sa configuration cohérente', () => {
    expect(assertRealTestEnvironment(GOOD_ENV, GOOD_CONFIG, PROD_KEYS)).toEqual({ projectId: 'takarda-n2-test', config: GOOD_CONFIG });
    expect(TEST_PROJECT_NUMBER).toBe('438284688014');
  });

  it('refuse sans identifiant, sans confirmation, avec la production ou un autre projet', () => {
    expect(() => assertRealTestEnvironment({}, GOOD_CONFIG, PROD_KEYS)).toThrow(/absent/);
    expect(() => assertRealTestEnvironment({ TAKARDA_TEST_PROJECT_ID: TEST_PROJECT_ID }, GOOD_CONFIG, PROD_KEYS)).toThrow(/CONFIRM/);
    expect(() => assertRealTestEnvironment({ ...GOOD_ENV, TAKARDA_CONFIRM_TEST_PROJECT: 'autre' }, GOOD_CONFIG, PROD_KEYS)).toThrow(/CONFIRM/);
    expect(() => assertRealTestEnvironment({ TAKARDA_TEST_PROJECT_ID: 'takarda-c8cd8', TAKARDA_CONFIRM_TEST_PROJECT: 'takarda-c8cd8' }, GOOD_CONFIG, PROD_KEYS)).toThrow(/PRODUCTION/);
    expect(() => assertRealTestEnvironment({ TAKARDA_TEST_PROJECT_ID: 'mon-autre-projet', TAKARDA_CONFIRM_TEST_PROJECT: 'mon-autre-projet' }, GOOD_CONFIG, PROD_KEYS)).toThrow(/liste d’autorisation/);
    expect(() => assertRealTestEnvironment({ TAKARDA_TEST_PROJECT_ID: 'demo-takarda', TAKARDA_CONFIRM_TEST_PROJECT: 'demo-takarda' }, GOOD_CONFIG, PROD_KEYS)).toThrow(/liste d’autorisation/);
  });

  it('refuse tout accès autre qu’un compte jetable du projet de test (compte de service, jeton CLI, émulateur, autre projet Cloud)', () => {
    for (const name of FORBIDDEN_ENV_VARS_REAL) expect(() => assertRealTestEnvironment({ ...GOOD_ENV, [name]: 'x' }, GOOD_CONFIG, PROD_KEYS)).toThrow(new RegExp(name));
    expect(() => assertRealTestEnvironment({ ...GOOD_ENV, GCLOUD_PROJECT: 'takarda-c8cd8' }, GOOD_CONFIG, PROD_KEYS)).toThrow(/GCLOUD_PROJECT/);
    expect(() => assertRealTestEnvironment({ ...GOOD_ENV, GOOGLE_CLOUD_PROJECT: TEST_PROJECT_ID }, GOOD_CONFIG, PROD_KEYS)).not.toThrow();
  });

  it('refuse une configuration web qui vise la production ou qui est incohérente', () => {
    const bad = (over: Partial<WebConfig>) => () => assertRealTestEnvironment(GOOD_ENV, { ...GOOD_CONFIG, ...over }, PROD_KEYS);
    expect(bad({ projectId: 'takarda-c8cd8' })).toThrow(/PRODUCTION/);
    expect(bad({ projectId: 'autre' })).toThrow(/projectId/);
    expect(bad({ authDomain: 'takarda-c8cd8.firebaseapp.com' })).toThrow(/authDomain/);
    expect(bad({ storageBucket: 'takarda-c8cd8.firebasestorage.app' })).toThrow(/storageBucket/);
    expect(bad({ messagingSenderId: '150945512965' })).toThrow(/PRODUCTION/);
    expect(bad({ messagingSenderId: '111' })).toThrow(/numéro/);
    expect(bad({ appId: '1:150945512965:web:0123456789abcdef' })).toThrow(/appId/);
    expect(bad({ appId: `1:${TEST_PROJECT_NUMBER}:android:abc` })).toThrow(/appId/);
    expect(bad({ apiKey: 'pas-une-cle' })).toThrow(/apiKey/);
    expect(PROD_KEYS).toContain(FAKE_PROD_KEY); // la liste n'est jamais vide : le contrôle ci-dessous n'est jamais à vide
    expect(bad({ apiKey: FAKE_PROD_KEY })).toThrow(/clé d’API est celle de la PRODUCTION/);
  });

  itWithLocalProdKey('(ignoré sans .env local) la clé de production RÉELLE du .env local est refusée comme clé de test', () => {
    for (const key of REAL_PROD_KEYS) expect(() => assertRealTestEnvironment(GOOD_ENV, { ...GOOD_CONFIG, apiKey: key }, PROD_KEYS)).toThrow(/clé d’API est celle de la PRODUCTION/);
  });

  describe('référence de production FIABLE (jamais une valeur factice, partielle, inconnue ou contradictoire)', () => {
    const PID = PRODUCTION_PROJECT_IDS[0];
    const PNUM = PRODUCTION_PROJECT_NUMBERS[0];
    // Clés BIEN FORMÉES mais construites à l'exécution (aucun littéral de 39 caractères dans le dépôt) : alphabet de remplissage, jamais une vraie clé.
    const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const wellFormedKey = (offset = 0) => `AIza${(ALPHABET + ALPHABET).slice(offset, offset + 35)}`;
    const NAMES = {
      apiKey: 'EXPO_PUBLIC_FIREBASE_API_KEY',
      authDomain: 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
      projectId: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
      storageBucket: 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
      messagingSenderId: 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
      appId: 'EXPO_PUBLIC_FIREBASE_APP_ID',
    } as const;
    type Cfg = Record<keyof typeof NAMES, string>;
    const prod = (over: Partial<Cfg> = {}): Cfg => ({
      apiKey: wellFormedKey(0),
      authDomain: `${PID}.firebaseapp.com`,
      projectId: PID,
      storageBucket: `${PID}.firebasestorage.app`,
      messagingSenderId: PNUM,
      appId: `1:${PNUM}:web:0123456789abcdef`,
      ...over,
    });
    const asEnv = (c: Partial<Cfg>): Record<string, string> => Object.fromEntries(Object.entries(c).map(([f, v]) => [NAMES[f as keyof Cfg], v as string]));
    const asText = (c: Partial<Cfg>): string => Object.entries(c).map(([f, v]) => `${NAMES[f as keyof Cfg]}=${v}`).join('\n') + '\n';
    const without = (field: keyof Cfg): Partial<Cfg> => {
      const c: Partial<Cfg> = prod();
      delete c[field];
      return c;
    };

    it('configuration de production cohérente : acceptée, par l’environnement seul, par le .env seul, ou par les deux quand elles sont IDENTIQUES (une seule clé)', () => {
      const key = wellFormedKey(0);
      expect(productionApiKeysFromEnvironment(asEnv(prod()), null)).toEqual([key]);
      expect(productionApiKeysFromEnvironment({}, asText(prod()))).toEqual([key]);
      expect(productionApiKeysFromEnvironment(asEnv(prod()), asText(prod()))).toEqual([key]);
      expect(productionApiKeysFromEnvironment({}, `# commentaire\nexport ${NAMES.apiKey}="${key}"\n${asText(without('apiKey'))}`)).toEqual([key]);
    });

    it('rien de lisible : variables absentes ou vides, .env absent, vide ou sans réglage → ARRÊT explicite', () => {
      expect(() => productionApiKeysFromEnvironment({}, null)).toThrow(/introuvable/);
      expect(() => productionApiKeysFromEnvironment({ [NAMES.apiKey]: '', [NAMES.projectId]: '  ' }, null)).toThrow(/introuvable/);
      expect(() => productionApiKeysFromEnvironment({}, '')).toThrow(/introuvable/);
      expect(() => productionApiKeysFromEnvironment({}, '# aucun réglage\nAUTRE=1\n')).toThrow(/introuvable/);
      expect(() => readProductionApiKeys({}, path.join(root, 'fichier-inexistant.env'))).toThrow(/introuvable/);
    });

    it('.env illisible (ici : un dossier à la place du fichier) → ARRÊT explicite, jamais un contrôle vide', () => {
      expect(() => readProductionApiKeys({}, path.join(root, 'services'))).toThrow(/illisible/);
    });

    it('valeurs copiées du modèle .env.example → refusées (modèle réel du dépôt, puis variantes)', () => {
      const example = read('.env.example');
      expect(() => productionApiKeysFromEnvironment({}, example)).toThrow(/référence de PRODUCTION non fiable/);
      expect(() => productionApiKeysFromEnvironment(asEnv(prod({ apiKey: 'AIza-REMPLACER-PAR-LA-CLE-WEB' })), null)).toThrow(/mal formée|fictive/);
      // une clé bien formée mais marquée comme modèle ou de remplissage est refusée
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ apiKey: `AIza${'REMPLACER'.padEnd(35, 'a')}` })))).toThrow(/fictive|modèle/);
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ apiKey: `AIza${'0'.repeat(35)}` })))).toThrow(/fictive/);
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ apiKey: `AIza${'ab'.repeat(17)}c` })))).toThrow(/fictive/);
    });

    it('projet de production mais configuration INCOMPLÈTE (chaque champ manquant, un par un) → refusée, avec le nom du champ', () => {
      for (const field of Object.keys(NAMES) as (keyof Cfg)[]) {
        expect(() => productionApiKeysFromEnvironment({}, asText(without(field)))).toThrow(new RegExp(`INCOMPLÈTE.*${NAMES[field]}`));
        expect(() => productionApiKeysFromEnvironment(asEnv(without(field)), null)).toThrow(/INCOMPLÈTE/);
      }
    });

    it('projet NON RECONNU ou numéro/appId/domaine/bucket incohérents → refusés', () => {
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ projectId: 'projet-inconnu', authDomain: 'projet-inconnu.firebaseapp.com', storageBucket: 'projet-inconnu.firebasestorage.app' })))).toThrow(/identifiant de projet n.est pas celui d.un projet de production connu/);
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ messagingSenderId: '999999999999', appId: '1:999999999999:web:0123456789abcdef' })))).toThrow(/numéro de projet n.est pas celui d.un projet de production connu/);
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ appId: `1:${TEST_PROJECT_NUMBER}:web:0123456789abcdef` })))).toThrow(/application WEB du même projet/);
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ appId: `1:${PNUM}:android:0123456789abcdef` })))).toThrow(/application WEB/);
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ authDomain: 'autre.firebaseapp.com' })))).toThrow(/domaine/);
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ storageBucket: 'autre.firebasestorage.app' })))).toThrow(/bucket/);
      // le projet de TEST n'est pas une référence de production
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ projectId: TEST_PROJECT_ID, authDomain: `${TEST_PROJECT_ID}.firebaseapp.com`, storageBucket: `${TEST_PROJECT_ID}.firebasestorage.app`, messagingSenderId: TEST_PROJECT_NUMBER, appId: `1:${TEST_PROJECT_NUMBER}:web:0123456789abcdef` })))).toThrow(/projet de production connu/);
    });

    it('clé ABSENTE, TRONQUÉE, trop longue ou aux caractères invalides → refusée', () => {
      expect(() => productionApiKeysFromEnvironment({}, asText(without('apiKey')))).toThrow(/INCOMPLÈTE.*EXPO_PUBLIC_FIREBASE_API_KEY/);
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ apiKey: wellFormedKey(0).slice(0, 25) })))).toThrow(/tronquée/);
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ apiKey: `${wellFormedKey(0)}z` })))).toThrow(/mal formée/);
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ apiKey: `${wellFormedKey(0).slice(0, 38)}!` })))).toThrow(/mal formée/);
      expect(() => productionApiKeysFromEnvironment({}, asText(prod({ apiKey: wellFormedKey(0).replace('AIza', 'BIza') })))).toThrow(/mal formée/);
    });

    it('SOURCES CONTRADICTOIRES : environnement ≠ .env refusé ; une source partielle ne complète jamais l’autre ; doublon contradictoire dans le .env refusé', () => {
      expect(() => productionApiKeysFromEnvironment(asEnv(prod({ apiKey: wellFormedKey(1) })), asText(prod()))).toThrow(/contradiction.*EXPO_PUBLIC_FIREBASE_API_KEY/);
      expect(() => productionApiKeysFromEnvironment(asEnv(prod({ appId: `1:${PNUM}:web:abcdef0123456789` })), asText(prod()))).toThrow(/contradiction.*EXPO_PUBLIC_FIREBASE_APP_ID/);
      // seule la clé est dans l'environnement, le reste dans le .env : PAS de fusion silencieuse
      expect(() => productionApiKeysFromEnvironment({ [NAMES.apiKey]: wellFormedKey(0) }, asText(prod()))).toThrow(/environnement : configuration INCOMPLÈTE/);
      expect(() => productionApiKeysFromEnvironment({}, `${asText(prod())}${NAMES.apiKey}=${wellFormedKey(2)}\n`)).toThrow(/définie plusieurs fois avec des valeurs différentes/);
      // un doublon IDENTIQUE n'est pas une contradiction
      expect(productionApiKeysFromEnvironment({}, `${asText(prod())}${NAMES.apiKey}=${wellFormedKey(0)}\n`)).toEqual([wellFormedKey(0)]);
    });

    it('les messages ne contiennent JAMAIS une valeur de configuration (noms de champs seulement)', () => {
      const secretKey = wellFormedKey(3);
      const cases: [Record<string, string>, string | null][] = [
        [asEnv(prod({ apiKey: secretKey })), asText(prod())],
        [{}, asText(prod({ apiKey: secretKey.slice(0, 20) }))],
        [{}, asText(prod({ apiKey: secretKey, projectId: 'projet-inconnu' }))],
        [{}, asText(prod({ apiKey: secretKey, appId: '' }))],
      ];
      for (const [env, text] of cases) {
        let message = '';
        try {
          productionApiKeysFromEnvironment(env, text);
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).not.toBe('');
        expect(message).not.toContain(secretKey);
        expect(message).not.toContain(secretKey.slice(0, 20));
        expect(message).not.toContain(PNUM);
        expect(message).not.toContain('projet-inconnu');
      }
    });

    it('verify-target.js utilise la MÊME référence partagée que guardsReal.ts, avec les mêmes constantes, et sort en code 1 sur échec', () => {
      const script = read('scripts/firebase-test/verify-target.js');
      expect(script).toContain("require('./productionReference')");
      expect(script).toContain('resolveProductionReference(env, envText, { projectIds: PRODUCTION_PROJECT_IDS, projectNumbers: PRODUCTION_PROJECT_NUMBERS })');
      expect(script).toContain("PRODUCTION_PROJECT_IDS = ['takarda-c8cd8']");
      expect(script).toContain('process.exit(failed === 0 ? 0 : 1)');
      expect(script).toMatch(/prodKeys\.size > 0 && !prodKeys\.has\(config\.apiKey\)/);
      expect(PRODUCTION_PROJECT_IDS).toEqual(['takarda-c8cd8']);
      const guards = read(`${realDir}/guardsReal.ts`);
      expect(guards).toContain("from '../../../../scripts/firebase-test/productionReference'");
      expect(guards).toContain('resolveProductionReference(env, envFileText, { projectIds: PRODUCTION_PROJECT_IDS, projectNumbers: PRODUCTION_PROJECT_NUMBERS })');
      // le module partagé n'ouvre aucune connexion et n'importe rien
      const shared = read('scripts/firebase-test/productionReference.js');
      expect(shared).not.toMatch(/require\(|import |fetch\(|https?:/);
      expect(shared).not.toMatch(/AIza[0-9A-Za-z_-]{30,}/);
    });
  });

  it('parseWebConfig : exactement les six valeurs publiques', () => {
    expect(parseWebConfig({ ...GOOD_CONFIG })).toEqual(GOOD_CONFIG);
    expect(() => parseWebConfig(null)).toThrow(RealGuardError);
    expect(() => parseWebConfig([])).toThrow(RealGuardError);
    expect(() => parseWebConfig({ ...GOOD_CONFIG, apiKey: '' })).toThrow(/apiKey/);
    expect(() => parseWebConfig({ ...GOOD_CONFIG, privateKey: 'secret' })).toThrow(/inattendue/);
    const { appId: _omit, ...partial } = GOOD_CONFIG;
    void _omit;
    expect(() => parseWebConfig(partial)).toThrow(/appId/);
  });

  it('jeton : audience et émetteur du projet de test, sinon arrêt', () => {
    expect(() => assertTokenBelongsToTestProject({ aud: TEST_PROJECT_ID, iss: `https://securetoken.google.com/${TEST_PROJECT_ID}` })).not.toThrow();
    expect(() => assertTokenBelongsToTestProject({ aud: 'takarda-c8cd8', iss: 'https://securetoken.google.com/takarda-c8cd8' })).toThrow(/audience/);
    expect(() => assertTokenBelongsToTestProject({ aud: TEST_PROJECT_ID, iss: 'https://securetoken.google.com/autre' })).toThrow(/émetteur/);
    expect(() => assertTokenBelongsToTestProject({})).toThrow(RealGuardError);
  });

  it('plafonds : comptes jetables bornés', () => {
    expect(MAX_TEST_ACCOUNTS).toBeLessThanOrEqual(40);
  });
});

describe('N2 · destinations réseau (décisions pures)', () => {
  it('seuls la boucle locale et trois services Google sont autorisés', () => {
    expect([...ALLOWED_HOSTS].sort()).toEqual(['firestore.googleapis.com', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com']);
    for (const host of ['localhost', '127.0.0.1', '::1', 'firestore.googleapis.com', 'Identitytoolkit.googleapis.com']) expect(isAllowedHost(host)).toBe(true);
    for (const host of ['example.com', 'googleapis.com', 'firebase.google.com', 'storage.googleapis.com', 'takarda-c8cd8.firebaseapp.com', '1.1.1.1', '']) expect(isAllowedHost(host)).toBe(false);
  });

  it('requête HTTP : clé du projet de test exigée pour Authentication, aucun autre projet dans le chemin', () => {
    const ok = (url: string, key: string | null = TEST_KEY) => checkRequestUrl(url, key).ok;
    expect(ok(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${TEST_KEY}`)).toBe(true);
    expect(ok(`https://securetoken.googleapis.com/v1/token?key=${TEST_KEY}`)).toBe(true);
    expect(ok(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FAKE_PROD_KEY}`)).toBe(false);
    expect(ok('https://identitytoolkit.googleapis.com/v1/accounts:signUp')).toBe(false);
    expect(ok(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${TEST_KEY}`, null)).toBe(false);
    expect(ok(`https://firestore.googleapis.com/v1/projects/${TEST_PROJECT_ID}/databases/(default)/documents`)).toBe(true);
    expect(ok('https://firestore.googleapis.com/v1/projects/takarda-c8cd8/databases/(default)/documents')).toBe(false);
    expect(ok('https://identitytoolkit.googleapis.com/v1/projects/takarda-c8cd8/accounts?key=' + TEST_KEY)).toBe(false);
    expect(ok('https://example.com/')).toBe(false);
    expect(ok('pas une adresse')).toBe(false);
  });
});

describe('N2 · garde réseau (uniquement des destinations refusées avant l’envoi)', () => {
  const originalConnect = net.Socket.prototype.connect;
  const originalFetch = globalThis.fetch;
  const originalLookup = dns.lookup;

  afterEach(() => {
    uninstallNetworkGuard();
    resetBlockedAttempts();
  });

  it('bloque fetch, sockets et DNS non autorisés, puis se désinstalle proprement', async () => {
    installNetworkGuard();
    configureGuard(TEST_KEY);
    expect(net.Socket.prototype.connect).not.toBe(originalConnect);
    await expect(fetch('http://192.0.2.1/')).rejects.toThrow(/RÉSEAU BLOQUÉ/);
    await expect(fetch('https://example.invalid/')).rejects.toThrow(/RÉSEAU BLOQUÉ/);
    await expect(fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=AIzaMauvaiseCle')).rejects.toThrow(/clé/);
    await expect(fetch('https://firestore.googleapis.com/v1/projects/takarda-c8cd8/databases/(default)/documents')).rejects.toThrow(/projet « takarda-c8cd8 »/);
    expect(() => net.connect({ host: '198.51.100.7', port: 443 })).toThrow(/RÉSEAU BLOQUÉ/);
    expect(() => net.connect(443, '203.0.113.9')).toThrow(/RÉSEAU BLOQUÉ/);
    expect(() => dns.lookup('example.invalid', () => undefined)).toThrow(/RÉSEAU BLOQUÉ/);
    await expect(dns.promises.lookup('example.invalid')).rejects.toThrow(/RÉSEAU BLOQUÉ/);
    expect(() => dns.resolve4('example.invalid', () => undefined)).toThrow(/RÉSEAU BLOQUÉ/);
    expect(getBlockedAttempts().length).toBe(9);
    expect(isAllowedSocketDestination('198.51.100.7')).toBe(false);
    expect(isAllowedSocketDestination('127.0.0.1')).toBe(true);

    uninstallNetworkGuard();
    expect(net.Socket.prototype.connect).toBe(originalConnect);
    expect(globalThis.fetch).toBe(originalFetch);
    expect(dns.lookup).toBe(originalLookup);
  });

  it('sans clé de projet de test configurée, Authentication est bloqué (porte fermée)', async () => {
    installNetworkGuard();
    configureGuard(null);
    await expect(fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${TEST_KEY}`)).rejects.toThrow(/aucune clé/);
  });
});

describe('N2 · câblage statique', () => {
  const files = ['guardsReal.ts', 'networkGuardReal.ts', 'networkGuardReal.setup.ts', 'harnessReal.ts', 'productionKeys.ts'].map((f) => `${realDir}/${f}`);
  const tests = ['preflight', 'rules', 'concurrency', 'deletion', 'auth', 'token', 'processKill'].map((f) => `${realDir}/${f}.n2.test.ts`);

  it('aucun fichier N2 n’importe la configuration de production ni le client applicatif ; seule la clé est lue comme texte', () => {
    for (const file of [...files, ...tests]) {
      const src = read(file);
      expect(src).not.toMatch(/from ['"]@\//);
      expect(src).not.toMatch(/(import|require)\([^)]*(firebaseWebConfig|firebaseClient)/);
      expect(src).not.toMatch(/from ['"][^'"]*(firebaseWebConfig|firebaseClient)['"]/);
      expect(src).not.toMatch(/getFirebaseApp|getFirestoreDb|getFirebaseAuth/);
      for (const key of PROD_KEYS) expect(src).not.toContain(key); // la clé de production n'est écrite nulle part
      if (!file.endsWith('guardsReal.ts')) expect(src).not.toContain('150945512965'); // le numéro de production n'apparaît que dans la liste des projets REFUSÉS
      if (!file.endsWith('productionKeys.ts')) expect(src).not.toContain('firebaseWebConfig');
    }
    expect(read(`${realDir}/productionKeys.ts`)).not.toMatch(/import .*firebaseWebConfig/);
  });

  it('aucun accès administrateur, compte de service ni émulateur dans le harnais N2', () => {
    const harness = read(`${realDir}/harnessReal.ts`);
    expect(harness).not.toMatch(/firebase-admin|rules-unit-testing|connectAuthEmulator|connectFirestoreEmulator|withSecurityRulesDisabled/);
    expect(harness).toContain('assertRealTestEnvironment(process.env');
    expect(harness).toContain('assertTokenBelongsToTestProject(');
  });

  it('les tests N2 sont ignorés sans variables (suite habituelle) et chargent le harnais paresseusement (import de TYPES seulement)', () => {
    for (const file of tests) {
      const src = read(file);
      expect(src).toContain('describe.skip');
      expect(src).not.toMatch(/^import (?!type\b).*['"]\.\/harnessReal['"]/m);
      expect(src).toContain('TAKARDA_TEST_PROJECT_ID');
    }
  });

  it('Jest N2 est séparé de N1 : fichiers différents, garde réseau installé avant tout module', () => {
    const real = read('jest.firebase-test-real.config.js');
    expect(real).toContain('networkGuardReal.setup.ts');
    expect(real).toContain('firebaseTestProject/real/**/*.n2.test.ts');
    const n1 = read('jest.firebase-test.config.js');
    expect(n1).toContain('*.n1.test.ts');
    expect(n1).not.toContain('n2');
    expect(read('jest.firebase-test.config.js')).toContain('networkGuard.setup.ts'); // garde N1 (boucle locale seule) inchangé
  });

  it('N1 refuse de tourner si une variable N2 est présente', () => {
    for (const name of ['TAKARDA_TEST_PROJECT_ID', 'TAKARDA_CONFIRM_TEST_PROJECT', 'TAKARDA_TEST_FIREBASE_CONFIG_FILE']) expect(N1_FORBIDDEN).toContain(name);
  });

  it('firebase.n2.json ne contient que les règles ; aucun projet par défaut ; production non référencée par les scripts', () => {
    expect(JSON.parse(read('firebase.n2.json'))).toEqual({ firestore: { rules: 'firestore.rules' } });
    expect(fs.existsSync(path.join(root, '.firebaserc'))).toBe(false);
    for (const script of ['verify-target.js', 'kill-test-worker.js']) {
      const src = read(`scripts/firebase-test/${script}`);
      for (const key of PROD_KEYS) expect(src).not.toContain(key);
      expect(src).not.toMatch(/deploy|firebase-tools|firestore:rules|auth:import/); // aucun script ne publie ni n'appelle la CLI
    }
  });

  it('verify-target.js utilise les mêmes constantes que guardsReal.ts', () => {
    const script = read('scripts/firebase-test/verify-target.js');
    expect(script).toContain(`const TEST_PROJECT_ID = '${TEST_PROJECT_ID}'`);
    expect(script).toContain(`const TEST_PROJECT_NUMBER = '${TEST_PROJECT_NUMBER}'`);
    expect(script).toContain("PRODUCTION_PROJECT_NUMBERS = ['150945512965']");
    for (const name of FORBIDDEN_ENV_VARS_REAL) expect(script).toContain(`'${name}'`);
  });

  it('le script du processus tué refuse un fichier d’état dans le dépôt et un autre projet', () => {
    const script = read('scripts/firebase-test/kill-test-worker.js');
    expect(script).toContain('HORS du dépôt');
    expect(script).toContain("!== 'takarda-n2-test'");
  });

  it('la configuration et l’état locaux de N2 sont ignorés par Git', () => {
    expect(read('.gitignore')).toContain('/.n2-local/');
  });
});
