# Interface Utilisateur (UI/UX)

## Design System

L'application utilise une esthétique "Sombre / Contraste Élevé" adaptée à l'usage sur le terrain, notamment de nuit ou en plein soleil.

- **Fond** : Gris ardoise foncé (`#0f172a`) pour réduire la fatigue visuelle.
- **Accents** : Couleurs vives pour les états critiques (Rouge `#ef4444` pour le danger, Orange `#f97316` pour les alertes).
- **Typographie** : utilisation de `Space Grotesk` pour les titres (lisibilité technique) et `DM Sans` pour le corps de texte.

## Icônes : Material Symbols

Le projet a migré des émojis vers **Google Material Symbols** pour assurer une cohérence visuelle professionnelle.

### Intégration

Les icônes sont chargées via la police web `Material Symbols Outlined`.
Exemple d'utilisation HTML :

```html
<span class="material-symbols-outlined">local_fire_department</span>
```

### Correspondances principales

| Concept                   | Ancienne Icône (Emoji) | Nouvelle Icône (Material Symbol)     |
| :------------------------ | :--------------------- | :----------------------------------- |
| **Feu / Incendie**        | 🔥                     | `local_fire_department`              |
| **Patrouille / Véhicule** | 🚒                     | `local_shipping` ou `directions_car` |
| **Validation**            | ✅                     | `check_circle`                       |
| **Alerte / Danger**       | ⚠️                     | `warning`                            |
| **Localisation**          | 📍                     | `place` ou `my_location`             |
| **Photo**                 | 📸                     | `photo_camera`                       |
| **Carte**                 | 🗺️                     | `map`                                |

## Composants UI

### Cartes (Cards)

Les éléments d'information sont regroupés dans des conteneurs avec un fond semi-transparent et une bordure gauche colorée indiquant le statut (ex: bordure rouge pour une alerte).

### Modales

Les interactions complexes (Détails véhicule, Configuration SOS) s'ouvrent dans des fenêtres modales plein écran sur mobile, avec un bouton de fermeture explicite.
