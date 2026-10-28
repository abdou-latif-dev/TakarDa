# TakarDa — Phase 6 : plan d'intégration du module Immobilier (PLAN — rien n'est implémenté)

> Objectif : une V1 démontrable de la synchronisation d'**Immobilier seul**, sans rien changer au fonctionnement hors ligne. Cloud fermé par défaut (`CLOUD_ACCOUNT_ENABLED = false`) ; chaque étape est testable en local avec des cloud simulés ; une seule campagne réelle sur le projet de test à la fin. **Aucune modification n'est faite tant que ce plan n'est pas approuvé.**

## 0. État de départ (constats vérifiés)
- Le mécanisme V1 actuel (`cloudSyncService.ts`, `store/cloudStore.ts` : `syncNow`, `syncIfEnabled`, appelés par `BiensListScreen` et `BienDetailScreen`) ne synchronise que les biens et logements dans `records`. Le nouveau moteur est complet mais non branché.
- Le registre déclare 19 types « à synchroniser » (tontines, formulaires, utilitaires, contacts compris) : le **transport** et les **règles** acceptent tous ces types aujourd'hui. Un contrat Immobilier **exige** un locataire (`locataire_id` → contact) : exclure les contacts « en bloc » casserait l'affichage du locataire sur un second appareil.

## Décisions à prendre (recommandations en gras)
1. **Contacts locataires** : (A) **synchroniser uniquement les contacts référencés par un contrat Immobilier synchronisé, jamais les autres** ; (B) ne pas les synchroniser (le locataire apparaît « absent » sur l'autre appareil).
2. **CEET / TDE** (factures, relevés, parts, participations) : **hors V1** (ils dépendent d'Immobilier mais ont leurs propres règles) ; à planifier ensuite.
3. **Règles Firestore** : **resserrer la liste des types dans les règles** à la liste blanche V1 (nouvelle publication sur le projet de test, autorisation distincte), en plus du filtre côté application.

## 1. Liste blanche V1 (périmètre)
Types autorisés : `immobilier.bien`, `immobilier.logement`, `immobilier.contrat`, `immobilier.paiement`, `immobilier.depense`, `immobilier.correction_paiement` + (si option A) `core.contact` restreint. Tout le reste (tontines, formulaires, utilitaires, contacts non liés, journaux, outils) est exclu du transport.
- **Fichiers** : `services/sync/kindRegistry.ts` (nouvelle constante `SYNC_SCOPE_V1` + `isInSyncScope(kind, item, context)`), `services/sync/changeScanner.ts` (la capture ne propose que ce périmètre), `services/sync/inbound.ts` (un changement reçu hors périmètre est refusé et conservé « invalide », jamais appliqué), `services/sync/syncPlanner.ts` et `services/firebase/syncDocModel.ts` (`cloudKinds()` = périmètre), puis `firestore.p4.rules` (liste resserrée).
- **Tests** : `syncScope.test.ts` — chaque type hors périmètre est ignoré à la capture, refusé à l'envoi par le transport, refusé à la réception ; un contact non lié à un contrat n'est jamais capturé ; les données existantes de tontines/formulaires/contacts ne sont ni capturées ni adoptées ; le test statique compare la liste des règles au périmètre.
- **Critères** : aucun document hors périmètre n'est jamais créé dans le cloud de test ; aucun comportement hors ligne modifié (suite existante inchangée).

## 2. Anciennes données : règle unique
**L'activation n'envoie rien de ce qui existe déjà.** L'activation enregistre un instant (`enabledAt`, par compte) ; seuls les éléments créés après cet instant, et les modifications d'éléments déjà confirmés, partent. Un ancien élément modifié après l'activation **ne part pas** (il n'est pas dans la référence) : il reste local, visible « Local » dans le badge.
- **Adoption** : action volontaire distincte et ultérieure (écran dédié, sauvegarde préalable obligatoire, aperçu, confirmation, ne s'active jamais d'elle-même). **Hors phase 6 sauf l'interdiction**.
- **Fichiers** : `services/sync/syncActivation.ts` (nouveau : enregistre `enabledAt` par compte, jamais rétroactif, jamais réinitialisé par une reconnexion), `services/sync/changeScanner.ts` (déjà : `enabledAt`, `adoptedIds` jamais rempli automatiquement).
- **Tests** : `syncActivation.test.ts` — jeu de données réaliste (biens, logements, contrats, paiements, tontines, formulaires créés AVANT) : après activation, capture + cycle complet → 0 envoi ; un nouvel élément part ; une reconnexion ou un changement de compte ne déplace pas `enabledAt` ; l'élément ancien modifié ne part pas ; `adoptedIds` reste vide.
- **Critères** : 0 écriture dans le cloud simulé pour les données antérieures, quel que soit le nombre de cycles.

## 3. Isolation entre comptes de bout en bout
- **Fichiers** : `services/__tests__/syncAccountsE2E.test.ts` (nouveau) utilisant le **vrai** `store/cloudStore` (authentification simulée), `cloudVisibility`, les services Immobilier et les sélecteurs que lisent les écrans (`visibleRecordsFor`, chargeurs de liste et de détail, rapports, statistiques).
- **Scénario** : A se connecte, active, crée un bien, un contrat, un paiement ; cycle ; A se déconnecte ; B se connecte sur le même appareil → ne voit aucun des éléments de A (listes, détail, rapports, statistiques, recherche, activité), ne peut ni modifier ni supprimer (appel direct aux services refusé ou sans effet sur A), ne capture ni n'envoie rien de A ; B crée le sien ; A se reconnecte → retrouve exactement ses données, sans celles de B ; suppression du compte de A → les données de B intactes.
- **Écrans réels** : tests de composants (rendu avec le store) pour `BiensListScreen`, `BienDetailScreen`, `ContratDetailScreen`, rapports.
- **Correctif probable** : les chargeurs qui lisent `records` sans filtre d'affichage (rapports, statistiques, activité) doivent utiliser les enregistrements visibles pour le compte actif — à vérifier et corriger avec tests de non-régression.
- **Critères** : zéro fuite d'affichage ou de modification entre A et B ; hors compte, comportement actuel inchangé.

## 4. États de synchronisation (derrière le drapeau)
- **Fichiers** : `store/cloudStore.ts` (alimenter `states`, `pending`, `conflicts`, `syncing` depuis `engineStatus` / `bannerModel` quand le moteur est actif), `components/immobilier/SyncBadge.tsx` et `SyncBanner.tsx` (aucune nouvelle structure ; ajouter seulement le compteur de suppressions récupérables et les messages de pause : hors ligne, limite quotidienne, pause après échecs).
- **Tests** : `syncStatusIntegration.test.ts` (store + composants, cloud simulé) ; drapeau fermé : rendu strictement identique (instantané).
- **Critères** : jamais « Synchronisé » avant confirmation ; badge « Local » pour les anciennes données.

## 5. Intégrité financière
- **Fichiers** : `services/immobilierReportService.ts`, `services/moduleStatsService.ts`, `services/rentAdvanceService.ts` (chargeurs seulement, pas les formules : ils passent par `effectivePaiements`), `features/immobilier/screens/ContratDetailScreen.tsx` (« Marquer rejeté » → annulation pour un paiement confirmé ; message), suppressions en cascade de `immobilierService.ts` (blocage si un paiement confirmé est concerné, via `financialBlockers`), `services/rentReceiptService.ts` (mention « annulé / corrigé »).
- **Règle de non-régression** : sans correction et sans compte, **résultats strictement identiques** (tests d'égalité profonde sur des jeux de données réalistes, avant/après) ; les écrans actuels inchangés hors compte confirmé.
- **Tests** : étendre `financialView.test.ts` ; `financialGuardScreens.test.ts` (parcours « rejeter », « supprimer le contrat » avec paiement confirmé / non confirmé) ; chaîne complète annulation → cloud simulé → autre appareil.
- **Critères** : aucun total existant ne change sans correction ; un paiement confirmé ne se modifie ni ne se supprime plus directement ; une correction passe par un nouveau fait tracé.

## 6. Cycle réel (préparé, non démarré)
- **Fichiers** : `services/sync/syncRuntime.ts` (nouveau : crée le cycle avec les vrais transports, `@react-native-community/netinfo` si déjà présent sinon un contrôle de connectivité injectable, `AppState` pour le premier plan), `app/_layout.tsx` (un seul point d'appel, derrière le drapeau).
- **Dépendance** : vérifier avant d'ajouter (impact disque et taille) ; sinon utiliser les événements de connexion déjà disponibles. Aucune installation sans accord.
- **Tests** : `syncRuntime.test.ts` (AppState et connectivité simulés : démarre seulement avec drapeau + compte + synchronisation activée ; s'arrête à la déconnexion ; reprend au premier plan ; n'écrit rien hors ligne).
- **Critères** : drapeau fermé → aucun minuteur, aucun écouteur, aucun appel ; **ne pas démarrer** tant que les sections 1 à 5 ne sont pas validées.

## 7. Conflits
- **Fichiers** : `features/profile/screens/SyncConflictsScreen.tsx` + route `app/account/conflicts.tsx` (le bandeau renvoie déjà vers l'écran de compte), sur `services/sync/conflictView.ts` : liste, détail local / distant / base champ par champ, **seules les décisions permises** (`availableResolutions`), confirmation avec la conséquence affichée, historique des conflits résolus et suppressions récupérables.
- **Réutilisation** : composants UI existants (cartes, boutons, `InfoRow`), aucun nouveau design.
- **Tests** : composant (chaque type de conflit n'offre que les décisions autorisées ; les décisions refusées sont désactivées avec leur raison ; financier : aucune décision destructrice) + parcours simulé jusqu'à la convergence.
- **Critères** : un utilisateur peut comprendre et résoudre un conflit sans perte ; les versions écartées restent consultables.

## 8. Ordre, validation et campagne réelle
Ordre : (1) périmètre V1 → (2) anciennes données → (3) isolation E2E → (4) états → (5) finances → (7) conflits → (6) cycle, en dernier. Après chaque étape : TypeScript, tests ciblés, suite ordinaire, lint. **Un seul** test réel final sur le projet de test (A crée sous le drapeau, B reçoit, hors ligne, conflit, suppression de compte), avec ton autorisation et la liste des ressources avant exécution. Production : jamais sans autorisation distincte ; `CLOUD_ACCOUNT_ENABLED` ne passe à `true` qu'après cette campagne et ta décision.

---
## Avancement — étape 1 (liste blanche) RÉALISÉE (2026-10-22), décisions validées
Décisions : (1) contacts locataires : oui, **seulement** ceux référencés par un contrat immobilier autorisé ; (2) CEET / TDE hors V1 ; (3) règles resserrées **préparées, non publiées**.
- **`services/sync/syncScope.ts`** (nouveau) : `SYNC_SCOPE_V1` (6 types immobiliers + `core.contact`), `isSyncKind`, `evaluateScope` (contrat autorisé seulement si son locataire est un contact local ; contact seulement s'il est le locataire d'un contrat autorisé ; paiement seulement si son contrat l'est ; correction seulement si son paiement l'est).
- **Vérifié à chaque couche** : capture (`changeScanner`, via le moteur), planification (`syncPlanner` : blocage `out_of_scope`), envoi (`syncEngine`), transport (`syncDocModel.cloudKinds` = liste V1), réception (`inbound.validateRemoteChange` : type refusé, conservé « invalide »), applicateur local (`localApplier`), règles candidates (`firestore.p4.rules`, listes resserrées, **non publiées**), états (`syncStatusView` : hors périmètre = « local »).
- **Sortie du périmètre** (locataire changé, contrat sans locataire) : jamais d'envoi ni de suppression dans le cloud ; l'élément reste figé ; ses opérations en attente sont retenues.
- **Protection ajoutée** : un locataire encore référencé par un contrat confirmé n'est jamais supprimé seul (`syncPlanner`).
- **Tests** : `syncScope.test.ts` (19). `syncEngine.test.ts` et `syncInbound.test.ts` exercent le moteur GÉNÉRIQUE avec des types hors V1 : ils élargissent la liste via `__useSyncScopeForTests` (réservé aux tests ; un test statique vérifie qu'aucun code de production ne l'appelle).
- **Limites** : les règles ne peuvent pas vérifier qu'un `core.contact` est bien un locataire (pas de requête entre documents) ; à la réception, un contact d'un autre appareil du même compte est accepté s'il est du bon type (le contrôle de lien se fait à la capture) ; l'affichage des collections historiques n'est pas encore masqué (étape 3).

---
## Avancement — étape 2 (activation sans envoi rétroactif) RÉALISÉE (2026-10-22)
**Règle** : ce qui existe sur l'appareil AVANT l'activation reste local, même modifié ensuite. Reconnexion, redémarrage, réactivation et changement de compte ne déplacent jamais l'instant d'activation.
- **`services/sync/syncActivation.ts`** (nouveau) : magasin PAR COMPTE `sync_activation@<uid>` = `{ enabledAt, legacyIds, adoptedIds }`. `activateSync()` est **idempotente** : la première activation d'un compte enregistre l'instant ET la photographie des identifiants de tous les éléments présents (visibles pour ce compte) ; les appels suivants retournent l'activation existante, inchangée. Un magasin illisible n'est jamais réinitialisé. Refusée sans compte actif et dans la démonstration. N'écrit rien dans les données métier, ne marque rien, n'envoie rien.
- **Moteur** : sans activation du compte, capture, envoi et réception sont refusés (`not_activated`) avant tout accès aux données ou au cloud ; le cycle ne démarre pas (`not_activated`). L'instant stocké prévaut sur celui de l'appelant (jamais plus ancien).
- **Exclus de la capture, de la planification et de l'envoi** : les éléments de `legacyIds` (sauf adoptés ou déjà confirmés par le cloud) ET ceux qui en dépendent, de proche en proche (nouveau logement d'un ancien bien, nouveau paiement d'un ancien contrat, nouveau contrat dont le locataire est ancien…). Une dépendance historique ne part donc jamais indirectement, et ses dépendants restent « Local » (pas « en attente » pour toujours). La photographie l'emporte sur la date de création (date falsifiée ou horloge fausse sans effet).
- **Adoption volontaire (préparée, NON implémentée)** : `adoptedIds` existe, vide ; rien ne le remplit (un test statique le vérifie). Future étape distincte : écran dédié, sauvegarde vérifiée préalable, aperçu des éléments et de leurs dépendances (un élément adopté exige que ses parents le soient aussi), confirmation explicite ; elle ajoutera des identifiants à `adoptedIds` et ne touchera pas à `legacyIds`.
- **Suppression du compte** : `sync_activation` fait partie de l'état technique oublié ; aucune donnée métier supprimée.
- **Tests** : `syncActivation.test.ts` (11, mode strict). Les tests du moteur générique suspendent l'obligation via `__useActivationForTests(false)` (réservé aux tests ; vérifié statiquement).
- **Non branché** : aucun écran ni store n'appelle `activateSync` (le branchement du bouton « Activer la synchronisation » est une étape ultérieure). `CLOUD_ACCOUNT_ENABLED` reste `false`.
- **Limites** : l'activation est par compte et par appareil (un second appareil active à son tour) ; un élément créé exactement pendant l'activation est tranché par le verrou de synchronisation ; les éléments d'un autre compte ne sont pas photographiés (ils lui sont invisibles).

## Avancement — étapes 3 à 7 (locales)

- **Étape 3 (isolation)** : `coreService` refuse de modifier/supprimer un enregistrement masqué ; contacts et activités masqués par compte (`cloudOwnerUid`, `visibleContactsFor`, `visibleActivities`) ; test `syncAccountsE2E.test.ts`.
- **Étape 4 (états)** : façade `services/syncDisplay.ts`, store `store/syncEngineStore.ts` (inactif par défaut), pastille et bandeau alimentés par les états réels du moteur ; test `syncStatusIntegration.test.ts`.
- **Étape 5 (intégrité financière)** : façade `services/effectivePayments.ts` appliquée au rapport, aux statistiques, au détail du contrat, au loyer à enregistrer, aux avances et à l'accueil (identique sans compte ou sans correction) ; garde « Marquer payé/rejeté » et suppressions en cascade ; test `financialIntegration.test.ts`.
- **Étape 6 (conflits)** : écran `SyncConflictsScreen` + route `app/account/conflicts` (fermée avec le drapeau) ; décisions via `decideConflict` / `restoreDeletion` (façade) ; test `syncConflictsUi.test.ts`.
- **Étape 7 (cycle réel préparé)** : `services/sync/syncRuntime.ts` (dépendances injectées) et `services/firebase/syncRuntimeBoot.ts` (composition de production) — jamais appelés par l'application ; test `syncRuntime.test.ts`.
