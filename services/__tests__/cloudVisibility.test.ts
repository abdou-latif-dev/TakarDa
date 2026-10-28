// Visibilité locale selon le compte : un compte B ne voit jamais les biens/logements synchronisés du compte A (ni leurs
// données dérivées), sans compte non plus ; rien n'est supprimé ; A retrouve tout à la reconnexion ; les données
// historiques (sans cloudOwnerUid) restent visibles ; une synchronisation de A n'envoie jamais de suppression quand B est actif.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { coreService } from '../coreService';
import { entityDefinitions, externalContacts, records } from '../db';
import { createBien, createLocataireEtContrat, createLogement, enregistrerPaiementLoyer, ensureImmobilierTool, listBiensWithSummary } from '../immobilierService';
import {
  CloudError,
  enableSync,
  importLocalRecords,
  loadSyncState,
  readLocalImmobilier,
  stampTrackedRecords,
  syncNow,
  type CloudRecordDoc,
  type CloudRecordsApi,
  type CloudRecordWrite,
} from '../cloudSyncService';
import { getActiveCloudUid, hiddenRecordIds, setActiveCloudUid, visibleRecordsFor } from '../cloudVisibility';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

/** Cloud en mémoire : un espace n'appartient qu'à son propriétaire. */
function makeCloud() {
  const spaces = new Map<string, { owner: string; docs: Map<string, CloudRecordDoc> }>();
  const calls = { write: 0, del: 0 };
  const api = (uid: string): CloudRecordsApi => {
    const space = (id: string) => {
      const s = spaces.get(id);
      if (!s || s.owner !== uid) throw new CloudError('permission', 'permission-denied');
      return s;
    };
    return {
      async ensureSpace() {
        const id = `personal_${uid}`;
        if (!spaces.has(id)) spaces.set(id, { owner: uid, docs: new Map() });
        return id;
      },
      async fetchRecords(id) {
        return [...space(id).docs.values()].map((d) => JSON.parse(JSON.stringify(d)) as CloudRecordDoc);
      },
      async writeRecord(id, doc: CloudRecordWrite, opts) {
        calls.write += 1;
        const s = space(id);
        const remote = s.docs.get(doc.id);
        if (remote && (opts.expectedRev === null || remote.rev !== opts.expectedRev || remote.deletedAt)) throw new CloudError('conflict', 'rev', remote);
        const rev = (remote?.rev ?? 0) + 1;
        s.docs.set(doc.id, { ...JSON.parse(JSON.stringify(doc)), rev });
        return rev;
      },
      async markDeleted(id, docId, deletedAt, opts) {
        calls.del += 1;
        const s = space(id);
        const remote = s.docs.get(docId);
        if (!remote || remote.rev !== opts.expectedRev) throw new CloudError('conflict', 'rev', remote ?? null);
        s.docs.set(docId, { ...remote, deletedAt, rev: remote.rev + 1 });
        return remote.rev + 1;
      },
    };
  };
  return { api, spaces, calls };
}

async function freshDevice() {
  records.length = 0;
  externalContacts.length = 0;
  await AsyncStorage.clear();
}

beforeEach(async () => {
  await freshDevice();
  setActiveCloudUid(null);
});

/** Le compte A synchronise un bien, un logement, un contrat et un paiement (seuls bien et logement vont dans le cloud). */
async function accountASyncs(cloud: ReturnType<typeof makeCloud>) {
  setActiveCloudUid('uidA');
  await enableSync(cloud.api('uidA'), 'uidA', new Date());
  const bien = await createBien({ nom: 'Maison de A', adresse: 'Lomé' });
  const { contrat, logement } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre A1' }, nom: 'Ama', telephone: '90123456', loyerMensuel: 25000, dateEntree: new Date() });
  const paiement = await enregistrerPaiementLoyer(contrat.id);
  await syncNow(cloud.api('uidA'), 'uidA');
  return { bien, logement, contrat, paiement };
}

const idsOf = async (kind: 'bien' | 'logement' | 'contrat' | 'paiement') => {
  const ents = await ensureImmobilierTool();
  return (await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents[kind].id })).map((r) => r.id);
};

describe('Comptes A et B sur le même téléphone', () => {
  it('B ne voit ni les biens et logements de A, ni leurs contrats, paiements ou événements, après déconnexion de A', async () => {
    const cloud = makeCloud();
    const a = await accountASyncs(cloud);
    expect(await idsOf('bien')).toEqual([a.bien.id]); // A les voit

    setActiveCloudUid('uidB'); // A s'est déconnectée, B se connecte
    expect(await idsOf('bien')).toEqual([]);
    expect(await idsOf('logement')).toEqual([]);
    expect(await idsOf('contrat')).toEqual([]); // donnée dérivée : suit le logement masqué
    expect(await idsOf('paiement')).toEqual([]);
    expect(await coreService.getRecord(a.bien.id)).toBeNull();
    expect(await coreService.getRecord(a.contrat.id)).toBeNull();
    expect(await listBiensWithSummary()).toEqual([]);
    const events = await coreService.getEvents({});
    expect(events.filter((e) => [a.bien.id, a.logement.id, a.contrat.id, a.paiement.id].includes(e.recordId ?? ''))).toEqual([]);
  });

  it('sans compte : données du compte A masquées mais conservées en stockage ; A les retrouve intactes à la reconnexion', async () => {
    const cloud = makeCloud();
    const a = await accountASyncs(cloud);
    const countBefore = records.length;

    setActiveCloudUid(null);
    expect(await idsOf('bien')).toEqual([]);
    expect(await idsOf('contrat')).toEqual([]);
    expect(records.length).toBe(countBefore); // rien n'est supprimé
    expect(records.find((r) => r.id === a.bien.id)?.cloudOwnerUid).toBe('uidA');

    setActiveCloudUid('uidB');
    expect(await idsOf('bien')).toEqual([]);
    setActiveCloudUid('uidA'); // reconnexion de A
    expect(await idsOf('bien')).toEqual([a.bien.id]);
    expect(await idsOf('logement')).toEqual([a.logement.id]);
    expect(await idsOf('contrat')).toEqual([a.contrat.id]);
    expect(await idsOf('paiement')).toEqual([a.paiement.id]);
    expect((await listBiensWithSummary())[0].summary).toMatchObject({ total: 1, occupes: 1 });
  });

  it('un second appareil de A marque les données reçues ; B ne les voit pas', async () => {
    const cloud = makeCloud();
    const a = await accountASyncs(cloud);
    await freshDevice();
    setActiveCloudUid('uidA');
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    await syncNow(cloud.api('uidA'), 'uidA');
    expect(records.find((r) => r.id === a.bien.id)?.cloudOwnerUid).toBe('uidA');
    expect(records.find((r) => r.id === a.logement.id)?.cloudOwnerUid).toBe('uidA');
    expect(records.find((r) => r.id === a.bien.id)?.createdBy).toBe('u-me'); // identité locale inchangée
    setActiveCloudUid('uidB');
    expect(await idsOf('bien')).toEqual([]);
    setActiveCloudUid('uidA');
    expect(await idsOf('bien')).toEqual([a.bien.id]);
  });
});

describe('Données locales historiques et données sans lien', () => {
  it('les données historiques (sans cloudOwnerUid) restent visibles pour tous : sans compte, A et B', async () => {
    const old = await createBien({ nom: 'Maison ancienne', adresse: 'Lomé' });
    const oldLogement = await createLogement({ bienId: old.id, nom: 'Chambre ancienne', loyerReference: 15000 });
    expect(old.cloudOwnerUid).toBeUndefined();
    for (const uid of [null, 'uidA', 'uidB']) {
      setActiveCloudUid(uid);
      expect(await idsOf('bien')).toEqual([old.id]);
      expect(await idsOf('logement')).toEqual([oldLogement.id]);
    }
  });

  it('le masquage ne touche pas les enregistrements sans lien avec le compte masqué', async () => {
    const old = await createBien({ nom: 'Maison ancienne', adresse: 'Lomé' });
    const { contrat: oldContrat } = await createLocataireEtContrat({ bienId: old.id, nouveauLogement: { nom: 'Chambre H' }, nom: 'Kofi', telephone: '90111222', loyerMensuel: 10000, dateEntree: new Date() });
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date(Date.now() + 5));
    await new Promise((r) => setTimeout(r, 15));
    setActiveCloudUid('uidA');
    const a = await createBien({ nom: 'Maison de A', adresse: 'Agoè' });
    await createLogement({ bienId: a.id, nom: 'Chambre A1', loyerReference: 20000 });
    await syncNow(cloud.api('uidA'), 'uidA');

    setActiveCloudUid('uidB');
    expect(await idsOf('bien')).toEqual([old.id]); // seule la maison de A est masquée
    expect(await idsOf('contrat')).toEqual([oldContrat.id]);
    expect((await listBiensWithSummary()).map((s) => s.bien.id)).toEqual([old.id]);
  });

  it('l’envoi volontaire des anciennes données ne les marque pas : elles restent des données locales visibles', async () => {
    const old = await createBien({ nom: 'Maison ancienne', adresse: 'Lomé' });
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date(Date.now() + 5));
    await new Promise((r) => setTimeout(r, 15));
    setActiveCloudUid('uidA');
    await importLocalRecords('uidA');
    await syncNow(cloud.api('uidA'), 'uidA');
    expect(cloud.spaces.get('personal_uidA')!.docs.has(old.id)).toBe(true);
    expect(records.find((r) => r.id === old.id)?.cloudOwnerUid).toBeUndefined();
    setActiveCloudUid(null);
    expect(await idsOf('bien')).toEqual([old.id]);
  });

  it('une propagation ne repose que sur les champs « relation » : un texte égal à un identifiant ne masque rien', () => {
    const owned = { id: 'rec-owned', entityDefinitionId: 'ed-x', toolId: 't', values: {}, createdBy: 'u-me', cloudOwnerUid: 'uidA', createdAt: 'a', updatedAt: 'a' };
    const noteLikeRef = { id: 'rec-note', entityDefinitionId: 'ed-note', toolId: 't', values: { note: 'rec-owned' }, createdBy: 'u-me', createdAt: 'a', updatedAt: 'a' };
    const realRef = { id: 'rec-child', entityDefinitionId: 'ed-child', toolId: 't', values: { parent: 'rec-owned' }, createdBy: 'u-me', createdAt: 'a', updatedAt: 'a' };
    entityDefinitions.push(
      { id: 'ed-note', toolId: 't', key: 'note', label: 'n', fields: [{ key: 'note', type: 'text', label: 'Note' }], createdAt: 'a', updatedAt: 'a' } as never,
      { id: 'ed-child', toolId: 't', key: 'child', label: 'c', fields: [{ key: 'parent', type: 'relation', label: 'Parent', relationTarget: 'ed-x' }], createdAt: 'a', updatedAt: 'a' } as never,
    );
    try {
      const hidden = hiddenRecordIds([owned, noteLikeRef, realRef] as never, 'uidB');
      expect([...hidden].sort()).toEqual(['rec-child', 'rec-owned']);
      expect(visibleRecordsFor([owned, noteLikeRef, realRef] as never, 'uidA').map((r) => r.id).sort()).toEqual(['rec-child', 'rec-note', 'rec-owned']);
    } finally {
      entityDefinitions.splice(entityDefinitions.length - 2, 2);
    }
  });
});

describe('Synchronisation isolée du compte actif', () => {
  it('une synchronisation de A pendant que B est actif ne lui envoie aucune suppression et ne perd rien', async () => {
    const cloud = makeCloud();
    const a = await accountASyncs(cloud);
    const before = JSON.stringify([...cloud.spaces.get('personal_uidA')!.docs.values()]);

    setActiveCloudUid('uidB'); // B est actif, mais la synchronisation concerne explicitement A
    const out = await syncNow(cloud.api('uidA'), 'uidA');
    expect(cloud.calls.del).toBe(0);
    expect(Object.values(out.state.entries).some((e) => e.deleted)).toBe(false);
    expect(JSON.stringify([...cloud.spaces.get('personal_uidA')!.docs.values()])).toBe(before);
    expect(records.some((r) => r.id === a.bien.id)).toBe(true);

    setActiveCloudUid(null); // et sans compte
    await syncNow(cloud.api('uidA'), 'uidA');
    expect(cloud.calls.del).toBe(0);
  });

  it('la synchronisation de B ne lit pas, ne suit pas et n’envoie pas les données de A', async () => {
    const cloud = makeCloud();
    const a = await accountASyncs(cloud);
    setActiveCloudUid('uidB');
    await enableSync(cloud.api('uidB'), 'uidB', new Date(Date.now() - 60_000)); // activation « ancienne » : tout compterait s'il voyait A
    const writesBefore = cloud.calls.write;
    const out = await syncNow(cloud.api('uidB'), 'uidB');
    expect(cloud.calls.write).toBe(writesBefore);
    expect(Object.keys(out.state.entries)).toEqual([]);
    expect(cloud.spaces.get('personal_uidB')!.docs.size).toBe(0);
    expect((await readLocalImmobilier('uidB'))?.bien ?? []).toEqual([]);
    expect((await readLocalImmobilier('uidA'))?.bien.map((b) => b.id)).toEqual([a.bien.id]);
  });

  it('une création non encore suivie est marquée sans réseau avant un changement de compte', async () => {
    const cloud = makeCloud();
    setActiveCloudUid('uidA');
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison pas encore envoyée', adresse: 'Lomé' });
    expect(records.find((r) => r.id === bien.id)?.cloudOwnerUid).toBeUndefined();
    await stampTrackedRecords('uidA');
    expect(records.find((r) => r.id === bien.id)?.cloudOwnerUid).toBe('uidA');
    expect(cloud.calls.write).toBe(0); // rien n'est envoyé par le marquage
    setActiveCloudUid('uidB');
    expect(await idsOf('bien')).toEqual([]);
    setActiveCloudUid('uidA');
    expect(await idsOf('bien')).toEqual([bien.id]);
    expect((await loadSyncState('uidA'))!.entries[bien.id].status).toBe('pending'); // toujours à envoyer
  });

  it('cloudOwnerUid n’est jamais transmis à Firestore', async () => {
    const cloud = makeCloud();
    await accountASyncs(cloud);
    for (const doc of cloud.spaces.get('personal_uidA')!.docs.values()) {
      expect(Object.keys(doc)).not.toContain('cloudOwnerUid');
      expect(JSON.stringify(doc)).not.toContain('cloudOwnerUid');
    }
  });

  it('le compte actif par défaut est « sans compte »', () => {
    setActiveCloudUid(null);
    expect(getActiveCloudUid()).toBeNull();
  });
});
