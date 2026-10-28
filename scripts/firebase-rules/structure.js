// Analyse STRUCTURELLE de deux fichiers de règles Firestore : instruction par instruction (`allow`), située par son chemin de `match`. Local : aucun réseau, aucune écriture.
//
// Classe chaque différence entre les règles ACTIVES et le CANDIDAT :
//   - nouvelle      : instruction présente seulement dans le candidat (accès NOUVEAU : à lire attentivement) ;
//   - plus stricte  : mêmes chemin et opérations, le candidat ajoute des conditions ;
//   - plus permissive : le candidat RETIRE des conditions (alerte : un accès s'élargit) ;
//   - modifiée      : conditions ajoutées ET retirées (à examiner à la main) ;
//   - retirée       : instruction présente seulement dans les règles actives (un accès disparaît : risque de verrouillage).
// Heuristique : les conditions sont découpées en conjonctions de premier niveau (`&&`) ; une condition qui contient un `||` de premier niveau est comparée comme un bloc. L'analyse aide à relire ;
// l'empreinte SHA-256 reste le seul verdict d'identité, et la relecture humaine des cas « nouvelle » et « modifiée » reste nécessaire.
//
// LIMITE IMPORTANTE : les conditions des `allow` appellent des FONCTIONS d'aide (syncKinds, validSyncShape, isOwner, moduleOpen…). Comparer seulement les `allow` ne verrait pas un changement
// DANS une fonction. `analyseFunctions` compare donc aussi le corps de chaque fonction (par chemin de `match` et nom) et, pour une fonction qui renvoie une liste, les éléments ajoutés et retirés.
// Même ainsi, l'outil ne PROUVE PAS la sémantique de sécurité (il ne sait pas ce qu'une fonction autorise) : c'est une aide à la relecture. La preuve de comportement vient des suites d'émulateur et des tests réels.

/** Instructions `allow` avec leur chemin de `match` complet. Les commentaires `//` sont ignorés. */
function statements(text) {
  const src = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const matchRe = /match\s+(\S+)\s*\{/y;
  const allowRe = /allow\s+([a-z, ]+?)\s*:\s*if\s+([^;]*);/y;
  const out = [];
  const stack = [];
  let depth = 0;
  let i = 0;
  while (i < src.length) {
    matchRe.lastIndex = i;
    const m = matchRe.exec(src);
    if (m) {
      depth += 1;
      stack.push({ path: m[1], depth });
      i = matchRe.lastIndex;
      continue;
    }
    allowRe.lastIndex = i;
    const a = allowRe.exec(src);
    if (a) {
      out.push({
        path: stack.map((s) => s.path).join(''),
        methods: a[1].split(',').map((x) => x.trim()).sort().join(', '),
        condition: a[2].replace(/\s+/g, ' ').trim(),
      });
      i = allowRe.lastIndex;
      continue;
    }
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      if (stack.length > 0 && stack[stack.length - 1].depth === depth) stack.pop();
      depth -= 1;
    }
    i += 1;
  }
  return out;
}

/** Conjonctions de premier niveau d'une condition ; un `||` de premier niveau fait de la condition un bloc unique. */
function conjuncts(condition) {
  const parts = [];
  let depth = 0;
  let current = '';
  let hasTopLevelOr = false;
  for (let i = 0; i < condition.length; i += 1) {
    const ch = condition[i];
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && condition.startsWith('||', i)) hasTopLevelOr = true;
    if (depth === 0 && condition.startsWith('&&', i)) {
      parts.push(current.trim());
      current = '';
      i += 1;
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return hasTopLevelOr ? [condition] : parts.filter((p) => p !== '');
}

const keyOf = (s) => `${s.path} | ${s.methods}`;

function group(list) {
  const map = new Map();
  for (const s of list) {
    const key = keyOf(s);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return map;
}

const shortPath = (p) => p.replace('/databases/{database}/documents', '') || '/';

function analyseStructure(activeText, candidateText) {
  const active = group(statements(activeText));
  const candidate = group(statements(candidateText));
  const result = { identical: 0, added: [], removed: [], stricter: [], permissive: [], modified: [] };
  const describe = (s) => ({ path: shortPath(s.path), methods: s.methods });
  for (const [key, cs] of candidate) {
    const as = active.get(key);
    if (!as) {
      for (const c of cs) result.added.push({ ...describe(c), condition: c.condition });
      continue;
    }
    cs.forEach((c, index) => {
      const a = as[index];
      if (!a) {
        result.added.push({ ...describe(c), condition: c.condition });
        return;
      }
      const ca = conjuncts(a.condition);
      const cc = conjuncts(c.condition);
      const addedAtoms = cc.filter((x) => !ca.includes(x));
      const removedAtoms = ca.filter((x) => !cc.includes(x));
      if (addedAtoms.length === 0 && removedAtoms.length === 0) result.identical += 1;
      else if (removedAtoms.length === 0) result.stricter.push({ ...describe(c), addedConditions: addedAtoms });
      else if (addedAtoms.length === 0) result.permissive.push({ ...describe(c), removedConditions: removedAtoms });
      else result.modified.push({ ...describe(c), addedConditions: addedAtoms, removedConditions: removedAtoms });
    });
    as.slice(cs.length).forEach((a) => result.removed.push({ ...describe(a), condition: a.condition }));
  }
  for (const [key, as] of active) {
    if (!candidate.has(key)) for (const a of as) result.removed.push({ ...describe(a), condition: a.condition });
  }
  // risques de verrouillage : un accès retiré, ou une condition qui peut refuser un usage qui passait
  result.lockRisks = [
    ...result.removed.map((r) => ({ ...r, why: 'instruction retirée : un accès actuel disparaît' })),
    ...result.stricter.map((r) => ({ path: r.path, methods: r.methods, why: `conditions ajoutées : ${r.addedConditions.join(' ; ').slice(0, 120)}` })),
    ...result.modified.map((r) => ({ path: r.path, methods: r.methods, why: 'conditions modifiées : à examiner' })),
  ];
  return result;
}

/** Fonctions `function nom(args) { … }` avec leur chemin de `match` et leur corps normalisé (accolades appariées, commentaires ignorés). */
function functions(text) {
  const src = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const matchRe = /match\s+(\S+)\s*\{/y;
  const fnRe = /function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*\{/y;
  const out = [];
  const stack = [];
  let depth = 0;
  let i = 0;
  while (i < src.length) {
    matchRe.lastIndex = i;
    const m = matchRe.exec(src);
    if (m) {
      depth += 1;
      stack.push({ path: m[1], depth });
      i = matchRe.lastIndex;
      continue;
    }
    fnRe.lastIndex = i;
    const f = fnRe.exec(src);
    if (f) {
      let level = 1;
      let j = fnRe.lastIndex;
      while (j < src.length && level > 0) {
        if (src[j] === '{') level += 1;
        else if (src[j] === '}') level -= 1;
        j += 1;
      }
      out.push({ path: stack.map((x) => x.path).join(''), name: f[1], args: f[2].trim(), body: src.slice(fnRe.lastIndex, j - 1).replace(/\s+/g, ' ').trim() });
      i = j;
      continue;
    }
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      if (stack.length > 0 && stack[stack.length - 1].depth === depth) stack.pop();
      depth -= 1;
    }
    i += 1;
  }
  return out;
}

/** Éléments d'une fonction qui renvoie une liste littérale (`return ['a', 'b'];`), sinon null. */
function listItems(body) {
  const m = /^return\s*\[([^\]]*)\]\s*;?$/.exec(body);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
}

/** Compare les fonctions d'aide : nouvelles, retirées, modifiées (avec éléments de liste ajoutés/retirés quand c'est une liste). */
function analyseFunctions(activeText, candidateText) {
  const key = (f) => `${shortPath(f.path)} :: ${f.name}`;
  const a = new Map(functions(activeText).map((f) => [key(f), f]));
  const c = new Map(functions(candidateText).map((f) => [key(f), f]));
  const result = { identical: 0, added: [], removed: [], modified: [] };
  for (const [k, cf] of c) {
    const af = a.get(k);
    if (!af) result.added.push({ name: k });
    else if (af.body === cf.body && af.args === cf.args) result.identical += 1;
    else {
      const before = listItems(af.body);
      const after = listItems(cf.body);
      const entry = { name: k };
      if (before && after) {
        entry.listAdded = after.filter((x) => !before.includes(x));
        entry.listRemoved = before.filter((x) => !after.includes(x));
      } else {
        entry.before = af.body.slice(0, 200);
        entry.after = cf.body.slice(0, 200);
      }
      result.modified.push(entry);
    }
  }
  for (const [k] of a) if (!c.has(k)) result.removed.push({ name: k });
  return result;
}

/** Le texte est-il un fichier de règles COMPLET ? (une copie de console tronquée donnerait une comparaison fausse) */
function completeness(text) {
  const t = text.replace(/\r\n/g, '\n');
  const problems = [];
  if (!/rules_version\s*=\s*['"]2['"]/.test(t)) problems.push('la ligne « rules_version = \'2\'; » est absente');
  if (!/service\s+cloud\.firestore\s*\{/.test(t)) problems.push('« service cloud.firestore { » est absent');
  if (!/match\s+\/databases\/\{database\}\/documents\s*\{/.test(t)) problems.push('« match /databases/{database}/documents { » est absent');
  let depth = 0;
  let minDepth = 0;
  for (const ch of t.replace(/\/\/.*$/gm, '')) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    minDepth = Math.min(minDepth, depth);
  }
  if (depth !== 0 || minDepth < 0) problems.push(`accolades non équilibrées (écart ${depth}) : le texte est probablement tronqué ou mal copié`);
  if (/^\s*(\.\.\.|…)\s*$/m.test(t)) problems.push('une ligne « ... » ou « … » indique une partie omise');
  if (!/match\s+\/\{document=\*\*\}\s*\{[^}]*allow\s+read\s*,\s*write\s*:\s*if\s+false/.test(t)) problems.push('le refus par défaut final (« match /{document=**} » … « if false ») est absent : fin du fichier manquante ?');
  if (statements(t).length === 0) problems.push('aucune instruction « allow » reconnue');
  return { complete: problems.length === 0, problems, statementCount: statements(t).length };
}

module.exports = { statements, conjuncts, analyseStructure, functions, analyseFunctions, completeness };
