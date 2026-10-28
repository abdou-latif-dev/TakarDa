// Phase 1 — identité et configuration de publication.
// Garde-fous : ce que le magasin et l'appareil verront (nom, identifiants, permissions)
// et ce qui ne doit PAS bouger (préfixe de stockage local, projet EAS).

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { delay } from '../db';
import { storage } from '../storage';

const expo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'app.json'), 'utf8')).expo;

describe('Identité de publication', () => {
  it('l’application s’appelle TakarDa, avec le même identifiant sur Android et iOS', () => {
    expect(expo.name).toBe('TakarDa');
    expect(expo.scheme).toBe('takarda');
    expect(expo.android.package).toBe('com.takarda.app');
    expect(expo.ios.bundleIdentifier).toBe('com.takarda.app');
  });

  it('le projet EAS existant est conservé', () => {
    expect(expo.extra.eas.projectId).toBe('8378d459-4d72-4e37-977c-ea65dddf69ff');
  });

  it('aucune référence FormEase dans les textes de permission', () => {
    const plugins = expo.plugins.filter((p: unknown) => Array.isArray(p)) as [string, Record<string, unknown>][];
    const texts = plugins.flatMap(([, options]) => Object.values(options).filter((v): v is string => typeof v === 'string'));
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).not.toMatch(/formease/i);
  });
});

describe('Permissions Android', () => {
  it('RECORD_AUDIO et CAMERA ne sont ni déclarées ni ajoutées par un plugin (V1 : scanner gelé)', () => {
    expect(expo.android.permissions ?? []).not.toContain('android.permission.RECORD_AUDIO');
    expect(expo.android.permissions ?? []).not.toContain('android.permission.CAMERA');
    // Les plugins (expo-camera) ajoutent ces permissions au manifeste : elles sont explicitement bloquées.
    expect(expo.android.blockedPermissions).toEqual(expect.arrayContaining(['android.permission.RECORD_AUDIO', 'android.permission.CAMERA']));
  });

  it('les plugins ne demandent ni micro ni caméra inutiles', () => {
    const optionsOf = (name: string) => (expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === name) as [string, Record<string, unknown>])[1];
    expect(optionsOf('expo-camera')).toMatchObject({ microphonePermission: false, recordAudioAndroid: false });
    expect(optionsOf('expo-image-picker')).toMatchObject({ cameraPermission: false, microphonePermission: false });
  });
});

describe('Stockage local et latence', () => {
  beforeEach(() => AsyncStorage.clear());

  it('le stockage local garde le préfixe @formease/ (aucune migration de données)', async () => {
    await storage.set('cle_de_test', { a: 1 });
    expect(await AsyncStorage.getItem('@formease/cle_de_test')).toBe('{"a":1}');
    expect(await storage.get('cle_de_test')).toEqual({ a: 1 });
  });

  it('delay() n’impose plus de latence artificielle, quel que soit le paramètre', async () => {
    const start = Date.now();
    await delay();
    await delay(5000);
    expect(Date.now() - start).toBeLessThan(500);
  });
});
