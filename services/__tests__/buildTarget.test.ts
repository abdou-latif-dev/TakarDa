// Séparation test / production des BUILDS : cible déclarée (EXPO_PUBLIC_BUILD_TARGET), garde d'environnement à l'exécution, barrière avant build, identifiant Android distinct
// pour les builds de test, profils de eas.json. Aucun SDK, aucun réseau, aucun build lancé.

import fs from 'fs';
import path from 'path';
import { BUILD_TARGET, BUILD_TARGET_VARIABLE, cloudEnabledFor, resolveBuildTarget } from '../../constants/buildTarget';
import { CLOUD_ACCOUNT_ENABLED } from '../../constants/features';
import { PRODUCTION_PROJECT_ID, TEST_PROJECT_ID, environmentProblems } from '../firebase/firebaseEnvironment';

/* eslint-disable @typescript-eslint/no-require-imports */
const gate = require('../../scripts/release/build-gate.js') as {
  checkBuild: (env: Record<string, string | undefined>, options?: { legalReady?: () => boolean }) => { ok: boolean; target: string; problems: string[] };
  FIREBASE_VARIABLES: string[];
};
const appConfig = require('../../app.config.js') as (arg: { config: Record<string, any> }) => Record<string, any>;
/* eslint-enable @typescript-eslint/no-require-imports */

const root = path.join(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const TEST_ENV = {
  EXPO_PUBLIC_BUILD_TARGET: 'test',
  EXPO_PUBLIC_APP_VARIANT: 'test',
  EXPO_PUBLIC_FIREBASE_API_KEY: 'AIzaSyFAKE-FAKE-FAKE-FAKE-FAKE-FAKE-FAK',
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'takarda-n2-test.firebaseapp.com',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'takarda-n2-test',
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'takarda-n2-test.firebasestorage.app',
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '438284688014',
  EXPO_PUBLIC_FIREBASE_APP_ID: '1:438284688014:web:abcdef0123456789',
};
const PRODUCTION_ENV = {
  EXPO_PUBLIC_BUILD_TARGET: 'production',
  EXPO_PUBLIC_FIREBASE_API_KEY: 'AIzaSyFAKE-FAKE-FAKE-FAKE-FAKE-FAKE-FAK',
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'takarda-c8cd8.firebaseapp.com',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'takarda-c8cd8',
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'takarda-c8cd8.firebasestorage.app',
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '150945512965',
  EXPO_PUBLIC_FIREBASE_APP_ID: '1:150945512965:web:abcdef0123456789',
};

describe('Cible de build', () => {
  it('une valeur absente, vide ou inconnue vaut « local » (jamais ouverte par erreur) ; seules « test » et « production » ouvrent le cloud', () => {
    for (const raw of [undefined, null, '', 'local', 'Test', 'TEST', 'prod', 'production ', 'true', '1']) expect({ raw, target: resolveBuildTarget(raw as never) }).toEqual({ raw, target: 'local' });
    expect(resolveBuildTarget('test')).toBe('test');
    expect(resolveBuildTarget('production')).toBe('production');
    expect(cloudEnabledFor('local')).toBe(false);
    expect(cloudEnabledFor('test')).toBe(true);
    expect(cloudEnabledFor('production')).toBe(true);
  });

  it('configuration normale (aucune cible déclarée) : comptes FERMÉS, c’est la valeur par défaut de l’application et de tous les tests', () => {
    expect(BUILD_TARGET_VARIABLE).toBe('EXPO_PUBLIC_BUILD_TARGET');
    expect(BUILD_TARGET).toBe(resolveBuildTarget(process.env.EXPO_PUBLIC_BUILD_TARGET));
    expect(CLOUD_ACCOUNT_ENABLED).toBe(false);
    expect(read('constants/features.ts')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
    expect(read('constants/buildTarget.ts')).toContain('process.env.EXPO_PUBLIC_BUILD_TARGET'); // expression littérale : remplacée au build par Metro
  });
});

describe('Garde d’environnement à l’exécution (firebaseEnvironment)', () => {
  const ok = (projectId: string, context: Parameters<typeof environmentProblems>[1]) => environmentProblems(projectId, context).length === 0;

  it('sans cible déclarée : comportement historique inchangé (version publiée = production seulement ; développement = projet de test seulement)', () => {
    expect(ok(PRODUCTION_PROJECT_ID, { isDev: false })).toBe(true);
    expect(ok(TEST_PROJECT_ID, { isDev: false })).toBe(false);
    expect(ok(TEST_PROJECT_ID, { isDev: true })).toBe(true);
    expect(ok(PRODUCTION_PROJECT_ID, { isDev: true })).toBe(false);
    expect(ok(PRODUCTION_PROJECT_ID, { isDev: true, allowProductionInDev: true })).toBe(true);
  });

  it('cible « test » : le projet de test, installé (APK interne) ou en développement ; JAMAIS la production, même avec l’autorisation de développement', () => {
    for (const isDev of [false, true]) {
      expect({ isDev, test: ok(TEST_PROJECT_ID, { isDev, buildTarget: 'test' }) }).toEqual({ isDev, test: true });
      expect({ isDev, production: ok(PRODUCTION_PROJECT_ID, { isDev, buildTarget: 'test', allowProductionInDev: true }) }).toEqual({ isDev, production: false });
    }
  });

  it('cible « production » : la production seulement une fois installée ; le projet de test est refusé', () => {
    expect(ok(PRODUCTION_PROJECT_ID, { isDev: false, buildTarget: 'production' })).toBe(true);
    expect(ok(TEST_PROJECT_ID, { isDev: false, buildTarget: 'production' })).toBe(false);
  });

  it('cible « local » : aucune connexion Firebase, quel que soit le projet ; un projet inconnu est toujours refusé', () => {
    expect(ok(TEST_PROJECT_ID, { isDev: true, buildTarget: 'local' })).toBe(false);
    expect(ok(PRODUCTION_PROJECT_ID, { isDev: false, buildTarget: 'local' })).toBe(false);
    for (const target of [undefined, 'test', 'production'] as const) expect(ok('autre-projet', { isDev: true, buildTarget: target })).toBe(false);
  });

  it('le client Firebase transmet la cible au garde', () => {
    expect(read('services/firebase/firebaseClient.ts')).toMatch(/buildTarget: BUILD_TARGET/);
  });
});

describe('Barrière avant build (scripts/release/build-gate.js)', () => {
  it('local (défaut) : prêt sans aucune configuration Firebase', () => {
    expect(gate.checkBuild({})).toMatchObject({ ok: true, target: 'local' });
    expect(gate.checkBuild({ EXPO_PUBLIC_BUILD_TARGET: 'local' })).toMatchObject({ ok: true, target: 'local' });
  });

  it('une cible inconnue (faute de frappe) est REFUSÉE à la construction, jamais prise pour « local » en silence', () => {
    for (const raw of ['Test', 'prod', 'production ', 'true']) expect(gate.checkBuild({ EXPO_PUBLIC_BUILD_TARGET: raw }).ok).toBe(false);
  });

  it('test : configuration du projet de test complète et cohérente = prête ; production, mélange ou manque = refusé', () => {
    expect(gate.checkBuild(TEST_ENV)).toMatchObject({ ok: true, target: 'test' });
    const withProduction = gate.checkBuild({ ...PRODUCTION_ENV, EXPO_PUBLIC_BUILD_TARGET: 'test', EXPO_PUBLIC_APP_VARIANT: 'test' });
    expect(withProduction.ok).toBe(false);
    expect(withProduction.problems.join(' ')).toMatch(/takarda-c8cd8.*interdit/);
    expect(gate.checkBuild({ ...TEST_ENV, EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '150945512965' }).ok).toBe(false); // numéro de la production dans une configuration de test
    expect(gate.checkBuild({ ...TEST_ENV, EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'takarda-c8cd8.firebaseapp.com' }).ok).toBe(false);
    expect(gate.checkBuild({ ...TEST_ENV, EXPO_PUBLIC_FIREBASE_APP_ID: '1:150945512965:web:abcdef' }).ok).toBe(false);
    for (const name of gate.FIREBASE_VARIABLES) {
      const incomplete = { ...TEST_ENV } as Record<string, string | undefined>;
      delete incomplete[name];
      expect({ name, ok: gate.checkBuild(incomplete).ok }).toEqual({ name, ok: false });
    }
    expect(gate.checkBuild({ ...TEST_ENV, EXPO_PUBLIC_ALLOW_PRODUCTION_IN_DEV: 'true' }).ok).toBe(false);
  });

  it('identité de test : la variante « test » n’ouvre PAS le cloud (version locale installable à côté de TakarDa) ; une cible « test » sans elle, ou une production avec elle, est refusée', () => {
    expect(gate.checkBuild({ EXPO_PUBLIC_BUILD_TARGET: 'local', EXPO_PUBLIC_APP_VARIANT: 'test' })).toMatchObject({ ok: true, target: 'local' });
    expect(gate.checkBuild({ EXPO_PUBLIC_APP_VARIANT: 'test' })).toMatchObject({ ok: true, target: 'local' });
    const withoutVariant = { ...TEST_ENV } as Record<string, string | undefined>;
    delete withoutVariant.EXPO_PUBLIC_APP_VARIANT;
    const refused = gate.checkBuild(withoutVariant);
    expect(refused.ok).toBe(false);
    expect(refused.problems.join(' ')).toMatch(/PAR-DESSUS TakarDa/);
    expect(gate.checkBuild({ ...PRODUCTION_ENV, EXPO_PUBLIC_APP_VARIANT: 'test' }, { legalReady: () => true }).ok).toBe(false);
    for (const raw of ['Test', 'demo', 'production']) expect(gate.checkBuild({ EXPO_PUBLIC_APP_VARIANT: raw }).ok).toBe(false); // valeur inconnue : refusée, jamais ignorée
  });

  it('production : projet de production cohérent ET textes légaux complets ; le projet de test ou des textes incomplets = refusé', () => {
    expect(gate.checkBuild(PRODUCTION_ENV, { legalReady: () => true })).toMatchObject({ ok: true, target: 'production' });
    const notReady = gate.checkBuild(PRODUCTION_ENV, { legalReady: () => false });
    expect(notReady.ok).toBe(false);
    expect(notReady.problems.join(' ')).toMatch(/textes légaux/);
    expect(gate.checkBuild({ ...TEST_ENV, EXPO_PUBLIC_BUILD_TARGET: 'production' }, { legalReady: () => true }).ok).toBe(false);
  });

  it('dans l’état actuel du dépôt, un build « production » est REFUSÉ (textes légaux à fournir) : la barrière lit les vrais documents', () => {
    expect(gate.checkBuild(PRODUCTION_ENV).ok).toBe(false);
  });

  it('aucun résultat ne contient de valeur de configuration (clé d’API, identifiants) : seulement des noms de variables et de projets publics', () => {
    const results = [gate.checkBuild({ ...TEST_ENV, EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'takarda-c8cd8' }), gate.checkBuild(PRODUCTION_ENV, { legalReady: () => false })];
    for (const result of results) {
      const text = JSON.stringify(result);
      expect(text).not.toContain('AIzaSy');
      expect(text).not.toContain('abcdef0123456789');
    }
  });
});

describe('Identifiant Android distinct pour un build de test (app.config.js)', () => {
  const base = { name: 'TakarDa', scheme: 'takarda', android: { package: 'com.takarda.app', blockedPermissions: ['android.permission.CAMERA'] }, ios: { bundleIdentifier: 'com.takarda.app' } };
  const withTarget = (value: string | undefined, run: () => void) => {
    const before = process.env.EXPO_PUBLIC_BUILD_TARGET;
    if (value === undefined) delete process.env.EXPO_PUBLIC_BUILD_TARGET;
    else process.env.EXPO_PUBLIC_BUILD_TARGET = value;
    try {
      run();
    } finally {
      if (before === undefined) delete process.env.EXPO_PUBLIC_BUILD_TARGET;
      else process.env.EXPO_PUBLIC_BUILD_TARGET = before;
    }
  };

  it('local et production : exactement app.json (aucune modification)', () => {
    for (const target of [undefined, 'local', 'production', 'autre']) withTarget(target, () => expect(appConfig({ config: base })).toBe(base));
  });

  it('test : autre nom, autre schéma, autre identifiant Android et iOS ; le reste est conservé ; la configuration d’origine n’est pas modifiée', () => {
    withTarget('test', () => {
      const config = appConfig({ config: base });
      expect(config).toMatchObject({ name: 'TakarDa (test)', scheme: 'takarda-test', android: { package: 'com.takarda.app.test', blockedPermissions: ['android.permission.CAMERA'] }, ios: { bundleIdentifier: 'com.takarda.app.test' } });
      expect(base.android.package).toBe('com.takarda.app');
    });
  });

  it('la variante « test » (version locale, comptes fermés) reçoit la même identité de test, sans ouvrir le cloud', () => {
    const before = process.env.EXPO_PUBLIC_APP_VARIANT;
    process.env.EXPO_PUBLIC_APP_VARIANT = 'test';
    try {
      expect(appConfig({ config: base })).toMatchObject({ name: 'TakarDa (test)', android: { package: 'com.takarda.app.test' } });
    } finally {
      if (before === undefined) delete process.env.EXPO_PUBLIC_APP_VARIANT;
      else process.env.EXPO_PUBLIC_APP_VARIANT = before;
    }
  });

  it('app.json garde l’identifiant de la fiche Play ; le fichier dynamique est la seule source de l’identifiant de test', () => {
    const app = JSON.parse(read('app.json')) as { expo: { android: { package: string } } };
    expect(app.expo.android.package).toBe('com.takarda.app');
    expect(read('app.config.js')).toContain("process.env.EXPO_PUBLIC_BUILD_TARGET === 'test' || process.env.EXPO_PUBLIC_APP_VARIANT === 'test'");
  });
});

describe('Profils de build (eas.json) et crochet npm', () => {
  const eas = JSON.parse(read('eas.json')) as { build: Record<string, { env?: Record<string, string>; environment?: string; distribution?: string; android?: { buildType?: string }; autoIncrement?: boolean }> };
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

  it('trois profils, chacun avec SA cible ; le build de production est un bundle (AAB) en production, le build de test un APK interne', () => {
    expect(Object.keys(eas.build).sort()).toEqual(['preview', 'production', 'test-cloud', 'test-local']);
    // premier build de test : LOCAL (comptes fermés, aucun appel Firebase) avec l'identité de test, installable à côté de TakarDa
    expect(eas.build['test-local']).toMatchObject({ distribution: 'internal', android: { buildType: 'apk' }, env: { EXPO_PUBLIC_BUILD_TARGET: 'local', EXPO_PUBLIC_APP_VARIANT: 'test' } });
    expect(eas.build['test-local'].environment).toBeUndefined(); // aucune variable EAS (donc aucune configuration Firebase) n'est chargée
    expect(eas.build['test-cloud'].env).toMatchObject({ EXPO_PUBLIC_APP_VARIANT: 'test' });
    expect(eas.build.preview).toMatchObject({ distribution: 'internal', android: { buildType: 'apk' }, env: { EXPO_PUBLIC_BUILD_TARGET: 'local' } });
    expect(eas.build['test-cloud']).toMatchObject({ distribution: 'internal', environment: 'preview', android: { buildType: 'apk' }, env: { EXPO_PUBLIC_BUILD_TARGET: 'test' } });
    expect(eas.build.production).toMatchObject({ environment: 'production', autoIncrement: true, android: { buildType: 'app-bundle' }, env: { EXPO_PUBLIC_BUILD_TARGET: 'production' } });
  });

  it('aucun profil ne contient de configuration Firebase ni d’autorisation de la production en développement (elles viennent des variables EAS, hors dépôt)', () => {
    for (const [name, profile] of Object.entries(eas.build)) {
      for (const key of Object.keys(profile.env ?? {})) expect({ name, key, allowed: key === 'EXPO_PUBLIC_BUILD_TARGET' || key === 'EXPO_PUBLIC_APP_VARIANT' }).toEqual({ name, key, allowed: true });
    }
    expect(read('eas.json')).not.toMatch(/FIREBASE|AIza|takarda-c8cd8|takarda-n2-test/);
  });

  it('la barrière tourne avant tout build EAS ; le fichier .env n’est jamais versionné', () => {
    expect(pkg.scripts['eas-build-pre-install']).toBe('node scripts/release/build-gate.js');
    expect(pkg.scripts['build-gate']).toBe('node scripts/release/build-gate.js');
    expect(read('.gitignore')).toMatch(/^\.env$/m);
  });
});
