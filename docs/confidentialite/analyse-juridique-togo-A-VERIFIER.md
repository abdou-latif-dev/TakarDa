# Analyse de conformité adaptée à une application exploitée depuis le Togo — À VÉRIFIER PAR UN JURISTE

> **Ceci n'est PAS un avis juridique.** C'est une analyse de préparation, établie le 21 octobre 2026 à partir de **sources secondaires** (commentaires juridiques, articles de presse spécialisée) et de la documentation publique de Google. **Je n'ai pas pu confronter les points togolais au texte officiel** (Journal officiel du 29 octobre 2019). Aucune hypothèse n'est présentée ici comme une certitude : chaque point porte un niveau de confiance.
> Niveaux : **[Google — documenté]** = exigence lue sur les pages officielles de Google · **[Togo — rapporté]** = rapporté de façon concordante par des sources secondaires, **à confronter au texte officiel** · **[À VÉRIFIER]** = non établi, à trancher par un juriste ou l'autorité.

## 1. Cadre togolais — ce que les sources rapportent
| Point | Ce qui est rapporté | Niveau |
|---|---|---|
| Texte | **Loi n° 2019-014 du 29 octobre 2019 relative à la protection des données à caractère personnel** | [Togo — rapporté] |
| Autorité | **Instance de protection des données à caractère personnel (IPDCP)**, créée par la loi (art. 55 selon un commentaire) ; elle a lancé officiellement ses activités le **28 mars 2025** à Lomé, avec une phase initiale de sensibilisation ; elle doit définir des normes de conformité | [Togo — rapporté] (modalités pratiques actuelles : **[À VÉRIFIER]**) |
| Déclaration préalable | Tout traitement doit être déclaré à l'IPDCP (**art. 6**) ; un **récépissé** est délivré dans un délai maximal d'**un mois** ; certaines dispenses (ex. données ouvertes) ; **autorisation préalable** pour les données génétiques, sanitaires, pénales, biométriques | [Togo — rapporté] ; listes exactes de dispenses : **[À VÉRIFIER]** |
| Principes | finalité, pertinence, conservation limitée, exactitude, transparence ; consentement comme fondement de légitimité (parmi d'autres cas à vérifier) | [Togo — rapporté] |
| Droits des personnes | information (**art. 35**), accès (**art. 39**), et droits d'opposition, d'effacement et de rectification (articles non précisés dans les sources lues) | [Togo — rapporté] |
| Sécurité | obligation d'assurer confidentialité, sécurité et pérennité des données | [Togo — rapporté] |
| Transferts hors du Togo | autorisés si le pays tiers assure un niveau de protection **adéquat** ; exceptions ponctuelles avec consentement exprès (**art. 29**) ; l'autorité peut autoriser sur garanties suffisantes (**art. 30**) | [Togo — rapporté] |
| Sanctions | amendes, retrait d'autorisation, peines pouvant aller jusqu'à 5 ans pour certaines infractions (dont le non-respect des formalités préalables), contrôles par l'IPDCP (art. 66) | [Togo — rapporté] |
| **Champ d'application territorial** | **non précisé dans les sources lues** | **[À VÉRIFIER]** |
| Délégué / correspondant à la protection des données | non mentionné | **[À VÉRIFIER]** |

## 2. Ce que cela implique pour TakarDa — hypothèses de travail (pas des conclusions)
| # | Sujet | Hypothèse de travail | À vérifier |
|---|---|---|---|
| 1 | **Qui est responsable ?** | L'exploitant de TakarDa (vous) est responsable du traitement des comptes et des espaces partagés ; **chaque propriétaire** l'est pour les informations de **ses locataires** (déjà écrit dans la politique, §1) | La qualification exacte (responsable, sous-traitant, coresponsables) et l'éventuelle exemption d'un usage purement personnel pour un petit propriétaire |
| 2 | **Déclaration à l'IPDCP** | Si l'exploitation depuis le Togo relève de la loi, **une déclaration préalable du traitement « comptes et espaces partagés » est probablement à faire avant l'ouverture** (art. 6 rapporté), le récépissé pouvant prendre jusqu'à un mois | Si elle est exigée **pour vous**, quel formulaire, quelles pièces, et la situation pratique de l'IPDCP en 2026 ; **à faire AVANT l'ouverture des comptes** |
| 3 | **Transfert vers Google (Firebase)** | Les données du compte et du cloud sont traitées par Google (région africa-south1, donc **hors du Togo**) : c'est un **transfert à l'étranger** | Adéquation du pays d'hébergement, nécessité d'une autorisation ou de garanties (art. 29–30 rapportés), clauses contractuelles de Google, information des utilisateurs |
| 4 | **Information et consentement** | La case d'information à l'inscription et l'écran « Mes données » donnent l'**information** (art. 35 rapporté) ; ce n'est **pas** présenté comme un consentement juridique | Le fondement retenu (consentement, exécution du service, intérêt légitime) et la forme requise ; le consentement exprès pour le transfert, si nécessaire |
| 5 | **Données sensibles** | TakarDa ne demande **aucune** donnée sensible (santé, origine, opinions…) ; mais les **notes libres** peuvent en contenir : l'information le déconseille | Si les données financières ou de logement entrent dans une catégorie particulière ; formulation d'avertissement dans les champs de notes |
| 6 | **Droits** | Accès (consultation, export local), rectification (dans l'application ou par le propriétaire), effacement (suppression de compte, d'espace, départ d'un locataire), page de suppression hors application | Délais légaux de réponse ; moyens de preuve de l'identité exigés |
| 7 | **Conservation** | Données du cloud conservées tant que le compte existe ; proposition pour les comptes inactifs ci-dessous | Durée raisonnable au regard de la loi |
| 8 | **Sécurité** | Règles d'accès par compte, e-mail vérifié exigé, chiffrement en transit, arrêt d'urgence ; données locales non chiffrées par l'application | Niveau de sécurité attendu ; obligation éventuelle de notification d'une violation de données |
| 9 | **Âge** | Application pour **adultes** (voir § 4) | Âge de la majorité et du consentement applicable au Togo |

## 3. Exigences de Google Play (indépendantes du droit togolais)
| Exigence | Ce que Google dit | Niveau |
|---|---|---|
| **Suppression de compte** | Une application qui permet de **créer un compte** doit proposer la suppression **dans l'application** et **par un lien Web** où l'on demande la suppression du compte et des données associées, **sans avoir à réinstaller l'application** ; une simple désactivation ne suffit pas | [Google — documenté] |
| **Formulaire « Sécurité des données »** | Obligatoire ; contient les questions de suppression et le lien Web ; doit rester cohérent avec la politique | [Google — documenté] |
| **Politique de confidentialité** | URL publique obligatoire | [Google — documenté] (forme exacte des pages : à relire dans la console) |
| **Test fermé avant production** | Un compte développeur **personnel créé après le 13 novembre 2023** doit mener un **test fermé avec au moins 12 testeurs inscrits en continu pendant au moins 14 jours** avant de demander l'accès à la production ; un compte **d'organisation** est, selon des guides tiers, dispensé | [Google — documenté] pour le compte personnel ; **dispense des comptes d'organisation : [À VÉRIFIER]** ; exigences actuelles à relire sur la page d'aide Google |
| Public cible | À déclarer dans la console | [À VÉRIFIER dans la console] |

## 4. Propositions (à valider par vous ; rien n'est déclaré ni activé)
### 4.1 Comptes inactifs
- **Proposition : 24 mois sans connexion** avant de **considérer** un compte comme à supprimer.
- **Avertissement préalable** : trois courriers à l'adresse du compte, à **J-60, J-30 et J-7** avant la date prévue, rappelant comment conserver le compte (il suffit de se connecter) et comment exporter ses données.
- **Aucune suppression automatique.** Pour un propriétaire qui a des **locataires actifs**, la suppression de son compte coupe leur accès : **revue manuelle obligatoire**, et suppression seulement après **votre accord écrit** à chaque lot.
- **Contrainte technique à connaître** : sur le plan gratuit (sans fonction cloud), TakarDa **ne peut pas** détecter ni supprimer seul les comptes inactifs ; la date de dernière connexion se lit dans la console d'Authentication ou par export. Le processus réaliste est donc une **revue manuelle trimestrielle**, jamais automatique, qui demandera un accès à la production **sur autorisation distincte**.
- La politique (§7) dirait : « conservation tant que le compte existe ; un compte inactif depuis 24 mois peut être supprimé après avertissement par e-mail ».

### 4.2 Public visé et âge minimal
- **Proposition : application destinée aux adultes (18 ans et plus)** — gestion immobilière et financière (loyers, contrats, tontines), sans contenu destiné aux enfants.
- **Google Play** : tranche « 18 ans et plus » à choisir dans la console **seulement après votre validation** ; l'application ne doit pas figurer dans les programmes Familles.
- Vérification de l'âge dans l'application : **aucune** (la politique l'énonce ; l'inscription n'est pas conditionnée à une date de naissance, par minimisation).
- **[À VÉRIFIER]** : l'âge de la majorité au Togo et toute règle particulière sur le consentement des mineurs.

### 4.3 Suppression demandée **hors de l'application**
- **Accusé de réception : sous 3 jours ouvrés.** **Traitement : objectif 14 jours, maximum 30 jours** (réaliste pour un processus manuel ; **[À VÉRIFIER]** s'il existe un délai légal plus court). Confirmation écrite à la fin.
- **Vérification d'identité proportionnée** : la demande doit venir **de l'adresse e-mail du compte** ; on répond à cette adresse en demandant de **confirmer par retour** (« Oui, je confirme ») ; **aucune pièce d'identité n'est demandée**.
- Si l'adresse du compte n'est plus accessible : **deux informations non sensibles** que seul le titulaire connaît (mois approximatif d'inscription, nom d'un espace créé ou rejoint), **sans copie de pièce d'identité**. Si la vérification échoue, la suppression est refusée avec explication (elle est irréversible et protège contre une demande abusive).
- Cas du **locataire** : la fiche d'accès appartient à l'historique du propriétaire ; on traite la suppression du compte du locataire, et on **transmet** la demande d'effacement de la fiche au propriétaire ou on l'applique avec son accord.
- Journal minimal de la demande (date, issue) conservé **[DURÉE À DÉCIDER, ex. 12 mois]**, sans copie du contenu.

## 5. Ce que vous devez faire ou faire faire (je ne peux pas le faire à votre place)
1. **Faire relire cette analyse et la politique par un juriste** familier du droit togolais des données personnelles.
2. **Interroger l'IPDCP** (ou le juriste) sur : champ d'application pour votre exploitation, déclaration à faire, formulaire, délai, **transfert vers Google/Firebase**, et exigences pour le traitement de données de tiers saisies par les propriétaires.
3. **Décider** de la forme juridique sous laquelle vous publiez (personne physique ou entité) : elle détermine le nom du responsable, le type de compte Google Play (personnel ou organisation, avec l'effet sur le test fermé) et le contact.
4. Valider ou modifier les propositions du § 4.

## Sources consultées (secondaires, à confronter au texte officiel)
- [Togo : que dit la loi relative à la protection des données à caractère personnel ? (DMF)](https://droitmediasfinance.com/index.php/actualites/droit-tech-fintech/54-togo-que-dit-la-loi-relative-a-la-protection-des-donnees-a-caractere-personnel)
- [Journal officiel de la République togolaise du 29 octobre 2019 (hébergé par l'AFAPDP)](https://www.afapdp.org/wp-content/uploads/2020/02/TOGO-JOS_29_10_2019-64E-ANNEE-N°26-TER.pdf) — **à lire en entier pour confirmer les points ci-dessus**
- [Protection des données personnelles au Togo : l'IPDCP entame sa mission (Osiris)](https://www.osiris.sn/protection-des-donnees-personnelles-au-togo-l-ipdcp-entame-sa-mission.html)
- [Comprendre les exigences de suppression de compte de Google Play](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Exigences de test des comptes développeur personnels (Google Play)](https://support.google.com/googleplay/android-developer/answer/14151465)
