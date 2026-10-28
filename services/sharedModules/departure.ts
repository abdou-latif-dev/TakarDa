// Départ de tous les espaces partagés REJOINTS — F6. Pur : aucun SDK, aucun réseau direct. Utilisé quand un compte est supprimé : le locataire quitte les espaces où son
// accès est actif (le propriétaire voit « a quitté ») et retire le nom qu'il avait saisi dans sa demande. Meilleur effort, JAMAIS bloquant : un échec n'empêche pas
// la suppression du compte (la suppression des données du compte lui-même reste vérifiée, elle). La fiche d'accès (identifiant, contrat lié, état) reste chez le
// propriétaire comme historique de location ; une demande REFUSÉE reste (elle bloque).

import type { ModulesBackend } from './modulesPort';

export interface DepartureReport {
  /** Espaces quittés (accès actif → quitté). */
  left: number;
  /** Demandes (en attente ou approuvées) effacées : le nom saisi n'est plus conservé. */
  erased: number;
  /** Espaces pour lesquels une opération a échoué (non bloquant). */
  failed: number;
}

export async function leaveJoinedModules(backend: ModulesBackend, uid: string, moduleIds: readonly string[], now: () => Date = () => new Date()): Promise<DepartureReport> {
  const report: DepartureReport = { left: 0, erased: 0, failed: 0 };
  for (const moduleId of moduleIds) {
    try {
      const member = await backend.getMember(moduleId, uid);
      if (member?.state === 'active') {
        await backend.updateMember(moduleId, uid, { state: 'left', updatedAt: now().toISOString() });
        report.left += 1;
      }
      const request = await backend.getRequest(moduleId, uid);
      if (request && request.state !== 'refused') {
        await backend.deleteRequest(moduleId, uid);
        report.erased += 1;
      }
    } catch {
      report.failed += 1;
    }
  }
  return report;
}
