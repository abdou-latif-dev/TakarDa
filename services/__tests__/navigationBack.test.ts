// Défaut 3 — le retour sans historique ne doit plus échouer (« The action 'GO_BACK' was not handled »).

import fs from 'fs';
import path from 'path';
import { goBackOrHome, HOME_ROUTE, type BackNavigator } from '@/utils/navigation';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

function fakeNav(canGoBack: boolean) {
  const calls: string[] = [];
  const nav: BackNavigator = {
    canGoBack: () => canGoBack,
    back: () => void calls.push('back'),
    replace: (href) => void calls.push(`replace:${href}`),
  };
  return { nav, calls };
}

describe('Retour de navigation avec repli', () => {
  it('avec un historique : retour normal, aucun remplacement', () => {
    const { nav, calls } = fakeNav(true);
    goBackOrHome(nav);
    expect(calls).toEqual(['back']);
  });

  it('sans historique : repli sur l’accueil par un remplacement (pas d’empilement, pas de boucle)', () => {
    const { nav, calls } = fakeNav(false);
    goBackOrHome(nav);
    expect(calls).toEqual(['replace:/(tabs)']);
    expect(HOME_ROUTE).toBe('/(tabs)'); // la destination déjà utilisée par l'application (« Continuer sans compte », fin de présentation)
  });

  it('un seul appel de navigation par action, quel que soit le cas', () => {
    for (const can of [true, false]) {
      const { nav, calls } = fakeNav(can);
      goBackOrHome(nav);
      expect(calls).toHaveLength(1);
    }
  });

  it('l’en-tête commun utilise le repli par défaut, un onBack explicite reste prioritaire, et l’écran de compte en profite', () => {
    const header = read('components/ui/AppHeader.tsx');
    expect(header).toContain('onBack ?? (() => goBackOrHome(router))');
    expect(header).not.toMatch(/onBack \?\? \(\(\) => router\.back\(\)\)/);
    expect(read('features/profile/screens/CloudAccountScreen.tsx')).toContain('<AppHeader title="Compte et synchronisation" showBack />');
  });
});
