// Barrière de BUILD : refuse un build dont la cible déclarée (EXPO_PUBLIC_BUILD_TARGET) ne correspond pas à la configuration Firebase fournie. LOCAL : lit seulement des variables
// d'environnement et des fichiers du dépôt ; aucun réseau, aucune écriture. Exécutée automatiquement par EAS Build avant l'installation (script npm `eas-build-pre-install`), et à la main
// avant tout build :
//
//   node scripts/release/build-gate.js            « PRÊT » (code 0) ou « REFUSÉ » avec les problèmes (code 1)
//
// Règles (aucune valeur secrète n'est affichée ; seuls les NOMS de variables et de projets publics apparaissent) :
//   - cible absente ou « local » : le build est local (comptes fermés) ; aucune configuration Firebase n'est exigée ;
//   - cible « test » : le projet doit être `takarda-n2-test`, avec un domaine, un stockage et un numéro d'expéditeur du MÊME projet ; l'autorisation de développement de la production est interdite ;
//   - cible « production » : le projet doit être `takarda-c8cd8`, avec une configuration cohérente ; les textes légaux doivent être complets (scripts/release/legal-check.js) ;
//   - toute autre valeur de cible (faute de frappe) : REFUSÉ (jamais interprétée comme « local » en silence au moment de construire).


const TEST = { id: 'takarda-n2-test', number: '438284688014' };
const PRODUCTION = { id: 'takarda-c8cd8', number: '150945512965' };
const VARIABLE = 'EXPO_PUBLIC_BUILD_TARGET';
const TARGETS = ['local', 'test', 'production'];

const FIREBASE_VARIABLES = ['EXPO_PUBLIC_FIREBASE_API_KEY', 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET', 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', 'EXPO_PUBLIC_FIREBASE_APP_ID'];

/** @param {Record<string, string | undefined>} env  @param {{ legalReady?: () => boolean }} [options] */
function checkBuild(env, options = {}) {
  const problems = [];
  const raw = env[VARIABLE];
  const declared = raw === undefined || raw === '' ? 'local' : raw;
  if (!TARGETS.includes(declared)) {
    return { ok: false, target: String(declared), problems: [`${VARIABLE} vaut une valeur inconnue (attendu : ${TARGETS.join(', ')}) : build refusé`] };
  }
  // Variante d'identité : seule « test » existe (identifiant Android `com.takarda.app.test`, installé À CÔTÉ de TakarDa : jamais par-dessus, jamais sur la fiche Play).
  const variant = env.EXPO_PUBLIC_APP_VARIANT === undefined || env.EXPO_PUBLIC_APP_VARIANT === '' ? '' : env.EXPO_PUBLIC_APP_VARIANT;
  if (variant !== '' && variant !== 'test') {
    return { ok: false, target: declared, problems: ['EXPO_PUBLIC_APP_VARIANT vaut une valeur inconnue (attendu : test ou vide) : build refusé'] };
  }
  if (declared === 'production' && variant === 'test') {
    return { ok: false, target: declared, problems: ['un build de PRODUCTION ne peut pas porter l’identité de test (com.takarda.app.test) : jamais sur la fiche Play'] };
  }
  if (declared === 'test' && variant !== 'test') {
    return { ok: false, target: declared, problems: ['un build de cible « test » doit porter l’identité de test (EXPO_PUBLIC_APP_VARIANT=test) : sans elle il s’installerait PAR-DESSUS TakarDa'] };
  }
  if (declared === 'local') return { ok: true, target: 'local', problems: [] };

  const expected = declared === 'test' ? TEST : PRODUCTION;
  const other = declared === 'test' ? PRODUCTION : TEST;
  const missing = FIREBASE_VARIABLES.filter((name) => !env[name]);
  if (missing.length > 0) problems.push(`configuration Firebase incomplète : ${missing.join(', ')}`);
  const projectId = env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  if (projectId && projectId !== expected.id) {
    problems.push(projectId === other.id ? `cible « ${declared} » avec la configuration du projet ${other.id} : interdit` : `projet « ${projectId} » inconnu pour la cible « ${declared} » (attendu : ${expected.id})`);
  }
  if (projectId === expected.id) {
    if (env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN && env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN !== `${expected.id}.firebaseapp.com`) problems.push('domaine d’authentification d’un autre projet');
    if (env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET && !env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET.startsWith(`${expected.id}.`)) problems.push('stockage d’un autre projet');
    if (env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID && env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID !== expected.number) problems.push('numéro d’expéditeur d’un autre projet');
    if (env.EXPO_PUBLIC_FIREBASE_APP_ID && !new RegExp(`^1:${expected.number}:`).test(env.EXPO_PUBLIC_FIREBASE_APP_ID)) problems.push('identifiant d’application d’un autre projet');
  }
  if (env.EXPO_PUBLIC_ALLOW_PRODUCTION_IN_DEV) problems.push('EXPO_PUBLIC_ALLOW_PRODUCTION_IN_DEV ne doit pas être défini pour un build');
  if (declared === 'production') {
    const legalReady = options.legalReady ?? (() => require('./legal-check.js').legalReadiness().ready);
    if (!legalReady()) problems.push('textes légaux incomplets ou adresses publiques manquantes : node scripts/release/legal-check.js');
  }
  return { ok: problems.length === 0, target: declared, problems };
}

module.exports = { checkBuild, FIREBASE_VARIABLES, VARIABLE, TARGETS };

if (require.main === module) {
  const result = checkBuild(process.env);
  if (result.ok) {
    console.log(`PRÊT : build « ${result.target} »${result.target === 'local' ? ' (comptes fermés, aucun appel Firebase)' : ''}.`);
  } else {
    console.error(`REFUSÉ : build « ${result.target} ».`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}

