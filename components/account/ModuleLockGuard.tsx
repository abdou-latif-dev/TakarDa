import { useEffect, useState } from 'react';
import { router, usePathname } from 'expo-router';
import { subscribeDeviceAccounts } from '@/services/deviceAccounts';
import { isPathLocked } from '@/services/moduleLock';
import { useCloudStore } from '@/store/cloudStore';

/**
 * Garde d'accès des modules indisponibles en contexte multi-compte (tontines, formulaires, CEET/TDE) : voir services/moduleLock.ts.
 * Monté seulement quand les comptes cloud sont ouverts (drapeau). N'affiche rien, ne modifie ni ne supprime aucune donnée : il redirige
 * vers l'écran d'information tant que le contexte est multi-compte.
 */
export function ModuleLockGuard() {
  const pathname = usePathname();
  const accountEpoch = useCloudStore((s) => s.accountEpoch);
  const authStatus = useCloudStore((s) => s.authStatus);
  const [registryVersion, setRegistryVersion] = useState(0);

  useEffect(() => subscribeDeviceAccounts(() => setRegistryVersion((v) => v + 1)), []);

  useEffect(() => {
    if (isPathLocked(pathname)) router.replace('/indisponible' as never);
  }, [pathname, accountEpoch, authStatus, registryVersion]);

  return null;
}
