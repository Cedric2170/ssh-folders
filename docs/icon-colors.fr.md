# Couleurs d'icônes et filtres

[English](icon-colors.en.md)

Hôte et dossier sont **indépendants** (pas d'héritage). **Une** couleur palette par entrée.

**Priorité** : couleur explicite → filtres (`IconColorFilters`, premier match) → icône neutre. **Actif** et **archive système** passent avant la palette.

## Palette (20 noms)

`green`, `blue`, `orange`, `red`, `purple`, `yellow`, `cyan`, `teal`, `magenta`, `pink`, `brown`, `grey`, `lime`, `indigo`, `gold`, `coral`, `olive`, `navy`, `rose`, `amber`.

Alias possibles : `vert`, `bleu`, `rouge`, `violet`, `jaune`, `gris`/`gray`, `marron`, `or`, `corail`, `marine`, `ambre`, `citron`, `turquoise`, etc. (anglais et français).

Teintes via le thème VS Code (pas de hex dans le JSON). **`grey`** : teinte atténuée proche des archives ; vous pouvez l’utiliser dans les filtres (`archive`, `*_old*`). Le style **archive système** (`ArchiveParents`, grisage) prime toujours sur la palette.

## Explicite

~~~json
"defaults": {
  "HostIconColors": { "HEIG-prod": "blue", "Prod": "orange" }
},
"folders": {
  "demo-web": [
    { "path": "/opt/projects/app", "color": "green" }
  ]
},
"local": [
  { "VirtualHost": "Dev", "path": "~/dev", "color": "purple" }
]
~~~

`HostIconColors` : alias SSH ou `VirtualHost` (sans casse). `color` sur chaque entrée dossier.

## Filtres

Tableau ordonné dans `defaults.IconColorFilters`. Critères présents = tous requis (ET). Jokers `*`, `?` sur `name` et `path`.

| Champ | Rôle |
| --- | --- |
| `scope` | `host` ou `folder` (obligatoire) |
| `color` | Palette (obligatoire) |
| `name` | Motif sur alias (hôte : alias ; dossier : alias parent) |
| `path` | Motif sur le chemin complet |
| `favorite` | `true` si entrée favorite |
| `archive` | `true` si archive (`ArchiveParents`, dossiers seulement) |

Exemple :

~~~json
"IconColorFilters": [
  { "scope": "host", "name": "HEIG-*", "color": "purple" },
  { "scope": "host", "favorite": true, "color": "yellow" },
  { "scope": "folder", "favorite": true, "color": "yellow" },
  { "scope": "folder", "archive": true, "color": "grey" },
  { "scope": "folder", "path": "*_old*", "color": "grey" }
]
~~~

L'ordre du tableau tranche (ex. favori vs archive). `HostIconColors["HEIG-prod"]` prime sur un filtre `HEIG-*` pour cet hôte.

Entrée **active** : `sshFolders.activeForeground` dans les réglages éditeur (hors palette JSON).