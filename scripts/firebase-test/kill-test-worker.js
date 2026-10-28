/* global __dirname */
// N2-5 : lance le « worker » de suppression (processFile processKill.n2.test.ts) dans un processus séparé, le TUE au point choisi,
// puis lance la vérification (reprise) dans un second processus. NON EXÉCUTÉ tant que N2 n'est pas autorisé.
//
// Prérequis : mêmes variables que N2 (TAKARDA_TEST_PROJECT_ID, TAKARDA_CONFIRM_TEST_PROJECT, TAKARDA_TEST_FIREBASE_CONFIG_FILE),
// et TAKARDA_N2_STATE_FILE = chemin d'un fichier HORS du dépôt (il contient un e-mail et un mot de passe jetables du projet de test ;
// ce script le supprime en fin de parcours).
//
// Usage : node scripts/firebase-test/kill-test-worker.js [phase ...]
//   phases : after-lock, mid-batches, before-space-delete, before-profile-delete (par défaut : les quatre)

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const jest = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');
const config = path.join(root, 'jest.firebase-test-real.config.js');
const PHASES = ['after-lock', 'mid-batches', 'before-space-delete', 'before-profile-delete'];
const requested = process.argv.slice(2).length ? process.argv.slice(2) : PHASES;

function fail(message) {
  console.error(`ARRÊT : ${message}`);
  process.exit(1);
}

for (const name of ['TAKARDA_TEST_PROJECT_ID', 'TAKARDA_CONFIRM_TEST_PROJECT', 'TAKARDA_TEST_FIREBASE_CONFIG_FILE', 'TAKARDA_N2_STATE_FILE']) {
  if (!process.env[name]) fail(`variable ${name} absente.`);
}
if (process.env.TAKARDA_TEST_PROJECT_ID !== 'takarda-n2-test') fail('le projet autorisé est « takarda-n2-test » seulement.');
if (process.env.TAKARDA_CONFIRM_TEST_PROJECT !== process.env.TAKARDA_TEST_PROJECT_ID) fail('TAKARDA_CONFIRM_TEST_PROJECT doit répéter l’identifiant du projet de test.');
const stateFile = path.resolve(process.env.TAKARDA_N2_STATE_FILE);
if (stateFile.toLowerCase().startsWith(root.toLowerCase())) fail('le fichier d’état doit être HORS du dépôt.');
for (const phase of requested) if (!PHASES.includes(phase)) fail(`phase inconnue : ${phase}`);

const run = (mode, phase) =>
  spawn(process.execPath, [jest, '-c', config, '--rootDir', root, '--runInBand', '--forceExit', '--testPathPattern', 'processKill'], {
    cwd: root,
    env: { ...process.env, TAKARDA_N2_KILL_MODE: mode, TAKARDA_N2_KILL_PHASE: phase, TAKARDA_N2_STATE_FILE: stateFile },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  else child.kill('SIGKILL');
}

async function waitReady(timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if (JSON.parse(fs.readFileSync(stateFile, 'utf8')).ready) return true;
    } catch {
      // fichier pas encore écrit
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  const summary = [];
  for (const phase of requested) {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    console.log(`\n=== phase ${phase} : démarrage du worker`);
    const worker = run('worker', phase);
    let log = '';
    worker.stdout.on('data', (d) => (log += d));
    worker.stderr.on('data', (d) => (log += d));
    const exited = new Promise((resolve) => worker.on('exit', (code) => resolve(code)));
    const ready = await Promise.race([waitReady(10 * 60 * 1000), exited.then(() => false)]);
    if (!ready) {
      killTree(worker);
      console.error(log.slice(-2000));
      fail(`le worker n’a pas atteint le point « ${phase} » (voir la sortie ci-dessus). Compte de test éventuellement à purger.`);
    }
    console.log('point atteint : processus TUÉ');
    killTree(worker);
    await exited;
    console.log('=== reprise et vérification');
    const verify = run('verify', phase);
    let vlog = '';
    verify.stdout.on('data', (d) => (vlog += d));
    verify.stderr.on('data', (d) => (vlog += d));
    const code = await new Promise((resolve) => verify.on('exit', resolve));
    for (const line of vlog.split(/\r?\n/).filter((l) => l.includes('N2-OBS'))) console.log(line.trim());
    summary.push({ phase, verifyExitCode: code });
    if (code !== 0) {
      console.error(vlog.slice(-3000));
      console.error(`ÉCHEC à la phase ${phase} : état conservé dans ${stateFile} pour analyse.`);
      console.log(JSON.stringify(summary));
      process.exit(2);
    }
  }
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  console.log(`\nRÉSUMÉ ${JSON.stringify(summary)}`);
}

main().catch((error) => fail(String(error)));
