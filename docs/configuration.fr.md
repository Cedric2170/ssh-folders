# Configuration `ssh-folders.json`

[English](configuration.en.md)

Fichier : `~/.ssh/extensions/ssh-folders.json` (`sshFolders.configPath` pour un autre chemin). Schéma : `remote-folders.schema.json` (copié au premier lancement). Ouverture : bouton **{}** ou *Ouvrir la config des dossiers*. Les clés `defaults` manquantes sont ajoutées sans écraser l'existant.

## Structure

| Clé | Rôle |
| --- | --- |
| `defaults` | Options globales |
| `local[]` | Dossiers locaux par `VirtualHost` |
| `folders` | Alias `Host` SSH → dossiers distants |

Clé `folders` = alias du `Host` SSH (pas `HostName`). Alias identiques à la casse près = même hôte.

## Entrées dossier

**Distant** (`folders.<alias>[]`) : `path` obligatoire (`/...`, pas de `~`) ; `label`, `favorite`, `color` (palette) optionnels.

**Local** (`local[]`) : `VirtualHost` et `path` obligatoires (`~/...` ou absolu) ; `label`, `favorite`, `color` optionnels. Plusieurs lignes peuvent partager un `VirtualHost`.

`favorite: true` : en tête sous l'hôte, groupe Favoris en vue A-Z, reste dans la liste normale.

## `defaults`

| Clé | Défaut | Effet |
| --- | --- | --- |
| `DefaultFolder` | `""` | Proposition au `+` et pour le libellé ; vide = rien ; pas d'ouverture au clic hôte. |
| `RecentLimit` | `20` | Vue derniers accès (1–100). |
| `SortAlphabetical` | `true` | Tri A-Z (sauf derniers accès). |
| `GroupSameName` | `true` | Regroupement familles de noms en vue A-Z. |
| `HiddenHosts` | `[]` | Alias masqués ; `*`, `?` ; sans casse. |
| `FavoriteHosts` | `[]` | Hôtes / VirtualHost en tête (vue par hôte). |
| `LastFolder` | `Projects`, `_old` | Libellés en fin de liste (ordre du tableau). |
| `ArchiveParents` | `_old`, `old` | Parent **immédiat** du chemin = archive (grisé, fin, A-Z séparé). Le dossier `…/_old` lui-même n'est pas archive. |
| `VirtualHostPosition` | `alphabet` | `alphabet` \| `top` \| `bottom` ; favoris toujours en tête. |
| `ActiveColor` | `green` | Conservé dans le JSON ; **sans effet** (voir couleur active ci-dessous). |

`HiddenHosts` retire l'hôte ; `FavoriteHosts` ne fait que l'ordre d'affichage.

## Couleur d'entrée active

Hors JSON : `workbench.colorCustomizations` → `sshFolders.activeForeground` (connexion ou dossier ouvert dans la fenêtre).

## Couleurs d'icônes (palette)

[icon-colors.fr.md](icon-colors.fr.md)

Exemple complet : [examples/ssh-folders.example.json](../examples/ssh-folders.example.json)