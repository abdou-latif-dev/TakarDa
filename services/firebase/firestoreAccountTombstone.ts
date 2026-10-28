// Réalisation Firestore du marqueur « compte supprimé » (voir accountTombstone.ts). Reçoit une instance `Firestore` : n'importe ni la configuration ni le client applicatif.

import { doc, getDocFromServer, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { TOMBSTONE_COLLECTION, type TombstoneBackend } from './accountTombstone';

export function createFirestoreTombstoneBackend(db: Firestore, uid: string): TombstoneBackend {
  if (!uid) throw new Error('Aucun compte : aucun accès Firestore.');
  const ref = doc(db, TOMBSTONE_COLLECTION, uid);
  return {
    mark: async () => {
      // lecture serveur d'abord : une reprise ne tente pas de recréer ce que les règles interdisent de recréer (un marqueur existant ne se modifie jamais)
      const existing = await getDocFromServer(ref);
      if (existing.exists()) return 'exists';
      await setDoc(ref, { deletedAt: serverTimestamp() });
      return 'created';
    },
  };
}
