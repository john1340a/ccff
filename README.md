# 🔥 CCFF du VAR — PyroVigil

> **Application web de terrain pour les Comités Communaux Feux de Forêts du Var (83)**
>
> Version : `v3.5` · Dernière mise à jour : Février 2026

---

## 📋 Sommaire

- [Présentation](#-présentation)
- [Fonctionnalités](#-fonctionnalités)
- [Architecture technique](#-architecture-technique)
- [Données embarquées](#-données-embarquées)
- [Authentification](#-authentification)
- [Carte interactive](#-carte-interactive)
- [Système de risque préfectoral](#-système-de-risque-préfectoral)
- [Navigation GPS / Guidage](#-navigation-gps--guidage)
- [Alerte SOS](#-alerte-sos)
- [Gestion des véhicules](#-gestion-des-véhicules)
- [Modules métier](#-modules-métier)
- [Persistance des données](#-persistance-des-données)
- [Installation et déploiement](#-installation-et-déploiement)
- [Contact](#-contact)

---

## 🎯 Présentation

**PyroVigil — CCFF du VAR** est une application web mono-fichier destinée aux **bénévoles CCFF** (Comités Communaux Feux de Forêts) du département du **Var (83)**.

Elle centralise sur une **carte interactive** toutes les données opérationnelles nécessaires à la **prévention et surveillance des incendies de forêts** : points d'eau, pistes forestières, drop zones hélicoptères, niveaux de risque préfectoraux, suivi GPS des patrouilles, et alertes SOS.

### Utilisateurs cibles

| Profil          | Accès                                  | Description                             |
| --------------- | -------------------------------------- | --------------------------------------- |
| **Département** | Code unique (ex: `AD83VAR2026`)        | Vue globale sur les 153 communes du Var |
| **Commune**     | Code généré par commune (ex: `CC1234`) | Vue restreinte à la commune connectée   |

### Contexte d'utilisation

- **Saison** : mi-juin → fin septembre (période de risque feux de forêts)
- **Terrain** : patrouilles mobiles à pied ou en véhicule CCFF
- **Appareil** : optimisé pour **smartphone** (responsive, pas de zoom utilisateur)
- **Réseau** : fonctionne **hors connexion** une fois chargé (données embarquées + localStorage)

---

## ✨ Fonctionnalités

### Vue d'ensemble

| Module      | Icône | Description                                                         |
| ----------- | ----- | ------------------------------------------------------------------- |
| Carte       | 🗺️    | Carte Leaflet multi-couches avec toutes les données opérationnelles |
| Dashboard   | 📊    | Tableau de bord avec statistiques et synthèse risque                |
| Communes    | 🏘️    | Annuaire des 153 communes (accès département)                       |
| Patrouilles | 🚒    | Liste et suivi en temps réel des véhicules de patrouille            |
| Véhicules   | 🚗    | Gestion du parc de véhicules CCFF                                   |
| Missions    | 🎯    | Ordres de mission (feu, lever de doute, surveillance)               |
| Saisie      | 📝    | Formulaire de saisie terrain (fiches patrouille)                    |
| Historique  | 📚    | Historique des fiches et données saisies                            |
| Relevés     | 📸    | Photos et relevés terrain géolocalisés                              |
| Risque      | ⚠️    | Niveaux de risque préfectoraux par massif                           |
| SOS Tél.    | 📱    | Configuration des numéros d'urgence SOS                             |
| Codes       | 🔑    | Répertoire des codes d'accès communaux                              |

---

## 🏗️ Architecture technique

### Stack technologique

| Composant        | Technologie                                                        |
| ---------------- | ------------------------------------------------------------------ |
| **Structure**    | HTML5 mono-fichier (`ccff_du_var_v3_5.html`, ~2275 lignes, ~2 Mo)  |
| **Style**        | CSS inline (dark mode, design "urgence" rouge/noir)                |
| **Logique**      | JavaScript vanilla embarqué                                        |
| **Cartographie** | [Leaflet 1.9.4](https://leafletjs.com/) (CDN)                      |
| **Typographies** | Google Fonts : `DM Sans` (texte), `Space Grotesk` (titres/données) |
| **Persistance**  | `localStorage` (préfixe `pyrovigil_`)                              |
| **Données géo**  | Fichiers GeoJSON locaux + données JSON inline                      |

### Structure du projet

```
projetappliccff/
├── ccff_du_var_v3_5.html     # Application principale (HTML + CSS + JS)
├── PENA83.geojson             # Points d'Eau Naturels et Artificiels (1924 points)
├── dz83.geojson               # Drop Zones hélicoptères (647 zones)
├── pistesDFCI83.geojson       # Pistes forestières DFCI (4047 pistes)
├── carro83.geojson            # Carroyage DFCI (grille 2km × 2km)
├── Mmeteo83.geojson           # Données météorologiques
└── README.md                  # Ce fichier
```

### Organisation du code JavaScript

Le code est structuré en sections clairement délimitées :

```
1. DONNÉES INLINE      — PENA_REAL, DZ_REAL, PISTES_REAL, CARRO_REAL, etc.
2. DATA                — Communes (CD), Massifs, Niveaux de risque (RLVL)
3. STATE               — Variables d'état globales
4. DATA PERSISTENCE    — Fonctions localStorage (dbSave, dbLoad, dbAppend)
5. AUTH                — Authentification (doLogin, logout)
6. APP INIT            — Initialisation de l'application
7. MAP                 — Carte Leaflet et couches
8. RISQUE TAB          — Onglet risque préfectoral
9. GEOLOCATION         — Suivi GPS en temps réel
10. SOS                — Système d'alerte d'urgence
11. NAVIGATION         — Guidage GPS multi-modes
12. DASHBOARD          — Tableau de bord
13. COMMUNES           — Liste des communes (dept)
14. PATROUILLES        — Suivi des véhicules de patrouille
15. VÉHICULES          — Gestion du parc véhicules
16. MISSIONS           — Ordres de mission
17. SAISIE             — Formulaires de saisie terrain
18. HISTORIQUE         — Historique et recherche
19. PHOTOS / RELEVÉS   — Photos terrain, zones brûlées, départs de feu
```

---

## 📦 Données embarquées

### Sources des données

Les données proviennent du **SDIS 83** (Service Départemental d'Incendie et de Secours) et de l'**ONF** (Office National des Forêts), avec une conversion Lambert 93 → WGS84.

### Détail des jeux de données

| Fichier                | Type   | Quantité    | Description                                                                                                                                                                                                                          |
| ---------------------- | ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PENA83.geojson`       | Points | **1 924**   | Points d'Eau Naturels et Artificiels — citernes fixes (CF), citernes enterrées (CE), réserves incendie (RI), retenues (RE), plans d'eau (PE), cours d'eau (CE2), puisards (PU). Inclut capacité (m³), disponibilité, référence DFCI. |
| `dz83.geojson`         | Points | **647**     | Drop Zones pour hélicoptères — nom, revêtement, coordonnées.                                                                                                                                                                         |
| `pistesDFCI83.geojson` | Lignes | **4 047**   | Pistes forestières DFCI — catégorisées (1 : principale, 2 : secondaire, 3 : tertiaire, 9 : autre).                                                                                                                                   |
| `carro83.geojson`      | Grille | **~16 118** | Carroyage DFCI — maillage de carrés 2km × 2km avec codes (ex: `KD80C4`).                                                                                                                                                             |
| `Mmeteo83.geojson`     | Points | Variable    | Données météorologiques départementales.                                                                                                                                                                                             |

### Données inline (dans le HTML)

- **153 communes** du Var avec coordonnées GPS
- **9 massifs préfectoraux** avec liste des communes rattachées
- **5 niveaux de risque** : Vert, Jaune, Orange, Rouge, Noir
- **Codes DFCI** des communes (table de correspondance)
- **Logo PyroVigil** en base64

---

## 🔐 Authentification

### Deux niveaux d'accès

#### Accès Département

- **Code** : `AD83VAR2026`
- **Droits** : vision globale sur toutes les communes, gestion des niveaux de risque par massif, accès à l'onglet Communes

#### Accès Commune

- **Code** : généré automatiquement par hash du nom de la commune (ex: `CC1234` pour Toulon)
- **Droits** : vue restreinte aux données de la commune connectée

### Fonctionnement

1. L'utilisateur saisit son code d'accès sur l'écran de connexion
2. Le code est vérifié localement (pas de serveur)
3. Si valide, l'interface principale s'affiche avec les permissions adaptées
4. La déconnexion réinitialise l'état et détruit la carte

---

## 🗺️ Carte interactive

### Fonds de carte

| Fond         | Source               | Description                                  |
| ------------ | -------------------- | -------------------------------------------- |
| **Topo IGN** | Géoplateforme (WMTS) | Carte topographique IGN Plan v2 (par défaut) |
| **Ortho**    | Géoplateforme (WMTS) | Orthophotographie aérienne IGN               |
| **OSM**      | OpenStreetMap        | Carte communautaire OpenStreetMap            |

### Couches de données superposées

Chaque couche peut être activée/désactivée indépendamment :

| Couche           | Icône | Description                                           | Comportement selon le zoom    |
| ---------------- | ----- | ----------------------------------------------------- | ----------------------------- |
| **Risque météo** | ⚠️    | Polygones colorés des 9 massifs avec niveau de risque | Labels à partir du zoom 10    |
| **Patrouilles**  | 🚒    | Véhicules CCFF en temps réel (icônes SVG orientées)   | Taille et label adaptatifs    |
| **PENA**         | 💧    | Points d'eau (cercles cyan/rouge selon disponibilité) | Limités à 300 au dézoom       |
| **DZ héli**      | 🚁    | Drop zones hélicoptères (marqueurs emoji)             | Filtrées par viewport         |
| **Pistes DFCI**  | 🛤️    | Pistes forestières colorées par catégorie             | Cat. 1-2 seules en dézoom     |
| **Grille DFCI**  | 📐    | Carroyage DFCI (rectangles + labels)                  | Labels permanents au zoom 12+ |

### Interactivité

- **Clic sur la carte** : affiche le code DFCI du carreau le plus proche avec lien Waze
- **Popups** : chaque élément dispose d'un popup détaillé avec lien de navigation GPS
- **Ma position** : cercle rouge pulsant avec coordonnées et altitude

---

## ⚠️ Système de risque préfectoral

### 9 massifs officiels

| ID  | Massif              | Communes principales                                     |
| --- | ------------------- | -------------------------------------------------------- |
| 1   | Monts Toulonnais    | Toulon, La Seyne-sur-Mer, Six-Fours, Sanary, Bandol...   |
| 2   | Sainte-Baume        | Saint-Maximin, Nans-les-Pins, Plan-d'Aups, Mazaugues...  |
| 3   | Haut Var            | Draguignan, Salernes, Aups, Villecroze, Lorgues...       |
| 4   | Corniche des Maures | Bormes-les-Mimosas, Le Lavandou, La Londe, Hyères...     |
| 5   | Maures              | Le Cannet-des-Maures, Grimaud, Cogolin, Saint-Tropez...  |
| 6   | Centre Var          | Brignoles, Le Val, Cuers, Puget-Ville, Carnoules...      |
| 7   | Plateau de Canjuers | Comps-sur-Artuby, Trigance, Bargemon, Aiguines...        |
| 8   | Estérel             | Fréjus, Saint-Raphaël, Roquebrune-sur-Argens, Fayence... |
| 9   | Îles d'Hyères       | Hyères                                                   |

### 5 niveaux de risque

| Niveau     | Couleur | Accès                 | Travaux                       |
| ---------- | ------- | --------------------- | ----------------------------- |
| **Vert**   | 🟢      | Autorisé              | Autorisés                     |
| **Jaune**  | 🟡      | Autorisé              | Avec dispositif de prévention |
| **Orange** | 🟠      | Déconseillé           | À risque interdits            |
| **Rouge**  | 🔴      | Interdit (hors ZAPEF) | Interdits                     |
| **Noir**   | 🟣      | Interdit              | Interdits — EXTRÊME vigilance |

> **Note** : En saison (mi-juin → fin septembre), les niveaux sont mis à jour quotidiennement selon la carte préfectorale. Hors saison, ils sont réglables manuellement (accès département uniquement).
>
> Source : [risque-prevention-incendie.fr/var](https://www.risque-prevention-incendie.fr/var/)

---

## 🧭 Navigation GPS / Guidage

Le panneau de navigation en bas de carte propose 4 modes :

| Mode        | Icône | Saisie               | Exemple                |
| ----------- | ----- | -------------------- | ---------------------- |
| **GPS**     | 📍    | Coordonnées lat, lon | `43.4534, 6.2345`      |
| **DFCI**    | 📐    | Code carreau DFCI    | `KD80C4` ou `KD48E8.5` |
| **Adresse** | 🏠    | Texte libre          | `Mairie de Toulon`     |
| **PENA**    | 💧    | Nom ou code citerne  | `BST 7` ou `KD80C4`    |

### Applications de navigation

Après avoir identifié une cible, l'utilisateur peut lancer la navigation vers :

- **Waze** (🧭)
- **Google Maps** (🗺️)
- **OpenStreetMap / OSRM** (🌍)
- **Pistes DFCI** (🛤️) : surligne les pistes forestières dans le corridor entre la position actuelle et la destination

---

## 🚨 Alerte SOS

### Fonctionnement

1. L'utilisateur appuie sur le bouton **🚨 SOS** dans le header
2. Un **compte à rebours de 10 secondes** démarre avec barre de progression
3. L'utilisateur peut **annuler** pendant le décompte (protection contre les faux déclenchements)
4. Si non annulé, l'alerte est envoyée :
   - La position GPS est enregistrée
   - Les numéros SOS configurés pour la commune sont alertés
   - Le composeur téléphonique s'ouvre automatiquement (mobile)
   - Une mission de type `inter_feu` est créée automatiquement

### Configuration

Les numéros SOS sont configurables par commune via l'onglet **📱 SOS Tél.** (jusqu'à 3 numéros par commune).

---

## 🚗 Gestion des véhicules

### Types de véhicules

| Code       | Type                               |
| ---------- | ---------------------------------- |
| VL         | Véhicule léger                     |
| VLHR       | Véhicule léger hors route          |
| CCFM       | Camion citerne feux de forêt moyen |
| CCFL       | Camion citerne feux de forêt léger |
| Pick-up    | Pick-up                            |
| Quad / SSV | Quad ou Side-by-Side               |
| Autre      | Véhicule divers                    |

### Statuts

| Statut           | Transitions possibles                            |
| ---------------- | ------------------------------------------------ |
| ✅ Disponible    | En patrouille, Garage, Maintenance, Hors service |
| 🚒 En patrouille | Disponible, Garage, Maintenance                  |
| 🏠 Au garage     | Disponible, Maintenance, Hors service            |
| 🔧 Maintenance   | Disponible, Garage, Hors service                 |
| ⛔ Hors service  | Disponible, Maintenance, Réserve                 |
| 📦 Réserve       | Disponible, Maintenance                          |

### Caractéristiques enregistrées

- Immatriculation, type, numéro CCFF (1 = président, 2-8 = équipages)
- Commune d'affectation et code DFCI associé
- Marque/modèle, année, kilométrage
- Date de contrôle technique et d'expiration d'assurance (alertes à J-30)
- Notes libres
- Historique complet des changements de statut

---

## 📝 Modules métier

### Saisie terrain

Formulaire de fiche patrouille incluant :

- Date, heure, commune, chef de patrouille
- Numéro de véhicule, immatriculation
- Niveau de risque, observations
- Coordonnées GPS automatiques
- Lien avec le véhicule enregistré

### Photos et relevés

- **Photos terrain** géolocalisées
- **Zones brûlées** (relevé de surfaces)
- **Départs de feu** (pointage GPS)

### Missions

Trois types de missions :

- 🔥 **Feu** : intervention sur feu déclaré
- 🔎 **Lever de doute** : vérification d'un signalement
- 👁️ **Surveillance** : patrouille préventive

---

## 💾 Persistance des données

Toutes les données saisies sont stockées en `localStorage` avec le préfixe `pyrovigil_` :

| Clé                    | Contenu                   |
| ---------------------- | ------------------------- |
| `pyrovigil_patrols`    | Fiches de patrouille      |
| `pyrovigil_photos`     | Photos et relevés terrain |
| `pyrovigil_burned`     | Zones brûlées             |
| `pyrovigil_firestarts` | Points de départ de feu   |
| `pyrovigil_gpstracks`  | Traces GPS enregistrées   |
| `pyrovigil_fleet`      | Parc de véhicules         |

> ⚠️ **Attention** : les données `localStorage` sont liées au navigateur et au domaine. Un changement de navigateur ou un nettoyage des données entraîne la perte des saisies.

---

## 🚀 Installation et déploiement

### Prérequis

- Un navigateur web moderne (Chrome, Firefox, Safari, Edge)
- Aucun serveur requis — l'application fonctionne en local

### Utilisation locale

1. Placer tous les fichiers dans le même dossier
2. Ouvrir `ccff_du_var_v3_5.html` dans un navigateur
3. Se connecter avec un code d'accès

### Déploiement web

1. Héberger tous les fichiers sur un serveur web statique
2. S'assurer que les fichiers `.geojson` sont servis avec le bon content-type (`application/geo+json`)
3. Activer HTTPS pour la géolocalisation (obligatoire sur mobile)

### Codes de démo

| Accès       | Code                             |
| ----------- | -------------------------------- |
| Département | `AD83VAR2026`                    |
| Toulon      | Affiché sur l'écran de connexion |
| Fréjus      | Affiché sur l'écran de connexion |
| Draguignan  | Affiché sur l'écran de connexion |

---

## 📞 Contact

**PyroVigil** — Forest Fire Protect

- 📞 06.51.37.86.10
- ✉️ contact@pyrovigil.fr
- 🌐 pyrovigil.fr
