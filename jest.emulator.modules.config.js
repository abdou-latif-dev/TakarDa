// Configuration Jest des tests de RÈGLES des modules partagés (F3a, candidat firestore.p5.rules) dans l'émulateur Firestore LOCAL.
// Environnement Node sans React Native, comme jest.emulator.config.js. NON EXÉCUTÉ tant que l'émulateur n'est pas autorisé (il demande Java).
//
//   npx firebase-tools@15.33.0 emulators:exec --config firebase.modules.json --only firestore --project demo-takarda "npx jest -c jest.emulator.modules.config.js"
module.exports = {
  preset: 'jest-expo/node',
  testTimeout: 30000,
  maxWorkers: 1, // les deux suites partagent l'émulateur (projets distincts, mais exécution en série par prudence)
  testMatch: ['<rootDir>/services/__tests__/modulesRules.emulator.test.ts', '<rootDir>/services/__tests__/modulesFlows.emulator.test.ts', '<rootDir>/services/__tests__/emergencyRules.emulator.test.ts', '<rootDir>/services/__tests__/accountTombstone.emulator.test.ts'],
};
