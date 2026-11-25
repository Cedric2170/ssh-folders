extension TypeScript, code dans src/, sortie dans out/, point d’entrée src/extension.ts ;
textes UI via l10n officielle VS Code ; suivre la langue d’affichage de Cursor/VS Code (pas de setting maison) ; `"l10n": "./l10n"` dans package.json ;
- manifeste (`contributes`) : `package.nls.json` = **anglais** (locale `en`) ; locales : `package.nls.<code>.json` (`fr`, `de`, `es`, `it`, …) ; ne pas utiliser `package.nls.en.json` ;
- runtime (`vscode.l10n.t`) : chaînes source en **anglais** dans le code (la locale `en` n’applique pas de bundle) ; `l10n/bundle.l10n.json` = identité EN ; `l10n/bundle.l10n.<code>.json` = traductions ; régénérer avec `npm run l10n:export` puis compléter les locales ;
npm run compile après un changement ; `npm test` pour les tests Node (mock vscode) des fonctionnalités ; test manuel via F5 (Run Extension) ou `npm run dev:host` si le débogueur bloque (`debugBrk`) ;
par défaut F5 / `dev:host` lit le JSON réel ; bac à sable exemples avec `npm run dev:host:exemples` ou Run Extension (exemples) (marqueur `.vscode/ssh-folders-dev.mode`, prioritaire sur l'env `SSH_FOLDERS_DEV` qui peut rester collée au process Cursor) ; le bac à sable est semé une fois depuis `examples/` puis conserve les ajouts ; reset forcé avec `npm run dev:host:exemples:reset` (`SSH_FOLDERS_DEV_RESET=1`) ;
ne pas utiliser Run Extension (isolé) / `--disable-extensions` si le thème (ex. D2 Dark) doit rester chargé ;
ne pas monter version dans package.json ni lancer publish:* / release:main sans demande ;
release Marketplace : travailler sur `dev` ; `npm run release:main` squash vers `main` en un commit `vX.Y.Z` (skill `release-main`) ; détail reste sur `dev` ;
`todo.md` (local, gitignore) : ne garder que le fait depuis le dernier commit `main` et le reste à faire, en conservant les titres de section ; après `release:main`, retirer les `[x]` livrés (skill `release-main`) ;
README.md est la page publique (Details + What's New) ; CHANGELOG.md = versions publiées `x.y.z` seulement (onglet Changelog) ; builds locaux `x.y.z-1` détaillés dans `vsix/README.md` uniquement ; dev.md reste local ;
docs publics (concis, sans redondance avec README) : `docs/configuration.{fr,en}.md`, `docs/icon-colors.{fr,en}.md` — liens README ; les mettre à jour en même temps que schéma, `DEFAULT_SETTINGS`, exemples ou comportement réel (retirer les mentions « à venir » une fois livré) ;
ne pas committer de jetons (OVSX_PAT, .env) ;
LF, UTF-8, indentation 2 espaces, comme .editorconfig ;
toute clé configurable de ssh-folders.json est déclarée dans le catalogue `DEFAULT_SETTINGS` de src/foldersConfig.ts, dans le schéma et dans l'exemple ;
au chargement / écriture, chaque clé absente est ajoutée (sans écraser l'existant) pour documenter les possibilités : `defaults` complets (`DefaultFolder: ""` si non défini) ; si la clé `local` est absente du fichier, seed `{ VirtualHost: "local", path: "~/Documents", label: "Documents" }` ; si `local: []` est déjà présent, on ne re-sème pas ; les valeurs vides sont ignorées à l'exécution ;
dossiers locaux du poste de base : tableau `local[]` avec `VirtualHost` (groupe affiché comme un hôte), `path` (absolu ou `~/...`), `label` optionnel ; dossiers uniquement (pas de fichiers pour l'instant) ; ouverture via `vscode.Uri.file` ;
maintenir AGENTS.md à jour dès qu’une convention, un flux de travail ou une règle du projet change.
