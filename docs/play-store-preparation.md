# Préparation du Play Store — exigences vérifiées, fiche, visuels, checklist (22 octobre 2026)

> **Statut : PRÉPARATION LOCALE. Rien n'est publié, aucun compte développeur n'est créé, aucun build n'est lancé, rien n'est soumis à Google Play.** Les textes de la fiche sont des **brouillons** à valider par vous. **Les documents juridiques ne sont pas validés juridiquement.**
> Les exigences de Google ci-dessous ont été **lues sur les pages d'aide officielles le 22 octobre 2026** (sources en fin de document) ; ce qui n'y figurait pas est marqué « à confirmer dans la console ».

## 1. Exigences de Google Play vérifiées
| Sujet | Exigence lue | Notre état |
|---|---|---|
| Titre | **30 caractères** max | « TakarDa : loyers et tontines » = 28 ✓ |
| Description courte | **80** max | 77 ✓ |
| Description complète | **4 000** max | brouillon = 983 ✓ |
| Icône de la fiche | PNG **32 bits avec alpha, 512×512**, ≤ 1 024 Ko | **à produire** (voir § 5 : l'icône actuelle est un gabarit) |
| Graphique de présentation | JPEG ou PNG 24 bits **sans alpha, 1 024×500** | **à créer** |
| Captures téléphone | **2 à 8**, JPEG/PNG 24 bits **sans alpha**, chaque côté **320 à 3 840 px**, **le plus long côté ≤ 2 × le plus court** ; pour la recommandation grand format : ≥ 4 captures, 9:16 ≥ 1 080×1 920 | **à produire** ; ⚠ votre écran 720×1 640 = 2,28:1 **dépasse 2:1** → recadrage obligatoire |
| Captures tablette | au moins 4 pour Chromebooks et tablettes (recommandé) | à décider |
| Vidéo de présentation | facultative (lien YouTube) | non |
| Coordonnées | **e-mail obligatoire** ; site recommandé ; téléphone facultatif | à fournir par vous |
| **Niveau d'API cible** | **API 36 exigée pour les nouvelles applications et mises à jour depuis le 31 août 2026** | **TakarDa cible 36** (relevé sur l'APK installé, Expo SDK 54) ✓ |
| **Format** | **Android App Bundle (AAB) obligatoire** pour les nouvelles applications | profil `production` = AAB ✓ |
| **Test fermé** | compte **personnel créé après le 13 novembre 2023** : **≥ 12 testeurs inscrits en continu ≥ 14 jours** avant de demander la production ; la page ne cite aucune exemption (comptes d'organisation : **à confirmer dans la console**) | dépend de votre type de compte |
| **Sécurité des données** | **formulaire obligatoire pour toute application publiée**, **même sans collecte** ; **une politique de confidentialité est requise pour le remplir** ; les applications présentes seulement sur la piste de test interne en sont dispensées | **concerne aussi la version locale** : la politique en ligne reste nécessaire |
| **Suppression de compte** | requise pour les applications qui **permettent de créer un compte** : parcours **dans l'application** + **ressource Web** (sans réinstaller) ; **les comptes créés et utilisés hors ligne ne sont pas concernés** | **version locale : non requise ; version connectée : requise** |
| **Fonctions financières** | **déclaration obligatoire pour toutes les applications**, même sans fonction financière (option « aucune ») ; la page ne dit pas si le suivi de loyers compte comme fonction financière | **à déclarer avec prudence** (voir § 3) |
| Questionnaire de classification, catégorie, public cible | à remplir dans la console | à décider |

## 2. État technique du projet
| Élément | Valeur | Verdict |
|---|---|---|
| Identifiant de la fiche | `com.takarda.app` | prêt |
| Identifiant de test | `com.takarda.app.test` (installé **à côté**, refusé par la fiche Play) | prêt, éprouvé |
| Version | `1.0.0` ; code de version géré par EAS (`autoIncrement`), doit **augmenter à chaque envoi** | prêt (`app.json` sera modifié par le build de production) |
| SDK Android | `minSdk 24`, `targetSdk 36` | conforme |
| Expo / RN | SDK 54, nouvelle architecture ; Expo Go inutilisable (v57 sur le téléphone) → build de test obligatoire | — |
| Orientation, thème | portrait ; clair/sombre | prêt |
| Permissions (résolues hors ligne) | conservées : `INTERNET`, `VIBRATE`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW` ; **retirées : `CAMERA`, `RECORD_AUDIO`** | ⚠ trois permissions probablement superflues (voir § 7) ; à confirmer sur l'AAB construit |
| Signature | clé gérée par EAS, jamais dans le dépôt | à créer au premier build de chaque identifiant |
| **Icône, icône adaptative, écran de démarrage** | **gabarits Expo non remplacés** (chevron bleu et grille) | **⚠ BLOQUANT pour la publication, laid pour la démonstration** — brief prêt : `docs/brief-logo-et-visuels.md` |
| Séparation test / production | profils `preview`, `test-local`, `test-cloud`, `production` + barrière avant build | prêt, éprouvé (`docs/builds-test-production.md`) |

## 3. Fiche — version à valider
**Nom définitif :** `TakarDa` (nom affiché de l'application ; le titre de la fiche peut le prolonger).
**Titre (≤ 30) :** `TakarDa : loyers et tontines` (28)
**Description courte (≤ 80) :** `Loyers, tontines et factures partagées : un suivi simple sur votre téléphone.` (77)
**Description complète (≤ 4 000) — variante V1 locale, sans compte :**
```
TakarDa vous aide à suivre vos loyers, vos tontines et vos factures partagées, simplement, depuis votre téléphone.

IMMOBILIER
• Enregistrez vos biens, vos logements, vos locataires et leurs contrats.
• Suivez les loyers : paiements, retards, reçus à partager par message (texte).
• Gardez vos dépenses et consultez les statistiques et le rapport.

TONTINE
• Créez vos tontines, ajoutez les membres, enregistrez les cotisations tour après tour.
• Retrouvez l'historique et les statistiques de chaque tontine.

ÉLECTRICITÉ (CEET) ET EAU (TDE)
• Saisissez les relevés d'index et répartissez chaque facture entre les participants, par compteur.
• Suivez les parts payées et restantes.

FORMULAIRES
• Créez des formulaires et suivez les réponses.

SIMPLE ET PRIVÉ
• Vos données sont enregistrées sur votre téléphone ; aucune publicité.
• Exportez une sauvegarde de vos données quand vous le souhaitez.
• Un mode de démonstration, avec des exemples fictifs, pour découvrir l'application.
```
**Variante V1 connectée** (comptes et espaces partagés) : **non rédigée** — elle ne le sera qu'une fois les fonctions connectées validées sur le vrai service ; les présenter maintenant comme disponibles serait faux.

**Catégorie (à confirmer dans la console) :** « Productivité » ou « Affaires » sont les plus cohérentes ; **éviter « Finance »** tant que l'application ne traite aucun paiement (déclarations supplémentaires probables).
**Coordonnées à renseigner :** e-mail (obligatoire), site (recommandé), téléphone (facultatif) : **je n'en invente aucune**.
**Déclaration « fonctions financières » :** TakarDa **enregistre** des loyers et des cotisations mais **ne traite, ne transfère et ne prête aucun argent**. L'option prévue est « aucune fonction financière », **à confirmer** auprès de la politique « Services financiers » de Google ou du support avant soumission (la page d'aide ne tranche pas pour le suivi de loyers).

### Affirmations à vérifier avant publication
| Affirmation | Vérifiée ? | Preuve / à faire |
|---|---|---|
| « Vos données sont enregistrées sur votre téléphone » | oui (version locale) | aucun appel réseau hors Firebase ; test `localBuildNoNetwork` ; **faux dès que les comptes s'ouvrent** : variante connectée à écrire |
| « Aucune publicité » | oui | aucune bibliothèque publicitaire (test `legalReadiness`) |
| « Reçus à partager (texte) » | oui | `rentReceiptService` ; **pas de PDF** |
| « Statistiques et rapport » | oui | `moduleStatsService`, `immobilierReportService` ; **vides sans données** (voir `docs/proposition-demonstration-credible.md`) |
| « CEET/TDE : répartition par compteur » | oui | `validerFactureParCompteur` |
| « Formulaires et réponses » | oui | `formService`, `submissionService` |
| « Exportez une sauvegarde » | oui | Profil › Stockage ; **la restauration n'est pas branchée à l'écran** : ne pas promettre « restaurer » |
| « Scanner un QR code » | **NON** | **caméra bloquée** : le raccourci « Scanner » n'est plus proposé dans la V1 (23 octobre 2026) ; ne pas l'écrire dans la fiche |
| Comptes, synchronisation, espaces partagés, partage avec les locataires | **NON (cloud non validé)** | **interdit dans la fiche V1 locale** |
| « Sécurisé », « conforme à la loi », « chiffré » | non | **ne pas écrire** sans preuve |

## 4. Visuels — existants et manquants
| Visuel | Existant | À produire |
|---|---|---|
| Icône de la fiche 512×512 32 bits | `icon.png` 1 024×1 024 (24 bits) = **gabarit Expo** | **votre logo** puis redimensionnement (je prépare la commande ; **je n'ai rien généré** pour ne pas fabriquer une fausse icône) |
| Icône adaptative (Android) | avant-plan 512×512 + fond 512×512 + monochrome 432×432 = **gabarits** | logo 1 024×1 024 avec le motif dans le cercle central (≈ 66 %), fond uni, version monochrome |
| Écran de démarrage | `splash-icon.png` 1 024×1 024 = **grille et cercles du gabarit** | logo TakarDa (fond clair et sombre déjà configurés) |
| Graphique de présentation 1 024×500 | aucun | à créer |
| Captures téléphone (2 à 8) | aucune | à prendre **sur la vraie application** (version de démonstration complétée) |
| Captures tablette | aucune | facultatif |

**Proposition de graphique de présentation** (1 024×500, sans transparence) : fond uni dans la couleur de marque ; à gauche le logo TakarDa ; à droite le titre « **Loyers, tontines et factures** » et, en dessous, « **Simple. Sur votre téléphone.** ». Aucune capture d'écran inventée ; aucune promesse chiffrée.
**Plan de captures** (données fictives du mode démonstration, **aucune donnée réelle**) :
1. Accueil — « Vos outils au même endroit »
2. Liste des biens — « Vos biens et logements »
3. Contrat et paiements — « Suivez chaque loyer »
4. Statistiques d'Immobilier — « Encaissé et impayés »
5. Tour d'une tontine — « Cotisations tour après tour »
6. Répartition CEET — « Partagez les factures par compteur »
7. Profil › Mes données — « Vos données, expliquées »
Les légendes ne doivent décrire que ce que l'image montre. **Cadrage :** 1 080×1 920 (9:16) ; l'écran 720×1 640 de votre téléphone doit être recadré (au plus 2:1).

## 5. Documents et déclarations — ce qui est prêt et ce qu'il faut
| Document | Brouillon | Finalisable maintenant | Nécessite |
|---|---|---|---|
| Politique de confidentialité | `docs/confidentialite/politique-de-confidentialite-BROUILLON.md` | structure et faits techniques (vérifiés par le code) | **identité du responsable, adresse de contact, date, durée de conservation, page HTTPS publiée, avis juridique** |
| Page de suppression de compte | `page-suppression-de-compte-BROUILLON.md` | parcours dans l'application, ce qui est supprimé ou conservé | **adresse HTTPS publiée, contact, avis juridique** (inutile pour la version locale) |
| Déclaration « Sécurité des données » | `declaration-securite-donnees-play-BROUILLON.md` | correspondance donnée par donnée avec le code | **politique publiée, compte développeur (console)** |
| Informations du responsable | partie 2 de la politique | liste exacte des champs | **identité légale, adresse** (rien n'est inventé) |
| Analyse du cadre togolais | `analyse-juridique-togo-A-VERIFIER.md` | rapportée de sources secondaires | **juriste, IPDCP** |
| Hébergement des pages | `exigences-hebergement-pages-publiques.md` | exigences techniques | **choix d'hébergement, nom de domaine** |
**Rappel :** la politique est exigée **même pour la version locale** (formulaire « Sécurité des données » obligatoire). `legal-check.js` : NON PRÊT (adresses et champs à fournir).

## 6. Checklist avant publication
| # | Exigence | État |
|---|---|---|
| 1 | Niveau d'API 36 | ✓ (relevé) |
| 2 | Identifiant `com.takarda.app` ; jamais `.test` sur la fiche | ✓ (barrière) |
| 3 | Version `1.0.0` et code de version croissant | ✓ géré par EAS ; ⏳ au premier envoi |
| 4 | Format **AAB** (`production`) | ✓ profil prêt ; ⏳ build |
| 5 | Signature gérée par EAS, **Play App Signing** | ⏳ premier build ; **ne jamais perdre l'accès au compte Expo** |
| 6 | Permissions minimales confirmées sur l'AAB (`aapt dump permissions`) | ⏳ après build |
| 7 | **Icône, adaptative, démarrage de marque** | ✗ **bloquant** |
| 8 | Titre, descriptions, catégorie, coordonnées | ◐ brouillons, à valider |
| 9 | Graphique 1 024×500 et 2 à 8 captures | ✗ |
| 10 | Politique en ligne (HTTPS) | ✗ identité, adresse, hébergement, avis |
| 11 | Formulaire « Sécurité des données » | ◐ brouillon ; ⏳ console |
| 12 | Déclaration « fonctions financières » | ⏳ à confirmer |
| 13 | Questionnaire de classification, public cible 18+ (proposition) | ⏳ console |
| 14 | Suppression de compte (version connectée) : parcours + page Web | ✓ parcours prouvé (P4, émulateur) ; ✗ page HTTPS |
| 15 | Test fermé 12 testeurs × 14 jours (compte personnel) | ⏳ dépend du compte |
| 16 | Procédure de mise à jour : nouveau build `production` avec `autoIncrement`, test interne puis déploiement progressif | ◐ décrite |
| 17 | Règles Firebase publiées avant toute version connectée | ✗ |

**APK de test ≠ AAB de production.** L'APK `test-local`/`test-cloud` est un fichier d'installation directe, signé avec la clé de l'identifiant de **test**, d'identifiant `com.takarda.app.test` : **Google Play le refuse**. La publication demande un **AAB** (format de livraison que Google convertit en APK par appareil), d'identifiant `com.takarda.app`, construit par le profil `production` (barrière légale incluse) et géré par Play App Signing. Un APK de test n'est **jamais** publiable sur le Store.

## 7. Décisions et éléments à fournir par vous
**Bloquent la publication :** (1) **logo** (icône, adaptative, démarrage) ; (2) **type de compte développeur** et date de création ; (3) **identité légale et contact** ; (4) **hébergement HTTPS** des pages ; (5) **avis juridique** ; (6) **V1 locale ou connectée**.
**Bloquent seulement une démonstration plus convaincante :** (7) **proposition de démonstration appliquée le 23 octobre 2026** (`docs/proposition-demonstration-credible.md`) ; (8) **scanner de QR code** : **fait pour la V1** — le raccourci est masqué tant que la caméra est bloquée (le code du scanner est conservé ; il réapparaîtrait si la caméra était autorisée et déclarée) ; (9) bloquer `SYSTEM_ALERT_WINDOW` et peut-être `READ/WRITE_EXTERNAL_STORAGE` (non utilisées à ma connaissance ; **à valider avant de toucher au manifeste**).
**Ne bloquent rien :** catégorie, captures tablette, vidéo.

## Sources (pages d'aide officielles, lues le 22 octobre 2026)
- [Aperçus et ressources de la fiche](https://support.google.com/googleplay/android-developer/answer/9866151) · [Création de l'application et limites de texte](https://support.google.com/googleplay/android-developer/answer/9859152)
- [Niveau d'API cible](https://support.google.com/googleplay/android-developer/answer/11926878) · [Android App Bundle](https://developer.android.com/guide/app-bundle)
- [Exigences de test des comptes personnels](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Formulaire « Sécurité des données »](https://support.google.com/googleplay/android-developer/answer/10787469) · [Suppression de compte](https://support.google.com/googleplay/android-developer/answer/13327111) · [Fonctions financières](https://support.google.com/googleplay/android-developer/answer/13849271)
