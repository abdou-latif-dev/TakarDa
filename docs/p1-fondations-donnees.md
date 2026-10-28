# TakarDa — P1 : fondations locales des données (sans synchronisation)

> Périmètre : **local uniquement**. Aucune synchronisation, aucune connexion Firebase, aucune règle modifiée. Le mécanisme de synchronisation existant (`services/cloudSyncService.ts`, biens et logements, fermé par `CLOUD_ACCOUNT_ENABLED = false`) n'est pas touché et n'utilise aucun des modules ci-dessous.

## Modules créés
| Fichier | Rôle |
|---|---|
| `services/sync/kindRegistry.ts` | Registre des types métier **stables** (`immobilier.bien`, `tontine.cotisation`…). Traduit un enregistrement local (outil + entité) en type stable ; les identifiants de définition, propres à chaque appareil, ne sont jamais l'identité cloud. Indique où vit chaque type, s'il sera synchronisé (`planned`) ou non (`local_only`), s'il est un fait financier, et sa clé logique quand le code métier en garantit une. |
| `services/sync/relationManifest.ts` | Manifeste de relations : déclare tous les champs-références (relations du moteur, textes-références comme `locataire_id` ou `participant_id`, identités, contenus de l'application, identifiants locaux). Détecte les références inconnues, extrait les références présentes, repère les orphelins, calcule l'ordre d'envoi (parents d'abord). Aucune conversion de données. |
| `services/sync/localSyncMeta.ts` | Métadonnées **locales** (état, opération en attente, révision connue, origine, tentatives, erreurs), dans un magasin séparé propre à l'espace actif (`sync_meta` / `demo/sync_meta`). Jamais ajoutées aux documents métier, jamais envoyées. Un magasin illisible n'est jamais traité comme vide ni écrasé. |
| `services/sync/derivedIds.ts` | Identifiant déterministe des couvertures de loyer par l'avance : `cov-<contrat>-<AAAA-MM>`. |
| `services/backupService.ts` (+ `services/sha256.ts`) | Sauvegarde complète (toutes les collections, `tours` comprises, espace d'origine, empreinte SHA-256) et restauration validée (confirmation, validation, sauvegarde de sécurité relue, mode `merge` par défaut, refus des sauvegardes vides et des mélanges démonstration / personnel). |

## Modifications de l'existant
| Fichier | Changement |
|---|---|
| `services/db.ts` | `genId` : partie aléatoire de **16** caractères (96 bits) au lieu de 8 pour les NOUVEAUX identifiants. Les anciens restent valides et inchangés (chaînes opaques ; aucun lecteur ne dépend de la longueur). |
| `services/coreService.ts` | `createRecord` accepte un `id` imposé (réservé aux enregistrements dérivés) : idempotent si l'identifiant existe, refusé s'il est invalide ou appartient à un autre type. Sans `id`, comportement inchangé. |
| `services/rentAdvanceService.ts` | Les couvertures par l'avance utilisent l'identifiant déterministe : deux appareils produisent le même enregistrement. Le plan de couverture (`planAdvanceCoverage`) voit les couvertures anciennes (identifiant aléatoire) comme déjà réglées : pas de doublon. |
| `services/persistence.ts` | Exporte `workspaceId`, `workspaceKey`, `snapshotCollections`, `replaceCollections`, `COLLECTION_NAMES` (aucun changement des clés ni de l'enregistrement existant). |
| `features/profile/screens/StorageScreen.tsx` | L'export utilise la sauvegarde complète (l'ancien export omettait les tours de tontine). |

## Décisions appliquées
- **Registre et adaptateurs, pas de déplacement de données** : tontines et formulaires restent dans leurs blocs historiques ; ils sont décrits par le registre.
- **Identifiant déterministe uniquement quand la règle métier garantit l'unicité** : couvertures par l'avance. Pour les autres clés logiques confirmées (cotisation : tour + membre, relevé : fournisseur + mois + participant, tour : groupe + numéro), le registre les **déclare** (détection de doublons pour la migration) sans changer la génération des identifiants.
- **Aucun identifiant existant n'est modifié.**
- **Restauration non reliée à l'interface** dans P1 : l'API est testée sur des données isolées.

## Limites connues
- Les cotisations de tontine et les relevés CEET/TDE gardent des identifiants aléatoires : deux appareils pourraient créer deux enregistrements pour la même clé logique. La détection existe (`findLogicalDuplicates`) ; la fusion relève de P2/P3.
- Le format d'identifiant allongé ne concerne que les nouvelles créations.
- Les pièces jointes (URI locales) ne sont pas dans la sauvegarde partageable.
