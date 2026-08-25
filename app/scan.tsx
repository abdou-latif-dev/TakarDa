import { Stack } from 'expo-router';
import { ScanScreen } from '@/features/qr/screens/ScanScreen';

export default function Scan() {
  return (
    <>
      <Stack.Screen options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
      <ScanScreen />
    </>
  );
}
