# Dossier de publication — règles Firestore P5 (+ marqueur « compte supprimé »)

> **Statut : DOSSIER. Aucune règle n'est publiée, ni sur le projet de test, ni sur la production.** Ce document présente ce qui serait publié, ce que l'on sait des règles actives, les preuves, les risques, et la procédure (sauvegarde, publication, vérification, retour arrière). **Il ne vaut pas autorisation** : chaque publication demande votre accord distinct, projet par projet.
> Date : 22 octobre 2026. **Validation par l'émulateur : réussie (252/252, 9/9, 5/5, 8/8 ; contrôle négatif détecté).** Preuve sur le service réel avec ce candidat : **non faite** (non publié). Candidat : `firestore.p5.rules`, SHA-256 `a84dcdea4a292aca7146f30afe8ef0c4506ca351343e9de372d4b508d940f8f6`.

## 1. Ce qui serait publié — le candidat exact
Fichier : [firestore.p5.rules](../firestore.p5.rules) (inchangé depuis son empreinte ci-dessus ; `node scripts/firebase-rules/release.js verify firestore.p5.rules` répond IDENTIQUE).

Composition (la comparaison avec P4 est faite par un test automatique : `sharedModules.test.ts`) :
| Bloc | Origine | Effet |
|---|---|---|
| Profil, espaces personnels, `records` (V1 + verrou d'effacement) | règles déjà validées | inchangé |
| `syncRecords` de l'espace personnel (P4) | règles déjà publiées sur le projet de test | inchangé |
| **Modules partagés** (`modules/…` : membres, demandes, données, vue du locataire, verrou) | F3 | **nouveau** |
| **Marqueur « compte supprimé »** (`deletedAccounts/{uid}` + `accountLive()` ajouté aux créations et modifications de données) | ce dossier | **nouveau** |

**Différence avec P4 :** 344 lignes **ajoutées**, **0 ligne retirée ni modifiée** (diff calculé sur les deux fichiers). Autrement dit : toute règle de P4 est conservée telle quelle ; le candidat n'ajoute que des conditions et des blocs.

## 2. Règles actuellement actives — ce que l'on sait
| Projet | Texte exact | Ce que l'on sait par observation |
|---|---|---|
| `takarda-n2-test` | **Non disponible** (pas d'accès à la console depuis le PC). Pour le fournir sans risque : copier l'onglet Règles dans un fichier hors dépôt. | Sonde réelle du 22 octobre 2026 : règles **non ouvertes** ; isolation entre comptes tenue ; règles de base, **synchronisation** et **verrou d'effacement acceptés** (niveau P4) ; **espaces partagés refusés** (P5 absent). |
| `takarda-c8cd8` (production) | **Jamais lues.** | Rien. Je n'y ai jamais accédé. |

La comparaison ligne à ligne avec les règles actives n'est donc pas faisable aujourd'hui. **Comment obtenir le texte en lecture seule :** console Firebase du projet › Firestore Database › onglet « Règles » › tout sélectionner et copier › coller dans un fichier **hors dépôt**, par exemple `C:Usersousma
2-localegles-takarda-n2-test-actives.rules`. Rien n'est modifié par cette copie. Ensuite, deux commandes locales (aucune connexion) donnent l'empreinte et l'écart :
```bash
node scripts/firebase-rules/release.js verify C:/Users/ousma/n2-local/regles-takarda-n2-test-actives.rules
```
```bash
diff C:/Users/ousma/n2-local/regles-takarda-n2-test-actives.rules firestore.p5.rules
```
 Elle le sera dès que vous aurez copié le texte (lecture seule) : `node scripts/firebase-rules/release.js verify <fichier>` donne l'empreinte, et un `diff` montre les écarts.

## 3. La protection ajoutée : pourquoi et comment
**Constat (test A6, projet de test réel, 22 octobre 2026).** À la suppression d'un compte, Authentication ne révoque pas les jetons déjà émis. Un second appareil a pu **recréer profil, espace et enregistrement** à 0 minute après la suppression (écritures acceptées) ; le rafraîchissement du jeton a été refusé, et à 5 minutes la session était perdue. Les données ressuscitées sont inatteignables et orphelines.

**Protection.** Au début de la suppression, l'application pose un document `deletedAccounts/<uid>` (heure du serveur, aucun autre champ) **avant** de rien supprimer. Les règles refusent alors toute **création** et toute **modification de données** pour ce compte (`accountLive()`), mais laissent passer le verrou d'effacement et les suppressions, pour que la procédure aille à son terme. Le marqueur n'est jamais modifiable ni supprimable par un client : un ancien jeton ne peut pas le retirer.

**Conséquences assumées.**
1. Poser le marqueur est **irréversible**, comme le verrou d'effacement. Une suppression interrompue **se reprend** (le marqueur existant est constaté) ; elle ne s'annule pas.
2. **Fail-safe :** si le marqueur ne peut pas être posé (par exemple règles non publiées), la suppression **ne commence pas** (rien n'est supprimé, le compte est conservé, message clair).
3. Le marqueur ne contient que l'identifiant technique du compte et une date ; il est conservé. **À inscrire dans la politique de confidentialité** (« un identifiant technique d'un compte supprimé, sans donnée lisible, est conservé pour empêcher la réapparition de données »). Une expiration automatique (politique TTL de Firestore) est une amélioration à vérifier.
4. **Ordre de déploiement obligatoire :** règles **avant** application. Une application avec le marqueur contre des règles sans lui ne peut plus supprimer de compte ; une ancienne application contre de nouvelles règles continue de fonctionner (elle ne pose pas de marqueur, donc garde l'ancienne fenêtre).

## 4. Tests réalisés et résultats réels
| Niveau | Quoi | Résultat |
|---|---|---|
| Local, politique de référence | matrice de cas des modules, étendue de 8 cas « compte supprimé » (5 refus, 2 autorisations de la procédure de suppression, 1 témoin) | à jour : voir la suite ordinaire du rapport |
| Local, suppression | `accountCloudErasure.test.ts` : marqueur posé avant tout, échec = rien supprimé, reprise, délai, propriété contredite, espace absent | réussi |
| Local, garde statique des règles | `accountTombstoneRules.test.ts` : toute création exige un compte vivant, aucune lecture ni suppression n'en dépend, forme du marqueur | réussi |
| Émulateur local (22 octobre 2026, candidat `a84dcdea…`) | matrice contre les vraies règles ; scénarios à deux comptes ; règles d'urgence ; scénarios « compte supprimé » dont le contrôle négatif intégré | **réussi : 252/252 + 9/9 + 5/5 + 8/8** (voir § 4 bis) ; contrôle négatif des règles : détecté comme attendu |
| Projet de test réel (niveau P4, avant ce candidat) | 6 suites réussies (authentification, contrôle préalable, `rules`, `deletion`, `concurrency`, `sync`, `token` corrigé, `deletionFlow` en parcours P4) | réussi ; constats A6 et ordre de déploiement ci-dessus |
| **Projet de test réel avec CE candidat** | — | **non fait** : nécessite la publication de test (votre accord) |

## 4 bis. Résultats de l'émulateur — 22 octobre 2026, candidat `a84dcdea4a292aca7146f30afe8ef0c4506ca351343e9de372d4b508d940f8f6`
Environnement : émulateur Firestore local (v1.22.0), projets fictifs `demo-*`, Authentication **simulée**, Java plafonné à 256 Mo. **Trois premiers lancements** du même jour avaient échoué faute de mémoire de la machine (aucun résultat exploitable, signalés) ; le quatrième, après libération de l'espace, a abouti.

| Suite | Résultat exact | Ce qu'elle prouve |
|---|---|---|
| `modulesRules` | **252 réussis / 252** | La matrice complète contre les vraies règles : accès des membres actifs, expiration, révocation, demande en attente ou refusée, étanchéité entre modules, aucun champ privé dans la vue du locataire, faits financiers en création seule, verrou d'effacement ; plus **8 cas « compte supprimé »** (5 refus, 2 autorisations de la suppression, 1 témoin) |
| `modulesFlows` | **9 réussis / 9** | Deux comptes par l'adaptateur réel : demande, approbation, révocation, départ, vue du locataire, **suppression de compte complète avec le marqueur** |
| `emergencyRules` | **5 réussis / 5** | Les deux variantes d'urgence (régénérées pour ce candidat) |
| `accountTombstone` | **8 réussis / 8** | Compte vivant (lots de 20 et de 45 enregistrements) ; **ancien jeton après suppression complète** : profil, espace, enregistrement, synchronisation, espace partagé refusés ; **contrôle négatif** (sans marqueur, la recréation réussit : le test détecte le défaut) ; marqueur ni modifiable, ni supprimable, ni recréable ; reprise (« exists ») ; isolation d'un autre compte ; forme du marqueur ; interruption puis reprise |

**Vos cinq points, un par un**
| Exigence | Preuve |
|---|---|
| Un compte actif fait les opérations autorisées | témoin « compte vivant » + les cas `allow` de la matrice + lots de 20/45/60 |
| Un compte marqué supprimé ne crée ni ne modifie ses données | 5 refus de la matrice + A6 complet de `accountTombstone` |
| Un ancien jeton ne contourne pas la protection | A6 : le second « appareil » garde son jeton valide, ses 5 types d'écriture sont refusés ; le contrôle négatif montre que sans marqueur elles réussissent |
| La suppression et sa reprise restent possibles | 2 autorisations de la matrice (verrou, effacement d'une demande sous marqueur) ; `modulesFlows` ; reprise « exists » ; interruption puis reprise vérifiée |
| Les espaces partagés gardent leur isolation | les 244 cas d'origine, inchangés et réussis |

**Contrôle négatif des règles.** Les mêmes suites jouées contre une copie **volontairement privée de la protection** (hors dépôt, `accountLive()` renvoie toujours vrai) : **6 cas de la matrice et 2 scénarios « compte supprimé » échouent**, comme attendu ; les 2 autorisations de la procédure de suppression restent réussies. La protection est donc bien ce qui fait passer ces tests.

**Ce qui n'est PAS prouvé par l'émulateur** : le comportement du vrai service avec CE candidat (limite d'accès aux documents par requête sur un lot réel, coût en lectures, horloge), Authentication réelle, et un téléphone. Voir § 6 et le tableau des tests ci-dessus : ce candidat n'a pas été publié sur le projet de test.

Commande pour rejouer (Windows : `cmd` ne comprend pas `;`, utiliser `&`), avec le Java portable `C:\Users\ousma\tools\jdk\bin` dans le `PATH` et au moins 1 Go de disque libre :
```bash
firebase emulators:exec --config firebase.modules.json --only firestore --project demo-takarda "node node_modules/jest/bin/jest.js -c jest.emulator.modules.config.js --runInBand --testPathPattern modulesRules.emulator & node node_modules/jest/bin/jest.js -c jest.emulator.modules.config.js --runInBand --testPathPattern modulesFlows.emulator & node node_modules/jest/bin/jest.js -c jest.emulator.modules.config.js --runInBand --testPathPattern emergencyRules.emulator & node node_modules/jest/bin/jest.js -c jest.emulator.modules.config.js --runInBand --testPathPattern accountTombstone.emulator"
```

## 5. Risques et parades
| Risque | Gravité | Parade |
|---|---|---|
| Verrouillage involontaire d'un compte (une règle trop stricte refuse un usage normal) | Élevée | Matrice (244+ cas) et 7 scénarios « compte supprimé » incluant les usages normaux et lots de 20/60 ; témoin « compte vivant » ; retour arrière en une publication (§ 7) |
| Accès involontaire (une règle trop large) | Critique | Garde statique : aucune règle ouverte ; isolation éprouvée sur l'émulateur **et** sur le vrai service au niveau P4 ; 6 contrôles négatifs de l'ancienne série détectés |
| Limite d'accès aux documents par requête dépassée avec la nouvelle vérification | Moyenne | Un seul document distinct de plus par requête (le marqueur) ; testé sur des lots de 20 (création) et de 60 enregistrements (suppression) dans l'émulateur ; à reconfirmer sur le vrai service |
| Une suppression interrompue laisse le compte inutilisable en création | Moyenne | Voulu (irréversible) ; la reprise est proposée par l'application ; texte d'écran à relire |
| Application publiée avant les règles | Élevée | Procédure : règles d'abord, vérification d'empreinte, puis application ; échec sûr de la suppression |
| Coût en lectures du marqueur | Faible | 1 lecture facturée par requête d'écriture de données ; à mesurer sur le projet de test (quota gratuit) |

## 6. Sauvegarde, publication, vérification (procédure proposée, rien n'est exécuté)
**Avant de publier (sur un projet donné)**
1. **Archiver les règles actives** : copier l'onglet Règles dans `…\n2-local\regles-<projet>-<date>.rules` (hors dépôt). Relever son empreinte : `node scripts/firebase-rules/release.js verify <fichier>` (elle sera « DIFFÉRENT » : normal, c'est l'ancien état) et la noter.
2. Vérifier le candidat : `node scripts/firebase-rules/release.js verify firestore.p5.rules` → **IDENTIQUE**.
3. Vérifier la cible : `node scripts/firebase-test/verify-target.js` (projet de test) ou la procédure équivalente pour la production (jamais confondre).
4. Fichiers d'urgence prêts et vérifiés (§ 8).

**Publication** — deux voies, au choix du propriétaire :
- **Console** (recommandée pour une première fois) : coller le contenu exact du candidat dans l'onglet Règles du bon projet, publier.
- **Ligne de commande**, avec votre `firebase login` : `firebase deploy --only firestore:rules --project <projet> --config firebase.release.json`. `firebase.release.json` ne nomme aucun projet : `--project` est obligatoire et explicite.

**Vérification après publication**
1. Relire l'onglet Règles, enregistrer dans un fichier hors dépôt, lancer `release.js verify <fichier>` → **IDENTIQUE** (prouve que ce qui est en ligne est ce qui a été validé).
2. Projet de test : rejouer la sonde, `rules`, `deletionFlow` avec `TAKARDA_N2_MODULES_RULES=1` (parcours complet : marqueur + espaces partagés), `token` (le marqueur doit **bloquer** l'écriture à 0 minute), `sync`.
3. Surveiller le quota (onglet Usage) avant et après.

## 6 bis. Ordre de déploiement et compatibilité règles ↔ application
| Règles publiées | Application | Comportement |
|---|---|---|
| **P5 + marqueur** | version **actuelle** (pose le marqueur) | complet : espaces partagés, suppression protégée |
| **P5 + marqueur** | ancienne version (sans marqueur, sans espaces partagés) | fonctionne ; la suppression ne pose pas de marqueur (ancienne fenêtre de recréation) |
| P4 (actuel du projet de test) | version actuelle | usage normal ; **la suppression de compte répond « incomplète »** (marqueur refusé, rien n'est supprimé) ; espaces partagés refusés |
| P4 | ancienne version | comme aujourd'hui |

**Ordre** : (1) archive des règles actives ; (2) publication des règles ; (3) vérification d'empreinte ; (4) rejeu des suites réelles et de la sonde ; (5) **seulement ensuite** une version d'application qui pose le marqueur (build de test, accord distinct) ; (6) pour la production : dossier et accord distincts, mêmes étapes. **Jamais l'application avant les règles.**

## 7. Retour arrière
- **Immédiat :** republier le fichier archivé à l'étape 1 (même procédure). Vérifier par empreinte que l'archive est bien celle en ligne.
- **Comptes déjà marqués supprimés, après un retour arrière vers des règles sans marqueur** : les documents `deletedAccounts/<uid>` **restent** (aucune règle ne les supprime) mais plus rien ne les consulte. Conséquences : (a) **aucune donnée n'est perdue ni modifiée** ; (b) la fenêtre de recréation par ancien jeton **se rouvre** pour ces comptes, bornée par la durée de vie du jeton (au plus une heure après la suppression, constaté : session perdue à 5 minutes) ; (c) en republiant le candidat, les marqueurs s'appliquent de nouveau immédiatement, sans rien à rejouer. Un compte marqué mais dont la suppression était interrompue reste inutilisable en création tant que les règles avec marqueur sont en place ; après un retour arrière il redevient utilisable, ce qui annule en pratique l'irréversibilité : **ne revenir en arrière qu'en dernier recours**.
- Application : si une version incluant le marqueur est déjà diffusée et que les règles reviennent en arrière, la suppression de compte répond « incomplète » (fail-safe) tant que les règles ne sont pas rétablies : **ne jamais faire reculer les règles sans coordonner l'application**.

## 8. Règles d'urgence et leurs conséquences
Générées du candidat (`node scripts/firebase-rules/emergency.js`), jamais éditées à la main ; leurs empreintes sont dans `firestore.rules.manifest.json`.
| Variante | Fichier | Effet | Conséquence pour l'utilisateur |
|---|---|---|---|
| 1 — écritures refusées | `firestore.emergency-writes-off.rules` (SHA `33de306c…`) | toute écriture refusée, lectures identiques | l'application lit encore ses données cloud ; la synchronisation et la suppression de compte sont en attente ; le local continue de fonctionner |
| 2 — tout refusé | `firestore.emergency-all-off.rules` (SHA `1315db60…`) | aucun accès | plus aucune lecture ni écriture cloud ; le local continue de fonctionner |
Retour à la normale : republier le candidat. **Les règles d'urgence sont aussi des publications : accord distinct.** Elles bloquent la suppression de compte pendant l'urgence (conséquence voulue).

## 9. Décisions et informations qu'il me faut
1. **Votre accord** pour publier le candidat sur **`takarda-n2-test`** uniquement (puis, séparément, un dossier de production).
2. **Le texte actuel de l'onglet Règles** du projet de test (et, plus tard, de la production), copié dans un fichier hors dépôt.
3. **Le choix de publication** : console ou ligne de commande avec votre connexion.
4. **La mention du marqueur** dans la politique de confidentialité et la page de suppression (je la prépare à votre accord).
