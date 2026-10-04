// Données de démonstration Immobilier — strictement opt-in (bouton explicite
// sur la liste des biens), jamais créées automatiquement. Construites avec les
// mêmes fonctions que les actions de l'utilisateur (createBien, createLogement,
// createLocataireEtContrat) : ce sont de vrais biens, persistés, supprimables
// via la suppression normale d'un bien. Le suffixe « (démo) » dans les noms les
// distingue sans ambiguïté des données réelles. Aucun paiement n'est inventé.

import { createBien, createLocataireEtContrat, createLogement } from './immobilierService';

export const DEMO_SUFFIX = ' (démo)';

interface DemoLogement {
  nom: string;
  type: string;
  loyer: number;
  locataire?: { nom: string; telephone: string };
}

const DEMO_BIENS: { nom: string; adresse: string; type: string; logements: DemoLogement[] }[] = [
  {
    nom: 'Maison Agoè',
    adresse: 'Agoè, Lomé',
    type: 'Maison',
    logements: [
      { nom: 'Chambre 1', type: 'Chambre simple', loyer: 25000, locataire: { nom: 'Koffi Mensah', telephone: '+228 90 00 00 01' } },
      { nom: 'Chambre 2', type: 'Chambre + Salon', loyer: 30000, locataire: { nom: 'Ama Dossou', telephone: '+228 90 00 00 02' } },
      { nom: 'Chambre 3', type: 'Chambre simple', loyer: 25000 },
      { nom: 'Appartement A', type: 'Appartement', loyer: 75000, locataire: { nom: 'Yao Kossi', telephone: '+228 90 00 00 03' } },
    ],
  },
  {
    nom: 'Maison Bè',
    adresse: 'Bè, Lomé',
    type: 'Maison',
    logements: [
      { nom: 'Chambre A', type: 'Chambre simple', loyer: 20000, locataire: { nom: 'Sena Afi', telephone: '+228 90 00 00 04' } },
      { nom: 'Chambre B', type: 'Chambre simple', loyer: 20000 },
    ],
  },
];

/** Crée les 2 biens de démonstration ; retourne l'ID du premier (pour l'ouvrir). */
export async function seedDemoImmobilier(): Promise<string> {
  let firstBienId = '';
  for (const demo of DEMO_BIENS) {
    const bien = await createBien({ nom: `${demo.nom}${DEMO_SUFFIX}`, adresse: demo.adresse, type: demo.type });
    if (!firstBienId) firstBienId = bien.id;
    for (const l of demo.logements) {
      const logement = await createLogement({ bienId: bien.id, nom: l.nom, type: l.type, cuisine: 'Cuisine externe', wc: 'WC externe', loyerReference: l.loyer });
      if (l.locataire) {
        await createLocataireEtContrat({
          bienId: bien.id,
          logementId: logement.id,
          nom: l.locataire.nom,
          telephone: l.locataire.telephone,
          loyerMensuel: l.loyer,
          dateEntree: new Date(),
        });
      }
    }
  }
  return firstBienId;
}
