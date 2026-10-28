/* global __dirname */
// Manifeste des règles VALIDÉES et vérification avant/après publication (F4). Local : lit des fichiers, calcule des empreintes SHA-256, ne contacte aucun service.
//
//   node scripts/firebase-rules/release.js manifest            recalcule les empreintes du manifeste (les preuves de validation restent écrites à la main)
//   node scripts/firebase-rules/release.js verify <fichier>    compare un fichier de règles au candidat validé : « IDENTIQUE » (code 0) ou « DIFFÉRENT » (code 1)
//
// Usage prévu : AVANT de publier, `verify firestore.p5.rules` doit répondre IDENTIQUE ; APRÈS publication, relire les règles actives (lecture seule), les enregistrer
// dans un fichier hors dépôt et lancer `verify` sur ce fichier : IDENTIQUE prouve que ce qui est en ligne est ce qui a été validé.

const fs = require('fs');
const path = require('path');
const { sha256, ALL_OFF, SOURCE, WRITES_OFF } = require('./emergency');

const root = path.join(__dirname, '..', '..');
const MANIFEST = 'firestore.rules.manifest.json';
const read = (file) => fs.readFileSync(file, 'utf8');

function currentHashes() {
  return {
    candidate: { file: SOURCE, sha256: sha256(read(path.join(root, SOURCE))) },
    emergency: {
      writesOff: { file: WRITES_OFF, sha256: sha256(read(path.join(root, WRITES_OFF))) },
      allOff: { file: ALL_OFF, sha256: sha256(read(path.join(root, ALL_OFF))) },
    },
  };
}

function verify(file) {
  const manifest = JSON.parse(read(path.join(root, MANIFEST)));
  const actual = sha256(read(file));
  const known = [manifest.candidate, manifest.emergency.writesOff, manifest.emergency.allOff].find((entry) => entry.sha256 === actual);
  return { identical: actual === manifest.candidate.sha256, actual, expected: manifest.candidate.sha256, matches: known ? known.file : null };
}

module.exports = { MANIFEST, currentHashes, verify };

if (require.main === module) {
  const [command, file] = process.argv.slice(2);
  if (command === 'manifest') {
    const manifestPath = path.join(root, MANIFEST);
    const previous = fs.existsSync(manifestPath) ? JSON.parse(read(manifestPath)) : {};
    fs.writeFileSync(manifestPath, JSON.stringify({ ...previous, schemaVersion: 1, ...currentHashes() }, null, 2) + '\n');
    console.log(`manifeste mis à jour : ${JSON.stringify(currentHashes())}`);
  } else if (command === 'verify' && file) {
    const result = verify(path.resolve(file));
    console.log(result.identical ? `IDENTIQUE au candidat validé (${result.actual})` : `DIFFÉRENT : empreinte ${result.actual}, attendue ${result.expected}${result.matches ? ` (correspond à ${result.matches})` : ''}`);
    process.exit(result.identical ? 0 : 1);
  } else {
    console.error('usage : node scripts/firebase-rules/release.js manifest | verify <fichier>');
    process.exit(2);
  }
}
