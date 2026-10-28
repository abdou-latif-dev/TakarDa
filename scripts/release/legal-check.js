/* global __dirname */
// Contrôle de PRÊT-À-PUBLIER des documents légaux (F6). Local : lit des fichiers, n'écrit rien, ne contacte aucun service.
//
//   node scripts/release/legal-check.js     liste ce qui reste à fournir ; code 0 seulement si tout est prêt, 1 sinon
//
// Prêt = (1) plus aucun élément « [… À FOURNIR / À DÉCIDER / À VÉRIFIER / À CONFIRMER / À DÉFINIR …] » dans le TEXTE PUBLIÉ (partie 1) de la politique de confidentialité et de
// la page de suppression ; (2) les deux adresses publiques de `constants/legalLinks.ts` sont de vraies adresses https. L'ouverture des comptes (CLOUD_ACCOUNT_ENABLED) l'exige.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const DOCS = ['docs/confidentialite/politique-de-confidentialite-BROUILLON.md', 'docs/confidentialite/page-suppression-de-compte-BROUILLON.md'];
const MARKER = /\[[^\]\n]*(?:À FOURNIR|À DÉCIDER|À VÉRIFIER|À CONFIRMER|À DÉFINIR)[^\]\n]*\]/g;
const PLACEHOLDER_HOSTS = /(^|\.)(example\.(com|org|net)|localhost|test|invalid|local)$/i;

/** Le texte destiné à être publié : de la partie 1 (incluse) jusqu'à la partie 2 (exclue). Les parties suivantes sont des notes internes. */
function publishedPart(text) {
  const start = text.indexOf('## PARTIE 1');
  const end = text.indexOf('## PARTIE 2');
  return start === -1 ? text : text.slice(start, end === -1 ? undefined : end);
}

function unresolvedMarkers(text) {
  const counts = new Map();
  for (const marker of publishedPart(text).match(MARKER) ?? []) counts.set(marker, (counts.get(marker) ?? 0) + 1);
  return [...counts.entries()].map(([marker, count]) => ({ marker, count }));
}

function isPublicHttps(value) {
  if (typeof value !== 'string') return false;
  const match = /^https:\/\/([^/?#:@\s]+)(:\d+)?(\/[^\s]*)?$/i.exec(value);
  return !!match && match[1].includes('.') && !PLACEHOLDER_HOSTS.test(match[1]) && !/^\d+(\.\d+){3}$/.test(match[1]);
}

function configuredUrl(source, name) {
  const match = new RegExp(name + ': string [|] null = (null|\'[^\']*\'|"[^"]*");').exec(source);
  return match && match[1] !== 'null' ? match[1].slice(1, -1) : null;
}

function legalReadiness(read = (file) => fs.readFileSync(path.join(root, file), 'utf8')) {
  const markers = DOCS.map((file) => ({ file, items: unresolvedMarkers(read(file)) }));
  const links = read('constants/legalLinks.ts');
  const privacy = configuredUrl(links, 'PRIVACY_POLICY_URL');
  const deletion = configuredUrl(links, 'ACCOUNT_DELETION_URL');
  const urls = { privacy: isPublicHttps(privacy), accountDeletion: isPublicHttps(deletion) };
  const ready = markers.every((m) => m.items.length === 0) && urls.privacy && urls.accountDeletion;
  return { ready, markers, urls };
}

module.exports = { DOCS, legalReadiness, unresolvedMarkers, publishedPart, isPublicHttps, configuredUrl };

if (require.main === module) {
  const result = legalReadiness();
  for (const { file, items } of result.markers) {
    console.log(`${file} : ${items.length === 0 ? 'rien à fournir' : `${items.reduce((n, i) => n + i.count, 0)} élément(s) à fournir`}`);
    for (const { marker, count } of items) console.log(`   ${count} × ${marker}`);
  }
  console.log(`adresse de la politique de confidentialité : ${result.urls.privacy ? 'renseignée' : 'À RENSEIGNER (constants/legalLinks.ts)'}`);
  console.log(`adresse de la page de suppression de compte : ${result.urls.accountDeletion ? 'renseignée' : 'À RENSEIGNER (constants/legalLinks.ts)'}`);
  console.log(result.ready ? 'PRÊT : les documents légaux peuvent être publiés.' : 'NON PRÊT : l’ouverture des comptes reste bloquée.');
  process.exit(result.ready ? 0 : 1);
}
