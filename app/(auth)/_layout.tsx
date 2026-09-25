import { Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';

export default function AuthLayout() {
  const { colorScheme } = useColorScheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colorScheme === 'dark' ? '#111113' : '#FFFFFF' } }} />;
}
