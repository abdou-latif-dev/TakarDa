// Phase 2 — entrée locale sans compte : identité, profil local, premier lancement,
// compatibilité avec les données déjà stockées.

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CURRENT_USER_ID, groups, users } from '../db';
import { authService } from '../authService';
import { ensureLocalUser, getCurrentUserId } from '../identityService';
import { completeOnboarding, hasCompletedOnboarding, ONBOARDING_KEY, resolveEntryRoute } from '../onboardingService';
import { hydrateDb, startAutoPersist } from '../persistence';

const PREFIX = '@formease/';

beforeEach(async () => {
  await AsyncStorage.clear();
  users.length = 0; // état « avant hydratation » ; chaque test recrée ce dont il a besoin
  groups.length = 0;
});

describe('getCurrentUserId', () => {
  it('retourne l’identité locale historique, toujours la même', () => {
    expect(getCurrentUserId()).toBe('u-me');
    expect(getCurrentUserId()).toBe(getCurrentUserId());
    expect(getCurrentUserId()).toBe(CURRENT_USER_ID); // les services métier voient la même identité
  });
});

describe('Profil local', () => {
  it('est créé s’il n’existe pas, avec l’identité courante, et jamais dupliqué', () => {
    const created = ensureLocalUser();
    expect(created.id).toBe(getCurrentUserId());
    expect(created.name).toBeTruthy();
    expect(created).not.toHaveProperty('password');
    expect(ensureLocalUser()).toBe(created);
    expect(users.filter((u) => u.id === getCurrentUserId())).toHaveLength(1);
  });

  it('un profil existant n’est jamais modifié ni remplacé', () => {
    users.push({ id: 'u-me', formeaseId: 'FE-1111', name: 'Awa Kossi', email: 'awa@example.com', createdAt: '2026-01-01T00:00:00.000Z' });
    const user = ensureLocalUser();
    expect(user).toMatchObject({ name: 'Awa Kossi', email: 'awa@example.com', formeaseId: 'FE-1111' });
    expect(users).toHaveLength(1);
  });

  it('s’ouvre sans compte ni session : restoreSession renvoie le profil local et n’écrit aucune session', async () => {
    const user = await authService.restoreSession();
    expect(user.id).toBe('u-me');
    expect(await AsyncStorage.getItem(PREFIX + 'session')).toBeNull();
  });

  it('se met à jour et survit à un redémarrage (persistance locale existante)', async () => {
    jest.useFakeTimers();
    try {
      await authService.restoreSession();
      await authService.updateProfile({ name: 'Koffi Mensah', email: 'koffi@example.com', phone: '90000000', avatarUrl: 'file:///avatar.jpg' });

      const stop = startAutoPersist();
      await jest.advanceTimersByTimeAsync(3100);
      stop();

      users.length = 0; // redémarrage : mémoire vide, puis relecture du stockage
      await hydrateDb();
      const restored = await authService.restoreSession();
      expect(restored).toMatchObject({ id: 'u-me', name: 'Koffi Mensah', email: 'koffi@example.com', phone: '90000000', avatarUrl: 'file:///avatar.jpg' });
      expect(users).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('login et inscription restent fonctionnels (écrans conservés) sans devenir obligatoires', async () => {
    await authService.signUp({ fullName: 'Yao Dossou', identifier: 'yao@example.com', password: '' });
    expect(await AsyncStorage.getItem(PREFIX + 'session')).not.toBeNull();
    expect((await authService.restoreSession()).name).toBe('Yao Dossou');
    await authService.logout();
    expect(await AsyncStorage.getItem(PREFIX + 'session')).toBeNull();
    expect((await authService.restoreSession()).name).toBe('Yao Dossou'); // le profil local survit à la fermeture de session
  });
});

describe('Premier lancement', () => {
  it('état initial : présentation non vue, donc présentation puis accueil', async () => {
    expect(await hasCompletedOnboarding()).toBe(false);
    expect(resolveEntryRoute(await hasCompletedOnboarding())).toBe('onboarding');
  });

  it('après « Commencer » : mémorisé, et le lancement suivant va droit à l’accueil', async () => {
    await completeOnboarding();
    expect(await hasCompletedOnboarding()).toBe(true);
    expect(resolveEntryRoute(await hasCompletedOnboarding())).toBe('tabs');
    expect(await AsyncStorage.getItem(PREFIX + ONBOARDING_KEY)).toBe('true');
  });

  it('la clé historique est conservée : une installation qui avait déjà vu la présentation n’y revient pas', async () => {
    expect(ONBOARDING_KEY).toBe('onboarding_seen');
    await AsyncStorage.setItem(PREFIX + 'onboarding_seen', 'true'); // écrit par une version antérieure
    expect(await hasCompletedOnboarding()).toBe(true);
  });

  it('ne mène jamais à l’écran de connexion', () => {
    for (const done of [true, false]) expect(['onboarding', 'tabs']).toContain(resolveEntryRoute(done));
  });

  it('un stockage illisible n’empêche pas d’entrer', async () => {
    // getItem est déjà un jest.fn du mock officiel : « Once » se consomme tout seul (un mockRestore le viderait).
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('stockage indisponible'));
    expect(await hasCompletedOnboarding()).toBe(false);
    expect(await hasCompletedOnboarding()).toBe(false); // la lecture suivante fonctionne normalement
  });
});

describe('Compatibilité avec les données existantes', () => {
  const snapshot = {
    users: [{ id: 'u-me', formeaseId: 'FE-4821', name: 'Awa Kossi', email: 'awa@example.com', createdAt: '2026-01-01T00:00:00.000Z' }],
    groups: [{ id: 'g-1', name: 'Tontine Famille', kind: 'tontine', ownerId: 'u-me', memberCount: 1, createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }],
  };

  it('les données déjà stockées sont relues telles quelles et aucune clé n’est supprimée ni modifiée', async () => {
    await AsyncStorage.setItem(PREFIX + 'db_snapshot', JSON.stringify(snapshot));
    await AsyncStorage.setItem(PREFIX + 'core_tools', JSON.stringify([{ id: 'tool-1' }]));
    await AsyncStorage.setItem(PREFIX + 'session', JSON.stringify({ userId: 'u-me' }));
    const before = Object.fromEntries(await AsyncStorage.multiGet(['@formease/db_snapshot', '@formease/core_tools', '@formease/session']));

    await hydrateDb();
    const user = await authService.restoreSession();
    await completeOnboarding();

    expect(user).toMatchObject({ id: 'u-me', name: 'Awa Kossi' });
    expect(groups.map((g) => g.id)).toEqual(['g-1']);
    const after = Object.fromEntries(await AsyncStorage.multiGet(['@formease/db_snapshot', '@formease/core_tools', '@formease/session']));
    expect(after).toEqual(before);
  });

  it('un ancien stockage sans profil retrouve un profil local, sans toucher aux données qui lui appartiennent', async () => {
    await AsyncStorage.setItem(PREFIX + 'db_snapshot', JSON.stringify({ groups: snapshot.groups }));
    await hydrateDb();
    expect(users).toHaveLength(0);

    const user = await authService.restoreSession();
    expect(user.id).toBe('u-me');
    expect(groups[0]).toMatchObject({ id: 'g-1', ownerId: user.id }); // la tontine reste rattachée au même propriétaire
  });
});
