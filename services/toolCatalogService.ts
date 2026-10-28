// Catalogue TakarDa : les MODÈLES que l'application propose. Source unique.
//
//   Modèle (ce fichier, statique)  →  Outil (un Tool du Core, voir toolRegistryService)
//                                  →  Données (Records / Group… de l'outil, jamais ici)
//
// Catalogue V1 : Immobilier, Tontine, CEET, TDE (installables) et Commerce (visible,
// « Bientôt »). Formulaires, Scanner, Dossiers et Factures & Reçus ne sont PAS au
// catalogue V1 : leur code est conservé, simplement hors catalogue.
//
// L'identifiant d'un modèle est aussi le `kind` de son Tool (ToolKind) : un seul
// identifiant par modèle, aucune table de correspondance.

import type { ComponentProps } from 'react';
import type { MaterialIcons } from '@expo/vector-icons';

export type ToolModelKey = 'immobilier' | 'tontine' | 'ceet' | 'tde' | 'commerce';
export type ToolModelStatus = 'available' | 'coming_soon';

export interface CatalogModel {
  key: ToolModelKey;
  title: string;
  description: string;
  icon: ComponentProps<typeof MaterialIcons>['name'];
  /** Utilisable dès maintenant. */
  available: boolean;
  /** Peut être ajouté à Mes Outils. Un modèle « Bientôt » ne crée ni outil ni donnée. */
  installable: boolean;
  status: ToolModelStatus;
  /** Écran d'entrée de l'outil (routes existantes ; les routes finales viendront avec les phases suivantes). */
  route: string | null;
}

const CATALOG: readonly CatalogModel[] = [
  {
    key: 'immobilier',
    title: 'Immobilier',
    description: 'Gérez vos biens, logements, locataires et loyers.',
    icon: 'home-work',
    available: true,
    installable: true,
    status: 'available',
    route: '/immobilier',
  },
  {
    key: 'tontine',
    title: 'Tontine',
    description: 'Gérez vos tontines, cotisations et tours de passage.',
    icon: 'savings',
    available: true,
    installable: true,
    status: 'available',
    route: '/tontine',
  },
  {
    key: 'ceet',
    title: 'CEET',
    description: 'Électricité : relevés d’index et répartition des factures.',
    icon: 'bolt',
    available: true,
    installable: true,
    status: 'available',
    route: '/ceet',
  },
  {
    key: 'tde',
    title: 'TDE',
    description: 'Eau : relevés d’index et répartition des factures.',
    icon: 'water-drop',
    available: true,
    installable: true,
    status: 'available',
    route: '/tde',
  },
  {
    key: 'commerce',
    title: 'Commerce',
    description: 'Gérez votre activité commerciale.',
    icon: 'storefront',
    available: false,
    installable: false,
    status: 'coming_soon',
    route: null,
  },
];

export function getCatalogModels(): readonly CatalogModel[] {
  return CATALOG;
}

export function getCatalogModel(key: string): CatalogModel | undefined {
  return CATALOG.find((m) => m.key === key);
}

/** true seulement pour un modèle du catalogue qui peut être installé. */
export function isInstallableModel(key: string): key is ToolModelKey {
  return getCatalogModel(key)?.installable === true;
}
