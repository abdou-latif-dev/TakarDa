# TakarDa — P4 / P4.1 : transports Firebase de synchronisation (préparés, non branchés, non validés en réel)

> **Rien n'est actif.** Aucun module de P4 n'est importé par l'application ; `CLOUD_ACCOUNT_ENABLED` reste à `false` ; aucune règle n'est publiée ; aucun compte n'est créé ; aucun test d'émulateur ni N1/N2 n'a été lancé. Le projet de production `takarda-c8cd8` n'est jamais concerné. Ce document décrit ce qui est PRÉPARÉ et la suite à autoriser.

## 1. Fichiers
| Fichier | Rôle |
|---|---|
| `services/firebase/syncDocModel.ts` | Modèle des documents cloud, contraintes réelles de Firestore, curseur, traduction des erreurs. Pur (aucun SDK). |
| `services/firebase/firestoreSyncTransport.ts` | `SyncTransport` + `PullTransport` + restauration (aucune suppression physique), au-dessus d'un port `SyncBackend`. Aucun SDK. |
| `services/firebase/firestoreSyncBackend.ts` | Réalisation des ports avec le SDK Firestore (seul module de P4 qui l'importe). Reçoit `Firestore` et `uid` : ne lit ni configuration ni clé, ne démarre rien. |
| `services/firebase/syncAccountErasure.ts` | **P4.1** — procédure d'effacement du compte : `syncRecords` puis le reste, avec reprise et vérification. Pure ; seule voie de suppression physique. |
| `firestore.p4.rules` | **Candidat** de règles = règles actuelles + un bloc délimité (`P4 SYNC BEGIN/END`). Non publié. |
| `firebase.n2.sync.json` | Configuration de publication du candidat (ne désigne aucun projet : `--project` est toujours explicite). |
| Tests | `syncAccountErasure.test.ts`, `firebaseTestSyncGuards.test.ts`, `firestoreSyncTransport.test.ts`, `syncCloudRoundTrip.test.ts`, `firestoreSyncRules.test.ts` (ordinaires) ; `firestoreSyncRules.emulator.test.ts` (émulateur) ; `firebaseTestProject/real/sync.n2.test.ts` (projet de test) ; `helpers/syncCloudMemory.ts` (cloud en mémoire). |
| Modifié dans le moteur | `syncQueue.ts` / `syncEngine.ts` : marque aléatoire de file (`nonce`) pour que les `opId` soient **uniques** (voir §3). |

## 2. Format des documents distants
Chemin : `spaces/personal_<uid>/syncRecords/{recordId}` (l'identifiant du document est l'identifiant local ; `records`, utilisé par la synchronisation V1, n'est pas touché).

| Champ | Contenu |
|---|---|
| `kind`, `schemaVersion`, `ownerUid`, `statusKey`, `createdAt`, `updatedAt`, `body`, `refs` | Le format d'échange du moteur (`WireRecord`), sans identifiants locaux. |
| `rev` | Entier, `1` à la création, **+1 exactement** à chaque écriture. |
| `deleted`, `deletedAt`, `restoredAt` | Suppression logique et trace de restauration (le contenu reste dans le cloud). |
| `lastOpId` | Jeton d'idempotence de la dernière opération appliquée. |
| `serverUpdatedAt` | **Heure du serveur** (imposée par les règles : `== request.time`) ; sert de curseur de lecture. |

Tous les champs sont toujours présents (les règles les valident strictement). Les types admis sont, depuis la phase 6 (étape 1), la liste blanche V1 Immobilier seul (voir `docs/p6-plan-integration-immobilier.md`) ; un test compare la liste des règles à cette liste.

## 3. Révisions, idempotence, concurrence
- **Pas de compteur serveur** : la révision est calculée par le client dans une **transaction** (lecture, puis écriture de `rev + 1`) ; les règles refusent toute écriture qui ne vaut pas « ancienne + 1 ». Deux appareils qui écrivent à la même révision : l'un réussit, l'autre reçoit un **conflit** (le SDK rejoue la transaction ; le transport voit alors la nouvelle révision).
- **Réponse perdue** : le transport compare `lastOpId` de la dernière écriture au jeton de l'opération ; identique → il renvoie la révision déjà obtenue, **sans nouvelle écriture**. Si une autre écriture est intervenue depuis, c'est un conflit : le moteur lit le cloud et confirme sans renvoi si l'empreinte du contenu est déjà la sienne (comportement P2, testé).
- **Défaut trouvé et corrigé pendant P4** : les `opId` du moteur (`op-1`, `op-2`…) repartaient de 1 sur chaque appareil. Comme `lastOpId` sert de jeton, une mise à jour de l'appareil B pouvait être prise pour « déjà appliquée » et **perdue silencieusement**. La file porte désormais une marque aléatoire (`op-q-xxxx-1`) : unique entre appareils et entre réinitialisations. Les files existantes (sans marque) restent valides.
- **Lecture par pages** : tri `(serverUpdatedAt, identifiant)`, position stricte, page de 300 au plus. La **première page de chaque instance** relit 10 s en arrière (recouvrement) : si deux écritures se valident presque ensemble, rien n'est manqué ; les relectures sont sans effet (idempotence de la réception). Créer **une instance de transport par exécution**. Les horodatages serveur ont une précision de la microseconde, le curseur de la milliseconde : au pire un document est relu, jamais sauté.

## 4. Suppressions, restauration, faits financiers
- **Suppression** : logique seulement (`deleted = true`, seuls les champs de suppression changent ; le contenu ne peut pas être réécrit en même temps). Un document supprimé n'est plus modifiable.
- **Restauration** (`restore`) : opération explicite ; vérifie le **propriétaire** (document du compte connecté), le **type** et la **révision** de la suppression ; contenu inchangé, `restoredAt` posé ; jamais pour un fait financier (refusé par le transport, et aucune branche des règles ne le permet). **Reliée au moteur depuis P5** : opération `restore` de la file, déclenchée par la décision « garder la version locale » d'un conflit de suppression (voir `docs/p5-integration-securite.md`).
- **Faits financiers** (`immobilier.paiement`, `tontine.cotisation`, et leurs corrections `*.correction_*`) : **création seulement**. Le transport refuse la modification, la suppression et la restauration ; les règles aussi (aucune branche ne le permet, et un document ne peut pas changer de type pour y échapper). Une correction est un nouveau fait qui référence le fait initial (P3).

## 5. Contraintes réelles de Firestore et limites des règles
Contrôlées avant tout envoi (`checkFirestoreCompat`, erreur `invalid` → opération bloquée, jamais perdue) : tableaux imbriqués, valeurs indéfinies, noms de champ vides ou `__x__`, profondeur > 20, nombre non fini, identifiant de document inutilisable (`/`, `.`, `..`, `__x__`, > 1500 octets), plus de 100 champs, document > 900 000 octets (limite stricte : 1 Mio).

**Ce que les règles NE peuvent PAS garantir** (et qui reste donc contrôlé côté appareil) :
1. Le contenu imbriqué de `body` (types, montants) et la cohérence `refs` / `body`.
2. L'existence des parents : un `get()` par référence dépasserait la limite d'accès par requête (10 par écriture simple) et coûterait cher. La réception vérifie les parents.
3. Qu'un montant de paiement soit « raisonnable » : un compte peut écrire ce qu'il veut dans SES documents.
4. Qu'un document ne soit pas **supprimé physiquement** : (P4.1) la suppression physique n'est PAS une opération ordinaire. Les règles ne l'autorisent que pour le propriétaire de son espace personnel **sous le verrou de suppression** (`deletionLockedAt`, irréversible, posé avant la purge). Le transport ordinaire n'a aucune méthode de suppression ; la seule voie est `syncAccountErasure.ts`. Limite restante : un client compromis du propriétaire pourrait poser lui-même le verrou (action existante, irréversible) puis supprimer ses propres documents ; il ne peut ni les modifier, ni toucher ceux d'un autre compte, et l'espace verrouillé n'accepte plus aucune écriture.
5. Qu'un jeton d'idempotence ne soit pas rejoué : c'est un indice, pas une preuve ; la sécurité repose sur le contrôle de révision.
6. Le coût : chaque écriture de transaction = 1 lecture + 1 écriture + les lectures des règles (document d'espace). Chaque page lue = 1 lecture par document. Le recouvrement relit quelques documents à chaque exécution.
Autres limites : 1 écriture/seconde en continu par document ; transactions limitées à 500 écritures ; sous plan Spark, quotas quotidiens (voir `DEFAULT_OPERATION_BUDGET` du harnais N2).

## 6. Isolation
- Règles : lecture, création, modification, restauration **uniquement** par le propriétaire, dans `personal_<son uid>`, connecté par e-mail / mot de passe ; jamais un espace partagé, jamais l'espace d'un autre compte ; `ownerUid` du document = compte connecté ; espace verrouillé (effacement du compte) : plus aucune écriture. Aucune règle `if true`, ni « tout compte connecté » (un test statique le vérifie ; le refus par défaut est conservé).
- Adaptateurs : le seul espace atteignable est `personal_<uid>` (aucun identifiant d'espace en paramètre) ; le contenu d'un autre propriétaire est refusé avant tout envoi.
- Démonstration / personnel : le cloud ne connaît pas l'espace de démonstration ; le moteur refuse déjà tout envoi ou réception en démonstration (testé, aucun accès au cloud).
- Application : aucun écran, store ni service métier n'importe les adaptateurs (test statique) ; le SDK n'est importé que par `firestoreSyncBackend.ts`.

## 7. Effacement du compte (P4.1) — prêt, NON branché
La suppression de compte actuelle (`firestoreAccountDeletion.ts`, inchangée) ne supprime que `records`, l'espace et le profil ; les documents `syncRecords` resteraient **orphelins** (et inatteignables : une fois l'espace supprimé, les règles interdisent l'accès à ses sous-collections). `eraseAccountCloudData` (`syncAccountErasure.ts`) comble ce manque **sans modifier** la procédure existante, qu'elle appelle à la fin :

1. propriété démontrée par une lecture serveur (espace `personal_<uid>`, propriétaire = compte, seul membre) ; sinon **rien n'est touché** ;
2. verrou posé puis **confirmé** par une relecture serveur (déjà posé : reprise) ;
3. `syncRecords` supprimé par lots de 100, chaque page relue sur le serveur ; garde « aucune progression », durée maximale (5 min), délai par opération (15 s, résultat « incertain » si dépassé) ;
4. **vérification serveur** : plus aucun document ; sinon l'espace et `records` ne sont pas touchés ;
5. alors seulement : `deleteRest` (= `deleteAccountCloudData` : `records`, espace, profil, avec ses propres vérifications).

**Reprise** : chaque étape est idempotente ; relancer après une coupure (réseau, arrêt du processus) continue sans rien refaire d'inutile (testé : interruption au milieu de la purge, puis pendant « le reste »). `verified` n'est vrai que si `syncRecords` est confirmé vide ET si le reste est vérifié. Espace déjà absent : `orphansPossible = true` (signalé, jamais présenté comme un succès de purge).

**Branchée depuis P5** : `firebaseAccountDeletionApi.deleteCloudData` appelle `deleteAccountCloudDataWithSync` (purge de `syncRecords` vérifiée, puis `records`, espace et profil) ; le parcours n'est joignable que derrière `CLOUD_ACCOUNT_ENABLED` (`false`). Voir `docs/p5-integration-securite.md`.

## 8. Décisions qui ne peuvent pas être prises sans risque
1. **Publication des règles** (test, puis un jour production) : autorisation séparée pour chaque projet.
2. ~~Suppression physique par le propriétaire~~ — **décidé (P4.1)** : réservée à la procédure d'effacement, sous verrou (§5 point 4, §7).
3. ~~Restauration dans le moteur~~ — **réalisé (P5)** : opération `restore` explicite, financier exclu.
4. **Coexistence avec la synchronisation V1** (`records`, `cloudSyncService.ts`) : **décidé** — la V1 reste fermée, aucune donnée V1 n'est migrée (migration = P6).
5. **Branchement du moteur** à l'application et activation de `CLOUD_ACCOUNT_ENABLED`.
6. **Quotas** : budget de lectures d'un téléphone (fréquence de lecture, taille de recouvrement).

## 9. Prérequis et commandes (NON exécutées — chacune demande une autorisation explicite)
### 9.1 Tests des règles dans l'émulateur local (aucune ressource réelle)
Constat (P4.1, 2026-10-19) : **Java est absent de cette machine** (introuvable dans le PATH, `JAVA_HOME`, `Program Files`, `.jdks`, Android Studio) ; le JAR de l'émulateur Firestore est déjà en cache (`%USERPROFILE%\.cache\firebase\emulators\cloud-firestore-emulator-v1.22.0.jar`, 137 Mo) — la CLI 15.33.0 pourrait en réclamer une autre version (téléchargement). **Rien n'a été installé ni téléchargé.** Prérequis à autoriser : installer un JDK (à toi de choisir la distribution ; ex. `winget install EclipseAdoptium.Temurin.21.JDK`, version minimale à confirmer par la documentation de la CLI). Variable d'environnement : aucune (l'émulateur la pose). Couverture de ce fichier : transport réel contre les vraies règles, isolation, révisions, rejeu, suppressions, restauration, faits financiers, verrou, suppression physique sous verrou, procédure d'effacement avec reprise.
```powershell
npx firebase-tools@15.33.0 emulators:exec --only firestore --project demo-takarda "npx jest -c jest.emulator.sync.config.js"
```
(Les règles V1 sont déjà couvertes par `jest.emulator.config.js`, inchangé.)

### 9.2 Publier le CANDIDAT sur le projet de TEST uniquement
Prérequis : session CLI ouverte (`npx firebase-tools@15.33.0 login`), accord explicite. **Modifie les règles de `takarda-n2-test`.**
```powershell
npx firebase-tools@15.33.0 deploy --only firestore:rules --project takarda-n2-test --config firebase.n2.sync.json
```
Retour arrière (republier les règles actuelles) :
```powershell
npx firebase-tools@15.33.0 deploy --only firestore:rules --project takarda-n2-test --config firebase.n2.json
```

### 9.3 Tests réels du lot SYNC sur le projet de TEST
Prérequis : 9.2 réalisé ; fichier de configuration web du projet de test hors dépôt ; variables `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_TOKEN`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` **absentes** ; autorisation de créer des comptes jetables (au plus 40, supprimés en fin d'exécution) et d'écrire dans le projet de test.
```powershell
$env:TAKARDA_TEST_PROJECT_ID = "takarda-n2-test"
$env:TAKARDA_CONFIRM_TEST_PROJECT = "takarda-n2-test"
$env:TAKARDA_TEST_FIREBASE_CONFIG_FILE = "C:\Users\ousma\n2-local\web-config.json"
node node_modules/jest/bin/jest.js -c jest.firebase-test-real.config.js --runInBand --testPathPattern "preflight"
node node_modules/jest/bin/jest.js -c jest.firebase-test-real.config.js --runInBand --testPathPattern "sync.n2"
```
Le test `afterAll` exécute la procédure d'effacement (verrou, purge de `syncRecords`, suppression habituelle) pour chaque compte créé par l'exécution avant le nettoyage habituel du harnais ; les observations (`N2-OBS …`) sont à reporter dans `docs/validation-firebase-test-RESULTATS.md`.

### 9.4 Hors périmètre (autres autorisations, ensuite)
Publication sur la production, branchement dans l'application, activation du compte cloud, migration de données.

## 10. Vérifié en local (sans Firebase)
Transports et moteur contre un cloud en mémoire (transactions optimistes, horodatage serveur, pannes avant et après validation, modèle des invariants des règles) : création, modification, conflits, idempotence, suppression logique, restauration, faits financiers, deux appareils, deux comptes, démonstration, réponse perdue, lecture interrompue, recouvrement et égalité d'horodatages, contraintes de Firestore. **Ces tests ne prouvent pas les règles** : seule leur exécution dans l'émulateur (9.1) puis sur le projet de test (9.3) le fait.
