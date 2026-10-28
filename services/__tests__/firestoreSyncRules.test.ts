// P4 — contrôles STATIQUES du candidat de règles (firestore.p4.rules) et de l'isolation des adaptateurs. Toujours exécutés, sans émulateur.
// L'exécution réelle des règles est dans firestoreSyncRules.emulator.test.ts (émulateur local) et firebaseTestProject/real/sync.n2.test.ts
// (projet de test) : non lancés tant qu'ils ne sont pas autorisés.

import fs from 'fs';
import path from 'path';
import { CLOUD_DOC_FIELDS, cloudFinancialKinds, cloudKinds } from '../firebase/syncDocModel';
import { localOnlyFields } from '../sync/wireFormat';
import { KIND } from '../sync/kindRegistry';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined, clear: async () => undefined, getAllKeys: async () => [] },
}));

const root = path.join(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const current = read('firestore.rules');
const candidate = read('firestore.p4.rules');
const BEGIN = '      // >>> P4 SYNC BEGIN';
const END = '      // <<< P4 SYNC END\n';
const start = candidate.indexOf(BEGIN);
const stop = candidate.indexOf(END) + END.length;
const block = candidate.slice(start, stop);
const codeOnly = (text: string) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const listAfter = (source: string, fn: string): string[] => {
  const m = new RegExp(`function ${fn}\\(\\) \\{\\s*return \\[([^\\]]*)\\];`).exec(source);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
};

describe('Candidat de règles P4 — contrôles statiques', () => {
  it('le candidat est EXACTEMENT les règles actuelles + un bloc délimité (aucune règle existante n’est modifiée)', () => {
    expect(start).toBeGreaterThan(0);
    expect(stop).toBeGreaterThan(start);
    expect(candidate.slice(0, start).replace(/\n$/, '') + candidate.slice(stop)).toBe(current); // le bloc est encadré d'un saut de ligne de part et d'autre
    expect(candidate.split('P4 SYNC BEGIN').length).toBe(2); // un seul bloc
  });

  it('le bloc est dans « match /spaces/{spaceId} », avant la règle de refus par défaut, qui est conservée', () => {
    const before = candidate.slice(0, start);
    expect(before.lastIndexOf('match /spaces/{spaceId} {')).toBeGreaterThan(before.lastIndexOf('match /users/{uid} {'));
    expect(candidate.slice(stop)).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
    expect(codeOnly(candidate)).toContain("rules_version = '2'");
  });

  it('les types autorisés et les faits financiers sont exactement ceux du registre', () => {
    expect(listAfter(block, 'syncKinds').sort()).toEqual([...cloudKinds()].sort());
    expect(listAfter(block, 'financialKinds').sort()).toEqual([...cloudFinancialKinds()].sort());
    expect(cloudFinancialKinds().sort()).toEqual([KIND.IMMOBILIER_CORRECTION_PAIEMENT, KIND.IMMOBILIER_PAIEMENT].sort());
  });

  it('les champs exigés sont exactement ceux du modèle de documents (hasOnly et hasAll)', () => {
    const lists = [...block.matchAll(/keys\(\)\.(hasOnly|hasAll)\(\[([^\]]*)\]\)/g)].map((m) => [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort());
    expect(lists).toHaveLength(2);
    for (const list of lists) expect(list).toEqual([...CLOUD_DOC_FIELDS].sort());
  });

  it('aucune règle publique ni ouverte à tout compte connecté ; chaque accès exige l’espace personnel du compte', () => {
    const code = codeOnly(block);
    expect(code).not.toMatch(/if\s+true\s*;/);
    expect(code).not.toMatch(/allow[^;]*:\s*if\s+request\.auth\s*!=\s*null\s*;/);
    expect(code).not.toMatch(/allow[^;]*:\s*if\s+signedIn\(\)\s*;/);
    const allows = code.split(/\n(?=\s*allow )/).filter((s) => /^\s*allow /.test(s));
    expect(allows.map((a) => /allow (\w+)/.exec(a)![1])).toEqual(['read', 'create', 'update', 'delete']);
    for (const rule of allows) expect(rule).toMatch(/ownSpace\(\)|isPersonalSpaceOwner\(spaceId\)/);
    expect(code).toContain("spaceId == 'personal_' + request.auth.uid");
    expect(code).toMatch(/allow read: if ownSpace\(\)\s*&& isMember\(spaceId\);/);
  });

  it('suppression physique : jamais ordinaire — propriétaire de son espace personnel ET espace verrouillé', () => {
    const del = /allow delete:[^;]*;/.exec(codeOnly(block))![0];
    expect(del).toBe('allow delete: if isPersonalSpaceOwner(spaceId) && !syncUnlocked();');
    expect(codeOnly(block)).toMatch(/function syncUnlocked\(\) \{\s*return get\(spacePath\(spaceId\)\)\.data\.get\('deletionLockedAt', null\) == null;/);
  });

  it('faits financiers : aucune branche de modification, de suppression logique ni de restauration', () => {
    const update = /allow update:[\s\S]*?;\n/.exec(codeOnly(block))![0];
    expect(update).toContain('!(resource.data.kind in financialKinds())');
    expect(update).toContain('incoming().kind == resource.data.kind'); // un document ne peut pas changer de type pour échapper à la règle
    expect(codeOnly(block)).toMatch(/allow create:[\s\S]*?incoming\(\)\.rev == 1[\s\S]*?incoming\(\)\.deleted == false/);
  });

  it('révision strictement « ancienne + 1 », horodatage serveur imposé, espace verrouillé respecté, transitions limitées', () => {
    const code = codeOnly(block);
    expect(code).toContain('incoming().rev == resource.data.rev + 1');
    expect(code).toContain('incoming().serverUpdatedAt == request.time');
    expect(code).toContain("get(spacePath(spaceId)).data.get('deletionLockedAt', null) == null");
    expect(code).toMatch(/function deleting\(\) \{[\s\S]*?hasOnly\(\['deleted', 'deletedAt', 'rev', 'lastOpId', 'serverUpdatedAt'\]\)/);
    expect(code).toMatch(/function restoring\(\) \{[\s\S]*?hasOnly\(\['deleted', 'deletedAt', 'restoredAt', 'rev', 'lastOpId', 'serverUpdatedAt'\]\)/);
    expect(code).toContain('incoming().createdAt == resource.data.createdAt');
    expect(code).toContain('incoming().ownerUid == request.auth.uid');
  });

  it('les champs réservés à l’appareil sont refusés dans le contenu (même liste que la validation de réception)', () => {
    const forbidden = [...codeOnly(block).matchAll(/!\('(\w+)' in incoming\(\)\.body\)/g)].map((m) => m[1]).sort();
    expect(forbidden).toEqual(['cloudOwnerUid', 'entityDefinitionId', 'id', 'statusKey', 'toolId']);
    for (const kind of cloudKinds()) for (const name of forbidden) expect(localOnlyFields(kind).has(name)).toBe(true);
  });

  it('syntaxe : accolades, parenthèses et crochets équilibrés dans le candidat entier', () => {
    const stripped = codeOnly(candidate).replace(/'[^']*'/g, "''");
    for (const [open, close] of [['{', '}'], ['(', ')'], ['[', ']']]) expect(stripped.split(open).length).toBe(stripped.split(close).length);
    let depth = 0;
    for (const ch of stripped) {
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  it('la configuration de publication du candidat désigne le candidat et aucun projet (le projet est toujours passé explicitement)', () => {
    const config = JSON.parse(read('firebase.n2.sync.json'));
    expect(config).toEqual({ firestore: { rules: 'firestore.p4.rules' } });
    expect(read('firebase.n2.sync.json')).not.toMatch(/takarda-c8cd8|takarda-n2-test|projects?"/);
    expect(JSON.parse(read('firebase.json'))).toEqual({ firestore: { rules: 'firestore.rules' }, emulators: { firestore: { port: 8080 }, singleProjectMode: true } });
    expect(fs.existsSync(path.join(root, '.firebaserc'))).toBe(false);
  });

  it('les règles actuelles (V1) ne sont pas modifiées et ne mentionnent pas encore la synchronisation', () => {
    expect(codeOnly(current)).not.toContain('syncRecords');
  });
});

describe('Adaptateurs Firebase — isolation de l’application', () => {
  const adapters = ['syncDocModel', 'firestoreSyncTransport', 'firestoreSyncBackend', 'syncAccountErasure', 'accountCloudErasure', 'cloudDeletionComposition'].map((n) => `services/firebase/${n}.ts`);
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (['node_modules', '.git', '.expo', 'android', 'ios', 'coverage', 'dist'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : [],
    );

  it('seuls les tests importent les adaptateurs : ni écrans, ni stores, ni services métier', () => {
    const pattern = /(syncDocModel|firestoreSyncTransport|firestoreSyncBackend|syncAccountErasure|accountCloudErasure|cloudDeletionComposition)['"]/;
    const users = walk(root)
      .map((f) => path.relative(root, f).replace(/\\/g, '/'))
      .filter((f) => !f.includes('__tests__/') && !adapters.includes(f))
      .filter((f) => pattern.test(read(f)));
    // consommateurs de production : la suppression de compte (P5) et la composition du cycle (phase 6, étape 7, jamais appelée) — tous deux
    // joignables uniquement derrière CLOUD_ACCOUNT_ENABLED
    expect(users).toEqual(['services/firebase/accountDeletionApi.ts', 'services/firebase/syncRuntimeBoot.ts']);
  });

  it('la suppression de compte réelle passe par la procédure complète : purge de syncRecords vérifiée AVANT records, espace et profil', () => {
    const api = read('services/firebase/accountDeletionApi.ts');
    expect(api).toContain('return createCloudDeletion(getFirestoreDb())(uid);'); // la même composition que celle validée sur le projet de test (F6 : précédée du départ, en meilleur effort, des espaces rejoints)
    const composed = read('services/firebase/cloudDeletionComposition.ts');
    expect(composed).toMatch(/deleteAccountCloudDataWithSync\(uid, \{[\s\S]*?deleteRest: \(\) => deleteAccountCloudData\(db, uid, hooks\.deletion\)/);
    expect(api).not.toMatch(/deleteCloudData: \(uid\) => deleteAccountCloudData\(/); // plus d'appel direct qui laisserait des orphelins
    expect(read('constants/features.ts')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
    const composition = read('services/firebase/accountCloudErasure.ts');
    expect(composition).toMatch(/verified: e\.verified/);
    expect(composition).toContain("le reste n'a PAS été lancé");
  });

  it('seul le module backend importe le SDK Firestore ; aucun adaptateur n’importe la configuration ni le client applicatif', () => {
    for (const file of adapters) {
      const src = read(file);
      const imports = src.split('\n').filter((l) => /^\s*(import|export) .* from /.test(l)).join('\n');
      expect(imports).not.toMatch(/firebaseClient|firebaseWebConfig|cloudSyncService|firestoreRecordsApi|firebaseAuthService|@react-native-firebase|firebase\/auth|firebase\/app/);
      // les imports de TYPES seuls (effacés à la compilation) sont admis ; aucun import de valeur du SDK hors du module backend
      const valueImports = imports.split('\n').filter((l) => !/^\s*import type /.test(l)).join('\n');
      if (!file.endsWith('firestoreSyncBackend.ts')) expect(valueImports).not.toMatch(/firebase\/firestore/);
      expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|new WebSocket|\baxios\b/);
      expect(src).not.toMatch(/^(initializeApp|getFirestore|getAuth)\(/m); // rien ne démarre à l'import
    }
  });

  it('un seul espace : le chemin est toujours personal_<uid> ; aucun identifiant d’espace n’est un paramètre libre', () => {
    const backend = read('services/firebase/firestoreSyncBackend.ts');
    expect(backend).toContain('personalSpaceOf(uid)');
    expect(backend).not.toMatch(/spaceId\s*[:=](?!\s*personalSpaceOf\(uid\))/); // seule affectation : personalSpaceOf(uid)
    expect(read('services/firebase/firestoreSyncTransport.ts')).not.toMatch(/spaceId/);
  });

  it('la suppression physique n’existe que dans la procédure d’effacement : ni dans le transport ordinaire, ni dans son port', () => {
    const transport = read('services/firebase/firestoreSyncTransport.ts');
    expect(codeOnly(transport)).not.toMatch(/purge|removeSyncDocs|deleteDoc|\bremove\(/);
    const backend = read('services/firebase/firestoreSyncBackend.ts');
    const ordinary = backend.slice(backend.indexOf('export function createFirestoreSyncBackend'), backend.indexOf('export function createFirestoreErasureBackend'));
    expect(ordinary).not.toMatch(/writeBatch|delete\(|deleteDoc/);
    expect(backend.slice(backend.indexOf('export function createFirestoreErasureBackend'))).toMatch(/batch\.delete/);
    const erasure = read('services/firebase/syncAccountErasure.ts');
    // l'ordre est inscrit dans le code : verrou confirmé, puis purge vérifiée, PUIS le reste
    expect(erasure.indexOf('backend.lockSpace')).toBeLessThan(erasure.indexOf('backend.removeSyncDocs'));
    expect(erasure.indexOf('backend.removeSyncDocs')).toBeLessThan(erasure.indexOf('options.deleteRest()'));
    expect(erasure).toMatch(/left\.length > 0[\s\S]*?return report;[\s\S]*?report\.syncRecords\.status = 'purged'/);
  });

  it('le cloud reste fermé dans l’application', () => {
    expect(read('constants/features.ts')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
  });
});
