// Marquage dès la création, époque de compte, caches en mémoire et résultats asynchrones d'un ancien compte.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { coreService } from '../coreService';
import { externalContacts, records } from '../db';
import { createBien, createLocataireEtContrat, createLogement, ensureImmobilierTool } from '../immobilierService';
import { getAccountEpoch, getActiveCloudUid, ownerForNewRecord, setActiveCloudUid, setCloudStampUid } from '../cloudVisibility';
import { statisticsService } from '../statisticsService';
import { resetAccountCaches } from '@/store/accountCaches';
import { useActivityStore } from '@/store/activityStore';
import { useCoreStore } from '@/store/coreStore';
import { useNotificationStore } from '@/store/notificationStore';
import { useStatisticsStore } from '@/store/statisticsStore';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

beforeEach(async () => {
  records.length = 0;
  externalContacts.length = 0;
  await AsyncStorage.clear();
  setActiveCloudUid(null);
  setCloudStampUid(null);
});

const idsOf = async (kind: 'bien' | 'logement' | 'contrat') => {
  const ents = await ensureImmobilierTool();
  return (await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents[kind].id })).map((r) => r.id);
};

describe('Marquage dès la création (aucun scan, même en cas de fermeture forcée)', () => {
  it('synchronisation activée : un bien est marqué immédiatement et reste invisible pour B', async () => {
    setActiveCloudUid('uidA');
    setCloudStampUid('uidA');
    const bien = await createBien({ nom: 'Maison A', adresse: 'Lomé' });
    expect(records.find((r) => r.id === bien.id)?.cloudOwnerUid).toBe('uidA');
    // l'application est « tuée » ici : aucun scan, aucune synchronisation, aucune déconnexion
    setActiveCloudUid('uidB');
    expect(await idsOf('bien')).toEqual([]);
    setActiveCloudUid(null);
    expect(await idsOf('bien')).toEqual([]);
    setActiveCloudUid('uidA');
    expect(await idsOf('bien')).toEqual([bien.id]);
  });

  it('un logement sous un bien marqué l’est aussi ; un contrat n’est pas marqué mais suit son logement', async () => {
    setActiveCloudUid('uidA');
    setCloudStampUid('uidA');
    const bien = await createBien({ nom: 'Maison A', adresse: 'Lomé' });
    const logement = await createLogement({ bienId: bien.id, nom: 'Chambre 1', loyerReference: 20000 });
    const { contrat } = await createLocataireEtContrat({ bienId: bien.id, logementId: logement.id, nom: 'Ama', telephone: '90123456', loyerMensuel: 20000, dateEntree: new Date() });
    expect(records.find((r) => r.id === logement.id)?.cloudOwnerUid).toBe('uidA');
    expect(records.find((r) => r.id === contrat.id)?.cloudOwnerUid).toBeUndefined();
    setActiveCloudUid('uidB');
    expect(await idsOf('logement')).toEqual([]);
    expect(await idsOf('contrat')).toEqual([]);
  });

  it('un logement créé sous un bien historique (non suivi) n’est pas marqué : il reste local et visible', async () => {
    const old = await createBien({ nom: 'Maison ancienne', adresse: 'Lomé' }); // créé sans synchronisation
    setActiveCloudUid('uidA');
    setCloudStampUid('uidA');
    const logement = await createLogement({ bienId: old.id, nom: 'Chambre H', loyerReference: 12000 });
    expect(records.find((r) => r.id === logement.id)?.cloudOwnerUid).toBeUndefined();
    setActiveCloudUid('uidB');
    expect(await idsOf('bien')).toEqual([old.id]);
    expect(await idsOf('logement')).toEqual([logement.id]);
  });

  it('sans synchronisation activée : rien n’est marqué, ni sans compte ni avec un compte connecté', async () => {
    const sansCompte = await createBien({ nom: 'Maison 1', adresse: 'Lomé' });
    setActiveCloudUid('uidA'); // connecté mais synchronisation non activée : stampUid reste null
    const connecte = await createBien({ nom: 'Maison 2', adresse: 'Lomé' });
    expect(sansCompte.cloudOwnerUid).toBeUndefined();
    expect(connecte.cloudOwnerUid).toBeUndefined();
  });

  it('seul l’outil Immobilier est concerné', () => {
    setCloudStampUid('uidA');
    expect(ownerForNewRecord({ toolId: 'tool-inconnu', entityDefinitionId: 'ed-inconnu', values: {} })).toBeUndefined();
  });
});

describe('Époque de compte', () => {
  it('change à chaque changement de compte, pas à une simple répétition', () => {
    const e0 = getAccountEpoch();
    setActiveCloudUid('uidA');
    const e1 = getAccountEpoch();
    expect(e1).toBe(e0 + 1);
    setActiveCloudUid('uidA');
    expect(getAccountEpoch()).toBe(e1);
    setActiveCloudUid('uidB');
    setActiveCloudUid(null);
    expect(getAccountEpoch()).toBe(e1 + 2);
    expect(getActiveCloudUid()).toBeNull();
  });
});

describe('Caches en mémoire', () => {
  it('resetAccountCaches vide les copies des stores mais pas la base ni le stockage', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await AsyncStorage.setItem('@formease/db_snapshot', '{"x":1}');
    const countBefore = records.length;
    useCoreStore.setState({ records: { k: [bien] }, recordsStatus: { k: 'success' } });
    useActivityStore.setState({ events: [{ id: 'e' } as never], status: 'success' });
    useNotificationStore.setState({ notifications: [{ id: 'n', read: false } as never], unreadCount: 1, status: 'success' });
    useStatisticsStore.setState({ overview: {} as never, status: 'success' });

    resetAccountCaches();
    expect(useCoreStore.getState().records).toEqual({});
    expect(useActivityStore.getState().events).toEqual([]);
    expect(useNotificationStore.getState()).toMatchObject({ notifications: [], unreadCount: 0, status: 'idle' });
    expect(useStatisticsStore.getState()).toMatchObject({ overview: null, status: 'idle' });
    expect(records.length).toBe(countBefore); // base intacte
    expect(await AsyncStorage.getItem('@formease/db_snapshot')).toBe('{"x":1}'); // stockage intact
  });

  it('le résultat d’un chargement lancé sous un ancien compte est écarté', async () => {
    let release: (v: never) => void = () => undefined;
    const gate = new Promise<never>((resolve) => { release = resolve; });
    const spy = jest.spyOn(statisticsService, 'getOverview').mockReturnValueOnce(gate);
    setActiveCloudUid('uidA');
    const pending = useStatisticsStore.getState().fetchOverview();
    setActiveCloudUid('uidB'); // changement de compte pendant le chargement
    release({ ancien: 'compte A' } as never);
    await pending;
    expect(useStatisticsStore.getState().overview).toBeNull();
    spy.mockRestore();
  });
});
