# Architecture Technique

## Vue d'ensemble

Le projet a été refondu d'une architecture monolithique (fichier unique HTML+JS+CSS) vers une structure modulaire standard utilisant les modules ES6. Cette approche améliore la maintenabilité, la lisibilité et la collaboration sans nécessiter d'outils de build complexes (comme Webpack ou Vite) pour l'exécution basique.

## Structure du Projet

```
/
├── index.html              # Point d'entrée de l'application
├── css/
│   └── style.css           # Feuilles de style (extraites du monolithe)
├── js/
│   ├── main.js             # Point d'entrée JavaScript (bootstrapping)
│   ├── config.js           # Configuration globale (ex: logos, constantes)
│   ├── data/               # Données statiques volumineuses
│   │   ├── pena.js         # Points d'Eau (PENA)
│   │   ├── dz.js           # Drop Zones
│   │   ├── pistes.js       # Pistes DFCI
│   │   └── carro.js        # Carroyage DFCI
│   └── modules/            # (Futur) Modules fonctionnels
└── docs/                   # Documentation du projet
```

## Choix Techniques

### HTML5 & CSS3

L'interface utilise du HTML5 sémantique et du CSS3 natif. Le design "Glassmorphism" et le mode sombre sont gérés via des variables CSS et des classes utilitaires dans `css/style.css`.

### JavaScript (ES Modules)

Le code logique est chargé via `<script type="module" src="js/main.js">`. Cela permet d'importer les fichiers de données directement (`import { PENA_REAL } from './data/pena.js'`) plutôt que de polluer l'espace de noms global.

### Cartographie

La carte interactive repose sur **Leaflet**. Les couches de données (Pistes, Citernes, ALCI) sont gérées sous forme de GeoJSON ou de tableaux JavaScript convertis en marqueurs/polylignes Leaflet.

### Persistance

Les données locales (fiches patrouilles, photos, configuration SOS) sont stockées dans le `localStorage` du navigateur avec le préfixe `pyrovigil_`.
