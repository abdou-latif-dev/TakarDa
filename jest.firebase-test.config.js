// Configuration Jest du lot N1 : validation de la suppression de compte contre les ÉMULATEURS LOCAUX Authentication et
// Firestore (projet fictif « demo-takarda »). Aucune connexion à un service Firebase réel n'est possible : le garde réseau
// (networkGuard.setup.ts) bloque toute connexion qui n'est pas locale, et le harnais refuse un environnement non « émulateur ».
//
//   npx firebase-tools@15.33.0 emulators:exec --config firebase.n1.json --only auth,firestore --project demo-takarda --non-interactive "node node_modules/jest/bin/jest.js -c jest.firebase-test.config.js --runInBand"
module.exports = {
  preset: 'jest-expo/node',
  testTimeout: 60000,
  setupFiles: ['<rootDir>/services/__tests__/firebaseTestProject/networkGuard.setup.ts'],
  testMatch: ['<rootDir>/services/__tests__/firebaseTestProject/**/*.n1.test.ts'],
};
