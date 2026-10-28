// Configuration Jest réservée aux tests des règles Firestore dans l'émulateur LOCAL (environnement Node, sans React Native).
// Le test d'émulateur n'est pas un test d'interface : le preset « jest-expo » (résolution React Native) ne sait pas charger
// @firebase/rules-unit-testing. La suite habituelle (`npm test`) l'ignore tant que l'émulateur n'est pas lancé.
//
//   npx firebase-tools@15.33.0 emulators:exec --only firestore --project demo-takarda "npx jest -c jest.emulator.config.js"
module.exports = {
  preset: 'jest-expo/node',
  testTimeout: 30000, // premier démarrage de l'émulateur et connexion du client : plus lent que les tests unitaires
  testMatch: ['<rootDir>/services/__tests__/firestoreRules.emulator.test.ts', '<rootDir>/services/__tests__/accountDeletion.emulator.test.ts'],
};
