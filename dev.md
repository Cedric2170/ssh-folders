# SSH - Folders

Extension Cursor / VS Code par Cédric Baertschi.

Affiche les hôtes de votre fichier SSH config et des dossiers distants favoris.
Remote-SSH se charge de la connexion.

Le fichier [README.md](README.md) est la page publique (Marketplace et Open VSX).
Ce document reste local : il est exclu du paquet.

## Installer dans Cursor

1. Dans le dossier du projet, construire le paquet :

   ~~~bash
   npm install
   npm run package
   ~~~

2. Installer le `.vsix` généré dans le dossier [`vsix/`](vsix/) (exemple :
   `vsix/ssh-folders-0.2.4.vsix`) :

   ~~~bash
   cursor --install-extension vsix/ssh-folders-0.2.4.vsix
   ~~~

   Ou dans Cursor : palette de commandes (`Cmd+Shift+P`) puis
   **Extensions: Install from VSIX...**

3. Recharger Cursor (`Developer: Reload Window`). L'icône **SSH - Folders**
   apparaît dans la barre d'activité, sans passer par F5.

Pour mettre à jour après un changement de code : `npm run package`, puis
réinstaller le nouveau fichier sous `vsix/`.

Les paquets `.vsix` (historique et futurs builds) restent dans `vsix/`, pas à
la racine du dépôt.

## Utilisation

Les hôtes viennent de `~/.ssh/config`. Un clic sur un dossier demande à
Remote-SSH d'ouvrir le chemin.

Les favoris sont dans `~/.ssh/extensions/ssh-folders.json`.
Le schéma JSON (`./remote-folders.schema.json`) est dans le même dossier :

~~~json
{
  "$schema": "./remote-folders.schema.json",
  "defaults": {
    "DefaultFolder": "/opt/docker/projects",
    "RecentLimit": 20
  },
  "folders": {
    "myserver": [
      { "label": "projet-api", "path": "/home/cedric/dev/api" },
      { "path": "/etc/nginx" }
    ]
  }
}
~~~

Le chemin doit être POSIX et absolu (`/...`). On peut aussi ajouter, renommer
ou supprimer un dossier depuis le menu de l'arbre.

`defaults.DefaultFolder` s'applique à tous les hôtes : un clic sur l'hôte
ouvre ce chemin au lieu d'une fenêtre distante vide.

`defaults.RecentLimit` fixe le nombre d'entrées dans la vue **Derniers accès**
(20 par défaut, entre 1 et 100). L'historique lui-même n'est pas dans ce JSON :
il est stocké dans l'état global de l'extension Cursor / VS Code.

### Ajouter un dossier

Le bouton **+** ouvre d'abord la liste des hôtes SSH :

- La liste complète reste visible.
- L'hôte de la session Remote-SSH en cours (ou l'hôte du **+** dans l'arbre)
  est seulement présélectionné. On peut en choisir un autre.

Ensuite :

- **Chemin POSIX** : prérempli avec `defaults.DefaultFolder`.
- **Nom affiché** : la partie du chemin **après** `DefaultFolder`, sans `/`
  initial. Exemple : `/opt/docker/projects/grafana` donne `grafana`.

### Vues

La vue **Dossiers A-Z** trie alphabétiquement, affiche `Census-Agent`
(majuscule en début de mot, après un espace ou un tiret) et regroupe les
noms de la même famille (`census-agent`, `census-dev` sous **Census**).

La vue **Derniers accès** liste les dernières connexions (hôte ou dossier),
triées par date. Un bouton **-** à droite retire une entrée de l'historique,
sans supprimer le favori. Le bouton en haut de la vue cycle : par hôte, puis
A-Z, puis derniers accès.

Réglage optionnel : `sshFolders.configPath`.
Le fichier SSH lu est `remote.SSH.configFile` s'il est défini, sinon `~/.ssh/config`.

Les alias SSH sont comparés sans tenir compte de la casse :
`HEIG-DockerDMZ-01` et `heig-dockerdmz-01` désignent le même hôte.
La connexion Remote-SSH utilise l'alias tel qu'il est écrit dans le fichier SSH config.

## Publier

Comptes et jetons se créent dans le navigateur. L'identifiant public est
`cedric217` des deux côtés : éditeur Marketplace et namespace Open VSX.
Le compte Eclipse `Cedric2170` possède ce namespace, il n'en est pas le nom.
Ne pas écrire les jetons dans le dépôt. Depuis ce dossier :

~~~bash
npm run package
npm run publish:vscode
npm run publish:openvsx
~~~

`npm run package` écrit `vsix/ssh-folders-<version>.vsix`. `publish:vscode`
repackage si besoin puis publie ce fichier. `publish:openvsx` envoie le même
`.vsix`. Le jeton Open VSX vient de `OVSX_PAT` ou de `npx ovsx login cedric217`.

Upload manuel sur le Marketplace : glisser le `.vsix` depuis `vsix/`.

Chaque registre refuse une version déjà publiée. Monter `version` avant
une mise à jour.

## Développement (F5)

L'extension n'est **pas** active dans la fenêtre où tu édites le code.
F5 ouvre une **seconde** fenêtre Cursor (Extension Development Host).

1. Ouvre le dossier `vsCodeSSH` dans Cursor.
2. `npm install` puis `npm run compile`.
3. Exécuter et déboguer (`Cmd+Shift+D`), configuration **Run Extension**, F5.
   Les configs lancent l’Extension Development Host avec `--disable-extensions`
   (seule l’extension du workspace est chargée). **Run Extension** et
   **Run Extension (isolé)** posent `SSH_FOLDERS_DEV=1`.
4. Dans la fenêtre Extension Development Host, ouvre **SSH - Folders**.
   Le titre se termine par `· dev` et la vue montre les hôtes d'exemple.

### Fichiers d'exemple

`SSH_FOLDERS_DEV=1` n'est honoré que dans l'hôte de développement (F5).
Un `.vsix` installé est en mode Production et ignore cette variable, même
si elle est définie dans l'environnement.

La vue lit une copie des fichiers `examples/`, recréée à chaque lancement
dans le stockage de l'extension. `~/.ssh/config`,
`~/.ssh/extensions/ssh-folders.json`, le schéma à côté, l'historique des
accès et le réglage `sshFolders.view` ne sont pas écrits. Pour revoir ces
fichiers depuis F5, lance **Run Extension (config réelle)** (`SSH_FOLDERS_DEV=0`).
Le VSIX installé les affiche toujours.

Ajouter ou supprimer un dossier en mode dev modifie seulement la copie,
effacée au prochain F5.

Pour recompiler après une modification : `npm run compile`, puis relancer F5.

Si l’activation échoue avec `command 'sshFolders.refresh' already exists` ou
`Cannot register multiple views with same id 'sshFolders'` : une **deuxième**
copie de l’extension tourne encore (souvent le `.vsix` installé dans la fenêtre
de test). Ferme les fenêtres Extension Development Host, relance F5, ou
désactive **SSH - Folders** dans la fenêtre de test (Extensions). La copie
installée est ignorée automatiquement quand une session F5 (mode développement)
est détectée, mais le plus fiable reste de ne pas avoir les deux en parallèle.
