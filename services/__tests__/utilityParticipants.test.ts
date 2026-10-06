// Participants CEET/TDE (participation ≠ contact), saisie des index par période,
// vue d'une période.

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { coreService } from '../coreService';
import { records } from '../db';
import { hydrateDb, startAutoPersist } from '../persistence';
import { ensureFacturesTool, ensureFacturesToolCached } from '../facturesService';
import { createBien, createLocataireEtContrat, terminerContrat } from '../immobilierService';
import {
  buildReceiptData,
  computeRepartitionParCompteur,
  createFacturePartagee,
  deleteReleve,
  RELEVE_VERROUILLE_MESSAGE,
  UtilityBillingError,
  updateReleveIndex,
  validerFactureParCompteur,
  type Participant,
} from '../utilityBillingService';
import { friendlyMessage, parseIndexInput } from '@/features/utilities/errors';
import {
  addContratParticipant,
  addExistingContact,
  addParticipant,
  archiveParticipation,
  buildIndexPeriodView,
  listImmobilierCandidates,
  listKnownContacts,
  listParticipations,
  loadIndexData,
  restoreParticipation,
  saveRelevesPeriode,
} from '../utilityParticipantsService';

const allReleves = async () => {
  const ents = await ensureFacturesTool();
  return coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.releveDefinition.id });
};
const relevesOf = async (contactId: string) => (await allReleves()).filter((r) => r.values.participant_id === contactId);

describe('Participants — participation ≠ contact', () => {
  it('ajoute un participant autonome : personne externe sans compte TakarDa', async () => {
    const p = await addParticipant('ceet', { name: 'Koffi', phone: '90 12 34 56' });
    expect(p.participant).toMatchObject({ type: 'contact', label: 'Koffi' });
    expect(p.source).toBe('autonome');
    const contact = (await coreService.getExternalContact(p.participant.id!))!;
    expect(contact).toMatchObject({ name: 'Koffi', phone: '90 12 34 56' });
    expect(contact.linkedUserId).toBeUndefined();
    // le contact ne porte AUCUNE notion de module
    expect(Object.keys(contact).filter((k) => /module|fournisseur|type|ceet|tde/i.test(k))).toEqual([]);
  });

  it('ajoute plusieurs participants ; liste par module et dans l\'ordre d\'ajout', async () => {
    const before = (await listParticipations('tde')).length;
    const a = await addParticipant('tde', { name: 'Ama' });
    const b = await addParticipant('tde', { name: 'Yao' });
    const list = await listParticipations('tde');
    expect(list).toHaveLength(before + 2);
    expect(list.map((x) => x.record.id)).toEqual(expect.arrayContaining([a.record.id, b.record.id]));
  });

  it('refuse un nom vide, un téléphone invalide et un module inconnu (aucune personne créée)', async () => {
    const contactsBefore = (await coreService.getExternalContacts()).length;
    await expect(addParticipant('ceet', { name: '   ' })).rejects.toMatchObject({ code: 'PARTICIPANT_INVALIDE' });
    await expect(addParticipant('ceet', { name: 'X', phone: 'abc' })).rejects.toMatchObject({ code: 'PARTICIPANT_INVALIDE' });
    await expect(addParticipant('gaz', { name: 'X' })).rejects.toMatchObject({ code: 'FOURNISSEUR_INVALIDE' });
    expect((await coreService.getExternalContacts()).length).toBe(contactsBefore);
  });

  it('une même personne peut participer à CEET et à TDE (deux participations, un seul contact)', async () => {
    const ceet = await addParticipant('ceet', { name: 'Double' });
    const tde = await addExistingContact('tde', ceet.participant.id!);
    expect(tde.participant.id).toBe(ceet.participant.id);
    expect(tde.record.id).not.toBe(ceet.record.id);
    expect(tde.fournisseur).toBe('tde');
    expect((await coreService.getExternalContacts()).filter((c) => c.name === 'Double')).toHaveLength(1);
  });

  it('refuse le doublon dans un même module ; un participant archivé est réactivé, pas dupliqué', async () => {
    const p = await addParticipant('ceet', { name: 'Unique' });
    await expect(addExistingContact('ceet', p.participant.id!)).rejects.toMatchObject({ code: 'PARTICIPANT_DEJA_PRESENT' });
    await archiveParticipation(p.record.id);
    expect((await listParticipations('ceet')).some((x) => x.record.id === p.record.id)).toBe(false);
    expect((await listParticipations('ceet', { includeArchived: true })).find((x) => x.record.id === p.record.id)!.archived).toBe(true);
    const back = await addExistingContact('ceet', p.participant.id!);
    expect(back.record.id).toBe(p.record.id);
    expect(back.archived).toBe(false);
    await archiveParticipation(p.record.id);
    await restoreParticipation(p.record.id);
    expect((await listParticipations('ceet')).filter((x) => x.participant.id === p.participant.id)).toHaveLength(1);
  });

  it('participant venu d\'Immobilier : locataire d\'un contrat actif, sans ressaisie ; facultatif', async () => {
    expect(await listImmobilierCandidates('ceet')).toEqual(expect.any(Array));
    const bien = await createBien({ nom: 'Maison Agoè', adresse: 'Lomé' });
    const { contrat } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'A1' }, nom: 'Locataire Agoè', telephone: '90123456', loyerMensuel: 50000 });
    const candidates = await listImmobilierCandidates('ceet');
    expect(candidates.find((c) => c.contratId === contrat.id)!.label).toBe('Locataire Agoè');

    const p = await addContratParticipant('ceet', contrat.id);
    expect(p).toMatchObject({ source: 'immobilier', participant: { type: 'contrat', id: contrat.id, label: 'Locataire Agoè' } });
    expect((await listImmobilierCandidates('ceet')).some((c) => c.contratId === contrat.id)).toBe(false);
    expect((await listImmobilierCandidates('tde')).some((c) => c.contratId === contrat.id)).toBe(true);
    await expect(addContratParticipant('ceet', contrat.id)).rejects.toMatchObject({ code: 'PARTICIPANT_DEJA_PRESENT' });

    await terminerContrat(contrat.id);
    await expect(addContratParticipant('tde', contrat.id)).rejects.toMatchObject({ code: 'PARTICIPANT_INVALIDE' });
    await expect(addContratParticipant('tde', 'inconnu')).rejects.toMatchObject({ code: 'PARTICIPANT_INVALIDE' });
  });

  it('aucun participant n\'est créé implicitement par un relevé existant', async () => {
    const ents = await ensureFacturesTool();
    await coreService.createRecord({
      toolId: ents.tool.id,
      entityDefinitionId: ents.releveDefinition.id,
      values: { fournisseur: 'CEET', mois: '2026-01', compteur: 'Ancien compteur libre', index: 10, participant_type: 'manuel', participant_id: null },
    });
    expect((await listParticipations('ceet', { includeArchived: true })).some((p) => p.participant.label === 'Ancien compteur libre')).toBe(false);
  });
});

describe('Index par période', () => {
  async function trio(module: 'ceet' | 'tde') {
    const [koffi, ama, yao] = [await addParticipant(module, { name: 'Koffi' }), await addParticipant(module, { name: 'Ama' }), await addParticipant(module, { name: 'Yao' })];
    return { koffi, ama, yao, all: [koffi, ama, yao] };
  }
  const entries = (ps: { record: { id: string } }[], values: number[]) => ps.map((p, i) => ({ participationId: p.record.id, index: values[i] }));

  it('enregistre un relevé de période pour plusieurs participants, sur plusieurs périodes (scénario Koffi/Ama/Yao)', async () => {
    const { all, koffi } = await trio('ceet');
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-01', entries: entries(all, [125, 210, 175]) });
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-02', entries: entries(all, [140, 250, 190]) });
    // « revenir plus tard » : mars
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-03', entries: entries(all, [160, 280, 215]) });

    const releves = await allReleves();
    const view = buildIndexPeriodView(all.map((p) => ({ ...p })), releves, 'ceet', '2026-03');
    expect(view.map((r) => r.actuel!.values.index)).toEqual([160, 280, 215]);
    expect(view.map((r) => r.precedent!.values.index)).toEqual([140, 250, 190]);
    expect(view.map((r) => r.consommation)).toEqual([20, 30, 25]);
    expect(view.every((r) => r.missingMonths.length === 0 && r.issue === null)).toBe(true);
    expect((await relevesOf(koffi.participant.id!)).map((r) => r.values.mois).sort()).toEqual(['2026-01', '2026-02', '2026-03']);
    // module et identité enregistrés
    expect((await relevesOf(koffi.participant.id!))[0].values).toMatchObject({ fournisseur: 'ceet', participant_type: 'contact', participant_id: koffi.participant.id });
  });

  it('CEET et TDE sont indépendants pour une même personne', async () => {
    const ceet = await addParticipant('ceet', { name: 'Mixte' });
    const tde = await addExistingContact('tde', ceet.participant.id!);
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-04', entries: [{ participationId: ceet.record.id, index: 500 }] });
    await saveRelevesPeriode({ fournisseur: 'tde', periode: '2026-04', entries: [{ participationId: tde.record.id, index: 12 }] });
    const mine = await relevesOf(ceet.participant.id!);
    expect(mine.map((r) => `${r.values.fournisseur}:${r.values.index}`).sort()).toEqual(['ceet:500', 'tde:12']);
    // une participation CEET ne peut pas servir à enregistrer un relevé TDE
    await expect(saveRelevesPeriode({ fournisseur: 'tde', periode: '2026-05', entries: [{ participationId: ceet.record.id, index: 1 }] })).rejects.toMatchObject({ code: 'RELEVES_INVALIDES' });
  });

  it('refuse les valeurs invalides sans rien écrire (tout ou rien)', async () => {
    const { all } = await trio('tde');
    const before = (await allReleves()).length;
    for (const bad of [-1, NaN, Infinity]) {
      await expect(saveRelevesPeriode({ fournisseur: 'tde', periode: '2026-06', entries: entries(all, [10, bad, 30]) })).rejects.toMatchObject({
        code: 'RELEVES_INVALIDES',
        details: [expect.objectContaining({ label: 'Ama', code: 'INDEX_INVALIDE' })],
      });
    }
    await expect(saveRelevesPeriode({ fournisseur: 'tde', periode: '2026-13', entries: entries(all, [1, 2, 3]) })).rejects.toMatchObject({ code: 'PERIODE_INVALIDE' });
    await expect(saveRelevesPeriode({ fournisseur: 'tde', periode: '2026-06', entries: [] })).rejects.toMatchObject({ code: 'RELEVES_INVALIDES' });
    expect((await allReleves()).length).toBe(before);
  });

  it('doublon : refusé avec le nom du participant, rien d\'écrit pour les autres, ancien relevé intact ; même valeur ignorée', async () => {
    const { all, koffi } = await trio('ceet');
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-09', entries: [{ participationId: koffi.record.id, index: 100 }] });
    const before = (await allReleves()).length;
    await expect(saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-09', entries: entries(all, [999, 50, 60]) })).rejects.toMatchObject({
      code: 'RELEVES_INVALIDES',
      details: [expect.objectContaining({ label: 'Koffi', code: 'RELEVE_DEJA_ENREGISTRE', message: expect.stringContaining('Relevé déjà enregistré pour Koffi') })],
    });
    expect((await allReleves()).length).toBe(before); // Ama et Yao non plus
    expect((await relevesOf(koffi.participant.id!)).find((r) => r.values.mois === '2026-09')!.values.index).toBe(100);
    // même valeur pour Koffi + nouveaux pour les autres : OK, un seul nouveau relevé par autre participant
    const saved = await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-09', entries: entries(all, [100, 50, 60]) });
    expect(saved).toHaveLength(2);
  });

  it('refuse un participant archivé ou inexistant', async () => {
    const p = await addParticipant('ceet', { name: 'Parti' });
    await archiveParticipation(p.record.id);
    await expect(saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-07', entries: [{ participationId: p.record.id, index: 5 }] })).rejects.toMatchObject({ code: 'RELEVES_INVALIDES' });
    await expect(saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-07', entries: [{ participationId: 'inconnue', index: 5 }] })).rejects.toMatchObject({ code: 'RELEVES_INVALIDES' });
  });

  it('un participant archivé garde ses relevés (historique intact) et reste utilisable au retour', async () => {
    const p = await addParticipant('ceet', { name: 'Revenant' });
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-01', entries: [{ participationId: p.record.id, index: 10 }] });
    await archiveParticipation(p.record.id);
    expect(await relevesOf(p.participant.id!)).toHaveLength(1);
    await restoreParticipation(p.record.id);
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-02', entries: [{ participationId: p.record.id, index: 25 }] });
    const view = buildIndexPeriodView(await listParticipations('ceet'), await allReleves(), 'ceet', '2026-02').find((r) => r.participation.record.id === p.record.id)!;
    expect(view.consommation).toBe(15);
  });

  it('vue d\'une période : écart signalé, relevé manquant, index actuel inférieur — rien n\'est comblé ni deviné', async () => {
    const [gap, miss, inf] = [await addParticipant('ceet', { name: 'Gap' }), await addParticipant('ceet', { name: 'Miss' }), await addParticipant('ceet', { name: 'Inf' })];
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-01', entries: [{ participationId: gap.record.id, index: 100 }, { participationId: miss.record.id, index: 7 }, { participationId: inf.record.id, index: 500 }] });
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-03', entries: [{ participationId: gap.record.id, index: 150 }, { participationId: inf.record.id, index: 450 }] });
    const releves = await allReleves();
    const view = buildIndexPeriodView([gap, miss, inf], releves, 'ceet', '2026-03');
    expect(view[0]).toMatchObject({ consommation: 50, missingMonths: ['2026-02'], issue: null });
    expect(view[0].precedent!.values.mois).toBe('2026-01');
    expect(view[1]).toMatchObject({ actuel: null, consommation: null, missingMonths: ['2026-02'] }); // pas de relevé en mars : on le voit, on ne l'invente pas
    expect(view[1].precedent!.values.index).toBe(7);
    expect(view[2]).toMatchObject({ consommation: null, issue: 'INDEX_ACTUEL_INFERIEUR' });
    expect(releves.some((r) => r.values.participant_id === gap.participant.id && r.values.mois === '2026-02')).toBe(false);
  });

  it('les relevés enregistrés par période alimentent directement le calcul (aucune ressaisie)', async () => {
    const { all } = await trio('tde');
    await saveRelevesPeriode({ fournisseur: 'tde', periode: '2026-02', entries: entries(all, [100, 150, 200]) });
    await saveRelevesPeriode({ fournisseur: 'tde', periode: '2026-03', entries: entries(all, [125, 190, 235]) });
    const res = computeRepartitionParCompteur({ participants: all.map((p) => p.participant), fournisseur: 'tde', periode: '2026-03', releves: await allReleves(), montantTotal: 15000 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lines.map((l) => l.montant)).toEqual([3750, 6000, 5250]);
  });
});

describe('Persistance', () => {
  it('participants, participations archivées et relevés survivent à un redémarrage', async () => {
    jest.useFakeTimers();
    try {
      const a = await addParticipant('ceet', { name: 'Persist A' });
      const b = await addParticipant('ceet', { name: 'Persist B' });
      await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-01', entries: [{ participationId: a.record.id, index: 11 }, { participationId: b.record.id, index: 22 }] });
      await archiveParticipation(b.record.id);

      const stop = startAutoPersist();
      await jest.advanceTimersByTimeAsync(3100);
      stop();
      records.length = 0;
      await hydrateDb();

      const active = await listParticipations('ceet');
      expect(active.some((p) => p.participant.id === a.participant.id)).toBe(true);
      expect(active.some((p) => p.participant.id === b.participant.id)).toBe(false);
      expect((await listParticipations('ceet', { includeArchived: true })).find((p) => p.participant.id === b.participant.id)!.archived).toBe(true);
      expect((await relevesOf(b.participant.id!)).map((r) => r.values.index)).toEqual([22]);
      expect((await coreService.getExternalContact(a.participant.id!))!.name).toBe('Persist A');
    } finally {
      jest.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------------
// Corrections Étape 2 : personne unique, nom dynamique, correction/verrouillage
// des relevés, messages lisibles, saisie explicite.
// ---------------------------------------------------------------------------------

describe('Identité : une personne, plusieurs participations', () => {
  it('une personne ajoutée à CEET puis à TDE : un seul ExternalContact, deux participations distinctes', async () => {
    const contact = await coreService.createExternalContact({ name: 'Unique Personne', phone: '90000001' });
    const contactsBefore = (await coreService.getExternalContacts()).length;

    expect((await listKnownContacts('ceet')).some((c) => c.id === contact.id)).toBe(true);
    expect((await listKnownContacts('tde')).some((c) => c.id === contact.id)).toBe(true);

    const ceet = await addExistingContact('ceet', contact.id);
    // CEET n'a plus à la proposer ; TDE, si
    expect((await listKnownContacts('ceet')).some((c) => c.id === contact.id)).toBe(false);
    expect((await listKnownContacts('tde')).some((c) => c.id === contact.id)).toBe(true);

    const tde = await addExistingContact('tde', contact.id);
    expect((await listKnownContacts('tde')).some((c) => c.id === contact.id)).toBe(false);

    expect((await coreService.getExternalContacts()).length).toBe(contactsBefore); // aucune duplication
    expect(ceet.record.id).not.toBe(tde.record.id);
    expect([ceet.fournisseur, tde.fournisseur]).toEqual(['ceet', 'tde']);
    expect(ceet.participant.id).toBe(contact.id);
    expect(tde.participant.id).toBe(contact.id);
    expect((await coreService.getExternalContacts()).filter((c) => c.name === 'Unique Personne')).toHaveLength(1);
  });

  it('une personne archivée dans un module n\'est pas reproposée comme « nouvelle » (elle se rétablit)', async () => {
    const p = await addParticipant('tde', { name: 'Archivee Connue' });
    await archiveParticipation(p.record.id);
    expect((await listKnownContacts('tde')).some((c) => c.id === p.participant.id)).toBe(false);
    expect((await listKnownContacts('ceet')).some((c) => c.id === p.participant.id)).toBe(true);
  });

  it('homonymes : deux personnes de même nom ont des IDs différents et se distinguent par le téléphone', async () => {
    const a = await addParticipant('ceet', { name: 'Homonyme Test', phone: '90111111' });
    const b = await addParticipant('ceet', { name: 'Homonyme Test', phone: '90222222' });
    expect(a.participant.id).not.toBe(b.participant.id);
    const list = (await listParticipations('ceet')).filter((p) => p.displayName === 'Homonyme Test');
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.phone).sort()).toEqual(['90111111', '90222222']);
    const known = await listKnownContacts('tde');
    expect(known.filter((c) => c.name === 'Homonyme Test').map((c) => c.phone).sort()).toEqual(['90111111', '90222222']);
    // les relevés suivent l'identifiant, jamais le nom
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-01', entries: [{ participationId: a.record.id, index: 10 }, { participationId: b.record.id, index: 99 }] });
    const rel = await allReleves();
    expect(rel.find((r) => r.values.participant_id === a.participant.id)!.values.index).toBe(10);
    expect(rel.find((r) => r.values.participant_id === b.participant.id)!.values.index).toBe(99);
  });

  it('un locataire Immobilier déjà participant (contrat ou personne) n\'est jamais proposé deux fois', async () => {
    const bien = await createBien({ nom: 'Maison Unique', adresse: 'Lomé' });
    const { contrat, contact } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'U1' }, nom: 'Locataire Unique', telephone: '90333333', loyerMensuel: 40000 });
    expect((await listKnownContacts('ceet')).some((c) => c.id === contact.id)).toBe(true);
    expect((await listImmobilierCandidates('ceet')).some((c) => c.contratId === contrat.id)).toBe(true);

    // ajouté comme personne → plus proposé via son contrat
    await addExistingContact('ceet', contact.id);
    expect((await listImmobilierCandidates('ceet')).some((c) => c.contratId === contrat.id)).toBe(false);
    // …mais toujours disponible pour TDE (autre participation)
    expect((await listImmobilierCandidates('tde')).some((c) => c.contratId === contrat.id)).toBe(true);

    // ajouté via son contrat dans TDE → plus proposé comme personne
    await addContratParticipant('tde', contrat.id);
    expect((await listKnownContacts('tde')).some((c) => c.id === contact.id)).toBe(false);
  });
});

describe('Nom affiché : toujours résolu depuis la personne', () => {
  it('renommer la personne change le nom affiché ; la participation ne garde pas de copie du nom', async () => {
    const p = await addParticipant('ceet', { name: 'Koffi Renomme' });
    expect(p.record.values.label).toBeUndefined();
    await coreService.updateExternalContact(p.participant.id!, { name: 'Koffi Renomme Junior' });
    const again = (await listParticipations('ceet')).find((x) => x.record.id === p.record.id)!;
    expect(again.displayName).toBe('Koffi Renomme Junior');
    expect(again.participant.label).toBe('Koffi Renomme Junior');
    expect((await listKnownContacts('tde')).some((c) => c.name === 'Koffi Renomme Junior')).toBe(true);
  });

  it('une ancienne participation (avec libellé figé) affiche le nom actuel de la personne', async () => {
    const contact = await coreService.createExternalContact({ name: 'Nom Actuel' });
    const ents = await ensureFacturesToolCached();
    const legacy = await coreService.createRecord({
      toolId: ents.tool.id,
      entityDefinitionId: ents.participationDefinition.id,
      statusKey: 'actif',
      values: { fournisseur: 'tde', participant_type: 'contact', participant_id: contact.id, label: 'Ancien Libelle Fige', source: 'autonome' },
    });
    const found = (await listParticipations('tde')).find((x) => x.record.id === legacy.id)!;
    expect(found.displayName).toBe('Nom Actuel');
  });

  it('le snapshot d\'une part validée ne change pas quand la personne est renommée', async () => {
    const [a, b] = [await addParticipant('ceet', { name: 'Snap A' }), await addParticipant('ceet', { name: 'Snap B' })];
    for (const [periode, va, vb] of [['2026-02', 100, 200], ['2026-03', 130, 260]] as const) {
      await saveRelevesPeriode({ fournisseur: 'ceet', periode, entries: [{ participationId: a.record.id, index: va }, { participationId: b.record.id, index: vb }] });
    }
    const ents = await ensureFacturesToolCached();
    const facture = await createFacturePartagee({ toolId: ents.tool.id, facturePartageeEntityDefinitionId: ents.facturePartageeDefinition.id, values: { fournisseur: 'ceet', mois: '2026-03', montant_total: 9000 } });
    const parts = await validerFactureParCompteur({
      toolId: ents.tool.id,
      releveEntityDefinitionId: ents.releveDefinition.id,
      partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
      facturePartageeId: facture.id,
      participants: [a.participant, b.participant],
    });
    await coreService.updateExternalContact(a.participant.id!, { name: 'Snap A Renomme' });
    const part = (await coreService.getRecord(parts[0].id))!;
    expect(part.values.label).toBe('Snap A'); // historique figé
    expect(buildReceiptData((await coreService.getRecord(facture.id))!, part).participant).toBe('Snap A');
    expect((await listParticipations('ceet')).find((x) => x.record.id === a.record.id)!.displayName).toBe('Snap A Renomme'); // l'affichage courant suit la personne
  });
});

describe('Correction et verrouillage des relevés', () => {
  async function setup() {
    const [a, b] = [await addParticipant('ceet', { name: 'Corr A' }), await addParticipant('ceet', { name: 'Corr B' })];
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-01', entries: [{ participationId: a.record.id, index: 90 }, { participationId: b.record.id, index: 50 }] });
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-02', entries: [{ participationId: a.record.id, index: 80 }, { participationId: b.record.id, index: 70 }] }); // A : 80 < 90
    const rel = await allReleves();
    const of = (p: typeof a, mois: string) => rel.find((r) => r.values.participant_id === p.participant.id && r.values.mois === mois)!;
    return { a, b, of };
  }
  const validate = async (participants: Participant[], mois = '2026-02') => {
    const ents = await ensureFacturesToolCached();
    const facture = await createFacturePartagee({ toolId: ents.tool.id, facturePartageeEntityDefinitionId: ents.facturePartageeDefinition.id, values: { fournisseur: 'ceet', mois, montant_total: 6000 } });
    return validerFactureParCompteur({
      toolId: ents.tool.id,
      releveEntityDefinitionId: ents.releveDefinition.id,
      partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
      facturePartageeId: facture.id,
      participants,
    });
  };

  it('un index inférieur est enregistré comme corrigeable, signalé incohérent, et bloque la validation', async () => {
    const { a, b } = await setup();
    const view = buildIndexPeriodView([a, b], await allReleves(), 'ceet', '2026-02');
    expect(view[0]).toMatchObject({ issue: 'INDEX_ACTUEL_INFERIEUR', consommation: null, locked: false });
    expect(view[1]).toMatchObject({ issue: null, consommation: 20 });
    await expect(validate([a.participant, b.participant])).rejects.toMatchObject({ code: 'INDEX_ACTUEL_INFERIEUR' });
  });

  it('modifier un relevé non utilisé : même id, nouvelle valeur prise en compte, validation ensuite possible', async () => {
    const { a, b, of } = await setup();
    const bad = of(a, '2026-02');
    const fixed = await updateReleveIndex(bad.id, 100);
    expect(fixed.id).toBe(bad.id);
    expect(fixed.values.index).toBe(100);
    const view = buildIndexPeriodView([a, b], await allReleves(), 'ceet', '2026-02');
    expect(view[0]).toMatchObject({ issue: null, consommation: 10 });
    const parts = await validate([a.participant, b.participant]);
    expect(parts).toHaveLength(2);
    expect(parts.find((p) => p.values.participant_id === a.participant.id)!.values).toMatchObject({ index_precedent: 90, index_actuel: 100, consommation: 10 });
  });

  it('refuse un index de correction invalide ou un relevé inexistant', async () => {
    const { a, of } = await setup();
    const r = of(a, '2026-02');
    for (const bad of [-1, NaN, Infinity]) await expect(updateReleveIndex(r.id, bad)).rejects.toMatchObject({ code: 'INDEX_INVALIDE' });
    await expect(updateReleveIndex('inconnu', 5)).rejects.toMatchObject({ code: 'RELEVE_INTROUVABLE' });
    expect((await coreService.getRecord(r.id))!.values.index).toBe(80);
  });

  it('un relevé utilisé par une facture validée devient immuable (modification ET suppression refusées), actuel comme précédent', async () => {
    const { a, b, of } = await setup();
    await updateReleveIndex(of(a, '2026-02').id, 100);
    await validate([a.participant, b.participant]);

    for (const used of [of(a, '2026-02'), of(a, '2026-01')]) { // relevé actuel ET relevé précédent
      await expect(updateReleveIndex(used.id, 555)).rejects.toMatchObject({ code: 'RELEVE_UTILISE', message: RELEVE_VERROUILLE_MESSAGE });
      await expect(deleteReleve(used.id)).rejects.toMatchObject({ code: 'RELEVE_UTILISE' });
      expect((await coreService.getRecord(used.id))!.values.index).toBe(used.values.index);
    }
    // la vue de l'écran expose le verrou
    const data = await loadIndexData('ceet');
    const view = buildIndexPeriodView([a, b], data.releves, 'ceet', '2026-02', data.locked);
    expect(view.every((r) => r.locked)).toBe(true);
    // un relevé d'une autre période, jamais utilisé, reste corrigeable
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-05', entries: [{ participationId: a.record.id, index: 300 }] });
    const may = (await allReleves()).find((r) => r.values.participant_id === a.participant.id && r.values.mois === '2026-05')!;
    expect((await updateReleveIndex(may.id, 310)).values.index).toBe(310);
  });

  it('supprimer un relevé non utilisé le retire réellement', async () => {
    const { a, of } = await setup();
    const r = of(a, '2026-02');
    await deleteReleve(r.id);
    expect(await coreService.getRecord(r.id)).toBeNull();
    // et on peut ensuite le ressaisir (plus de doublon)
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-02', entries: [{ participationId: a.record.id, index: 120 }] });
  });

  it('isolation CEET/TDE : corriger un relevé CEET ne touche pas le relevé TDE de la même personne', async () => {
    const ceet = await addParticipant('ceet', { name: 'Iso Personne' });
    const tde = await addExistingContact('tde', ceet.participant.id!);
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-06', entries: [{ participationId: ceet.record.id, index: 500 }] });
    await saveRelevesPeriode({ fournisseur: 'tde', periode: '2026-06', entries: [{ participationId: tde.record.id, index: 40 }] });
    const rel = await allReleves();
    const c = rel.find((r) => r.values.participant_id === ceet.participant.id && r.values.fournisseur === 'ceet' && r.values.mois === '2026-06')!;
    await updateReleveIndex(c.id, 510);
    const after = await allReleves();
    expect(after.find((r) => r.values.participant_id === ceet.participant.id && r.values.fournisseur === 'tde')!.values.index).toBe(40);
    expect(after.find((r) => r.id === c.id)!.values.index).toBe(510);
  });
});

describe('Cache de provisionnement (nouveaux services uniquement)', () => {
  it('ensureFacturesToolCached ne provisionne qu\'une fois et renvoie les mêmes identifiants', async () => {
    const first = await ensureFacturesToolCached();
    const second = await ensureFacturesToolCached();
    expect(ensureFacturesToolCached()).toBe(ensureFacturesToolCached()); // même promesse
    expect(second.tool.id).toBe(first.tool.id);
    expect(second.participationDefinition.id).toBe(first.participationDefinition.id);
  });
});

describe('Messages et saisie (couche écran)', () => {
  it('parseIndexInput : rien n\'est transformé en silence', () => {
    expect(parseIndexInput('')).toEqual({ empty: true });
    expect(parseIndexInput('   ')).toEqual({ empty: true });
    expect(parseIndexInput('125')).toEqual({ empty: false, value: 125 });
    expect(parseIndexInput(' 12,5 ')).toEqual({ empty: false, value: 12.5 });
    for (const bad of ['-90', 'abc175', '1e5', '.', '12.', '1 2', '+5']) {
      const r = parseIndexInput(bad);
      expect(r).toMatchObject({ empty: false, error: expect.stringContaining('chiffres') });
    }
  });

  it('friendlyMessage : texte lisible, jamais d\'erreur technique brute', async () => {
    expect(friendlyMessage(new Error('TypeError: x is not a function at foo.js:12'))).toBe('Une erreur est survenue. Réessayez dans un instant.');
    expect(friendlyMessage('boom')).not.toContain('boom');
    expect(friendlyMessage(new UtilityBillingError('RELEVE_UTILISE', 'x'))).toBe(RELEVE_VERROUILLE_MESSAGE);
    expect(friendlyMessage(new UtilityBillingError('INDEX_INVALIDE', 'x'))).toContain('positif');
    // erreurs réelles du service
    const phoneError = await addParticipant('ceet', { name: 'X', phone: 'abc' }).catch((e) => e);
    expect(friendlyMessage(phoneError)).toBe('Le numéro de téléphone n’est pas valide (8 à 15 chiffres).');
    const p = await addParticipant('ceet', { name: 'Msg Test' });
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-09', entries: [{ participationId: p.record.id, index: 100 }] });
    const dup = await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-09', entries: [{ participationId: p.record.id, index: 5 }] }).catch((e) => e);
    expect(friendlyMessage(dup)).toContain('Relevé déjà enregistré');
    expect(friendlyMessage(dup)).not.toContain('RELEVE_');
    const dupAgain = await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2026-09', entries: [{ participationId: p.record.id, index: 5 }] }).catch((e) => e);
    expect(dupAgain).toBeInstanceOf(UtilityBillingError);
  });
});
