// Explicitly opt-in demo data for the Tontine walkthrough. Never created
// automatically — only when the user taps the clearly-labelled "Tontine de
// démonstration" action. Built entirely from the same real service calls a
// real user's actions go through (createTontine / addGuestMember /
// recordContributions / advanceRound), so the result is a genuine tontine:
// fully persisted, fully editable, and deletable via the normal "Supprimer"
// flow on the dashboard. Reproduces exactly the reference scenario from the
// Tour/Boucle brief (2026-09-30, §3/§39/§52): 5 membres, 25 000 FCFA,
// hebdomadaire à partir du 7 octobre 2026, boucle 1 = Koffi/Ama/Yao/Sena/
// Komlan aux 07/10, 14/10, 21/10, 28/10, 04/11 — arrêtée au Tour 3 (Yao)
// avec Koffi/Ama/Sena déjà payés pour CE tour (Koffi et Ama payant une
// SECONDE fois, après avoir déjà reçu leur propre tour — exactement le cas
// que le bug fixé par le nouveau modèle Tour devait cesser d'écraser).

import { groupService } from './groupService';
import { tontineService } from './tontineService';
import type { Group } from '@/types/entities';

export const DEMO_TONTINE_NAME = 'Solidarité 2026 (démo)';

const DEMO_MEMBERS = [
  { firstName: 'Koffi', lastName: 'Mensah' },
  { firstName: 'Ama', lastName: 'Dossou' },
  { firstName: 'Yao', lastName: 'Kossi' },
  { firstName: 'Sena', lastName: 'Afi' },
  { firstName: 'Komlan', lastName: 'Adjo' },
] as const;

export async function seedDemoTontine(): Promise<Group> {
  const startDate = new Date(2026, 9, 7); // 7 octobre 2026

  const group = await groupService.createTontine({
    name: DEMO_TONTINE_NAME,
    contributionAmount: 25000,
    frequency: 'weekly',
    startDate: startDate.toISOString(),
    orderMethod: 'join_order',
    includeSelfAsMember: false,
  });

  const members = [];
  for (const m of DEMO_MEMBERS) {
    members.push(await groupService.addGuestMember(group.id, { firstName: m.firstName, lastName: m.lastName }));
  }
  const [koffi, ama, , sena] = members; // Yao (index 2) and Komlan (index 4) stay unpaid

  // Tour 1 (Koffi) and Tour 2 (Ama) already received their payout — current
  // tour becomes 3 (Yao), matching the brief's target demo state exactly.
  await tontineService.advanceRound(group.id);
  await tontineService.advanceRound(group.id);

  const summary = await tontineService.getSummary(group.id);
  if (summary?.currentTour) {
    await tontineService.recordContributions({
      groupId: group.id,
      tourId: summary.currentTour.id,
      memberIds: [koffi.id, ama.id, sena.id],
    });
  }

  return group;
}
