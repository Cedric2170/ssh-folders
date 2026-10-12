# SSH - Folders

Modifications de chaque version empaquetée dans ce dossier.
`npm run package` ajoute la section de la version courante si elle n'existe pas encore.
Une section déjà présente n'est pas réécrite.

<!-- rev:5661e56e932ec9adfdd34f55d21a4631b3940867 -->

## 0.2.5-1

- sans le choix des couleurs
- Retour vers la couleur automatique du theme sans le choix personnalisé
- ssh color active connexion
- mode dev for debug
- Exemple files and readme


## 0.2.4

- Dépôt GitHub, page d'accueil et suivi des bugs renseignés pour le Marketplace et Open VSX.

## 0.2.3

- Si le VSIX installé et une session F5 sont dans la même fenêtre, une seule copie enregistre la vue et les commandes.
- README raccourci.

## 0.2.2

- Éditeur public `cedric217`.
- Retour à l'arbre natif dans la barre d'activité. La vue web de l'Explorateur est retirée.
- README en français et en anglais.
- Icône et licence mises à jour.

## 0.2.1

- L'icône revient dans la barre d'activité.

## 0.2.0

- La vue est placée dans la barre Explorateur.
- Indicateur "Chargement..." tant que la liste des hôtes n'est pas lue.

## 0.1.6

- À l'ouverture, la vue se place sur la première entrée pour afficher l'arbre tout de suite.

## 0.1.5

- Le schéma JSON est copié à côté de `ssh-folders.json`.
- `defaults.RecentLimit` règle le nombre de derniers accès (1 à 100, 20 par défaut).
- Un bouton retire une entrée de l'historique sans supprimer le favori.
- L'ajout d'un dossier présélectionne l'hôte, préremplit le chemin et propose le libellé à partir de `DefaultFolder`.

## 0.1.4

- `defaults.DefaultFolder` : un clic sur l'hôte ouvre ce chemin au lieu d'une fenêtre distante vide.

## 0.1.3

- Vue Derniers accès : les dernières connexions, hôte ou dossier.
- Le bouton en haut de la vue cycle entre par hôte, A-Z et derniers accès.
- Nouvelle icône.

## 0.1.2

- Vue Dossiers A-Z : tri alphabétique, majuscule en début de mot, regroupement des noms d'une même famille.

## 0.1.1

- Les alias SSH sont comparés sans tenir compte de la casse.
- La connexion utilise l'alias tel qu'il est écrit dans le fichier SSH config.
- Un échec d'ouverture affiche un message d'erreur.

## 0.1.0

- Première version.
- Hôtes lus depuis le fichier SSH config, dossiers favoris dans `~/.ssh/extensions/ssh-folders.json`.
- Ajouter, renommer et supprimer un dossier.
- Ouvrir dans la fenêtre courante ou dans une nouvelle fenêtre.
- Vues par hôte et par dossier, dans la barre d'activité.
