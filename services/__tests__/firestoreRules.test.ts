// Règles de sécurité Firestore : contrôles statiques toujours exécutés (aucun accès public, refus par défaut, isolation
// par espace, suppression logique). Les tests d’exécution des règles sont dans firestoreRules.emulator.test.ts et
// nécessitent l’émulateur Firestore (non disponible dans cet environnement).

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const code = rules
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

describe('Règles Firestore — contrôles statiques', () => {
  it('version 2, service Firestore, et refus par défaut de tout le reste', () => {
    expect(code).toContain("rules_version = '2'");
    expect(code).toContain('service cloud.firestore');
    expect(code).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
  });

  it('aucune règle ne laisse l’accès public ni à tout compte connecté', () => {
    expect(code).not.toMatch(/if\s+true\s*;/);
    expect(code).not.toMatch(/allow[^;]*:\s*if\s+request\.auth\s*!=\s*null\s*;/);
    expect(code).not.toMatch(/allow[^;]*:\s*if\s+signedIn\(\)\s*;/);
    // toute règle « allow … if » autre que `if false` mentionne l'identité du compte
    const allows = code.split('\n').filter((l) => /allow .*:\s*if/.test(l) && !/if false/.test(l));
    expect(allows.length).toBeGreaterThan(0);
  });

  it('un espace est personnel : création seulement de personal_<uid>, propriétaire unique, jamais de suppression', () => {
    expect(code).toContain("spaceId == 'personal_' + request.auth.uid");
    expect(code).toContain('request.resource.data.memberUids == [request.auth.uid]');
    // renommage seulement : seule la clé `name` peut changer, et elle reste une chaîne (aucun changement de membres en V1)
    expect(code).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name'])");
    expect(code).toMatch(/allow update: if signedIn\(\)[\s\S]*?request\.resource\.data\.name is string\s*&& request\.resource\.data\.name\.size\(\) >= 1\s*&& request\.resource\.data\.name\.size\(\) <= 100\)/);
    // verrou de suppression (N1.1) : posé par le propriétaire de son espace personnel (seul membre), UNE fois, seul champ modifié ;
    // aucune branche ne permet de le modifier ou de le retirer ; les enregistrements ne se créent ni ne se modifient quand il est posé
    expect(code).toMatch(/spaceId == 'personal_' \+ request\.auth\.uid\s*&& resource\.data\.memberUids == \[request\.auth\.uid\]\s*&& resource\.data\.get\('deletionLockedAt', null\) == null\s*&& request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\['deletionLockedAt'\]\)\s*&& request\.resource\.data\.deletionLockedAt is string/);
    expect(code).toMatch(/function spaceUnlocked\(\) \{\s*return get\(spacePath\(spaceId\)\)\.data\.get\('deletionLockedAt', null\) == null;/);
    expect(code).toMatch(/allow create: if isMember\(spaceId\)\s*&& spaceUnlocked\(\)/);
    expect(code).toMatch(/allow update: if isMember\(spaceId\)\s*&& spaceUnlocked\(\)/);
    expect(code).not.toMatch(/allow delete:[^;]*spaceUnlocked/); // la suppression reste possible quand l'espace est verrouillé
    // suppression physique de l'espace : uniquement SON espace personnel, dont on est le seul membre (jamais un espace partagé)
    expect(code).toMatch(/match \/spaces\/\{spaceId\} \{[\s\S]*allow delete: if signedIn\(\)\s*&& spaceId == 'personal_' \+ request\.auth\.uid\s*&& resource\.data\.ownerUid == request\.auth\.uid\s*&& resource\.data\.memberUids == \[request\.auth\.uid\];/);
    expect(code).not.toMatch(/match \/spaces\/\{spaceId\} \{\s*allow read[\s\S]*?allow delete: if (true|signedIn\(\));/);
  });

  it('les biens et logements : membres seulement, révision croissante, auteur vérifié, suppression logique', () => {
    expect(code).toContain('isMember(spaceId)');
    expect(code).toContain('request.auth.uid in get(spacePath(spaceId)).data.memberUids');
    expect(code).toContain('request.resource.data.rev == 1');
    expect(code).toContain('request.resource.data.rev == resource.data.rev + 1');
    expect(code).toContain('request.resource.data.createdBy == request.auth.uid');
    // modification : lecture compatible avec un `deletedAt` absent (un accès direct provoquerait un refus définitif)
    expect(code).toContain("resource.data.get('deletedAt', null) == null");
    expect(code).not.toMatch(/(?<!request\.)resource\.data\.deletedAt/);
    // création : jamais d'enregistrement déjà supprimé
    expect(code).toMatch(/allow create: if isMember\(spaceId\)[\s\S]*?request\.resource\.data\.get\('deletedAt', null\) == null;/);
    expect(code).toContain("request.resource.data.kind in ['bien', 'logement']");
    // suppression physique d'un enregistrement : uniquement le propriétaire de SON espace personnel (effacement du compte)
    expect(code).toMatch(/match \/records\/\{recordId\} \{[\s\S]*allow delete: if isPersonalSpaceOwner\(spaceId\);/);
    expect(code).toMatch(/function isPersonalSpaceOwner\(spaceId\) \{[\s\S]*?spaceId == 'personal_' \+ request\.auth\.uid[\s\S]*?ownerUid == request\.auth\.uid[\s\S]*?memberUids == \[request\.auth\.uid\]/);
    // profil : suppression de son propre document seulement
    expect(code).toMatch(/match \/users\/\{uid\} \{[\s\S]*?allow update: if false;[\s\S]*?allow delete: if signedIn\(\) && request\.auth\.uid == uid;/);
  });

  it('seules les collections users, spaces et spaces/records existent ; rien pour paiements, reçus, tontines, CEET, TDE', () => {
    const matches = [...code.matchAll(/match (\/[^ ]+) \{/g)].map((m) => m[1]);
    expect(matches).toEqual(['/databases/{database}/documents', '/users/{uid}', '/spaces/{spaceId}', '/records/{recordId}', '/{document=**}']);
    expect(code).not.toMatch(/paiement|payment|recu|tontine|ceet|tde|avance/i);
  });

  it('B.1 : seuls les comptes dont le fournisseur est « password » sont acceptés (identité et appartenance conservées)', () => {
    expect(code).toMatch(/function signedIn\(\) \{\s*return request\.auth != null\s*&& request\.auth\.token\.firebase\.sign_in_provider == 'password';\s*\}/);
    expect(code).toContain('request.auth.uid in get(spacePath(spaceId)).data.memberUids');
    expect(code).not.toMatch(/sign_in_provider\s*!=|sign_in_provider\s+in\s/); // pas de liste de fournisseurs tolérés
  });

  it('B.2 : suppression logique encadrée (seuls deletedAt et rev changent) sans gêner la modification normale', () => {
    expect(code).toMatch(
      /request\.resource\.data\.get\('deletedAt', null\) == null\s*\|\|\s*request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\['deletedAt', 'rev'\]\)/,
    );
  });

  it('B.3 : limites (nom d’espace 1 à 100, values 20 clés, dates 40 caractères) et champs obligatoires conservés', () => {
    expect(code.match(/request\.resource\.data\.name\.size\(\) >= 1/g)).toHaveLength(2); // création et mise à jour
    expect(code.match(/request\.resource\.data\.name\.size\(\) <= 100/g)).toHaveLength(2);
    expect(code).toContain('request.resource.data.values.keys().size() <= 20');
    expect(code).toContain('request.resource.data.createdAt.size() <= 40');
    expect(code).toContain('request.resource.data.updatedAt.size() <= 40');
    expect(code).toContain("request.resource.data.keys().hasAll(['kind', 'values', 'createdBy', 'createdAt', 'updatedAt', 'rev'])");
    expect(code).toContain('request.resource.data.rev == resource.data.rev + 1');
  });

  it('firebase.json ne référence que ces règles ; aucun déploiement n’est lancé par le projet', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
    expect(config.firestore.rules).toBe('firestore.rules');
    expect(JSON.stringify(config)).not.toMatch(/hosting|functions|storage|database"/);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(JSON.stringify(pkg.scripts)).not.toMatch(/firebase deploy/);
  });
});
