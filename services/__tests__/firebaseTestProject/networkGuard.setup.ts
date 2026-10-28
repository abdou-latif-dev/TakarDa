// Chargé par jest (`setupFiles` de jest.firebase-test.config.js) AVANT tout module de test : le garde réseau est donc en place
// avant que le SDK Firebase ne soit importé.
import { installNetworkGuard } from './networkGuard';

installNetworkGuard();
