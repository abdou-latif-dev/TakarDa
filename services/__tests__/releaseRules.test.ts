// F4 — préparation de la production, contrôles LOCAUX : règles d'urgence (générées, jamais éditées à la main), manifeste des règles validées (empreintes), vérification
// avant/après publication, et modèle d'estimation de quotas. Aucun accès réseau, rien n'est publié.

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  FREE_PLAN_DAILY,
  READS_PER_WRITE,
  accountsAtCapToExhaust,
  familiesPerFreePlan,
  ownerDailyUsage,
  tenantDailyUsage,
} from '../firebase/quotaModel';
import { DEFAULT_LIMITS } from '../sync/syncCycle';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined, clear: async () => undefined, getAllKeys: async () => [] },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const emergency = require('../../scripts/firebase-rules/emergency.js') as {
  SOURCE: string;
  WRITES_OFF: string;
  ALL_OFF: string;
  writesOff: (source: string) => string;
  allOff: (source: string) => string;
  sha256: (text: string) => string;
};
const release = require('../../scripts/firebase-rules/release.js') as {
  MANIFEST: string;
  currentHashes: () => { candidate: { file: string; sha256: string }; emergency: { writesOff: { file: string; sha256: string }; allOff: { file: string; sha256: string } } };
  verify: (file: string) => { identical: boolean; actual: string; expected: string; matches: string | null };
};
/* eslint-enable @typescript-eslint/no-require-imports */

const root = path.join(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const codeOnly = (text: string) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const allows = (text: string) => [...codeOnly(text).matchAll(/allow ([a-z, ]+): if ([^;]+);/g)].map((m) => ({ ops: m[1].trim(), cond: m[2].replace(/\s+/g, ' ').trim() }));

describe('Règles d’urgence', () => {
  const source = read(emergency.SOURCE);

  it('les fichiers d’urgence sont EXACTEMENT ceux que le générateur produit à partir des règles candidates actuelles (sinon : à régénérer, jamais à éditer)', () => {
    expect(read(emergency.WRITES_OFF)).toBe(emergency.writesOff(source));
    expect(read(emergency.ALL_OFF)).toBe(emergency.allOff(source));
    expect(read(emergency.WRITES_OFF)).toContain(emergency.sha256(source));
  });

  it('variante 1 : AUCUNE règle d’écriture ne subsiste ; chaque lecture est identique à celle des règles candidates', () => {
    const generated = allows(read(emergency.WRITES_OFF));
    const original = allows(source);
    expect(generated).toHaveLength(original.length);
    const isWrite = (ops: string) => /(create|update|delete|write)/.test(ops);
    for (const rule of generated) if (isWrite(rule.ops)) expect({ ops: rule.ops, cond: rule.cond }).toEqual({ ops: rule.ops, cond: 'false' });
    const readsOf = (list: typeof original) => list.filter((r) => !isWrite(r.ops));
    expect(readsOf(generated)).toEqual(readsOf(original)); // les lectures ne changent pas : l'urgence n'ouvre rien et ne ferme que les écritures
    expect(generated.filter((r) => isWrite(r.ops)).length).toBeGreaterThan(20); // le fichier source contient bien beaucoup d'écritures converties
    expect(codeOnly(read(emergency.WRITES_OFF))).not.toMatch(/if\s+true\s*;/);
  });

  it('variante 2 : une seule règle, tout refusé, lecture et écriture', () => {
    const text = codeOnly(read(emergency.ALL_OFF));
    expect(allows(read(emergency.ALL_OFF))).toEqual([{ ops: 'read, write', cond: 'false' }]);
    expect(text.match(/match /g)).toHaveLength(2); // /databases/{database}/documents et /{document=**}
    expect(text).not.toMatch(/function |get\(|exists\(/);
  });

  it('syntaxe : accolades, parenthèses et crochets équilibrés dans les deux fichiers', () => {
    for (const file of [emergency.WRITES_OFF, emergency.ALL_OFF]) {
      const stripped = codeOnly(read(file)).replace(/'[^']*'/g, "''");
      for (const [open, close] of [['{', '}'], ['(', ')'], ['[', ']']]) expect({ file, open: stripped.split(open).length }).toEqual({ file, open: stripped.split(close).length });
    }
  });

  it('le générateur ne touche à rien d’autre que du texte : aucune écriture hors des deux fichiers, aucun réseau', () => {
    const script = read('scripts/firebase-rules/emergency.js');
    expect(script).not.toMatch(/require\('(http|https|net|child_process|dns|firebase[^']*)'\)|fetch\(/);
    expect((script.match(/writeFileSync\(/g) ?? []).length).toBe(2);
    expect(read('scripts/firebase-rules/release.js')).not.toMatch(/require\('(http|https|net|child_process|dns)'\)|fetch\(/);
  });
});

describe('Manifeste des règles validées', () => {
  const manifest = JSON.parse(read(release.MANIFEST));

  it('les empreintes du manifeste sont celles des fichiers ACTUELS : toute modification des règles exige une nouvelle validation puis une mise à jour volontaire du manifeste', () => {
    const now = release.currentHashes();
    expect(manifest.candidate).toEqual(now.candidate);
    expect(manifest.emergency).toEqual(now.emergency);
    expect(manifest.candidate.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('le manifeste dit honnêtement ce qui a été validé et ce qui ne l’a pas été', () => {
    expect(manifest.validation.emulatorLocal.environment).toMatch(/Émulateur Firestore local/);
    expect(manifest.validation.projetDeTest).toMatch(/^non fait/);
    expect(manifest.validation.production).toBe('non publié');
  });

  it('la configuration de publication désigne le candidat validé et AUCUN projet (le projet est toujours passé explicitement)', () => {
    expect(JSON.parse(read('firebase.release.json'))).toEqual({ firestore: { rules: 'firestore.p5.rules' } });
    expect(read('firebase.release.json')).not.toMatch(/takarda-c8cd8|takarda-n2-test|projects?"/);
    expect(fs.existsSync(path.join(root, '.firebaserc'))).toBe(false);
  });

  it('vérification avant/après publication : le candidat est identique, tout autre fichier est différent, une copie aux fins de ligne différentes reste identique', () => {
    expect(release.verify(path.join(root, 'firestore.p5.rules')).identical).toBe(true);
    for (const other of ['firestore.rules', 'firestore.p4.rules', 'firestore.emergency-writes-off.rules', 'firestore.emergency-all-off.rules']) {
      expect({ other, identical: release.verify(path.join(root, other)).identical }).toEqual({ other, identical: false });
    }
    expect(release.verify(path.join(root, 'firestore.emergency-all-off.rules')).matches).toBe('firestore.emergency-all-off.rules');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-'));
    const copy = path.join(dir, 'actives.rules');
    fs.writeFileSync(copy, read('firestore.p5.rules').replace(/\n/g, '\r\n'));
    expect(release.verify(copy).identical).toBe(true); // lecture en ligne de commande sous Windows : même contenu, autres fins de ligne
    fs.writeFileSync(copy, read('firestore.p5.rules').replace('allow list: if signedIn()', 'allow list: if true || signedIn()'));
    expect(release.verify(copy).identical).toBe(false); // une seule règle altérée suffit à être détectée
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Estimation des quotas (plan gratuit)', () => {
  it('une famille typique (un propriétaire, cinq locataires) consomme quelques centaines de lectures par jour : plus de 200 familles tiennent dans le quota', () => {
    const owner = ownerDailyUsage({ foregroundHours: 2, changedItemsPerDay: 20, tenants: 5, viewItemsChangedPerTenantPerDay: 3 }, DEFAULT_LIMITS);
    const tenant = tenantDailyUsage({ refreshesPerDay: 1, viewItems: 20 });
    expect(owner).toEqual({ reads: 24 + (20 + 15) * READS_PER_WRITE, writes: 35 });
    expect(tenant).toEqual({ reads: 25, writes: 0 });
    const capacity = familiesPerFreePlan(owner, Array(5).fill(tenant));
    expect(capacity).toEqual({ byReads: 228, byWrites: 571, limit: 228 });
  });

  it('un usage intensif (six heures, quinze locataires qui actualisent trois fois) : une trentaine de familles seulement', () => {
    const owner = ownerDailyUsage({ foregroundHours: 6, changedItemsPerDay: 80, tenants: 15, viewItemsChangedPerTenantPerDay: 6 }, DEFAULT_LIMITS);
    const capacity = familiesPerFreePlan(owner, Array(15).fill(tenantDailyUsage({ refreshesPerDay: 3, viewItems: 25 })));
    expect(capacity.limit).toBe(28);
  });

  it('le minuteur de réception est plafonné par le plafond horaire de cycles', () => {
    const fast = { ...DEFAULT_LIMITS, foregroundIntervalMs: 60_000, maxCyclesPerHour: 30 };
    expect(ownerDailyUsage({ foregroundHours: 1, changedItemsPerDay: 0, tenants: 0, viewItemsChangedPerTenantPerDay: 0 }, fast).reads).toBe(30);
  });

  it('constat : dix comptes qui atteignent les plafonds du moteur suffisent à épuiser le quota gratuit — le plafond par compte ne protège pas d’un client qui contourne l’application', () => {
    expect(FREE_PLAN_DAILY.reads).toBe(50_000);
    expect(accountsAtCapToExhaust(DEFAULT_LIMITS)).toEqual({ byReads: 10, byWrites: 10 });
  });

  it('le modèle est pur : aucun SDK, aucun réseau', () => {
    const imports = read('services/firebase/quotaModel.ts').split('\n').filter((l) => /^\s*(import|export) .* from /.test(l)).join('\n');
    expect(imports).not.toMatch(/firebase\/|firestore|fetch/);
  });
});
