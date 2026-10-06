// Étape 6 — rattachement explicite des anciens relevés « saisie libre » à une personne.

jest.mock('../db', () => ({ ...jest.requireActual('../db'), delay: () => Promise.resolve() }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { coreService } from '../coreService';
import { records } from '../db';
import { hydrateDb, startAutoPersist } from '../persistence';
import { ensureFacturesToolCached } from '../facturesService';
import { createFacturePartagee, loadLockedReleveIds, resolveParticipantReleves, saveReleve } from '../utilityBillingService';
import { addExistingContact, addParticipant, archiveParticipation, listParticipations, saveRelevesPeriode } from '../utilityParticipantsService';
import { attachLegacyGroup, groupLegacyReleves, listLegacyGroups } from '../utilityLegacyService';
import { buildDashboard } from '../utilityOverviewService';
import { friendlyMessage } from '@/features/utilities/errors';
import type { RecordItem } from '@/types/entities';

const read = (rel: string): string => require('fs').readFileSync(require('path').join(__dirname, '../..', rel), 'utf8'); // eslint-disable-line @typescript-eslint/no-require-imports

let seq = 0;
const uniq = (base: string) => `${base} L${++seq}`;

async function legacy(label: string, mois: string, index: number, fournisseur = 'CEET'): Promise<RecordItem> {
  const ents = await ensureFacturesToolCached();
  return coreService.createRecord({
    toolId: ents.tool.id,
    entityDefinitionId: ents.releveDefinition.id,
    values: { fournisseur, mois, compteur: label, index, participant_type: 'manuel', participant_id: null },
  });
}
const allReleves = async () => {
  const ents = await ensureFacturesToolCached();
  return coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.releveDefinition.id });
};
const groupOf = async (module: 'ceet' | 'tde', label: string) => (await listLegacyGroups(module)).find((g) => g.label === label);

describe('Regroupement des anciens relevés', () => {
  it('regroupe par nom (casse et accents ignorés), uniquement « saisie libre » et uniquement le module', async () => {
    const base = uniq('Élodie');
    await legacy(base, '2040-02', 20);
    await legacy(base.toLowerCase(), '2040-01', 10);
    await legacy(base.toUpperCase(), '2040-03', 30, 'ceet');
    await legacy(base, '2040-02', 5, 'TDE'); // autre module : jamais mélangé
    await legacy('Autre fournisseur', '2040-01', 1, 'Autre');
    const releves = await allReleves();
    const ceet = groupLegacyReleves(releves, 'ceet').find((g) => g.label.toLowerCase().startsWith('élodie') && g.periodes.includes('2040-03'))!;
    expect(ceet.releves).toHaveLength(3);
    expect(ceet.periodes).toEqual(['2040-01', '2040-02', '2040-03']);
    expect(ceet.label).toBe(base.toUpperCase()); // nom du relevé le plus récent
    const tde = groupLegacyReleves(releves, 'tde').find((g) => g.label === base)!;
    expect(tde.releves).toHaveLength(1);
    expect(groupLegacyReleves(releves, 'ceet').some((g) => g.label === 'Autre fournisseur')).toBe(false);
  });

  it('ignore les relevés déjà rattachés à une personne', async () => {
    const p = await addParticipant('ceet', { name: uniq('Déjà rattaché') });
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2040-05', entries: [{ participationId: p.record.id, index: 10 }] });
    expect(groupLegacyReleves(await allReleves(), 'ceet').some((g) => g.label.startsWith('Déjà rattaché'))).toBe(false);
  });
});

describe('Rattachement', () => {
  it('à un participant du module : mêmes relevés (mêmes id et index), nouvelle identité, calcul et tableau de bord à jour', async () => {
    const person = await addParticipant('ceet', { name: uniq('Personne A') });
    const label = uniq('ancien-a');
    const r1 = await legacy(label, '2041-01', 100);
    const r2 = await legacy(label, '2041-02', 130);
    const dashBefore = buildDashboard({ module: 'ceet', participations: await listParticipations('ceet', { includeArchived: true }), releves: await allReleves(), factures: [], parts: [] });
    expect(dashBefore.legacyReleves).toBeGreaterThanOrEqual(2);

    const group = (await groupOf('ceet', label))!;
    const res = await attachLegacyGroup({ fournisseur: 'ceet', groupKey: group.key, target: { type: 'participation', participationId: person.record.id } });
    expect(res.attached).toBe(2);

    const after = await allReleves();
    for (const [orig, index] of [[r1, 100], [r2, 130]] as const) {
      const updated = after.find((r) => r.id === orig.id)!;
      expect(updated.values).toMatchObject({ participant_type: 'contact', participant_id: person.participant.id, index, mois: orig.values.mois });
      expect(updated.values.compteur).toBe(person.displayName);
    }
    expect(await groupOf('ceet', label)).toBeUndefined(); // plus rien à rattacher
    // les anciens relevés servent maintenant au calcul
    const calc = resolveParticipantReleves(person.participant, 'ceet', '2041-02', after);
    expect(calc.ok && calc.consommation).toBe(30);
    const dash = buildDashboard({ module: 'ceet', participations: await listParticipations('ceet', { includeArchived: true }), releves: after, factures: [], parts: [] });
    expect(dash.legacyReleves).toBe(dashBefore.legacyReleves - 2);
  });

  it('à une personne déjà connue : sa participation est créée, aucune personne dupliquée', async () => {
    const tde = await addParticipant('tde', { name: uniq('Connue') });
    const contactsBefore = (await coreService.getExternalContacts()).length;
    const label = uniq('ancien-b');
    await legacy(label, '2041-03', 50);
    const g = (await groupOf('ceet', label))!;
    expect((await listParticipations('ceet', { includeArchived: true })).some((p) => p.contactId === tde.participant.id)).toBe(false);
    const res = await attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'contact', contactId: tde.participant.id! } });
    expect(res.participation).toMatchObject({ fournisseur: 'ceet', contactId: tde.participant.id });
    expect((await coreService.getExternalContacts()).length).toBe(contactsBefore);
    expect((await allReleves()).find((r) => r.values.compteur === tde.displayName && r.values.mois === '2041-03')!.values.participant_id).toBe(tde.participant.id);
  });

  it('vers un participant retiré (archivé) via la personne : la participation est réactivée, pas dupliquée', async () => {
    const p = await addParticipant('ceet', { name: uniq('Retiré') });
    await archiveParticipation(p.record.id);
    const label = uniq('ancien-c');
    await legacy(label, '2041-04', 7);
    const g = (await groupOf('ceet', label))!;
    const res = await attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'contact', contactId: p.participant.id! } });
    expect(res.participation.record.id).toBe(p.record.id);
    expect(res.participation.archived).toBe(false);
  });

  it('nouvelle personne : créée avec le nom du groupe, avec sa participation', async () => {
    const label = uniq('Nouvelle Personne');
    await legacy(label, '2041-05', 9);
    const contactsBefore = (await coreService.getExternalContacts()).length;
    const g = (await groupOf('ceet', label))!;
    const res = await attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'nouvelle' } });
    expect((await coreService.getExternalContacts()).length).toBe(contactsBefore + 1);
    expect(res.participation.displayName).toBe(label);
    expect((await allReleves()).find((r) => r.values.mois === '2041-05' && r.values.participant_id === res.participation.participant.id)!.values.index).toBe(9);
  });
});

describe('Garde-fous : rien n\'est modifié en cas de problème', () => {
  it('conflit de période : la personne a déjà un relevé → refus, ancien relevé non écrasé, aucune participation créée', async () => {
    const person = await addParticipant('tde', { name: uniq('Conflit') }); // personne connue, pas encore en CEET
    const ceetP = await addExistingContact('ceet', person.participant.id!);
    await saveRelevesPeriode({ fournisseur: 'ceet', periode: '2042-01', entries: [{ participationId: ceetP.record.id, index: 999 }] });
    const label = uniq('ancien-d');
    const old = await legacy(label, '2042-01', 10);
    const g = (await groupOf('ceet', label))!;
    await expect(attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'participation', participationId: ceetP.record.id } })).rejects.toMatchObject({ code: 'RELEVES_INVALIDES' });
    const kept = (await allReleves()).find((r) => r.id === old.id)!;
    expect(kept.values).toMatchObject({ participant_type: 'manuel', participant_id: null, index: 10 });
    expect((await allReleves()).find((r) => r.values.participant_id === person.participant.id && r.values.mois === '2042-01' && r.values.fournisseur === 'ceet')!.values.index).toBe(999);
    const err = await attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'participation', participationId: ceetP.record.id } }).catch((e) => e);
    expect(friendlyMessage(err)).toContain('2042-01');
  });

  it('relevé utilisé par une facture validée : groupe verrouillé, rattachement refusé, identité inchangée', async () => {
    const ents = await ensureFacturesToolCached();
    const label = uniq('ancien-e');
    const used = await legacy(label, '2042-03', 40);
    const free = await legacy(label, '2042-04', 50);
    const facture = await createFacturePartagee({ toolId: ents.tool.id, facturePartageeEntityDefinitionId: ents.facturePartageeDefinition.id, values: { fournisseur: 'CEET', mois: '2042-03', montant_total: 1000 } });
    await coreService.updateRecord(facture.id, { values: { mode_repartition: 'proportionnel' } });
    await coreService.createRecord({ toolId: ents.tool.id, entityDefinitionId: ents.partLocataireDefinition.id, statusKey: 'a_payer', values: { facture_partagee: facture.id, participant_type: 'manuel', participant_id: null, label, consommation: 10, montant_attribue: 1000 } });

    const releves = await allReleves();
    expect((await loadLockedReleveIds(releves)).has(used.id)).toBe(true);
    const g = (await groupOf('ceet', label))!;
    expect(g.lockedCount).toBe(1);
    const person = await addParticipant('ceet', { name: uniq('Cible') });
    await expect(attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'participation', participationId: person.record.id } })).rejects.toMatchObject({ code: 'RELEVE_UTILISE' });
    const after = await allReleves();
    for (const r of [used, free]) expect(after.find((x) => x.id === r.id)!.values).toMatchObject({ participant_type: 'manuel', participant_id: null });
    expect((await loadLockedReleveIds(after)).has(used.id)).toBe(true); // toujours verrouillé
  });

  it('cible invalide (inconnue, archivée) et groupe déjà rattaché : refus clairs, rien modifié', async () => {
    const label = uniq('ancien-f');
    const old = await legacy(label, '2042-05', 1);
    const g = (await groupOf('ceet', label))!;
    await expect(attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'participation', participationId: 'inconnue' } })).rejects.toMatchObject({ code: 'PARTICIPANT_INVALIDE' });
    await expect(attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'contact', contactId: 'inconnu' } })).rejects.toMatchObject({ code: 'PARTICIPANT_INVALIDE' });
    const archived = await addParticipant('ceet', { name: uniq('Archivée') });
    await archiveParticipation(archived.record.id);
    await expect(attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'participation', participationId: archived.record.id } })).rejects.toMatchObject({ code: 'PARTICIPANT_INVALIDE' });
    await expect(attachLegacyGroup({ fournisseur: 'gaz', groupKey: g.key, target: { type: 'nouvelle' } })).rejects.toMatchObject({ code: 'FOURNISSEUR_INVALIDE' });
    expect((await allReleves()).find((r) => r.id === old.id)!.values.participant_type).toBe('manuel');

    const person = await addParticipant('ceet', { name: uniq('Cible 2') });
    await attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'participation', participationId: person.record.id } });
    await expect(attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'participation', participationId: person.record.id } })).rejects.toMatchObject({ code: 'RELEVE_INTROUVABLE' });
  });

  it('isolation : rattacher le groupe CEET ne touche jamais les relevés TDE du même nom', async () => {
    const label = uniq('Même Nom');
    const ceet = await legacy(label, '2043-01', 10, 'CEET');
    const tde = await legacy(label, '2043-01', 3, 'TDE');
    const person = await addParticipant('ceet', { name: uniq('Cible 3') });
    const g = (await groupOf('ceet', label))!;
    await attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'participation', participationId: person.record.id } });
    const after = await allReleves();
    expect(after.find((r) => r.id === ceet.id)!.values.participant_type).toBe('contact');
    expect(after.find((r) => r.id === tde.id)!.values).toMatchObject({ participant_type: 'manuel', participant_id: null });
    expect(await groupOf('tde', label)).toBeDefined();
  });

  it('deux rattachements simultanés du même groupe : un seul aboutit', async () => {
    const label = uniq('ancien-g');
    await legacy(label, '2043-02', 4);
    const [a, b] = [await addParticipant('ceet', { name: uniq('C1') }), await addParticipant('ceet', { name: uniq('C2') })];
    const g = (await groupOf('ceet', label))!;
    const results = await Promise.allSettled([
      attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'participation', participationId: a.record.id } }),
      attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'participation', participationId: b.record.id } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const owners = (await allReleves()).filter((r) => r.values.mois === '2043-02' && [a.participant.id, b.participant.id].includes(r.values.participant_id as string));
    expect(owners).toHaveLength(1);
  });
});

describe('Persistance', () => {
  it('le rattachement survit à un redémarrage', async () => {
    jest.useFakeTimers();
    try {
      const person = await addParticipant('ceet', { name: uniq('Persistée') });
      const label = uniq('ancien-h');
      const old = await legacy(label, '2044-01', 77);
      const g = (await groupOf('ceet', label))!;
      await attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'participation', participationId: person.record.id } });
      const stop = startAutoPersist();
      await jest.advanceTimersByTimeAsync(3100);
      stop();
      records.length = 0;
      await hydrateDb();
      const reloaded = (await allReleves()).find((r) => r.id === old.id)!;
      expect(reloaded.values).toMatchObject({ participant_type: 'contact', participant_id: person.participant.id, index: 77 });
      expect(await groupOf('ceet', label)).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Écrans et points d\'entrée', () => {
  it('routes anciens-releves pour CEET et TDE', () => {
    for (const m of ['ceet', 'tde']) expect(read(`app/${m}/anciens-releves.tsx`)).toContain(`<UtilityLegacyRelevesScreen module="${m}" />`);
  });

  it('écran de rattachement : action explicite avec confirmation, trois cibles, aucun rattachement automatique', () => {
    const src = read('features/utilities/screens/UtilityLegacyRelevesScreen.tsx');
    expect(src).toMatch(/Rattacher à une personne/);
    expect(src).toMatch(/comme nouvelle personne/);
    expect(src).toMatch(/Autres personnes connues/);
    expect(src).toMatch(/label="Rattacher"/); // confirmation
    expect(src).toMatch(/ne peuvent plus être modifiés ni rattachés/);
    expect(src).toMatch(/attachLegacyGroup\(/);
    expect(src).not.toMatch(/useEffect\([^)]*attachLegacyGroup/);
  });

  it('accueil : avis « anciens relevés » vers le rattachement ; ancien cahier restreint à « Autre » et renvoyant vers CEET/TDE', () => {
    expect(read('features/utilities/screens/UtilityDashboardScreen.tsx')).toMatch(/Rattacher les anciens relevés[\s\S]*anciens-releves|anciens-releves/);
    const old = read('features/factures/screens/RelevesScreen.tsx');
    expect(old).toMatch(/useState\('Autre'\)/);
    expect(old).toMatch(/\['Autre'\]\.map/);
    expect(old).not.toMatch(/\['CEET', 'TDE', 'Autre'\]/);
    expect(old).toMatch(/router\.push\('\/ceet' as never\)/);
    expect(read('features/immobilier/screens/RepartitionScreen.tsx')).toMatch(/moduleKey \? `\/\$\{moduleKey\}\/releves` : '\/factures\/releves'/);
  });
});

describe('Audit étape 6 — non-régression', () => {
  it('concurrence : deux groupes différents vers la même personne avec une période commune → un seul aboutit, jamais deux relevés (personne, période)', async () => {
    const person = await addParticipant('ceet', { name: uniq('Cible concurrente') });
    const l1 = uniq('groupe-un');
    const l2 = uniq('groupe-deux');
    await legacy(l1, '2045-01', 10);
    await legacy(l2, '2045-01', 20); // même période, autre nom
    const [g1, g2] = [(await groupOf('ceet', l1))!, (await groupOf('ceet', l2))!];
    const target = { type: 'participation' as const, participationId: person.record.id };
    const results = await Promise.allSettled([
      attachLegacyGroup({ fournisseur: 'ceet', groupKey: g1.key, target }),
      attachLegacyGroup({ fournisseur: 'ceet', groupKey: g2.key, target }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const owned = (await allReleves()).filter((r) => r.values.participant_id === person.participant.id && r.values.mois === '2045-01' && String(r.values.fournisseur).toLowerCase() === 'ceet');
    expect(owned).toHaveLength(1);
    // le groupe refusé reste intact et rattachable (la personne a déjà cette période → conflit explicite, pas de doublon)
    const second = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(second.reason).toMatchObject({ code: 'RELEVES_INVALIDES' });
  });

  it('doublon interne : un groupe avec deux saisies pour la même période est refusé et signalé, rien n\'est modifié', async () => {
    const label = uniq('Doublon interne');
    const a = await legacy(label, '2045-02', 100, 'CEET');
    const b = await legacy(label, '2045-02', 105, 'ceet'); // anciennes données : même nom, même mois, deux casses de fournisseur
    const group = (await groupOf('ceet', label))!;
    expect(group.doublons).toEqual(['2045-02']);
    const person = await addParticipant('ceet', { name: uniq('Cible doublon') });
    await expect(attachLegacyGroup({ fournisseur: 'ceet', groupKey: group.key, target: { type: 'participation', participationId: person.record.id } })).rejects.toMatchObject({ code: 'RELEVES_INVALIDES' });
    const after = await allReleves();
    for (const r of [a, b]) expect(after.find((x) => x.id === r.id)!.values).toMatchObject({ participant_type: 'manuel', participant_id: null });
    expect(after.filter((r) => r.values.participant_id === person.participant.id)).toHaveLength(0);
    // groupe sans doublon : liste vide
    const sain = uniq('Sans doublon');
    await legacy(sain, '2045-03', 1);
    await legacy(sain, '2045-04', 2);
    expect((await groupOf('ceet', sain))!.doublons).toEqual([]);
  });

  it('atomicité : une erreur au milieu des mises à jour annule les relevés déjà rattachés', async () => {
    const label = uniq('Atomique');
    const rs = [await legacy(label, '2046-01', 1), await legacy(label, '2046-02', 2), await legacy(label, '2046-03', 3)];
    const person = await addParticipant('ceet', { name: uniq('Cible atomique') });
    const group = (await groupOf('ceet', label))!;
    const original = coreService.updateRecord.bind(coreService);
    let attachCalls = 0;
    const spy = jest.spyOn(coreService, 'updateRecord').mockImplementation((id, patch) => {
      if (patch.values && patch.values.participant_type === 'contact' && ++attachCalls === 2) return Promise.reject(new Error('panne simulée'));
      return original(id, patch);
    });
    try {
      await expect(attachLegacyGroup({ fournisseur: 'ceet', groupKey: group.key, target: { type: 'participation', participationId: person.record.id } })).rejects.toThrow('panne simulée');
    } finally {
      spy.mockRestore();
    }
    const after = await allReleves();
    for (const r of rs) expect(after.find((x) => x.id === r.id)!.values).toMatchObject({ participant_type: 'manuel', participant_id: null, compteur: label });
    expect(await groupOf('ceet', label)).toBeDefined(); // toujours rattachable ensuite
    const retry = await attachLegacyGroup({ fournisseur: 'ceet', groupKey: group.key, target: { type: 'participation', participationId: person.record.id } });
    expect(retry.attached).toBe(3);
  });

  it('le rattachement ne crée ni ne supprime aucun relevé et laisse factures, parts et personnes strictement inchangées', async () => {
    const ents = await ensureFacturesToolCached();
    const snap = async () => {
      const [factures, parts, contacts] = await Promise.all([
        coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.facturePartageeDefinition.id }),
        coreService.getRecords({ toolId: ents.tool.id, entityDefinitionId: ents.partLocataireDefinition.id }),
        coreService.getExternalContacts(),
      ]);
      return JSON.stringify({ factures: factures.map((f) => [f.id, f.values, f.statusKey]).sort(), parts: parts.map((p) => [p.id, p.values, p.statusKey]).sort(), contacts: contacts.map((c) => [c.id, c.name, c.phone]).sort() });
    };
    const label = uniq('Sans effet de bord');
    await legacy(label, '2048-01', 1);
    await legacy(label, '2048-02', 2);
    const person = await addParticipant('ceet', { name: uniq('Cible inchangée') });
    const [relevesBefore, historyBefore] = [(await allReleves()).length, await snap()];
    const g = (await groupOf('ceet', label))!;
    await attachLegacyGroup({ fournisseur: 'ceet', groupKey: g.key, target: { type: 'participation', participationId: person.record.id } });
    expect((await allReleves()).length).toBe(relevesBefore); // ni création ni suppression : le même enregistrement est mis à jour
    expect(await snap()).toBe(historyBefore); // factures, parts (snapshots) et personnes intacts
  });

  it('ancien cahier « Autre » : les relevés enregistrés sont retrouvés malgré la casse du fournisseur', async () => {
    const p: { type: 'manuel'; id: null; label: string } = { type: 'manuel', id: null, label: uniq('Libre') };
    const ents = await ensureFacturesToolCached();
    const saved = await saveReleve({ toolId: ents.tool.id, releveEntityDefinitionId: ents.releveDefinition.id, fournisseur: 'Autre', periode: '2047-01', participant: p, index: 5 });
    expect(saved.values.fournisseur).toBe('autre'); // le moteur écrit l'identifiant en minuscules
    const src = read('features/factures/screens/RelevesScreen.tsx');
    expect(src).toMatch(/fournisseurKey\(record\.values\.fournisseur\) === fournisseurKey\(type\)/); // …donc l'écran doit comparer sans la casse
    expect(src).not.toMatch(/record\.values\.fournisseur === type/);
  });
});
