// F6 — conformité : information « Mes données » exacte (dérivée du modèle, vérifiée contre le code), consentement à l'inscription, et BARRIÈRE d'ouverture : les comptes
// ne peuvent être ouverts (CLOUD_ACCOUNT_ENABLED) tant que les documents légaux contiennent des éléments à fournir ou que leurs adresses publiques manquent.
// Aucun accès réseau, rien n'est publié.

import fs from 'fs';
import path from 'path';
import { CLOUD_ACCOUNT_ENABLED } from '@/constants/features';
import { SYNC_SCOPE_V1 } from '../sync/syncScope';
import { TENANT_BODY_FIELDS, TENANT_ITEM_KINDS } from '../sharedModules/model';
import { SIGNUP_CONSENT_TEXT, TENANT_FIELD_LABELS, buildPrivacySections, tenantVisibleLines } from '../privacyNotice';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined, clear: async () => undefined, getAllKeys: async () => [] },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const legal = require('../../scripts/release/legal-check.js') as {
  DOCS: string[];
  legalReadiness: (read?: (file: string) => string) => { ready: boolean; markers: { file: string; items: { marker: string; count: number }[] }[]; urls: { privacy: boolean; accountDeletion: boolean } };
  unresolvedMarkers: (text: string) => { marker: string; count: number }[];
  publishedPart: (text: string) => string;
  isPublicHttps: (value: unknown) => boolean;
  configuredUrl: (source: string, name: string) => string | null;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const root = path.join(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

describe('Information « Mes données » : exacte, dérivée du modèle', () => {
  it('chaque champ de la vue du locataire a un libellé, et seulement eux : le texte ne peut pas dire moins que ce qui est publié', () => {
    for (const kind of TENANT_ITEM_KINDS) {
      expect(Object.keys(TENANT_FIELD_LABELS[kind]).sort()).toEqual([...TENANT_BODY_FIELDS[kind]].sort());
    }
    const text = tenantVisibleLines().join(' ');
    for (const kind of TENANT_ITEM_KINDS) for (const field of TENANT_BODY_FIELDS[kind]) expect({ kind, field, shown: text.includes(TENANT_FIELD_LABELS[kind][field]) }).toEqual({ kind, field, shown: true });
    expect(tenantVisibleLines()).toHaveLength(TENANT_ITEM_KINDS.length);
  });

  it('les rubriques « comptes et partage » ne s’affichent que lorsque ces fonctions sont ouvertes ; « sur votre téléphone » et « ce que TakarDa ne fait pas » toujours', () => {
    const sections = buildPrivacySections();
    expect(sections.filter((s) => !s.cloudOnly).map((s) => s.id)).toEqual(['local', 'never']);
    expect(sections.filter((s) => s.cloudOnly).map((s) => s.id)).toEqual(['account', 'sync', 'owner', 'tenant', 'deletion']);
    for (const section of sections) {
      expect(section.lines.length).toBeGreaterThan(0);
      for (const line of section.lines) expect(line).not.toMatch(/\[[^\]]*(FOURNIR|DÉCIDER|VÉRIFIER)|undefined|Firebase Console|console Firebase/);
    }
  });

  it('ce que la synchronisation n’envoie jamais est vrai : le périmètre ne contient ni tontine, ni formulaire, ni CEET/TDE, ni photo', () => {
    for (const kind of SYNC_SCOPE_V1) expect(kind).toMatch(/^(immobilier\.|core\.contact)/);
    const sync = buildPrivacySections().find((s) => s.id === 'sync')!;
    expect(sync.lines.join(' ')).toMatch(/Ne sont jamais envoyés : tontines, formulaires et réponses, factures CEET et TDE/);
  });

  it('les affirmations « aucune publicité, statistiques, rapport d’erreurs, position, caméra, micro » sont vraies dans le code', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    const deps = Object.keys(pkg.dependencies).join(' ');
    for (const forbidden of ['sentry', 'crashlytics', 'analytics', 'mixpanel', 'amplitude', 'segment', 'admob', 'google-mobile-ads', 'expo-location', 'expo-contacts', 'expo-av', 'expo-audio', 'react-native-maps', 'bugsnag', 'datadog', 'posthog']) {
      expect({ forbidden, present: deps.includes(forbidden) }).toEqual({ forbidden, present: false });
    }
    const app = JSON.parse(read('app.json')) as { expo: { android: { blockedPermissions: string[] } } };
    expect(app.expo.android.blockedPermissions).toEqual(expect.arrayContaining(['android.permission.CAMERA', 'android.permission.RECORD_AUDIO']));
    const never = buildPrivacySections().find((s) => s.id === 'never')!.lines.join(' ');
    expect(never).toMatch(/Aucune publicité/);
    expect(never).toMatch(/ni la caméra ni le micro/);
  });

  it('l’écran, sa route et l’entrée du Profil existent ; la route n’est pas derrière le drapeau (le texte local est toujours lisible)', () => {
    expect(read('app/privacy.tsx')).not.toMatch(/Redirect|CLOUD_ACCOUNT_ENABLED/);
    const screen = read('features/profile/screens/PrivacyScreen.tsx');
    expect(screen).toContain('buildPrivacySections()');
    expect(screen).toMatch(/CLOUD_ACCOUNT_ENABLED \|\| !s\.cloudOnly/);
    expect(read('services/profileService.ts')).toContain("route: '/privacy'");
  });
});

describe('Consentement à l’inscription', () => {
  it('on ne peut pas créer un compte sans avoir coché la case d’information ; la case mène au texte', () => {
    const screen = read('features/auth/screens/SignUpScreen.tsx');
    expect(screen).toContain('SIGNUP_CONSENT_TEXT');
    expect(screen).toMatch(/disabled=\{!informed\}/);
    expect(screen).toMatch(/if \(!informed\) \{[\s\S]*?return;/);
    expect(screen).toContain("router.push('/privacy' as never)");
    expect(SIGNUP_CONSENT_TEXT).toMatch(/ce qui reste sur mon téléphone, ce qui part dans le cloud/);
  });

  it('les notices de partage sont aux bons endroits (propriétaire qui crée, demandeur qui rejoint)', () => {
    const screen = read('features/profile/screens/SharedModulesScreen.tsx');
    expect(screen).toMatch(/Prévenez vos locataires que vous utilisez TakarDa et ce partage/);
    expect(screen).toMatch(/Le propriétaire verra l’identifiant de votre compte et le nom que vous saisissez/);
    expect(screen).toMatch(/Vous pourrez quitter l’espace à tout moment, ce qui retire aussi ce nom/);
  });
});

describe('Barrière d’ouverture des comptes (F7)', () => {
  it('le contrôle détecte les éléments à fournir dans le TEXTE PUBLIÉ seulement (partie 1), pas dans les notes internes', () => {
    const doc = '# T\n## PARTIE 1\nResponsable : [NOM À FOURNIR] et [NOM À FOURNIR], contact [À DÉCIDER : x].\n## PARTIE 2\nNotes : [À VÉRIFIER : interne]\n';
    expect(legal.unresolvedMarkers(doc)).toEqual([{ marker: '[NOM À FOURNIR]', count: 2 }, { marker: '[À DÉCIDER : x]', count: 1 }]);
    expect(legal.unresolvedMarkers('## PARTIE 1\nTout est fourni.\n## PARTIE 2\n[À FOURNIR]')).toEqual([]);
  });

  it('adresses publiques : seule une vraie adresse https compte (ni exemple, ni locale, ni http)', () => {
    for (const ok of ['https://takarda.app/confidentialite', 'https://www.exemple-reel.tg/p']) expect(legal.isPublicHttps(ok)).toBe(true);
    for (const bad of [null, '', 'http://takarda.app', 'https://example.com/x', 'https://localhost/x', 'https://10.0.0.1/x', 'https://sansPoint/x', 'https://a.test/x', 'https://a b.com']) expect(legal.isPublicHttps(bad)).toBe(false);
    expect(legal.configuredUrl("export const PRIVACY_POLICY_URL: string | null = 'https://takarda.app/c';", 'PRIVACY_POLICY_URL')).toBe('https://takarda.app/c');
    expect(legal.configuredUrl('export const PRIVACY_POLICY_URL: string | null = null;', 'PRIVACY_POLICY_URL')).toBeNull();
  });

  it('prêt seulement si plus aucun élément à fournir ET les deux adresses renseignées (simulation avec des documents complets)', () => {
    const complete = (file: string) => (file.endsWith('legalLinks.ts') ? "export const PRIVACY_POLICY_URL: string | null = 'https://takarda.app/c';\nexport const ACCOUNT_DELETION_URL: string | null = 'https://takarda.app/s';" : '## PARTIE 1\nTexte complet.\n');
    expect(legal.legalReadiness(complete)).toMatchObject({ ready: true, urls: { privacy: true, accountDeletion: true } });
    const noUrl = (file: string) => (file.endsWith('legalLinks.ts') ? 'export const PRIVACY_POLICY_URL: string | null = null;\nexport const ACCOUNT_DELETION_URL: string | null = null;' : '## PARTIE 1\nTexte complet.\n');
    expect(legal.legalReadiness(noUrl).ready).toBe(false);
    const placeholder = (file: string) => (file.endsWith('legalLinks.ts') ? complete('legalLinks.ts') : '## PARTIE 1\n[DATE À FOURNIR]\n');
    expect(legal.legalReadiness(placeholder).ready).toBe(false);
    expect(legal.DOCS).toEqual(['docs/confidentialite/politique-de-confidentialite-BROUILLON.md', 'docs/confidentialite/page-suppression-de-compte-BROUILLON.md']);
  });

  it('BARRIÈRE : si les comptes sont ouverts, les documents légaux doivent être prêts (sinon ce test échoue et bloque la publication)', () => {
    if (CLOUD_ACCOUNT_ENABLED) {
      const state = legal.legalReadiness();
      expect({ ready: state.ready, unresolved: state.markers.flatMap((m) => m.items.map((i) => i.marker)), urls: state.urls }).toEqual({ ready: true, unresolved: [], urls: { privacy: true, accountDeletion: true } });
    } else {
      expect(CLOUD_ACCOUNT_ENABLED).toBe(false); // fermé : rien n'est exigé, mais aucune ouverture n'est possible sans que ce test passe
    }
  });

  it('les documents publiables existent : politique, page de suppression, déclaration Google Play', () => {
    for (const file of ['politique-de-confidentialite-BROUILLON.md', 'page-suppression-de-compte-BROUILLON.md', 'declaration-securite-donnees-play-BROUILLON.md']) {
      expect(fs.existsSync(path.join(root, 'docs/confidentialite', file))).toBe(true);
    }
    // la politique décrit bien les espaces partagés, la vue du locataire et la suppression des espaces (elle ne dit plus « aucun partage »)
    const policy = read('docs/confidentialite/politique-de-confidentialite-BROUILLON.md');
    expect(policy).toMatch(/espace partagé/);
    expect(policy).toMatch(/vue de chaque locataire/);
    expect(policy).not.toMatch(/Il n'existe pas de partage avec d'autres utilisateurs/);
  });
});
