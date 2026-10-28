# Nettoyage ciblé des documents orphelins du projet de TEST `takarda-n2-test`

> **Statut : procédure à valider. RIEN n'a été supprimé et rien ne sera supprimé automatiquement.** Ce document dit exactement ce qui est visé, comment prouver que cela vient des tests, et comment le retirer. La suppression elle-même demande votre accord explicite sur la liste ci-dessous.
> Projet visé : **`takarda-n2-test` seulement**. Jamais `takarda-c8cd8`.

## 1. Pourquoi il y a des orphelins
Les tests réels créent des comptes jetables (adresse `takarda-e2e-<code>-<n>@example.test`), y écrivent des données fictives, puis les suppriment. Deux séries ont laissé des documents que **plus aucun client ne peut retirer** (le compte propriétaire n'existe plus, et les règles n'autorisent que lui) :
- **A. Première exécution de `deletionFlow` (22 octobre 2026, avant sa correction)** : la suppression a été refusée « incomplète » (règles des espaces partagés absentes) et le nettoyage du test n'a pas pu retirer les données avant la suppression du compte.
- **B. Test `token` (A6)** : écritures volontairement faites avec un ancien jeton **après** la suppression du compte (c'est la mesure), puis session perdue avant le retrait.

## 2. Liste exacte des cibles (issue des journaux d'exécution)
Chaque identifiant ci-dessous est celui d'un compte jetable créé par ces tests ; l'adresse correspondante a le préfixe `takarda-e2e-`.

| Série | Adresse jetable (préfixe `takarda-e2e-`) | Identifiant (uid) | Documents attendus | Certitude |
|---|---|---|---|---|
| A | `iwz3wd-1@example.test` | `U3a5a70wFuhIotRMSWRZR9kXEGN2` | 9 + espace recréé | rapportée par le test |
| A | `iwz3wd-2@example.test` | `N4kaJqUlksdKK2qfKqJqyStjf5f1` | 8 + espace recréé | rapportée par le test |
| A | `iwz3wd-3@example.test` | `nh4OGlyltSSHy5hpshkAypJOe462` | 4 + espace recréé | rapportée par le test |
| A | `iwz3wd-4@example.test` | `0oPLaWmCRoMGZUZ939ABNMNFiZR2` | 7 + espace recréé | rapportée par le test |
| A | `iwz3wd-5@example.test` | `3yzByais1ibRjEqk3PO4VOKB3D72` | 4 + espace recréé | rapportée par le test |
| B | `12nfz1-1@example.test` | `mRmswDk2QBS5GJ0tqd8sO3HxG3k2` | 3 : `users/<uid>`, `spaces/personal_<uid>`, `spaces/personal_<uid>/records/zombie0-0` | confirmée (écritures acceptées, retrait refusé) |
| B | `tpx2pp-1@example.test` | `8DNI7g8EZGOrackgzYfrt5yJxlm2` | jusqu'à 3 (mêmes chemins) | **incertaine** (première exécution, plantée avant l'enregistrement du résultat) |

Chemins visés pour chaque `<uid>` : **`users/<uid>`** et **`spaces/personal_<uid>`** (avec toutes ses sous-collections : `records`, `syncRecords`). **Rien d'autre** : ni `modules/…`, ni aucun autre document.

Ne sont **pas** visés : les comptes dont le scénario a supprimé les données lui-même (`deletion`, `rules`, `concurrency`, sonde, `sync`, `auth`, `preflight`, `deletionFlow` après correction) : leurs tests ont vérifié « 0 document restant ».

## 3. Preuve d'appartenance aux tests (à faire AVANT toute suppression, en lecture seule, dans la console du projet de test)
1. **Authentication › Utilisateurs** : aucun utilisateur dont l'adresse commence par `takarda-e2e-`. S'il en reste un, ne rien supprimer et me le dire (le compte vit encore : son nettoyage se fait par le harnais).
2. **Firestore › Données**, collection `spaces` : pour chaque identifiant du tableau, un document `personal_<uid>` existe ou non. Ouvrez-le : son contenu doit être fictif (`name: "Espace"`, enregistrements `{ nom: "Maison" }` ou `zombie0-…`). **Si un contenu n'est pas manifestement fictif, arrêtez-vous.**
3. Collection `users` : de même, documents `{ defaultSpaceId: "personal_<uid>", createdAt: … }` seulement.
4. Le nombre de documents correspond au tableau (à quelques unités près) : un écart important signale un autre usage du projet.
5. Le projet affiché en haut de la console est bien **`takarda-n2-test`**.

## 4. Méthode de suppression (après votre accord sur la liste)
**Option 1 — console (sans ligne de commande).** Pour chaque uid : collection `spaces` → `personal_<uid>` → supprimer la sous-collection `records`, puis `syncRecords` si elle existe, puis le document ; collection `users` → `<uid>`. Plus long, entièrement visible.

**Option 2 — ligne de commande, avec VOTRE connexion** (`firebase login` sur votre PC ; je ne vois ni ne demande aucun identifiant). Une commande par chemin, **toujours avec `--project takarda-n2-test`**, sans l'option qui supprime sans demander confirmation :
```bash
firebase firestore:delete spaces/personal_U3a5a70wFuhIotRMSWRZR9kXEGN2 --recursive --project takarda-n2-test
```
Les 7 identifiants × 2 chemins donnent 14 commandes ; je les écris dans un fichier pour vous, sur demande, après votre accord sur la liste. Ne jamais lancer ces commandes sans `--project`.

## 5. Vérification après suppression
Rouvrir les collections `spaces` et `users` : plus aucun document dont l'identifiant correspond à la liste. Me communiquer le résultat ; je l'inscris dans le rapport. Aucune autre vérification n'est possible depuis le PC (les règles interdisent la lecture à tout autre compte).

## 6. Prévention (déjà faite dans le code de test)
- Le harnais distingue maintenant « compte supprimé par le scénario » (aucun nettoyage nécessaire) d'un échec réel de nettoyage.
- Le test `token` consigne la session perdue au lieu de planter, et ne laisse plus de restes une fois la protection « compte supprimé » publiée sur le projet de test : un ancien jeton ne peut alors plus rien recréer (voir `docs/f7-dossier-publication-p5.md`).
- Le test `deletionFlow` choisit explicitement le parcours de suppression compatible avec les règles publiées (`TAKARDA_N2_MODULES_RULES=1` pour le parcours complet).
