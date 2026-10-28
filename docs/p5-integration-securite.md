# TakarDa — P5 : prérequis de sécurité avant l'intégration d'un premier module (cloud fermé)

> **Le cloud reste fermé** (`CLOUD_ACCOUNT_ENABLED = false`). Le moteur de synchronisation n'est branché à aucun module métier ni écran. P5 ne change que ce qui est joignable derrière ce drapeau (suppression de compte) et ajoute, dans le moteur, une opération de restauration explicite.

## 1. Suppression de compte : procédure complète branchée
Flux réel : `store/cloudStore.ts` → `deleteAccount(firebaseAccountDeletionApi, …)` → `deleteCloudData(uid)`.
- **Avant P5** : `deleteAccountCloudData` seul — les documents `syncRecords` seraient restés orphelins et inatteignables (l'espace supprimé ferme l'accès à ses sous-collections).
- **Maintenant** (`services/firebase/accountDeletionApi.ts` → `accountCloudErasure.ts`) :
  1. propriété démontrée par lecture serveur (sinon **rien n'est touché**, statut `ownership_unproven`) ;
  2. verrou de suppression posé puis confirmé ;
  3. `syncRecords` purgé par lots, puis **vérifié vide** par une lecture serveur ;
  4. **seulement alors** : `records`, espace, profil (procédure existante, inchangée) ;
  5. le compte Firebase n'est supprimé qu'après un rapport `verified` (orchestration existante).
- **Interruption** : chaque étape est idempotente. Une purge ou un « reste » incomplet donne `cloud_incomplete` (ou `cloud_uncertain` si le serveur ne répond pas) : le compte et les données locales sont conservés, le message indique les documents de synchronisation restants, et « Réessayer » reprend là où la procédure s'est arrêtée. Aucune suppression partielle n'est jamais présentée comme réussie (`verified` exige synchronisation purgée **et** reste vérifié).
- **Espace déjà absent** : le reste conclut ; le rapport signale `syncRecords.status = 'space_absent'` (documents éventuels inatteignables), jamais « purgé ».
- Testé : `accountCloudErasure.test.ts` (orchestration réelle `deleteAccount` + cloud en mémoire), `syncAccountErasure.test.ts`, contrôles statiques (`firestoreSyncRules.test.ts`). Le scénario S7 de `sync.n2.test.ts` a validé la même composition contre le projet de test (campagne du 2026-10-20).

## 2. Restauration et conflits de suppression
Ajouts dans le moteur (aucune règle Firestore modifiée) :
- **Opération `restore`** dans la file (`syncQueue.ts`) : sans contenu, à la révision de la suppression. `PushRequest.op` accepte `restore` ; le transport la délègue à `restore` (propriétaire, type et révision vérifiés ; fait financier refusé). La file la fusionne sans perte (elle remplace une modification en attente ; une suppression locale ultérieure l'annule).
- **Après une restauration confirmée** : la référence reçoit une empreinte **inconnue** volontaire (`RESTORED_PLACEHOLDER_HASH`) — le contenu du cloud est celui d'avant la suppression, pas le contenu local — donc la capture suivante envoie le contenu local comme **modification ordinaire** au-dessus de la révision de restauration.
- **Reprises** : réponse perdue → la reprise relit le cloud (non supprimé) et confirme sans renvoyer ; déjà restauré ailleurs → confirmé ; supprimé de nouveau à une autre révision → conflit retenu (aucun envoi).
- **`keep_local` désormais pris en charge** pour `update_vs_delete` (modifié ici, supprimé ailleurs) et `restored_tombstone` (suppression reçue puis restaurée localement) : il met la restauration en file. Toujours refusé : `fields` (aucun champ à choisir), et **tout fait financier** (`financial_remote_delete`, ou `update_vs_delete` sur un type financier) — correction explicite à la place.
- **Historique préservé** : le conflit résolu va dans l'historique avec la version locale, la suppression distante, la base et le texte de la décision ; les protections financières sont inchangées (politique du moteur + transport + règles).
- **Modèle de lecture pour l'interface** (`conflictView.ts`) : `listOpenConflicts`, `listResolvedConflicts`, `listRecoverableDeletions`, `availableResolutions` (décisions permises / refusées, avec raison et conséquence). L'interface n'a aucune règle à réécrire.

## 3. Isolation locale par compte (P5, étape 2)
**Constat avant correction** : le moteur rangeait file, référence, conflits, curseur… sous des clés communes à tous les comptes de l'appareil, et ne regardait pas à qui appartenait un élément local. Un second compte connecté sur le même appareil aurait donc hérité de la file du premier, et aurait pu **capturer et envoyer vers son propre cloud** les éléments du premier (ceux reçus ou créés sous l'autre compte). L'ancien masquage d'affichage (`cloudOwnerUid`) ne couvrait que des biens et logements marqués à la création.

**Maintenant** (`syncAccount.ts`, `ownership.ts`, `localStore.ts`) :
- **État par compte** : tous les magasins du moteur sont sous `<magasin>@<uid>` ; sans compte actif, aucune lecture ni écriture (pas de repli sur une clé commune). Un identifiant de compte inutilisable comme clé est refusé.
- **Compte annoncé = compte actif** : `captureLocalChanges`, `runOnce`, `runInbound`, `resolveConflict`, `restoreTombstone` refusent un compte qui n'est pas le compte actif.
- **Registre de propriété de l'appareil** (par espace de travail, commun aux comptes) : un élément créé depuis l'activation est inscrit au nom du compte au moment de sa capture ; un élément reçu l'est avant son écriture (et porte `cloudOwnerUid` pour les enregistrements du moteur générique : l'affichage V1 le masque aux autres comptes et sans compte). Un élément d'un autre compte n'est ni vu, ni capturé, ni envoyé, ni écrasé, ni retiré, ni restauré par le moteur. Les anciens éléments sans propriétaire ne sont jamais adoptés (aucune migration).
- **Changement de compte pendant une exécution** : différé jusqu'à la fin de l'exécution (le verrou compte les exécutions) ; l'exécution s'arrête proprement à l'étape suivante (`stopped: 'account_changed'`). Aucune écriture ne tombe dans le magasin d'un autre compte.
- **Parcours** : connexion / changement de compte / déconnexion → `store/cloudStore.ts` appelle `setSyncAccount` au même endroit que `setActiveCloudUid` (sans rien lancer) ; réouverture : le compte revient avec sa file et sa référence ; suppression de compte : `forgetSyncAccountState` retire seulement l'état technique (file, référence, métadonnées, curseur, attente, compteurs) et rend les éléments du compte sans propriétaire ; **aucune donnée métier, correction financière, conflit ni copie de suppression n'est supprimée**.
- **Limite** : le masquage d'AFFICHAGE ne couvre que les enregistrements du moteur générique (Immobilier, factures). Les collections historiques (tontines, formulaires, contacts) sont protégées contre la capture et l'envoi, mais **pas encore masquées à l'écran** : à traiter avant leur intégration.
- Testé : `syncAccountIsolation.test.ts` (12 tests).

## 4. Cycle de synchronisation (P5, étape 3) — conçu, non démarré
`syncCycle.ts` ne contient que la **politique** ; capture, file, envoi, réception, reprises et idempotence restent ceux du moteur. Aucun minuteur n'existe à l'import, rien ne le crée dans l'application.
- **Quand** : changement local → capture immédiate (locale, gratuite), envoi seul après 3 s d'accalmie ; démarrage, retour au premier plan, retour du réseau, minuteur (5 min au premier plan) → cycle complet ; action manuelle → sans délai de 30 s entre cycles, mais jamais au-delà des plafonds quotidiens.
- **Jamais** : sans compte, hors ligne (aucune tentative), pendant un cycle en cours (les demandes sont fusionnées en une relance), après la déconnexion (arrêt propre, file conservée).
- **Coupures et reprises** : échec réseau → reprise exponentielle (30 s, 60 s… plafonnée à 15 min) ; 8 échecs consécutifs → pause (reprise sur action manuelle, premier plan ou retour du réseau) ; chaque opération est idempotente (identifiant d'opération unique, vérification avant renvoi).
- **Limites de coût** (par défaut, modifiables) : 5 000 lectures et 2 000 écritures par jour et par compte (jour UTC), 100 écritures et 5 pages de 100 par cycle, 30 s minimum entre cycles (5 s entre actions manuelles), 30 cycles par heure. Les compteurs sont des estimations par excès, persistés par compte ; au-delà : pause jusqu'au lendemain.
- **Défaut trouvé et corrigé en chemin** : la première page de lecture d'une instance relit 10 s en arrière (recouvrement). Si la fenêtre contenait au moins une page de documents, la lecture ne progressait plus jamais ; elle relit maintenant strictement après le curseur quand la fenêtre est saturée.
- Testé : `syncCycle.test.ts` (15 tests, horloge et minuteurs simulés).

## 5. Conflits et états de synchronisation (P5, étape 4)
- **Réutilisation de l'interface existante** : `SyncBadge` / `SyncBanner` lisent un état par enregistrement (`local | pending | synced | conflict | error`), un nombre en attente et la liste des conflits. `syncStatusView.ts` (`engineStatus`, `bannerModel`) calcule exactement ces données à partir du moteur ; **aucun composant n'est modifié**. Brancher = alimenter les mêmes champs du store.
- **Nouveauté** : les suppressions récupérables (élément retiré ici après une suppression ailleurs) ne sont pas un badge (l'élément n'existe plus dans les listes) mais une liste + un compteur ; leurs décisions viennent de `conflictView.ts`.
- **Règles d'état** : jamais « synchronisé » avant la confirmation du cloud ; une modification locale pas encore capturée est déjà « en attente » ; un refus définitif est « erreur » (jamais perdu) ; un fait financier modifié localement reste « en attente » (retenu).
- **Historique et restrictions financières** préservés (voir §2). Testé : `syncStatusView.test.ts` (9 tests).

## 6. Totaux et faits financiers (P5, étape 5) — analyse et préparation
**Ce qui lit des paiements** : rapport (`immobilierReportService`), statistiques (`moduleStatsService`), solde d'avance et couvertures (`rentAdvanceService`), mois impayés et chronologie (`immobilierService`), activité, reçus (`rentReceiptService`), écrans de contrat.
**Approche retenue (sans toucher aux formules)** : `financialView.ts` fournit des paiements EFFECTIFS (copies en mémoire) : annulé → statut `rejete` (« non payé », déjà compris partout : non encaissé, mois redevenu dû, couverture d'avance non consommée) ; corrigé → montant remplacé ; sans correction → les MÊMES enregistrements. Testé avec les vrais calculs : identique sans correction ; montants et impayés cohérents avec une correction, plusieurs corrections, une annulation, une couverture d'avance annulée.
**Ce qui reste à adapter avant d'AUTORISER les corrections** (non fait, volontairement) :
1. Brancher les paiements effectifs dans les chargeurs (`loadImmobilierReport`, `loadImmobilierStats`, `loadImmobilierHistory`, chargement de l'écran de contrat, planification des couvertures d'avance) — sans compte actif, résultat identique.
2. **Les écrans actuels permettent des mutations que le moteur retiendrait pour toujours** : « Marquer rejeté » sur un paiement (`ContratDetailScreen`), suppression d'un contrat, d'un logement ou d'un bien avec ses paiements (`immobilierService`, lignes de suppression en cascade). `adviseFinancialMutation` / `financialBlockers` disent quoi faire pour un paiement déjà confirmé : modification → correction, rejet → annulation, suppression → interdite. À brancher sur ces écrans.
3. Reçus et activité : indiquer « annulé / corrigé » pour un paiement corrigé ; décision produit sur l'émission d'un reçu pour un paiement annulé.
4. Tontine (cotisations) : même principe, à traiter avec son intégration.

## 7. Validation réelle du parcours de suppression — PRÉPARÉE, NON EXÉCUTÉE
`real/deletionFlow.n2.test.ts` exécute le **même `deleteAccount`** que l'application avec **la même composition** (`cloudDeletionComposition.ts`, partagée avec `accountDeletionApi.ts`) sur des comptes jetables du projet de test : F1 parcours complet ; F2 interruption pendant la purge de `syncRecords` (reste intact, verrou, autre compte intact, reprise) ; F3 interruption pendant « le reste » après purge vérifiée ; F4 mauvais mot de passe (rien n'est supprimé). Nettoyage vérifiable : échec = suite en échec avec la liste des comptes à purger. Garde-fous statiques : `firebaseTestSyncGuards.test.ts` (les deux fichiers N2). **Plan, commandes et ressources : présentés à part, avant toute exécution.**

## 7 bis. Validation réelle sur le projet de test (2026-10-20 / 2026-10-21) — TERMINÉE
Projet `takarda-n2-test` (numéro `438284688014`), règles candidates `firestore.p4.rules` actives, production jamais touchée.
- **`deletionFlow` (parcours de suppression réel)** : 4 scénarios sur 4 réussis, suite entière en code 0 (un premier lancement avait réussi ses 4 scénarios, mais la suite avait échoué à cause du contrôle de nettoyage : le harnais ne pouvait pas se reconnecter à des comptes supprimés par le parcours testé ; contrôle corrigé : seuls les refus d'identifiants explicites de comptes dont la suppression est vérifiée sont écartés ; vérification d'orphelins ajoutée : 0).
- **`sync.n2` (régression)** : un premier lancement a réussi 6 scénarios sur 7. Le scénario restant, S6 (moteur de bout en bout), échouait parce que ce test d'avant l'isolation par compte n'activait pas de compte de synchronisation — la garde a fonctionné comme prévu. Correctif du TEST seul (compte activé avant la capture, désactivé après chaque scénario même en échec), puis **S6 validé séparément : réussi** (4 envoyés, 4 reçus à l'identique, aucun écho, démonstration jamais envoyée).
- **Nettoyage** : comptes jetables créés par ces campagnes supprimés ; la liste des comptes du projet de test est vide ; effacements rapportés « vérifiés » ; 0 orphelin Firestore pour les comptes contrôlés.
- **Limite** : S1–S5 et S7 n'ont pas été rejoués après le correctif de S6 (le correctif ne touche que le test S6).

## 8. Terminé / à faire avant le premier module immobilier
**Terminé (local, testé)** : transports et règles (validés sur le projet de test pour la synchronisation) ; suppression de compte complète ; restauration explicite ; isolation par compte ; politique de cycle ; états réels dans la forme de l'interface ; vue financière effective et garde ; test N2 du parcours de suppression préparé.
**À faire** (aucun n'a été commencé) :
1. **Valider sur le projet de test le parcours de suppression** (autorisation distincte) ; relancer la campagne de synchronisation après les changements de P5 (isolation, plafond d'opérations, correction du recouvrement).
2. **Brancher** (premier module : Immobilier) : créer le cycle avec les vrais transports et la détection réseau / premier plan ; alimenter le store du compte avec `engineStatus` ; écran(s) de conflit sur `conflictView.ts` ; brancher les paiements effectifs et la garde (§6) ; activer derrière `CLOUD_ACCOUNT_ENABLED`.
3. **Masquage d'affichage des collections historiques** (tontines, formulaires, contacts) avant leur intégration.
4. **V1 de `records`** fermée tant que le moteur est actif ; migration des anciennes données = étape séparée (adoption explicite).
5. **Production** : publication des règles `firestore.p4.rules` = autorisation distincte.
6. Limites connues du moteur : après une restauration, conflits ultérieurs `no_base` jusqu'à la prochaine confirmation ; `keep_local` sur un changement financier distant garde le fait local mais toute modification locale reste retenue.
