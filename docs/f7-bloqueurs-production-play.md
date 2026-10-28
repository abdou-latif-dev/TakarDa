# Avant la production et le Play Store — liste courte (22 octobre 2026)

> Seulement ce qui est **réellement indispensable**, séparé de ce qui peut attendre. Chaque point dit **où nous en sommes** d'après des preuves, pas des intentions. `CLOUD_ACCOUNT_ENABLED` reste `false` ; rien n'est publié ni envoyé.

## A. Bloqueurs (sans eux, on n'ouvre pas)

| # | Condition | État réel | Ce qu'il reste |
|---|---|---|---|
| B1 | **Règles P5 + marqueur « compte supprimé » prouvées puis publiées AVANT l'application** (test, puis production) | Candidat `a84dcdea…` : preuves locales réussies et **émulateur réussi le 22 octobre 2026** (252/252, 9/9, 5/5, 8/8 ; contrôle négatif détecté : dossier P5 § 4 bis). Pas encore prouvé sur le service réel. Le projet de test n'a **que le niveau P4** (sonde réelle). | Votre accord pour publier sur **le projet de test** ; relecture réelle des espaces partagés propriétaire/locataire ; puis dossier et accord distincts pour la production. |
| B2 | **Ordre de déploiement** : règles d'abord, application ensuite | Constaté : avec seulement P4, la suppression de compte d'une application qui inclut les espaces partagés répond « incomplète ». | Règle de procédure (déjà dans le dossier P5) ; à rejouer sur le projet de test avec les nouvelles règles. |
| B3 | **Suppression de compte prouvée de bout en bout sur le vrai service**, y compris espaces partagés et marqueur | Prouvée sur le vrai service au niveau P4 (9 + 4 scénarios). Le parcours complet P5 n'a pas pu tourner (règles absentes). | Rejouer `deletionFlow` avec `TAKARDA_N2_MODULES_RULES=1` après publication de test. |
| B4 | **Textes légaux complets et publiés** : politique, page de suppression, adresses HTTPS vérifiées, plus aucun champ « à fournir » | `legal-check.js` : NON PRÊT (24 éléments, 2 adresses). Le test de barrière bloque l'ouverture. | Vos informations (responsable, contact, date, hébergement) ; relecture par un juriste ; mention du marqueur conservé (voir B4b). |
| B4b | **Déclaration auprès de l'autorité togolaise (IPDCP) si elle est exigée pour vous** | Non établi : sources secondaires seulement. | Avis d'un juriste ou de l'IPDCP ; délai de récépissé jusqu'à un mois (rapporté). |
| B5 | **Play Console** : fiche « Sécurité des données » cohérente, URL de suppression, public 18+, accès pour les relecteurs ; si compte personnel : test fermé de 12 testeurs pendant 14 jours | Brouillons prêts ; rien soumis. | Vos décisions (type de compte, public) ; recrutement des testeurs. |
| B6 | **Un build de production qui ne vise que la production**, avec les secrets hors du dépôt, et un build de TEST qui ne vise que le projet de test | Constaté : le `.env` du dépôt pointe sur la **production**. La garde d'environnement existe et est testée. | Procédure de build (jamais de `.env` de production dans un build de test) ; **votre accord distinct** pour chaque build. |
| B7 | **Une validation sur un vrai téléphone avec le projet de test** : inscription avec e-mail de vérification, connexion, synchronisation, suppression de compte | Jamais faite (aucun test réel côté téléphone). Un seul téléphone : propriétaire puis locataire à tour de rôle suffit. | Build de test (accord distinct) ; vos adresses e-mail de test. |
| B8 | **Coupure d'urgence répétée une fois sur le projet de test** (publier « écritures refusées », constater, revenir) | Prouvée sur l'émulateur seulement. | Accord distinct pour deux publications de test. |
| B9 | **Règles actives de la production relevées et archivées (lecture seule)** avant toute publication | Jamais lues : je ne sais pas ce qu'elles autorisent aujourd'hui. | Vous copiez le texte de l'onglet Règles de la production dans un fichier hors dépôt (lecture seule). |
| B10 | **Décision sur la sauvegarde Android** | Analyse faite (`docs/analyse-sauvegarde-android.md`) ; le téléphone confirme que TakarDa est dans le service de sauvegarde. | Votre choix : A (garder) + B (copie du locataire non affichée au-delà de N jours, à coder) pour le test fermé, C ou D avant la production générale. |

## B. Améliorations qui peuvent attendre (après l'ouverture contrôlée)

| Sujet | Pourquoi ce n'est pas bloquant |
|---|---|
| Durée de vie du marqueur « compte supprimé » (expiration automatique par politique TTL de Firestore) | Le marqueur ne contient que l'identifiant technique ; sa conservation indéfinie est sûre. L'expiration réduit seulement la quantité conservée (à vérifier : disponibilité sur le plan gratuit). |
| Test du processus tué en pleine suppression (`processKill`), de la connexion ancienne (A4), de l'e-mail de réinitialisation (A9) | Les mêmes comportements sont couverts par d'autres scénarios (C1 à C3, N2-7, A5b) ; A9 envoie un vrai e-mail. |
| Vérification d'application (App Check) | Protection supplémentaire contre l'abus de la clé ; non indispensable avec des règles strictes et un plan gratuit plafonné. |
| Détection de la perte de réseau (`netinfo`) | Confort d'usage hors ligne. |
| Purge automatique des comptes inactifs | Impossible sur le plan gratuit (aucune fonction cloud) ; revue manuelle trimestrielle prévue. |
| Reçus en PDF, module « Commerce », statistiques supplémentaires | Fonctions, pas sécurité. |
| Correction du faux échec de `modulesRules.emulator.test.ts` dans l'exécution ordinaire de Jest | Défaut de test, pas de l'application. |
| Réduction des 112 avertissements ESLint | Qualité, pas fonctionnement. |

## C. Ordre proposé (un seul chemin)
1. Vous : accord sur le dossier P5, copie des règles actives (test, puis production) dans des fichiers hors dépôt.
2. Publication du candidat sur le **projet de test** (accord distinct) → rejouer les suites réelles + la sonde + `deletionFlow` complet + A6 : le marqueur doit bloquer l'ancien jeton.
3. Build de **test** + validation sur votre téléphone (B7).
4. Textes légaux et pages publiées (B4), avis juridique (B4b), Play Console (B5).
5. Dossier de production distinct : archive des règles actives, publication, vérification, build de production, test fermé.
