// Espace de démonstration : des exemples clairement séparés des données personnelles.
//
// Les exemples vivent dans un espace de stockage distinct (voir services/persistence.ts, switchWorkspace) : entrer ou sortir ne
// supprime, ne migre et n'écrase aucune donnée personnelle. À la première entrée, l'espace est rempli avec les exemples existants
// (biens « (démo) » et tontine de démonstration), puis l'utilisateur peut tout créer et modifier librement ; ses essais restent
// dans l'espace de démonstration.

import { flushDb, isDemoWorkspace, personalWorkspaceHasData, switchWorkspace } from './persistence';
import { groups, records } from './db';
import { resetFacturesToolCache } from './facturesService';
import { resetImmobilierToolCache } from './immobilierService';
import { seedDemoImmobilier } from './immobilierDemoService';
import { seedDemoTontine } from './tontineDemoService';
import { seedDemoUtilities } from './utilityDemoService';
import { seedDemoForms } from './formDemoService';

export { isDemoWorkspace, personalWorkspaceHasData };

/** Entre dans l'espace de démonstration. `seeded` : les exemples ont été créés (espace de démonstration vide jusque-là). */
export async function enterDemo(): Promise<{ seeded: boolean }> {
  if (isDemoWorkspace()) return { seeded: false };
  await switchWorkspace('demo');
  resetImmobilierToolCache();
  resetFacturesToolCache(); // les définitions Factures de l'espace précédent ne doivent jamais servir dans celui-ci
  if (records.length > 0 || groups.length > 0) return { seeded: false }; // exemples et essais déjà présents : on les retrouve
  let seeded = false;
  try {
    // Exemples COMPLETS et cohérents (historique de loyers, retards, relevés CEET/TDE, formulaire) : dates relatives à aujourd'hui, noms « (démo) », coordonnées fictives.
    // Tout est créé dans l'espace de démonstration (switchWorkspace('demo') ci-dessus) : jamais dans l'espace personnel, jamais envoyé nulle part.
    await seedDemoImmobilier({ history: true });
    await seedDemoTontine({ relativeDates: true });
    await seedDemoUtilities();
    await seedDemoForms();
    seeded = true;
  } catch {
    // exemples partiels : l'espace de démonstration reste utilisable ; l'utilisateur peut créer les siens
  }
  await flushDb();
  return { seeded };
}

/**
 * Découverte : à la toute première utilisation, SANS aucun travail personnel, l'exploration commence dans l'espace de
 * démonstration (isolé). S'il existe la moindre donnée personnelle, rien ne change : aucune entrée automatique, aucune donnée touchée.
 * Retourne vrai si l'on est (ou si l'on vient d'entrer) dans la démonstration.
 */
export async function enterDemoIfFreshInstall(): Promise<boolean> {
  if (isDemoWorkspace()) return true;
  if (await personalWorkspaceHasData()) return false;
  await enterDemo();
  return true;
}

/** Quitte l'espace de démonstration et retrouve les données personnelles, intactes. Les exemples restent dans leur espace. */
export async function exitDemo(): Promise<void> {
  if (!isDemoWorkspace()) return;
  await switchWorkspace('personal');
  resetImmobilierToolCache();
  resetFacturesToolCache();
}
