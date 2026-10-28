// Fondations P1 de la synchronisation hors ligne : registre de types stables, manifeste de relations, métadonnées locales,
// identifiants et données dérivées. Aucun réseau, aucun SDK Firebase, aucun enregistrement synchronisé.

import fs from 'fs';
import path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { coreService } from '../coreService';
import * as dbModule from '../db';
import { entityDefinitions, events, genId, ID_RANDOM_LENGTH, records, tools } from '../db';
import { ensureFacturesTool } from '../facturesService';
import { seedDemoImmobilier } from '../immobilierDemoService';
import { createBien, createLocataireEtContrat, ensureImmobilierTool, resetImmobilierToolCache } from '../immobilierService';
import { COLLECTION_NAMES, replaceCollections, snapshotCollections, switchWorkspace, workspaceId, workspaceKey } from '../persistence';
import { receiptReference } from '../rentReceiptService';
import { applyAdvanceCoverage, enableAdvanceUse } from '../rentAdvanceService';
import { seedDemoTontine } from '../tontineDemoService';
import { formService } from '../formService';
import { coverageRecordId, isCoverageRecordId } from '../sync/derivedIds';
import {
  ALL_KINDS,
  findLogicalDuplicates,
  getKindDefinition,
  isKnownKind,
  KIND,
  KIND_DEFINITIONS,
  kindOfCollection,
  kindOfEntity,
  kindOfRecord,
  kindsToSync,
  naturalKeyOf,
  type Kind,
} from '../sync/kindRegistry';
import {
  createMeta,
  defaultOrigin,
  getSyncMeta,
  loadSyncMeta,
  markConflict,
  markError,
  markPending,
  markSynced,
  SyncMetaCorruptedError,
  syncMetaStorageKey,
  trackRecord,
  updateSyncMeta,
  validateMeta,
} from '../sync/localSyncMeta';
import {
  entityReferencesOf,
  extractReferences,
  findDanglingReferences,
  findRelation,
  findUndeclaredReferenceFields,
  looksLikeReference,
  NON_REFERENCE_FIELDS,
  RELATIONS,
  relationsOf,
  syncOrder,
} from '../sync/relationManifest';
import type { RecordItem } from '@/types/entities';

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const PREFIX = '@formease/';

/** Remet l'application dans l'état d'un premier lancement (collections vides, outils non provisionnés). */
function freshApp() {
  for (const [name, value] of Object.entries(dbModule)) if (Array.isArray(value) && name !== 'formTemplates') value.length = 0;
  dbModule.users.push(dbModule.defaultLocalUser());
  resetImmobilierToolCache();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  freshApp();
});

const FROZEN_KINDS = [
  'activite.evenement',
  'core.contact',
  'core.definition_entite',
  'core.document',
  'core.evenement',
  'core.membre_outil',
  'core.outil',
  'core.regle',
  'core.role',
  'forms.formulaire',
  'forms.reponse',
  'immobilier.bien',
  'immobilier.contrat',
  'immobilier.correction_paiement',
  'immobilier.depense',
  'immobilier.logement',
  'immobilier.paiement',
  'notification.notification',
  'profil.local',
  'tontine.correction_cotisation',
  'tontine.cotisation',
  'tontine.cycle_historique',
  'tontine.groupe',
  'tontine.membre',
  'tontine.tour',
  'utility.facture',
  'utility.facture_partagee',
  'utility.part_locataire',
  'utility.participation',
  'utility.releve',
];

describe('Registre de types métier stables', () => {
  it('les types sont uniques, bien formés et figés (aucun renommage silencieux)', () => {
    expect(new Set(ALL_KINDS).size).toBe(ALL_KINDS.length);
    for (const kind of ALL_KINDS) expect(kind).toMatch(/^[a-z]+\.[a-z_]+$/);
    expect([...ALL_KINDS].sort()).toEqual(FROZEN_KINDS); // ajouter est permis (mettre à jour cette liste), renommer ou retirer ne l'est pas
    expect(Object.values(KIND).sort()).toEqual(FROZEN_KINDS);
    expect(KIND_DEFINITIONS).toHaveLength(FROZEN_KINDS.length);
    for (const kind of ALL_KINDS) expect(isKnownKind(kind)).toBe(true);
    expect(isKnownKind('immobilier.inconnu')).toBe(false);
  });

  it('chaque type a une source unique et une version de schéma ; aucune source n’est partagée', () => {
    const sources = KIND_DEFINITIONS.map((d) => (d.source.type === 'core_record' ? `${d.source.toolKind}/${d.source.entityKey}` : d.source.type === 'collection' ? `collection:${d.source.collection}` : `store:${d.source.store}`));
    expect(new Set(sources).size).toBe(sources.length);
    for (const d of KIND_DEFINITIONS) expect(d.schemaVersion).toBeGreaterThanOrEqual(1);
  });

  it('toutes les collections persistées sont couvertes (le moteur générique l’est par entité)', () => {
    for (const name of COLLECTION_NAMES) {
      if (name === 'records') continue;
      expect(kindOfCollection(name)).not.toBeNull();
    }
    expect(kindOfCollection('records')).toBeNull(); // les enregistrements se typent par entité, jamais en bloc
    expect(kindOfCollection('inconnue')).toBeNull();
  });

  it('les définitions réellement créées par l’application ont toutes un type, et aucun type d’entité n’est orphelin', async () => {
    const immobilier = await ensureImmobilierTool();
    const factures = await ensureFacturesTool();
    const seen = new Set<string>();
    for (const tool of [immobilier.tool, factures.tool]) {
      for (const definition of entityDefinitions.filter((d) => d.toolId === tool.id)) {
        const kind = kindOfEntity(tool.kind, definition.key);
        expect(kind).not.toBeNull();
        seen.add(kind as string);
      }
    }
    const entityKinds = KIND_DEFINITIONS.filter((d) => d.source.type === 'core_record').map((d) => d.kind as string);
    expect([...seen].sort()).toEqual([...entityKinds].sort());
  });

  it('le type d’un enregistrement vient de son entité, jamais des identifiants locaux : un second appareil donne les mêmes types', async () => {
    const bien = await createBien({ nom: 'Maison A', adresse: 'Lomé' });
    expect(kindOfRecord(bien)).toBe(KIND.IMMOBILIER_BIEN);
    const firstToolId = bien.toolId;
    expect(ALL_KINDS.every((k) => !k.includes(firstToolId) && !k.includes(bien.entityDefinitionId))).toBe(true);

    // « second appareil » : mêmes données logiques, outils et définitions recréés avec d'AUTRES identifiants locaux
    for (const list of [tools, entityDefinitions, records]) list.length = 0;
    resetImmobilierToolCache();
    const other = await createBien({ nom: 'Maison A', adresse: 'Lomé' });
    expect(other.toolId).not.toBe(firstToolId);
    expect(kindOfRecord(other)).toBe(KIND.IMMOBILIER_BIEN);
  });

  it('un outil personnalisé ou une entité inconnue n’a pas d’identité cloud (null)', () => {
    expect(kindOfEntity('custom', 'bien')).toBeNull();
    expect(kindOfEntity('immobilier', 'inconnue')).toBeNull();
    expect(kindOfRecord({ toolId: 'tool-absent', entityDefinitionId: 'ed-absent' })).toBeNull();
  });

  it('les types à synchroniser excluent journaux, définitions système, pièces jointes locales et profil', () => {
    const planned = new Set<Kind>(kindsToSync());
    for (const k of [KIND.IMMOBILIER_BIEN, KIND.IMMOBILIER_PAIEMENT, KIND.UTILITY_RELEVE, KIND.TONTINE_COTISATION, KIND.CORE_CONTACT, KIND.FORMS_REPONSE]) expect(planned.has(k)).toBe(true);
    for (const k of [KIND.ACTIVITE_EVENEMENT, KIND.CORE_EVENEMENT, KIND.CORE_OUTIL, KIND.CORE_DEFINITION_ENTITE, KIND.CORE_DOCUMENT, KIND.PROFIL_LOCAL, KIND.NOTIFICATION, KIND.TONTINE_CYCLE_HISTORIQUE]) {
      expect(planned.has(k)).toBe(false);
    }
    expect(getKindDefinition(KIND.IMMOBILIER_PAIEMENT).financialFact).toBe(true);
    expect(getKindDefinition(KIND.TONTINE_COTISATION).financialFact).toBe(true);
    expect(getKindDefinition(KIND.IMMOBILIER_BIEN).financialFact).toBe(false);
  });
});

describe('Manifeste de relations', () => {
  it('chaque relation vise des types connus ; aucune déclaration en double', () => {
    const seen = new Set<string>();
    for (const r of RELATIONS) {
      expect(isKnownKind(r.kind)).toBe(true);
      for (const t of r.targets) expect(isKnownKind(t)).toBe(true);
      const id = `${r.kind}/${r.field}`;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      if (r.type === 'relation' || r.type === 'text_ref') expect(r.targets.length > 0 || r.polymorphic !== undefined || r.type === 'text_ref').toBe(true);
      if (r.type === 'identity_ref' || r.type === 'static_ref' || r.type === 'local_id') expect(r.targets).toHaveLength(0);
    }
  });

  it('les relations importantes sont déclarées, avec la distinction relation déclarée / texte-référence', () => {
    const expected: [Kind, string, string][] = [
      [KIND.IMMOBILIER_LOGEMENT, 'bien', 'relation'],
      [KIND.IMMOBILIER_CONTRAT, 'logement', 'relation'],
      [KIND.IMMOBILIER_CONTRAT, 'bien', 'relation'],
      [KIND.IMMOBILIER_CONTRAT, 'locataire_id', 'text_ref'],
      [KIND.IMMOBILIER_PAIEMENT, 'contrat', 'relation'],
      [KIND.IMMOBILIER_PAIEMENT, 'locataire_id', 'text_ref'],
      [KIND.IMMOBILIER_DEPENSE, 'bien', 'relation'],
      [KIND.UTILITY_FACTURE, 'bien_id', 'text_ref'],
      [KIND.UTILITY_RELEVE, 'participant_id', 'text_ref'],
      [KIND.UTILITY_PART_LOCATAIRE, 'facture_partagee', 'relation'],
      [KIND.UTILITY_PART_LOCATAIRE, 'participant_id', 'text_ref'],
      [KIND.UTILITY_PART_LOCATAIRE, 'releve_precedent_id', 'text_ref'],
      [KIND.UTILITY_PART_LOCATAIRE, 'releve_actuel_id', 'text_ref'],
      [KIND.UTILITY_PARTICIPATION, 'participant_id', 'text_ref'],
      [KIND.TONTINE_MEMBRE, 'groupId', 'relation'],
      [KIND.TONTINE_TOUR, 'beneficiaryMemberId', 'relation'],
      [KIND.TONTINE_COTISATION, 'tourId', 'relation'],
      [KIND.TONTINE_COTISATION, 'memberId', 'relation'],
      [KIND.FORMS_REPONSE, 'formId', 'relation'],
      [KIND.CORE_CONTACT, 'linkedUserId', 'identity_ref'],
      [KIND.IMMOBILIER_BIEN, 'toolId', 'local_id'],
      [KIND.IMMOBILIER_BIEN, 'entityDefinitionId', 'local_id'],
    ];
    for (const [kind, field, type] of expected) expect(findRelation(kind, field)?.type).toBe(type);
  });

  it('les identifiants locaux d’outil et de définition sont déclarés « propres à l’appareil » pour tout type du moteur générique', () => {
    for (const d of KIND_DEFINITIONS.filter((x) => x.source.type === 'core_record')) {
      expect(findRelation(d.kind, 'toolId')?.type).toBe('local_id');
      expect(findRelation(d.kind, 'entityDefinitionId')?.type).toBe('local_id');
      expect(findRelation(d.kind, 'createdBy')?.type).toBe('identity_ref'); // « u-me » n'est ni un compte ni un droit d'accès
    }
  });

  it('toutes les relations des définitions RÉELLES sont déclarées, et tout champ texte qui ressemble à une référence l’est aussi', async () => {
    const immobilier = await ensureImmobilierTool();
    const factures = await ensureFacturesTool();
    const problems: string[] = [];
    for (const tool of [immobilier.tool, factures.tool]) {
      for (const definition of entityDefinitions.filter((d) => d.toolId === tool.id)) {
        const kind = kindOfEntity(tool.kind, definition.key) as Kind;
        for (const field of definition.fields) {
          const declared = findRelation(kind, field.key);
          const exempt = NON_REFERENCE_FIELDS[kind]?.[field.key];
          if (field.type === 'relation' && declared?.type !== 'relation') problems.push(`${kind}.${field.key} : relation du moteur non déclarée`);
          if (field.type !== 'relation' && looksLikeReference(field.key) && !declared && !exempt) problems.push(`${kind}.${field.key} : texte ressemblant à une référence, non déclaré`);
          if (declared && declared.type === 'relation' && field.type !== 'relation') problems.push(`${kind}.${field.key} : déclaré « relation » mais de type ${field.type}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('aucun élément réel (immobilier, tontine, formulaires, contacts, outils) ne porte de champ de référence non déclaré', async () => {
    await seedDemoImmobilier();
    await seedDemoTontine();
    const form = await formService.createForm({ title: 'Formulaire de test' });
    expect(form.id).toBeTruthy();
    const snapshot = snapshotCollections();
    const checked: Record<string, number> = {};
    const bad: string[] = [];
    for (const name of COLLECTION_NAMES) {
      for (const item of snapshot[name] as Record<string, unknown>[]) {
        const kind = name === 'records' ? kindOfRecord(item as unknown as RecordItem) : kindOfCollection(name);
        if (!kind) continue;
        checked[kind] = (checked[kind] ?? 0) + 1;
        for (const field of findUndeclaredReferenceFields(kind, item)) bad.push(`${kind}.${field}`);
      }
    }
    expect(bad).toEqual([]);
    for (const kind of [KIND.IMMOBILIER_BIEN, KIND.IMMOBILIER_LOGEMENT, KIND.IMMOBILIER_CONTRAT, KIND.CORE_CONTACT, KIND.TONTINE_GROUPE, KIND.TONTINE_MEMBRE, KIND.TONTINE_TOUR, KIND.TONTINE_COTISATION, KIND.FORMS_FORMULAIRE, KIND.CORE_OUTIL]) {
      expect(checked[kind]).toBeGreaterThan(0); // la vérification a réellement porté sur des données de chaque type
    }
  });

  it('une référence inconnue est détectée ; une exception justifiée (formeaseId) ne l’est pas ; les références déclarées non plus', () => {
    expect(findUndeclaredReferenceFields(KIND.IMMOBILIER_CONTRAT, { values: { proprietaire_id: 'x', locataire_id: 'c1' } })).toEqual(['proprietaire_id']);
    expect(findUndeclaredReferenceFields(KIND.TONTINE_COTISATION, { groupId: 'g', tourId: 't', memberId: 'm', responsableId: 'u' })).toEqual(['responsableId']);
    expect(findUndeclaredReferenceFields(KIND.PROFIL_LOCAL, { id: 'u-me', formeaseId: 'FE-4821' })).toEqual([]);
    expect(findUndeclaredReferenceFields(KIND.CORE_OUTIL, { id: 't', entityDefinitionIds: ['a'] })).toEqual([]);
    expect(looksLikeReference('id')).toBe(false);
    expect(looksLikeReference('releve_actuel_id')).toBe(true);
    expect(looksLikeReference('beneficiaryMemberId')).toBe(true);
    expect(looksLikeReference('reference_compteur')).toBe(false);
  });

  it('les références sont extraites sans interprétation hasardeuse : type variable résolu par son discriminant, saisie libre sans cible', () => {
    const base = { id: 'r1', values: {} as Record<string, unknown> };
    const releve = (values: Record<string, unknown>) => extractReferences(KIND.UTILITY_RELEVE, { ...base, values });
    expect(releve({ participant_type: 'contrat', participant_id: 'rec-1' })).toEqual([{ field: 'participant_id', type: 'text_ref', targetKind: KIND.IMMOBILIER_CONTRAT, id: 'rec-1' }]);
    expect(releve({ participant_type: 'contact', participant_id: 'contact-1' })[0].targetKind).toBe(KIND.CORE_CONTACT);
    expect(releve({ participant_type: 'manuel', participant_id: 'x' })[0].targetKind).toBeNull();
    expect(releve({ participant_id: 'rec-1' })[0].targetKind).toBeNull(); // discriminant absent : on ne devine pas
    expect(releve({ participant_type: 'contrat' })).toEqual([]); // pas de valeur : pas de référence
    expect(releve({ note: 'rec-123' })).toEqual([]); // une simple chaîne n'est jamais une référence
    expect(extractReferences(KIND.IMMOBILIER_PAIEMENT, { id: 'p', values: { contrat: 'rec-c', locataire_id: 'contact-x', montant: 25000 } }).map((r) => r.field).sort()).toEqual(['contrat', 'locataire_id']);
    expect(entityReferencesOf(KIND.IMMOBILIER_BIEN)).toEqual([]);
    expect(relationsOf(KIND.IMMOBILIER_BIEN).length).toBeGreaterThan(0);
  });

  it('les références orphelines sont repérées (lecture seule) à partir des données réelles', async () => {
    await seedDemoImmobilier();
    const ents = await ensureImmobilierTool();
    const exists = (kind: Kind, id: string) => {
      if (kind === KIND.CORE_CONTACT) return dbModule.externalContacts.some((c) => c.id === id);
      return records.some((r) => r.id === id && kindOfRecord(r) === kind);
    };
    const contrats = records.filter((r) => r.entityDefinitionId === ents.contrat.id);
    expect(contrats.length).toBeGreaterThan(0);
    const before = JSON.stringify(records);
    for (const c of contrats) expect(findDanglingReferences(KIND.IMMOBILIER_CONTRAT, c as unknown as Record<string, unknown>, exists)).toEqual([]);
    const broken = { ...contrats[0], values: { ...contrats[0].values, logement: 'rec-inexistant' } };
    expect(findDanglingReferences(KIND.IMMOBILIER_CONTRAT, broken as unknown as Record<string, unknown>, exists).map((d) => d.field)).toEqual(['logement']);
    expect(JSON.stringify(records)).toBe(before); // aucune écriture
  });

  it('l’ordre d’envoi place toujours les parents avant les enfants, sans cycle', () => {
    const order = syncOrder();
    const at = (k: Kind) => order.indexOf(k);
    expect(order.length).toBe(kindsToSync().length);
    const chains: Kind[][] = [
      [KIND.IMMOBILIER_BIEN, KIND.IMMOBILIER_LOGEMENT, KIND.IMMOBILIER_CONTRAT, KIND.IMMOBILIER_PAIEMENT],
      [KIND.CORE_CONTACT, KIND.IMMOBILIER_CONTRAT],
      [KIND.TONTINE_GROUPE, KIND.TONTINE_MEMBRE, KIND.TONTINE_TOUR, KIND.TONTINE_COTISATION],
      [KIND.UTILITY_RELEVE, KIND.UTILITY_PART_LOCATAIRE],
      [KIND.UTILITY_FACTURE_PARTAGEE, KIND.UTILITY_PART_LOCATAIRE],
      [KIND.FORMS_FORMULAIRE, KIND.FORMS_REPONSE],
    ];
    for (const chain of chains) {
      for (let i = 1; i < chain.length; i += 1) {
        expect(at(chain[i - 1])).toBeGreaterThanOrEqual(0);
        expect(at(chain[i - 1])).toBeLessThan(at(chain[i]));
      }
    }
  });
});

describe('Métadonnées locales de synchronisation', () => {
  const T0 = new Date('2026-10-17T10:00:00.000Z');

  it('état initial local ; transitions pures sans perte (une suppression en attente reste une suppression)', () => {
    const meta = createMeta(KIND.IMMOBILIER_BIEN, 'user', T0);
    expect(meta).toMatchObject({ status: 'local', pendingOp: null, baseRev: 0, origin: 'user', attempts: 0, lastError: null, migrationBatchId: null });
    const created = markPending(meta, 'create', T0);
    expect(created).toMatchObject({ status: 'pending', pendingOp: 'create' });
    expect(markPending(created, 'update', T0).pendingOp).toBe('create'); // créé puis modifié avant l'envoi : toujours une création
    const deleting = markPending(markPending(meta, 'update', T0), 'delete', T0);
    expect(deleting.pendingOp).toBe('delete');
    expect(markPending(deleting, 'update', T0).pendingOp).toBe('delete'); // jamais rétrogradée en modification
    const failed = markError(created, 'x'.repeat(500), new Date('2026-10-17T10:05:00.000Z'), T0);
    expect(failed).toMatchObject({ status: 'error', attempts: 1, pendingOp: 'create', nextRetryAt: '2026-10-17T10:05:00.000Z' });
    expect(failed.lastError).toHaveLength(300);
    expect(markError(failed, 'y', null, T0).attempts).toBe(2);
    const synced = markSynced(failed, 7, T0);
    expect(synced).toMatchObject({ status: 'synced', pendingOp: null, baseRev: 7, attempts: 0, lastError: null, nextRetryAt: null });
    expect(markConflict(markPending(synced, 'update', T0), 'modifié ailleurs', T0)).toMatchObject({ status: 'conflict', pendingOp: 'update' });
  });

  it('les entrées incohérentes sont rejetées', () => {
    const ok = createMeta(KIND.IMMOBILIER_BIEN, 'user', T0);
    expect(validateMeta(ok)).toEqual([]);
    expect(validateMeta({ ...ok, kind: 'immobilier.inconnu' })).toContain('type inconnu');
    expect(validateMeta({ ...ok, status: 'synchronisé' })).toContain('statut inconnu');
    expect(validateMeta({ ...ok, status: 'pending', pendingOp: null })).toContain('statut « pending » sans opération');
    expect(validateMeta({ ...ok, origin: 'cloud' })).toContain('origine inconnue');
    expect(validateMeta({ ...ok, baseRev: -1 })).toContain('révision invalide');
    expect(validateMeta({ ...ok, attempts: 1.5 })).toContain('nombre de tentatives invalide');
    expect(validateMeta(null)).toEqual(['entrée absente ou illisible']);
  });

  it('séparées des données métier : stockées sous leur propre clé, jamais dans les enregistrements ni dans leur stockage', async () => {
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await coreService.createExternalContact({ name: 'Koffi' });
    const snapshotBefore = JSON.stringify(snapshotCollections());
    await trackRecord(bien.id, KIND.IMMOBILIER_BIEN);
    await updateSyncMeta((store) => ({ ...store, entries: { ...store.entries, [bien.id]: markPending(store.entries[bien.id], 'create') } }));
    expect(syncMetaStorageKey()).toBe('sync_meta');
    expect(await AsyncStorage.getItem(`${PREFIX}sync_meta`)).toContain(bien.id);
    expect((await getSyncMeta(bien.id))?.status).toBe('pending');
    expect(JSON.stringify(snapshotCollections())).toBe(snapshotBefore); // aucun champ ajouté aux données métier
    const stored = JSON.stringify(records);
    for (const field of ['pendingOp', 'baseRev', 'attempts', 'nextRetryAt', 'migrationBatchId']) expect(stored).not.toContain(field);
    const businessKeys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX) && k !== `${PREFIX}sync_meta`);
    for (const key of businessKeys) expect((await AsyncStorage.getItem(key)) ?? '').not.toContain('pendingOp');
  });

  it('propres à chaque espace de travail : la démonstration n’écrit jamais dans le magasin personnel et sa nature est « demo »', async () => {
    expect(workspaceId()).toBe('personal');
    expect(defaultOrigin()).toBe('user');
    await trackRecord('rec-personnel', KIND.IMMOBILIER_BIEN);
    const personalRaw = await AsyncStorage.getItem(`${PREFIX}sync_meta`);
    await switchWorkspace('demo');
    try {
      expect(workspaceId()).toBe('demo');
      expect(syncMetaStorageKey()).toBe('demo/sync_meta');
      expect(defaultOrigin()).toBe('demo');
      expect(Object.keys((await loadSyncMeta()).entries)).toEqual([]); // le magasin de démonstration est vide
      await trackRecord('rec-demo', KIND.IMMOBILIER_BIEN);
      expect((await getSyncMeta('rec-demo'))?.origin).toBe('demo');
      expect(await AsyncStorage.getItem(`${PREFIX}sync_meta`)).toBe(personalRaw); // magasin personnel strictement inchangé
    } finally {
      await switchWorkspace('personal');
    }
    expect(await getSyncMeta('rec-demo')).toBeNull();
    expect((await getSyncMeta('rec-personnel'))?.origin).toBe('user');
  });

  it('un magasin illisible n’est JAMAIS traité comme vide ni écrasé', async () => {
    for (const corrupt of ['{pas du json', JSON.stringify({ schemaVersion: 99, entries: {} }), JSON.stringify({ schemaVersion: 1, entries: { x: { kind: 'inconnu' } } })]) {
      await AsyncStorage.setItem(`${PREFIX}sync_meta`, corrupt);
      await expect(loadSyncMeta()).rejects.toBeDefined();
      await expect(trackRecord('rec-1', KIND.IMMOBILIER_BIEN)).rejects.toBeDefined();
      expect(await AsyncStorage.getItem(`${PREFIX}sync_meta`)).toBe(corrupt); // intact, pour analyse
    }
    await AsyncStorage.setItem(`${PREFIX}sync_meta`, JSON.stringify({ schemaVersion: 1, entries: { x: { kind: 'inconnu' } } }));
    await expect(loadSyncMeta()).rejects.toBeInstanceOf(SyncMetaCorruptedError);
  });

  it('une modification qui produirait une entrée invalide n’écrit rien ; les mises à jour simultanées ne s’écrasent pas', async () => {
    await trackRecord('rec-1', KIND.IMMOBILIER_BIEN);
    const before = await AsyncStorage.getItem(`${PREFIX}sync_meta`);
    await expect(updateSyncMeta((s) => ({ ...s, entries: { ...s.entries, 'rec-1': { ...s.entries['rec-1'], status: 'pending', pendingOp: null } } }))).rejects.toBeInstanceOf(SyncMetaCorruptedError);
    expect(await AsyncStorage.getItem(`${PREFIX}sync_meta`)).toBe(before);
    await Promise.all(Array.from({ length: 10 }, (_, i) => trackRecord(`rec-p${i}`, KIND.IMMOBILIER_PAIEMENT)));
    expect(Object.keys((await loadSyncMeta()).entries)).toHaveLength(11);
  });

  it('aucun module de synchronisation P1 n’utilise Firebase ni le réseau, et aucun code de production existant ne l’appelle', () => {
    const root = path.join(__dirname, '..', '..');
    const dir = path.join(root, 'services', 'sync');
    for (const file of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      const imports = src.split('\n').filter((line) => /^import /.test(line)).join('\n'); // les commentaires peuvent citer ces noms
      expect(imports).not.toMatch(/firebase|firestore|cloudSyncService|netinfo|axios/i);
      expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|new WebSocket/);
    }
    for (const rel of ['services/cloudSyncService.ts', 'services/firebase/firestoreRecordsApi.ts']) {
      expect(fs.readFileSync(path.join(root, rel), 'utf8')).not.toMatch(/services\/sync|\.\/sync\//); // le mécanisme actuel est intact
    }
    // P5 : le store du compte n'utilise que l'isolation par compte (portée du compte et oubli technique) — jamais le moteur
    const store = fs.readFileSync(path.join(root, 'store/cloudStore.ts'), 'utf8');
    expect([...store.matchAll(/from '@\/services\/sync\/(\w+)'/g)].map((m) => m[1]).sort()).toEqual(['syncAccount', 'syncAccountCleanup']);
    expect(fs.readFileSync(path.join(root, 'constants/features.ts'), 'utf8')).toMatch(/CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor\(BUILD_TARGET\);/);
  });
});

describe('Identifiants et données dérivées', () => {
  const OCT = new Date(2026, 9, 12);
  let counter = 0;
  async function newContrat() {
    counter += 1;
    const bien = await createBien({ nom: `Maison ${counter}`, adresse: 'Lomé' });
    const { contrat } = await createLocataireEtContrat({
      bienId: bien.id,
      nouveauLogement: { nom: `Chambre ${counter}` },
      nom: `Locataire ${counter}`,
      telephone: '90123456',
      loyerMensuel: 25000,
      dateEntree: new Date(2026, 0, 5),
      avance: 75000,
      caution: 75000,
      dernierLoyerPaye: '2026-09',
    });
    return contrat;
  }
  const paiementsOf = async (contratId: string) => {
    const ents = await ensureImmobilierTool();
    return (await coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.paiement.id })).filter((p) => p.values.contrat === contratId);
  };

  it('une couverture par l’avance a un identifiant déterministe « cov-<contrat>-<mois> », de type paiement, avec sa clé logique', async () => {
    const contrat = await newContrat();
    await enableAdvanceUse(contrat.id, OCT);
    const [cover] = await paiementsOf(contrat.id);
    expect(cover.id).toBe(coverageRecordId(contrat.id, '2026-10'));
    expect(isCoverageRecordId(cover.id)).toBe(true);
    expect(kindOfRecord(cover)).toBe(KIND.IMMOBILIER_PAIEMENT);
    expect(naturalKeyOf(KIND.IMMOBILIER_PAIEMENT, cover as unknown as Record<string, unknown>)).toBe(`couvert|${contrat.id}|2026-10`);
  });

  it('idempotence : relancer ou exécuter en parallèle ne crée jamais deux fois la même couverture', async () => {
    const contrat = await newContrat();
    await enableAdvanceUse(contrat.id, OCT);
    await Promise.all([applyAdvanceCoverage(contrat.id, OCT), applyAdvanceCoverage(contrat.id, OCT)]);
    await applyAdvanceCoverage(contrat.id, OCT);
    const paiements = await paiementsOf(contrat.id);
    expect(paiements).toHaveLength(1);
    expect(findLogicalDuplicates(KIND.IMMOBILIER_PAIEMENT, paiements as unknown as Record<string, unknown>[])).toEqual([]);
  });

  it('deux « appareils » qui calculent la même couverture produisent le MÊME enregistrement (création idempotente par identifiant)', async () => {
    const contrat = await newContrat();
    const ents = await ensureImmobilierTool();
    const input = { id: coverageRecordId(contrat.id, '2026-10'), toolId: ents.tool.id, entityDefinitionId: ents.paiement.id, statusKey: 'couvert', values: { contrat: contrat.id, mois: '2026-10', montant: 25000, source: 'avance' } };
    const eventsBefore = events.length;
    const first = await coreService.createRecord(input);
    const second = await coreService.createRecord(input);
    expect(second).toBe(first);
    expect((await paiementsOf(contrat.id)).filter((p) => p.id === input.id)).toHaveLength(1);
    expect(events.length - eventsBefore).toBe(1); // un seul événement : le second appel n'a rien créé
  });

  it('compatibilité : une couverture ancienne (identifiant aléatoire) est conservée telle quelle et n’est pas doublée', async () => {
    const contrat = await newContrat();
    const ents = await ensureImmobilierTool();
    const legacy = await coreService.createRecord({
      toolId: ents.tool.id,
      entityDefinitionId: ents.paiement.id,
      statusKey: 'couvert',
      values: { contrat: contrat.id, mois: '2026-10', montant: 25000, source: 'avance', avance_avant: 75000, avance_restante: 50000 },
    });
    expect(legacy.id).toMatch(/^rec-/);
    expect(isCoverageRecordId(legacy.id)).toBe(false);
    await coreService.updateRecord(contrat.id, { values: { avance_utilisable: true, avance_depuis: '2026-10' } });
    expect(await applyAdvanceCoverage(contrat.id, OCT)).toEqual([]); // mois déjà couvert : rien à créer
    const paiements = await paiementsOf(contrat.id);
    expect(paiements.map((p) => p.id)).toEqual([legacy.id]);
    expect(findLogicalDuplicates(KIND.IMMOBILIER_PAIEMENT, paiements as unknown as Record<string, unknown>[])).toEqual([]);
  });

  it('les doublons logiques déjà existants (identifiants différents, même fait) sont repérés sans rien modifier', () => {
    const cover = (id: string): Record<string, unknown> => ({ id, statusKey: 'couvert', values: { contrat: 'rec-c', mois: '2026-10' } });
    const paye: Record<string, unknown> = { id: 'rec-p', statusKey: 'paye', values: { contrat: 'rec-c', mois: '2026-10' } };
    const rejete: Record<string, unknown> = { id: 'rec-r', statusKey: 'rejete', values: { contrat: 'rec-c', mois: '2026-10' } };
    expect(findLogicalDuplicates(KIND.IMMOBILIER_PAIEMENT, [cover('rec-1'), cover('cov-rec-c-2026-10'), paye, rejete])).toEqual([{ key: 'couvert|rec-c|2026-10', ids: ['rec-1', 'cov-rec-c-2026-10'] }]);
    // les paiements ordinaires n'ont PAS de clé logique : un loyer rejeté puis payé est légitime
    expect(naturalKeyOf(KIND.IMMOBILIER_PAIEMENT, paye)).toBeNull();
    const cot = (id: string): Record<string, unknown> => ({ id, tourId: 'g-1-tour-3', memberId: 'm-1' });
    expect(findLogicalDuplicates(KIND.TONTINE_COTISATION, [cot('ct-a'), cot('ct-b'), { id: 'ct-c', tourId: 'g-1-tour-3', memberId: 'm-2' }])).toEqual([{ key: 'g-1-tour-3|m-1', ids: ['ct-a', 'ct-b'] }]);
    expect(naturalKeyOf(KIND.UTILITY_RELEVE, { id: 'r', values: { fournisseur: 'ceet', mois: '2026-10', participant_type: 'manuel' } })).toBeNull(); // sans identifiant de participant : pas de clé
    expect(naturalKeyOf(KIND.UTILITY_RELEVE, { id: 'r', values: { fournisseur: 'ceet', mois: '2026-10', participant_type: 'contrat', participant_id: 'rec-c' } })).toBe('ceet|2026-10|contrat|rec-c');
  });

  it('un identifiant imposé invalide ou appartenant à un autre type d’enregistrement est refusé', async () => {
    const ents = await ensureImmobilierTool();
    const base = { toolId: ents.tool.id, entityDefinitionId: ents.paiement.id, values: { mois: '2026-10' } };
    await expect(coreService.createRecord({ ...base, id: 'a/b' })).rejects.toThrow(/invalide/);
    await expect(coreService.createRecord({ ...base, id: '' })).rejects.toThrow(/invalide/);
    const bien = await createBien({ nom: 'Maison', adresse: 'Lomé' });
    await expect(coreService.createRecord({ ...base, id: bien.id })).rejects.toThrow(/autre type/);
    expect(() => coverageRecordId('rec/x', '2026-10')).toThrow();
    expect(() => coverageRecordId('rec-x', '2026-13')).toThrow();
  });

  it('nouveaux identifiants : 16 caractères aléatoires, uniques ; les anciens (8 caractères) restent lisibles et inchangés', async () => {
    expect(ID_RANDOM_LENGTH).toBe(16);
    const ids = Array.from({ length: 3000 }, () => genId('rec'));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids.slice(0, 50)) expect(id).toMatch(/^rec-[A-Za-z0-9_-]{16}$/);
    // un enregistrement stocké avant P1 (identifiant à 8 caractères) reste valide pour tous les lecteurs
    const ents = await ensureImmobilierTool();
    const legacy: RecordItem = { id: 'rec-AbCd1234', entityDefinitionId: ents.bien.id, toolId: ents.tool.id, values: { nom: 'Ancien', adresse: 'x' }, createdBy: 'u-me', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    records.push(legacy);
    expect(kindOfRecord(legacy)).toBe(KIND.IMMOBILIER_BIEN);
    expect((await coreService.getRecord('rec-AbCd1234'))?.values.nom).toBe('Ancien');
    expect(receiptReference('rec-AbCd1234')).toBe('TKD-ABCD1234'); // référence de reçu des anciens paiements : inchangée
    expect(receiptReference(ids[0])).toMatch(/^TKD-[A-Z0-9]{8}$/);
  });

  it('les lectures du registre et du manifeste ne modifient aucune donnée (ni enregistrement, ni stockage)', async () => {
    await seedDemoImmobilier();
    await seedDemoTontine();
    const memory = JSON.stringify(snapshotCollections());
    const keysBefore = (await AsyncStorage.getAllKeys()).length;
    for (const name of COLLECTION_NAMES) {
      for (const item of snapshotCollections()[name] as Record<string, unknown>[]) {
        const kind = name === 'records' ? kindOfRecord(item as unknown as RecordItem) : kindOfCollection(name);
        if (!kind) continue;
        extractReferences(kind, item);
        findUndeclaredReferenceFields(kind, item);
        naturalKeyOf(kind, item);
      }
    }
    expect(JSON.stringify(snapshotCollections())).toBe(memory);
    expect((await AsyncStorage.getAllKeys()).length).toBe(keysBefore);
    expect(workspaceKey('db_snapshot')).toBe('db_snapshot'); // clés de l'espace personnel inchangées
  });

  it('le remplacement de collections reste réservé à la restauration : le registre, lui, n’en dépend pas', () => {
    expect(typeof replaceCollections).toBe('function');
    for (const file of ['kindRegistry.ts', 'relationManifest.ts', 'derivedIds.ts']) {
      expect(fs.readFileSync(path.join(__dirname, '..', 'sync', file), 'utf8')).not.toMatch(/replaceCollections|storage\.set|\.splice\(/);
    }
  });
});
