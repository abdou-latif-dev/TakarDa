// Configuration Jest des tests de RÈGLES et de TRANSPORTS de synchronisation (P4) dans l'émulateur Firestore LOCAL.
// Environnement Node sans React Native, comme jest.emulator.config.js. NON EXÉCUTÉ tant que l'émulateur n'est pas autorisé.
//
//   npx firebase-tools@15.33.0 emulators:exec --only firestore --project demo-takarda "npx jest -c jest.emulator.sync.config.js"
module.exports = {
  preset: 'jest-expo/node',
  testTimeout: 30000,
  testMatch: ['<rootDir>/services/__tests__/firestoreSyncRules.emulator.test.ts'],
};
