# Sauvegarde automatique d'Android — analyse des risques (préparation F7)

> **Statut : analyse à partir du code et de la documentation publique. Rien n'a été exécuté, aucun appareil ni build n'a été utilisé, aucune configuration n'a été modifiée.**
> Votre décision provisoire est de **conserver** la sauvegarde. Ce document vérifie ce que ce choix risque de restaurer, explique les conséquences, et **ne confirme pas le choix à votre place** : la confirmation attend votre réponse (§ 6).
> Ce qui a été vérifié dans le code est marqué **[CODE]** ; ce qui vient de la documentation publique **[DOC]** ; ce qui ne pourra être prouvé que sur un téléphone **[À PROUVER SUR APPAREIL]**.

## 1. Les faits
| Fait | Source |
|---|---|
| L'application autorise la sauvegarde automatique (`allowBackup` actif : aucune clé `android.allowBackup` ni règle de sauvegarde dans `app.json`) | **[CODE]** `app.json` ; configuration Expo résolue relevée en phase 8 |
| Toutes les données de l'application sont dans **une seule base locale** (AsyncStorage 2.2.0) : tontines, formulaires, immobilier, profil, état de synchronisation, carnet des espaces, copie de la vue du locataire | **[CODE]** `services/storage.ts`, `services/persistence.ts` |
| **La session Firebase (jeton de connexion) est conservée dans cette même base** | **[CODE]** `services/firebase/firebaseClient.ts` : `initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })` |
| La sauvegarde automatique couvre par défaut la plupart des répertoires de l'application ; elle est chiffrée de bout en bout à partir d'Android 9 ; plafond de 25 Mo ; elle se restaure sur un téléphone lié au **même compte Google** | **[DOC]** developer.android.com/identity/data/autobackup |
| Que le fichier de la base AsyncStorage soit effectivement inclus dans la sauvegarde de cette application | **[DOC]** (répertoire des bases inclus par défaut, selon la documentation et des sources tierces) · **[À PROUVER SUR APPAREIL]** |
| Clés dont le nom contient un identifiant de compte : `sync_*@<uid>`, `shared_modules@<uid>`, `tenant_view_published@<uid>`, `tenant_view_received@<uid>`, `firebase:authUser:…` | **[CODE]** |

## 2. Ce qui peut être restauré, et le risque associé
| # | Scénario | Ce qui reparaît | Gravité | Ce qui limite déjà le risque (code) | Reste |
|---|---|---|---|---|---|
| R1 | Nouveau téléphone, même compte Google : restauration de la sauvegarde | **La session Firebase** : l'utilisateur est connecté sans saisir son mot de passe | Moyenne | Sauvegarde chiffrée de bout en bout (code de verrouillage du téléphone d'origine requis, Android 9+) ; le compte Google est le même ; la suppression du compte invalide la session | Une session valide se retrouve sur un second appareil à l'insu de l'utilisateur ; un téléphone d'occasion non effacé conserve cette session |
| R2 | Locataire dont l'accès a été **retiré, quitté ou a expiré**, restauré sur un autre téléphone | **La copie de sa vue** (contrat, paiements, coordonnées du propriétaire…) | Moyenne | La copie est masquée au-delà de sa date de fin d'accès connue ; elle est supprimée à la première actualisation en ligne, au départ et à la suppression du compte | Un accès **retiré par le propriétaire** (sans date de fin) laisse la copie affichable hors ligne jusqu'à la prochaine actualisation. Cette limite existe déjà sans sauvegarde (téléphone hors ligne) ; la restauration la rend plus visible |
| R3 | Compte **supprimé** après la sauvegarde, restauration ensuite | Les données locales (voulu : elles sont conservées), la session (devenue invalide), des marques « compte supprimé » sur des éléments | Faible | La session invalide ne rouvre rien ; les éléments marqués d'un compte absent sont masqués et peuvent être rendus locaux (« Les rendre locaux ») | Texte à clarifier dans l'application ; aucune donnée du cloud ne revient |
| R4 | Un **autre compte TakarDa** utilisé sur le téléphone restauré | Rien de lisible pour lui : les magasins sont propres à chaque compte et les éléments d'un autre compte sont masqués | Faible | `accountScopedKey`, `cloudVisibility` (tests d'isolation) | Les données de l'ancien compte restent **physiquement présentes** sur l'appareil (jamais visibles par l'autre compte dans l'application) |
| R5 | Le même compte sur **deux appareils** dont l'un vient d'une sauvegarde plus ancienne | File d'envoi et références de synchronisation d'une date antérieure | Moyenne | Envois idempotents (`opId`), fusion en trois voies, conflits explicites, faits financiers jamais écrasés | **À prouver sur deux téléphones** (scénario T-R5, plan F7) : doublons, conflits |
| R6 | Données **sensibles de tiers** (locataires) dans la sauvegarde Google | Noms, téléphones, e-mails, notes, loyers saisis par le propriétaire | Moyenne | Chiffrement de bout en bout de la sauvegarde ; c'est la copie locale que l'utilisateur possède déjà | La politique (§ 6) le dit ; le propriétaire doit en tenir compte pour les données de ses locataires |

**Conclusion de la vérification.** La sauvegarde **ne fait pas** passer des données d'un compte TakarDa à un autre, et **ne ressuscite pas** de données du cloud après une suppression de compte. Elle peut en revanche **restaurer une session de connexion valide** (R1) et **la copie locale de la vue d'un locataire** (R2) sur un autre téléphone du même compte Google. Ce sont des risques d'**exposition sur un appareil restauré**, pas de fuite entre comptes.

## 3. Les options et leurs conséquences
| Option | Effet | Avantages | Inconvénients / coût |
|---|---|---|---|
| **A. Conserver tel quel** (provisoire) | Comportement actuel | Les utilisateurs **sans compte** retrouvent leurs données sur un nouveau téléphone (c'est pour eux la seule restauration automatique) ; rien à changer | R1 et R2 subsistent ; la politique doit les décrire |
| **B. Conserver + atténuations sans build natif** | A, plus : copie de la vue du locataire **non affichée** si elle n'a pas été actualisée en ligne depuis N jours ; purge de la copie à la déconnexion | Réduit R2 sans toucher à la configuration native | Réduit l'usage hors ligne d'un locataire (à N jours près) ; ne traite pas R1 |
| **C. Désactiver** (`android.allowBackup: false`) | Plus aucune sauvegarde ni restauration automatique de l'application | Supprime R1, R2, R5, R6 d'un coup ; simple (une clé de configuration) | Les utilisateurs sans compte **perdent** la restauration automatique (ils peuvent encore exporter à la main : Profil › Stockage) ; **demande un nouveau build** ; texte de la politique à changer |
| **D. Séparer ce qui est sensible** (session Firebase, copie de la vue, état de synchronisation) dans une **seconde base exclue de la sauvegarde**, et garder la sauvegarde pour le reste | Les données de l'utilisateur sont restaurées, pas la session ni les copies de tiers | Le meilleur des deux mondes | **Le plus coûteux** : règles d'exclusion natives (configuration à ajouter), nouveau build, migration de la persistance Firebase, et **prise en charge de plusieurs bases par la version installée à vérifier** ; risque de régression sur la connexion |
| **E. Garder la sauvegarde mais forcer une reconnexion après restauration** | Détection d'une restauration (identifiant propre à l'appareil comparé à celui mémorisé) puis déconnexion locale | Traite R1 | Demande un module natif **non installé** (nouveau build) ; faux positifs possibles |

## 4. Recommandation
1. **Pour le test fermé : option A + B**, c'est-à-dire **conserver** (votre décision provisoire) **et ajouter, avant l'ouverture, l'atténuation de la copie de la vue** (code seul, aucun build natif supplémentaire au-delà du build de test déjà prévu). Les testeurs sont connus et peu nombreux ; le risque R1 est accepté et **testé**.
2. **Avant la mise en production générale : trancher entre C et D** à la lumière du test (T-R1 à T-R6 sur appareil). Si la restauration d'une session ou de copies de tiers est jugée inacceptable et que D est trop coûteux, **C** est la voie la plus sûre et la moins chère, au prix de la restauration automatique des utilisateurs sans compte.
3. Quel que soit le choix : **la politique de confidentialité (§ 6) décrit ce qui peut être restauré**, y compris la session et la copie du locataire.

## 5. Tests à faire sur appareil (non faits, demandent un build et un téléphone)
| # | Test | Preuve attendue |
|---|---|---|
| T-R0 | La base AsyncStorage est-elle dans la sauvegarde ? (sauvegarde locale forcée puis inspection de son contenu) | oui / non |
| T-R1 | Sauvegarde, effacement des données, restauration : l'utilisateur est-il toujours connecté ? | oui / non, et après suppression du compte depuis un autre appareil : session refusée |
| T-R2 | Locataire révoqué : sauvegarde, restauration sur un autre téléphone : la copie s'affiche-t-elle hors ligne ? Après actualisation ? | copie visible hors ligne / retirée en ligne |
| T-R3 | Compte supprimé depuis le téléphone A, restauration d'une ancienne sauvegarde sur B : que voit l'utilisateur ? | aucune donnée cloud, session refusée, données locales marquées |
| T-R4 | Deux comptes TakarDa sur le téléphone restauré | aucune visibilité croisée |
| T-R5 | Même compte, appareil restauré plus ancien que l'autre : synchronisation | aucun doublon, aucune perte, conflits explicites |
| T-R6 | Contenu de la sauvegarde (noms, téléphones de locataires) | documenter, informer |

## 6. Ce qu'il me faut de vous
**Confirmez-vous l'option « conserver provisoirement » (A + B pour le test fermé), en acceptant R1 et R2 tels que décrits ?** Sinon, indiquez C (désactiver) ou D (séparer). Le texte de la politique sera ajusté en conséquence (§ 6 : ce qui peut être restauré).
