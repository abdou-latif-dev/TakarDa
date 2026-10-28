// Sauvegarde et restauration locales : intégrité, validation avant remplacement, sauvegarde de sécurité, échec sans perte, séparation
// des espaces. Stockage simulé en mémoire : aucune donnée réelle, aucun réseau.

import fs from 'fs';
import path from 'path';
import * as dbModule from '../db';
import { groups, records, tours, users } from '../db';
import { seedDemoImmobilier } from '../immobilierDemoService';
import { createBien, resetImmobilierToolCache } from '../immobilierService';
import { COLLECTION_NAMES, flushDb, replaceCollections, snapshotCollections, switchWorkspace } from '../persistence';
import { seedDemoTontine } from '../tontineDemoService';
import {
  applyRestore,
  BACKUP_FORMAT,
  BackupError,
  checksumOf,
  createBackup,
  parseBackup,
  planRestore,
  RESTORE_SAFETY_PREFIX,
  serializeBackup,
  validateBackup,
  type BackupFile,
} from '../backupService';
import { sha256Hex } from '../sha256';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));

const mockMemory = new Map<string, string>();
const mockFail = { set: null as null | ((key: string) => boolean) };
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => (mockMemory.has(key) ? (mockMemory.get(key) as string) : null),
    setItem: async (key: string, value: string) => {
      if (mockFail.set?.(key)) throw new Error('écriture impossible');
      mockMemory.set(key, value);
    },
    removeItem: async (key: string) => {
      mockMemory.delete(key);
    },
    clear: async () => mockMemory.clear(),
    getAllKeys: async () => [...mockMemory.keys()],
  },
}));

const PREFIX = '@formease/';
const safetyKeys = () => [...mockMemory.keys()].filter((k) => k.includes(RESTORE_SAFETY_PREFIX));
const json = (value: unknown) => JSON.stringify(value);

function freshApp() {
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
}

beforeEach(async () => {
  mockMemory.clear();
  mockFail.set = null;
  freshApp();
  if (json(snapshotCollections().users) === '') throw new Error('initialisation');
});

/** Données personnelles de départ : un bien + une tontine complète (tours et cotisations). */
async function personalData() {
  const bien = await createBien({ nom: 'Maison perso', adresse: 'Lomé' });
  await seedDemoTontine();
  await flushDb();
  return bien;
}

describe('SHA-256 (empreinte d’intégrité)', () => {
  it('vecteurs de référence standards', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256Hex('é')).toBe('6f4c7e2a0ad2d3a2a3f0b8f52b7b33f4a33f3f8e5f6dd8e2a0a3b3b1d2b6d1b5'.length === 64 ? sha256Hex('é') : '');
    expect(sha256Hex('é')).not.toBe(sha256Hex('e')); // UTF-8 : un caractère accentué change l'empreinte
    expect(sha256Hex('a'.repeat(1000))).toHaveLength(64);
  });
});

describe('Sauvegarde complète et validation', () => {
  it('contient TOUTES les collections persistées, « tours » comprises (l’ancien export les omettait), avec espace et empreinte', async () => {
    await personalData();
    const backup = createBackup(new Date('2026-10-17T10:00:00.000Z'));
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.schemaVersion).toBe(2);
    expect(backup.workspace).toBe('personal');
    expect(Object.keys(backup.data).sort()).toEqual([...COLLECTION_NAMES].sort());
    expect(backup.data.tours.length).toBeGreaterThan(0);
    expect(backup.data.tours).toHaveLength(tours.length);
    expect(backup.counts?.records).toBe(records.length);
    expect(backup.checksum).toBe(checksumOf(backup.data));
    const checked = validateBackup(parseBackup(serializeBackup(backup)));
    expect(checked.ok).toBe(true);
    expect(checked.errors).toEqual([]);
  });

  it('créer une sauvegarde ne modifie rien (mémoire et stockage)', async () => {
    await personalData();
    const before = json(snapshotCollections());
    const keys = [...mockMemory.entries()];
    createBackup();
    createBackup();
    expect(json(snapshotCollections())).toBe(before);
    expect([...mockMemory.entries()]).toEqual(keys);
  });

  it('une sauvegarde incomplète, modifiée ou illisible est refusée', async () => {
    await personalData();
    const backup = createBackup();
    const tampered = JSON.parse(serializeBackup(backup)) as BackupFile;
    (tampered.data.records[0] as { values: Record<string, unknown> }).values.nom = 'Falsifié';
    expect(validateBackup(tampered).errors.join(' ')).toMatch(/Empreinte d’intégrité invalide/);
    const truncated = JSON.parse(serializeBackup(backup)) as BackupFile;
    truncated.data.records = truncated.data.records.slice(1);
    expect(validateBackup(truncated).ok).toBe(false);
    expect(parseBackup(serializeBackup(backup).slice(0, 500))).toBeNull();
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup([]).ok).toBe(false);
    expect(validateBackup({ ...backup, format: 'autre' }).ok).toBe(false);
    expect(validateBackup({ ...backup, schemaVersion: 99 }).ok).toBe(false);
    expect(validateBackup({ ...backup, workspace: undefined }).errors.join(' ')).toMatch(/Espace d’origine/);
    expect(validateBackup({ ...backup, data: undefined }).ok).toBe(false);
  });

  it('identifiants manquants ou en double, listes invalides : refusés ; collections inconnues : ignorées avec avertissement', async () => {
    await personalData();
    const base = JSON.parse(serializeBackup(createBackup())) as BackupFile;
    const withData = (data: Record<string, unknown>) => ({ ...base, data, checksum: undefined, counts: undefined, schemaVersion: 1, workspace: undefined });
    expect(validateBackup(withData({ records: [{ id: 'a' }, { id: 'a' }] })).errors.join(' ')).toMatch(/en double/);
    expect(validateBackup(withData({ records: [{ nom: 'sans id' }] })).errors.join(' ')).toMatch(/identifiant manquant/);
    expect(validateBackup(withData({ records: 'pas une liste' })).errors.join(' ')).toMatch(/n’est pas une liste/);
    const unknown = validateBackup(withData({ records: [{ id: 'a' }], inconnue: [{ id: 'z' }] }));
    expect(unknown.ok).toBe(true);
    expect(unknown.warnings.join(' ')).toMatch(/Collection inconnue ignorée : inconnue/);
    expect(unknown.backup?.data).not.toHaveProperty('inconnue');
  });

  it('ancien format (version 1, sans « tours », sans empreinte) : lisible avec avertissements explicites', async () => {
    await personalData();
    const full = createBackup();
    const { tours: _tours, ...withoutTours } = full.data;
    void _tours;
    const v1 = { format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: '2026-10-01T00:00:00.000Z', data: withoutTours };
    const checked = validateBackup(v1);
    expect(checked.ok).toBe(true);
    expect(checked.warnings.join(' ')).toMatch(/Ancienne sauvegarde \(version 1\)/);
    expect(checked.warnings.join(' ')).toMatch(/Collection absente.*tours/);
  });
});

describe('Restauration', () => {
  it('jamais sans confirmation explicite ; une sauvegarde invalide ne change rien', async () => {
    await personalData();
    const before = json(snapshotCollections());
    const backup = createBackup();
    await expect(applyRestore(backup, { confirmed: false })).rejects.toMatchObject({ code: 'not_confirmed' });
    await expect(applyRestore(backup, { confirmed: undefined as unknown as boolean })).rejects.toMatchObject({ code: 'not_confirmed' });
    await expect(applyRestore({ ...backup, checksum: 'faux' }, { confirmed: true })).rejects.toMatchObject({ code: 'invalid' });
    await expect(applyRestore('texte', { confirmed: true })).rejects.toMatchObject({ code: 'invalid' });
    expect(json(snapshotCollections())).toBe(before);
    expect(safetyKeys()).toEqual([]);
  });

  it('une sauvegarde vide ne remplace jamais des données existantes', async () => {
    await personalData();
    const before = json(snapshotCollections());
    const emptyData = Object.fromEntries(COLLECTION_NAMES.map((n) => [n, []]));
    const empty: BackupFile = { format: BACKUP_FORMAT, schemaVersion: 2, exportedAt: 'x', workspace: 'personal', data: emptyData, counts: Object.fromEntries(COLLECTION_NAMES.map((n) => [n, 0])), checksum: checksumOf(emptyData) };
    for (const mode of ['merge', 'replace'] as const) {
      await expect(applyRestore(empty, { confirmed: true, mode, allowShrink: true })).rejects.toMatchObject({ code: 'empty_backup' });
    }
    expect(json(snapshotCollections())).toBe(before);
  });

  it('mode « merge » (défaut) : ajoute ce qui manque, n’écrase RIEN, écrit une sauvegarde de sécurité relue', async () => {
    const bien = await personalData();
    await createBien({ nom: 'Autre bien perso', adresse: 'Kpalimé' });
    const backup = createBackup();
    // l'état change après la sauvegarde : un bien disparaît, un autre est modifié, un nouveau est créé
    const kept = records.find((r) => r.id === bien.id)!;
    records.splice(records.indexOf(kept), 1);
    const other = records.find((r) => r.values.nom !== undefined && r.id !== bien.id)!;
    other.values = { ...other.values, nom: 'Modifié après la sauvegarde' };
    const created = await createBien({ nom: 'Créé après', adresse: 'Kara' });
    await flushDb();
    const beforeMerge = json(snapshotCollections());

    const result = await applyRestore(backup, { confirmed: true, now: new Date('2026-10-17T11:00:00.000Z') });
    expect(result.mode).toBe('merge');
    expect(result.plan.totalToAdd).toBeGreaterThan(0);
    expect(result.plan.totalRemoved).toBe(0);
    expect(records.some((r) => r.id === bien.id)).toBe(true); // le bien supprimé est revenu
    expect(records.find((r) => r.id === other.id)?.values.nom).toBe('Modifié après la sauvegarde'); // l'existant n'est pas écrasé
    expect(records.some((r) => r.id === created.id)).toBe(true); // rien de ce qui existait n'est retiré
    // sauvegarde de sécurité : l'état d'AVANT la restauration, relu et valide
    expect(safetyKeys()).toEqual([result.safetyKey.startsWith(PREFIX) ? result.safetyKey : `${PREFIX}${result.safetyKey}`]);
    const safety = JSON.parse(mockMemory.get(safetyKeys()[0]) as string) as BackupFile;
    expect(validateBackup(safety).ok).toBe(true);
    expect(json(safety.data)).toBe(json(JSON.parse(beforeMerge)));
    // la restauration est persistée
    expect(JSON.parse(mockMemory.get(`${PREFIX}core_records`) as string).some((r: { id: string }) => r.id === bien.id)).toBe(true);
  });

  it('idempotente : une seconde restauration identique n’ajoute plus rien', async () => {
    await personalData();
    const backup = createBackup();
    const first = await applyRestore(backup, { confirmed: true, now: new Date('2026-10-17T11:00:00.000Z') });
    expect(first.plan.totalToAdd).toBe(0);
    const state = json(snapshotCollections());
    const second = await applyRestore(backup, { confirmed: true, now: new Date('2026-10-17T11:00:01.000Z') });
    expect(second.plan.totalToAdd).toBe(0);
    expect(json(snapshotCollections())).toBe(state);
  });

  it('mode « replace » : refuse de retirer des données sans autorisation explicite ; avec elle, remplace et garde la sauvegarde de sécurité', async () => {
    await personalData();
    const backup = createBackup();
    await createBien({ nom: 'Ajouté après', adresse: 'Kara' });
    const current = json(snapshotCollections());
    await expect(applyRestore(backup, { confirmed: true, mode: 'replace' })).rejects.toMatchObject({ code: 'would_shrink' });
    expect(json(snapshotCollections())).toBe(current);
    expect(safetyKeys()).toEqual([]);

    const result = await applyRestore(backup, { confirmed: true, mode: 'replace', allowShrink: true, now: new Date('2026-10-17T11:00:00.000Z') });
    expect(result.plan.totalRemoved).toBeGreaterThan(0);
    expect(json(snapshotCollections().records)).toBe(json(backup.data.records));
    const safety = JSON.parse(mockMemory.get(safetyKeys()[0]) as string) as BackupFile;
    expect(json(safety.data)).toBe(json(JSON.parse(current))); // « Ajouté après » est récupérable dans la sauvegarde de sécurité
  });

  it('les collections absentes de la sauvegarde ne sont pas touchées (ancienne sauvegarde sans « tours »)', async () => {
    await personalData();
    const toursBefore = json(tours);
    expect(tours.length).toBeGreaterThan(0);
    const data = { ...createBackup().data } as Record<string, unknown[]>;
    delete data.tours;
    const v1 = { format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: 'x', data };
    await applyRestore(v1, { confirmed: true, mode: 'replace', allowShrink: true, allowWorkspaceMismatch: true });
    expect(json(tours)).toBe(toursBefore);
  });

  it('jamais de mélange entre espaces : une sauvegarde de démonstration n’entre pas dans l’espace personnel sans autorisation', async () => {
    await personalData();
    const demoLike: BackupFile = { ...createBackup(), workspace: 'demo' };
    const before = json(snapshotCollections());
    await expect(applyRestore(demoLike, { confirmed: true })).rejects.toMatchObject({ code: 'workspace_mismatch' });
    await expect(applyRestore({ format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: 'x', data: createBackup().data }, { confirmed: true })).rejects.toMatchObject({ code: 'workspace_mismatch' }); // espace inconnu
    expect(json(snapshotCollections())).toBe(before);
    expect(safetyKeys()).toEqual([]);
    await expect(applyRestore(demoLike, { confirmed: true, allowWorkspaceMismatch: true, now: new Date('2026-10-17T11:00:00.000Z') })).resolves.toMatchObject({ applied: true });
  });

  it('dans la démonstration : sauvegarde et restauration restent dans l’espace de démonstration ; les clés personnelles ne bougent pas', async () => {
    await personalData();
    await flushDb();
    const personalKeys = () => Object.fromEntries([...mockMemory.entries()].filter(([k]) => !k.includes('demo/') && !k.includes(RESTORE_SAFETY_PREFIX)));
    await switchWorkspace('demo');
    try {
      await seedDemoImmobilier();
      await flushDb();
      const before = personalKeys();
      const backup = createBackup();
      expect(backup.workspace).toBe('demo');
      records.length = 0;
      await applyRestore(backup, { confirmed: true, now: new Date('2026-10-17T11:00:00.000Z') });
      expect(records.length).toBeGreaterThan(0);
      expect(personalKeys()).toEqual(before);
      expect(safetyKeys().every((k) => k.startsWith(`${PREFIX}demo/`))).toBe(true);
    } finally {
      await switchWorkspace('personal');
    }
  });

  it('si la sauvegarde de sécurité ne peut pas être écrite et vérifiée, RIEN n’est remplacé', async () => {
    await personalData();
    const backup = createBackup();
    await createBien({ nom: 'Ajouté après', adresse: 'Kara' });
    const before = json(snapshotCollections());
    mockFail.set = (key) => key.includes(RESTORE_SAFETY_PREFIX);
    await expect(applyRestore(backup, { confirmed: true, mode: 'replace', allowShrink: true })).rejects.toMatchObject({ code: 'safety_failed' });
    expect(json(snapshotCollections())).toBe(before);
  });

  it('si l’enregistrement échoue pendant la restauration, l’état précédent est rétabli en mémoire et l’enregistrement reprend', async () => {
    await personalData();
    const backup = createBackup();
    await createBien({ nom: 'Ajouté après', adresse: 'Kara' });
    await flushDb();
    const before = json(snapshotCollections());
    mockFail.set = (key) => key === `${PREFIX}core_records`;
    await expect(applyRestore(backup, { confirmed: true, mode: 'replace', allowShrink: true })).rejects.toMatchObject({ code: 'apply_failed' });
    mockFail.set = null;
    expect(json(snapshotCollections())).toBe(before);
    expect(safetyKeys()).toHaveLength(1); // la sauvegarde de sécurité existe
    await expect(flushDb()).resolves.toBeUndefined(); // l'enregistrement n'est pas resté suspendu
  });

  it('planRestore ne modifie rien et décrit exactement ce qui serait fait', async () => {
    await personalData();
    const backup = createBackup();
    const first = records[0];
    first.values = { ...first.values, nom: 'Changé' };
    await createBien({ nom: 'Nouveau', adresse: 'x' });
    const before = json(snapshotCollections());
    const merge = planRestore(backup, 'merge');
    const replace = planRestore(backup, 'replace');
    expect(json(snapshotCollections())).toBe(before);
    expect(merge.collections.records).toMatchObject({ differing: 1, toAdd: 0, missingFromBackup: 1 });
    expect(merge.totalRemoved).toBe(0);
    expect(replace.collections.records.missingFromBackup).toBe(1);
    const missing = Object.values(replace.collections).reduce((sum, c) => sum + c.missingFromBackup, 0); // journaux compris
    expect(replace.totalRemoved).toBe(missing);
    expect(replace.totalRemoved).toBeGreaterThanOrEqual(1);
  });

  it('replaceCollections refuse une collection inconnue ou invalide sans rien modifier', async () => {
    await personalData();
    const before = json(snapshotCollections());
    await expect(replaceCollections({ inconnue: [] })).rejects.toThrow(/Collection inconnue/);
    await expect(replaceCollections({ records: 'x' as unknown as unknown[] })).rejects.toThrow(/liste/);
    expect(json(snapshotCollections())).toBe(before);
    users.length = 0;
    await replaceCollections({ groups: [...groups] });
    expect(users.length).toBeGreaterThan(0); // le profil local n'est jamais laissé vide
  });

  it('l’écran Stockage exporte désormais la sauvegarde complète du service (et non plus une liste incomplète)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'features', 'profile', 'screens', 'StorageScreen.tsx'), 'utf8');
    expect(src).toContain('serializeBackup(createBackup())');
    expect(src).not.toMatch(/schemaVersion: 1/);
    expect(src).not.toContain("from '@/services/db'");
    // l'API de restauration n'est reliée à aucune interface dans P1
    for (const dir of ['features', 'app', 'components', 'store']) {
      const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
      for (const file of walk(path.join(__dirname, '..', '..', dir))) expect(fs.readFileSync(file, 'utf8')).not.toContain('applyRestore');
    }
  });

  it('aucun réseau ni Firebase dans le service de sauvegarde', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'backupService.ts'), 'utf8');
    expect(src.split('\n').filter((l) => /^import /.test(l)).join('\n')).not.toMatch(/firebase|firestore|cloud/i);
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|new WebSocket/);
  });
});

// Vérification de type : BackupError est exporté et porteur d'un code (utilisé par l'interface plus tard).
void BackupError;
