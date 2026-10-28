# Démonstration crédible — défauts constatés et corrections minimales proposées (22 octobre 2026)

> **Statut : APPLIQUÉE le 23 octobre 2026 (après votre accord), avec tests.** Les exemples sont créés avec **les mêmes services que l'application**, dans l'espace de démonstration isolé (`demo/…`) seulement : chaque fonction de création refuse de s'exécuter hors de cet espace. Les données personnelles ne sont jamais touchées (test d'isolation octet pour octet). Les chiffres du § 3 sont ceux de la **première proposition** ; les chiffres définitifs (spécification complète : 3 biens, 10 logements, 8 contrats, **20 paiements, 633 000 FCFA encaissés**, 4 contrats en retard, 6 loyers impayés, CEET et TDE à 2 parts payées sur 3) sont **vérifiés par `services/__tests__/demoShowcase.test.ts`** contre la spécification, pas contre les fonctions testées.
> **Défaut découvert et corrigé en passant :** les définitions CEET/TDE mises en cache (`ensureFacturesToolCached`) n'étaient **pas oubliées** au changement d'espace (démonstration ↔ personnel) : après avoir ouvert CEET/TDE dans la démonstration, l'espace personnel aurait pu utiliser les identifiants de la démonstration (données personnelles de CEET/TDE invisibles, nouvelles données rattachées à un outil inexistant). Le cache est maintenant oublié à l'entrée et à la sortie, avec test dans les deux sens et contrôle négatif.

## 1. Ce que la démonstration affiche aujourd'hui (sonde réelle)
| Zone | Constat | Gravité pour une présentation |
|---|---|---|
| Immobilier | 2 biens, 6 logements, 4 contrats **dont l'entrée est « aujourd'hui »** ; **0 paiement**, 0 encaissé, 0 impayé ; rapport : 150 000 attendus, 0 encaissés | statistiques, retards et reçus **vides** |
| CEET / TDE | aucun participant, aucun relevé, aucune facture ; statistiques `null` | module « vide » |
| Formulaires | aucun formulaire, aucune réponse | module « vide » |
| Tontine | complète (5 membres, 2 tours versés, 1 tour en retard) ; **date de départ codée en dur au 7 octobre 2026** | cohérente aujourd'hui, **périmée** dans quelques mois |
| Accueil | 2 outils + 1 alerte (tontine) | pauvre |

## 2. Corrections minimales (toutes dans l'espace de démonstration, avec les services existants)
1. **Immobilier :** entrées de contrat à **trois mois avant aujourd'hui**, puis **1 à 4 paiements réels par contrat** (`enregistrerPaiementLoyer`) : des locataires à jour, d'autres en retard. + un 3ᵉ bien « Résidence Kodjoviakopé (démo) » avec 4 contrats.
2. **CEET et TDE :** 3 participants chacun, relevés de deux périodes, **une facture répartie par compteur** et deux parts payées sur trois.
3. **Formulaires :** « Fiche de visite (démo) » avec trois champs et deux réponses.
4. **Dates relatives** (mois précédents calculés d'après la date du jour, y compris pour la tontine) : la démonstration reste actuelle.
5. **Aucune fausse promesse :** tout exemple porte « (démo) » dans son nom (biens, tontine, formulaire) ; les personnes sont des noms fictifs avec des numéros évidents (`+228 90 00 00 xx`) ; les chiffres affichés viennent uniquement de ces exemples.

## 3. Preuve (exécutée le 22 octobre 2026, test temporaire supprimé)
| Indicateur | Avant | Après (proposition) |
|---|---|---|
| Biens / logements / contrats actifs | 2 / 6 / 4 | **3 / 10 / 8** |
| Paiements enregistrés, encaissé | 0, 0 | **10 paiements, 328 000 FCFA** |
| Impayés | 0 | **2 contrats, 3 loyers** (alerte d'accueil « Loyers en retard — 2 contrats · 3 loyers impayés ») |
| CEET | vide | **1 facture validée, 3 parts (2 payées : 36 000 FCFA ; 1 restante : 18 000), consommation 255** |
| TDE | vide | **1 facture validée, 3 parts (2 payées : 12 000 ; 1 restante : 6 000), consommation 27** |
| Formulaires / réponses | 0 / 0 | **1 / 2** |
| Alertes d'accueil | 1 | **4** (loyers, tontine, parts CEET, parts TDE) |

Les statistiques correspondent aux données affichées : elles sont calculées par les mêmes fonctions que les écrans.

## 4. Mise en œuvre prévue après votre accord (environ 80 lignes, dans le code de démonstration seulement)
`services/immobilierDemoService.ts` (dates relatives, paiements, 3ᵉ bien), nouveau `services/utilityDemoService.ts` (CEET/TDE), nouveau `services/formDemoService.ts`, `services/tontineDemoService.ts` (date de départ relative), `services/demoWorkspace.ts` (appel des nouvelles fonctions). Tests : un test de cohérence (chiffres ci-dessus) et les tests d'isolation existants, relancés.
**Limite connue :** une installation qui a déjà ouvert la démonstration conserve ses anciens exemples (le semis n'a lieu que si l'espace de démonstration est vide). Le build `test-local` est installé à côté de TakarDa : il démarre avec un espace vide, donc avec les nouveaux exemples.

## 5. Suite
Rien à décider. À constater sur le téléphone après le prochain build de test (la création des exemples prend quelques secondes au premier démarrage : le bouton « Commencer » affiche maintenant une attente).
