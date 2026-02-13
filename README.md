# CCFF du VAR - PyroVigil

> Application web de terrain pour les Comites Communaux Feux de Forets du Var (83)
> Version : v3.5 - Fevrier 2026

---

## Sommaire

1.  [Presentation](#presentation)
2.  [Documentation](#documentation)
3.  [Fonctionnalites](#fonctionnalites)
4.  [Installation](#installation)
5.  [Architecture](#architecture)
6.  [Contact](#contact)

---

## Presentation

**PyroVigil - CCFF du VAR** est une application web destinee aux **benevoles CCFF** du departement du **Var**.

Elle centralise sur une carte interactive toutes les donnees operationnelles necessaires a la prevention et surveillance des incendies de forets : points d'eau, pistes forestieres, zones helicopteres (DZ), niveaux de risque, suivi GPS des patrouilles et alertes SOS.

## Documentation

La documentation detaillee se trouve dans le dossier `docs/` :

- [Manuel d'Installation et Utilisation](docs/manual.md) : Guide pour lancer et utiliser l'application.
- [Architecture Technique](docs/architecture.md) : Structure du code, modules et choix techniques.
- [Interface Utilisateur (UI)](docs/ui.md) : Design system, icones et composants graphiques.

## Fonctionnalites

- **Carte Interactive** : Visualisation des pistes DFCI, citernes, et autres points d'interet.
- **Geolocalisation** : Suivi en temps reel de la position des patrouilles.
- **Missions** : Gestion des ordres de mission et rapports de patrouille.
- **Releves Terrain** : Prise de photos geolocalisees et signalement de zones brulees.
- **Alte SOS** : Systeme d'alerte d'urgence avec transmission de position GPS.
- **Mode Hors Ligne** : Fonctionnement degrade sans connexion internet.

## Installation

L'application utilise des modules ES6 modernes. Elle necessite d'etre servie via un serveur HTTP local pour fonctionner correctement (ne pas ouvrir directement le fichier via `file://`).

Exemple de lancement avec Python :

```bash
python -m http.server
```

Puis ouvrez votre navigateur a l'adresse indiquee (generalement `http://localhost:8000`).

## Architecture

Le projet a ete refondu pour adopter une structure modulaire :

- **index.html** : Structure DOM minimale.
- **css/style.css** : Feuilles de style complètes.
- **js/main.js** : Logique principale et chargement des modules.
- **js/data/** : Fichiers de données statiques (PENA, DFCI, etc.).

Pour plus de détails, consultez [docs/architecture.md](docs/architecture.md).

## Contact

Pour toute question technique ou demande de support, veuillez vous referer aux responsables du projet ou consulter la documentation.
