# Vérifications sur le vrai service après publication de P5 — projet `takarda-n2-test` (22 octobre 2026)

> **Statut : PRÉPARÉ, RIEN N'EST LANCÉ.** Aucune règle n'est publiée ; ces commandes ne s'exécutent qu'**après votre accord explicite** et la publication du candidat `a84dcdea4a292aca7146f30afe8ef0c4506ca351343e9de372d4b508d940f8f6` sur **`takarda-n2-test` seulement**. Jamais `takarda-c8cd8`.

## 1. Ce qui peut se faire SANS accès distant (disponible dès maintenant)
| Vérification | Commande | État |
|---|---|---|
| Empreinte du candidat | `node scripts/firebase-rules/release.js verify firestore.p5.rules` | **IDENTIQUE** (exécuté le 22 octobre) |
| **Comparaison avec les règles actives** (dès que le texte est copié) | `node scripts/firebase-rules/compare.js C:/Users/ousma/n2-local/regles-takarda-n2-test-actives.rules` | **outil prêt et testé (6 tests)** ; **comparaison NON faite** : le texte actif n'est pas disponible |
| Configuration de la cible | `node scripts/firebase-test/verify-target.js` (avec les variables `TAKARDA_*`) | exécuté le 22 octobre : conforme |
| Règles prouvées sur l'émulateur | voir `docs/f7-dossier-publication-p5.md` § 4 bis | 252/252, 9/9, 5/5, 8/8 |

**Obtenir le texte actif en lecture seule** : console Firebase du projet de test › Firestore Database › onglet « Règles » › tout copier › fichier hors dépôt `C:\Users\ousma\n2-local\regles-takarda-n2-test-actives.rules`. Rien n'est modifié. La commande `compare.js` indique alors : identique ou non ; **niveau détecté** (V1, P4, P5, P5 + marqueur) ; **alerte si les règles sont ouvertes** ; et une **analyse instruction par instruction** : règles **nouvelles**, **plus strictes**, **plus PERMISSIVES** (à examiner en priorité), **modifiées**, **retirées** (risque de verrouillage). Résultat attendu pour un projet de test au niveau P4 : 11 identiques, 6 plus strictes (la condition « compte vivant » ajoutée aux créations), 26 nouvelles (espaces partagés et marqueur), **0 plus permissive, 0 modifiée, 0 retirée**.

## 2. Après publication — dans cet ordre (chaque étape s'arrête au premier échec)
Variables communes (PowerShell, jamais de secret) : `TAKARDA_TEST_PROJECT_ID=takarda-n2-test`, `TAKARDA_CONFIRM_TEST_PROJECT=takarda-n2-test`, `TAKARDA_TEST_FIREBASE_CONFIG_FILE=C:\Users\ousma\n2-local\web-config.json`, **`TAKARDA_N2_MODULES_RULES=1`** (candidat publié), `TAKARDA_N2_OPERATION_BUDGET=3000`. Commande de base : `node node_modules/jest/bin/jest.js -c jest.firebase-test-real.config.js --runInBand --bail --testPathPattern <motif>`.

| # | Vérification demandée | Motif | Résultat attendu | Existe déjà |
|---|---|---|---|---|
| 0 | Empreinte après publication | `release.js verify <fichier relu>` | IDENTIQUE | oui |
| 1 | **Création et connexion des comptes** ; isolation entre comptes ; sondes de règles | `preflight` puis `rulesProbe` | tous refus d'accès d'autrui, `R5 ok`, **`R6 ok`** (espaces partagés acceptés) | oui |
| 2 | **Ancien jeton après suppression** | `token` | **aucune écriture acceptée à aucun instant** (le test l'exige avec `TAKARDA_N2_MODULES_RULES=1`) | **mis à jour** |
| 3 | **Suppression complète et reprise** | `deletionFlow` puis `deletion.n2` | `completed`, marqueur `created`, reprise `exists`, 0 orphelin | oui (parcours complet P5) |
| 4 | **Synchronisation et conflits** | `sync.n2` | S1 à S8 ; en écritures simultanées une seule réussit, l'autre est un conflit | oui |
| 5 | **Espaces partagés et isolation propriétaire/locataire** | `modules.n2` | M1 parcours, M2 étanchéité, M3 suppression + ancien jeton refusé | **nouveau, relu, typé, non exécuté** |
| 6 | Règles et lots (coût de la vérification du marqueur sur un lot réel de 20 et de 500) | `rules.n2` | tous réussis | oui |
| 7 | Écritures concurrentes pendant la suppression | `concurrency` | 0 orphelin | oui |

**À surveiller sur le vrai service avec CE candidat** (non prouvé par l'émulateur) : la limite d'accès aux documents par requête avec la lecture du marqueur (lots de 20 à la création, de 400 à la suppression) ; le coût en lectures ; le comportement d'Authentication réel avec un ancien jeton.

## 3. Nettoyage
Les tests suppriment les comptes qu'ils créent, **et eux seulement**, et signalent tout reste avec l'identifiant du compte. Les orphelins déjà connus (7 comptes de test) sont listés dans `docs/f7-nettoyage-orphelins-n2.md` : **rien n'est supprimé sans votre accord sur la liste exacte**. Après publication du marqueur, les tests `token` et `deletionFlow` ne laissent plus de restes.

## 4. Critères d'arrêt
Un seul test en échec (en particulier tout refus manquant sur l'isolation ou l'ancien jeton) : arrêt, rapport avec l'erreur exacte, **retour arrière** par republication de l'archive des règles (`docs/f7-dossier-publication-p5.md` § 7). Quota supérieur à 50 % d'une limite quotidienne : arrêt.

## 5. Ce qui nécessite une action sur le service (et votre accord)
1. Publication du candidat sur le projet de test (console ou ligne de commande avec **votre** connexion).
2. Relecture des règles publiées (lecture seule).
3. Éventuellement, publication des règles d'urgence puis retour (répétition de la coupure) : deux publications supplémentaires.
