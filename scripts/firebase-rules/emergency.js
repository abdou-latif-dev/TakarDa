/* global __dirname */
// Génération des règles d'URGENCE à partir des règles candidates (F4). Aucune ressource externe, aucune publication : ce module ne fait que transformer du texte.
//
//   node scripts/firebase-rules/emergency.js          écrit les deux fichiers d'urgence à la racine (jamais publiés)
//
// Variante 1 « écritures refusées » : le fichier source, dont CHAQUE règle d'écriture (create, update, delete, write) devient `if false` ; les lectures restent
//   exactement celles des règles candidates. Les données sont figées, l'application continue de lire.
// Variante 2 « tout refusé » : plus aucun accès, en lecture comme en écriture.
// Les fichiers générés portent l'empreinte de leur source : un test vérifie qu'ils correspondent aux règles candidates ACTUELLES (sinon ils sont à régénérer).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SOURCE = 'firestore.p5.rules';
const WRITES_OFF = 'firestore.emergency-writes-off.rules';
const ALL_OFF = 'firestore.emergency-all-off.rules';

const normalize = (text) => text.replace(/\r\n/g, '\n');
const sha256 = (text) => crypto.createHash('sha256').update(normalize(text)).digest('hex');

/** Règles d'écriture : `allow create|update|delete|write [, …]: if <condition>;`. Une condition ne contient jamais de `;` (il termine l'instruction). */
const WRITE_RULE = /allow ((?:create|update|delete|write)(?:, (?:create|update|delete))*): if [^;]+;/g;

function writesOff(source) {
  const text = normalize(source);
  const converted = text.replace(WRITE_RULE, (_, ops) => `allow ${ops}: if false;`);
  const header =
    "// RÈGLES D'URGENCE — variante 1 « ÉCRITURES REFUSÉES ». GÉNÉRÉ par scripts/firebase-rules/emergency.js à partir de " + SOURCE + " (SHA-256 " + sha256(text) + ").\n" +
    "// NE PAS ÉDITER À LA MAIN. NON PUBLIÉ. Chaque règle d'écriture est refusée ; les lectures sont celles des règles candidates. Procédure : docs/f4-production.md.\n";
  return header + converted;
}

function allOff(source) {
  const header =
    "// RÈGLES D'URGENCE — variante 2 « TOUT REFUSÉ ». GÉNÉRÉ par scripts/firebase-rules/emergency.js (source : " + SOURCE + ", SHA-256 " + sha256(source) + ").\n" +
    "// NE PAS ÉDITER À LA MAIN. NON PUBLIÉ. Plus aucun accès, en lecture comme en écriture. Procédure : docs/f4-production.md.\n";
  return header + "rules_version = '2';\n\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if false;\n    }\n  }\n}\n";
}

module.exports = { SOURCE, WRITES_OFF, ALL_OFF, writesOff, allOff, sha256, normalize };

if (require.main === module) {
  const root = path.join(__dirname, '..', '..');
  const source = fs.readFileSync(path.join(root, SOURCE), 'utf8');
  fs.writeFileSync(path.join(root, WRITES_OFF), writesOff(source));
  fs.writeFileSync(path.join(root, ALL_OFF), allOff(source));
  console.log(`écrit : ${WRITES_OFF}, ${ALL_OFF} (source ${SOURCE}, SHA-256 ${sha256(source)})`);
}
