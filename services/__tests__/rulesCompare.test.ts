// Outil de comparaison des règles actives (scripts/firebase-rules/compare.js) : niveau détecté, identité, règles ouvertes, lignes retirées. Local, sans réseau.

import fs from 'fs';
import path from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const compare = require('../../scripts/firebase-rules/compare.js') as {
  analyse: (active: string, candidate: string) => { identical: boolean; level: { id: string }; open: string[]; addedByCandidate: string[]; onlyInActive: string[]; structure: object };
};
/* eslint-enable @typescript-eslint/no-require-imports */

const root = path.join(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const candidate = read('firestore.p5.rules');

describe('Comparaison des règles actives avec le candidat', () => {
  it('le candidat comparé à lui-même (même avec des fins de ligne Windows) est IDENTIQUE', () => {
    expect(compare.analyse(candidate, candidate)).toMatchObject({ identical: true, level: { id: 'p5-marqueur' }, addedByCandidate: [], onlyInActive: [] });
    expect(compare.analyse(candidate.replace(/\n/g, '\r\n'), candidate).identical).toBe(true);
  });

  it('niveau détecté : P4 (état supposé du projet de test) ; le candidat ne retire AUCUNE ligne de P4 et en ajoute', () => {
    const result = compare.analyse(read('firestore.p4.rules'), candidate);
    expect(result.level.id).toBe('p4');
    expect(result.identical).toBe(false);
    expect(result.onlyInActive).toEqual([]);
    expect(result.addedByCandidate.length).toBeGreaterThan(300);
    expect(result.addedByCandidate.some((l) => l.includes('deletedAccounts'))).toBe(true);
  });

  it('niveau détecté : V1 avec verrou (firestore.rules) ; P5 sans marqueur = le candidat privé de sa protection', () => {
    expect(compare.analyse(read('firestore.rules'), candidate).level.id).toBe('v1-verrou');
    const withoutMarker = candidate.replace('return !exists(/databases/$(database)/documents/deletedAccounts/$(request.auth.uid));', 'return true;').split('deletedAccounts').join('supprimes');
    expect(compare.analyse(withoutMarker, candidate).level.id).toBe('p5');
  });

  it('règles OUVERTES détectées (accès public, mode test à expiration) ; les règles du dépôt ne le sont pas', () => {
    expect(compare.analyse('rules_version = "2"; service cloud.firestore { match /databases/{d}/documents { match /{document=**} { allow read, write: if true; } } }', candidate).open).toHaveLength(2);
    expect(compare.analyse('allow read, write: if request.time < timestamp.date(2026, 11, 20);', candidate).open).toHaveLength(1);
    for (const file of ['firestore.p4.rules', 'firestore.p5.rules', 'firestore.rules', 'firestore.emergency-writes-off.rules', 'firestore.emergency-all-off.rules']) {
      expect({ file, open: compare.analyse(read(file), candidate).open }).toEqual({ file, open: [] });
    }
  });

  it('des règles actives avec une règle EN PLUS (modification manuelle) : elle apparaît dans « présentes seulement dans les règles actives »', () => {
    const tampered = `${read('firestore.p4.rules')}\n    match /extra/{id} { allow read: if request.auth != null; }\n`;
    const result = compare.analyse(tampered, candidate);
    expect(result.onlyInActive.join(' ')).toContain('match /extra/{id}');
  });

  it('texte non reconnu : niveau « inconnu » (jamais pris pour P4 ou P5 par erreur)', () => {
    expect(compare.analyse('rules_version = "2"; service cloud.firestore { }', candidate).level.id).toBe('inconnu');
  });
});

describe('Analyse structurelle : nouvelle, plus stricte, plus permissive, modifiée, retirée', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { analyseStructure, statements } = require('../../scripts/firebase-rules/structure.js') as {
    analyseStructure: (a: string, c: string) => {
      identical: number;
      added: { path: string; methods: string }[];
      removed: { path: string }[];
      stricter: { path: string; methods: string; addedConditions: string[] }[];
      permissive: { path: string; removedConditions: string[] }[];
      modified: unknown[];
      lockRisks: unknown[];
    };
    statements: (text: string) => { path: string; methods: string; condition: string }[];
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  const rules = (body: string) => `rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n${body}\n  }\n}`;

  it('P4 → candidat : 17 instructions deviennent 43 ; 11 identiques, 6 plus strictes (accountLive), 26 nouvelles ; AUCUNE plus permissive, modifiée ni retirée', () => {
    expect(statements(read('firestore.p4.rules'))).toHaveLength(17);
    expect(statements(candidate)).toHaveLength(43);
    const result = analyseStructure(read('firestore.p4.rules'), candidate);
    expect({ identical: result.identical, stricter: result.stricter.length, added: result.added.length, permissive: result.permissive.length, modified: result.modified.length, removed: result.removed.length }).toEqual({
      identical: 11, stricter: 6, added: 26, permissive: 0, modified: 0, removed: 0,
    });
    for (const s of result.stricter) expect(s.addedConditions).toEqual(['accountLive()']);
    expect(result.stricter.map((s) => `${s.path} ${s.methods}`)).toEqual([
      '/users/{uid} create', '/spaces/{spaceId} create', '/spaces/{spaceId}/records/{recordId} create', '/spaces/{spaceId}/records/{recordId} update',
      '/spaces/{spaceId}/syncRecords/{recordId} create', '/spaces/{spaceId}/syncRecords/{recordId} update',
    ]);
    const paths = new Set(result.added.map((a) => a.path));
    expect([...paths].sort()).toEqual(['/deletedAccounts/{uid}', '/modules/{moduleId}', '/modules/{moduleId}/members/{uid}', '/modules/{moduleId}/requests/{uid}', '/modules/{moduleId}/syncRecords/{recordId}', '/modules/{moduleId}/tenantViews/{viewUid}/items/{itemId}']);
  });

  it('le candidat comparé à lui-même : tout est identique', () => {
    const result = analyseStructure(candidate, candidate);
    expect(result).toMatchObject({ identical: 43, added: [], removed: [], stricter: [], permissive: [], modified: [] });
  });

  it('une règle active PLUS PERMISSIVE que le candidat est signalée (condition retirée) ; l’inverse est « plus stricte »', () => {
    const permissiveActive = rules("    match /a/{id} { allow read: if signedIn(); }");
    const strictCandidate = rules("    match /a/{id} { allow read: if signedIn() && isOwner(); }");
    const stricter = analyseStructure(permissiveActive, strictCandidate);
    expect(stricter.stricter).toMatchObject([{ path: '/a/{id}', addedConditions: ['isOwner()'] }]);
    expect(stricter.permissive).toEqual([]);
    const looser = analyseStructure(strictCandidate, permissiveActive); // ici le candidat retire une condition
    expect(looser.permissive).toMatchObject([{ path: '/a/{id}', removedConditions: ['isOwner()'] }]);
  });

  it('instruction retirée = risque de verrouillage ; conditions ajoutées ET retirées = « modifiée » ; condition avec « || » comparée comme un bloc', () => {
    const active = rules("    match /a/{id} { allow read: if signedIn(); allow write: if false; }");
    const candidateOnlyRead = rules("    match /a/{id} { allow read: if signedIn(); }");
    const removed = analyseStructure(active, candidateOnlyRead);
    expect(removed.removed).toMatchObject([{ path: '/a/{id}' }]);
    expect(removed.lockRisks.length).toBeGreaterThan(0);
    const modified = analyseStructure(rules("    match /a/{id} { allow read: if signedIn() && x(); }"), rules("    match /a/{id} { allow read: if signedIn() && y(); }"));
    expect(modified.modified).toHaveLength(1);
    const orBlock = analyseStructure(rules("    match /a/{id} { allow read: if p() || q(); }"), rules("    match /a/{id} { allow read: if p() || q() || r(); }"));
    expect(orBlock.modified).toHaveLength(1); // bloc différent : à examiner, jamais classé « plus strict » à tort
  });

  it('les règles d’urgence « écritures refusées » comparées au candidat : les écritures redeviennent permises (le candidat est plus permissif ou modifié sur les écritures), les lectures sont identiques', () => {
    const result = analyseStructure(read('firestore.emergency-writes-off.rules'), candidate);
    expect(result.permissive.length + result.modified.length).toBeGreaterThan(10);
    expect(result.removed).toEqual([]);
    expect(result.identical).toBeGreaterThan(10);
  });
});

describe('Fonctions d’aide et complétude du texte copié', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { analyseFunctions, completeness } = require('../../scripts/firebase-rules/structure.js') as {
    analyseFunctions: (a: string, c: string) => { identical: number; added: { name: string }[]; removed: { name: string }[]; modified: { name: string; listAdded?: string[]; listRemoved?: string[]; before?: string; after?: string }[] };
    completeness: (text: string) => { complete: boolean; problems: string[]; statementCount: number };
  };
  const { spawnSync } = require('child_process') as typeof import('child_process');
  const os = require('os') as typeof import('os');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const wrap = (body: string) => `rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n${body}\n    match /{document=**} {\n      allow read, write: if false;\n    }\n  }\n}\n`;

  it('un changement DANS une fonction d’aide (liste de types admis) est vu même quand les « allow » sont identiques', () => {
    const before = wrap("    match /s/{id} { function kinds() { return ['a', 'b', 'c']; } allow create: if kinds().hasAny(['a']); }");
    const after = wrap("    match /s/{id} { function kinds() { return ['a']; } allow create: if kinds().hasAny(['a']); }");
    expect(compare.analyse(before, after).structure).toMatchObject({ identical: 2, added: [], removed: [], stricter: [], permissive: [], modified: [] }); // les « allow » ne changent pas…
    const fn = analyseFunctions(before, after);
    expect(fn.modified).toEqual([{ name: '/s/{id} :: kinds', listAdded: [], listRemoved: ['b', 'c'] }]); // …mais la fonction, si
    expect(analyseFunctions(after, before).modified[0]).toMatchObject({ listAdded: ['b', 'c'], listRemoved: [] }); // l'inverse élargit la liste
  });

  it('fonction non liste modifiée : avant et après affichés ; fonction nouvelle ou retirée signalée', () => {
    const a = wrap('    function f() { return signedIn(); }\n    function g() { return true; }');
    const b = wrap('    function f() { return signedIn() && ok(); }\n    function h() { return false; }');
    const fn = analyseFunctions(a, b);
    expect(fn.modified).toMatchObject([{ name: '/ :: f', before: 'return signedIn();', after: 'return signedIn() && ok();' }]);
    expect(fn.added).toEqual([{ name: '/ :: h' }]);
    expect(fn.removed).toEqual([{ name: '/ :: g' }]);
  });

  it('P4 actuel → candidat : 16 fonctions identiques, 23 nouvelles (modules, marqueur), AUCUNE modifiée ni retirée', () => {
    const fn = analyseFunctions(read('firestore.p4.rules'), candidate);
    expect({ identical: fn.identical, added: fn.added.length, modified: fn.modified.length, removed: fn.removed.length }).toEqual({ identical: 16, added: 23, modified: 0, removed: 0 });
    expect(fn.added.map((f) => f.name)).toContain('/ :: accountLive');
  });

  it('texte complet reconnu ; texte tronqué (fin manquante, accolades non équilibrées, ligne « ... ») refusé avec la raison', () => {
    expect(completeness(candidate)).toMatchObject({ complete: true, problems: [], statementCount: 43 });
    expect(completeness(candidate.replace(/\n/g, '\r\n')).complete).toBe(true);
    const truncated = completeness(candidate.slice(0, candidate.length - 300));
    expect(truncated.complete).toBe(false);
    expect(truncated.problems.join(' ')).toMatch(/accolades non équilibrées/);
    expect(truncated.problems.join(' ')).toMatch(/refus par défaut final/);
    expect(completeness(candidate.replace('    match /users/{uid} {', '    ...\n    match /users/{uid} {')).problems.join(' ')).toMatch(/partie omise/);
    expect(completeness('allow read: if true;').complete).toBe(false);
  });

  it('la commande refuse un texte incomplet (code 2) AVANT toute comparaison, et accepte une copie complète du candidat (code 0)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'takarda-regles-'));
    try {
      const partial = path.join(dir, 'partiel.rules');
      fs.writeFileSync(partial, candidate.slice(0, 5000));
      const refused = spawnSync('node', ['scripts/firebase-rules/compare.js', partial], { cwd: root, encoding: 'utf8' });
      expect(refused.status).toBe(2);
      expect(refused.stdout).toContain('TEXTE INCOMPLET');
      const full = path.join(dir, 'complet.rules');
      fs.writeFileSync(full, candidate.replace(/\n/g, '\r\n'));
      const same = spawnSync('node', ['scripts/firebase-rules/compare.js', full], { cwd: root, encoding: 'utf8' });
      expect(same.status).toBe(0);
      expect(same.stdout).toContain('IDENTIQUE');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
