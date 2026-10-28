# Comparaison des règles actives de `takarda-n2-test` avec le candidat P5 (23 octobre 2026)

> **Statut : la copie du 20 octobre n'a PAS été reçue** (votre message contenait les instructions mais pas le texte ; aucun fichier de règles n'a été déposé dans `C:\Users\ousma\n2-local`). **La comparaison avec les règles réellement copiées n'est donc pas faite.** Ce document sépare ce qui est établi, ce qui est une hypothèse, et ce qui reste à faire. Aucune règle n'est publiée ; le candidat n'est pas modifié (empreinte `a84dcdea4a292aca7146f30afe8ef0c4506ca351343e9de372d4b508d940f8f6`, vérifiée).

## 1. Trois versions à ne jamais confondre
| Version | Source | État |
|---|---|---|
| **A. La copie du 20 octobre** (V1 + section P4 SYNC) | votre copie de la console | **non reçue** ; à enregistrer hors du dépôt (§ 8) |
| **B. Les règles actuellement publiées** sur `takarda-n2-test` | console | **état actuel non confirmé** ; seules des mesures réelles les caractérisent (§ 3) |
| **C. Le candidat P5** | `firestore.p5.rules`, empreinte `a84dcdea…` | local, jamais publié, prouvé sur l'émulateur |

## 2. Deux fichiers « P4 » existent dans nos archives (découverte)
| Fichier | Empreinte | Date du fichier | Différence |
|---|---|---|---|
| ancien P4 (sauvegarde `…2026-10-20_apres-campagne-N2-sync`) | `77c870da…` | 19 oct. 11:40 | la fonction `syncKinds` **admet aussi** les types `utility.*` (CEET/TDE) et `tontine.*` ; `financialKinds` admet `tontine.cotisation` et `tontine.correction_cotisation` |
| P4 actuel du dépôt | `5526515c…` | 20 oct. 11:32 | périmètre **Immobilier seul** (`core.contact` compris) |
La copie de la console du 20 octobre peut correspondre à l'un ou à l'autre selon l'heure de la publication : **c'est précisément ce que le texte permettra de trancher**.

## 3. Ce qui caractérise réellement les règles actives (mesures sur le vrai service, 22 octobre)
- Isolation entre comptes tenue, règles non ouvertes (sonde réelle).
- Synchronisation et verrou d'effacement **acceptés** (niveau P4) ; espaces partagés **refusés** (P5 absent).
- **Test S8 réussi** : des écritures brutes de types `tontine.*`, `utility.*`, formulaires et autres types hors liste ont été **refusées** par les règles réelles. Sous l'ancien P4 elles auraient été acceptées. **Les règles actives ont donc au moins le périmètre restreint du P4 actuel pour `syncKinds`.** C'est une déduction comportementale : elle ne prouve pas que le reste du texte soit identique.

## 4. Résultats de l'outil sur les versions que je possède (HYPOTHÈSES, pas votre copie)
`node scripts/firebase-rules/compare.js <fichier>` (nouveau : contrôle de **complétude** du texte, analyse **instruction par instruction**, analyse des **fonctions d'aide**).
| Fichier comparé au candidat P5 | Instructions `allow` | Fonctions d'aide |
|---|---|---|
| P4 actuel (`5526515c…`) | 11 identiques · **6 plus strictes** (`accountLive()` ajouté aux créations de profil, espace, enregistrements, synchronisation, et aux modifications d'enregistrements et de synchronisation) · **26 nouvelles** (espaces partagés, marqueur `deletedAccounts/{uid}`) · **0 plus permissive · 0 modifiée · 0 retirée** | 16 identiques · **23 nouvelles** · **0 modifiée · 0 retirée** |
| ancien P4 (`77c870da…`) | **identique au cas ci-dessus** (« 0 modifiée ») | 14 identiques · 23 nouvelles · **2 MODIFIÉES : `syncKinds` (retire 9 types `utility.*` et `tontine.*`) et `financialKinds` (retire les cotisations de tontine)** |
**Leçon importante** : l'analyse des seuls `allow` donnait « rien de modifié » pour l'ancien P4 alors que le **périmètre de synchronisation change** (publier P5 retirerait l'accès à ces types). Ne pas juger P5 sur le nombre de différences d'instructions ; les fonctions d'aide comptent.

## 5. Ce que les différences signifient pour le marqueur, la suppression et la synchronisation (lecture du candidat, pas preuve)
- **Marqueur `deletedAccounts/{uid}`** : nouvelle règle (création par le compte lui-même, heure du serveur, aucun champ en plus ; jamais modifiable ni supprimable ; lecture par son titulaire seul ; aucune liste).
- **Création après effacement** : refusée par `accountLive()` pour le profil, l'espace, les enregistrements, la synchronisation, les modules, les demandes, les membres (départ), la vue du locataire. **Plus strict** que P4 : un compte portant le marqueur ne peut plus rien créer.
- **Suppression** : aucune règle de lecture ni de suppression ne dépend du marqueur (garde statique + émulateur) ; le verrou d'effacement reste permis.
- **Synchronisation** : mêmes règles que P4 sauf la condition « compte vivant » sur la création et la modification ; si les règles actives sont l'ancien P4, le **périmètre des types se réduit** (voir § 4).
- **Risque de verrouillage** : tout compte portant le marqueur (suppression commencée) ne peut plus créer. C'est voulu et irréversible ; une publication de P5 ne marque aucun compte existant.

## 6. Limites de l'outil (à ne pas oublier)
L'outil compare des **instructions** et des **fonctions** : il ne sait pas ce qu'une fonction autorise. Il **ne prouve donc pas la sémantique de sécurité**. Une fonction nouvelle ou modifiée se relit à la main. La preuve de comportement vient des suites d'émulateur (252/252, 9/9, 5/5, 8/8, contrôle négatif détecté) et des tests réels après publication. **Que les nombres de différences correspondent à la prévision ne rend pas P5 sûr.**

## 7. Cette copie suffira-t-elle ? Ce qu'il faut confirmer
- **Oui pour l'analyse**, si le texte est **complet** : l'outil refuse un texte tronqué (accolades non équilibrées, « ... », fin du fichier absente) avec la raison.
- **Non pour décider la publication** sans confirmation : une copie datée du **20 octobre** ne dit pas ce qui est publié **aujourd'hui** (le projet a pu être modifié depuis). Il faut **confirmer dans la console** que l'onglet Règles est inchangé depuis cette copie, ou me fournir une **nouvelle copie datée du jour**. Si la console affiche une date de dernière publication, notez-la.

## 8. Comment me fournir le texte (lecture seule)
1. Console Firebase du projet **`takarda-n2-test`** (nom visible en haut) › Firestore Database › onglet **Règles**.
2. Dans l'éditeur : **Ctrl+A** puis **Ctrl+C** (tout le fichier, pas seulement la partie visible).
3. Coller dans un nouveau fichier **hors dépôt**, par exemple `C:\Users\ousma\n2-local\regles-takarda-n2-test-copie-2026-10-20.rules` (ou la date du jour pour une nouvelle copie). Ne rien modifier dans la console.
4. Me le dire ; je lance la comparaison. Je peux aussi recevoir le texte collé dans la conversation si le fichier est plus simple à ne pas créer : je l'enregistrerai moi-même hors du dépôt.
