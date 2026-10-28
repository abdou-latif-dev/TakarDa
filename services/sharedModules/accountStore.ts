// Magasin local propre au COMPTE et à l'espace de travail actifs, pour les données des espaces partagés (F3b/F3c). Mêmes garanties que les autres magasins
// locaux : mises à jour sérialisées ; contenu illisible ou invalide JAMAIS traité comme vide ni écrasé (erreur) ; clé `<clé>@<uid>` (un autre compte du même
// appareil ne lit jamais ce magasin). Écrit ici plutôt que réutilisé du moteur de synchronisation : ces données ne dépendent pas du moteur.
// Aucun réseau, aucun SDK.

import { workspaceKey } from '../persistence';
import { storage } from '../storage';
import { accountScopedKey } from '../sync/syncAccount';

export class AccountStoreCorruptedError extends Error {
  constructor(readonly storeName: string, readonly problems: string[]) {
    super(`Données locales « ${storeName} » illisibles : ${problems.slice(0, 3).join(' ; ')}`);
    this.name = 'AccountStoreCorruptedError';
  }
}

export interface AccountStore<T> {
  key(): string;
  load(): Promise<T>;
  update(change: (current: T) => T): Promise<T>;
}

export function createAccountStore<T extends { schemaVersion: number }>(options: { baseKey: string; name: string; empty: () => T; validate: (value: unknown) => string[] }): AccountStore<T> {
  let chain: Promise<unknown> = Promise.resolve();
  const key = (): string => workspaceKey(accountScopedKey(options.baseKey));

  async function load(): Promise<T> {
    const raw = await storage.get<T>(key()); // une erreur de lecture ou de JSON se propage : jamais « vide »
    if (raw === null) return options.empty();
    const problems = options.validate(raw);
    if (problems.length > 0) throw new AccountStoreCorruptedError(options.name, problems);
    return raw;
  }

  return {
    key,
    load,
    update(change) {
      const run = chain.then(async () => {
        const next = change(await load());
        const problems = options.validate(next);
        if (problems.length > 0) throw new AccountStoreCorruptedError(options.name, problems);
        await storage.set(key(), next);
        return next;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
