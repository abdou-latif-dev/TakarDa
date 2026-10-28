# Preuve sur l'émulateur Firestore LOCAL — règles et flux des espaces partagés (F3a, F3b, F3c)

> **Périmètre : émulateur Firestore local uniquement** (projets fictifs `demo-takarda` et `demo-takarda-flows`, hôte local). **Aucun projet Firebase réel n'a été contacté**, ni le projet de test `takarda-n2-test`, ni la production ; aucune règle n'a été publiée ; `CLOUD_ACCOUNT_ENABLED` reste `false`. Aucun téléchargement : le JDK (`C:\Users\ousma\tools\jdk`, Temurin 21) et l'émulateur (`cloud-firestore-emulator-v1.22.0.jar`) étaient déjà présents ; la CLI `firebase-tools@15.33.0` a été lancée hors ligne depuis le cache npm.

## Commande
```
npx firebase-tools@15.33.0 emulators:exec --config firebase.modules.json --only firestore --project demo-takarda "npx jest -c jest.emulator.modules.config.js"
```
(avec Java dans le `PATH` ; `firebase.modules.json` charge `firestore.p5.rules`, le candidat.)

## Résultats (candidat `firestore.p5.rules`, après les décisions sur les points 4.3)
| Suite | Contenu | Résultat |
|---|---|---|
| `modulesRules.emulator.test.ts` | la **matrice de 194 cas** de F3a/F3c (propriétaire, locataire actif / expiré / révoqué / parti, demandeur en attente / refusé, tiers, autre propriétaire, compte non connecté, autre fournisseur de connexion) jouée contre les **vraies règles** | **194 réussis, 0 échec** |
| `modulesFlows.emulator.test.ts` | flux de F3b et F3c à **deux comptes**, à travers l'**adaptateur Firestore réel** (`firestoreModulesBackend`) : créer, demander, approuver (lot atomique), publier la vue, la lire, révoquer, rétablir, quitter, refus qui bloque, annulation, étanchéité entre locataires, approbation tout-ou-rien, fin d'accès dépassée, publication par différences | **6 réussis, 0 échec** |

Le fichier de règles **se compile** dans l'émulateur et se comporte comme la politique de référence sur ces 194 cas.

## Contrôles négatifs (les refus sont de vrais refus, pas des accidents)
Trois copies volontairement cassées du fichier de règles (variable `MODULES_RULES_FILE`, copies hors dépôt) ont été jouées ; chaque casse est détectée **exactement** par les cas attendus :
| Casse | Cas qui échouent |
|---|---|
| suppression de fiche de membre ouverte | les 2 cas « ne supprime pas un membre » |
| contrôle de fin d'accès retiré | les 5 cas d'accès expiré (dont « à l'instant exact de fin ») |
| liste blanche de champs de la vue retirée | les 5 cas de champs privés (notes, raison, dépense, champ d'un autre type) |

## Ce que cela prouve, et ce que cela ne prouve pas
**Prouvé (émulateur) :** les règles candidates compilent ; `getAfter` (approbation atomique), la comparaison `request.time < accessUntil` avec un Timestamp et le motif d'identifiant fonctionnent ; les protections de la section 3 des décisions tiennent pour les 194 cas ; l'adaptateur Firestore et les flux fonctionnent de bout en bout à deux comptes ; une approbation est tout-ou-rien.

**Non prouvé :**
- **Le service Firebase réel** : l'émulateur ne reproduit pas les limites, latences, jetons, verrouillage des transactions ni les quotas du service réel. Le projet de test `takarda-n2-test` n'a **pas** été utilisé.
- **Authentication réelle** : la revendication `sign_in_provider: 'password'` est fournie par la bibliothèque de test (simulée).
- **L'heure** : celle de l'émulateur ; l'égalité stricte « à l'instant de fin d'accès » est prouvée par la politique de référence, et approchée dans l'émulateur par un instant déjà dépassé d'une seconde.
- Les écrans, la copie locale sur téléphone, le réseau réel (coupures, mode avion).

## Constat à part : un test existant de P4 échoue sur cet émulateur
`firestoreSyncRules.emulator.test.ts` (règles P4, avant les espaces partagés) : sur 11 tests, **10 réussissent et 1 échoue** — « deux écritures simultanées à la même révision → une réussit, l'autre est un conflit » : le perdant reçoit `permission` au lieu de `conflict`. **Ce n'est pas causé par le travail de F3** : le même échec se reproduit avec le code d'origine de l'adaptateur (contrôle fait, puis fichier restauré), 5 fois sur 5. Explication probable (non vérifiée) : l'émulateur n'applique pas le verrouillage des transactions du service réel ; la seconde écriture est jugée par les règles après la première (révision attendue ≠ courante) au lieu d'être annulée puis rejouée. Conséquence possible : un vrai conflit de deux appareils écrivant au même instant exact serait classé « refusé » plutôt que « conflit » ; la gestion F2 d'un refus d'accès ne le bloquerait pas à tort tant qu'au moins une écriture est confirmée dans le cycle. **À revérifier sur le projet de test réel** ; rien n'a été modifié à ce sujet.

## Suite possible (autorisation distincte)
Rejouer la même matrice et les mêmes flux sur le projet de test réel (publication du candidat sur `takarda-n2-test`, comptes jetables, nettoyage) pour lever les limites ci-dessus : Authentication réelle, verrouillage réel des transactions, latences et quotas.

## Mise à jour F4 (verrou d'effacement, suppression, règles d'urgence)
Les règles candidates ont été étendues (verrou d'effacement du module, suppression sous verrou, liste de SES modules) : la matrice passe de 194 à **242 cas, tous réussis** ; les flux à deux comptes passent de 6 à **8 scénarios réussis** (effacement avec panne puis reprise, suppression de compte complète via la composition réelle) ; **5 tests** des règles d'urgence réussis ; trois contrôles négatifs supplémentaires détectés exactement. L'empreinte du candidat validé est celle du manifeste `firestore.rules.manifest.json`. Les résultats de 194 cas ci-dessus concernent la version antérieure des règles. Commande : les suites se lancent en **appels séparés** (`... "npx jest -c jest.emulator.modules.config.js modulesRules && npx jest -c jest.emulator.modules.config.js modulesFlows && npx jest -c jest.emulator.modules.config.js emergencyRules"`) : lancées ensemble dans un même processus, elles se perturbent mutuellement. Détail : `docs/f4-production.md`.

## Mise à jour F6 (effacement du nom saisi, suppression d'un espace)
Les règles ont encore évolué : un demandeur peut effacer SA demande approuvée (le nom qu'il avait saisi) ; une demande refusée reste. Nouveau candidat validé (empreinte dans `firestore.rules.manifest.json`) : matrice de **244 cas, tous réussis** ; **9 scénarios** à deux comptes réussis (dont quitter un espace en retirant le nom saisi et le départ des espaces rejoints) ; **5 tests** d'urgence réussis. Les fichiers d'urgence et le manifeste ont été régénérés pour ce candidat.
