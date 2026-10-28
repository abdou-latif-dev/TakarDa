// Synchronisation cloud des biens et logements : confirmation, nouvelles tentatives sans doublon, second appareil,
// isolation des comptes, conflits, envoi volontaire des anciennes données. Le cloud est simulé en mémoire.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { coreService } from '../coreService';
import { externalContacts, records } from '../db';
import { createBien, createLocataireEtContrat, createLogement, deleteBienCascade, enregistrerPaiementLoyer, ensureImmobilierTool, updateLogement } from '../immobilierService';
import {
  badgeState,
  CloudError,
  countPending,
  displayState,
  displayStates,
  pullFromCloud,
  type SyncState,
  enableSync,
  importLocalRecords,
  loadSyncState,
  previewLocalImport,
  readLocalImmobilier,
  resolveConflict,
  syncNow,
  type CloudRecordDoc,
  type CloudRecordsApi,
  type CloudRecordWrite,
} from '../cloudSyncService';
import { setActiveCloudUid } from '../cloudVisibility';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

/** Cloud en mémoire, avec la même sémantique que les règles : un espace n'appartient qu'à son propriétaire. */
function makeCloud() {
  const spaces = new Map<string, { owner: string; docs: Map<string, CloudRecordDoc> }>();
  const calls = { ensure: 0, fetch: 0, write: 0, del: 0 };
  const fail = { network: 0, loseResponse: 0 };

  const api = (uid: string): CloudRecordsApi => {
    const space = (spaceId: string) => {
      const s = spaces.get(spaceId);
      if (!s || s.owner !== uid) throw new CloudError('permission', 'permission-denied');
      return s;
    };
    return {
      async ensureSpace() {
        calls.ensure += 1;
        const id = `personal_${uid}`;
        if (!spaces.has(id)) spaces.set(id, { owner: uid, docs: new Map() });
        return id;
      },
      async fetchRecords(spaceId) {
        calls.fetch += 1;
        if (fail.network > 0) {
          fail.network -= 1;
          throw new CloudError('network', 'unavailable');
        }
        return [...space(spaceId).docs.values()].map((d) => JSON.parse(JSON.stringify(d)) as CloudRecordDoc);
      },
      async writeRecord(spaceId, doc: CloudRecordWrite, opts) {
        calls.write += 1;
        if (fail.network > 0) {
          fail.network -= 1;
          throw new CloudError('network', 'unavailable');
        }
        const s = space(spaceId);
        const remote = s.docs.get(doc.id);
        if (remote && !opts.force && (opts.expectedRev === null || remote.rev !== opts.expectedRev || remote.deletedAt)) {
          throw new CloudError('conflict', 'rev', JSON.parse(JSON.stringify(remote)) as CloudRecordDoc);
        }
        const rev = (remote?.rev ?? 0) + 1;
        s.docs.set(doc.id, { ...JSON.parse(JSON.stringify(doc)), rev });
        if (fail.loseResponse > 0) {
          fail.loseResponse -= 1;
          throw new CloudError('network', 'réponse perdue'); // l'écriture a eu lieu, la confirmation n'est pas arrivée
        }
        return rev;
      },
      async markDeleted(spaceId, id, deletedAt, opts) {
        calls.del += 1;
        const s = space(spaceId);
        const remote = s.docs.get(id);
        if (!remote || remote.rev !== opts.expectedRev) throw new CloudError('conflict', 'rev', remote ?? null);
        s.docs.set(id, { ...remote, deletedAt, rev: remote.rev + 1 });
        return remote.rev + 1;
      },
    };
  };
  return { api, spaces, calls, fail };
}

/** Simule un autre téléphone : mémoire locale et stockage vides. */
async function freshDevice() {
  records.length = 0; // l'outil Immobilier est mis en cache par le service : on ne vide que les données
  externalContacts.length = 0;
  await AsyncStorage.clear();
}

beforeEach(async () => {
  await freshDevice();
  setActiveCloudUid('uidA'); // le compte A est connecté sur ce téléphone (les tests B changent de compte explicitement)
});

describe('Activation : aucune donnée n’est envoyée par la connexion', () => {
  it('sans activation, la synchronisation est refusée et le cloud n’est pas sollicité', async () => {
    const cloud = makeCloud();
    await expect(syncNow(cloud.api('uidA'), 'uidA')).rejects.toThrow(/pas activée/);
    expect(cloud.calls).toEqual({ ensure: 0, fetch: 0, write: 0, del: 0 });
  });

  it('les données existantes avant l’activation restent « locales » et ne sont jamais envoyées d’elles-mêmes', async () => {
    const old = await createBien({ nom: 'Maison ancienne', adresse: 'Lomé' });
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date(Date.now() + 5));
    await new Promise((r) => setTimeout(r, 15));
    const out = await syncNow(cloud.api('uidA'), 'uidA');
    expect(displayState(out.state, old.id)).toBe('local');
    expect(cloud.spaces.get('personal_uidA')!.docs.size).toBe(0);
    expect(cloud.calls.write).toBe(0);
  });
});

describe('Biens et logements : en attente, confirmé, relations et identifiants conservés', () => {
  it('une création est « en attente » tant que Firestore n’a pas confirmé, puis « synchronisée »', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison Agoè', adresse: 'Lomé' });
    cloud.fail.network = 1; // première tentative : hors ligne
    const offline = await syncNow(cloud.api('uidA'), 'uidA');
    expect(displayState(offline.state, bien.id)).toBe('pending'); // jamais présenté comme synchronisé
    expect(countPending(offline.state)).toBe(1);
    expect(cloud.spaces.get('personal_uidA')!.docs.size).toBe(0);
    expect(offline.error).toMatch(/Hors ligne/);

    const online = await syncNow(cloud.api('uidA'), 'uidA');
    expect(displayState(online.state, bien.id)).toBe('synced');
    const doc = cloud.spaces.get('personal_uidA')!.docs.get(bien.id)!;
    expect(doc.rev).toBe(1);
    expect(doc.kind).toBe('bien');
    expect(doc.values.nom).toBe('Maison Agoè');
  });

  it('réessayer ne crée jamais de doublon, y compris quand la réponse du serveur s’est perdue', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison B', adresse: 'Kara' });
    cloud.fail.loseResponse = 1; // l'écriture a eu lieu, mais l'application ne le sait pas
    const first = await syncNow(cloud.api('uidA'), 'uidA');
    expect(displayState(first.state, bien.id)).toBe('pending');
    const second = await syncNow(cloud.api('uidA'), 'uidA'); // le cloud contient déjà exactement cette version
    expect(displayState(second.state, bien.id)).toBe('synced');
    const docs = [...cloud.spaces.get('personal_uidA')!.docs.values()];
    expect(docs).toHaveLength(1);
    expect(docs[0].rev).toBe(1); // pas de révision gaspillée
    const third = await syncNow(cloud.api('uidA'), 'uidA');
    expect(third.push.confirmed).toBe(0); // rien à renvoyer
    expect(cloud.spaces.get('personal_uidA')!.docs.get(bien.id)!.rev).toBe(1);
  });

  it('un logement garde son identifiant et la relation vers son bien ; une modification part avec la révision suivante', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison C', adresse: 'Lomé' });
    const logement = await createLogement({ bienId: bien.id, nom: 'Chambre 1', loyerReference: 25000 });
    await syncNow(cloud.api('uidA'), 'uidA');
    const docs = cloud.spaces.get('personal_uidA')!.docs;
    expect(docs.get(logement.id)!.values.bien).toBe(bien.id);
    expect(docs.get(logement.id)!.kind).toBe('logement');

    await coreService.updateRecord(logement.id, { values: { loyer_reference: 30000 } });
    const state = (await loadSyncState('uidA'))!;
    expect(displayState(state, logement.id)).toBe('synced'); // pas encore détecté : détecté au prochain passage
    const out = await syncNow(cloud.api('uidA'), 'uidA');
    expect(displayState(out.state, logement.id)).toBe('synced');
    expect(docs.get(logement.id)!.rev).toBe(2);
    expect(docs.get(logement.id)!.values.loyer_reference).toBe(30000);
  });

  it('seuls les biens et logements partent : contrats, paiements et contacts restent locaux', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison D', adresse: 'Lomé' });
    const { contrat } = await createLocataireEtContrat({ bienId: bien.id, nouveauLogement: { nom: 'Chambre 1' }, nom: 'Ama', telephone: '90123456', loyerMensuel: 25000, dateEntree: new Date() });
    await enregistrerPaiementLoyer(contrat.id);
    await syncNow(cloud.api('uidA'), 'uidA');
    const docs = [...cloud.spaces.get('personal_uidA')!.docs.values()];
    expect(docs.every((d) => d.kind === 'bien' || d.kind === 'logement')).toBe(true);
    expect(docs).toHaveLength(2);
    expect(JSON.stringify(docs)).not.toContain('Ama');
    expect(JSON.stringify(docs)).not.toContain('90123456');
  });
});

describe('Second appareil et isolation des comptes', () => {
  it('le même compte retrouve les mêmes biens et logements, avec les mêmes identifiants et relations', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison E', adresse: 'Lomé' });
    const logement = await createLogement({ bienId: bien.id, nom: 'Chambre 9', loyerReference: 20000 });
    await syncNow(cloud.api('uidA'), 'uidA');

    await freshDevice(); // téléphone B
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const out = await syncNow(cloud.api('uidA'), 'uidA');
    expect(out.pull).toMatchObject({ created: 2, conflicts: 0 });
    const local = await readLocalImmobilier('uidA');
    expect(local!.bien.map((b) => b.id)).toEqual([bien.id]);
    expect(local!.logement[0]).toMatchObject({ id: logement.id });
    expect(local!.logement[0].values.bien).toBe(bien.id);
    expect(displayState(out.state, bien.id)).toBe('synced');
    const again = await syncNow(cloud.api('uidA'), 'uidA'); // rien de nouveau, rien de renvoyé
    expect(again.push.confirmed).toBe(0);
    expect(again.pull).toMatchObject({ created: 0, updated: 0 });
  });

  it('un autre compte ne voit rien et ne peut rien lire ni écrire dans l’espace du premier', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    await createBien({ nom: 'Maison F', adresse: 'Lomé' });
    await syncNow(cloud.api('uidA'), 'uidA');

    await freshDevice();
    await enableSync(cloud.api('uidB'), 'uidB', new Date());
    const out = await syncNow(cloud.api('uidB'), 'uidB');
    expect(out.pull).toMatchObject({ created: 0 });
    expect((await readLocalImmobilier('uidB'))?.bien ?? []).toHaveLength(0);
    await expect(cloud.api('uidB').fetchRecords('personal_uidA')).rejects.toMatchObject({ code: 'permission' });
    const doc: CloudRecordWrite = { id: 'rec-x', kind: 'bien', values: {}, statusKey: null, createdBy: 'uidB', createdAt: 'a', updatedAt: 'a', deletedAt: null };
    await expect(cloud.api('uidB').writeRecord('personal_uidA', doc, { expectedRev: null })).rejects.toMatchObject({ code: 'permission' });
    expect(cloud.spaces.get('personal_uidA')!.docs.size).toBe(1);
  });
});

describe('Conflits', () => {
  async function twoDevicesWithOneBien() {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison G', adresse: 'Lomé' });
    await syncNow(cloud.api('uidA'), 'uidA');
    return { cloud, bien };
  }

  it('une modification faite ailleurs n’est jamais écrasée en silence : conflit signalé, puis résolu au choix', async () => {
    const { cloud, bien } = await twoDevicesWithOneBien();
    // Autre appareil : même compte, modifie le bien dans le cloud (révision 2).
    const space = cloud.spaces.get('personal_uidA')!;
    space.docs.set(bien.id, { ...space.docs.get(bien.id)!, values: { ...space.docs.get(bien.id)!.values, nom: 'Nom venu du cloud' }, updatedAt: '2099-01-01T00:00:00.000Z', rev: 2 });
    // Cet appareil modifie aussi.
    await coreService.updateRecord(bien.id, { values: { nom: 'Nom local' } });
    const out = await syncNow(cloud.api('uidA'), 'uidA');
    expect(displayState(out.state, bien.id)).toBe('conflict');
    expect(space.docs.get(bien.id)!.values.nom).toBe('Nom venu du cloud'); // le cloud n'a pas été écrasé

    const kept = await resolveConflict(cloud.api('uidA'), 'uidA', bien.id, 'cloud');
    expect(displayState(kept, bien.id)).toBe('synced');
    expect((await coreService.getRecord(bien.id))!.values.nom).toBe('Nom venu du cloud');
  });

  it('garder la version locale l’envoie avec la révision suivante', async () => {
    const { cloud, bien } = await twoDevicesWithOneBien();
    const space = cloud.spaces.get('personal_uidA')!;
    space.docs.set(bien.id, { ...space.docs.get(bien.id)!, updatedAt: '2099-01-01T00:00:00.000Z', rev: 2 });
    await coreService.updateRecord(bien.id, { values: { nom: 'Ma version' } });
    await syncNow(cloud.api('uidA'), 'uidA');
    const next = await resolveConflict(cloud.api('uidA'), 'uidA', bien.id, 'local');
    expect(displayState(next, bien.id)).toBe('synced');
    expect(space.docs.get(bien.id)!.values.nom).toBe('Ma version');
    expect(space.docs.get(bien.id)!.rev).toBe(3);
  });

  it('une modification venue du cloud est appliquée quand rien n’a changé ici', async () => {
    const { cloud, bien } = await twoDevicesWithOneBien();
    const space = cloud.spaces.get('personal_uidA')!;
    space.docs.set(bien.id, { ...space.docs.get(bien.id)!, values: { ...space.docs.get(bien.id)!.values, nom: 'Renommé ailleurs' }, updatedAt: '2099-01-01T00:00:00.000Z', rev: 2 });
    const out = await syncNow(cloud.api('uidA'), 'uidA');
    expect(out.pull).toMatchObject({ updated: 1, conflicts: 0 });
    expect((await coreService.getRecord(bien.id))!.values.nom).toBe('Renommé ailleurs');
  });
});

describe('Suppressions et envoi volontaire des anciennes données', () => {
  it('supprimer un bien ici envoie une suppression logique (aucune suppression physique dans le cloud)', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison H', adresse: 'Lomé' });
    await syncNow(cloud.api('uidA'), 'uidA');
    await deleteBienCascade(bien.id);
    await syncNow(cloud.api('uidA'), 'uidA');
    const doc = cloud.spaces.get('personal_uidA')!.docs.get(bien.id)!;
    expect(doc.deletedAt).toBeTruthy();
    expect(doc.rev).toBe(2);
    expect(doc.values.nom).toBe('Maison H'); // le contenu est conservé
  });

  it('une suppression faite ailleurs est signalée mais jamais appliquée automatiquement ici', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison I', adresse: 'Lomé' });
    await syncNow(cloud.api('uidA'), 'uidA');
    const space = cloud.spaces.get('personal_uidA')!;
    space.docs.set(bien.id, { ...space.docs.get(bien.id)!, deletedAt: new Date().toISOString(), rev: 2 });
    const out = await syncNow(cloud.api('uidA'), 'uidA');
    expect(out.pull).toMatchObject({ deletedElsewhere: 1 });
    expect(await coreService.getRecord(bien.id)).not.toBeNull();
  });

  it('l’envoi des anciennes données est un geste volontaire : aperçu, sauvegarde datée, puis envoi sans doublon', async () => {
    const old = await createBien({ nom: 'Maison ancienne', adresse: 'Lomé' });
    const oldLogement = await createLogement({ bienId: old.id, nom: 'Chambre A', loyerReference: 15000 });
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date(Date.now() + 5));
    await new Promise((r) => setTimeout(r, 15));
    await syncNow(cloud.api('uidA'), 'uidA');
    expect(cloud.spaces.get('personal_uidA')!.docs.size).toBe(0);

    const state = (await loadSyncState('uidA'))!;
    const preview = previewLocalImport(state, await readLocalImmobilier('uidA'));
    expect(preview).toMatchObject({ biens: 1, logements: 1 });

    const imported = await importLocalRecords('uidA');
    expect(imported.imported).toBe(2);
    const backup = await AsyncStorage.getItem(`@formease/${imported.backupKey}`);
    expect(backup).toContain('Maison ancienne'); // sauvegarde avant l'envoi
    expect((await importLocalRecords('uidA')).imported).toBe(0); // idempotent

    await syncNow(cloud.api('uidA'), 'uidA');
    await syncNow(cloud.api('uidA'), 'uidA');
    const docs = cloud.spaces.get('personal_uidA')!.docs;
    expect([...docs.keys()].sort()).toEqual([old.id, oldLogement.id].sort());
    expect(docs.get(old.id)!.rev).toBe(1);
    // les données locales n'ont pas été modifiées par l'envoi
    expect((await coreService.getRecord(old.id))!.values.nom).toBe('Maison ancienne');
  });

  it('la base locale et l’identité u-me ne sont pas modifiées par la synchronisation', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison J', adresse: 'Lomé' });
    const before = JSON.stringify(await coreService.getRecord(bien.id));
    await syncNow(cloud.api('uidA'), 'uidA');
    const after = { ...(await coreService.getRecord(bien.id))! };
    expect(after.cloudOwnerUid).toBe('uidA'); // seul ajout : la marque de propriété du compte
    delete after.cloudOwnerUid;
    expect(JSON.stringify(after)).toBe(before);
    expect(after.createdBy).toBe('u-me');
    const ents = await ensureImmobilierTool();
    expect(ents.tool.ownerId).toBe('u-me');
  });
});

describe('Défaut 1 — jamais « synchronisé » avant la confirmation du cloud', () => {
  const fakeState = (entries: SyncState['entries']): SyncState => ({ uid: 'uidA', spaceId: 'personal_uidA', enabledAt: '2026-01-01T00:00:00.000Z', entries, lastSyncAt: null });
  const rec = (over: Record<string, unknown> = {}) => ({ id: 'r1', entityDefinitionId: 'e', toolId: 't', values: { nom: 'A' }, createdBy: 'u-me', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over }) as never;

  it('une modification locale passe « en attente » avant même que la synchronisation l’ait repérée, puis « synchronisé » après confirmation', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison K', adresse: 'Lomé' });
    const logement = await createLogement({ bienId: bien.id, nom: 'Chambre K', loyerReference: 10000 });
    await syncNow(cloud.api('uidA'), 'uidA');
    const before = (await loadSyncState('uidA'))!;
    expect(displayStates(before)[logement.id]).toBe('synced');
    expect(displayStates(before)[bien.id]).toBe('synced');

    await updateLogement(logement.id, { nom: 'Chambre K', loyerReference: 12000 });
    // état enregistré inchangé (aucun scan encore), mais l'affichage tient compte de la modification locale
    expect(displayStates(before)[logement.id]).toBe('pending');
    expect(displayStates(before)[bien.id]).toBe('synced'); // le bien n'a pas changé : rien n'est faussement signalé

    await syncNow(cloud.api('uidA'), 'uidA');
    const after = (await loadSyncState('uidA'))!;
    expect(displayStates(after)[logement.id]).toBe('synced');
    expect(cloud.spaces.get('personal_uidA')!.docs.get(logement.id)!.values.loyer_reference).toBe(12000);
  });

  it('hors ligne : la modification reste « en attente » et n’est jamais présentée comme synchronisée', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison L', adresse: 'Lomé' });
    const logement = await createLogement({ bienId: bien.id, nom: 'Chambre L', loyerReference: 10000 });
    await syncNow(cloud.api('uidA'), 'uidA');
    await updateLogement(logement.id, { nom: 'Chambre L', loyerReference: 15000 });
    cloud.fail.network = 1;
    const out = await syncNow(cloud.api('uidA'), 'uidA');
    expect(out.error).toMatch(/Hors ligne/);
    expect(displayStates(out.state)[logement.id]).toBe('pending');
    expect(displayStates((await loadSyncState('uidA'))!)[logement.id]).toBe('pending');
  });

  it('conflit et erreur ne sont jamais masqués, même si la version locale n’a pas changé', () => {
    const state = fakeState({
      c: { kind: 'bien', status: 'conflict', rev: 2, localUpdatedAt: '2026-01-01T00:00:00.000Z', lastError: 'Modifié ailleurs.' },
      e: { kind: 'bien', status: 'error', rev: 1, localUpdatedAt: '2026-01-01T00:00:00.000Z', lastError: 'refus' },
    });
    expect(displayState(state, 'c', rec({ id: 'c' }))).toBe('conflict');
    expect(displayState(state, 'e', rec({ id: 'e' }))).toBe('error');
    expect(displayState(state, 'c')).toBe('conflict');
    expect(displayState(state, 'e')).toBe('error');
  });

  it('seul un enregistrement identique à la dernière version confirmée est « synchronisé » (anciens états sans empreinte compris)', () => {
    const state = fakeState({ s: { kind: 'logement', status: 'synced', rev: 1, localUpdatedAt: '2026-01-01T00:00:00.000Z' } }); // pas de localHash
    expect(displayState(state, 's', rec({ id: 's' }))).toBe('synced');
    expect(displayState(state, 's', rec({ id: 's', updatedAt: '2026-01-02T00:00:00.000Z' }))).toBe('pending'); // modifié ici
    expect(displayState(state, 's')).toBe('synced'); // version locale non fournie : on garde le statut confirmé
    expect(displayState(state, 'inconnu', rec({ id: 'inconnu' }))).toBe('local');
    expect(displayState(null, 's')).toBe('local');
  });

  it('badge : « en attente » devient « synchronisation en cours » seulement pendant un envoi ; réussite, erreur et conflit gardent leur état', () => {
    expect(badgeState('pending', false)).toBe('pending');
    expect(badgeState('pending', true)).toBe('syncing');
    expect(badgeState('synced', true)).toBe('synced');
    expect(badgeState('error', true)).toBe('error');
    expect(badgeState('conflict', true)).toBe('conflict');
    expect(badgeState('local', true)).toBe('local');
  });
});

describe('Défaut 2 — une suppression faite ici n’est pas une suppression « ailleurs »', () => {
  it('supprimer un bien (avec son logement) ici : suppressions envoyées, aucune signalée comme faite ailleurs', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison M', adresse: 'Lomé' });
    const logement = await createLogement({ bienId: bien.id, nom: 'Chambre M', loyerReference: 10000 });
    await syncNow(cloud.api('uidA'), 'uidA');

    await deleteBienCascade(bien.id);
    const out = await syncNow(cloud.api('uidA'), 'uidA');
    expect(out.push.confirmed).toBe(2);
    expect(out.pull?.deletedElsewhere).toBe(0);
    const docs = cloud.spaces.get('personal_uidA')!.docs;
    expect(docs.get(bien.id)!.deletedAt).not.toBeNull(); // la suppression logique est bien dans le cloud
    expect(docs.get(logement.id)!.deletedAt).not.toBeNull();
  });

  it('suppression locale en attente et document déjà supprimé dans le cloud : toujours rien à signaler', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison N', adresse: 'Lomé' });
    await syncNow(cloud.api('uidA'), 'uidA');
    await deleteBienCascade(bien.id);
    const state = (await loadSyncState('uidA'))!;
    // suppression locale repérée, pas encore envoyée ; le document est déjà supprimé côté cloud
    const pending = { ...state, entries: { ...state.entries, [bien.id]: { ...state.entries[bien.id], deleted: true, status: 'pending' as const } } };
    const space = cloud.spaces.get('personal_uidA')!;
    space.docs.set(bien.id, { ...space.docs.get(bien.id)!, deletedAt: new Date().toISOString(), rev: 2 });
    const { result } = await pullFromCloud(cloud.api('uidA'), pending);
    expect(result.deletedElsewhere).toBe(0);
  });

  it('une suppression faite par un autre appareil d’un enregistrement présent ici est toujours signalée, jamais appliquée', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison O', adresse: 'Lomé' });
    const logement = await createLogement({ bienId: bien.id, nom: 'Chambre O', loyerReference: 10000 });
    await syncNow(cloud.api('uidA'), 'uidA');
    const space = cloud.spaces.get('personal_uidA')!;
    const stamp = new Date().toISOString();
    space.docs.set(logement.id, { ...space.docs.get(logement.id)!, deletedAt: stamp, rev: 2 }); // supprimé depuis un autre téléphone
    const out = await syncNow(cloud.api('uidA'), 'uidA');
    expect(out.pull?.deletedElsewhere).toBe(1);
    expect(await coreService.getRecord(logement.id)).not.toBeNull(); // non appliqué ici
    expect(await coreService.getRecord(bien.id)).not.toBeNull();
  });

  it('un document supprimé que cet appareil n’a jamais eu n’est ni signalé ni créé', async () => {
    const cloud = makeCloud();
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const bien = await createBien({ nom: 'Maison P', adresse: 'Lomé' });
    await syncNow(cloud.api('uidA'), 'uidA');
    await deleteBienCascade(bien.id);
    await syncNow(cloud.api('uidA'), 'uidA'); // supprimé dans le cloud

    await freshDevice(); // second téléphone du même compte, qui n'a jamais eu ce bien
    await enableSync(cloud.api('uidA'), 'uidA', new Date());
    const out = await syncNow(cloud.api('uidA'), 'uidA');
    expect(out.pull?.deletedElsewhere).toBe(0);
    expect(out.pull?.created).toBe(0);
    expect(await coreService.getRecord(bien.id)).toBeNull();
  });
});
