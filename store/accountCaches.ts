import { useActivityStore } from './activityStore';
import { useCoreStore } from './coreStore';
import { useNotificationStore } from './notificationStore';
import { useStatisticsStore } from './statisticsStore';

/** Vide les copies EN MÉMOIRE des listes dérivées des enregistrements, au changement de compte : elles se rechargent à
 * l'affichage suivant avec la visibilité du nouveau compte. Ne touche ni à la base locale ni au stockage persistant. */
export function resetAccountCaches(): void {
  useCoreStore.setState({ records: {}, recordsStatus: {} });
  useActivityStore.setState({ events: [], status: 'idle', error: null });
  useNotificationStore.setState({ notifications: [], status: 'idle', unreadCount: 0 });
  useStatisticsStore.setState({ overview: null, status: 'idle' });
}
