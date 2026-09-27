import { Stack } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { LIGHT_COLORS, DARK_COLORS } from '@/constants/theme';

export default function AuthLayout() {
  const { colorScheme } = useColorScheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colorScheme === 'dark' ? DARK_COLORS.background : LIGHT_COLORS.background } }} />;
}
