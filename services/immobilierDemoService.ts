// Données de démonstration Immobilier. Deux modes, construits avec les MÊMES fonctions que les actions de l'utilisateur (createBien, createLogement, createLocataireEtContrat,
// enregistrerPaiementLoyer) : ce sont de vrais enregistrements, calculés par les mêmes règles que les écrans (aucune statistique n'est truquée).
//
//  - Mode par défaut (sans option) : 2 biens, des contrats d'aujourd'hui, AUCUN paiement inventé. Utilisé par le bouton de développement de la liste des biens et par les tests.
//  - Mode `history` (utilisé UNIQUEMENT à la création de l'espace de démonstration, voir demoWorkspace.ts) : 3 biens, des entrées de contrat à trois mois avant aujourd'hui, des
//    paiements réels et des retards, pour que statistiques, impayés, alertes et rapports soient cohérents. Les dates sont RELATIVES à aujourd'hui : rien n'est codé en dur.
//    Ce mode refuse de s'exécuter hors de l'espace de démonstration : il ne peut donc jamais écrire dans les données personnelles.
//
// Le suffixe « (démo) » distingue sans ambiguïté ces exemples des données réelles ; les numéros « +228 90 00 00 xx » sont manifestement fictifs.

import { isDemoWorkspace } from './persistence';
import { createBien, createLocataireEtContrat, createLogement, enregistrerPaiementLoyer } from './immobilierService';

export const DEMO_SUFFIX = ' (démo)';

export interface DemoImmobilierOptions {
  /** Entrées anciennes, paiements réels, retards, troisième bien. Réservé à l'espace de démonstration. */
  history?: boolean;
  /** Date de référence (tests) ; défaut : aujourd'hui. */
  now?: Date;
}

interface DemoLocataire {
  nom: string;
  telephone: string;
  /** Mode `history` : nombre de loyers payés depuis l'entrée (mois d'entrée, puis les suivants ; 4 = jusqu'au mois en cours inclus). */
  paye: number;
}
interface DemoLogement {
  nom: string;
  type: string;
  loyer: number;
  locataire?: DemoLocataire;
}
interface DemoBien {
  nom: string;
  adresse: string;
  type: string;
  logements: DemoLogement[];
}

const DEMO_BIENS: DemoBien[] = [
  {
    nom: 'Maison Agoè',
    adresse: 'Agoè, Lomé',
    type: 'Maison',
    logements: [
      { nom: 'Chambre 1', type: 'Chambre simple', loyer: 25000, locataire: { nom: 'Koffi Mensah', telephone: '+228 90 00 00 01', paye: 4 } },
      { nom: 'Chambre 2', type: 'Chambre + Salon', loyer: 30000, locataire: { nom: 'Ama Dossou', telephone: '+228 90 00 00 02', paye: 3 } },
      { nom: 'Chambre 3', type: 'Chambre simple', loyer: 25000 },
      { nom: 'Appartement A', type: 'Appartement', loyer: 75000, locataire: { nom: 'Yao Kossi', telephone: '+228 90 00 00 03', paye: 1 } },
    ],
  },
  {
    nom: 'Maison Bè',
    adresse: 'Bè, Lomé',
    type: 'Maison',
    logements: [
      { nom: 'Chambre A', type: 'Chambre simple', loyer: 20000, locataire: { nom: 'Sena Afi', telephone: '+228 90 00 00 04', paye: 2 } },
      { nom: 'Chambre B', type: 'Chambre simple', loyer: 20000 },
    ],
  },
];

/** Troisième bien, ajouté seulement en mode `history`. */
const DEMO_BIEN_HISTORY: DemoBien = {
  nom: 'Résidence Kodjoviakopé',
  adresse: 'Kodjoviakopé, Lomé',
  type: 'Immeuble',
  logements: [
    { nom: 'Appartement 1', type: 'Appartement', loyer: 35000, locataire: { nom: 'Edem Amegah', telephone: '+228 90 00 00 11', paye: 4 } },
    { nom: 'Appartement 2', type: 'Appartement', loyer: 28000, locataire: { nom: 'Akossiwa Tevi', telephone: '+228 90 00 00 12', paye: 3 } },
    { nom: 'Appartement 3', type: 'Appartement', loyer: 60000, locataire: { nom: 'Kokou Lawson', telephone: '+228 90 00 00 13', paye: 1 } },
    { nom: 'Appartement 4', type: 'Appartement', loyer: 22000, locataire: { nom: 'Mawuli Agbo', telephone: '+228 90 00 00 14', paye: 2 } },
  ],
};

/** Crée les biens de démonstration ; retourne l'ID du premier (pour l'ouvrir). */
export async function seedDemoImmobilier(options: DemoImmobilierOptions = {}): Promise<string> {
  const history = options.history === true;
  if (history && !isDemoWorkspace()) throw new Error('Les exemples complets ne se créent que dans l’espace de démonstration.');
  const now = options.now ?? new Date();
  const entree = history ? new Date(now.getFullYear(), now.getMonth() - 3, 1) : now;
  const biens = history ? [...DEMO_BIENS, DEMO_BIEN_HISTORY] : DEMO_BIENS;

  let firstBienId = '';
  for (const demo of biens) {
    const bien = await createBien({ nom: `${demo.nom}${DEMO_SUFFIX}`, adresse: demo.adresse, type: demo.type });
    if (!firstBienId) firstBienId = bien.id;
    for (const l of demo.logements) {
      const logement = await createLogement({ bienId: bien.id, nom: l.nom, type: l.type, cuisine: 'Cuisine externe', wc: 'WC externe', loyerReference: l.loyer });
      if (!l.locataire) continue;
      const { contrat } = await createLocataireEtContrat({
        bienId: bien.id,
        logementId: logement.id,
        nom: history ? `${l.locataire.nom}${DEMO_SUFFIX}` : l.locataire.nom,
        telephone: l.locataire.telephone,
        loyerMensuel: l.loyer,
        dateEntree: entree,
        ...(history ? { jourEcheance: 5, caution: l.loyer } : {}),
      });
      if (!history) continue; // mode par défaut : aucun paiement inventé
      // Paiements réels, dans l'ordre : chaque appel paie le premier mois dû non payé. Les mois écoulés sont datés du 6 ; le mois en cours, d'aujourd'hui (jamais une date future).
      for (let k = 0; k < l.locataire.paye; k += 1) {
        const offset = k - 3;
        await enregistrerPaiementLoyer(contrat.id, offset < 0 ? new Date(now.getFullYear(), now.getMonth() + offset, 6) : now);
      }
    }
  }
  return firstBienId;
}
