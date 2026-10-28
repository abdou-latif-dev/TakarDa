# TakarDa — P2 : moteur de synchronisation hors réseau (local, isolé)

> **Aucune synchronisation n'est active.** Le moteur n'est branché à aucun service, écran ni magasin de l'application ; il n'importe aucun SDK, n'ouvre aucune connexion et n'a pas de transport : `runOnce` exige un `SyncTransport` fourni par l'appelant (dans P2, uniquement les tests, avec un cloud simulé en mémoire). `CLOUD_ACCOUNT_ENABLED` reste à `false` et le mécanisme de synchronisation existant (`cloudSyncService.ts`) n'est pas touché.

## Modules (tous dans `services/sync/`, nouveaux)
| Fichier | Rôle |
|---|---|
| `localStore.ts` | Magasin persistant validé, propre à l'espace actif, sérialisé ; un magasin illisible n'est jamais traité comme vide ni écrasé. |
| `wireFormat.ts` | Format d'échange (sans identifiants locaux, ni `createdBy`, ni `cloudOwnerUid`) et empreinte du **contenu** métier (pas des dates de retouche). |
| `syncQueue.ts` | File persistante : **une opération explicite par enregistrement** (création, modification, suppression logique), fusion sans perte, tentatives, erreurs, blocages explicites ; référence de synchronisation (dernière empreinte confirmée) ; délai de reprise exponentiel. |
| `changeScanner.ts` | Repère les changements en **comparant** l'état local à la référence (aucun crochet dans les services métier) ; les anciennes données ne partent jamais d'elles-mêmes ; rapport de doublons logiques (sans fusion). |
| `syncPlanner.ts` | Décide ce qui est prêt ou bloqué, et l'ordre : parents d'abord (manifeste de relations), suppressions enfants d'abord ; références absentes ou invalides, faits financiers, doublons logiques retenus. |
| `syncEngine.ts` | `captureLocalChanges` (mise en file idempotente) et `runOnce` (envoi ordonné, reprise, vérification avant renvoi, arrêts sûrs). |

## Comportements garantis (et testés)
- **Idempotence :** recapturer ou relancer ne crée ni ne renvoie rien ; un seul `opId` par opération, valable comme jeton d'idempotence.
- **Suppression logique explicite :** l'opération `delete` porte un horodatage ; jamais de suppression physique. Une création jamais envoyée puis supprimée est annulée ; si une tentative a eu lieu, la suppression est envoyée.
- **Reprise après interruption :** une opération « en cours » ou dont la réponse est inconnue est **vérifiée** auprès du transport (`read`) avant tout renvoi ; contenu identique → confirmée sans renvoi.
- **Erreurs de stockage :** si l'enregistrement local échoue après un envoi réussi, l'exécution s'arrête (`persistence_error`) ; l'opération reste « en cours » et sera vérifiée, jamais renvoyée à l'aveugle.
- **Magasins illisibles :** file, référence ou métadonnées corrompues → `store_corrupted` **avant tout envoi**, contenu laissé intact.
- **Démonstration :** aucune capture, aucun envoi, aucune écriture de magasin de synchronisation dans l'espace de démonstration.
- **Politique financière (préparation de P3, réversible) :** toute modification ou suppression d'un paiement ou d'une cotisation est **retenue** (`financial_policy`), jamais envoyée ni abandonnée ; seule une décision explicite (politique fournie par l'appelant) la libère. La création reste possible.
- **Doublons logiques :** retenus (`logical_duplicate`), jamais fusionnés ni envoyés en double. Les identifiants des cotisations et relevés ne sont pas rendus déterministes.
- **Conflits et refus :** retenus de façon **collante** (`conflict`, `permanent_error`), jamais retentés automatiquement ni résolus.

## Limites connues (pour P3 et suivants)
- Aucun transport réel : le comportement face au vrai service (limites, latences, jetons) n'est pas éprouvé.
- Pas de réception : suppressions et modifications venues d'un autre appareil, résolution de conflits et politique financière définitive relèvent de P3.
- Le moteur lit les collections via `snapshotCollections()` (copie complète) à chaque passe : acceptable pour de petits volumes, à optimiser avant un usage réel.
- Les pièces jointes locales (URI de fichiers) ne sont pas dans les enregistrements envoyés.
