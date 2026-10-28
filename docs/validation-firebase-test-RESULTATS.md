# TakarDa — Lot N1 : résultats de la validation sur ÉMULATEURS LOCAUX (Authentication + Firestore)

> **Périmètre : N1 uniquement.** Tout ce qui est rapporté ici a été exécuté contre les émulateurs locaux (`demo-takarda`, hôtes `127.0.0.1`).
> **Aucun projet Firebase réel, aucune ressource externe, aucun appel à la production.** Un émulateur reproduit la logique des règles et
> les API, **pas** les limites, latences, jetons et comportements exacts du service réel. N2 (projet de test réel) n'a PAS été exécuté.
> Date : 14 octobre 2026. Règles testées : `firestore.rules` du dépôt (SHA-256 `544b4599f9fe298f…`), **non publiées**.

## 1. Ce qui a été créé
| Fichier | Rôle |
|---|---|
| `firebase.n1.json` | Configuration d'émulateurs séparée (Authentication 9099 + Firestore 8080, interface désactivée). `firebase.json` d'origine **inchangé** : il ne démarrait pas l'émulateur Authentication |
| `jest.firebase-test.config.js` | Jest en environnement Node, garde réseau installé avant tout module, ne vise que `*.n1.test.ts` |
| `services/__tests__/firebaseTestProject/guards.ts` | Garde-fous d'environnement (purs) |
| `…/networkGuard.ts`, `networkGuard.setup.ts` | Garde réseau : bloque toute connexion non locale (sockets, TLS, HTTP/2/gRPC, DNS, `fetch`), « porte fermée » par défaut |
| `…/harness.ts` | Clients Authentication + Firestore branchés sur les émulateurs ; comptes jetables ; semis via le client avec les vraies règles ; accès « administrateur » aux émulateurs pour compter/semer des cas particuliers |
| `…/guards.n1.test.ts`, `auth.n1.test.ts`, `deletion.n1.test.ts` | 28 tests N1 (ignorés sans émulateurs) |
| `services/__tests__/firebaseTestGuards.test.ts` | 10 tests purs de garde-fous, dans la suite habituelle |

## 2. Garde-fous (et un défaut trouvé et corrigé pendant le travail)
- **Environnement :** le harnais refuse de démarrer sans les DEUX émulateurs, avec un hôte non local, avec un projet qui n'est pas `demo-…` ou qui vaut `takarda-c8cd8`, ou si une variable donnant accès à un service réel est définie (`GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_TOKEN`, variables N2).
- **Réseau :** toute connexion non locale est bloquée AVANT l'envoi. Les tests le prouvent pour `net`, `tls`, `http`, `dns` et `fetch`, avec des cibles inatteignables par construction (plage RFC 5737, domaine `.invalid`).
- **Aucune tentative bloquée** pendant les essais d'authentification et de suppression (vérifié par un test à la fin de chaque fichier).
- **Défaut du garde réseau, trouvé par son propre test et corrigé :** la première version laissait passer `net.connect({ host: <adresse IP littérale>, … })`, car Node appelle `socket.connect([options, rappel])` avec un TABLEAU que le garde ne lisait pas. Corrigé : le tableau est lu, et toute forme d'arguments inconnue est désormais **bloquée** (porte fermée). **Incident à connaître :** pendant l'exécution qui a révélé ce défaut, le test d'origine visait `1.1.1.1:443` (résolveur public de Cloudflare) ; le garde étant défaillant ce jour-là, **une tentative de connexion TCP a pu partir de ce PC vers cette adresse**, sans aucune donnée envoyée et sans lien avec Firebase, Google ou TakarDa. Les tests ont ensuite été réécrits pour ne viser que des cibles inatteignables par construction.

## 3. Résultats
Commande : voir § 6. Résultat global : **3 suites, 28 tests réussis, 0 échec** (émulateurs Authentication + Firestore).

### Scénarios RÉUSSIS (N1, émulateur)
| Scénario | Observation (émulateur) |
|---|---|
| **A1** réauthentification correcte | aboutit |
| **A2** mauvais mot de passe | code `auth/wrong-password` ; message français « incorrect » ; **aucune suppression** (données et compte intacts) |
| **A3** identifiants d'un autre compte | code `auth/user-mismatch` ; les deux comptes intacts |
| **A5** suppression du compte | reconnexion ensuite refusée (`auth/user-not-found`) ; session locale vidée |
| **A5b** délai client dépassé (1 ms) pendant `deleteUser` | statut `account_uncertain`, message « non confirmée », jamais « Compte supprimé » ; **le compte a pourtant été supprimé** par l'opération abandonnée (exactement le cas que « incertain » doit couvrir) |
| **A6** second appareil après suppression | rafraîchissement du jeton refusé (`auth/invalid-refresh-token`) ; **écriture Firestore avec l'ancien jeton ACCEPTÉE** dans l'émulateur (voir § 5) |
| **A7** jeton réel de l'émulateur | revendication `sign_in_provider: "password"` ; créations et lectures sous les règles de bout en bout |
| **A8** connexion anonyme | revendication `anonymous` ; création d'espace, de profil et lecture **refusées** par les règles |
| **B3** suppression complète (100 puis 250 enregistrements) | `completed`, `verified`, `remaining: 0`, espace, profil et compte supprimés, compte voisin intact ; ≈ 2,8 s dans l'émulateur |
| **B2** courbe de taille de lot (1 → 500) | **tout passe jusqu'à 500** (voir § 4) |
| **C1** lot appliqué, réponse en erreur | `cloud_incomplete` ; compte conservé ; reprise `completed` ; voisin intact |
| **C2** lot appliqué, réponse jamais reçue | `cloud_uncertain` (borné), espace non touché sans confirmation ; reprise `completed` |
| **C3** réseau Firestore coupé en route | 1ʳᵉ `cloud_uncertain` ; 2ᵉ tentative **sans aucune nouvelle écriture** ; réseau rétabli, l'écriture en file part ; 3ᵉ `completed` (50 enregistrements restants) |
| Données cloud supprimées, suppression du compte en échec | `cloud_deleted_account_active`, données locales libérées ; la reprise termine |
| **D1/D2** écriture concurrente avant la suppression de l'espace | **RISQUE CONFIRMÉ** : le client croit avoir terminé (`verified: true`), un enregistrement orphelin subsiste ; recréer l'espace le **ressuscite** (1 orphelin relu) |
| **D3** deux suppressions simultanées | état final propre ; une suppression `verified`, l'autre en `permission-denied` (voir § 5) ; la reprise est idempotente |
| **E1/E2** isolation | A ne peut ni lire, ni supprimer, ni modifier les données de B (enregistrements, espace, profil) ; un client non connecté non plus ; la fonction appelée avec l'identifiant de B échoue en `permission-denied` ; la suppression complète de A ne touche **rien** de B (80 enregistrements, espace, profil, compte, connexion et lecture toujours possibles) |
| Espace partagé | `ownership_unproven` : rien supprimé, compte conservé |

### Scénarios ÉCHOUÉS
Aucun dans la dernière exécution. **Avant corrections** : (a) 1 échec du garde réseau (défaut décrit au § 2, corrigé) ; (b) 9 échecs de la suite de suppression, tous dus à un défaut du **harnais** (import dynamique non pris en charge par Jest), corrigé ; aucun n'a révélé un défaut du code de l'application.

### Scénarios NON EXÉCUTÉS
| Scénario | Raison |
|---|---|
| **C4** processus tué en pleine suppression (~500 documents) | Demande un script autonome lancé en processus séparé ; non réalisé en N1. Proposé pour N2 |
| **A9** e-mail de réinitialisation du mot de passe | L'émulateur n'envoie aucun e-mail |
| **F** téléphone, mode avion | Hors du périmètre N1 |

### Scénarios NON REPRÉSENTABLES dans l'émulateur
| Scénario | Pourquoi |
|---|---|
| **A4** `auth/requires-recent-login` après une connexion ancienne | L'émulateur ne reproduit pas la fenêtre de « connexion récente » ; seule la gestion du code côté application est testée (tests unitaires existants) |
| Limites réelles d'appels `get()`/`exists()` par lot (B2) | Aucune limite n'est apparue jusqu'à 500 : l'émulateur ne reproduit probablement pas celle de la production |
| Latences et pertes de paquets réelles, délais calibrés (B4, C5) | Réseau local instantané |
| Jetons réels (durée de validité, révocation, vérification d'existence du compte) | Jetons non signés de l'émulateur |
| Quotas, facturation, comportement de la production, sauvegardes Google | Services réels |
| Persistance des écritures en file à travers un redémarrage de l'application | Mémoire, un seul processus |

## 4. Ce que ces résultats permettent de conclure — et ne permettent pas
- **Permis :** la logique d'orchestration, la reprise, l'idempotence, l'isolation entre comptes et la cohérence règles ↔ client fonctionnent avec de vrais jetons d'émulateur ; le harnais ne peut pas atteindre un service réel.
- **Non permis :** affirmer que la production se comporte pareil. En particulier **B2** : « aucune limite à 500 » signifie seulement que l'émulateur n'en applique pas ; la limite réelle de la production reste **inconnue** et doit être mesurée en N2 avant toute publication.

## 5. Constats à traiter (aucun changement de code ou de règles n'a été fait)
1. **D1/D2 — orphelins et résurrection (risque confirmé).** Une écriture venue d'un autre appareil entre la vérification et la suppression de l'espace laisse un enregistrement orphelin ; recréer l'espace le fait réapparaître. Pistes à étudier : verrou posé sur l'espace avant l'effacement (modification des règles : à décider), ou nettoyage à la recréation de l'espace.
2. **A6 — « données zombies ».** Dans l'émulateur, un second appareil peut écrire avec un ancien jeton après la suppression du compte. Le comportement du service réel (durée de validité du jeton, ≤ 1 h) est à mesurer en N2.
3. **D3 — message trompeur possible.** Lors de suppressions simultanées, la seconde reçoit `permission-denied` en supprimant un espace déjà supprimé : l'écran afficherait « Suppression cloud incomplète » alors que tout est supprimé ; « Réessayer » aboutit. Piste : traiter « espace déjà absent » comme confirmé (relire le serveur avant de conclure).
4. **B2 — limite de lot de production inconnue** → N2 obligatoire ; éventuelle option `pageSize` et repli sur lots plus petits.
5. **A2 — codes d'erreur** : l'émulateur renvoie `auth/wrong-password`. D'après la documentation, un projet réel avec la protection contre l'énumération des e-mails renverrait plutôt `auth/invalid-credential` (**à confirmer en N2**) ; les deux codes sont gérés par `mapAuthError` (vérifié par test).

## 6. Commandes exécutées
```
$env:Path = "C:\Users\ousma\tools\jdk\bin;" + $env:Path
npx firebase-tools@15.33.0 emulators:exec --config <dépôt>\firebase.n1.json --only auth,firestore --project demo-takarda --non-interactive "node <dépôt>\node_modules\jest\bin\jest.js -c <dépôt>\jest.firebase-test.config.js --rootDir <dépôt> --runInBand --forceExit --verbose"
```
Lancé depuis un dossier hors du dépôt (les journaux d'émulateur n'ont donc rien créé dans le projet).

## 7. Prochaine étape (N2) — non commencée, en attente d'autorisation
Voir `docs/validation-firebase-test-PLAN.md` : projet de test réel, publication des règles sur ce seul projet, scénarios A4, B2/B4 (limites et latences réelles), C4, A6 (réel), D1/D2 (fréquence réelle), puis décisions sur les modifications du code et des règles.

---

# Lot N1.1 — Verrou de suppression et résultat « espace déjà absent » (constats 1 et 3 de N1)

> Même périmètre que N1 : **émulateurs locaux uniquement** (`demo-takarda`). Aucun Firebase réel, **règles NON publiées**, aucun build. Les constats 2, 4 et 5 (A6, limite de lot, codes d'erreur) ne sont pas traités ici.
> Règles testées : `firestore.rules` du dépôt, SHA-256 `39367a2e361287d4…` (avant N1.1 : `544b4599f9fe298f…`).
> Les sections 1 à 7 ci-dessus décrivent N1 tel qu'il était **avant** N1.1 : le constat 1 (D1/D2) et le constat 3 (D3) y sont désormais traités par ce lot.

## 1. Ce qui a changé
| Fichier | Changement |
|---|---|
| `firestore.rules` | Nouveau champ d'espace `deletionLockedAt` (chaîne de 1 à 40 caractères). Le **propriétaire de son espace personnel** (seul membre) peut le poser **une fois**, comme seul champ modifié. Il est **irréversible** (aucune règle ne permet de le changer, de le retirer, ni de réécrire l'espace sans lui). Tant qu'il est posé : **création et modification d'enregistrements refusées** pour tout appareil ; lecture et **suppression** restent permises. Le renommage reste possible. La création d'un espace n'accepte pas le champ |
| `services/firebase/firestoreAccountDeletion.ts` | Nouvelle opération `lockSpace`. Ordre : propriété prouvée (serveur) → **verrou posé puis confirmé par lecture serveur** → enregistrements par pages → confirmation serveur « aucun enregistrement » → suppression de l'espace + confirmation → profil. Sans verrou confirmé, **rien n'est supprimé** (échec fermé). Verrou déjà présent (reprise) : non reposé |
| idem (constat 3) | « Espace déjà absent » : si une opération échoue (p. ex. `permission-denied` parce qu'un autre appareil vient de supprimer l'espace), l'absence n'est retenue qu'après **une lecture serveur concluante** ; sinon l'erreur d'origine est conservée (échec ou incertain). Un refus lors de la pose du verrou est tranché par la relecture du serveur (verrou posé par l'autre appareil : on continue). Aucun repli sur « absent » une fois la suppression de l'espace acquittée (« inconnu » reste « inconnu ») |
| `services/__tests__/firestoreRules.test.ts` | Assertions statiques du verrou |
| `services/__tests__/accountDeletion.emulator.test.ts` | 1 test adapté : l'espace est désormais lu 3 fois (propriété, verrou, vérification) au lieu de 2 |
| `services/__tests__/firebaseTestProject/deletion.n1.test.ts` | Le bloc D (caractérisation du risque) est remplacé par 11 tests du verrou (N1 : 28 → **37** tests) |

## 2. Résultats (émulateurs)
| Contrôle | Résultat |
|---|---|
| N1 (Authentication + Firestore) | **37 / 37** (3 suites) ; D3 simultané exécuté 3 fois de suite, toujours `verified` des deux côtés ; aucune tentative réseau bloquée |
| Émulateur Firestore d'origine | **85 / 85** |
| Jest complet | 34 suites passées, 4 ignorées ; **543 passés**, 121 ignorés, 0 échec |
| TypeScript | 0 erreur |
| Lint | 0 erreur, 112 avertissements (inchangé) |

### Scénarios (émulateur)
| Scénario | Observation |
|---|---|
| **D1 avant** : écriture d'un 2ᵉ appareil avant la suppression | acceptée, puis supprimée avec le reste (4 supprimés) |
| **D1 pendant** : création ET modification d'un 2ᵉ appareil pendant les lots, et juste avant la suppression de l'espace | **toutes refusées** (`permission-denied`) ; 0 orphelin (avant N1.1 : 1) ; `verified: true` |
| **D1 après** : écriture après la suppression | refusée ; 0 enregistrement |
| **D2** recréation de l'espace pendant le verrou (propriétaire et 2ᵉ appareil) | refusée ; après suppression, le nouvel espace est **vide** (avant : 1 orphelin « ressuscité ») |
| Verrou : irréversibilité, propriétaire seul, renommage | un autre compte ne peut pas verrouiller l'espace de A ; verrou mélangé à `name`, chaîne vide, plus de 40 caractères, retrait, changement, réécriture de l'espace : refusés ; témoin : modification permise avant le verrou ; lecture et suppression permises une fois verrouillé ; **le compte B reste intact et modifiable** |
| Reprise après interruption **après** le verrou | espace non supprimé, verrou conservé, écriture d'un 2ᵉ appareil refusée pendant l'interruption ; la reprise n'a **pas** reposé le verrou et a terminé (130 enregistrements) |
| Échec fermé | verrou refusé (cas des règles anciennes) : erreur `permission-denied`, rien supprimé ; verrou « réussi » sans effet : `lock-unconfirmed`, rien supprimé |
| **D3** deux suppressions réellement simultanées (120 enregistrements) | **les deux** `verified: true` (l'une `proven`/`deleted`, l'autre `space_absent`/`absent`) ; avant : l'une des deux en `permission-denied` |
| **D3** espace supprimé par l'autre appareil juste avant notre suppression | le SDK renvoie bien `permission-denied`, mais le résultat n'est `verified` (`space: absent`) **que parce qu'une lecture serveur a confirmé l'absence** |
| **D3** serveur injoignable pour la confirmation | `verified: false`, erreur `permission-denied` conservée, espace ni « absent » ni « supprimé » ; la reprise confirme et termine |
| `permission-denied` alors que l'espace existe encore | `verified: false`, espace toujours présent |
| Isolation | aucune donnée d'un autre compte supprimée (E1/E2 inchangés ; le compte B reste intact après chaque scénario) |

## 3. Limites et risques résiduels (à lire avant de conclure)
1. **Preuve par l'émulateur seulement.** L'émulateur applique les règles et montre que les écritures concurrentes sont refusées dans nos scénarios. Il ne prouve **pas** que le service réel sérialise de la même façon une écriture arrivant dans la même fraction de seconde que la pose du verrou : à mesurer en N2. D'ici là, **le problème n'est pas déclaré résolu en production**.
2. **Dépendance de déploiement.** L'application N1.1 **exige** les nouvelles règles : avec les règles actuellement publiées, la pose du verrou est refusée et la suppression de compte échoue en « incomplète » **sans rien supprimer** (échec fermé voulu). Les règles ne doivent être publiées qu'avec l'accord explicite du propriétaire du projet, avant la sortie de l'application.
3. **Verrou irréversible, sans parcours « annuler ».** Si l'utilisateur confirme la suppression puis abandonne, l'espace reste verrouillé : lecture et suppression possibles, mais plus aucune nouvelle donnée ne se synchronise (écritures refusées). « Réessayer la suppression » est le seul chemin. Un parcours d'annulation ou un message dédié à la synchronisation serait un changement distinct (hors de ces deux constats).
4. **Écritures hors ligne en file** d'un autre appareil : refusées au retour du réseau (jamais appliquées) ; l'application peut les afficher comme erreur de synchronisation.
5. **Orphelins antérieurs.** Les orphelins créés avant N1.1 ne sont pas nettoyés (un espace absent ne permet pas de lister ses enregistrements). Aucune donnée de ce type n'est attendue avant la première publication.
6. **« Espace absent ».** Aucune lecture des enregistrements d'un espace absent n'est possible : l'absence confirmée repose sur le protocole (verrou, vérification serveur, puis suppression de l'espace) suivi par l'autre appareil.
7. Inchangés : A6 (écriture avec un ancien jeton), limite de lot de production inconnue, scénario C4 (processus tué) non exécuté, A4/A9 non représentables, N2 non commencé.
8. Pas de contrôle négatif rejoué contre les anciennes règles : avant correction, le risque a été observé en N1 (orphelin, résurrection) ; avec les anciennes règles, le nouveau client échoue à poser le verrou, par construction.

## 4. Commandes
Les mêmes qu'en N1 (§ 6) ; les 85 tests d'origine : `--config <dépôt>\firebase.json --only firestore` avec `-c jest.emulator.config.js`.

---

# Lot N1.2 — Message dédié et reprise de suppression (local, sans règles ni schéma serveur)

> Périmètre : parcours utilisateur seulement. **Aucune règle publiée ni modifiée** (`firestore.rules` identique), aucun changement de schéma serveur, aucun mécanisme de déverrouillage de `deletionLockedAt`, aucun build ni déploiement, aucun commit. Les tests « émulateur » ne disent rien des vrais jetons Firebase ni des règles actuellement publiées.

## 1. Comment le verrouillage est distingué (sans rien déduire d'une erreur)
Mécanisme déjà présent réutilisé : le champ `deletionLockedAt` de l'espace, **lisible par son propriétaire**. L'état n'est établi que par **une lecture SERVEUR concluante** (`readDeletionLockState`, lecture seule) : `locked`, `unlocked`, `absent`, ou `unknown` dès que la lecture n'est pas concluante (réseau coupé, délai, refus, espace d'un autre compte). Un `permission-denied` d'écriture ne dit jamais « verrouillé » : il déclenche seulement cette lecture. Réseau, refus ordinaire et verrou ont chacun leur message.

## 2. Ce qui a changé
| Fichier | Changement |
|---|---|
| `services/accountDeletionRecovery.ts` (nouveau) | Journal local persistant `cloud_deletion_<uid>` (clé `@formease/…`), messages de reprise et de refus de synchronisation. Effacé **uniquement** pour le statut `completed` (ou si rien n'a été supprimé et aucun verrou vu) |
| `services/accountDeletionService.ts` | `deleteAccount(…, journal?)` : le journal est écrit **avant la première opération cloud** (après réauthentification réussie) et mis à jour avec le résultat ; son échec ne change rien à la suppression. Rapport : champ `locked` (verrou confirmé par le serveur). Messages « incomplète/incertaine » : mention du verrou et de la réauthentification **seulement** si le verrou est confirmé et l'espace pas encore supprimé |
| `services/firebase/firestoreAccountDeletion.ts` | `readDeletionLockState` ; `report.locked` |
| `services/firebase/accountDeletionApi.ts` | `readDeletionLock(uid)` |
| `services/cloudSyncService.ts` | `PushResult.permissionDenied` (champ optionnel) |
| `store/cloudStore.ts` | `deletionMarker` (chargé à chaque retour de session : survit au redémarrage) ; après un refus d'écriture : lecture serveur du verrou puis message adapté ; journal passé à la suppression ; le message de synchronisation compte désormais les enregistrements en erreur (avant : « Tout est à jour » malgré des refus) |
| `features/profile/screens/CloudAccountScreen.tsx` | Carte « Suppression du compte inachevée » + bouton « Reprendre la suppression » (ouvre la confirmation avec mot de passe), affichée depuis le journal quand aucun résultat n'est en mémoire |
| tests | `services/__tests__/deletionRecovery.test.ts` (nouveau, 23 tests) ; 3 tests ajoutés dans `firebaseTestProject/deletion.n1.test.ts` |

## 3. Tests et résultats réels
| Contrôle | Résultat |
|---|---|
| `deletionRecovery.test.ts` | 23 / 23 |
| N1 (émulateurs Auth + Firestore) | **40 / 40** (37 + 3), aucune tentative réseau bloquée |
| Émulateur Firestore d'origine | **85 / 85** |
| Jest complet | 35 suites passées, 4 ignorées ; **566 passés**, 124 ignorés, 0 échec |
| TypeScript | 0 erreur |
| Lint | 0 erreur, 112 avertissements (inchangé) ; `expo lint` : 2 avertissements (inchangé) |

Couverture demandée : espace déjà verrouillé + reprise (unitaire et émulateur) ; réauthentification échouée / vide / sans réponse (rien supprimé, aucun journal, cloud jamais appelé, ancienne reprise conservée) ; erreur réseau distincte (message « hors ligne », verrou non interrogé) ; refus ordinaire distinct (serveur : non verrouillé ; refus d'un autre compte sur un espace non verrouillé) ; lecture du verrou impossible → message prudent « n'a pas pu être vérifié » avec le chemin « Supprimer mon compte » ; redémarrage simulé (état mémoire effacé, journal retrouvé, propre à chaque compte) ; aucune fausse confirmation (aucun message de succès tant que `completed` n'est pas atteint ; test sur les textes) ; données locales préservées (aucune libération locale sans vérification serveur, enregistrement local toujours présent après un refus).

## 4. Limites restantes
1. Le journal dit seulement « commencée, non confirmée terminée » : ce n'est pas une preuve de l'état serveur ; les messages disent « peut être verrouillé » tant que le serveur ne l'a pas confirmé.
2. **Hors ligne** : sans réseau, l'état exact du verrou est inconnu ; seul le message prudent est affiché et la reprise exige une connexion et le mot de passe.
3. La reprise exige d'être **connecté** : après une déconnexion volontaire, il faut se reconnecter ; le journal est retrouvé pour ce compte seulement. Un journal orphelin (compte supprimé côté serveur, statut `account_uncertain`) reste inoffensif.
4. Aucun déverrouillage : un utilisateur qui abandonne reste verrouillé (écritures refusées) ; seule la reprise de la suppression le libère. Message explicite, mais pas de sortie « annuler » (décision produit à prendre).
5. **Vrais jetons et règles publiées** : non testés ici. Avec les règles actuellement publiées (sans verrou), la pose du verrou est refusée et la suppression échoue en « incomplète » sans rien supprimer : ce cas affiche le message d'échec général, pas celui du verrou (le verrou n'a pas pu être posé).
6. Les entrées de synchronisation en erreur après un refus restent en erreur tant qu'elles ne sont pas modifiées ; l'écran de reprise est le chemin prévu.
7. Inchangés : A6 (ancien jeton), limite de lot de production, scénario C4, N2.
8. Environnement : le disque C: est presque plein (≈ 238 Mo libres à la fin du lot).

---

# N2 — Préparation locale (aucun test réel exécuté, aucune connexion Firebase)

> Projet de test : `takarda-n2-test` (numéro `438284688014`, formule Spark), créé par le propriétaire ; **aucune application Web, aucune base Firestore, aucun fournisseur Authentication** n'ont été créés ou activés par ce travail. **Aucune règle publiée**, aucun build, aucun commit. Le projet de production `takarda-c8cd8` n'est jamais référencé que dans les listes de projets REFUSÉS.
> Règles locales (inchangées) : SHA-256 `39367a2e361287d4…`.

## 1. Ce qui a été préparé
| Fichier | Rôle |
|---|---|
| `firebase.n2.json` | Uniquement la référence aux règles (aucun émulateur) |
| `jest.firebase-test-real.config.js` | Jest N2 : ne cible que `real/**/*.n2.test.ts`, garde réseau installé avant tout module |
| `real/guardsReal.ts` | Garde-fous purs : liste d'autorisation (`takarda-n2-test` seul), numéro de projet, double confirmation, variables interdites (compte de service, jeton CLI, émulateurs), cohérence des six valeurs de la configuration web, clé de production refusée, contrôle de l'audience et de l'émetteur des jetons |
| `real/networkGuardReal.ts` (+ `.setup.ts`) | Garde réseau : boucle locale et trois services (Authentication, jeton, Firestore) seulement ; clé du projet de test exigée ; chemins `/projects/<autre>` refusés ; adresses IP admises seulement si résolues pour un hôte autorisé ; porte fermée ; réversible |
| `real/harnessReal.ts`, `productionKeys.ts` | Clients du projet de test, comptes jetables (plafond 40, jeton vérifié dès la création), budget d'opérations, détection d'orphelins par recréation de l'espace (aucun accès administrateur), nettoyage borné |
| `real/*.n2.test.ts` (7 fichiers) | N2-0 contrôle préalable ; N2-1/N2-2 règles et lots ; N2-3 écritures concurrentes ; N2-4 ancien jeton ; N2-5 processus tué ; N2-6/N2-7 suppressions simultanées, espace absent, reprise ; N2-8 Authentication (A2, A3, A5b, A4 optionnel). Ignorés sans variables |
| `scripts/firebase-test/verify-target.js` | Vérification HORS LIGNE de la cible (aucune connexion) |
| `scripts/firebase-test/kill-test-worker.js` | Pilote du processus tué (tue le worker, relance la vérification) ; refuse un autre projet ou un état dans le dépôt |
| `services/__tests__/firebaseTestRealGuards.test.ts` | 20 tests hors ligne dans la suite habituelle |
| `.gitignore` | `/.n2-local/` et `*.n2.local.json` |

## 2. Vérifications réellement exécutées (hors ligne)
| Contrôle | Résultat |
|---|---|
| `npx jest services/__tests__/firebaseTestRealGuards.test.ts` | 20 / 20 |
| `node scripts/firebase-test/verify-target.js` sans variables | échec attendu (3 contrôles), code 1 |
| idem avec une configuration FACTICE hors dépôt | tous les contrôles conformes ; la même configuration avec l'identifiant de production : refusée |
| Jest avec `jest.firebase-test-real.config.js`, sans variables | 7 suites ignorées, 29 tests ignorés |
| Jest complet | 36 suites passées, 11 ignorées ; **586 passés**, 153 ignorés, 0 échec |
| TypeScript | 0 erreur |
| Lint | 0 erreur, 112 avertissements (inchangé) |

**Non exécuté :** tous les tests N2 réels, le script du processus tué, N1/émulateurs (code N1 inchangé). **Les tests N2 n'ont donc jamais tourné** : seuls leur typage et leurs garde-fous sont vérifiés. Le comportement du garde réseau avec le vrai DNS et le vrai gRPC (adresses IP résolues) ne sera connu qu'au premier contrôle préalable (N2-0), qui échouera bruyamment si une adresse n'est pas reconnue.

## 3. Prérequis encore manquants (propriétaire)
Application Web du projet de test et ses six valeurs publiques ; Authentication e-mail/mot de passe (et réglage d'énumération identique à la production : à confirmer) ; base Firestore en mode production, région de la production ; autorisation de publier les règles sur `takarda-n2-test` uniquement ; autorisation de chaque phase de N2.
