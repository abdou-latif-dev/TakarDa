// Immobilier et Activités : libellés, entrées retirées, nouvelles entrées, routes joignables, dialogues TakarDa.

import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const walk = (d: string): string[] =>
  fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${d}/${e.name}`] : []));

describe('Immobilier — entrées', () => {
  it('« Dépense » n’est plus proposée : ni section, ni bouton, ni entrée de personnalisation (code et données conservés)', () => {
    const bien = read('features/immobilier/screens/BienDetailScreen.tsx');
    expect(bien).not.toMatch(/Dépenses|depense-new|Total dépenses/);
    expect(read('features/immobilier/screens/ImmobilierFormsScreen.tsx')).toContain('setEntities([bien, logement, contrat, paiement])');
    for (const file of walk('features').filter((f) => !f.includes('DepenseFormScreen'))) {
      expect(read(file)).not.toContain('/depense-new');
    }
    // conservés : route, écran, service, entité
    expect(exists('app/immobilier/[bienId]/depense-new.tsx')).toBe(true);
    expect(exists('features/immobilier/screens/DepenseFormScreen.tsx')).toBe(true);
    expect(read('services/immobilierService.ts')).toContain("const DEPENSE_KEY = 'depense'");
  });

  it('« Voir le contrat » devient « Infos » (même destination : la fiche du locataire et de son contrat)', () => {
    const logement = read('features/immobilier/screens/LogementDetailScreen.tsx');
    expect(logement).not.toContain('Voir le contrat');
    expect(logement).toMatch(/label="Infos"[\s\S]*?router\.push\(`\/immobilier\/contrat\//);
    expect(exists('app/immobilier/contrat/[contratId].tsx')).toBe(true);
  });

  it('« Rapport » est à côté d’Historique et Statistiques et mène à un écran qui existe', () => {
    const list = read('features/immobilier/screens/BiensListScreen.tsx');
    expect(list).toContain('label="Historique"');
    expect(list).toContain('label="Statistiques"');
    expect(list).toContain('label="Rapport"');
    expect(list).toContain('/immobilier/rapport');
    expect(exists('app/immobilier/rapport.tsx')).toBe(true);
    const report = read('services/immobilierReportService.ts');
    expect(report).not.toMatch(/updateRecord|createRecord|deleteRecord/); // consultation seulement
  });

  it('chaque route Immobilier citée dans le code existe (aucun bouton vers un écran cassé)', () => {
    const files = [...walk('features/immobilier'), ...walk('components/immobilier'), ...walk('features/tools'), ...walk('features/activity')];
    const routes = new Set<string>();
    for (const file of files) {
      for (const m of read(file).matchAll(/['"`](\/immobilier\/[a-z-]+)['"`]/g)) routes.add(m[1]);
    }
    expect(routes.size).toBeGreaterThan(3);
    for (const route of routes) {
      const base = `app${route}`;
      expect(exists(`${base}.tsx`) || exists(`${base}/index.tsx`)).toBe(true);
    }
  });
});

describe('Immobilier — jour de paiement, avance et caution', () => {
  it('le libellé du jour est compréhensible et honnête (indicatif, retard après le mois écoulé)', () => {
    for (const file of ['features/immobilier/screens/ContratFormScreen.tsx', 'features/immobilier/screens/ContratDetailScreen.tsx']) {
      const src = read(file);
      expect(src).toContain('Jour de paiement du loyer');
      expect(src).not.toMatch(/Jour d['’]échéance/);
      expect(src).toContain('en retard une fois le mois écoulé');
    }
  });

  it('avance et caution se saisissent en mois ou en montant, avec le total à l’entrée', () => {
    const form = read('features/immobilier/screens/ContratFormScreen.tsx');
    expect(form).toContain('<MonthsAmountField label="Avance"');
    expect(form).toContain('<MonthsAmountField label="Caution"');
    expect(form).toContain('Total à l’entrée (avance + caution)');
    const field = read('components/immobilier/MonthsAmountField.tsx');
    expect(field).toContain('En mois');
    expect(field).toContain('En montant');
    // le parent ne reçoit qu'un montant entier : aucun champ « mois » n'est enregistré
    expect(read('services/immobilierService.ts')).not.toMatch(/avance_mois|caution_mois/);
  });

  it('l’avance automatique est désactivée par défaut et demande une confirmation', () => {
    const service = read('services/immobilierService.ts');
    expect(service).toContain('avance: input.avance ?? null');
    expect(service).not.toContain('avance_utilisable: true');
    const card = read('components/immobilier/AdvanceCard.tsx');
    expect(card).toContain('Utiliser automatiquement l’avance pour les loyers futurs');
    expect(card).toContain('<Dialog');
    expect(card).toContain('La caution n’est jamais touchée');
  });
});

describe('Dialogues TakarDa et Activités', () => {
  it('le dialogue partagé a coins arrondis, marges, défilement et clavier ; le reçu l’utilise (pas d’Alert natif)', () => {
    const dialog = read('components/ui/Dialog.tsx');
    expect(dialog).toContain('rounded-xl');
    expect(dialog).toContain('ScrollView');
    expect(dialog).toContain('KeyboardAvoidingView');
    expect(dialog).toContain('onRequestClose');
    const section = read('components/immobilier/PaiementsSection.tsx');
    expect(section).toContain('<Dialog');
    expect(section).toContain('Partager le reçu');
    expect(section).toContain('buildRentReceiptText');
  });

  it('Activités : une carte par événement, plus de grande plaque bordée', () => {
    const screen = read('features/activity/screens/ActivityScreen.tsx');
    expect(screen).toContain('variant="card"');
    expect(screen).not.toContain('border border-border bg-surface p-gutter-card shadow-soft');
    const item = read('components/ui/ActivityItem.tsx');
    expect(item).toContain("variant === 'card'");
    expect(item).toContain('rounded-xl bg-surface p-4 shadow-soft');
  });
});
