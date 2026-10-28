# Builds : séparation stricte test / production (22 octobre 2026)

> **Statut : configuration et procédures prêtes, AUCUN build lancé.** `CLOUD_ACCOUNT_ENABLED` reste fermé par défaut (cible de build « local »). Rien ne touche `takarda-c8cd8`.

## 1. Le principe : une cible déclarée, vérifiée trois fois
Avant ce changement, une version installée sur un téléphone ne pouvait viser que la production (la garde d'environnement ne distinguait que « développement » et « publiée »), et aucun APK ne pouvait être essayé contre le projet de test. Chaque build **déclare maintenant sa cible** (`EXPO_PUBLIC_BUILD_TARGET`, fixée par son profil dans `eas.json`) :

| Cible | Profil EAS | Comptes / cloud | Projet Firebase admis | Application installée |
|---|---|---|---|---|
| `local` (défaut) | `preview` | **fermés**, aucun appel Firebase | aucun | `com.takarda.app` (démonstration locale) — **s'installe PAR-DESSUS l'application actuelle** : voir § 3 bis |
| `local` + identité test | **`test-local`** | **fermés**, aucun appel Firebase | aucun | **`com.takarda.app.test`**, « TakarDa (test) », **à côté** de TakarDa — **premier build recommandé** |
| `test` | `test-cloud` | ouverts | **`takarda-n2-test` seulement** | **`com.takarda.app.test`**, « TakarDa (test) », installée **à côté** |
| `production` | `production` | ouverts | **`takarda-c8cd8` seulement** | `com.takarda.app` (AAB pour Google Play) |

**Trois vérifications indépendantes :**
1. **À l'exécution** (`services/firebase/firebaseEnvironment.ts`) : Firebase refuse de s'initialiser si le projet de la configuration ne correspond pas à la cible (test ↔ test, production ↔ production, local ↔ jamais).
2. **Avant le build** (`scripts/release/build-gate.js`, lancée automatiquement par EAS via le script npm `eas-build-pre-install`, et à la main avec `npm run build-gate`) : refuse un projet qui ne correspond pas, une configuration incohérente (domaine, stockage, numéro d'expéditeur d'un autre projet), une cible mal orthographiée, ou une production dont les textes légaux sont incomplets.
3. **À l'installation** (`app.config.js`) : un build de test porte un autre identifiant Android. **Il ne peut pas écraser l'application TakarDa** (vos données locales ne sont jamais touchées par un essai de test) et **Google Play refuse de l'accepter** sur la fiche de l'application.

## 2. Preuves exécutées (22 octobre 2026)
| Contrôle | Résultat |
|---|---|
| `buildTarget.test.ts` (nouveau) + garde d'environnement existant | **33/33 réussis** |
| Configuration Expo réelle, résolue hors ligne : cible absente | `TakarDa`, `com.takarda.app` (inchangé) |
| Configuration Expo réelle, cible `test` | `TakarDa (test)`, `com.takarda.app.test` |
| Barrière, aucun environnement | PRÊT « local » |
| Barrière, cible `test` + configuration de `n2-local` (valeurs non affichées) | PRÊT |
| **Barrière, cible `test` + `.env` actuel (production)** | **REFUSÉ** : « cible test avec la configuration du projet takarda-c8cd8 : interdit » |
| Barrière, cible `production` dans l'état actuel du dépôt | **REFUSÉ** : textes légaux incomplets |

Le cas dangereux (un build de test qui prendrait la configuration de production du `.env`) est donc **bloqué avant même la construction**.

## 3 bis. PREMIER build de test recommandé : `test-local` (comptes fermés, installé à côté)
**Pourquoi pas `test-cloud` en premier** : il ouvre les comptes alors que les règles P5 ne sont pas encore sur le vrai service (le projet de test est au niveau P4) : la suppression de compte y répondrait « incomplète » (sécurité voulue) et les espaces partagés y seraient refusés. **Pourquoi pas `preview` en premier** : il porte l'identifiant `com.takarda.app` de votre application actuelle ; si sa clé de signature diffère de celle de l'APK déjà installé (inconnue : le téléphone n'était pas branché), Android refuse la mise à jour et il faudrait **désinstaller TakarDa, donc perdre ses données locales** (c'est ce qui s'est produit le 22 octobre).
`test-local` cumule les deux protections : **cloud fermé** (cible `local`) et **identité de test** (`com.takarda.app.test`).
1. `npm run build-gate` avec `EXPO_PUBLIC_BUILD_TARGET=local` et `EXPO_PUBLIC_APP_VARIANT=test` → PRÊT (aucune variable Firebase requise).
2. Build (accord distinct) : `eas build --platform android --profile test-local`. **Premier build de cet identifiant : création d'une clé de signature (interactif, une fois).**
3. Installer l'APK : l'icône « TakarDa (test) » apparaît **à côté** de TakarDa ; l'application et ses données ne bougent pas. Si un second build de test refuse de s'installer par-dessus le premier : désinstaller **uniquement « TakarDa (test) »**, jamais TakarDa.
4. Essais sans compte : démarrage, démonstration, modules, formulaires, hors ligne (mode avion). Rien ne contacte Firebase.

## 3 ter. Commande exacte et prérequis restants pour `test-local` (rien n'est lancé)
**Commande à exécuter après votre accord**, depuis le dossier du projet :
```bash
eas build --platform android --profile test-local
```
**Vérification préalable (quelques secondes, aucun réseau)** — PowerShell :
```powershell
$env:EXPO_PUBLIC_BUILD_TARGET="local"; $env:EXPO_PUBLIC_APP_VARIANT="test"; npm run build-gate
```
Réponse attendue : « PRÊT : build « local » (comptes fermés, aucun appel Firebase) ».

| Prérequis | État | Détail |
|---|---|---|
| Compte Expo connecté à `eas` | **à faire par vous** (`eas whoami`) | eas-cli 24.12.1 est installé ; le build tourne chez Expo |
| Compte Firebase ou Google Play Console | **non nécessaire** | version locale : aucune connexion Firebase ; aucun compte développeur |
| Validité de `eas.json` | **vérifiée** | validé hors ligne contre le schéma de votre eas-cli (4 profils) |
| Commit Git | **non exigé** | `cli.requireCommit` est absent de `eas.json` : l'archive est une copie du dossier de travail **y compris les modifications non commitées** (relevé dans le code d'eas-cli 24.12.1). Rien n'est commité, aucune branche créée. |
| Fichiers sensibles | **exclus de l'archive** | `.env`, `google-services.json` et `node_modules` sont ignorés (`.gitignore`) |
| Clé de signature | **créée au premier build** | pour l'identifiant `com.takarda.app.test` seulement (réponse « oui » à la création d'une clé, mode interactif) ; **la signature de `com.takarda.app` n'est ni lue ni modifiée** |
| Installation | **à côté de TakarDa** | identifiant différent : ni écrasement, ni désinstallation ; **ne jamais désinstaller TakarDa** |
| Limites du plan gratuit EAS | **non vérifiées** | nombre de builds par mois à confirmer dans votre tableau de bord Expo |
| Résultat attendu | un **APK** « TakarDa (test) » | lien de téléchargement ; installation par `adb install` ou ouverture du lien sur le téléphone |

**Ce que le build contient** : l'application telle qu'elle est dans le dossier de travail (y compris le code Firebase, **inactif** : cible `local`). **Preuves exécutées** : `localBuildNoNetwork.test.ts` (aucune fonction du SDK Firebase appelée au démarrage ni pendant la démonstration, aucune tentative réseau, comptes fermés) et la barrière (PRÊT). **Non prouvé** : le comportement sur le téléphone (aucun build n'existe).

## 3. Procédure — build de TEST sur votre téléphone (rien n'est lancé sans votre accord)
**Prérequis (vous)** : compte Expo connecté à `eas` ; les six valeurs publiques du projet de test créées comme **variables d'environnement EAS** de l'environnement `preview` (elles ne sont jamais écrites dans le dépôt ; `eas.json` n'en contient aucune). Les valeurs viennent de `C:\Users\ousma\n2-local\web-config.json`. Authentification par e-mail activée sur le projet de test (déjà le cas). Règles P5 publiées sur le projet de test **avant** ce build (voir `docs/f7-dossier-publication-p5.md`).
1. Vérifier la cible : `npm run build-gate` avec `EXPO_PUBLIC_BUILD_TARGET=test` et les six variables → **PRÊT**.
2. Lancer le build (accord distinct) : `eas build --platform android --profile test-cloud`. Le **premier** build de l'identifiant `com.takarda.app.test` demande de créer une clé de signature : à faire en mode interactif, une seule fois.
3. Télécharger l'APK et l'installer **à côté** de TakarDa : `adb install <fichier>.apk` (ou ouvrir le lien EAS sur le téléphone). L'icône « TakarDa (test) » apparaît ; l'application TakarDa et ses données ne bougent pas.
4. Essais : inscription (e-mail de vérification), connexion, synchronisation, espaces partagés propriétaire/locataire (un seul téléphone : deux comptes à tour de rôle), suppression de compte, puis A6 (l'ancien jeton ne recrée rien). Journal du téléphone : `adb logcat -s ReactNativeJS`.
5. Désinstaller « TakarDa (test) » quand c'est fini : sans effet sur l'application TakarDa.

## 4. Procédure — build de PRODUCTION (plus tard, accord distinct, après les bloqueurs)
Conditions (toutes) : règles de production publiées et vérifiées par empreinte ; textes légaux complets et deux adresses https vérifiées (`node scripts/release/legal-check.js` → PRÊT) ; variables EAS de l'environnement `production` = les six valeurs de **`takarda-c8cd8`** ; `npm run build-gate` avec `EXPO_PUBLIC_BUILD_TARGET=production` → **PRÊT**.
Puis : `eas build --platform android --profile production` (AAB) → test interne puis test fermé dans Google Play → production.
**Le `.env` du dépôt n'est jamais utilisé par EAS** (ignoré par Git, donc absent de l'archive envoyée) : tout vient des variables EAS, ce qui rend l'erreur « configuration de production dans un build de test » impossible à construire.

## 5. Ce que cela ne fait pas
- Ne publie rien, ne crée aucun compte, ne touche à aucun projet Firebase.
- Ne vérifie pas la valeur de la clé d'API (le script ne voit que des noms et des identifiants publics) ; la cohérence (domaine, stockage, numéro, identifiant d'application) est vérifiée.
- `autoIncrement` du profil `production` modifie le numéro de version Android dans `app.json` au moment d'un build de production (comportement d'EAS avec `appVersionSource: local`).
- Limites du plan gratuit EAS (nombre de builds par mois) : **non vérifiées**.
