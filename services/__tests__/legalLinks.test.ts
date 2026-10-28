// Liens légaux (confidentialité, suppression de compte) : emplacement prévu, inactif tant qu'aucune vraie adresse n'est fournie.

import fs from 'fs';
import path from 'path';
import { ACCOUNT_DELETION_URL, PRIVACY_POLICY_URL } from '@/constants/legalLinks';
import { buildLegalLinks, isValidPublicUrl } from '../legalLinks';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('Liens légaux : inactifs sans vraie adresse', () => {
  it('la configuration livrée ne contient aucune adresse fictive : chaque valeur est absente (null) ou une vraie adresse https', () => {
    for (const value of [PRIVACY_POLICY_URL, ACCOUNT_DELETION_URL]) {
      if (value !== null) expect(isValidPublicUrl(value)).toBe(true);
    }
  });

  it('sans adresse : aucun lien n’est construit, donc rien n’est affiché dans Profil', () => {
    expect(buildLegalLinks({ privacy: null, accountDeletion: null })).toEqual([]);
    expect(buildLegalLinks({ privacy: '', accountDeletion: '   ' })).toEqual([]);
  });

  it('une vraie adresse https active uniquement le lien correspondant', () => {
    const links = buildLegalLinks({ privacy: 'https://takarda.exemple-reel.org/confidentialite', accountDeletion: null });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: 'privacy', label: 'Politique de confidentialité', url: 'https://takarda.exemple-reel.org/confidentialite' });
    const both = buildLegalLinks({ privacy: 'https://a.takarda.org/p', accountDeletion: 'https://a.takarda.org/suppression' });
    expect(both.map((l) => l.id)).toEqual(['privacy', 'account-deletion']);
  });

  it('refuse les adresses non https, malformées, locales ou d’exemple (jamais d’URL fictive active)', () => {
    const rejected = [
      'http://takarda.org/p', 'ftp://takarda.org/p', 'javascript:alert(1)', 'data:text/html,x', 'takarda.org/p', 'https://', 'https:///p',
      'https://localhost/p', 'https://127.0.0.1/p', 'https://example.com/p', 'https://www.example.org', 'https://mon-site.test/p', 'https://site.invalid/p',
      'https://takarda', ' https://takarda.org/p', 'https://takarda.org/p ', 'https://takarda.org/un espace', 'https://user:pw@takarda.org/p', '', null, undefined, 42,
    ];
    for (const value of rejected) expect(isValidPublicUrl(value)).toBe(false);
  });

  it('accepte une adresse https avec chemin, paramètres ou port', () => {
    for (const value of ['https://takarda.org', 'https://takarda.org/politique?lang=fr', 'https://sites.google.com/view/takarda/confidentialite', 'https://takarda.org:8443/p']) {
      expect(isValidPublicUrl(value)).toBe(true);
    }
  });

  it('câblage : Profil n’affiche le bloc que s’il existe des liens ; aucune URL en dur dans les écrans', () => {
    const screen = read('features/profile/screens/ProfileScreen.tsx');
    expect(screen).toContain('buildLegalLinks({ privacy: PRIVACY_POLICY_URL, accountDeletion: ACCOUNT_DELETION_URL })');
    expect(screen).toContain('legalLinks.length > 0 &&');
    expect(screen).not.toMatch(/https?:\/\//);
    expect(read('constants/legalLinks.ts')).toMatch(/PRIVACY_POLICY_URL: string \| null = null;/);
    expect(read('constants/legalLinks.ts')).toMatch(/ACCOUNT_DELETION_URL: string \| null = null;/);
  });
});
