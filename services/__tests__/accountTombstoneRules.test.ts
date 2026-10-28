// Garde STATIQUE des règles candidates : le marqueur « compte supprimé » (`deletedAccounts/{uid}`) doit être consulté par TOUTE création et par les modifications de
// données, et JAMAIS par une lecture ni une suppression (la procédure de suppression doit pouvoir aller à son terme). Aucun SDK, aucun réseau. Ne remplace pas le test
// d'émulateur (accountTombstone.emulator.test.ts), qui joue les vraies règles : il empêche seulement qu'une future modification retire la protection sans que rien ne casse.

import fs from 'fs';
import path from 'path';

const rules = fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.p5.rules'), 'utf8').replace(/\r\n/g, '\n');

interface Statement {
  methods: string[];
  condition: string;
}

function statements(text: string): Statement[] {
  const found: Statement[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf('allow ', from);
    if (start < 0) break;
    const end = text.indexOf(';', start);
    const colon = text.indexOf(':', start);
    found.push({ methods: text.slice(start + 6, colon).split(',').map((m) => m.trim()), condition: text.slice(colon + 1, end) });
    from = end + 1;
  }
  return found;
}

const all = statements(rules);
const isMarkerRule = (s: Statement) => s.condition.includes("hasOnly(['deletedAt'])") || s.condition === ' false' || s.condition.trim() === 'signedIn() && request.auth.uid == uid';

describe('Règles candidates : marqueur « compte supprimé » (protection contre un ancien jeton, test A6)', () => {
  it('la fonction accountLive() existe une seule fois et lit `deletedAccounts/<uid du jeton>`', () => {
    expect(rules.split('function accountLive()')).toHaveLength(2);
    expect(rules).toContain('exists(/databases/$(database)/documents/deletedAccounts/$(request.auth.uid))');
  });

  it('TOUTE création de donnée exige un compte vivant (profil, espace, enregistrements, synchronisation, module, demande, membre, vue du locataire)', () => {
    const creations = all.filter((s) => s.methods.includes('create') && !s.condition.includes("hasOnly(['deletedAt'])"));
    expect(creations.length).toBeGreaterThanOrEqual(9);
    for (const s of creations) expect({ condition: s.condition.slice(0, 90), live: s.condition.includes('accountLive()') }).toEqual({ condition: s.condition.slice(0, 90), live: true });
  });

  it('les modifications de données exigent un compte vivant ; le verrou d’effacement et le renommage restent permis (la procédure de suppression va à son terme)', () => {
    const must = [
      "allow update: if isMember(spaceId)\n          && accountLive()", // records
      "allow update: if ownSpace()\n          && accountLive()", // synchronisation de l'espace personnel
      "allow update: if isOwner()\n          && accountLive()\n          && moduleOpen()\n          && validSyncShape()", // données du module
      'allow create, update: if isOwner() && accountLive() && moduleOpen() && validItem()', // vue du locataire
      "(isSelf(uid)\n              && accountLive()\n              && resource.data.state == 'active'\n              && request.resource.data.state == 'left'", // départ d'un locataire
    ];
    for (const snippet of must) expect({ snippet: snippet.slice(0, 60), present: rules.includes(snippet) }).toEqual({ snippet: snippet.slice(0, 60), present: true });
    // verrou d'effacement de l'espace et du module : jamais soumis au marqueur
    const lockOfSpace = all.find((s) => s.methods.includes('update') && s.condition.includes("spaceId == 'personal_' + request.auth.uid") && s.condition.includes("hasOnly(['deletionLockedAt'])"));
    const lockOfModule = all.find((s) => s.methods.includes('update') && s.condition.includes("hasOnly(['deletionLockedAt'])") && s.condition.includes('isOwner()') && s.condition.includes('moduleOpen()'));
    expect(lockOfSpace).toBeDefined();
    expect(lockOfModule).toBeDefined();
    expect(lockOfSpace?.condition.includes('accountLive()')).toBe(false);
    expect(lockOfModule?.condition.includes('accountLive()')).toBe(false);
  });

  it('aucune lecture ni suppression ne dépend du marqueur : un compte en cours de suppression garde tout ce qu’il faut pour terminer', () => {
    for (const s of all.filter((x) => x.methods.some((m) => ['delete', 'get', 'list', 'read'].includes(m)) && !isMarkerRule(x))) {
      expect({ methods: s.methods, condition: s.condition.slice(0, 80), live: s.condition.includes('accountLive()') }).toEqual({ methods: s.methods, condition: s.condition.slice(0, 80), live: false });
    }
  });

  it('le marqueur est créé par son titulaire seul, avec l’heure du serveur ; jamais modifié ni supprimé ; lisible par lui seul ; aucune liste', () => {
    const block = rules.slice(rules.indexOf('match /deletedAccounts/{uid}'), rules.indexOf('// <<< P5 TOMBSTONE END'));
    expect(block).toContain('allow get: if signedIn() && request.auth.uid == uid;');
    expect(block).toContain('allow list: if false;');
    expect(block).toContain("request.resource.data.keys().hasOnly(['deletedAt'])");
    expect(block).toContain('request.resource.data.deletedAt == request.time');
    expect(block).toContain('allow update, delete: if false;');
  });

  it('l’application pose le marqueur AVANT toute suppression et ne le supprime jamais', () => {
    const composition = fs.readFileSync(path.join(__dirname, '..', 'firebase', 'accountCloudErasure.ts'), 'utf8');
    const marker = composition.indexOf('deps.tombstone.mark()');
    expect(marker).toBeGreaterThan(-1);
    expect(marker).toBeLessThan(composition.indexOf('eraseOwnedModules({'));
    expect(marker).toBeLessThan(composition.indexOf('eraseAccountCloudData({'));
    const adapter = fs.readFileSync(path.join(__dirname, '..', 'firebase', 'firestoreAccountTombstone.ts'), 'utf8');
    expect(adapter).not.toMatch(/deleteDoc|updateDoc|writeBatch/);
  });
});
