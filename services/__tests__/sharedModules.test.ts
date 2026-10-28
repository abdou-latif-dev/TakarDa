// F3a — modules partagés : modèle, politique d'accès de référence jouée sur la matrice de cas, et contrôles STATIQUES du candidat de règles
// (firestore.p5.rules). Aucun SDK, aucun réseau, aucun émulateur. Ce que ces tests PROUVENT : la cohérence de la politique et du modèle, et la forme
// du fichier de règles. Ce qu'ils NE PROUVENT PAS : le comportement des règles elles-mêmes (la même matrice est rejouée contre elles dans
// modulesRules.emulator.test.ts, non lancé tant que l'émulateur n'est pas autorisé).

import fs from 'fs';
import path from 'path';
import { CLOUD_DOC_FIELDS, cloudFinancialKinds, cloudKinds, syncCollectionPath } from '../firebase/syncDocModel';
import { decide, type Operation } from '../sharedModules/accessPolicy';
import {
  ACCESS_AFTER_CONTRACT_DAYS,
  MEMBER_DOC_FIELDS,
  MEMBER_ROLES,
  MEMBER_STATES,
  MODULE_DOC_FIELDS,
  MODULE_ID_PATTERN,
  MODULE_ID_RULE_PATTERN,
  MODULE_TYPES,
  REQUEST_DOC_FIELDS,
  REQUEST_STATES,
  TENANT_BODY_FIELDS,
  TENANT_ITEM_FIELDS,
  TENANT_ITEM_KINDS,
  accessUntilForContractEnd,
  canTransitionMember,
  canTransitionRequest,
  generateModuleId,
  isModuleId,
  isTenantAccessActive,
  validateMemberDoc,
  validateModuleDoc,
  validateRequestDoc,
} from '../sharedModules/model';
import { ACTORS, MATRIX, NOW, baseWorld } from './helpers/modulesMatrix';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined, clear: async () => undefined, getAllKeys: async () => [] },
}));

const root = path.join(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

// ============================================================================================================================
describe('Modèle des modules partagés', () => {
  it('identifiant : préfixe + 24 caractères non devinables, au format des règles ; deux tirages diffèrent ; la source d’aléa est injectable', () => {
    const a = generateModuleId();
    const b = generateModuleId();
    expect(a).toMatch(MODULE_ID_PATTERN);
    expect(a).not.toBe(b);
    expect(generateModuleId(() => new Uint8Array(24))).toBe(`mod_${'a'.repeat(24)}`);
    expect(generateModuleId(() => Uint8Array.from({ length: 24 }, (_, i) => i))).toMatch(MODULE_ID_PATTERN);
    expect(new RegExp(`^${MODULE_ID_RULE_PATTERN}$`).test(a)).toBe(true);
    for (const bad of ['', 'mod_', 'mod_court', `mod_${'A'.repeat(24)}`, `mod_${'a'.repeat(25)}`, `xxx_${'a'.repeat(24)}`, 12, null]) expect(isModuleId(bad)).toBe(false);
    // 200 tirages : aucun doublon (l'identifiant est une adresse ; ceci ne prétend pas mesurer l'entropie)
    expect(new Set(Array.from({ length: 200 }, () => generateModuleId())).size).toBe(200);
  });

  it('validation : modules, membres et demandes valides ; champs inconnus, manquants ou invalides refusés', () => {
    const world = baseWorld();
    expect(validateModuleDoc(world.modules['mod_aaaaaaaaaaaaaaaaaaaaaaaa'])).toEqual([]);
    expect(validateModuleDoc({ ...world.modules['mod_aaaaaaaaaaaaaaaaaaaaaaaa'], adminUids: [] })).toEqual(['champ inconnu : adminUids']);
    expect(validateModuleDoc({ ownerUid: 'x' }).length).toBeGreaterThan(0);
    expect(validateModuleDoc({ ...world.modules['mod_aaaaaaaaaaaaaaaaaaaaaaaa'], type: 'tontine' })).toContain('type de module inconnu');
    expect(validateModuleDoc({ ...world.modules['mod_aaaaaaaaaaaaaaaaaaaaaaaa'], name: 'x'.repeat(101) })).toContain('nom invalide');
    const member = world.members['mod_aaaaaaaaaaaaaaaaaaaaaaaa/t1'];
    expect(validateMemberDoc(member)).toEqual([]);
    expect(validateMemberDoc({ ...member, role: 'admin' })).toContain('rôle inconnu');
    expect(validateMemberDoc({ ...member, state: 'banni' })).toContain('état inconnu');
    expect(validateMemberDoc({ ...member, canWrite: true })).toContain('champ inconnu : canWrite');
    expect(validateMemberDoc({ ...member, contractId: '' })).toContain('contrat invalide');
    const request = world.requests['mod_aaaaaaaaaaaaaaaaaaaaaaaa/pend'];
    expect(validateRequestDoc(request)).toEqual([]);
    expect(validateRequestDoc({ ...request, state: 'ok' })).toContain('état inconnu');
    expect(validateRequestDoc({ ...request, label: 'x'.repeat(61) })).toContain('nom invalide');
    expect(validateRequestDoc({ ...request, email: 'a@x.test' })).toContain('champ inconnu : email');
  });

  it('V1 : un seul rôle de membre (locataire) ; l’administrateur est le propriétaire, jamais un membre', () => {
    expect([...MEMBER_ROLES]).toEqual(['locataire']);
    expect([...MODULE_TYPES]).toEqual(['immobilier']);
    expect([...MEMBER_STATES].sort()).toEqual(['active', 'left', 'revoked']);
    expect([...REQUEST_STATES].sort()).toEqual(['approved', 'pending', 'refused']);
  });

  it('transitions : le propriétaire révoque et rétablit ; le membre ne peut que partir ; une demande tranchée ne change plus', () => {
    expect(canTransitionMember('active', 'revoked', 'owner')).toBe(true);
    expect(canTransitionMember('revoked', 'active', 'owner')).toBe(true);
    expect(canTransitionMember('left', 'active', 'owner')).toBe(true);
    expect(canTransitionMember('active', 'left', 'member')).toBe(true);
    for (const [from, to] of [['active', 'active'], ['revoked', 'left'], ['left', 'revoked'], ['revoked', 'revoked'], ['active', 'left']] as const) expect(canTransitionMember(from, to, 'owner')).toBe(false);
    for (const [from, to] of [['active', 'revoked'], ['revoked', 'active'], ['left', 'active'], ['revoked', 'left']] as const) expect(canTransitionMember(from, to, 'member')).toBe(false);
    expect(canTransitionRequest('pending', 'approved')).toBe(true);
    expect(canTransitionRequest('pending', 'refused')).toBe(true);
    for (const [from, to] of [['approved', 'refused'], ['refused', 'approved'], ['approved', 'pending'], ['pending', 'pending']] as const) expect(canTransitionRequest(from, to)).toBe(false);
  });

  it('fin d’accès : fin de la journée de fin de contrat + 90 jours ; la lecture s’arrête exactement à cet instant', () => {
    expect(ACCESS_AFTER_CONTRACT_DAYS).toBe(90);
    expect(accessUntilForContractEnd('2026-01-10')).toBe('2026-04-11T00:00:00.000Z'); // 10 jan, fin de journée = 11 jan 00:00, + 90 j
    expect(accessUntilForContractEnd('2026-12-31')).toBe('2027-04-01T00:00:00.000Z');
    for (const bad of ['', '2026-1-1', 'demain', '2026-13-45']) expect(accessUntilForContractEnd(bad)).toBeNull();
    const until = '2026-04-11T00:00:00.000Z';
    const member = { role: 'locataire', state: 'active', accessUntil: until } as const;
    expect(isTenantAccessActive(member, new Date('2026-04-10T23:59:59.999Z'))).toBe(true);
    expect(isTenantAccessActive(member, new Date(until))).toBe(false);
    expect(isTenantAccessActive(member, new Date('2026-04-12T00:00:00.000Z'))).toBe(false);
    expect(isTenantAccessActive({ ...member, accessUntil: null }, new Date('2099-01-01T00:00:00.000Z'))).toBe(true);
    expect(isTenantAccessActive({ ...member, state: 'revoked' }, NOW)).toBe(false);
    expect(isTenantAccessActive({ ...member, state: 'left' }, NOW)).toBe(false);
    expect(isTenantAccessActive({ ...member, accessUntil: 'illisible' }, NOW)).toBe(false); // date illisible : refusé
    expect(isTenantAccessActive(null, NOW)).toBe(false);
  });
});

// ============================================================================================================================
describe('Politique d’accès de référence : la matrice de cas (section 3 des décisions)', () => {
  it.each(MATRIX.map((m) => [m.name, m] as const))('%s', (_name, c) => {
    const decision = decide(c.op, ACTORS[c.actor], baseWorld());
    expect({ allow: decision.allow, reason: decision.reason }).toEqual({ allow: c.expect === 'allow', reason: decision.reason });
  });

  it('chaque type d’opération est couvert par au moins un refus ; chaque opération qui peut réussir l’est aussi par un cas autorisé', () => {
    const types = new Set(MATRIX.map((m) => m.op.type));
    const everyType: Operation['type'][] = [
      'getModule', 'listModules', 'listOwnModules', 'createModule', 'updateModule', 'deleteModule', 'getMember', 'listMembers', 'createMember', 'updateMember', 'deleteMember',
      'getRequest', 'listRequests', 'createRequest', 'updateRequest', 'deleteRequest', 'getRecord', 'listRecords', 'writeRecord', 'deleteRecord',
      'getTenantItem', 'listTenantItems', 'writeTenantItem', 'deleteTenantItem',
    ];
    expect([...types].sort()).toEqual([...everyType].sort());
    const neverAllowed = new Set(['listModules']); // la liste GÉNÉRALE ; la suppression n'est permise que sous verrou (cas dédiés)
    for (const type of everyType) {
      expect({ type, deny: MATRIX.some((m) => m.op.type === type && m.expect === 'deny') }).toEqual({ type, deny: true });
      if (!neverAllowed.has(type)) expect({ type, allow: MATRIX.some((m) => m.op.type === type && m.expect === 'allow') }).toEqual({ type, allow: true });
    }
  });

  it('chaque protection de la section 3 est portée par au moins un cas', () => {
    const protections = [
      'accès réservé aux membres actifs', 'étanchéité entre modules', 'un locataire ne voit aucun autre locataire', 'un locataire n’écrit rien',
      'propriétaire immuable', 'un administrateur ne supprime pas le module', 'faits financiers en création seule', 'jamais d’auto-approbation',
      'accès expiré refusé', 'accès révoqué refusé', 'accès en attente ou refusé : lecture refusée', 'aucun accès sans connexion par mot de passe',
      'un utilisateur ne crée que sa demande', 'un utilisateur ne lit que sa demande', 'périmètre Immobilier seul', 'aucun champ privé dans la vue',
      'compte supprimé : aucune création ni modification', 'compte supprimé : la suppression va à son terme',
    ];
    for (const protection of protections) expect({ protection, cases: MATRIX.filter((m) => m.protects === protection).length > 0 }).toEqual({ protection, cases: true });
  });

  it('personne ne passe sans connexion par mot de passe : le même cas, rejoué sans connexion ou avec un autre fournisseur, est toujours refusé', () => {
    for (const c of MATRIX) {
      expect({ name: c.name, anon: decide(c.op, null, baseWorld()).allow }).toEqual({ name: c.name, anon: false });
      const google = ACTORS[c.actor] ? { ...ACTORS[c.actor]!, provider: 'google.com' } : null;
      expect({ name: c.name, google: decide(c.op, google, baseWorld()).allow }).toEqual({ name: c.name, google: false });
    }
  });

  it('un accès qui expire en cours de route est refusé dès l’instant de fin, sans autre action', () => {
    const world = baseWorld();
    const op: Operation = { type: 'listTenantItems', moduleId: 'mod_aaaaaaaaaaaaaaaaaaaaaaaa', uid: 'tFuture' };
    expect(decide(op, ACTORS.tFuture, world).allow).toBe(true);
    expect(decide(op, ACTORS.tFuture, { ...world, now: new Date('2026-12-31T00:00:00.000Z') }).allow).toBe(false);
  });

  it('la révocation est immédiate : le même locataire est accepté, puis refusé dès que sa fiche passe à « révoqué »', () => {
    const world = baseWorld();
    const key = 'mod_aaaaaaaaaaaaaaaaaaaaaaaa/t1';
    const op: Operation = { type: 'getTenantItem', moduleId: 'mod_aaaaaaaaaaaaaaaaaaaaaaaa', uid: 't1', id: 'item1' };
    expect(decide(op, ACTORS.t1, world).allow).toBe(true);
    world.members[key] = { ...world.members[key], state: 'revoked' };
    expect(decide(op, ACTORS.t1, world).allow).toBe(false);
  });

  it('un propriétaire n’est jamais bloqué par un état de membre, et un locataire n’obtient jamais un droit du propriétaire en changeant d’état', () => {
    const world = baseWorld();
    const ownerOps: Operation[] = [{ type: 'listRecords', moduleId: 'mod_aaaaaaaaaaaaaaaaaaaaaaaa' }, { type: 'listMembers', moduleId: 'mod_aaaaaaaaaaaaaaaaaaaaaaaa' }];
    for (const op of ownerOps) expect(decide(op, ACTORS.owner1, world).allow).toBe(true);
    for (const state of MEMBER_STATES) {
      const w = baseWorld();
      w.members['mod_aaaaaaaaaaaaaaaaaaaaaaaa/t1'] = { ...w.members['mod_aaaaaaaaaaaaaaaaaaaaaaaa/t1'], state };
      for (const op of ownerOps) expect({ state, op: op.type, allow: decide(op, ACTORS.t1, w).allow }).toEqual({ state, op: op.type, allow: false });
    }
  });
});

// ============================================================================================================================
describe('Candidat de règles P5 — contrôles statiques (le comportement réel reste à prouver dans l’émulateur ou le projet de test)', () => {
  const p4 = read('firestore.p4.rules');
  const p5 = read('firestore.p5.rules');
  const BEGIN = '    // >>> P5 MODULES BEGIN';
  const END = '    // <<< P5 MODULES END\n\n';
  const start = p5.indexOf(BEGIN);
  const stop = p5.indexOf(END) + END.length;
  const block = p5.slice(start, stop);
  const codeOnly = (text: string) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // Le marqueur « compte supprimé » (accountLive(), accountTombstone.ts) s'ajoute aux règles de création et de modification : on le retire pour comparer le reste à l'original.
  const withoutLive = (text: string) => text.split('\n').filter((l) => l.trim() !== '&& accountLive()').join('\n').split(' accountLive() &&').join('');
  const without = (text: string, begin: string, end: string) => {
    const a = text.indexOf(begin);
    return a < 0 ? text : text.slice(0, a) + text.slice(text.indexOf(end, a) + end.length);
  };
  const listAfter = (source: string, fn: string): string[] => {
    const m = new RegExp(`function ${fn}\\(\\) \\{\\s*return \\[([^\\]]*)\\];`).exec(source);
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  };
  const keyLists = (source: string, kind: 'hasOnly' | 'hasAll'): string[][] => [...source.matchAll(new RegExp(`keys\\(\\)\\.${kind}\\(\\[([^\\]]*)\\]\\)`, 'g'))].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort());

  it('le candidat est EXACTEMENT les règles P4 + un bloc délimité (aucune règle existante n’est modifiée), placé avant le refus par défaut', () => {
    expect(start).toBeGreaterThan(0);
    expect(stop).toBeGreaterThan(start);
    expect(p5.split('P5 MODULES BEGIN').length).toBe(2);
    // P5 = P4 + (fonction accountLive + « && accountLive() » ajouté aux créations et modifications de données) + bloc des modules + bloc du marqueur : rien d'autre ne change
    const withoutModules = p5.slice(0, start) + p5.slice(stop);
    const withoutMarker = without(without(withoutModules, '    // >>> P5 TOMBSTONE BEGIN', '    // <<< P5 TOMBSTONE END\n\n'), '    // Compte « vivant »', '    }\n\n');
    expect(withoutLive(withoutMarker)).toBe(p4);
    expect(p5.split('P5 TOMBSTONE BEGIN').length).toBe(2);
    // le bloc du marqueur « compte supprimé » suit celui des modules, toujours avant le refus par défaut
    expect(p5.indexOf('// >>> P5 TOMBSTONE BEGIN')).toBeGreaterThan(stop - 1);
    expect(p5.slice(p5.indexOf('// <<< P5 TOMBSTONE END') + '// <<< P5 TOMBSTONE END'.length)).toMatch(/^\s*\/\/ ---- Tout le reste est interdit[\s\S]*match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
    expect(p5.slice(0, start).lastIndexOf('match /spaces/{spaceId} {')).toBeGreaterThan(p5.slice(0, start).lastIndexOf('match /users/{uid} {'));
  });

  it('le bloc est un voisin de « spaces » (modules/{moduleId}), pas imbriqué dans un espace', () => {
    expect(block).toMatch(/^ {4}\/\/ >>> P5 MODULES BEGIN[\s\S]*\n {4}match \/modules\/\{moduleId\} \{/);
    expect(block.match(/\n {4}match \//g)).toHaveLength(1);
  });

  it('aucune règle publique, ouverte à tout compte connecté ou en écriture générique ; chaque « allow » exige un rôle précis ou refuse', () => {
    const code = codeOnly(block);
    expect(code).not.toMatch(/if\s+true\s*;/);
    expect(code).not.toMatch(/allow\s+(read|write)\b/);
    const allows = [...code.matchAll(/allow ([a-z, ]+): if ([^;]+);/g)].map((m) => ({ ops: m[1].trim(), cond: m[2].replace(/\s+/g, ' ').trim() }));
    expect(allows.length).toBeGreaterThanOrEqual(19);
    for (const { ops, cond } of allows) {
      const restricted = cond === 'false' || /\bisOwner\(\)|\bisSelf\(|\bactiveTenant\(|^signedIn\(\)/.test(cond);
      expect({ ops, cond: cond.slice(0, 80), restricted }).toEqual({ ops, cond: cond.slice(0, 80), restricted: true });
    }
    // aucune règle ne repose sur un champ choisi par l'appelant pour s'ouvrir un droit
    expect(code).not.toMatch(/request\.resource\.data\.(role|ownerUid) in /);
  });

  it('la seule liste de modules est celle de SES propres modules ; la suppression physique n’existe que sous verrou, par le propriétaire', () => {
    const code = codeOnly(block);
    const lists = [...code.matchAll(/allow list: if ([^;]+);/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
    // module : ses propres modules seulement ; membres et demandes : le propriétaire ; données : le propriétaire (get, list) ; vue : propriétaire ou locataire actif
    expect(lists).toEqual(['signedIn() && resource.data.ownerUid == request.auth.uid', 'isOwner()', 'isOwner()']);
    const deletes = [...code.matchAll(/allow delete: if ([^;]+);/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
    // module, membres, données : propriétaire ET module verrouillé ; demandes : le propriétaire, ou son auteur tant qu'elle est en attente ; vue : le propriétaire
    expect(deletes).toEqual(['isOwner() && moduleLocked()', 'isOwner() && moduleLocked()', 'isOwner() || (isSelf(uid) && resource.data.state in [\'pending\', \'approved\'])', 'isOwner() && moduleLocked()', 'isOwner()']);
    // aucune suppression « libre » : aucune règle de suppression ne vaut `true` ni ne repose sur un champ choisi par l'appelant
    expect(deletes.filter((d) => /true|request\.resource/.test(d))).toEqual([]);
  });

  it('le verrou d’effacement : posé seul par le propriétaire, irréversible, et il ferme toute écriture et toute lecture de locataire', () => {
    const code = withoutLive(codeOnly(block));
    expect(code).toMatch(/function moduleLocked\(\) \{\s*return exists\(modulePath\(\)\) && get\(modulePath\(\)\)\.data\.get\('deletionLockedAt', null\) != null;/);
    expect(code).toMatch(/function moduleOpen\(\) \{\s*return exists\(modulePath\(\)\) && get\(modulePath\(\)\)\.data\.get\('deletionLockedAt', null\) == null;/);
    // le verrou se pose (champ seul) et ne se modifie ni ne se retire : toute modification exige un module OUVERT
    expect(code).toMatch(/allow update: if isOwner\(\)\s*&& moduleOpen\(\)\s*&& \(/);
    expect(code).toContain("affectedKeys().hasOnly(['deletionLockedAt'])");
    // chaque écriture (création, modification) de membres, demandes, données et vue exige un module ouvert ; le locataire actif aussi
    for (const fragment of [
      'allow create: if isOwner()\n          && moduleOpen()\n          && uid != request.auth.uid',
      'allow update: if moduleOpen()\n          && changed().size() > 0',
      'allow create: if isSelf(uid)\n          && moduleOpen()',
      'allow update: if isOwner()\n          && moduleOpen()\n          && uid != request.auth.uid',
      'allow create: if isOwner()\n          && moduleOpen()\n          && validSyncShape()',
      'allow update: if isOwner()\n          && moduleOpen()\n          && validSyncShape()',
      'allow create, update: if isOwner() && moduleOpen() && validItem();',
      'return isSelf(uid)\n          && moduleOpen()',
    ]) expect({ fragment, present: code.includes(fragment) }).toEqual({ fragment, present: true });
  });

  it('les champs exigés sont exactement ceux du modèle (module, membre, demande, vue)', () => {
    const only = keyLists(block, 'hasOnly');
    const all = keyLists(block, 'hasAll');
    const sorted = (list: readonly string[]) => [...list].sort();
    expect(only).toContainEqual(sorted(MODULE_DOC_FIELDS));
    expect(all).toContainEqual(sorted(MODULE_DOC_FIELDS));
    expect(listAfter(block, 'memberKeys').sort()).toEqual(sorted(MEMBER_DOC_FIELDS));
    expect(listAfter(block, 'requestKeys').sort()).toEqual(sorted(REQUEST_DOC_FIELDS));
    expect(only).toContainEqual(sorted(TENANT_ITEM_FIELDS));
    expect(all).toContainEqual(sorted(TENANT_ITEM_FIELDS));
    // documents de synchronisation du module : mêmes champs que le modèle des documents de synchronisation V1
    expect(only).toContainEqual(sorted(CLOUD_DOC_FIELDS));
    expect(all).toContainEqual(sorted(CLOUD_DOC_FIELDS));
  });

  it('types admis, états, rôle et motif d’identifiant : exactement ceux du modèle et du registre', () => {
    expect(listAfter(block, 'syncKinds').sort()).toEqual([...cloudKinds()].sort());
    expect(listAfter(block, 'financialKinds').sort()).toEqual([...cloudFinancialKinds()].sort());
    const item = /request\.resource\.data\.kind in \[([^\]]*)\]/.exec(block.slice(block.indexOf('function validItem')));
    expect([...(item?.[1].matchAll(/'([^']+)'/g) ?? [])].map((x) => x[1]).sort()).toEqual([...TENANT_ITEM_KINDS].sort());
    // champs autorisés par type de vue : exactement ceux du modèle (aucun champ privé ne peut être ajouté sans changer le modèle ET les règles)
    const bodyFn = block.slice(block.indexOf('function allowedBody'), block.indexOf('function validItem'));
    const listFor = (kind: string): string[] => {
      const m = new RegExp(`kind == '${kind}' \\? \\[([^\\]]*)\\]`).exec(bodyFn);
      return [...(m?.[1].matchAll(/'([^']+)'/g) ?? [])].map((x) => x[1]).sort();
    };
    for (const kind of TENANT_ITEM_KINDS.filter((k) => k !== 'evenement')) expect({ kind, fields: listFor(kind) }).toEqual({ kind, fields: [...TENANT_BODY_FIELDS[kind]].sort() });
    const last = /: (\['[^\]]*\]);\s*\}\s*$/m.exec(bodyFn.trimEnd());
    expect([...(last?.[1].matchAll(/'([^']+)'/g) ?? [])].map((x) => x[1]).sort()).toEqual([...TENANT_BODY_FIELDS.evenement].sort());
    expect(block).toContain('request.resource.data.body.keys().hasOnly(allowedBody(request.resource.data.kind))');
    expect(block).toContain(`moduleId.matches('${MODULE_ID_RULE_PATTERN}')`);
    expect(block).toContain(`request.resource.data.type in [${MODULE_TYPES.map((t) => `'${t}'`).join(', ')}]`);
    expect(block).toContain(`role == '${MEMBER_ROLES[0]}'`);
    for (const state of [...MEMBER_STATES, ...REQUEST_STATES]) expect({ state, present: block.includes(`'${state}'`) }).toEqual({ state, present: true });
  });

  it('les protections clés sont écrites dans les règles : approbation liée à la demande, pas d’auto-approbation, expiration, révocation, création seule des faits financiers', () => {
    const code = withoutLive(codeOnly(block));
    expect(code).toContain("getAfter(requestPath(uid)).data.state == 'approved'");
    expect(code).toContain('getAfter(requestPath(uid)).data.decidedBy == request.auth.uid');
    expect(code).toMatch(/allow update: if isOwner\(\)\s*&& moduleOpen\(\)\s*&& uid != request\.auth\.uid\s*&& resource\.data\.state == 'pending'/); // seul le propriétaire tranche, jamais sa propre demande
    expect(code).toMatch(/request\.resource\.data\.state == 'pending'\s*&& request\.resource\.data\.decidedBy == null/);
    expect(code).toContain('request.time < get(memberPath(uid)).data.accessUntil');
    expect(code).toContain("get(memberPath(uid)).data.state == 'active'");
    expect(code).toContain('!(resource.data.kind in financialKinds())');
    expect(code).toContain('&& !exists(memberPath(uid))'); // un membre (ou ancien membre) ne redemande pas
    expect(code).toMatch(/allow create: if isSelf\(uid\)\s*&& moduleOpen\(\)\s*&& !isOwner\(\)/);
    expect(code).toMatch(/allow get, list: if isOwner\(\) \|\| activeTenant\(viewUid\);\s*\n\s*allow create, update: if isOwner\(\) && moduleOpen\(\) && validItem\(\);/);
    // le locataire n'a aucune règle d'écriture sur la vue, ni sur les données
    const tenantAllows = [...code.matchAll(/allow ([a-z, ]+): if ([^;]+);/g)].filter((m) => m[2].includes('activeTenant(')).map((m) => m[1].trim());
    expect(tenantAllows).toEqual(['get', 'get, list']);
  });

  it('la procédure d’émulateur existe et rejoue LA MÊME matrice que la politique de référence', () => {
    const emulator = read('services/__tests__/modulesRules.emulator.test.ts');
    expect(emulator).toContain("from './helpers/modulesMatrix'");
    expect(emulator).toContain('MATRIX');
    expect(emulator).toContain('firestore.p5.rules');
    expect(emulator).toContain('FIRESTORE_EMULATOR_HOST');
    expect(read('firebase.modules.json')).toContain('firestore.p5.rules');
    expect(read('jest.emulator.modules.config.js')).toContain('modulesRules.emulator.test.ts');
  });
});

// ============================================================================================================================
describe('Transport : chemin par espace, rien n’est branché', () => {
  it('l’espace personnel garde son chemin d’origine ; un module a le sien ; un compte ou un module mal formé est refusé', () => {
    expect(syncCollectionPath({ kind: 'personal', uid: 'alice' })).toEqual(['spaces', 'personal_alice', 'syncRecords']);
    expect(syncCollectionPath({ kind: 'module', moduleId: 'mod_aaaaaaaaaaaaaaaaaaaaaaaa' })).toEqual(['modules', 'mod_aaaaaaaaaaaaaaaaaaaaaaaa', 'syncRecords']);
    expect(() => syncCollectionPath({ kind: 'personal', uid: '' })).toThrow(/Aucun compte/);
    for (const moduleId of ['', 'personal_alice', 'mod_court', '../spaces/personal_alice', 'mod_aaaaaaaaaaaaaaaaaaaaaaaa/x']) expect(() => syncCollectionPath({ kind: 'module', moduleId })).toThrow(/module invalide/);
  });

  it('le transport Firestore reste par défaut sur l’espace personnel ; la composition de l’application ne choisit jamais un module', () => {
    const backend = read('services/firebase/firestoreSyncBackend.ts');
    expect(backend).toContain("space: SyncSpace = { kind: 'personal', uid }");
    expect(read('services/firebase/syncRuntimeBoot.ts')).not.toMatch(/kind: 'module'|sharedModules|moduleId/);
  });

  it('seuls les chemins prévus importent les modules partagés (transport, façade, adaptateurs Firestore, deux écrans) ; rien n’est branché à l’application', () => {
    const walk = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '__tests__'].includes(e.name) ? [] : walk(`${dir}/${e.name}`)) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
    const files = ['services', 'store', 'features', 'components', 'app'].flatMap(walk).filter((f) => !f.startsWith('services/sharedModules/'));
    const importers = files.filter((f) => /sharedModules\//.test(read(f)));
    // le chemin de transport (F3a) ; puis, F3b et F3c : la façade, les adaptateurs Firestore des modules, la projection de la vue et les trois écrans — tous inertes tant que le drapeau est fermé
    expect(importers).toEqual([
      'services/firebase/firestoreModulesBackend.ts',
      'services/firebase/modulesBoot.ts',
      'services/firebase/sharedSpacesDeparture.ts',
      'services/firebase/syncDocModel.ts',
      'services/privacyNotice.ts',
      'services/sharedModulesService.ts',
      'services/tenantViewBuilder.ts',
      'features/profile/screens/SharedModuleOwnerScreen.tsx',
      'features/profile/screens/SharedModulesScreen.tsx',
      'features/profile/screens/TenantSpaceScreen.tsx',
    ]);
  });
});
