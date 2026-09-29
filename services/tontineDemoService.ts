// Explicitly opt-in demo data for the Tontine walkthrough ("TakarDa — Tontine
// Étape 6"). Never created automatically — only when the user taps the
// clearly-labelled "Tontine de démonstration" action. Built entirely from the
// same real service calls a real user's actions go through (createTontine /
// addGuestMember / addContribution), so the result is a genuine tontine:
// fully persisted, fully editable, and deletable via the normal "Supprimer"
// flow on the dashboard — nothing here bypasses the data model or lives
// outside of it. The name and the 5 member names make it self-evidently a
// demo rather than a real user's data.

import { groupService } from './groupService';
import { tontineService } from './tontineService';
import type { Group } from '@/types/entities';

export const DEMO_TONTINE_NAME = 'Solidarité 2026 (démo)';

// Ordre d'inscription = ordre de passage (orderMethod: 'join_order') — Koffi
// et Ama ont déjà reçu la cagnotte des tours 1 et 2 (2x advanceRound ci-dessous),
// Yao est donc le prochain bénéficiaire, exactement comme dans le scénario demandé.
const DEMO_MEMBERS: { firstName: string; lastName: string; paid: boolean }[] = [
  { firstName: 'Koffi', lastName: 'Mensah', paid: true },
  { firstName: 'Ama', lastName: 'Dossou', paid: true },
  { firstName: 'Yao', lastName: 'Kossi', paid: false },
  { firstName: 'Sena', lastName: 'Afi', paid: false },
  { firstName: 'Komlan', lastName: 'Adjo', paid: false },
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Creates "Solidarité 2026" — 25 000 FCFA/mois, 5 membres invités dans
 * l'ordre d'inscription (join_order), 125 000 FCFA au total (aucun "Vous" —
 * voir includeSelfAsMember). Koffi et Ama ont déjà reçu leur tour et sont à
 * jour sur la cotisation en cours ; Yao/Sena/Komlan n'ont pas encore payé —
 * la prochaine échéance est fixée dans le futur pour qu'ils s'affichent
 * "En attente", pas "En retard", juste après la création. */
export async function seedDemoTontine(): Promise<Group> {
  const dueDate = new Date(Date.now() + THIRTY_DAYS_MS);

  const group = await groupService.createTontine({
    name: DEMO_TONTINE_NAME,
    contributionAmount: 25000,
    frequency: 'monthly',
    startDate: dueDate.toISOString(),
    orderMethod: 'join_order',
    includeSelfAsMember: false,
  });

  const members = [];
  for (const m of DEMO_MEMBERS) {
    members.push(await groupService.addGuestMember(group.id, { firstName: m.firstName, lastName: m.lastName }));
  }

  const summary = await tontineService.getSummary(group.id);
  if (summary.cycle) {
    for (let i = 0; i < members.length; i++) {
      if (!DEMO_MEMBERS[i].paid) continue;
      await tontineService.addContribution({
        groupId: group.id,
        cycleId: summary.cycle.id,
        memberId: members[i].id,
        amount: 25000,
        status: 'paid',
      });
    }
  }

  // Koffi (tour 1) puis Ama (tour 2) ont déjà reçu la cagnotte — le tour
  // courant passe donc à 3 (Yao).
  await tontineService.advanceRound(group.id);
  await tontineService.advanceRound(group.id);

  return group;
}
