// Garde-fous du lot N1 (fonctions pures + contrôles statiques) : le harnais ne peut viser ni la production ni un service réel.
// Ces tests tournent dans la suite habituelle (aucun émulateur, aucun SDK, aucun réseau).

import fs from 'fs';
import path from 'path';
import { assertEmulatorOnlyEnvironment, FORBIDDEN_ENV_VARS, GuardError, isLoopbackHost, splitHostPort } from './firebaseTestProject/guards';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const OK = { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCLOUD_PROJECT: 'demo-takarda' };

describe('Garde-fous N1 : environnement', () => {
  it('accepte uniquement des émulateurs locaux et un projet fictif demo-…', () => {
    expect(assertEmulatorOnlyEnvironment(OK)).toEqual({ projectId: 'demo-takarda', auth: { host: '127.0.0.1', port: 9099 }, firestore: { host: '127.0.0.1', port: 8080 } });
    expect(assertEmulatorOnlyEnvironment({ ...OK, GCLOUD_PROJECT: undefined }).projectId).toBe('demo-takarda');
    expect(assertEmulatorOnlyEnvironment({ ...OK, FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099', FIRESTORE_EMULATOR_HOST: '[::1]:8080' }).firestore.host).toBe('::1');
  });

  it('refuse sans émulateur : rien ne s’exécute contre un service réel par défaut', () => {
    expect(() => assertEmulatorOnlyEnvironment({})).toThrow(GuardError);
    expect(() => assertEmulatorOnlyEnvironment({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toThrow(/Authentication ET Firestore/);
    expect(() => assertEmulatorOnlyEnvironment({ FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' })).toThrow(/Authentication ET Firestore/);
  });

  it('refuse un émulateur qui n’est pas en boucle locale', () => {
    expect(() => assertEmulatorOnlyEnvironment({ ...OK, FIRESTORE_EMULATOR_HOST: '192.168.1.20:8080' })).toThrow(/boucle locale/);
    expect(() => assertEmulatorOnlyEnvironment({ ...OK, FIREBASE_AUTH_EMULATOR_HOST: 'firestore.googleapis.com:443' })).toThrow(/boucle locale/);
    expect(() => assertEmulatorOnlyEnvironment({ ...OK, FIREBASE_AUTH_EMULATOR_HOST: 'pas-un-hote' })).toThrow(/illisible/);
  });

  it('refuse la production et tout projet qui n’est pas fictif', () => {
    expect(() => assertEmulatorOnlyEnvironment({ ...OK, TAKARDA_N1_PROJECT_ID: 'takarda-c8cd8' })).toThrow(/PRODUCTION/);
    expect(() => assertEmulatorOnlyEnvironment({ ...OK, TAKARDA_N1_PROJECT_ID: 'mon-projet-de-test' })).toThrow(/fictif/);
    expect(() => assertEmulatorOnlyEnvironment({ ...OK, GCLOUD_PROJECT: 'takarda-c8cd8' })).toThrow(/PRODUCTION/);
    expect(() => assertEmulatorOnlyEnvironment({ ...OK, GOOGLE_CLOUD_PROJECT: 'takarda-c8cd8' })).toThrow(/fictif/);
  });

  it('refuse toute variable pouvant donner accès à un service réel (identifiants, jeton, variables N2)', () => {
    for (const name of FORBIDDEN_ENV_VARS) expect(() => assertEmulatorOnlyEnvironment({ ...OK, [name]: 'x' })).toThrow(new RegExp(name));
  });

  it('isLoopbackHost / splitHostPort', () => {
    for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', 'LOCALHOST']) expect(isLoopbackHost(host)).toBe(true);
    for (const host of ['1.1.1.1', 'example.com', 'firestore.googleapis.com', '0.0.0.0', '10.0.0.1', '']) expect(isLoopbackHost(host)).toBe(false);
    expect(splitHostPort('127.0.0.1:9099')).toEqual({ host: '127.0.0.1', port: 9099 });
    expect(() => splitHostPort('127.0.0.1')).toThrow(GuardError);
  });
});

describe('Garde-fous N1 : câblage statique', () => {
  const files = ['guards.ts', 'networkGuard.ts', 'networkGuard.setup.ts', 'harness.ts'].map((f) => `services/__tests__/firebaseTestProject/${f}`);

  it('le harnais n’importe ni la configuration de production ni le client applicatif', () => {
    for (const file of files) {
      const src = read(file);
      expect(src).not.toMatch(/firebaseWebConfig|firebaseClient|getFirebaseApp|getFirestoreDb|getFirebaseAuth/);
      expect(src).not.toMatch(/from ['"]@\//); // aucun import applicatif par alias
    }
  });

  it('le harnais branche Authentication ET Firestore sur les émulateurs, avec le projet fictif, et n’a aucune clé réelle', () => {
    const harness = read('services/__tests__/firebaseTestProject/harness.ts');
    expect(harness).toContain('connectAuthEmulator(');
    expect(harness).toContain('connectFirestoreEmulator(');
    expect(harness).toContain('assertEmulatorOnlyEnvironment(process.env)');
    expect(harness).toContain('fake-api-key-n1-emulateur');
    expect(harness).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    // le seul endroit où l'identifiant de production apparaît : la liste des projets REFUSÉS
    expect(read('services/__tests__/firebaseTestProject/guards.ts')).toContain("PRODUCTION_PROJECT_IDS: readonly string[] = ['takarda-c8cd8']");
    expect(harness).not.toContain('takarda-c8cd8');
  });

  it('Jest N1 installe le garde réseau avant tout module et ne vise que les tests N1 ; la configuration N1 est séparée de firebase.json', () => {
    const config = read('jest.firebase-test.config.js');
    expect(config).toContain('networkGuard.setup.ts');
    expect(config).toContain('firebaseTestProject/**/*.n1.test.ts');
    const n1 = JSON.parse(read('firebase.n1.json'));
    expect(Object.keys(n1.emulators).sort()).toEqual(['auth', 'firestore', 'singleProjectMode', 'ui']);
    expect(n1.emulators.ui.enabled).toBe(false);
    expect(n1.firestore.rules).toBe('firestore.rules');
    expect(fs.existsSync(path.join(root, '.firebaserc'))).toBe(false); // aucun projet par défaut : --project reste explicite
    expect(JSON.parse(read('firebase.json')).emulators.auth).toBeUndefined(); // firebase.json d'origine inchangé
  });

  it('les tests N1 sont ignorés sans émulateurs (suite habituelle)', () => {
    for (const file of ['guards', 'auth', 'deletion']) {
      const src = read(`services/__tests__/firebaseTestProject/${file}.n1.test.ts`);
      expect(src).toContain('describe.skip');
      expect(src).not.toMatch(/^import (?!type\b).*['"]\.\/harness['"]/m); // harnais chargé paresseusement (import de TYPES seulement), après vérification de l'environnement
    }
  });
});
