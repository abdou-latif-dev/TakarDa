# TakarDa — Lot E2 : plan de validation sur un projet Firebase de TEST (PLAN, rien n'est exécuté)

> **Statut : plan préparé le 14 octobre 2026, non exécuté.** Aucune ressource externe n'a été créée ni modifiée, aucune règle publiée,
> aucun build lancé. Tout ce qui suit est une proposition soumise à l'autorisation du propriétaire du projet.
> **Le projet de production `takarda-c8cd8` ne doit JAMAIS être utilisé pour ces essais.**

## 1. Constat sur la configuration existante (lu dans le dépôt)
| Élément | Constat |
|---|---|
| Projet configuré dans l'application | `takarda-c8cd8` (production). Les six valeurs publiques ne sont plus écrites dans le dépôt : `constants/firebaseWebConfig.ts` les lit dans les variables `EXPO_PUBLIC_FIREBASE_*` (fichier `.env` local, ignoré par Git ; modèle versionné : `.env.example`). Sans variables la configuration est vide et refusée avant toute initialisation (le cloud est de toute façon fermé) |
| Sélection du client | `services/firebase/firebaseClient.ts` : `initializeApp(assertFirebaseWebConfig(firebaseWebConfig))`, aucun interrupteur « test » |
| Projet par défaut du CLI | **Aucun** : pas de `.firebaserc`, `firebase.json` ne désigne aucun projet → toute commande doit recevoir `--project` explicitement (bon garde-fou) |
| Émulateurs | Firestore seulement (`firebase.json`, port 8080) ; projet fictif `demo-takarda` ; Java installé dans `C:\Users\ousma\tools\jdk` |
| Tests de configuration | `services/__tests__/firebaseConfig.test.ts` exige les six valeurs de production et leur cohérence |
| Code testable contre un autre projet | `deleteAccountCloudData(db, uid, options)` prend l'instance Firestore en paramètre ; `deleteAccount(api, …)` prend l'API en paramètre : aucun changement nécessaire pour un harnais |
| Règles à valider | `firestore.rules` (SHA-256 `544b4599f9fe298f…`), non publiées en production |
| Authentification réelle | Jamais exercée contre un vrai service avec la suppression (reauth, `deleteUser`) |

## 2. Prérequis (ce qu'il faut AVANT de commencer — rien n'existe encore)
**À faire par le propriétaire (console Firebase / PC), car cela crée des ressources externes :**
1. **Créer un NOUVEAU projet Firebase réservé aux tests**, plan **Spark (gratuit, sans carte)**. Nom suggéré : `takarda-test-<suffixe>`. **Identifiant à me communiquer.** Ce n'est pas un secret.
2. Enregistrer une application **Web** dans ce projet ; fournir les six valeurs publiques (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`) **uniquement si** vous acceptez de me les transmettre ; elles identifient un projet de test, pas la production.
3. **Authentication** : activer **E-mail / Mot de passe** ; garder les mêmes réglages que la production (notamment « protection contre l'énumération des e-mails »). *Optionnel* : activer temporairement « Anonyme » pour le test de refus, puis le désactiver.
4. **Firestore** : créer la base **en mode production** (verrouillée), **même région que la production** (`africa-south1`) pour la parité.
5. **Règles du projet de test** : doivent être **identiques au fichier local `firestore.rules`** (vérifier le SHA-256). La publication sur le projet de test est une opération externe : **autorisation explicite requise** (voir § 8).
6. Si la publication se fait en ligne de commande : `firebase login` sur votre machine avec votre compte Google (je ne vois ni ne demande aucun mot de passe ni jeton).
7. *Optionnel* : une vraie boîte e-mail pour tester l'e-mail de réinitialisation du mot de passe.
8. *Pour le téléphone* : le téléphone branché en USB et, pour le lot F, ma modification du code de configuration (§ 9).
**Quotas (plan Spark, à confirmer dans la console) :** quotas quotidiens gratuits de Firestore (de l'ordre de 50 000 lectures, 20 000 écritures, 20 000 suppressions par jour). Les appels `get()`/`exists()` des règles comptent comme des lectures. Les essais prévus restent très en dessous (≈ quelques milliers d'opérations) ; **arrêt si l'usage dépasse 50 % d'un quota**.

**Parité à vérifier entre test et production** (sinon les résultats ne valent rien) : mêmes fournisseurs, même réglage d'énumération, même région, mêmes règles (SHA-256), même version de Firebase (`firebase` 12.19.0 dans `package.json`).

## 3. Les quatre niveaux de validation
| Niveau | Cible | Rôle | État |
|---|---|---|---|
| **N0** | Émulateur Firestore local | Règles et logique | **Fait** (85 tests d'émulateur) |
| **N1** | Émulateurs **Authentication + Firestore** locaux | Répétition générale du harnais, sans aucune ressource externe | À faire (sans autorisation externe) |
| **N2** | **Projet Firebase de test réel**, client Node | Comportement réel d'Authentication, limites réelles des règles, réseau réel | Nécessite le projet de test |
| **N3** | **Téléphone** pointé sur le projet de test | Messages, délais et coupures réelles (mode avion) | Nécessite le projet de test et le changement de configuration |

## 4. Garde-fous techniques du harnais (à intégrer dans le code, bloquants)
1. **Liste d'autorisation :** le harnais ne démarre que si `projectId` figure dans `TAKARDA_TEST_PROJECT_ID` **et** `TAKARDA_CONFIRM_TEST_PROJECT` contient la même valeur saisie à la main.
2. **Refus automatique** si `projectId === 'takarda-c8cd8'`, si la clé d'API de test est celle de la production, ou si la configuration de production est chargée. La clé de production est lue comme TEXTE (jamais importée) dans la variable `EXPO_PUBLIC_FIREBASE_API_KEY` ou dans le fichier `.env` local ; si elle est introuvable ou illisible, le harnais **s'arrête** (le contrôle ne peut pas être fait : jamais de passage silencieux).
3. **Comptes jetables :** e-mails `takarda-e2e-<id d'exécution>-<n>@example.test`, mots de passe aléatoires gardés en mémoire seulement, jamais écrits ni affichés.
4. **Périmètre :** le harnais ne touche qu'aux documents des comptes qu'il a créés lui-même (`users/<uid>`, `spaces/personal_<uid>` et leurs sous-documents). Aucun autre chemin n'est parcouru.
5. **Nettoyage borné :** en fin d'exécution, suppression des seuls comptes créés (leurs données puis leur compte), même si un scénario échoue.
6. **Aucun compte de service, aucune clé privée.** Les données de départ sont créées par le client avec les vraies règles.
7. **Taille limitée :** au plus quelques centaines de documents par scénario, au plus ~1 500 par exécution complète.

## 5. Scénarios, résultats attendus et critères d'échec
Légende : **N1** = répétable localement, **N2** = projet de test réel, **N3** = téléphone. « Attendu » = hypothèse à confirmer, **jamais un résultat acquis**.

### A. Authentication réelle
| # | Scénario | Attendu | Échec / arrêt si… | Niveau |
|---|---|---|---|---|
| A1 | Créer un compte de test, se connecter, réauthentifier avec le bon mot de passe | La réauthentification aboutit | Erreur inattendue | N1 N2 |
| A2 | Réauthentifier avec un mauvais mot de passe | Code d'erreur d'identifiants (`auth/invalid-credential` ou `auth/wrong-password`, **selon le réglage d'énumération : noter le code réel**) ; message français correct ; rien n'est supprimé | Code non géré par `mapAuthError` → message générique | N1 N2 |
| A3 | Réauthentifier avec les identifiants d'un autre compte | `auth/user-mismatch` | Succès (grave) | N2 |
| A4 | Connexion ancienne : attendre (jusqu'à ~10 min) puis `deleteUser` sans réauthentifier | Mesurer si `auth/requires-recent-login` apparaît et après combien de temps ; après réauthentification, la suppression réussit | Suppression refusée même après réauthentification | N2 |
| A5 | `deleteUser` avec un délai client volontairement très court (1 ms) | L'orchestration signale « compte non confirmé » ; **vérifier ensuite si le compte a malgré tout été supprimé** (connexion impossible) | État affiché incohérent avec la réalité | N2 |
| A6 | Après suppression, **un second appareil** (deuxième instance Firebase) tente de rafraîchir son jeton, de lire et d'**écrire** (recréer `spaces/personal_<uid>`) avec son ancien jeton | Mesurer : rafraîchissement refusé ? écriture acceptée jusqu'à l'expiration du jeton (risque de « données zombies ») | Écriture acceptée = risque confirmé → décision § 9 | N2 |
| A7 | Fournisseur réel : un compte e-mail/mot de passe lit et écrit sous les règles | `sign_in_provider == 'password'` accepté (**preuve réelle que la revendication simulée en émulateur est correcte**) | Refus d'un compte légitime = **règles inutilisables** | N2 |
| A8 | *(optionnel)* Connexion anonyme (fournisseur activé temporairement) | Tout refusé par les règles | Accès accordé | N2 |
| A9 | *(optionnel)* E-mail de réinitialisation du mot de passe vers votre boîte réelle | E-mail reçu, lien fonctionnel | — | N2 |

### B. Règles de suppression et limites d'appels (`get()` / `exists()`)
| # | Scénario | Attendu | Échec / arrêt si… |
|---|---|---|---|
| B1 | Créer espace, profil et N enregistrements avec les vraies règles | Créations acceptées | Refus |
| B2 | **Courbe de taille de lot** : N = 1, 5, 10, 20, 21, 25, 50, 100, 150, 200 suppressions dans **un lot** (N croissant, arrêt au premier échec) | Noter la **plus grande taille acceptée** ; l'émulateur acceptait 100 | **Échec à 100 → modification obligatoire** (§ 9) |
| B3 | Suppression complète via `deleteAccountCloudData` : 100 documents (une page), puis 250 (trois pages) | `verified: true`, plus aucun document, espace et profil absents (lectures serveur) | Rapport non vérifié, `permission-denied` |
| B4 | Mesurer les latences réelles : lecture serveur, lot de 100, suppression de document (p50 / p95) | Données pour fixer `OPERATION_TIMEOUT_MS` (15 s aujourd'hui) | p95 proche de 15 s → délai à relever |
| B5 | Supprimer l'espace **avant** les enregistrements (volontairement) | Enregistrements orphelins inaccessibles (déjà vu sur émulateur) | — (confirme la nécessité de l'ordre) |
| B6 | Relever l'usage Firestore avant/après (console) | Consommation conforme à l'estimation | > 50 % d'un quota quotidien → arrêt |

### C. Suppressions partielles, réponses perdues, reprises (opérations injectées sur le vrai projet)
| # | Scénario | Attendu |
|---|---|---|
| C1 | Lot **appliqué** mais réponse en erreur | État incomplet ; reprise termine ; rien d'autre supprimé |
| C2 | Lot appliqué mais **réponse jamais reçue** (délai) | État **incertain** ; l'espace n'est pas touché ; reprise termine |
| C3 | Réseau du SDK coupé en cours de route (`disableNetwork`), puis 2ᵉ tentative, puis réseau rétabli, puis 3ᵉ tentative | 1ʳᵉ incertaine ; 2ᵉ sans nouvelle écriture ; la 3ᵉ termine (**comportement réel de `waitForPendingWrites`**) |
| C4 | **Processus tué** (kill -9) pendant la suppression de ~500 documents, puis relance | La reprise termine ; aucun état incohérent durable |
| C5 | Réseau dégradé (latence élevée, perte de paquets) : mesurer faux « incertain » | Calibrer les délais |

### D. Écritures concurrentes
| # | Scénario | Attendu / à mesurer |
|---|---|---|
| D1 | Appareil 2 crée des enregistrements pendant que l'appareil 1 supprime | Mesurer les enregistrements créés **entre la vérification et la suppression de l'espace** (orphelins) |
| D2 | **Résurrection :** après D1, recréer l'espace (`ensureSpace`) et relister | Les orphelins réapparaissent-ils ? (risque de données « ressuscitées ») |
| D3 | Deux suppressions simultanées du même compte | Idempotent, sans erreur autre que bénigne |
| D4 | Synchronisation (`writeRecord`) pendant la suppression | Cohérence finale ; erreurs affichées clairement |

### E. Isolation entre comptes
| # | Scénario | Attendu |
|---|---|---|
| E1 | Comptes A et B avec données ; suppression complète de A | **Aucun** document de B supprimé ou modifié ; B se connecte et lit toujours ses données |
| E2 | A tente de supprimer, lire, modifier des documents de B (chemins directs) ; client non connecté idem | Tout refusé |
| E3 | Recensement final | Seuls les comptes créés par l'exécution ont changé |

### F. Téléphone (N3, manuel, projet de test uniquement)
Reprendre `docs/checklist-tests-smartphone.md` § 5, avec mode avion activé : pendant la réauthentification, entre deux pages, pendant la suppression de l'espace, pendant la suppression du compte. Relever : messages affichés, durée avant la libération de l'écran, réussite de « Réessayer », état des données locales, capture d'écran de chaque cas.

## 6. Commandes proposées (NON exécutées)
**N1 — répétition locale, sans aucune ressource externe** (PowerShell, Java dans le `PATH`) :
```
$env:Path = "C:\Users\ousma\tools\jdk\bin;" + $env:Path
npx firebase-tools@15.33.0 emulators:exec --only auth,firestore --project demo-takarda --non-interactive "node node_modules/jest/bin/jest.js -c jest.firebase-test.config.js --runInBand"
```
**N2 — projet de test réel** (après autorisation et prérequis § 2) :
```
$env:TAKARDA_TEST_PROJECT_ID = "<identifiant-du-projet-de-test>"
$env:TAKARDA_CONFIRM_TEST_PROJECT = "<identifiant-du-projet-de-test>"
$env:TAKARDA_TEST_FIREBASE_CONFIG_FILE = "C:\chemin\vers\config-web-test.json"   # six valeurs publiques du projet de TEST
node node_modules/jest/bin/jest.js -c jest.firebase-test.config.js --runInBand
```
**Publication des règles sur le projet de TEST uniquement** (autorisation explicite requise ; jamais sur la production) :
```
npx firebase-tools@15.33.0 login
npx firebase-tools@15.33.0 deploy --only firestore:rules --project <identifiant-du-projet-de-test>
```
Vérifier ensuite que le SHA-256 des règles publiées correspond au fichier local.

## 7. Critères d'arrêt généraux
Arrêt **immédiat** (sans poursuivre ni relancer) si : le `projectId` du harnais n'est pas celui du projet de test ou vaut `takarda-c8cd8` ; un document d'un compte non créé par l'exécution est touché ; une erreur inexpliquée apparaît trois fois de suite ; l'usage Firestore dépasse 50 % d'un quota quotidien ; une règle ou une configuration de production est mentionnée par une commande ; un résultat contredit une hypothèse de sécurité (par exemple B2 échoue à 100, A3 réussit, E1 supprime des données de B, A7 refuse un compte légitime) — dans ce cas, **je m'arrête et je vous présente le problème**.

## 8. Autorisations qui seront demandées avant toute opération externe
1. Le projet de test existe et son identifiant m'est donné (création par vous).
2. Publication des règles sur le projet de test (par moi en ligne de commande, ou par vous dans la console).
3. Création de comptes de test et de documents de test dans ce projet.
4. Modification du code décrite ci-dessous (harnais, configuration de test).
5. Activation temporaire du fournisseur Anonyme dans le projet de test (optionnel).
6. Tests téléphone avec le projet de test.

## 9. Fichiers qui pourraient devoir être créés ou modifiés (rien n'est fait)
| Fichier | Nature | Pourquoi |
|---|---|---|
| `jest.firebase-test.config.js` | nouveau | Configuration Node dédiée (comme `jest.emulator.config.js`) |
| `services/__tests__/firebaseTestProject/*.test.ts` (+ aide commune) | nouveaux | Scénarios A à E ; garde-fous du § 4 ; ignorés par `npm test` sans variables d'environnement |
| `scripts/firebase-test/…` | nouveaux | Lancement et nettoyage bornés |
| `docs/validation-firebase-test-RESULTATS.md` | nouveau | Résultats réels, avec date, version des règles, valeurs mesurées |
| `.gitignore` | modification mineure | Ignorer un éventuel fichier local de configuration de test |
| `constants/firebaseWebConfig.ts`, `services/firebase/firebaseClient.ts`, `services/__tests__/firebaseConfig.test.ts` | modification **possible** (lot F seulement) | Interrupteur explicite vers la configuration de TEST (variable d'environnement de développement, **refusé dans un build de production**) pour le téléphone |
| `services/firebase/firestoreAccountDeletion.ts` | modification **conditionnelle** | Option `pageSize` et repli sur des lots plus petits si B2 échoue à 100 |
| `firestore.rules` | modification **conditionnelle** | (a) réduire les appels `get()`/`exists()` de `isPersonalSpaceOwner` (variable locale `let`) si B2 le justifie ; (b) **verrou de suppression** (champ posé sur l'espace qui interdit les nouvelles créations pendant l'effacement) si D1/D2 montrent des orphelins ou une « résurrection » ; (c) à décider selon A6 si un appareil non déconnecté peut recréer des données après suppression |
| `services/accountDeletionService.ts` | modification **conditionnelle** | Réglage des délais (A5, B4, C5) |
Aucun de ces changements n'est appliqué à ce stade. `app.json`, `eas.json`, `versionCode`, signature et dépendances **ne changent pas**.

## 10. Risques de la validation elle-même
1. **Cibler la production par erreur** → § 4 (liste d'autorisation, refus de `takarda-c8cd8`, double confirmation, aucun projet par défaut).
2. **Parité insuffisante** (réglages d'énumération, région, règles) → liste § 2 ; consigner le SHA-256 des règles publiées dans les résultats.
3. **Quotas Spark** → tailles bornées, arrêt à 50 %.
4. **Comptes et données de test restants** → nettoyage borné ; purge manuelle possible en console (projet de test uniquement).
5. **Résultats non représentatifs** d'un réseau réel africain → C5 et N3 (téléphone, données mobiles).
6. **Le projet de test ne prouve pas la production** : seule la publication contrôlée des règles de production, suivie d'un essai avec un compte dédié, la prouvera.

## 11. Ce qui reste invérifiable même après ces essais
Le comportement exact de la production à long terme (quotas, incidents), les sauvegardes Google (délais de purge), le comportement des vrais jetons de production tant que le test n'est pas refait là-bas avec un compte dédié, et les cas d'extinction brutale de l'appareil.

## 12. Estimation prudente
Préparation côté propriétaire (§ 2) : 30 à 45 min. Harnais et répétition N1 : une demi-journée. Exécution N2 : 1 à 2 h (dont 5 à 10 min d'attente pour A4). Lot F (téléphone) : 1 h. Les corrections éventuelles du § 9 et leurs tests : à estimer après les résultats.

---

> **Mise à jour (16 octobre 2026) :** ce plan est partiellement dépassé. N1, N1.1 et N1.2 sont faits ; les règles locales ont changé (verrou de suppression, SHA-256 `39367a2e361287d4…`) ; le projet de test est `takarda-n2-test` ; les gardes et tests N2 sont préparés mais non exécutés. Voir « N2 — Préparation locale » dans `docs/validation-firebase-test-RESULTATS.md`. Les noms de variables d'environnement ci-dessus restent valables ; le seul projet autorisé est `takarda-n2-test`.
