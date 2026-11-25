# Bug
- [x] `DefaultFolder` = proposition de base au `+` seulement (éditable librement) ; clic hôte sans ouverture forcée ; plus de validation qui impose `/…/projects/…`
- [x] Ajout dossier : `DefaultFolder` s'il est connu sur l'hôte (ouvert/enregistré dessous) ; sinon dossier IDE ; vide → dossier IDE

# Fonctionnalités

- [x] `+` : si le dossier n'existe pas → pop-up Créer (feuille seule, parent obligatoire) puis ajout au JSON
- [x] VirtualHostPosition (`alphabet` | `top` | `bottom`) pour placer les VirtualHost vs hôtes SSH

- Possibilités de lancer un script à la connexion ssh (et aussi la déconnexion)
  - Le script doit être possible: Par host, pour un filtrage de host (ex: HEIG*) ou tous les hosts (filtrage=* ) 
  - Crée le premier script à la connexion (All hosts) 
    Command: pullskills
  - Crée le premier script à la dé-connexion (All hosts) 
    Command: pushskills

- [x] Possibilité de mettre des favoris en haut de liste (pour l'affichage serveur et dossiers) Si un dossier est en favori, il doit quand même apparaitre dans les listes de dossiers normales
- [x] Il faudrait des graphiques ou couleurs différents pour les distants et locaux
- [x] Lors de l'ajout d'un dossier de projet, il faut que le chemin soit par défaut celui du dossier ouvert actuellement
- [x] Multi-langue (`package.nls` + `vscode.l10n` : source EN ; FR, DE, ES, IT)
- il faut une méthode pour faire un Scan automatique d'un folder distant, par exemple, le folder "Projetcs" distant à pleins de dossiers, il faut remonter cette liste de dossiers dans la json comme folders du serveur concerné.
  - Attention, ne pas prendre en compte les ArchiveParents.
  - Pour les ArchiveParents, mettre uniquement le dossier ArchiveParents, par exemple mettre uniquement "_old"

# Tri

- [x] Les dossiers dont le dossier parent est "_old" ou "old" (Ou autres, à mettre dans la config json) doivent être regroupés, ils sont considérés comme archive/inactif (`defaults.ArchiveParents`)
  - [x] Il faut les griser et les mettre à la fin des listes

# Color

- [x] Docs filtrage / couleurs : `docs/icon-colors.{fr,en}.md` + liens README
- [x] Docs champs config : `docs/configuration.{fr,en}.md` + liens README
- [x] Les icons par défaut sont blanches, ajouter la possibilité de les colorier pour chaque host et dossier
- [x] Possibilité de colorier les icones par filtre (exemple host: HEIG-* en violet)
