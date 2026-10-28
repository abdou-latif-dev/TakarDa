// Magasin persistant validé, propre à l'espace de travail actif (personnel ou démonstration), pour la file d'opérations et la
// référence de synchronisation. Mêmes garanties que les métadonnées locales (localSyncMeta.ts) :
//  - un magasin absent est vide ; un magasin ILLISIBLE ou incohérent n'est JAMAIS traité comme vide ni écrasé (erreur) ;
//  - les mises à jour sont sérialisées (jamais deux écritures qui s'écrasent) ;
//  - une transformation qui produirait un contenu invalide n'écrit rien.
// Aucun réseau, aucun SDK.

import { storage } from '../storage';
import { workspaceKey } from '../persistence';
import { accountScopedKey } from './syncAccount';

export class StoreCorruptedError extends Error {
  constructor(readonly storeName: string, readonly problems: string[]) {
    super(`Magasin « ${storeName} » illisible : ${problems.slice(0, 3).join(' ; ')}`);
    this.name = 'StoreCorruptedError';
  }
}

export interface PersistentStore<T> {
  /** Clé de stockage de l'espace actif (change avec l'espace : 'clé' ou 'demo/clé'). */
  key(): string;
  load(): Promise<T>;
  update(change: (current: T) => T): Promise<T>;
}

export function createPersistentStore<T extends { schemaVersion: number }>(options: {
  baseKey: string;
  name: string;
  /**
   * `account` (défaut) : clé PROPRE AU COMPTE actif (`<clé>@<uid>`), erreur sans compte — l'état d'un compte n'est jamais lu par un autre.
   * `workspace` : commun aux comptes de l'espace de travail (réservé au registre de propriété, qui sépare justement les comptes).
   */
  scope?: 'account' | 'workspace';
  empty: () => T;
  validate: (value: unknown) => string[];
}): PersistentStore<T> {
  let chain: Promise<unknown> = Promise.resolve();
  const key = () => workspaceKey(options.scope === 'workspace' ? options.baseKey : accountScopedKey(options.baseKey));

  async function load(): Promise<T> {
    const raw = await storage.get<T>(key()); // une erreur de lecture ou de JSON se propage : jamais « vide »
    if (raw === null) return options.empty();
    const problems = options.validate(raw);
    if (problems.length > 0) throw new StoreCorruptedError(options.name, problems);
    return raw;
  }

  function update(change: (current: T) => T): Promise<T> {
    const run = chain.then(async () => {
      const next = change(await load());
      const problems = options.validate(next);
      if (problems.length > 0) throw new StoreCorruptedError(options.name, problems);
      await storage.set(key(), next);
      return next;
    });
    chain = run.catch(() => undefined);
    return run;
  }

  return { key, load, update };
}
