// Reçu de paiement de loyer partageable : contenu, référence stable, rien d'inventé, aucune modification.

import { coreService } from '../coreService';
import { createBien, createLocataireEtContrat, enregistrerPaiementLoyer, ensureImmobilierTool } from '../immobilierService';
import { arrearsAtPayment, buildRentReceiptText, receiptReference } from '../rentReceiptService';
import type { RecordItem } from '@/types/entities';

// jest.mock est remonté avant les imports par babel-jest.
jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

async function setup(dernierLoyerPaye: string) {
  const bien = await createBien({ nom: 'Maison Agoè', adresse: 'Lomé' });
  const { contrat } = await createLocataireEtContrat({
    bienId: bien.id,
    nouveauLogement: { nom: 'Chambre 2' },
    nom: 'Ama Dossou',
    telephone: '90123456',
    loyerMensuel: 25000,
    dateEntree: new Date(2026, 0, 5),
    dernierLoyerPaye,
  });
  return contrat;
}

const allPaiements = async (contratId: string): Promise<RecordItem[]> => {
  const ents = await ensureImmobilierTool();
  return (await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.paiement.id })).filter((p) => p.values.contrat === contratId);
};

describe('Reçu de paiement de loyer', () => {
  it('contient en-tête, titre, référence, propriétaire, bien, logement, locataire, montant, période, date, remerciement', async () => {
    const contrat = await setup('2026-09');
    const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
    await coreService.updateRecord(paiement.id, { values: { mode_paiement: 'Mobile Money' } });
    const fresh = (await coreService.getRecord(paiement.id))!;
    const text = buildRentReceiptText({
      paiement: fresh,
      contrat: (await coreService.getRecord(contrat.id))!,
      paiementsDuContrat: await allPaiements(contrat.id),
      locataireNom: 'Ama Dossou',
      logementNom: 'Chambre 2',
      bienNom: 'Maison Agoè',
      bailleurNom: 'Awa Kossi',
    });
    expect(text).toContain('TakarDa');
    expect(text).toContain('Reçu de paiement de loyer');
    expect(text).toContain(`Référence : ${receiptReference(paiement.id)}`);
    expect(text).toContain('Propriétaire : Awa Kossi');
    expect(text).toContain('Locataire : Ama Dossou');
    expect(text).toContain('Bien : Maison Agoè');
    expect(text).toContain('Logement : Chambre 2');
    expect(text).toContain('Période : octobre 2026');
    expect(text).toContain('Date du paiement : 12/10/2026');
    expect(text).toContain('Mode de paiement : Mobile Money');
    expect(text.replace(/\s/g, ' ')).toMatch(/Montant payé : 25.000 FCFA/);
    expect(text).toContain('Aucun loyer en retard à cette date');
    expect(text).toContain('Merci pour votre paiement');
    for (const emoji of ['🏠', '👤', '💰', '📅', '✅']) expect(text).toContain(emoji);
  });

  it('une information absente n’est ni affichée ni inventée', async () => {
    const contrat = await setup('2026-09');
    const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
    const text = buildRentReceiptText({ paiement, contrat, paiementsDuContrat: [paiement] });
    expect(text).not.toMatch(/Propriétaire|Locataire|Bien :|Logement :|Mode de paiement/);
    expect(text).toContain('Période : octobre 2026');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  it('la référence est stable : même paiement, même référence, à chaque ouverture ou partage', async () => {
    const contrat = await setup('2026-09');
    const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
    const first = buildRentReceiptText({ paiement, contrat, paiementsDuContrat: [paiement] });
    const again = buildRentReceiptText({ paiement, contrat, paiementsDuContrat: [paiement] });
    expect(again).toBe(first);
    expect(receiptReference(paiement.id)).toBe(receiptReference(paiement.id));
    expect(receiptReference(paiement.id)).toMatch(/^TKD-[A-Z0-9]{8}$/);
    const other = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 10, 3));
    expect(receiptReference(other.id)).not.toBe(receiptReference(paiement.id));
  });

  it('générer le reçu ne modifie ni le paiement ni le contrat', async () => {
    const contrat = await setup('2026-09');
    const paiement = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
    const before = JSON.stringify([await coreService.getRecord(paiement.id), await coreService.getRecord(contrat.id)]);
    buildRentReceiptText({ paiement, contrat, paiementsDuContrat: await allPaiements(contrat.id), locataireNom: 'Ama Dossou' });
    expect(JSON.stringify([await coreService.getRecord(paiement.id), await coreService.getRecord(contrat.id)])).toBe(before);
  });

  it('situation à la date du paiement : les retards sont comptés sans regarder les paiements postérieurs', async () => {
    const contrat = await setup('2026-07'); // août et septembre impayés avant octobre
    const october = await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12)); // premier mois dû : août
    expect(october.values.mois).toBe('2026-08');
    const ps1 = await allPaiements(contrat.id);
    const arrearsThen = arrearsAtPayment(contrat, october, ps1);
    expect(arrearsThen).toBe(1); // septembre encore impayé à cette date
    await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 13)); // septembre payé ensuite
    const ps2 = await allPaiements(contrat.id);
    expect(arrearsAtPayment(contrat, october, ps2)).toBe(1); // le reçu d’août ne change pas
    const text = buildRentReceiptText({ paiement: october, contrat, paiementsDuContrat: ps2 });
    expect(text).toContain('Loyers en retard à cette date : 1 mois');
  });
});
