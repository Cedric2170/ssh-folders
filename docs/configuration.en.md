# `ssh-folders.json` configuration

[Français](configuration.fr.md)

File : `~/.ssh/extensions/ssh-folders.json` (`sshFolders.configPath` for another path). Schema : `remote-folders.schema.json` (copied on first launch). Open : **{}** button or *Open folders config*. Missing `defaults` keys are added without overwriting existing values.

## Structure

| Key | Role |
| --- | --- |
| `defaults` | Global options |
| `local[]` | Local folders by `VirtualHost` |
| `folders` | SSH `Host` alias → remote folders |

`folders` keys match SSH `Host` aliases (not `HostName`). Case-only differences = same host.

## Folder entries

**Remote** (`folders.<alias>[]`) : required `path` (`/...`, no `~`); optional `label`, `favorite`, `color` (palette).

**Local** (`local[]`) : required `VirtualHost` and `path` (`~/...` or absolute); optional `label`, `favorite`, `color`. Multiple rows may share a `VirtualHost`.

`favorite: true` : top under host, Favorites group in A-Z view, still in the normal list.

## `defaults`

| Key | Default | Effect |
| --- | --- | --- |
| `DefaultFolder` | `""` | Suggestion for `+` and labels ; empty = unset ; no open on host click. |
| `RecentLimit` | `20` | Recent view size (1–100). |
| `SortAlphabetical` | `true` | A-Z sort (except recent view). |
| `GroupSameName` | `true` | Group name families in A-Z view. |
| `HiddenHosts` | `[]` | Hidden aliases ; `*`, `?` ; case-insensitive. |
| `FavoriteHosts` | `[]` | Hosts / VirtualHosts at top of by-host view. |
| `LastFolder` | `Projects`, `_old` | Labels at list end (array order). |
| `ArchiveParents` | `_old`, `old` | Path's **immediate** parent name = archive (grayed, end, separate A-Z). Folder `…/_old` itself is not archive. |
| `VirtualHostPosition` | `alphabet` | `alphabet` \| `top` \| `bottom` ; favorites always first. |
| `ActiveColor` | `green` | Kept in JSON ; **no effect** (see active color below). |

`HiddenHosts` removes the host ; `FavoriteHosts` only affects order.

## Active entry color

Not in JSON : `workbench.colorCustomizations` → `sshFolders.activeForeground` (open connection or folder in this window).

## Icon palette colors

[icon-colors.en.md](icon-colors.en.md)

Full sample : [examples/ssh-folders.example.json](../examples/ssh-folders.example.json)