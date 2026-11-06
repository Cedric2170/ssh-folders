extension TypeScript, code dans src/, sortie dans out/, point d’entrée src/extension.ts ;
textes visibles (commandes, vues, messages) en français ;
npm run compile après un changement, test via F5 (Run Extension, SSH_FOLDERS_DEV=1) ;
ne pas monter version dans package.json ni lancer publish:* sans demande ;
README.md est la page publique, dev.md reste local ;
ne pas committer de jetons (OVSX_PAT, .env) ;
LF, UTF-8, indentation 2 espaces, comme .editorconfig ;
toute clé de ssh-folders.json qui a une valeur par défaut est déclarée dans le catalogue `DEFAULT_SETTINGS` de src/foldersConfig.ts, dans le schéma et dans l'exemple ;
au chargement, chaque clé absente est ajoutée avec cette valeur, sans écraser une clé déjà présente ;
ne pas inventer de valeur pour une clé sans défaut sûr (DefaultFolder).