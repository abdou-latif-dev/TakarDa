# TakarDa — Checklist de tests sur smartphone (état du 14 octobre 2026)

Légende : **EG** = faisable dans Expo Go (JavaScript seulement, projet de développement) · **APK** = nécessite un APK de test (profil `preview`, même configuration native que la publication) · **PLAY** = seulement avec l'AAB installé depuis une piste Google Play.
Règles : **ne jamais tester la suppression de compte sur la base Firebase de production** (utiliser un projet Firebase de test) ; ne pas saisir de vrais mots de passe dans des captures ; garder une sauvegarde exportée avant toute réinstallation.

## 0. Avant de commencer
- [ ] Sauvegarde exportée depuis Profil › Stockage › Exporter une sauvegarde (**aucune restauration n'existe** : c'est une copie de secours à relire à la main) — EG / APK / PLAY
- [ ] Compte de test dédié (jamais un compte personnel) et, pour la suppression, projet Firebase de test — EG / APK / PLAY
- [ ] Téléphone branché en USB, débogage autorisé, `adb devices` = `device` — EG / APK

## 1. Démarrage et présentation
| Test | EG | APK | PLAY |
|---|---|---|---|
| Premier lancement : présentation, « Passer », « Continuer », « Commencer » → accueil sans connexion | ✔ | ✔ | ✔ |
| Relance : la présentation ne revient pas | ✔ | ✔ | ✔ |
| Données de démonstration absentes dans une version publiée (boutons réservés au développement) | ✘ (mode développement) | ✔ | ✔ |
| Permissions : pas de demande de caméra ni de micro ; « Scanner » signalé indisponible | ✘ | ✔ | ✔ |

## 2. Sans compte
| Test | EG | APK | PLAY |
|---|---|---|---|
| Créer un bien, un logement, un contrat ; enregistrer un paiement | ✔ | ✔ | ✔ |
| Tontine, formulaire, facture CEET/TDE | ✔ | ✔ | ✔ |
| Photo de profil / pièce jointe via le sélecteur système (aucune permission de stockage demandée) | ✔ | ✔ | ✔ |
| Redémarrage de l'application : les données sont conservées | ✔ | ✔ | ✔ |

## 3. Compte et synchronisation
| Test | EG | APK | PLAY |
|---|---|---|---|
| Création de compte (e-mail, mot de passe 6+ caractères, nom facultatif) | ✔ | ✔ | ✔ |
| Connexion refusée : mauvais mot de passe, e-mail inconnu, message français | ✔ | ✔ | ✔ |
| Réinitialisation du mot de passe (e-mail reçu) | ✔ | ✔ | ✔ |
| Session conservée après redémarrage | ✔ | ✔ | ✔ |
| Activation de la synchronisation (confirmation) ; rien n'est envoyé avant | ✔ | ✔ | ✔ |
| Import des anciennes données : aperçu → confirmation → sauvegarde locale créée | ✔ | ✔ | ✔ |
| Création / modification d'un bien et d'un logement : « En attente » puis « Synchronisé » ; jamais « Synchronisé » avant confirmation | ✔ | ✔ | ✔ |
| Mode avion : modification → « En attente » ; retour du réseau → « Synchronisé » | ✔ | ✔ | ✔ |
| Deuxième téléphone, même compte : mêmes biens et logements | ✔ (si 2 téléphones) | ✔ | ✔ |
| Conflit : modifier le même logement sur deux téléphones ; choisir la version | ✔ | ✔ | ✔ |
| Suppression locale d'un bien : message « supprimé ailleurs » absent pour sa propre suppression | ✔ | ✔ | ✔ |
| Bouton retour de l'écran Compte après connexion : revient à l'accueil sans erreur | ✔ | ✔ | ✔ |

## 4. Déconnexion et comptes
| Test | EG | APK | PLAY |
|---|---|---|---|
| Déconnexion : données locales conservées, message « Synchronisation activée » disparu | ✔ | ✔ | ✔ |
| Sans compte : les données synchronisées sont masquées ; reconnexion : elles reviennent | ✔ | ✔ | ✔ |
| Deuxième compte sur le même téléphone : ne voit pas les données du premier | ✔ | ✔ | ✔ |

## 5. Suppression de compte (projet Firebase de TEST uniquement)
| Test | EG | APK | PLAY |
|---|---|---|---|
| Mot de passe faux : « Réauthentification nécessaire », rien supprimé | ✔ | ✔ | ✔ |
| Suppression complète : « Compte supprimé » seulement à la fin ; console : plus d'espace, de profil ni de compte | ✔ | ✔ | ✔ |
| Données locales conservées et visibles ; synchronisation désactivée ; aucun envoi automatique après | ✔ | ✔ | ✔ |
| Réseau coupé pendant la suppression : état d'échec clair, **pas de blocage infini** (voir risque ouvert n°1 du lot A) | ✔ | ✔ | ✔ |
| Reprise après échec partiel : « Réessayer la suppression » aboutit | ✔ | ✔ | ✔ |
| Autre téléphone du même compte : données masquées → « Les rendre locaux » | ✔ | ✔ | ✔ |
| Règles de suppression publiées sur le projet de test avant le test | ✔ | ✔ | ✔ |

## 6. Confidentialité
| Test | EG | APK | PLAY |
|---|---|---|---|
| Lien « Politique de confidentialité » visible **seulement** quand l'adresse réelle est renseignée, et ouvre la page | ✔ | ✔ | ✔ |
| Lien de suppression de compte (page Web) idem | ✔ | ✔ | ✔ |

## 7. Configuration de publication (hors Expo Go)
| Test | EG | APK | PLAY |
|---|---|---|---|
| Identifiant `com.takarda.app`, nom, icône, écran de démarrage corrects | ✘ | ✔ | ✔ |
| Permissions du manifeste effectif : `aapt2 dump permissions` / Play Console (pas de CAMERA ; examiner SYSTEM_ALERT_WINDOW et READ/WRITE_EXTERNAL_STORAGE) | ✘ | ✔ | ✔ |
| Pages de 16 Ko : voir la méthode du rapport d'audit (alignement des bibliothèques natives, rapport avant lancement Play) | ✘ | ✔ | ✔ |
| Mise à jour par-dessus l'APK déjà installé : **impossible si la signature diffère** ; désinstallation = perte des données locales (exporter d'abord) | ✘ | ✔ | ✔ |
| Sauvegarde automatique Android : réinstallation sur le même compte Google, observer ce qui est restauré (données, session Firebase) | ✘ | ✔ | ✔ |
| Installation depuis la piste Play (interne ou fermée), lancement, parcours 1 à 5 | ✘ | ✘ | ✔ |
| Rapport avant lancement de Google Play : plantages, accessibilité, avertissements | ✘ | ✘ | ✔ |
