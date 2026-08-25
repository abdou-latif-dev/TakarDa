import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@formease/';

export const storage = {
  async get<T>(key: string): Promise<T | null> {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  async set<T>(key: string, value: T): Promise<void> {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
  },
  async remove(key: string): Promise<void> {
    await AsyncStorage.removeItem(PREFIX + key);
  },
};
