// Effacement des ESPACES PARTAGÉS d'un compte propriétaire — F4. Procédure CONTRÔLÉE, sur le modèle de l'effacement de l'espace personnel (syncAccountErasure.ts) ;
// module pur : aucun SDK (le port est réalisé dans firestoreModulesBackend.ts, en mémoire dans les tests). Lancée AVANT tout le reste de la suppression du compte.
//
// Pour chaque module dont le compte est propriétaire (liste serveur) :
//   1. propriété démontrée par une lecture serveur (sinon : rien n'est touché, le module est signalé « non prouvé ») ;
//   2. VERROU posé puis confirmé (irréversible) : plus aucune écriture, les locataires perdent leur lecture, seule la suppression reste permise au propriétaire ;
//   3. suppression par lots des vues des locataires, des données, des demandes, puis des fiches de membres (dans cet ordre : les vues se retrouvent par les fiches) ;
//   4. vérification SERVEUR : plus aucun document ; alors seulement, le module lui-même est supprimé, puis son absence est confirmée.
// Tout est idempotent : relancer reprend où la procédure s'est arrêtée (réseau, délai, arrêt du processus), sans rien refaire de destructeur inutilement.
// Un module non vidé n'est jamais supprimé (ses sous-documents deviendraient des orphelins inatteignables par les règles).

export interface ModuleState {
  exists: boolean;
  ownerUid: string | null;
  locked: boolean;
}

/** Chemin d'un document relatif au module (ex. ['members', uid], ['tenantViews', uid, 'items', id]). */
export type ModuleDocPath = string[];

/** Port : lectures SERVEUR, écritures confirmées. */
export interface ModuleErasureBackend {
  /** Identifiants des modules dont le compte est propriétaire (requête serveur `ownerUid == uid`). */
  listOwnedModuleIds(): Promise<string[]>;
  /** Lecture d'un module qui existe (le propriétaire le lit) ; les règles refusent la lecture d'un document absent : une absence se confirme par `listOwnedModuleIds`. */
  readModule(moduleId: string): Promise<ModuleState>;
  lockModule(moduleId: string, at: string): Promise<void>;
  /** Jusqu'à `limit` documents restants, dans l'ordre de suppression (vues, données, demandes, fiches). */
  listModuleDocs(moduleId: string, limit: number): Promise<ModuleDocPath[]>;
  removeModuleDocs(moduleId: string, paths: ModuleDocPath[]): Promise<void>;
  deleteModule(moduleId: string): Promise<void>;
}

export const MODULE_ERASURE_PAGE_SIZE = 100;
export const MODULE_ERASURE_TIMEOUT_MS = 15_000;
export const MODULE_ERASURE_DEADLINE_MS = 5 * 60 * 1000;
const MAX_PAGES = 10_000;

export type ModulesErasureStatus = 'none' | 'purged' | 'incomplete' | 'unproven';

export interface ModulesErasureReport {
  status: ModulesErasureStatus;
  /** Modules trouvés pour ce compte. */
  modules: number;
  /** Modules supprimés ET dont l'absence est confirmée. */
  deleted: number;
  /** Documents (vues, données, demandes, fiches) supprimés. */
  docsDeleted: number;
  /** Modules non terminés (à reprendre) ou non prouvés. */
  pending: string[];
  uncertain: boolean;
  error: { code: string; message: string } | null;
}

class Timeout extends Error {
  readonly code = 'client-timeout';
  constructor(readonly step: string, readonly ms: number) {
    super(`Pas de réponse du serveur en ${Math.round(ms / 1000)} s (${step}). L’opération a peut-être été appliquée.`);
    this.name = 'ModuleErasureTimeout';
  }
}

function timed<T>(promise: Promise<T>, ms: number, step: string): Promise<T> {
  promise.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout(step, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const failure = (error: unknown): { code: string; message: string } => ({
  code: (error as { code?: string } | null)?.code ?? 'unknown',
  message: error instanceof Error ? error.message : 'Erreur Firestore.',
});

export interface ModulesErasureOptions {
  backend: ModuleErasureBackend;
  uid: string;
  /** Seulement ces espaces (« supprimer cet espace ») ; absent = tous les espaces du compte (suppression du compte). Un identifiant qui n'est pas dans la liste serveur de ses espaces est ignoré. */
  only?: string[];
  now?: () => number;
  timeoutMs?: number;
  deadlineMs?: number;
  pageSize?: number;
}

export async function eraseOwnedModules(options: ModulesErasureOptions): Promise<ModulesErasureReport> {
  const { backend, uid } = options;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? MODULE_ERASURE_TIMEOUT_MS;
  const deadlineMs = options.deadlineMs ?? MODULE_ERASURE_DEADLINE_MS;
  const pageSize = Math.max(1, Math.min(options.pageSize ?? MODULE_ERASURE_PAGE_SIZE, 400));
  const startedAt = now();
  const step = <T,>(promise: Promise<T>, label: string) => timed(promise, timeoutMs, label);
  const report: ModulesErasureReport = { status: 'none', modules: 0, deleted: 0, docsDeleted: 0, pending: [], uncertain: false, error: null };
  if (!uid) {
    report.status = 'incomplete';
    report.error = { code: 'no-account', message: 'Aucun compte : rien n’est supprimé.' };
    return report;
  }

  let ids: string[];
  try {
    ids = await step(backend.listOwnedModuleIds(), 'liste de vos espaces partagés');
  } catch (error) {
    report.status = 'incomplete';
    report.error = failure(error);
    report.uncertain = error instanceof Timeout;
    return report;
  }
  if (options.only) ids = ids.filter((id) => options.only?.includes(id));
  report.modules = ids.length;
  if (ids.length === 0) return report; // aucun espace partagé : rien à faire

  report.status = 'purged';
  for (const moduleId of ids) {
    try {
      const state = await step(backend.readModule(moduleId), 'lecture d’un espace partagé');
      if (!state.exists) {
        report.deleted += 1; // déjà supprimé (reprise, ou autre appareil)
        continue;
      }
      if (state.ownerUid !== uid) {
        report.pending.push(moduleId); // propriété non démontrée : jamais touché
        report.status = 'unproven';
        continue;
      }
      if (!state.locked) {
        let lockError: unknown = null;
        try {
          await step(backend.lockModule(moduleId, new Date(now()).toISOString()), 'verrouillage d’un espace partagé');
        } catch (error) {
          lockError = error; // un autre appareil a peut-être posé le verrou : le serveur tranche à la relecture
        }
        const confirmed = await step(backend.readModule(moduleId), 'vérification du verrou');
        if (!confirmed.exists) {
          report.deleted += 1;
          continue;
        }
        if (!confirmed.locked) {
          if (lockError) throw lockError;
          throw Object.assign(new Error('Le verrou d’un espace partagé n’a pas été confirmé par le serveur : rien n’a été supprimé.'), { code: 'lock-unconfirmed' });
        }
      }

      const processed = new Set<string>();
      for (let page = 0; page < MAX_PAGES; page += 1) {
        if (now() - startedAt > deadlineMs) throw Object.assign(new Error('Durée maximale d’une tentative atteinte : relancez pour continuer là où la suppression s’est arrêtée.'), { code: 'deadline' });
        const paths = await step(backend.listModuleDocs(moduleId, pageSize), 'lecture des documents d’un espace partagé');
        if (paths.length === 0) break;
        const keys = paths.map((p) => p.join('/'));
        if (keys.every((k) => processed.has(k))) throw Object.assign(new Error('Des documents déjà supprimés sont toujours présents sur le serveur.'), { code: 'no-progress' });
        await step(backend.removeModuleDocs(moduleId, paths), 'suppression d’un lot de documents d’un espace partagé');
        keys.forEach((k) => processed.add(k));
        report.docsDeleted += paths.length;
      }

      // vérification SERVEUR : plus aucun document ; sinon le module n'est PAS supprimé
      const left = await step(backend.listModuleDocs(moduleId, 1), 'vérification d’un espace partagé');
      if (left.length > 0) throw Object.assign(new Error('Des documents restent dans un espace partagé : il n’est pas supprimé.'), { code: 'not-empty' });
      await step(backend.deleteModule(moduleId), 'suppression d’un espace partagé');
      // l'absence se confirme par la LISTE serveur de ses espaces : les règles ne permettent pas de lire un document absent (cela révélerait ce qui existe)
      const remaining = await step(backend.listOwnedModuleIds(), 'confirmation de la suppression');
      if (remaining.includes(moduleId)) throw Object.assign(new Error('Un espace partagé est toujours présent après sa suppression.'), { code: 'delete-unconfirmed' });
      report.deleted += 1;
    } catch (error) {
      report.pending.push(moduleId);
      report.status = report.status === 'unproven' ? 'unproven' : 'incomplete';
      report.error = report.error ?? failure(error);
      if (error instanceof Timeout) report.uncertain = true;
      // un module en échec ne bloque pas les suivants : chacun est indépendant ; l'ensemble reste « non terminé »
    }
  }
  if (report.pending.length === 0 && report.status === 'purged') return report;
  if (report.status === 'purged') report.status = 'incomplete';
  return report;
}
