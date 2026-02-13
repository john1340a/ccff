# Manuel d'Installation et Utilisation

## Installation

### Prérequis

- Un navigateur web moderne (Chrome, Firefox, Safari, Edge).
- Pour le développement local : un serveur web local (obligatoire pour les modules ES6).

### Lancement Local

L'application ne peut pas être ouverte directement via `file://` à cause des politiques de sécurité CORS des navigateurs concernant les modules JavaScript.

1.  **Avec Python** (installé par défaut sur macOS/Linux, et souvent Windows) :

    ```bash
    # Depuis le dossier racine du projet
    python -m http.server 8000
    ```

    Ouvrez `http://localhost:8000` dans votre navigateur.

2.  **Avec Node.js** :

    ```bash
    npx serve
    ```

3.  **Avec VS Code** :
    Utilisez l'extension "Live Server" et cliquez sur "Go Live".

## Utilisation

### Connexion

L'application propose deux modes d'accès :

- **Département (Admin)** : Accès global à toutes les communes.
- **Commune** : Accès restreint aux données d'une commune spécifique.
  Entrez simplement le code d'accès correspondant.

### Fonctionnalités Principales

#### Carte Interactive

Affiche les pistes DFCI, points d'eau (PENA), zones de poser hélicoptère (DZ) et la position des patrouilles.

- **Filtrer** : Utilisez les boutons en haut pour masquer/afficher des couches.
- **Centrer** : Le bouton de géolocalisation centre la carte sur votre position GPS.

#### Création de Mission

Depuis l'onglet "Missions", vous pouvez :

- Déclarer une prise de service (Patrouille).
- Signaler un départ de feu.
- Créer une fiche de liaison.

#### Mode Hors Ligne

L'application met en cache les ressources nécessaires. Une fois chargée avec du réseau, elle reste fonctionnelle (hors fond de carte en ligne) même sans connexion Internet.
