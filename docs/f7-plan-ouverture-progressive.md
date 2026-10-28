# F7 — Plan d'ouverture progressive de TakarDa (préparation uniquement)

> **Statut : plan. Aucune étape n'est lancée.** `CLOUD_ACCOUNT_ENABLED` reste `false`. Aucun contact avec Firebase de production, aucune règle publiée, aucun build, aucune page publiée, rien soumis à Google Play, aucun commit.
> **Chaque étape marquée 🔐 demande votre autorisation explicite et distincte** avant que je la touche. Ce que j'ai prouvé jusqu'ici l'a été **sur l'émulateur local seulement** (voir `firestore.rules.manifest.json`, `docs/preuve-emulateur-f3.md`) : rien n'a été prouvé sur le projet de test réel ni sur un téléphone.
> Documents liés : `docs/f4-production.md`, `docs/analyse-sauvegarde-android.md`, `docs/confidentialite/` (politique, page de suppression, déclaration Play, `analyse-juridique-togo-A-VERIFIER.md`, `exigences-hebergement-pages-publiques.md`).

## 1. Principe : quatre portes, dans cet ordre
Une porte ne s'ouvre que si **tous** ses critères sont prouvés. Un critère d'arrêt rencontré **ferme la porte et on revient à l'étape précédente**.

| Porte | Question | Quand elle est franchie |
|---|---|---|
| **P-A Droit et textes** | Peut-on légalement et honnêtement inviter des gens ? | décisions § 9 prises, juriste consulté, déclaration IPDCP traitée si exigée, pages publiées et vérifiées, `legal-check.js` = PRÊT |
| **P-B Preuve réelle** | Le système tient-il sur de vrais téléphones et un vrai projet Firebase ? | F5 réussie sur `takarda-n2-test` (2 comptes, 2 appareils) |
| **P-C Production prête** | La production est-elle configurée comme le candidat validé ? | § 5 entièrement coché, empreinte des règles vérifiée avant/après |
| **P-D Test fermé** | Un petit groupe connu peut-il l'utiliser sans incident ? | 14 jours (si exigé) sans critère d'arrêt, quotas sous les seuils |

## 2. Étapes détaillées et ordre

### Étape 0 — Décisions et informations (vous, sans moi)
Voir § 9. Tant que les points 1, 2, 3, 4, 5 ne sont pas tranchés, je ne peux pas compléter les documents publiés. **Aucun travail technique.**

### Étape 1 — Droit et pages publiques (P-A) 🔐 pour toute publication
1. Relecture par un juriste de la politique et de l'analyse Togo ; interrogation de l'IPDCP (déclaration, transfert vers Google).
2. Si la déclaration est exigée : la déposer **avant** l'ouverture (délai de récépissé rapporté : jusqu'à un mois).
3. Compléter les champs `[… À FOURNIR/DÉCIDER]` des deux documents (responsable, contact, date, durée comptes inactifs, âge, délais de suppression) — **je le ferai quand vous m'aurez donné les informations**.
4. Choisir l'hébergement ; **vous** publiez (ou m'autorisez à préparer les fichiers statiques) ; vérification selon `exigences-hebergement-pages-publiques.md` § 3.
5. Renseigner les deux adresses dans `constants/legalLinks.ts` ; `node scripts/release/legal-check.js` → **PRÊT**.
**Arrêt** : un marqueur restant, une adresse non vérifiée, ou un avis juridique contraire.

### Étape 2 — Mesures sans build natif (code seul, local) — peut commencer dès votre accord
Prérequis : votre confirmation de l'option « sauvegarde A + B » (`analyse-sauvegarde-android.md` § 6).
- Atténuation B : la copie de vue du locataire n'est plus affichée si elle n'a pas été actualisée en ligne depuis N jours (N à décider, proposition 30 j) ; purge à la déconnexion.
- Texte de la politique § 6 : ce qui peut être restauré (session, copie locataire).
- Suites de tests, tsc et lint sans régression (référence : 77 suites / 1523 tests, 0 erreur lint).
**Arrêt** : régression de test ; la logique de synchronisation ne doit pas bouger.

### Étape 3 — F5 : preuve réelle sur `takarda-n2-test` (P-B) 🔐 (projet de test, deux téléphones)
Prérequis : 2 téléphones (un pour moi en débogage, un pour vous) ; build de développement 🔐 ; vos 2 à 3 adresses e-mail de test ; autorisation de publier **le candidat** sur le projet de **test** uniquement.
1. Relever en lecture seule les règles actuellement actives sur le projet de test (copie de sauvegarde avant tout changement).
2. Publier le candidat `firestore.p5.rules` sur le projet de test ; vérifier l'empreinte (`release.js verify`).
3. Exécuter la matrice de § 6 (comptes A/B/C × téléphones 1/2), dont les scénarios de sauvegarde T-R0…T-R6.
4. Rejouer le test « deux écritures simultanées » (écart connu sur l'émulateur : `permission` au lieu de `conflict`) : trancher entre défaut de l'émulateur et comportement réel.
5. Prouver la suppression de compte de bout en bout (propriétaire avec espace, locataire, départ d'un espace) et l'arrêt d'urgence (variantes 1 et 2) **sur le projet de test**.
**Arrêt** : toute fuite entre comptes, toute suppression incomplète non reprenable, tout dépassement de quota inattendu.

### Étape 4 — Préparation de la production (P-C) 🔐 (console Firebase de production : votre autorisation et vos mains ou votre présence)
Checklist § 5. Je n'agis pas sur la production sans autorisation distincte pour **chaque** opération.

### Étape 5 — Publication des règles en production (P-C) 🔐
1. Relever les règles actuelles de production (lecture seule) et les archiver ; les noter dans le manifeste comme « retour arrière ».
2. `release.js verify` du candidat **avant**, publication, `verify` **après** : empreinte identique.
3. Tests négatifs en production avec des comptes de test dédiés (jamais des vraies données) : accès refusé hors module, refus d'écriture de champ interdit.
**Arrêt** : empreinte différente → republier le retour arrière immédiatement.

### Étape 6 — Builds et Play Console (P-C/P-D) 🔐
1. **Build A (drapeau fermé)** vers un test interne : prouve le circuit de publication sans ouvrir les comptes.
2. Console Play : déclaration « Sécurité des données » (à partir du brouillon), URL de politique, **URL de suppression**, public cible (**18+ seulement après votre validation**), accès pour les relecteurs (comptes de test), classification du contenu.
3. **Build B (drapeau ouvert)** vers le **test fermé** : 12 testeurs inscrits en continu pendant 14 jours **si** votre compte est personnel et créé après le 13/11/2023 (à confirmer dans la console).
**Arrêt** : refus de Google (corriger la déclaration, pas contourner) ; garde d'environnement qui n'accepte pas le projet de production.

### Étape 7 — Test fermé (P-D)
Observation quotidienne, § 7. Ajouter les testeurs par petits groupes (5, puis 12). Une personne propriétaire avec un vrai locataire d'essai, consentant.

### Étape 8 — Production progressive 🔐
Déploiement échelonné **5 % → 20 % → 50 % → 100 %**, chaque palier maintenu au moins 3 jours ouvrés sans critère d'arrêt. **Le plan gratuit est un plafond dur** : la capacité estimée est d'environ 228 familles types par jour (28 en usage intensif). Au-delà de 60 % du quota lu, on ne monte pas de palier.

### Étape 9 — Exploitation
Vérification hebdomadaire des deux liens publics ; revue trimestrielle des comptes inactifs (jamais automatique) ; traitement des demandes de suppression (accusé 3 jours ouvrés, objectif 14, maximum 30) ; relecture annuelle des textes.

## 3. Prérequis et critères d'arrêt (synthèse)
| Étape | Prérequis | Critère d'arrêt |
|---|---|---|
| 1 | décisions § 9 | marqueur restant ; avis juridique contraire |
| 2 | confirmation sauvegarde | régression de test |
| 3 | 2 téléphones, build de dev, comptes de test | fuite entre comptes ; suppression non reprenable |
| 4 | P-A et P-B franchies | écart de configuration |
| 5 | archive des règles actuelles | empreinte ≠ candidat |
| 6 | pages vérifiées, déclaration cohérente | refus Play ; flux d'environnement incorrect |
| 7 | testeurs recrutés | incident de données ; quota > 60 % ; > 3 défauts de sync non expliqués |
| 8 | test fermé propre | quota > 60 % ; plainte de confidentialité |

## 4. Registre des risques (fuite, perte, restauration indésirable)
| # | Risque | Gravité | Parade existante (prouvée) | À résoudre / prouver avant ouverture |
|---|---|---|---|---|
| F1 | Un utilisateur lit les données d'un autre compte | Critique | règles par propriétaire, matrice de 244 cas, 9 scénarios à deux comptes, 6 casses volontaires détectées (émulateur) | rejouer **sur le projet de test réel** (étape 3) |
| F2 | Un locataire voit un champ non prévu | Critique | liste blanche par type, au projet et aux règles | contrôle sur appareil |
| F3 | Un locataire révoqué garde sa copie | Moyenne | masquage après la date de fin, purge à l'actualisation | atténuation B (étape 2) ; T-R2 |
| F4 | Session restaurée sur un autre téléphone (sauvegarde Android) | Moyenne | sauvegarde chiffrée de bout en bout | décision C/D avant production générale ; T-R1 |
| F5 | Suppression de compte incomplète | Élevée | ordre verrou → purge → vérification serveur ; reprise ; le compte reste si incomplet | preuve sur le projet de test (étape 3) |
| F6 | Locataires coupés par la suppression d'un compte propriétaire inactif | Élevée | revue manuelle obligatoire, aucune automatique | procédure écrite ; accord requis à chaque lot |
| L1 | Perte de données sans sauvegarde serveur (plan gratuit : pas d'export planifié) | Élevée | local d'abord : le téléphone garde les données ; reconstruction par resynchronisation | le dire dans la politique ; exports manuels conseillés |
| L2 | Suppression par erreur d'un espace | Moyenne | verrou irréversible volontaire ; confirmation | textes d'avertissement relus |
| Q1 | Quota du plan gratuit épuisé (plafond dur) | Élevée | plafonds par compte (5000 lectures / 2000 écritures par jour), délais, statut « suspendu » | seuils d'alerte § 5 ; échelonnement |
| Q2 | Limite d'envoi des e-mails de vérification d'Authentication | Moyenne | — | **À VÉRIFIER dans la console** ; échelonner les inscriptions |
| J1 | Non-conformité légale (déclaration, transfert) | Élevée | information « Mes données », case d'inscription (information, pas consentement juridique) | étape 1 |
| P1 | Rejet par Google Play (données, suppression) | Moyenne | brouillons cohérents, URL de suppression prévue | relecture à la soumission |
| E1 | Un build publié écrit sur le mauvais projet | Critique | garde d'environnement (build publié ↔ production seulement) | contrôle à chaque build (§ 5) |
| X1 | Données sensibles dans les notes libres des propriétaires | Moyenne | information « déconseillé » | avertissement dans les champs de notes |

## 5. Vérifications de production (checklist)
**Règles Firestore**
- [ ] règles actuelles de production relevées et archivées (retour arrière) ;
- [ ] `release.js verify` du candidat : empreinte identique **avant** et **après** publication ;
- [ ] fichiers d'urgence (écritures coupées / tout coupé) régénérés **pour ce candidat** et prêts ;
- [ ] tests négatifs avec des comptes dédiés.

**Quotas et plan**
- [ ] plan gratuit confirmé ; alertes de budget impossibles sans facturation : **relève manuelle quotidienne** de l'usage les 14 premiers jours ;
- [ ] seuils : 40 % = surveillance, 60 % = on ne monte pas, 80 % = gel des inscriptions, 90 % = coupure d'urgence niveau 1 ;
- [ ] limite d'e-mails d'Authentication relevée.

**Authentication**
- [ ] seule la méthode e-mail/mot de passe activée ; e-mail vérifié exigé par les règles ;
- [ ] modèles d'e-mails relus en français ; domaines autorisés limités ; politique de mot de passe vérifiée.

**Suppression de compte**
- [ ] preuve complète sur le projet de test ; page publique de suppression en ligne ; procédure manuelle écrite ;
- [ ] vérification d'un compte supprimé : plus de documents ni de membres, accès refusé.

**Configuration de production**
- [ ] `google-services.json` et clés dans les secrets de build, **jamais dans Git** (non affichés, non modifiés) ;
- [ ] garde d'environnement : le build publié refuse le projet de test ;
- [ ] `CLOUD_ACCOUNT_ENABLED` : fermé dans le build A, ouvert **seulement** dans le build B après la porte P-A ;
- [ ] permissions Android : caméra et micro bloquées ; sauvegarde conforme à la décision.

## 6. Matrice de tests à deux comptes et deux appareils (étape 3)
Comptes : **A** propriétaire, **B** locataire, **C** locataire sans relation. Appareils : **T1** (propriétaire), **T2** (locataire).
| # | Scénario | Résultat attendu |
|---|---|---|
| 1 | A crée un espace, publie ; B demande l'accès ; A approuve | B voit **seulement** sa vue ; C ne voit rien |
| 2 | C tente de lire l'espace de A ou la vue de B | refusé |
| 3 | A annule un paiement | B voit « Rejeté » |
| 4 | A révoque B puis B se reconnecte hors ligne puis en ligne | accès coupé ; copie retirée en ligne |
| 5 | A et le même compte A sur T1 et T2, modifications simultanées | pas de doublon ni de perte ; conflit explicite ; fait financier jamais écrasé |
| 6 | Hors ligne puis reconnexion avec file d'envoi longue | envois idempotents, plafonds respectés, statut « suspendu » si refus total |
| 7 | B quitte l'espace | nom saisi effacé, copie purgée |
| 8 | A supprime son compte avec un espace actif | verrou, purge, vérification serveur, compte supprimé ; B perd l'accès |
| 9 | B supprime son compte | départ des espaces rejoints puis suppression |
| 10 | Suppression interrompue (réseau coupé au milieu) | reprise ; le compte reste tant que c'est incomplet |
| 11 | Un autre compte TakarDa sur T2 après restauration | aucune donnée de l'ancien compte visible |
| 12 | T-R0…T-R6 (sauvegarde) | voir `analyse-sauvegarde-android.md` § 5 |
| 13 | Coupure d'urgence niveau 1 puis 2, puis retour | lecture seule puis tout coupé ; local fonctionne ; reprise propre |

## 7. Observation pendant le test fermé
Chaque jour : lectures / écritures / suppressions du jour (console), nombre d'inscrits, statuts « suspendu » rapportés, retours des testeurs. **Arrêt immédiat** (niveau 1 d'urgence) si : fuite constatée, suppression incomplète, quota > 80 %, écritures refusées en masse.

## 8. Retour arrière et coupure d'urgence
Principe : **le local d'abord** — un téléphone garde toutes les données ; couper le cloud ne détruit rien d'utile à l'utilisateur.
| Niveau | Action | Effet | Délai | Réversible |
|---|---|---|---|---|
| 0 | Arrêter le déploiement progressif dans Play | plus de nouvelles installations | minutes | oui |
| 1 | Publier `firestore.emergency-writes-off.rules` | lecture seule pour tous ; plus aucune écriture ; l'application passe en attente | minutes | oui (republier le candidat) |
| 2 | Publier `firestore.emergency-all-off.rules` | cloud entièrement fermé | minutes | oui |
| 3 | Nouveau build avec drapeau fermé | l'interface cloud disparaît **après mise à jour** de chaque téléphone | jours | oui |
| 4 | Retrait de l'application du Store | plus de nouvelles installations | heures | oui |
Les niveaux 1 et 2 sont les seuls **immédiats** : le niveau 3 dépend de la mise à jour des appareils. Chaque publication est contrôlée par empreinte (`verify`). **Retour arrière des règles** : republier l'archive relevée à l'étape 5. **Il n'existe pas de sauvegarde serveur sur le plan gratuit** : ne jamais supprimer de données de production comme « réparation ».

## 9. Informations et décisions qu'il me manque (de vous)
1. **Responsable du traitement** : identité légale, adresse de contact publique — et forme (personne physique ou entité).
2. **Type de compte Google Play** (personnel ou organisation) et date de création : détermine le test fermé (12 testeurs / 14 jours).
3. **Hébergement et adresses** des deux pages ; nom de domaine éventuel.
4. **Âge minimal et public** : confirmer « adultes 18+ ».
5. **Comptes inactifs** : valider 24 mois + 3 avertissements, sans suppression automatique.
6. **Demandes hors application** : valider 3 jours ouvrés / 14 jours / 30 jours maximum et la vérification par e-mail.
7. **Sauvegarde Android** : confirmer « A + B pour le test fermé » ou choisir C/D.
8. **Avis juridique** et démarche auprès de l'IPDCP.
9. **N** (jours de validité de la copie locataire hors ligne, proposition 30).
10. **Testeurs** : qui sont les 12 testeurs, dont un propriétaire avec un vrai locataire consentant.
11. **Second téléphone** et date de disponibilité (étape 3).

## 10. Opérations qui demandent votre autorisation explicite (aucune n'est lancée)
- toute écriture ou lecture sur `takarda-n2-test` ou la production ; publication de règles ; création de ressources Firebase ;
- build (développement, test interne, test fermé), installation, téléchargement ;
- publication des pages, soumission à Google Play, modification de la console ;
- passage de `CLOUD_ACCOUNT_ENABLED` à `true` ;
- commit, push ; toute migration, suppression ou envoi de données.
