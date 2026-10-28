// Configuration Jest du lot N2 : validation contre le projet de TEST réel « takarda-n2-test » (jamais la production).
// Le garde réseau (real/networkGuardReal.setup.ts) n'autorise que la boucle locale et Authentication / jeton / Firestore, et le
// harnais refuse tout environnement qui n'est pas exactement celui du projet de test (voir real/guardsReal.ts).
// NON EXÉCUTÉ tant que N2 n'est pas autorisé. Sans variables d'environnement, tous les tests sont ignorés.
//
//   $env:TAKARDA_TEST_PROJECT_ID = "takarda-n2-test"
//   $env:TAKARDA_CONFIRM_TEST_PROJECT = "takarda-n2-test"
//   $env:TAKARDA_TEST_FIREBASE_CONFIG_FILE = "C:\Users\ousma\n2-local\web-config.json"
//   node node_modules/jest/bin/jest.js -c jest.firebase-test-real.config.js --runInBand --testPathPattern preflight
module.exports = {
  preset: 'jest-expo/node',
  testTimeout: 120000,
  setupFiles: ['<rootDir>/services/__tests__/firebaseTestProject/real/networkGuardReal.setup.ts'],
  testMatch: ['<rootDir>/services/__tests__/firebaseTestProject/real/**/*.n2.test.ts'],
};
