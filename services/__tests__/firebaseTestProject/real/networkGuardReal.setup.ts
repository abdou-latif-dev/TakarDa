// Chargé par jest (`setupFiles` de jest.firebase-test-real.config.js) AVANT tout module de test : le garde réseau est en place
// avant que le SDK Firebase ne soit importé. Sans configuration valide, la clé de projet reste absente : les requêtes
// Authentication sont alors BLOQUÉES (porte fermée).
import fs from 'fs';
import { configureGuard, installNetworkGuard } from './networkGuardReal';

installNetworkGuard();

try {
  const file = process.env.TAKARDA_TEST_FIREBASE_CONFIG_FILE;
  if (file && process.env.TAKARDA_TEST_PROJECT_ID) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { apiKey?: unknown };
    if (typeof parsed.apiKey === 'string') configureGuard(parsed.apiKey); // validée ensuite par le harnais (assertRealTestEnvironment)
  }
} catch {
  // fichier absent ou illisible : la clé reste absente ; le harnais refusera de démarrer
}
