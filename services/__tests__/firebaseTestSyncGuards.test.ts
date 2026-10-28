// P4.1 / P5 — garde-fous STATIQUES des tests N2 de synchronisation et de suppression de compte (real/sync.n2.test.ts, real/deletionFlow.n2.test.ts), sans les exécuter : il ne doit viser que le projet de TEST,
// passer par les garde-fous du harnais, n'utiliser que des comptes jetables et des données fictives, et ne rien nettoyer d'autre que ce
// qu'il a créé.

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const files = ['sync.n2.test.ts', 'deletionFlow.n2.test.ts'].map((name) => `services/__tests__/firebaseTestProject/real/${name}`);

describe.each(files)('Test N2 %s — garde-fous', (file) => {
  const source = read(file);

  it('ignoré sans les trois variables d’activation ; garde réseau et harnais chargés avant tout accès', () => {
    expect(source).toMatch(/const enabled = !!process\.env\.TAKARDA_TEST_PROJECT_ID && !!process\.env\.TAKARDA_CONFIRM_TEST_PROJECT && !!process\.env\.TAKARDA_TEST_FIREBASE_CONFIG_FILE;/);
    expect(source).toMatch(/const suite = enabled \? describe : describe\.skip;/);
    const before = source.slice(source.indexOf('beforeAll(() => {'));
    expect(before.indexOf("require('./networkGuardReal')")).toBeGreaterThan(-1);
    expect(before.indexOf("require('./networkGuardReal')")).toBeLessThan(before.indexOf("require('./harnessReal')"));
    expect(before.indexOf("require('./harnessReal')")).toBeLessThan(before.indexOf("require('firebase/firestore')"));
    // aucune importation de valeur au premier niveau (le harnais refuse un environnement incorrect À L'IMPORT : import différé)
    const topImports = source.split('\n').filter((l) => /^import /.test(l));
    expect(topImports).toEqual(["import type * as H from './harnessReal';"]);
  });

  it('aucun accès à la production, à la configuration applicative, aux clés ou à un compte réel', () => {
    for (const forbidden of [/firebaseWebConfig/, /firebaseClient/, /productionKeys/, /takarda-c8cd8/, /150945512965/, /AIza[0-9A-Za-z_-]{10,}/, /GOOGLE_APPLICATION_CREDENTIALS/, /FIREBASE_TOKEN/, /FIRESTORE_EMULATOR_HOST/, /serviceAccount/i]) {
      expect(source).not.toMatch(forbidden);
    }
    expect(source).not.toMatch(/initializeApp|getAuth\(|createUserWithEmailAndPassword|signInWith/); // comptes et clients uniquement via le harnais
    expect(source).not.toMatch(/[\w.-]+@[\w-]+\.[a-z]{2,}/i); // aucune adresse e-mail littérale : les comptes jetables viennent du harnais
  });

  it('comptes jetables seulement ; nettoyage limité aux comptes créés par l’exécution ; données fictives', () => {
    expect(source).toMatch(/const user = await h\.makeUser\(label\);\s*created\.push\(user\);/);
    expect(source).toMatch(/for \(const user of created\)/);
    expect(source).toMatch(/h\.cleanupAll\(\)/);
    expect(source).not.toMatch(/deleteUser|deleteApp/);
    const noms = [...source.matchAll(/nom: '([^']*)'/g)].map((m) => m[1]);
    for (const nom of noms) expect(nom).toMatch(/^(Maison|Villa|Appareil \d|Maison N2|Chambre|Koffi)$/);
  });

  it('toutes les opérations réelles sont comptées dans le budget du harnais, et les tests visent le projet de test via sa configuration', () => {
    expect(source).toMatch(/h\.spend\(/);
    expect((source.match(/h\.spend\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
    const config = read('jest.firebase-test-real.config.js');
    expect(config).toContain("<rootDir>/services/__tests__/firebaseTestProject/real/**/*.n2.test.ts");
    expect(config).toContain('networkGuardReal.setup.ts');
    const guards = read('services/__tests__/firebaseTestProject/real/guardsReal.ts');
    expect(guards).toContain("TEST_PROJECT_ID = 'takarda-n2-test'");
    expect(guards).toContain('FIRESTORE_EMULATOR_HOST');
  });

  it('la suite ordinaire ne l’exécute pas (motif d’exclusion explicite) et le candidat de règles n’est publié par aucun script', () => {
    expect(path.basename(file)).toMatch(/\.n2\.test\.ts$/);
    const pkg = JSON.parse(read('package.json'));
    expect(JSON.stringify(pkg.scripts)).not.toMatch(/deploy|firebase|n2/i);
    expect(fs.existsSync(path.join(root, '.firebaserc'))).toBe(false);
  });
});
