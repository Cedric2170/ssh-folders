# SSH - Folders

Liste les hôtes SSH et des dossiers distants favoris. Remote-SSH ouvre la connexion.

[English version at the bottom of this page.](#english)

## Français

### Fonctionnalités

- Les hôtes viennent du fichier SSH config (`~/.ssh/config`, ou `remote.SSH.configFile` s'il est défini).
- Un clic sur un hôte ou un dossier demande à Remote-SSH d'ouvrir la connexion.
- Les dossiers favoris s'ajoutent, se renomment et se suppriment depuis l'arbre.
- Chaque entrée s'ouvre dans la fenêtre courante ou dans une nouvelle fenêtre.
- La vue par hôte place les dossiers sous chaque hôte.
- La vue dossiers A-Z trie les noms et regroupe une même famille (`grafana` et `grafana-dev` sous Grafana).
- La vue derniers accès liste les connexions récentes. Retirer une entrée n'efface pas le favori.
- Un bouton en haut de l'arbre passe d'une vue à l'autre.
- Un dossier par défaut s'ouvre au clic sur l'hôte, à la place d'une fenêtre distante vide.

### Installation

Dans VS Code, ouvre Extensions et cherche `cedric217.ssh-folders`.

L'extension Remote - SSH doit être installée : c'est elle qui ouvre la session.

### Configuration

Les favoris sont dans `~/.ssh/extensions/ssh-folders.json`. L'extension y copie aussi le schéma `remote-folders.schema.json`.

La clé (`myserver` dans l'exemple) est l'alias de la ligne `Host` dans `~/.ssh/config`, pas le nom DNS (`HostName`). La casse est ignorée : `MyServer` et `myserver` désignent le même hôte. La connexion utilise l'orthographe du fichier SSH config.

~~~json
{
  "$schema": "./remote-folders.schema.json",
  "defaults": {
    "DefaultFolder": "/opt/docker/projects",
    "RecentLimit": 20
  },
  "folders": {
    "myserver": [
      {
        "path": "/opt/docker/projects",
        "label": "Projects"
      },
      {
        "path": "/opt/docker/projects/grafana",
        "label": "Grafana"
      }
    ]
  }
}
~~~

Chaque objet est un dossier de cet hôte. `path` est le chemin distant, `label` le nom affiché. Plusieurs objets sont plusieurs favoris du même hôte. Si `label` est absent, le nom du dossier est utilisé.

Le chemin est POSIX et absolu (`/...`).

`defaults.DefaultFolder` sert à tous les hôtes. Le bouton + préremplit le chemin avec cette valeur, et propose comme nom la partie qui suit ce dossier. Exemple : `/opt/docker/projects/grafana` donne `grafana`.

`defaults.RecentLimit` fixe la taille de la vue derniers accès (20 par défaut, de 1 à 100). L'historique est gardé par l'éditeur, pas dans ce JSON.

Autre emplacement du fichier de favoris : le réglage `sshFolders.configPath`.

## English

### Features

- Hosts come from the SSH config file (`~/.ssh/config`, or `remote.SSH.configFile` when that setting is set).
- A click on a host or a folder asks Remote-SSH to open the connection.
- Favorite folders can be added, renamed, and removed from the tree.
- Each entry opens in the current window or in a new window.
- The by-host view lists folders under each host.
- The A-Z view sorts names and groups a family together (`grafana` and `grafana-dev` under Grafana).
- The recent view lists the latest connections. Removing an entry does not delete the favorite.
- A button at the top of the tree switches from one view to the next.
- A default folder opens when you click a host, instead of an empty remote window.

### Installation

In VS Code, open Extensions and search for `cedric217.ssh-folders`.

The Remote - SSH extension must be installed: it is the one that opens the session.

### Configuration

Favorites live in `~/.ssh/extensions/ssh-folders.json`. The extension also copies the `remote-folders.schema.json` schema next to that file.

The key (`myserver` in the example) is the `Host` alias from `~/.ssh/config`, not the DNS name (`HostName`). Case is ignored: `MyServer` and `myserver` are the same host. The connection uses the spelling from the SSH config file.

~~~json
{
  "$schema": "./remote-folders.schema.json",
  "defaults": {
    "DefaultFolder": "/opt/docker/projects",
    "RecentLimit": 20
  },
  "folders": {
    "myserver": [
      {
        "path": "/opt/docker/projects",
        "label": "Projects"
      },
      {
        "path": "/opt/docker/projects/grafana",
        "label": "Grafana"
      }
    ]
  }
}
~~~

Each object is one folder on that host. `path` is the remote path, `label` is the name shown. Several objects are several favorites of the same host. If `label` is missing, the folder name is used.

The path is POSIX and absolute (`/...`).

`defaults.DefaultFolder` applies to every host. The + button prefills the path with that value and suggests the name from the part that follows this folder. Example: `/opt/docker/projects/grafana` becomes `grafana`.

`defaults.RecentLimit` sets the size of the recent view (20 by default, from 1 to 100). History is stored by the editor, not in this JSON file.

To store favorites elsewhere, set `sshFolders.configPath`.
