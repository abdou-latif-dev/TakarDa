import AsyncStorage from '@react-native-async-storage/async-storage';

/** Préfixe historique des clés locales (héritage de FormEase) : ne jamais le changer, sinon les données déjà
 * enregistrées sur les appareils deviendraient introuvables. */
export const STORAGE_PREFIX = '@formease/';

/** Contrat minimal du stockage clé/valeur local utilisé par toute l'application. C'est la seule frontière entre
 * le code métier et AsyncStorage : un futur mécanisme distant (synchronisation) devra passer par une autre
 * couche, pas par un SDK appelé depuis un service métier. Les erreurs (stockage indisponible, JSON corrompu)
 * sont propagées telles quelles : chaque appelant décide de les gérer (voir docs/persistance-et-firebase.md). */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export const storage: KeyValueStore = {
  async get<T>(key: string): Promise<T | null> {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  async set<T>(key: string, value: T): Promise<void> {
    await AsyncStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  },
  async remove(key: string): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_PREFIX + key);
  },
};
