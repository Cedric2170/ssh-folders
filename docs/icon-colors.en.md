# Icon colors and filters

[Français](icon-colors.fr.md)

Host and folder are **independent** (no inheritance). **One** palette color per entry.

**Priority** : explicit color → filters (`IconColorFilters`, first match) → neutral icon. **Active** and **system archive** beat the palette.

## Palette (20 names)

`green`, `blue`, `orange`, `red`, `purple`, `yellow`, `cyan`, `teal`, `magenta`, `pink`, `brown`, `grey`, `lime`, `indigo`, `gold`, `coral`, `olive`, `navy`, `rose`, `amber`.

Aliases include French forms (`vert`, `bleu`, `gris`/`gray`, `marron`, etc.) and English.

Tints use the VS Code theme (no hex in JSON). **`grey`** is a muted shade close to archives; use it in filters (`archive`, `*_old*`). **System archive** (`ArchiveParents`, gray styling) still wins over the palette.

## Explicit

~~~json
"defaults": {
  "HostIconColors": { "work-prod": "blue", "Prod": "orange" }
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

`HostIconColors` : keys are **host / VirtualHost aliases** only (not folder paths). Exact or pattern (`work*`, `demo*`, case-insensitive) ; JSON order = first matching key.

To color **folders** whose path contains `shared`, use a `path` filter (not `HostIconColors`) :

~~~json
"IconColorFilters": [
  { "scope": "folder", "path": "*shared*", "color": "green" }
]
~~~

## Filters

Ordered array in `defaults.IconColorFilters`. Set criteria must all match (AND). `*`, `?` wildcards on `name` and `path`.

| Field | Role |
| --- | --- |
| `scope` | `host` or `folder` (required) |
| `color` | Palette name (required) |
| `name` | Pattern on alias (host : alias ; folder : parent alias) |
| `path` | Pattern on full path |
| `favorite` | `true` when entry is a favorite |
| `archive` | `true` when archive (`ArchiveParents`, folders only) |

Example :

~~~json
"IconColorFilters": [
  { "scope": "host", "name": "work-*", "color": "purple" },
  { "scope": "host", "favorite": true, "color": "yellow" },
  { "scope": "folder", "favorite": true, "color": "yellow" },
  { "scope": "folder", "archive": true, "color": "grey" },
  { "scope": "folder", "path": "*shared*", "color": "green" },
  { "scope": "folder", "path": "*_old*", "color": "grey" }
]
~~~

Array order decides conflicts (e.g. favorite vs archive). `HostIconColors["work-prod"]` wins over a `work-*` filter for that host.

**Active** entry : editor `sshFolders.activeForeground` (not JSON palette).