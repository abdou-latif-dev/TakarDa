// Configuration dynamique d'Expo : `app.json` reste la base (inchangé) ; ce fichier ne modifie QUE les builds de TEST (EXPO_PUBLIC_BUILD_TARGET=test).
//
// Un build de test reçoit un autre nom et un autre identifiant Android (`com.takarda.app.test`) : il s'installe À CÔTÉ de l'application TakarDa, jamais par-dessus. Ainsi :
//   - les données locales de l'application TakarDa ne sont ni lues, ni modifiées, ni écrasées par un essai de test ;
//   - un build de test ne peut pas être envoyé sur la fiche Play de l'application (identifiant différent : Google Play le refuse) ;
//   - on distingue au premier coup d'œil l'icône « TakarDa (test) » de l'application réelle.
// Tout autre build (local, production) garde exactement app.json.

// L'identité « test » s'obtient par la cible `test` (cloud de test) OU par la variante `EXPO_PUBLIC_APP_VARIANT=test` (version locale, comptes fermés, installable à côté de TakarDa).
module.exports = ({ config }) => {
  const testIdentity = process.env.EXPO_PUBLIC_BUILD_TARGET === 'test' || process.env.EXPO_PUBLIC_APP_VARIANT === 'test';
  if (!testIdentity) return config;
  return {
    ...config,
    name: 'TakarDa (test)',
    scheme: 'takarda-test',
    android: { ...config.android, package: 'com.takarda.app.test' },
    ios: { ...config.ios, bundleIdentifier: 'com.takarda.app.test' },
  };
};
