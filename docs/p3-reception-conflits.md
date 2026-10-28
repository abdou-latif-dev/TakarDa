# TakarDa — P3 : réception, suppressions logiques, conflits et faits financiers (local, isolé)

> **Aucune synchronisation n'est active.** Rien de P3 n'est branché à un service, un écran ou un magasin de l'application : aucun module n'importe de SDK, n'ouvre de connexion ni n'a de transport. La lecture passe par une **interface** (`PullTransport`) fournie par l'appelant (dans P3 : uniquement les tests, avec un cloud simulé en mémoire). `CLOUD_ACCOUNT_ENABLED` reste à `false` ; le mécanisme existant (`cloudSyncService.ts`) n'est pas touché.

## Modules (`services/sync/`)
| Fichier | Rôle |
|---|---|
| `merge.ts` | Fusion à trois voies **pure**, champ par champ (base / locale / distante). |
| `inboundStores.ts` | Magasins persistants : pierres tombales (suppressions reçues), conflits (ouverts + historique), changements en attente, curseur. |
| `localApplier.ts` | `LocalApplier` (interface) + réalisation par défaut sur les collections en mémoire. Appelée **explicitement** seulement. |
| `inbound.ts` | Validation, `applyRemoteChanges`, `runInbound` (pages + curseur), `resolveConflict`, `restoreTombstone`, `releaseHeldDuplicate`, `PullTransport`. |
| `financialCorrection.ts` | Correction / annulation explicite d'un paiement ou d'une cotisation (nouveau fait tracé) + état effectif calculé. |
| `syncLock.ts` | Verrou unique partagé par l'envoi et la réception. |
| (modifiés) `syncQueue.ts`, `syncEngine.ts`, `syncPlanner.ts`, `changeScanner.ts`, `wireFormat.ts`, `kindRegistry.ts`, `relationManifest.ts` | Référence enrichie (contenu de base, clé logique), conflits ouverts retenus à l'envoi, doublons contre la référence, corrections prises en compte. |

## Règles appliquées (et testées)
1. **Faits financiers** (paiement, cotisation, correction) : jamais supprimés ni réécrits silencieusement. Une modification ou suppression distante devient un **conflit explicite** (`financial_remote_change`, `financial_remote_delete`) ; l'élément local reste intact. Une création distante est appliquée. La correction passe par un **nouveau fait** (`immobilier.correction_paiement`, `tontine.correction_cotisation`) qui référence le fait initial : *annulation* (définitive, montant effectif 0) ou *correction* (nouveau montant, la plus récente prévaut). Ajout seulement : toute modification ou suppression d'une correction est retenue par la politique financière.
2. **Suppression distante non financière** : suppression **logique réversible**. Copie complète conservée (pierre tombale) *avant* le retrait ; l'élément quitte les collections vives ; le suivi est retiré (aucune suppression renvoyée en écho). `restoreTombstone` le réinsère localement, mais ouvre un conflit `restored_tombstone` qui **retient tout envoi** (le cloud n'a pas d'opération de restauration définie).
3. **Conflits non financiers** : fusion automatique **seulement** si les champs touchés sont distincts ; même champ des deux côtés → les deux versions (+ la base) sont conservées dans le conflit, rien n'est choisi, rien n'est envoyé. Sans contenu de base connu : `no_base`, jamais une fusion devinée. Résolution explicite : `keep_remote`, `keep_local`, ou champ par champ (chaque champ en désaccord doit être choisi) ; la version écartée est conservée dans l'historique.
4. **Doublons logiques** : signalés (`report.duplicates`) et retenus (`logical_duplicate`), jamais fusionnés. Comparaison avec les éléments locaux **et** la référence (clés logiques mémorisées). `releaseHeldDuplicate` est une décision explicite. Les identifiants des cotisations et relevés ne sont pas rendus déterministes.
5. **Anciennes données** : aucune migration ni adoption (la capture ignore ce qui précède l'activation).
6. **Démonstration / personnel** : toute entrée refuse l'espace de démonstration ; magasins distincts (`demo/…`) ; un changement d'un autre compte est refusé.

## Validation d'un changement reçu
Type connu et synchronisable ; révision entière ≥ 1 ; propriétaire = compte courant ; identifiant et type du contenu cohérents ; aucun champ réservé à l'appareil (`toolId`, `entityDefinitionId`, `cloudOwnerUid`, identités locales) ; références déclarées au manifeste ; contenu et références cohérents (empreinte recalculée) ; parents présents (sinon attente). Version de schéma plus récente → retenu (`newer_schema`), jamais appliqué. Invalide → signalé et conservé pour diagnostic.

## Idempotence, interruption, reprise
- Rejouer un changement (révision ≤ connue) ne change rien. Seule la dernière révision d'un identifiant dans un lot est traitée.
- Ordre d'écriture : élément local → référence (adoption si contenu identique après interruption) ; suppression : copie → retrait → fin du suivi (la reprise termine le retrait).
- Le curseur n'avance qu'**après** le traitement complet d'une page ; erreur réseau ou de stockage → arrêt propre, page rejouée sans effet.
- Parents d'abord (ordre du manifeste), suppressions enfants d'abord ; un parent encore référencé n'est pas retiré (`has_dependents`).
- Magasin illisible → `store_corrupted` avant toute écriture, contenu laissé intact. Une seule passe à la fois (verrou partagé avec l'envoi).

## Ce que l'intégration Firebase (projet de test) devra fournir
1. Une implémentation de `PullTransport` (pagination par curseur, documents au format `RemoteChange` : `id`, `kind`, `rev`, `deleted`, `deletedAt`, `wire`) et de `SyncTransport` (envoi, lecture), **hors** des modules actuels.
2. Des règles de sécurité pour les nouvelles collections et un choix du modèle de révision (`rev` incrémenté côté serveur, refus si `expectedRev` ne correspond pas).
3. Une opération **« restauration »** (réécriture d'un élément supprimé) : indispensable pour `keep_local` sur un conflit `update_vs_delete` / `restored_tombstone`. Tant qu'elle n'existe pas, ces décisions sont refusées (`unsupported`) et le conflit reste ouvert.
4. Une règle serveur « fait financier : création seulement » (aucune mise à jour ni suppression), cohérente avec la politique locale.
5. Le branchement explicite (appel de `captureLocalChanges` / `runOnce` / `runInbound`) derrière `CLOUD_ACCOUNT_ENABLED`, et l'écran de résolution des conflits.
6. Les tests N1/N2/émulateur dédiés (non lancés ici).

## Limites connues
- Le calcul des totaux et l'affichage tiennent encore compte du fait initial seul : brancher `effectiveFinancialState` dans les écrans (Immobilier, Tontine) est une étape ultérieure (aucun service métier modifié).
- La restauration cloud, la résolution `keep_local` d'une suppression distante et l'effacement d'un fait financier distant sont volontairement **bloqués**.
- Les changements à `no_base` concernent les éléments confirmés avant P3 (référence sans contenu de base) : ils sont toujours signalés comme conflit, jamais fusionnés.
- `LocalApplier` par défaut relit les collections complètes à chaque changement : acceptable pour de petits volumes, à optimiser avant usage réel.
- Un changement retenu `invalid` n'est jamais rejoué tant qu'une révision plus récente n'arrive pas.
