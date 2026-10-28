// Interrupteurs de fonctionnalités de cette version.

import { BUILD_TARGET, cloudEnabledFor } from './buildTarget';

/**
 * Compte et synchronisation cloud.
 *
 * FERMÉS par défaut (cible de build « local », valeur par défaut et valeur de tout build sans cible déclarée) : aucune connexion, aucune inscription, aucun appel
 * Firebase. Les écrans de compte, de connexion et d'inscription redirigent vers l'accueil, et la session cloud n'est même pas initialisée. L'application fonctionne
 * exactement comme sans compte.
 *
 * Ils ne s'ouvrent QUE pour un build qui déclare sa cible (`EXPO_PUBLIC_BUILD_TARGET=test` ou `=production`, fixée par un profil de eas.json — voir constants/buildTarget.ts,
 * scripts/release/build-gate.js et docs/builds-test-production.md). « test » ne peut viser que le projet de TEST ; « production » exige en plus des textes légaux complets
 * (scripts/release/legal-check.js) et des règles de production publiées : c'est un changement délibéré, jamais un effet de bord.
 */
export const CLOUD_ACCOUNT_ENABLED: boolean = cloudEnabledFor(BUILD_TARGET);
