// Phase 3 — journal d'activités : une action MÉTIER réussie ⇒ une activité ;
// navigation, action échouée ou double appel ⇒ aucune activité en plus.

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { coreService } from '../coreService';
import { activityEvents, groups } from '../db';
import { hydrateDb, startAutoPersist } from '../persistence';
import { ensureFacturesToolCached } from '../facturesService';
import { getCurrentUserId } from '../identityService';
import {
  activityModule,
  activityService,
  getRecentActivities,
  groupActivitiesByDay,
  moduleOfFournisseur,
  recordActivity,
  selectRecentActivities,
  sortActivities,
} from '../activityService';
import { groupService } from '../groupService';
import { tontineService } from '../tontineService';
import { getToursForGroup, ensureToursGenerated } from '../tontineTours';
import {
  createBien,
  createLocataireEtContrat,
  createLogement,
  deleteBienCascade,
  enregistrerPaiementLoyer,
  terminerContrat,
} from '../immobilierService';
import {
  computeRepartitionEquitable,
  createFacturePartagee,
  enregistrerPaiementPart,
  validateRepartition,
  type Participant,
} from '../utilityBillingService';
import { addParticipant, listParticipations, saveRelevesPeriode } from '../utilityParticipantsService';
import type { ActivityEvent } from '@/types/entities';

let n = 0;
const uniq = (label: string) => `${label} ${(n += 1)}-${Math.random().toString(36).slice(2, 7)}`;
const ofType = (type: string) => activityEvents.filter((e) => e.type === type);

const ev = (id: string, at: string, extra: Partial<ActivityEvent> = {}): ActivityEvent =>
  ({ id, type: 'group_created', title: id, description: '', at, ...extra }) as ActivityEvent;

beforeEach(() => {
  activityEvents.length = 0;
});

describe('recordActivity', () => {
  it('crée une activité avec id, date et auteur (getCurrentUserId)', () => {
    const before = Date.now();
    const created = recordActivity({ type: 'group_created', title: 'Tontine créée', description: 'Famille', module: 'tontine', entityType: 'tontine', entityId: 'g-1' })!;
    expect(created.id).toMatch(/^a-/);
    expect(Date.parse(created.at)).toBeGreaterThanOrEqual(before);
    expect(created.userId).toBe(getCurrentUserId());
    expect(created).toMatchObject({ title: 'Tontine créée', description: 'Famille', module: 'tontine', entityType: 'tontine', entityId: 'g-1' });
    expect(activityEvents).toEqual([created]);
  });

  it('n’ajoute que les champs renseignés et accepte une description absente', () => {
    const created = recordActivity({ type: 'group_created', title: 'X' })!;
    expect(created.description).toBe('');
    expect(Object.keys(created).sort()).toEqual(['at', 'description', 'id', 'title', 'type', 'userId']);
  });

  it('une même dedupeKey ne crée qu’une activité', () => {
    const first = recordActivity({ type: 'group_created', title: 'A', dedupeKey: 'k1' })!;
    const second = recordActivity({ type: 'group_created', title: 'B', dedupeKey: 'k1' })!;
    expect(second).toBe(first);
    expect(activityEvents).toHaveLength(1);
    recordActivity({ type: 'group_created', title: 'C', dedupeKey: 'k2' });
    expect(activityEvents).toHaveLength(2);
  });

  it('ne lève jamais d’erreur : un journal en panne ne fait pas échouer l’action', () => {
    const spy = jest.spyOn(activityEvents, 'unshift').mockImplementationOnce(() => {
      throw new Error('panne');
    });
    try {
      expect(recordActivity({ type: 'group_created', title: 'X' })).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Lecture : tri, limite, filtres', () => {
  const a = ev('A', '2026-10-01T10:00:00.000Z');
  const b = ev('B', '2026-10-01T11:00:00.000Z');
  const c = ev('C', '2026-10-01T12:00:00.000Z');

  it('plus récente d’abord, quel que soit l’ordre de stockage', () => {
    expect(sortActivities([a, c, b]).map((e) => e.id)).toEqual(['C', 'B', 'A']);
    expect(sortActivities([a, b, c]).map((e) => e.id)).toEqual(['C', 'B', 'A']);
  });

  it('à date égale, l’ordre d’enregistrement est conservé', () => {
    const x = ev('X', '2026-10-01T10:00:00.000Z');
    const y = ev('Y', '2026-10-01T10:00:00.000Z');
    expect(sortActivities([x, y]).map((e) => e.id)).toEqual(['X', 'Y']);
  });

  it('getRecentActivities(3) ne renvoie que les 3 plus récentes', () => {
    const d = ev('D', '2026-10-01T09:00:00.000Z');
    activityEvents.push(d, a, c, b);
    expect(getRecentActivities({ limit: 3 }).map((e) => e.id)).toEqual(['C', 'B', 'A']);
    expect(getRecentActivities({ limit: 0 })).toEqual([]);
    expect(getRecentActivities()).toHaveLength(4);
  });

  it('filtre par module et par outil ; les anciennes lignes gardent leur module déduit du type', () => {
    const legacyForm = ev('F', '2026-10-01T08:00:00.000Z', { type: 'form_created' });
    const bien = ev('B1', '2026-10-01T13:00:00.000Z', { type: 'immobilier.bien_created', toolId: 'tool-1' });
    const ceet = ev('C1', '2026-10-01T14:00:00.000Z', { type: 'utility.part_paid', module: 'ceet' });
    const all = [a, legacyForm, bien, ceet];
    expect(selectRecentActivities(all, { module: 'tontine' }).map((e) => e.id)).toEqual(['A']);
    expect(selectRecentActivities(all, { module: 'formulaires' }).map((e) => e.id)).toEqual(['F']);
    expect(selectRecentActivities(all, { module: 'immobilier' }).map((e) => e.id)).toEqual(['B1']);
    expect(selectRecentActivities(all, { module: 'ceet' }).map((e) => e.id)).toEqual(['C1']);
    expect(selectRecentActivities(all, { toolId: 'tool-1' }).map((e) => e.id)).toEqual(['B1']);
    expect(activityModule({ type: 'utility.part_paid' })).toBeNull(); // sans module enregistré : jamais deviné
    expect(moduleOfFournisseur('CEET')).toBe('ceet');
    expect(moduleOfFournisseur('tde')).toBe('tde');
    expect(moduleOfFournisseur('autre')).toBe('immobilier');
  });

  it('regroupe par jour en gardant l’ordre', () => {
    const now = new Date();
    const hier = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString();
    const grouped = groupActivitiesByDay(sortActivities([ev('H', hier), ev('N1', now.toISOString()), ev('N2', new Date(now.getTime() - 1000).toISOString())]));
    expect(grouped.map((g) => g.label)).toEqual(["Aujourd'hui", 'Hier']);
    expect(grouped[0].events.map((e) => e.id)).toEqual(['N1', 'N2']);
  });

  it('activityService.list reste compatible (tri + filtre par groupe)', async () => {
    activityEvents.push(a, ev('G', '2026-10-02T10:00:00.000Z', { groupId: 'g-9' }));
    expect((await activityService.list()).map((e) => e.id)).toEqual(['G', 'A']);
    expect((await activityService.list('g-9')).map((e) => e.id)).toEqual(['G']);
  });
});

describe('Persistance et compatibilité', () => {
  it('les activités survivent à un relancement, et les anciennes lignes restent lisibles', async () => {
    jest.useFakeTimers();
    try {
      activityEvents.push(ev('ancienne', '2026-01-01T10:00:00.000Z', { type: 'member_joined', userName: 'Awa' })); // sans les champs de la Phase 3
      recordActivity({ type: 'immobilier.bien_created', title: 'Bien ajouté', description: 'Tokoin', module: 'immobilier', entityType: 'bien', entityId: 'b-1' });
      recordActivity({ type: 'group_created', title: 'Tontine créée', module: 'tontine', dedupeKey: 'persist-1' });

      const stop = startAutoPersist();
      await jest.advanceTimersByTimeAsync(3100);
      stop();

      activityEvents.length = 0; // redémarrage : mémoire vide, puis relecture du stockage
      await hydrateDb();
      expect(activityEvents).toHaveLength(3);
      expect(getRecentActivities().map((e) => e.title)).toEqual(['Tontine créée', 'Bien ajouté', 'ancienne']);
      expect(activityEvents.find((e) => e.dedupeKey === 'persist-1')).toBeTruthy();
      expect(recordActivity({ type: 'group_created', title: 'doublon', dedupeKey: 'persist-1' })).toBe(activityEvents.find((e) => e.dedupeKey === 'persist-1'));
      expect(activityEvents).toHaveLength(3);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Tontine', () => {
  it('création, membre, cotisation, tour suivant et suppression sont journalisés une seule fois', async () => {
    const tontine = await groupService.createTontine({
      name: uniq('Famille'),
      contributionAmount: 5000,
      frequency: 'monthly',
      startDate: new Date().toISOString(),
      orderMethod: 'join_order',
    } as Parameters<typeof groupService.createTontine>[0]);
    expect(ofType('group_created')).toHaveLength(1);
    expect(ofType('group_created')[0]).toMatchObject({ module: 'tontine', entityType: 'tontine', entityId: tontine.id, groupId: tontine.id, userId: getCurrentUserId() });

    const membre = await groupService.addGuestMember(tontine.id, { firstName: 'Moussa', lastName: 'Diallo' });
    expect(ofType('member_invited')).toHaveLength(1);
    expect(ofType('member_invited')[0]).toMatchObject({ userName: 'Moussa Diallo', entityId: membre.id });

    ensureToursGenerated(tontine.id, 1);
    const tour = getToursForGroup(tontine.id)[0];
    await tontineService.recordContributions({ groupId: tontine.id, tourId: tour.id, memberIds: [membre.id] });
    expect(ofType('contribution_added')).toHaveLength(1);
    expect(ofType('contribution_added')[0]).toMatchObject({ amount: 5000, module: 'tontine' });

    // déjà payé : l'action métier ne refait rien, le journal non plus
    await tontineService.recordContributions({ groupId: tontine.id, tourId: tour.id, memberIds: [membre.id] });
    expect(ofType('contribution_added')).toHaveLength(1);

    await tontineService.advanceRound(tontine.id);
    expect(ofType('order_updated')).toHaveLength(1);

    await groupService.deleteTontine(tontine.id);
    expect(ofType('tontine_deleted')).toHaveLength(1);
    expect(groups.find((g) => g.id === tontine.id)).toBeUndefined();
  });

  it('une action échouée ne journalise rien', async () => {
    await expect(tontineService.recordContributions({ groupId: 'inconnu', tourId: 'inconnu', memberIds: ['x'] })).rejects.toThrow();
    await tontineService.advanceRound('inconnu'); // sans effet
    await groupService.deleteTontine('inconnu'); // sans effet
    await expect(groupService.updateTontine('inconnu', { name: 'X', contributionAmount: 1, frequency: 'monthly' })).rejects.toThrow();
    expect(activityEvents).toHaveLength(0);
  });
});

describe('Immobilier', () => {
  async function scenario() {
    const bien = await createBien({ nom: uniq('Résidence Tokoin'), adresse: 'Lomé' });
    const { contrat, logement } = await createLocataireEtContrat({
      bienId: bien.id,
      nouveauLogement: { nom: uniq('Studio') },
      nom: 'Kossi Adjo',
      telephone: '90123456',
      loyerMensuel: 50000,
      dateEntree: new Date(2026, 0, 5),
      dernierLoyerPaye: '2026-09',
    } as Parameters<typeof createLocataireEtContrat>[0]);
    return { bien, contrat, logement };
  }

  it('bien, logement, contrat (avec nouveau logement), loyer, fin de contrat et suppression', async () => {
    const { bien, contrat } = await scenario();
    expect(ofType('immobilier.bien_created')).toHaveLength(1);
    expect(ofType('immobilier.bien_created')[0]).toMatchObject({ module: 'immobilier', entityType: 'bien', entityId: bien.id, toolId: bien.toolId });
    expect(ofType('immobilier.logement_created')).toHaveLength(1); // créé avec le contrat : une seule fois
    expect(ofType('immobilier.contrat_created')).toHaveLength(1);
    expect(ofType('immobilier.contrat_created')[0].description).toContain('Kossi Adjo');

    const seul = await createLogement({ bienId: bien.id, nom: uniq('Chambre') });
    expect(ofType('immobilier.logement_created')).toHaveLength(2);
    expect(ofType('immobilier.logement_created')[0].entityId).toBe(seul.id);

    await enregistrerPaiementLoyer(contrat.id, new Date(2026, 9, 12));
    expect(ofType('immobilier.loyer_paid')).toHaveLength(1);
    expect(ofType('immobilier.loyer_paid')[0]).toMatchObject({ amount: 50000, entityType: 'paiement' });
    expect(ofType('immobilier.loyer_paid')[0].description).toContain('Kossi Adjo');
    expect(ofType('immobilier.loyer_paid')[0].description).toContain('octobre 2026');

    await terminerContrat(contrat.id);
    expect(ofType('immobilier.contrat_ended')).toHaveLength(1);

    await deleteBienCascade(bien.id);
    expect(ofType('immobilier.bien_deleted')).toHaveLength(1);
    expect(ofType('immobilier.bien_deleted')[0].description).toBe(bien.values.nom);
  });

  it('actions refusées : aucune activité (double paiement, contrat déjà terminé, données invalides)', async () => {
    const { bien, contrat } = await scenario();
    activityEvents.length = 0;

    const [r1, r2] = await Promise.allSettled([enregistrerPaiementLoyer(contrat.id), enregistrerPaiementLoyer(contrat.id)]);
    expect([r1.status, r2.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(ofType('immobilier.loyer_paid')).toHaveLength(1);

    await terminerContrat(contrat.id);
    await expect(terminerContrat(contrat.id)).rejects.toThrow();
    await expect(enregistrerPaiementLoyer(contrat.id)).rejects.toThrow();
    expect(ofType('immobilier.contrat_ended')).toHaveLength(1);
    expect(ofType('immobilier.loyer_paid')).toHaveLength(1);

    activityEvents.length = 0;
    await expect(createBien({ nom: '  ', adresse: 'x' })).rejects.toThrow();
    await expect(createLogement({ bienId: bien.id, nom: '' })).rejects.toThrow();
    await expect(
      createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: uniq('X') }, nom: 'Y', telephone: 'abc', loyerMensuel: 1 } as Parameters<typeof createLocataireEtContrat>[0]),
    ).rejects.toThrow();
    expect(activityEvents).toHaveLength(0);
  });

  it('un contrat qui échoue après la création du logement annule aussi l’activité du logement', async () => {
    const bien = await createBien({ nom: uniq('Bien rollback'), adresse: 'Lomé' });
    activityEvents.length = 0;
    const original = coreService.createRecord.bind(coreService);
    const spy = jest.spyOn(coreService, 'createRecord').mockImplementation((input) => {
      if (input.statusKey === 'actif') return Promise.reject(new Error('panne simulée')); // la création du contrat
      return original(input);
    });
    try {
      await expect(
        createLocataireEtContrat({
          bienId: bien.id,
          nouveauLogement: { nom: uniq('Logement fantôme') },
          nom: 'Awa',
          telephone: '90123456',
          loyerMensuel: 40000,
        } as Parameters<typeof createLocataireEtContrat>[0]),
      ).rejects.toThrow('panne simulée');
    } finally {
      spy.mockRestore();
    }
    expect(activityEvents).toHaveLength(0);
  });
});

describe('CEET / TDE', () => {
  async function participantsOf(module: 'ceet' | 'tde', count: number) {
    const people = [];
    for (let i = 0; i < count; i += 1) people.push(await addParticipant(module, { name: uniq('Personne') }));
    return people;
  }
  const toParticipants = (list: Awaited<ReturnType<typeof participantsOf>>): Participant[] => list.map((p) => p.participant);

  it('participant ajouté : une activité, rien pour un doublon refusé', async () => {
    const [p] = await participantsOf('ceet', 1);
    expect(ofType('utility.participant_added')).toHaveLength(1);
    expect(ofType('utility.participant_added')[0]).toMatchObject({ module: 'ceet', entityType: 'participation', entityId: p.record.id });
    await expect(addParticipant('ceet', { name: '   ' })).rejects.toThrow();
    expect(ofType('utility.participant_added')).toHaveLength(1);
  });

  it('relevés : un événement par lot réellement enregistré, aucun pour un lot refusé ou déjà présent', async () => {
    const [a, b] = await participantsOf('tde', 2);
    activityEvents.length = 0;
    await saveRelevesPeriode({ fournisseur: 'tde', periode: '2031-01', entries: [{ participationId: a.record.id, index: 100 }, { participationId: b.record.id, index: 200 }] });
    expect(ofType('utility.releves_saved')).toHaveLength(1);
    expect(ofType('utility.releves_saved')[0]).toMatchObject({ module: 'tde' });
    expect(ofType('utility.releves_saved')[0].description).toContain('2 relevés');

    // mêmes valeurs : rien de nouveau n'est écrit, rien n'est journalisé
    await saveRelevesPeriode({ fournisseur: 'tde', periode: '2031-01', entries: [{ participationId: a.record.id, index: 100 }] });
    // valeur différente : refusé, rien n'est écrit
    await expect(saveRelevesPeriode({ fournisseur: 'tde', periode: '2031-01', entries: [{ participationId: a.record.id, index: 999 }] })).rejects.toThrow();
    await expect(saveRelevesPeriode({ fournisseur: 'tde', periode: '2031-02', entries: [{ participationId: a.record.id, index: -5 }] })).rejects.toThrow();
    expect(ofType('utility.releves_saved')).toHaveLength(1);
  });

  it('facture validée puis part payée : une activité chacune, avec le bon module', async () => {
    const people = await participantsOf('ceet', 2);
    const ents = await ensureFacturesToolCached();
    const facture = await createFacturePartagee({ toolId: ents.tool.id, facturePartageeEntityDefinitionId: ents.facturePartageeDefinition.id, values: { fournisseur: 'ceet', mois: '2031-03', montant_total: 20000 } });
    activityEvents.length = 0;

    const lines = computeRepartitionEquitable(toParticipants(people), 20000);
    const validateArgs = { toolId: ents.tool.id, partLocataireEntityDefinitionId: ents.partLocataireDefinition.id, facturePartageeId: facture.id, mode: 'equitable' as const, lines };
    const parts = await validateRepartition(validateArgs);
    expect(ofType('utility.facture_validated')).toHaveLength(1);
    expect(ofType('utility.facture_validated')[0]).toMatchObject({ module: 'ceet', entityId: facture.id, amount: 20000 });
    expect(ofType('utility.facture_validated')[0].description).toContain('mars 2031');

    await expect(validateRepartition(validateArgs)).rejects.toThrow(); // déjà répartie
    expect(ofType('utility.facture_validated')).toHaveLength(1);

    await enregistrerPaiementPart(parts[0].id);
    expect(ofType('utility.part_paid')).toHaveLength(1);
    expect(ofType('utility.part_paid')[0]).toMatchObject({ module: 'ceet', entityId: parts[0].id, amount: 10000 });

    await expect(enregistrerPaiementPart(parts[0].id)).rejects.toThrow(); // déjà payée
    expect(ofType('utility.part_paid')).toHaveLength(1);
  });

  it('une facture invalide (montant) n’est pas journalisée', async () => {
    const people = await participantsOf('tde', 1);
    const ents = await ensureFacturesToolCached();
    const facture = await createFacturePartagee({ toolId: ents.tool.id, facturePartageeEntityDefinitionId: ents.facturePartageeDefinition.id, values: { fournisseur: 'tde', mois: '2031-04', montant_total: 9000 } });
    activityEvents.length = 0;
    await expect(
      validateRepartition({
        toolId: ents.tool.id,
        partLocataireEntityDefinitionId: ents.partLocataireDefinition.id,
        facturePartageeId: facture.id,
        mode: 'equitable',
        lines: computeRepartitionEquitable(toParticipants(people), 1234), // somme ≠ montant de la facture
      }),
    ).rejects.toThrow();
    expect(activityEvents).toHaveLength(0);
    expect((await listParticipations('tde')).length).toBeGreaterThan(0);
  });
});

describe('Navigation et consultation', () => {
  it('lire le journal ou les données n’enregistre rien', async () => {
    recordActivity({ type: 'group_created', title: 'Tontine créée' });
    const before = activityEvents.length;
    getRecentActivities({ limit: 5 });
    await activityService.list();
    await groupService.listMyGroups();
    await listParticipations('ceet');
    expect(activityEvents).toHaveLength(before);
  });
});
