// Garde-fous du lot N1 — fonctions PURES (aucun SDK, aucun réseau), donc testables partout.
//
// Le harnais N1 n'est autorisé que dans un environnement « émulateurs locaux » : projet fictif `demo-…`, hôtes d'émulateurs
// en boucle locale, aucune variable d'accès à un service Firebase réel. Tout autre environnement est REFUSÉ.

export class GuardError extends Error {
  constructor(message: string) {
    super(`GARDE-FOU N1 : ${message}`);
    this.name = 'GuardError';
  }
}

/** Projets réels connus : jamais utilisables par ce harnais. */
export const PRODUCTION_PROJECT_IDS: readonly string[] = ['takarda-c8cd8'];

/** Variables qui pourraient donner accès à un service réel : leur simple présence suffit à refuser l'exécution. */
export const FORBIDDEN_ENV_VARS: readonly string[] = ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'TAKARDA_TEST_PROJECT_ID', 'TAKARDA_CONFIRM_TEST_PROJECT', 'TAKARDA_TEST_FIREBASE_CONFIG_FILE'];

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

export function splitHostPort(value: string): { host: string; port: number } {
  const match = /^(\[[^\]]+\]|[^:]+):(\d{2,5})$/.exec(value.trim());
  if (!match) throw new GuardError(`hôte d'émulateur illisible : « ${value} » (attendu hôte:port).`);
  return { host: match[1].replace(/^\[|\]$/g, ''), port: Number(match[2]) };
}

export interface N1Environment {
  projectId: string;
  auth: { host: string; port: number };
  firestore: { host: string; port: number };
}

/** Valide l'environnement ; lève une GuardError au moindre doute. Ne fait AUCUN appel réseau. */
export function assertEmulatorOnlyEnvironment(env: Record<string, string | undefined>): N1Environment {
  const present = FORBIDDEN_ENV_VARS.filter((name) => env[name] !== undefined && env[name] !== '');
  if (present.length > 0) throw new GuardError(`variable(s) interdite(s) présente(s) : ${present.join(', ')} (accès possible à un service réel ; N2 n'est pas autorisé ici).`);

  const authRaw = env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreRaw = env.FIRESTORE_EMULATOR_HOST;
  if (!authRaw || !firestoreRaw) throw new GuardError('les émulateurs Authentication ET Firestore doivent être lancés (FIREBASE_AUTH_EMULATOR_HOST et FIRESTORE_EMULATOR_HOST). Sans émulateur, rien ne s\'exécute.');
  const auth = splitHostPort(authRaw);
  const firestore = splitHostPort(firestoreRaw);
  for (const [name, target] of [['Authentication', auth], ['Firestore', firestore]] as const) {
    if (!isLoopbackHost(target.host)) throw new GuardError(`l'émulateur ${name} n'est pas en boucle locale (« ${target.host} »).`);
  }

  const projectId = env.TAKARDA_N1_PROJECT_ID ?? env.GCLOUD_PROJECT ?? 'demo-takarda';
  if (PRODUCTION_PROJECT_IDS.includes(projectId)) throw new GuardError(`le projet « ${projectId} » est la PRODUCTION : interdit.`);
  if (!projectId.startsWith('demo-')) throw new GuardError(`le projet « ${projectId} » n'est pas un projet fictif « demo-… » : interdit.`);
  for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT'] as const) {
    const value = env[name];
    if (value && !value.startsWith('demo-')) throw new GuardError(`${name}=« ${value} » n'est pas un projet fictif « demo-… ».`);
  }
  return { projectId, auth, firestore };
}
