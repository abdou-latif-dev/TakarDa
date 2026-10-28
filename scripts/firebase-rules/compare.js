/* global __dirname */
// Comparaison LOCALE entre un fichier de règles ACTIVES (copié par vous, en lecture seule, depuis l'onglet Règles de la console) et le candidat validé. Aucune connexion, aucune écriture.
//
//   node scripts/firebase-rules/compare.js <fichier-des-règles-actives>
//
// Sortie : empreintes, « IDENTIQUE » ou « DIFFÉRENT », niveau détecté des règles actives (V1 → P4 → P5 → P5 + marqueur), alerte si les règles sont ouvertes (test), et le détail des lignes
// ajoutées par le candidat / présentes seulement dans les règles actives. Code de sortie 0 = identique, 1 = différent, 2 = fichier illisible ou règles ouvertes.
// Deux niveaux : (1) analyse STRUCTURELLE (structure.js) instruction par instruction : règles nouvelles, plus strictes, plus PERMISSIVES, modifiées, retirées, risques de verrouillage ;
// (2) comparaison par lignes (sans les espaces de bord), insensible à l'ordre. L'empreinte est le seul verdict d'identité ; la relecture humaine des cas « nouvelle » et « modifiée » reste nécessaire.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { analyseStructure, analyseFunctions, completeness } = require('./structure');

const root = path.join(__dirname, '..', '..');
const CANDIDATE = 'firestore.p5.rules';
const normalize = (text) => text.replace(/\r\n/g, '\n');
const sha256 = (text) => crypto.createHash('sha256').update(normalize(text)).digest('hex');

/** Du plus complet au plus ancien : le premier niveau reconnu est celui des règles actives. */
const LEVELS = [
  { id: 'p5-marqueur', label: 'P5 + marqueur « compte supprimé » (candidat actuel)', test: (t) => t.includes('deletedAccounts') && t.includes('accountLive') },
  { id: 'p5', label: 'P5 sans marqueur (espaces partagés)', test: (t) => /match \/modules\/\{moduleId\}/.test(t) },
  { id: 'p4', label: 'P4 (synchronisation des enregistrements)', test: (t) => t.includes('match /syncRecords/') },
  { id: 'v1-verrou', label: 'V1 + verrou d’effacement', test: (t) => t.includes('deletionLockedAt') && t.includes('match /spaces/{spaceId}') },
  { id: 'v1', label: 'V1 (profil, espace personnel, enregistrements)', test: (t) => t.includes('match /spaces/{spaceId}') },
];

/** Signes de règles OUVERTES (mode test, accès public) : jamais acceptables pour des données réelles. */
const OPEN_PATTERNS = [
  { re: /allow\s+read\s*,\s*write\s*:\s*if\s+true\s*;/, why: 'lecture et écriture ouvertes à tous (« if true »)' },
  { re: /allow\s+(read|write|get|list|create|update|delete)[^:;]*:\s*if\s+true\s*;/, why: 'une règle est ouverte à tous (« if true »)' },
  { re: /request\.time\s*<\s*timestamp\.date\(/, why: 'règles en « mode test » à expiration (accès ouvert jusqu’à une date)' },
];

function analyse(activeText, candidateText) {
  const active = normalize(activeText);
  const candidate = normalize(candidateText);
  const level = LEVELS.find((l) => l.test(active)) ?? { id: 'inconnu', label: 'non reconnu (ni V1, ni P4, ni P5)' };
  const open = OPEN_PATTERNS.filter((p) => p.re.test(active)).map((p) => p.why);
  const count = (text) => {
    const map = new Map();
    for (const line of text.split('\n').map((l) => l.trim()).filter((l) => l !== '')) map.set(line, (map.get(line) ?? 0) + 1);
    return map;
  };
  const a = count(active);
  const c = count(candidate);
  const onlyIn = (from, other) => {
    const out = [];
    for (const [line, n] of from) {
      const extra = n - (other.get(line) ?? 0);
      for (let i = 0; i < extra; i += 1) out.push(line);
    }
    return out;
  };
  const addedByCandidate = onlyIn(c, a);
  const onlyInActive = onlyIn(a, c);
  return {
    identical: sha256(active) === sha256(candidate),
    activeSha256: sha256(active),
    candidateSha256: sha256(candidate),
    level,
    open,
    addedByCandidate,
    onlyInActive,
    structure: analyseStructure(active, candidate),
    functions: analyseFunctions(active, candidate),
    completeness: completeness(active),
    commentsOnly: (lines) => lines.every((l) => l.startsWith('//')),
  };
}

module.exports = { analyse, LEVELS, OPEN_PATTERNS, CANDIDATE };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage : node scripts/firebase-rules/compare.js <fichier-des-règles-actives>');
    process.exit(2);
  }
  let activeText;
  try {
    activeText = fs.readFileSync(path.resolve(file), 'utf8');
  } catch {
    console.error('fichier illisible : copiez le texte de l’onglet Règles dans un fichier hors dépôt, puis relancez.');
    process.exit(2);
  }
  const result = analyse(activeText, fs.readFileSync(path.join(root, CANDIDATE), 'utf8'));
  console.log(`règles actives : SHA-256 ${result.activeSha256}`);
  console.log(`candidat       : SHA-256 ${result.candidateSha256} (${CANDIDATE})`);
  console.log(`niveau détecté des règles actives : ${result.level.label}`);
  if (!result.completeness.complete) {
    console.log('TEXTE INCOMPLET — la comparaison ne serait pas fiable :');
    for (const problem of result.completeness.problems) console.log(`  - ${problem}`);
    console.log('Recopiez TOUT le contenu de l’onglet Règles (Ctrl+A puis Ctrl+C dans l’éditeur) et relancez.');
    process.exit(2);
  }
  console.log(`texte complet : ${result.completeness.statementCount} instruction(s) « allow » reconnue(s).`);
  if (result.open.length > 0) {
    console.log('ALERTE — règles OUVERTES :');
    for (const why of result.open) console.log(`  - ${why}`);
  }
  if (result.identical) {
    console.log('IDENTIQUE au candidat : rien à publier.');
    process.exit(0);
  }
  const st = result.structure;
  console.log(`
ANALYSE STRUCTURELLE (instruction par instruction) : ${st.identical} identique(s), ${st.added.length} nouvelle(s), ${st.stricter.length} plus stricte(s), ${st.permissive.length} PLUS PERMISSIVE(S), ${st.modified.length} modifiée(s), ${st.removed.length} retirée(s).`);
  const list = (title, items, detail) => {
    if (items.length === 0) return;
    console.log(`
${title} :`);
    for (const item of items) console.log(`  - ${item.path} [${item.methods}]${detail ? ' ' + detail(item) : ''}`);
  };
  list('PLUS PERMISSIVES (un accès s’élargit : à examiner en priorité)', st.permissive, (i) => `conditions retirées : ${i.removedConditions.join(' ; ').slice(0, 140)}`);
  list('Modifiées (conditions ajoutées ET retirées : à examiner)', st.modified, (i) => `+ ${i.addedConditions.join(' ; ').slice(0, 80)} / − ${i.removedConditions.join(' ; ').slice(0, 80)}`);
  list('RETIRÉES par la publication (un accès disparaît : risque de verrouillage)', st.removed);
  list('Plus strictes (conditions ajoutées)', st.stricter, (i) => `+ ${i.addedConditions.join(' ; ').slice(0, 100)}`);
  list('Nouvelles (accès nouveaux : à lire attentivement)', st.added);
  const fn = result.functions;
  console.log(`\nFONCTIONS D'AIDE (appelées par les conditions) : ${fn.identical} identique(s), ${fn.added.length} nouvelle(s), ${fn.modified.length} MODIFIÉE(S), ${fn.removed.length} retirée(s).`);
  for (const m of fn.modified) {
    if (m.listAdded || m.listRemoved) console.log(`  - MODIFIÉE ${m.name} : ajoute [${(m.listAdded ?? []).join(', ')}] ; retire [${(m.listRemoved ?? []).join(', ')}]`);
    else console.log(`  - MODIFIÉE ${m.name} : avant « ${m.before} » ; après « ${m.after} »`);
  }
  for (const r of fn.removed) console.log(`  - RETIRÉE ${r.name}`);
  console.log('LIMITE : cet outil compare des instructions et des fonctions ; il ne PROUVE PAS la sémantique de sécurité. Une fonction modifiée ou nouvelle se relit à la main ; la preuve de comportement vient des suites d’émulateur et des tests réels.');
  if (st.lockRisks.length > 0) console.log(`
Risques de verrouillage à connaître (${st.lockRisks.length}) : voir les listes ci-dessus ; une règle plus stricte refuse ce qui passait avant.`);
  console.log(`
DIFFÉRENT : le candidat ajoute ${result.addedByCandidate.length} ligne(s) et retire ${result.onlyInActive.length} ligne(s) des règles actives.`);
  const show = (title, lines) => {
    if (lines.length === 0) return;
    console.log(`\n${title} (${lines.length}) :`);
    for (const line of lines.slice(0, 40)) console.log(`  ${line.slice(0, 150)}`);
    if (lines.length > 40) console.log(`  … ${lines.length - 40} autre(s)`);
  };
  show('Présentes SEULEMENT dans les règles actives (seraient retirées par la publication — à examiner avec soin)', result.onlyInActive);
  show('Ajoutées par le candidat (hors commentaires et accolades seules)', result.addedByCandidate.filter((l) => !l.startsWith('//') && l.length > 2));
  process.exit(result.open.length > 0 ? 2 : 1);
}
