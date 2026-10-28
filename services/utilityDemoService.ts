// Données de démonstration CEET / TDE : participants, relevés d'index de deux périodes, UNE facture répartie par compteur et deux parts payées sur trois, pour chaque fournisseur.
// Construites avec les MÊMES services que les écrans (addParticipant, saveRelevesPeriode, createFacturePartagee, validerFactureParCompteur, enregistrerPaiementPart) : la répartition,
// les consommations et les statistiques sont calculées par le moteur de l'application, jamais écrites à la main. Périodes RELATIVES à aujourd'hui (rien n'est codé en dur).
// Réservé à l'espace de démonstration : refuse de s'exécuter ailleurs, donc ne peut jamais écrire dans les données personnelles.
// Noms suffixés « (démo) » ; numéros « +228 90 00 00 xx » manifestement fictifs.

import { ensureFacturesToolCached } from './facturesService';
import { isDemoWorkspace } from './persistence';
import { createFacturePartagee, enregistrerPaiementPart, validerFactureParCompteur } from './utilityBillingService';
import { addParticipant, saveRelevesPeriode, type UtilityModule } from './utilityParticipantsService';

const DEMO_PEOPLE = [
  { name: 'Edem Amegah (démo)', phone: '+228 90 00 00 21' },
  { name: 'Akossiwa Tevi (démo)', phone: '+228 90 00 00 22' },
  { name: 'Kokou Lawson (démo)', phone: '+228 90 00 00 23' },
];

interface FournisseurSpec {
  module: UtilityModule;
  /** Index du premier compteur (les suivants s'écartent de 40) et progression par période. */
  base: number;
  step: number;
  /** Montant total de la facture répartie. */
  montant: number;
}
const SPECS: FournisseurSpec[] = [
  { module: 'ceet', base: 1200, step: 85, montant: 54000 },
  { module: 'tde', base: 85, step: 9, montant: 18000 },
];

const periode = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export async function seedDemoUtilities(now: Date = new Date()): Promise<void> {
  if (!isDemoWorkspace()) throw new Error('Les exemples CEET/TDE ne se créent que dans l’espace de démonstration.');
  const monthsAgo = (n: number, day = 1) => new Date(now.getFullYear(), now.getMonth() - n, day);
  const ents = await ensureFacturesToolCached();
  for (const spec of SPECS) {
    const people = [];
    for (const person of DEMO_PEOPLE) people.push(await addParticipant(spec.module, person));
    // relevés des deux dernières périodes entièrement écoulées
    for (const [progress, back] of [[0, 2], [1, 1]] as const) {
      await saveRelevesPeriode({
        fournisseur: spec.module,
        periode: periode(monthsAgo(back)),
        entries: people.map((p, i) => ({ participationId: p.record.id, index: spec.base + i * 40 + progress * spec.step })),
      });
    }
    // facture de la dernière période, répartie par compteur (le moteur calcule consommations et parts), puis deux parts payées sur trois
    const facture = await createFacturePartagee({
      toolId: ents.tool.id,
      facturePartageeEntityDefinitionId: ents.facturePartageeDefinition.id,
      values: { fournisseur: spec.module, montant_total: spec.montant, mois: periode(monthsAgo(1)) },
    });
    const parts = await validerFactureParCompteur({
      toolId: ents.tool.id,
      releveEntityDefinitionId: ents.releveDefinition.id,
      partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
      facturePartageeId: facture.id,
      participants: people.map((p) => p.participant),
    });
    for (const part of parts.slice(0, 2)) await enregistrerPaiementPart(part.id, now);
  }
}
