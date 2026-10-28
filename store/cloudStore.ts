import { create } from 'zustand';
import { CloudAuthError, reloadCurrentUser, sendResetEmail, sendVerificationEmail, signInWithEmail, signOutCloud, signUpWithEmail, watchCloudUser, type CloudUser } from '@/services/firebase/firebaseAuthService';
import { AUTH_MESSAGES } from '@/services/cloudAuthErrors';
import { setEmailVerified } from '@/services/accountVerification';
import { firestoreRecordsApi } from '@/services/firebase/firestoreRecordsApi';
import { firebaseAccountDeletionApi, readDeletionLock } from '@/services/firebase/accountDeletionApi';
import { deleteAccount, type DeletionOutcome } from '@/services/accountDeletionService';
import { deletionJournal, describeSyncRefusal, loadDeletionMarker, noteLockObserved, type DeletionMarker, type LockProbe } from '@/services/accountDeletionRecovery';
import {
  displayStates,
  enableSync,
  importLocalRecords,
  loadSyncState,
  previewLocalImport,
  readLocalImmobilier,
  releaseHiddenOwnership,
  releaseLocalOwnership,
  resolveConflict,
  stampTrackedRecords,
  syncNow,
  type DisplaySync,
  type ImportPreview,
  type SyncState,
} from '@/services/cloudSyncService';
import { getAccountEpoch, setActiveCloudUid, setCloudStampUid } from '@/services/cloudVisibility';
import { registerDeviceAccount } from '@/services/deviceAccounts';
import { quiesceSyncLifecycle } from '@/services/syncLifecycle';
import { setSyncAccount } from '@/services/sync/syncAccount';
import { forgetSyncAccountState } from '@/services/sync/syncAccountCleanup';

/** État du compte cloud (Firebase Authentication) et de la synchronisation des biens et logements. Facultatif : sans
 * compte, TakarDa fonctionne exactement comme avant. Se connecter ne synchronise rien et ne migre rien. */
interface CloudStoreState {
  authStatus: 'initializing' | 'signedOut' | 'signedIn';
  /** Change à chaque changement de compte : les écrans et caches s'en servent pour se recharger. */
  accountEpoch: number;
  user: CloudUser | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  /** Message sur la vérification de l'adresse e-mail (envoi, attente, échec) : propre à la session, jamais effacé par un changement d'état de connexion. */
  verificationMessage: string | null;
  syncEnabled: boolean;
  syncing: boolean;
  pending: number;
  conflicts: string[];
  lastSyncAt: string | null;
  /** Dernier message de synchronisation (hors ligne, accès refusé…). */
  syncMessage: string | null;
  states: Record<string, DisplaySync>;
  importPreview: ImportPreview | null;
  /** Suppression du compte en cours : plus aucune synchronisation ni activation pendant ce temps. */
  deleting: boolean;
  /** Dernier résultat de suppression de compte (conservé après la déconnexion pour afficher « Compte supprimé »). */
  deletion: DeletionOutcome | null;
  /** Journal LOCAL persistant d'une suppression commencée et non confirmée terminée (survit au redémarrage) ; null = rien à reprendre. */
  deletionMarker: DeletionMarker | null;

  init: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /** Renvoie l'e-mail de vérification (au plus un par minute). */
  resendVerification: () => Promise<void>;
  /** Relit le compte auprès du serveur : l'adresse a-t-elle été vérifiée depuis ? */
  refreshVerification: () => Promise<void>;
  enableSync: () => Promise<void>;
  syncNow: () => Promise<void>;
  syncIfEnabled: () => Promise<void>;
  /** Recalcule, sans réseau, l'état affiché des enregistrements (les modifications locales passent « en attente »). */
  refreshStates: () => Promise<void>;
  previewImport: () => Promise<void>;
  confirmImport: () => Promise<void>;
  cancelImport: () => void;
  resolve: (recordId: string, choice: 'cloud' | 'local') => Promise<void>;
  clearMessages: () => void;
  /** Supprime le compte et ses données cloud (le mot de passe sert à la réauthentification et n'est pas conservé). */
  deleteAccount: (password: string) => Promise<DeletionOutcome | null>;
  /** Rend locaux (visibles) les enregistrements masqués d'autres comptes ; rien n'est supprimé. */
  releaseHiddenData: () => Promise<number>;
}

let started = false;
/** Délai minimal entre deux e-mails de vérification (limite côté appareil ; le serveur applique aussi ses propres quotas). */
const VERIFICATION_COOLDOWN_MS = 60_000;
let lastVerificationSentAt = 0;

function view(state: SyncState | null): Pick<CloudStoreState, 'syncEnabled' | 'pending' | 'conflicts' | 'lastSyncAt' | 'states'> {
  if (!state) return { syncEnabled: false, pending: 0, conflicts: [], lastSyncAt: null, states: {} };
  const states = displayStates(state);
  return {
    syncEnabled: true,
    pending: Object.values(states).filter((s) => s === 'pending').length, // y compris les modifications locales pas encore repérées
    conflicts: Object.keys(state.entries).filter((id) => state.entries[id].status === 'conflict'),
    lastSyncAt: state.lastSyncAt,
    states,
  };
}

/** Lecture serveur du verrou ; toute erreur = « unknown » (jamais une conclusion tirée d'une erreur). */
const probeLock = async (uid: string): Promise<LockProbe> => {
  try {
    return await readDeletionLock(uid);
  } catch {
    return 'unknown';
  }
};

/** Libération locale à la suppression du compte : marquage V1 + état technique de synchronisation du compte (les données métier restent). */
const releaseWithSyncState = async (uid: string) => {
  const released = await releaseLocalOwnership(uid);
  try {
    await forgetSyncAccountState(uid);
  } catch {
    // l'état technique (file, référence, curseur) d'un compte supprimé est sans valeur : un échec ne bloque pas la suppression du compte
  }
  return released;
};

const messageOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export const useCloudStore = create<CloudStoreState>((set, get) => ({
  authStatus: 'initializing',
  accountEpoch: 0,
  user: null,
  busy: false,
  error: null,
  notice: null,
  verificationMessage: null,
  syncEnabled: false,
  syncing: false,
  pending: 0,
  conflicts: [],
  lastSyncAt: null,
  syncMessage: null,
  states: {},
  importPreview: null,
  deleting: false,
  deletion: null,
  deletionMarker: null,

  init: () => {
    if (started) return;
    started = true;
    try {
      watchCloudUser(
        async (user) => {
          // Compte précédent : marquer d'abord ce qui lui revient (sans réseau), puis changer de visibilité.
          const previous = get().user;
          if (previous && previous.uid !== user?.uid) {
            try {
              await stampTrackedRecords(previous.uid);
            } catch {
              // sans incidence : le marquage se refait à la prochaine synchronisation de ce compte
            }
          }
          setActiveCloudUid(user?.uid ?? null);
          setEmailVerified(user?.uid ?? null, user?.emailVerified === true); // REFUS par défaut : seule une adresse vérifiée par le serveur compte
          setSyncAccount(user?.uid ?? null); // l'état de synchronisation (file, référence, conflits…) suit le compte : jamais partagé entre comptes
          if (user) await registerDeviceAccount(user.uid).catch(() => undefined); // registre local des comptes de l'appareil (contexte multi-compte, moduleLock.ts)
          const epoch = getAccountEpoch();
          if (!user) {
            lastVerificationSentAt = 0;
            set({ authStatus: 'signedOut', user: null, accountEpoch: epoch, verificationMessage: null, ...view(null), syncing: false, syncMessage: null, notice: null, importPreview: null, deletionMarker: null });
            return;
          }
          // Aucune trace de l'ancien compte pendant le chargement de l'état de celui-ci.
          set({ authStatus: 'signedIn', user, accountEpoch: epoch, ...view(null), syncing: false, syncMessage: null, notice: null, importPreview: null });
          const state = await loadSyncState(user.uid);
          const marker = await loadDeletionMarker(user.uid); // suppression inachevée : le parcours de reprise survit au redémarrage
          if (epoch !== getAccountEpoch()) return; // un autre changement de compte est arrivé entre-temps
          set({ ...view(state), deletionMarker: marker });
        },
        () => set({ authStatus: 'signedOut', user: null }),
      );
    } catch {
      // Firebase indisponible : l'application reste utilisable sans compte.
      set({ authStatus: 'signedOut', user: null });
    }
  },

  signIn: async (email, password) => {
    set({ busy: true, error: null });
    try {
      await signInWithEmail(email, password);
    } catch (e) {
      set({ error: messageOf(e, 'Connexion impossible.') });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  signUp: async (email, password) => {
    set({ busy: true, error: null, verificationMessage: null });
    try {
      await signUpWithEmail(email, password);
      // le compte est créé : l'e-mail de vérification est demandé tout de suite ; un échec d'envoi n'annule JAMAIS l'inscription (« Renvoyer l'e-mail » existe)
      try {
        await sendVerificationEmail();
        lastVerificationSentAt = Date.now();
        set({ verificationMessage: 'Un e-mail de vérification vient de vous être envoyé : ouvrez le lien qu’il contient, puis revenez ici.' });
      } catch (sendError) {
        set({ verificationMessage: `L’e-mail de vérification n’a pas pu être envoyé (${messageOf(sendError, 'erreur inconnue')}) Utilisez « Renvoyer l’e-mail ».` });
      }
    } catch (e) {
      set({ error: messageOf(e, 'Inscription impossible.') });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  signOut: async () => {
    set({ busy: true, error: null });
    try {
      const uid = get().user?.uid;
      if (uid) await stampTrackedRecords(uid).catch(() => undefined); // avant de masquer : ce compte garde ses données
      await signOutCloud(); // les données locales ne sont pas touchées, seulement masquées
      // Déconnexion confirmée : plus aucun message de la session terminée (en cas d'échec, la session reste active et ses messages aussi).
      set({ notice: null, syncMessage: null, importPreview: null });
    } catch (e) {
      set({ error: e instanceof CloudAuthError ? e.message : 'Déconnexion impossible.' });
    } finally {
      set({ busy: false });
    }
  },

  resendVerification: async () => {
    const user = get().user;
    if (!user || get().busy) return;
    if (user.emailVerified) {
      set({ verificationMessage: null });
      return;
    }
    if (Date.now() - lastVerificationSentAt < VERIFICATION_COOLDOWN_MS) {
      set({ verificationMessage: AUTH_MESSAGES['app/verification-too-soon'] });
      return;
    }
    set({ busy: true, error: null });
    const epoch = getAccountEpoch();
    try {
      await sendVerificationEmail();
      lastVerificationSentAt = Date.now();
      if (epoch === getAccountEpoch()) set({ verificationMessage: 'E-mail de vérification renvoyé : ouvrez le lien qu’il contient, puis touchez « J’ai vérifié mon adresse ».' });
    } catch (e) {
      if (epoch === getAccountEpoch()) set({ error: messageOf(e, 'Envoi impossible.') });
    } finally {
      set({ busy: false });
    }
  },

  refreshVerification: async () => {
    const user = get().user;
    if (!user || get().busy) return;
    set({ busy: true, error: null });
    const epoch = getAccountEpoch();
    try {
      const fresh = await reloadCurrentUser();
      const current = get().user;
      if (epoch !== getAccountEpoch() || !current || current.uid !== fresh.uid) return; // la session a changé pendant l'attente : résultat écarté
      setEmailVerified(fresh.uid, fresh.emailVerified);
      set({
        user: { ...current, emailVerified: fresh.emailVerified },
        verificationMessage: fresh.emailVerified ? null : 'Adresse pas encore vérifiée : ouvrez le lien reçu par e-mail (pensez aux courriers indésirables), puis réessayez.',
        notice: fresh.emailVerified ? 'Adresse e-mail vérifiée.' : null,
      });
    } catch (e) {
      if (epoch === getAccountEpoch()) set({ error: messageOf(e, 'Vérification impossible.') });
    } finally {
      set({ busy: false });
    }
  },

  resetPassword: async (email) => {
    set({ busy: true, error: null });
    try {
      await sendResetEmail(email);
    } catch (e) {
      set({ error: messageOf(e, 'Envoi impossible.') });
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  enableSync: async () => {
    const user = get().user;
    if (!user || get().deleting) return;
    set({ busy: true, error: null });
    try {
      const epoch = getAccountEpoch();
      const state = await enableSync(firestoreRecordsApi, user.uid);
      if (epoch !== getAccountEpoch()) return;
      set({ ...view(state), notice: 'Synchronisation activée. Seuls les biens et logements créés à partir de maintenant sont suivis.' });
    } catch (e) {
      set({ error: messageOf(e, 'Activation impossible : vérifiez votre connexion et réessayez.') });
    } finally {
      set({ busy: false });
    }
  },

  syncNow: async () => {
    const user = get().user;
    if (!user || get().syncing || get().deleting) return;
    set({ syncing: true, error: null });
    try {
      const epoch = getAccountEpoch();
      const out = await syncNow(firestoreRecordsApi, user.uid);
      if (epoch !== getAccountEpoch()) return; // résultat d'un ancien compte : jamais affiché pour le compte actuel
      const parts: string[] = [];
      if (out.push.confirmed) parts.push(`${out.push.confirmed} envoyé${out.push.confirmed > 1 ? 's' : ''}`);
      if (out.pull && (out.pull.created || out.pull.updated)) parts.push(`${out.pull.created + out.pull.updated} reçu${out.pull.created + out.pull.updated > 1 ? 's' : ''}`);
      if (out.pull?.deletedElsewhere) parts.push(`${out.pull.deletedElsewhere} supprimé${out.pull.deletedElsewhere > 1 ? 's' : ''} ailleurs (non appliqué${out.pull.deletedElsewhere > 1 ? 's' : ''})`);
      if (out.push.errors) parts.push(`${out.push.errors} enregistrement${out.push.errors > 1 ? 's' : ''} refusé${out.push.errors > 1 ? 's' : ''} ou en erreur`);
      let message = out.error ?? (parts.join(' · ') || 'Tout est à jour.');
      let marker: DeletionMarker | null | undefined;
      if (out.push.permissionDenied) {
        // Un refus ne dit pas pourquoi : on lit l'espace sur le serveur (lecture seule) avant de parler de verrouillage.
        const probe = await probeLock(user.uid);
        if (epoch !== getAccountEpoch()) return;
        message = `${message} ${describeSyncRefusal(probe)}`;
        if (probe === 'locked') marker = await noteLockObserved(user.uid).catch(() => undefined);
      }
      set({ ...view(out.state), syncMessage: message, ...(marker ? { deletionMarker: marker } : {}) });
    } catch (e) {
      set({ syncMessage: messageOf(e, 'Synchronisation impossible.') });
    } finally {
      set({ syncing: false });
    }
  },

  refreshStates: async () => {
    const user = get().user;
    if (!user || !get().syncEnabled) return;
    const epoch = getAccountEpoch();
    const state = await loadSyncState(user.uid);
    if (!state || epoch !== getAccountEpoch()) return;
    set({ ...view(state) });
  },

  syncIfEnabled: async () => {
    if (get().authStatus !== 'signedIn' || !get().syncEnabled) return;
    await get().syncNow();
  },

  previewImport: async () => {
    const user = get().user;
    if (!user) return;
    const epoch = getAccountEpoch();
    const state = await loadSyncState(user.uid);
    if (!state) return;
    const preview = previewLocalImport(state, await readLocalImmobilier(user.uid));
    if (epoch !== getAccountEpoch()) return;
    set({ importPreview: preview });
  },

  confirmImport: async () => {
    const user = get().user;
    if (!user || get().deleting) return;
    set({ busy: true, error: null });
    try {
      const epoch = getAccountEpoch();
      const result = await importLocalRecords(user.uid);
      if (epoch !== getAccountEpoch()) return;
      set({ ...view(result.state), importPreview: null, notice: `${result.imported} enregistrement(s) préparé(s) à l’envoi (sauvegarde locale créée).` });
    } catch (e) {
      set({ error: messageOf(e, 'Envoi impossible.') });
    } finally {
      set({ busy: false });
    }
    await get().syncNow();
  },

  cancelImport: () => set({ importPreview: null }),

  resolve: async (recordId, choice) => {
    const user = get().user;
    if (!user) return;
    set({ busy: true, error: null });
    try {
      const epoch = getAccountEpoch();
      const next = await resolveConflict(firestoreRecordsApi, user.uid, recordId, choice);
      if (epoch !== getAccountEpoch()) return;
      set({ ...view(next) });
    } catch (e) {
      set({ error: messageOf(e, 'Résolution impossible.') });
    } finally {
      set({ busy: false });
    }
  },

  clearMessages: () => set({ error: null, notice: null, deletion: null }),

  deleteAccount: async (password) => {
    const user = get().user;
    if (!user || get().deleting) return null;
    set({ deleting: true, busy: true, error: null, notice: null, deletion: null });
    try {
      // le moteur de synchronisation est arrêté (l'état `deleting` l'a déjà demandé) et son exécution en cours est terminée avant tout effacement
      if (!(await quiesceSyncLifecycle())) {
        // l'arrêt de la synchronisation n'est PAS confirmé : une opération est peut-être encore engagée. Rien n'est effacé, l'échec est explicite.
        set({ error: 'La synchronisation n’a pas pu être arrêtée à temps : la suppression n’a pas été lancée et rien n’a été effacé. Réessayez dans un instant.' });
        return null;
      }
      const outcome = await deleteAccount(firebaseAccountDeletionApi, user.uid, password, { release: releaseWithSyncState }, undefined, deletionJournal);
      set({ deletionMarker: outcome.status === 'completed' ? null : await loadDeletionMarker(user.uid) });
      // Données cloud supprimées ET vérifiées : le suivi de synchronisation n'a plus d'objet (l'état local a été oublié).
      if (outcome.status === 'completed' || outcome.status === 'cloud_deleted_account_active' || outcome.status === 'account_uncertain') set({ ...view(null) });
      set({ deletion: outcome });
      return outcome;
    } finally {
      set({ deleting: false, busy: false });
    }
  },

  releaseHiddenData: async () => {
    const { released } = await releaseHiddenOwnership(get().user?.uid ?? null);
    set({ notice: released > 0 ? `${released} enregistrement(s) sont de nouveau des données locales, visibles sur cet appareil.` : 'Aucune donnée masquée.' });
    return released;
  },
}));

// Seul un compte connecté ET dont la synchronisation est activée marque ses créations (voir cloudVisibility.ownerForNewRecord).
useCloudStore.subscribe((s) => setCloudStampUid(s.authStatus === 'signedIn' && s.syncEnabled && s.user ? s.user.uid : null));
