// Phase 10 — préparation de l’architecture Firebase, SANS Firebase : le stockage local reste la seule
// persistance, l’identité reste 'u-me', aucun appel réseau, aucune dépendance distante.

import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CURRENT_USER_ID, groups, toolMembers, tools, users } from '../db';
import { ensureLocalUser, getCurrentUserId } from '../identityService';
import { hydrateDb, startAutoPersist } from '../persistence';
import { getMyTools, installTool } from '../toolRegistryService';
import { type KeyValueStore, STORAGE_PREFIX, storage } from '../storage';

// jest.mock est remonté avant les imports par babel-jest.
jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('Adaptateur de stockage local (KeyValueStore)', () => {
  it('le stockage actuel respecte le contrat et garde le préfixe historique @formease/', async () => {
    const store: KeyValueStore = storage;
    expect(STORAGE_PREFIX).toBe('@formease/');
    await store.set('ma_cle', { a: 1, liste: [1, 2] });
    expect(await AsyncStorage.getItem('@formease/ma_cle')).toBe('{"a":1,"liste":[1,2]}'); // même format qu’avant : JSON brut
    expect(await store.get('ma_cle')).toEqual({ a: 1, liste: [1, 2] });
    await store.remove('ma_cle');
    expect(await store.get('ma_cle')).toBeNull();
    expect(await AsyncStorage.getItem('@formease/ma_cle')).toBeNull();
  });

  it('lit les données écrites par les versions antérieures (clés historiques inchangées)', async () => {
    await AsyncStorage.multiSet([
      ['@formease/session', JSON.stringify({ userId: 'u-me' })],
      ['@formease/onboarding_seen', 'true'],
      ['@formease/theme_settings', JSON.stringify({ mode: 'system', accentKey: 'x' })],
      ['@formease/db_snapshot', JSON.stringify({ users: [{ id: 'u-me' }] })],
      ['@formease/core_meta', JSON.stringify({ schemaVersion: 1 })],
      ['@formease/core_tools', JSON.stringify([{ id: 'tool-1' }])],
    ]);
    expect(await storage.get('session')).toEqual({ userId: 'u-me' });
    expect(await storage.get('onboarding_seen')).toBe(true);
    expect(await storage.get('theme_settings')).toEqual({ mode: 'system', accentKey: 'x' });
    expect(await storage.get('db_snapshot')).toEqual({ users: [{ id: 'u-me' }] });
    expect(await storage.get('core_meta')).toEqual({ schemaVersion: 1 });
    expect(await storage.get('core_tools')).toEqual([{ id: 'tool-1' }]);
    expect(await storage.get('cle_absente')).toBeNull();
  });

  it('les erreurs de stockage ne sont pas avalées : elles remontent à l’appelant', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('stockage indisponible'));
    await expect(storage.get('x')).rejects.toThrow('stockage indisponible');
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disque plein'));
    await expect(storage.set('x', 1)).rejects.toThrow('disque plein');
    await AsyncStorage.setItem('@formease/corrompu', '{pas du json');
    await expect(storage.get('corrompu')).rejects.toThrow();
  });
});

describe('Persistance existante, identité locale et outils installés', () => {
  it('une identité unique : u-me, jamais remplacée par un identifiant distant', () => {
    expect(CURRENT_USER_ID).toBe('u-me');
    expect(getCurrentUserId()).toBe('u-me');
    users.length = 0;
    expect(ensureLocalUser().id).toBe('u-me');
  });

  it('un outil installé, son propriétaire u-me et ses données survivent à un redémarrage, sans aucun appel réseau', async () => {
    const fetchSpy = jest.fn(() => Promise.reject(new Error('réseau interdit')));
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    jest.useFakeTimers();
    try {
      users.length = 0;
      groups.length = 0;
      tools.length = 0;
      ensureLocalUser();
      const tool = await installTool('immobilier');
      expect(tool.ownerId).toBe('u-me');

      const stop = startAutoPersist();
      await jest.advanceTimersByTimeAsync(3100);
      stop();

      const ownerBefore = tool.ownerId;
      tools.length = 0; // redémarrage : mémoire vide, puis relecture du stockage local seul
      toolMembers.length = 0;
      users.length = 0;
      await hydrateDb();
      ensureLocalUser();

      const mine = await getMyTools();
      expect(mine.owned.map((m) => m.tool.id)).toContain(tool.id);
      expect(mine.shared).toEqual([]); // le partage n’existe pas encore en V1
      expect(tools.find((t) => t.id === tool.id)?.ownerId).toBe(ownerBefore);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
      globalThis.fetch = original;
    }
  });
});

describe('Firebase : préparé, pas branché', () => {
  const walk = (d: string): string[] =>
    fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => {
      if (e.name === '__tests__') return [];
      return e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : [];
    });
  const sources = ['app', 'components', 'constants', 'features', 'services', 'store', 'utils', 'types'].flatMap(walk);

  it('le SDK JavaScript est installé ; ni React Native Firebase, ni configuration native (app.json, eas.json)', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies.firebase).toMatch(/^\^12\./);
    expect(Object.keys(pkg.dependencies).filter((d) => d.startsWith('@react-native-firebase'))).toEqual([]);
    for (const file of ['app.json', 'eas.json']) expect(read(file)).not.toMatch(/firebase|googleServicesFile/i);
  });

  // google-services.json est un fichier LOCAL (ignoré par Git) : absent d'un clone neuf, ce test est alors explicitement IGNORÉ (jamais présenté comme réussi).
  const itWithLocalAndroidConfig = fs.existsSync(path.join(root, 'google-services.json')) ? it : it.skip;
  itWithLocalAndroidConfig('(ignoré sans google-services.json local) google-services.json correspond au projet takarda-c8cd8 et au package com.takarda.app', () => {
    const json = JSON.parse(read('google-services.json'));
    expect(json.project_info.project_id).toBe('takarda-c8cd8');
    expect(json.client[0].client_info.android_client_info.package_name).toBe('com.takarda.app');
  });

  it('aucun fichier de configuration iOS ni projet CLI par défaut dans le dépôt', () => {
    for (const file of ['GoogleService-Info.plist', '.firebaserc']) expect(fs.existsSync(path.join(root, file))).toBe(false);
  });

  it('le SDK Firebase n’est importé que par services/firebase/ ; rien ne l’utilise encore (aucun compte exigé, aucune synchronisation)', () => {
    for (const file of sources) {
      const src = read(file);
      if (file.startsWith('services/firebase/')) continue;
      expect(src).not.toMatch(/from ['"](firebase|@firebase|@react-native-firebase)[/'"]/);
      expect(src).not.toMatch(/firebase\/firebaseClient/); // pas encore branché au démarrage ni aux écrans
    }
    expect(fs.existsSync(path.join(root, 'services/firebase/firebaseClient.ts'))).toBe(true);
  });

  it('le client n’initialise rien à l’import : Firebase ne démarre qu’à l’appel des getters', () => {
    const client = read('services/firebase/firebaseClient.ts');
    expect(client).toMatch(/export function getFirebaseApp/);
    expect(client).toMatch(/export function getFirebaseAuth/);
    expect(client).toMatch(/export function getFirestoreDb/);
    expect(client).not.toMatch(/^initializeApp\(|^const app = initializeApp/m);
    expect(client).not.toMatch(/signIn|createUser|setDoc|addDoc|getDocs|onSnapshot/); // aucune authentification simulée ni lecture/écriture
  });

  it('pas d’appel réseau direct ailleurs dans le code applicatif', () => {
    for (const file of sources) {
      const src = read(file);
      expect(src).not.toMatch(/\bXMLHttpRequest\b|\baxios\b|\bWebSocket\(/);
      expect(src).not.toMatch(/(^|[^.\w])fetch\(\s*['"`]https?:/m);
    }
  });

  it('les identifiants de publication historiques sont inchangés', () => {
    const expo = JSON.parse(read('app.json')).expo;
    expect(expo.android.package).toBe('com.takarda.app');
    expect(expo.extra.eas.projectId).toBe('8378d459-4d72-4e37-977c-ea65dddf69ff');
  });
});
