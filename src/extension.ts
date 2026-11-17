import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import {
  addFolderEntry,
  addLocalFolderEntry,
  assertLocalPath,
  assertRemotePath,
  defaultFolderPath,
  ensureFoldersFile,
  expandLocalPath,
  folderLabel,
  getFoldersConfigPath,
  invalidateFoldersCache,
  labelFromDefaultFolder,
  listLocalSubdirectories,
  localVirtualHosts,
  projectsRootForHost,
  readFoldersFile,
  repairPathUnderProjectsRoot,
  removeFolderEntry,
  removeLocalFolderEntry,
  renameFolderEntry,
  renameLocalFolderEntry,
  sortAlphabetical,
  toTildePath,
  visibleHostAliases,
} from "./foldersConfig";
import { sortHostAliases } from "./folderDisplay";
import {
  canonicalHostAlias,
  currentSshHost,
  getSshConfigPath,
  initHostCache,
  isCachedSshSource,
  listHostAliases,
  reloadHostAliases,
  sameHost,
  sshRemoteAuthority,
} from "./sshConfig";
import {
  ActiveItemDecorationProvider,
  FolderItem,
  HostItem,
  SshFoldersTreeProvider,
  getViewMode,
  holdViewMode,
  releaseViewMode,
  rememberViewMode,
  viewTitle,
  type OpenTarget,
  type ViewMode,
} from "./treeProvider";
import { watchOpenWindows } from "./openWindows";
import { initRecentAccess, recordAccess, removeAccess } from "./recentAccess";
import { initDevMode, isDevMode, prepareDevSandbox } from "./devMode";

function isOpenTarget(value: unknown): value is OpenTarget {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as OpenTarget & {
    contextValue?: string;
    entry?: { path?: string };
  };
  if (item.kind === "host" && typeof item.alias === "string") {
    return true;
  }
  if (
    item.kind === "folder" &&
    typeof item.alias === "string" &&
    typeof item.path === "string"
  ) {
    return true;
  }
  return false;
}

function toOpenTarget(item: unknown): OpenTarget | undefined {
  if (isOpenTarget(item)) {
    return item;
  }
  if (item instanceof HostItem) {
    return {
      kind: "host",
      alias: item.alias,
      ...(item.local ? { local: true } : {}),
    };
  }
  if (item instanceof FolderItem) {
    return {
      kind: "folder",
      alias: item.alias,
      path: item.path,
      ...(item.local ? { local: true } : {}),
    };
  }
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const rec = item as {
    contextValue?: string;
    alias?: string;
    path?: string;
    local?: boolean;
    entry?: { path?: string };
  };
  const local =
    rec.local === true ||
    rec.contextValue === "localHost" ||
    rec.contextValue === "recentLocalHost" ||
    rec.contextValue === "localFolder" ||
    rec.contextValue === "recentLocalFolder";
  if (
    rec.contextValue === "host" ||
    rec.contextValue === "recentHost" ||
    rec.contextValue === "localHost" ||
    rec.contextValue === "recentLocalHost"
  ) {
    if (typeof rec.alias === "string") {
      return {
        kind: "host",
        alias: rec.alias,
        ...(local ? { local: true } : {}),
      };
    }
  }
  if (
    rec.contextValue === "folder" ||
    rec.contextValue === "recentFolder" ||
    rec.contextValue === "localFolder" ||
    rec.contextValue === "recentLocalFolder"
  ) {
    const folderPath = rec.path ?? rec.entry?.path;
    if (typeof rec.alias === "string" && typeof folderPath === "string") {
      return {
        kind: "folder",
        alias: rec.alias,
        path: folderPath,
        ...(local ? { local: true } : {}),
      };
    }
  }
  return undefined;
}

type HostPick = { alias: string; local: boolean };

async function openRemoteHost(
  alias: string,
  newWindow: boolean
): Promise<unknown> {
  const host = await canonicalHostAlias(alias);
  const data = await readFoldersFile();
  const folder = defaultFolderPath(data);
  if (folder) {
    return openRemoteFolder(host, folder, newWindow);
  }
  await recordAccess({ kind: "host", alias: host });
  return vscode.commands.executeCommand("vscode.newWindow", {
    remoteAuthority: sshRemoteAuthority(host),
    reuseWindow: !newWindow,
  });
}

async function openRemoteFolder(
  alias: string,
  remotePath: string,
  newWindow: boolean
): Promise<unknown> {
  const host = await canonicalHostAlias(alias);
  await recordAccess({ kind: "folder", alias: host, path: remotePath });
  const uri = vscode.Uri.from({
    scheme: "vscode-remote",
    authority: sshRemoteAuthority(host),
    path: remotePath,
  });
  return vscode.commands.executeCommand("vscode.openFolder", uri, {
    forceNewWindow: newWindow,
    forceReuseWindow: !newWindow,
  });
}

async function openLocalHost(alias: string): Promise<undefined> {
  await recordAccess({ kind: "host", alias, local: true });
  void vscode.window.showInformationMessage(
    `SSH - Folders : ouvrez un dossier sous « ${alias} » (groupe local).`
  );
  return undefined;
}

async function openLocalFolder(
  alias: string,
  localPath: string,
  newWindow: boolean
): Promise<unknown> {
  const folderPath = assertLocalPath(localPath);
  await recordAccess({
    kind: "folder",
    alias,
    path: folderPath,
    local: true,
  });
  const uri = vscode.Uri.file(expandLocalPath(folderPath));
  return vscode.commands.executeCommand("vscode.openFolder", uri, {
    forceNewWindow: newWindow,
    forceReuseWindow: !newWindow,
  });
}

async function openTreeItem(
  item: unknown,
  newWindow: boolean
): Promise<unknown> {
  const target = toOpenTarget(item);
  if (!target) {
    return undefined;
  }
  try {
    if (target.local) {
      if (target.kind === "host") {
        return await openLocalHost(target.alias);
      }
      if (target.path) {
        return await openLocalFolder(target.alias, target.path, newWindow);
      }
      return undefined;
    }
    if (target.kind === "host") {
      return await openRemoteHost(target.alias, newWindow);
    }
    if (target.path) {
      return await openRemoteFolder(target.alias, target.path, newWindow);
    }
  } catch (error) {
    void vscode.window.showErrorMessage(
      `SSH - Folders : ${(error as Error).message}`
    );
  }
  return undefined;
}

type LocalPathPickItem = vscode.QuickPickItem & {
  action: "use" | "up" | "dir";
  target: string;
};

/** Parcourt les dossiers locaux à partir de ~/ ; conserve ~ dans le chemin choisi. */
async function pickLocalFolderPath(
  virtualHost: string
): Promise<string | undefined> {
  const picker = vscode.window.createQuickPick<LocalPathPickItem>();
  picker.title = `Ajouter un dossier local — ${virtualHost}`;
  picker.placeholder =
    "Choisir un dossier, naviguer avec Entrée, ou saisir un chemin (~/...)";
  picker.ignoreFocusOut = true;
  picker.matchOnDescription = true;

  let current = "~";

  const refresh = async (): Promise<void> => {
    picker.busy = true;
    const display = current === "~" ? "~" : current.replace(/\/+$/, "");
    picker.title = `Ajouter un dossier local — ${virtualHost}  ·  ${display}`;
    const absolute = expandLocalPath(display);
    const home = expandLocalPath("~");
    const subdirs = await listLocalSubdirectories(display);
    const items: LocalPathPickItem[] = [
      {
        action: "use",
        label: "$(check) Utiliser ce dossier",
        description: display,
        target: display,
        alwaysShow: true,
      },
    ];
    const parentAbs = path.dirname(absolute);
    if (path.normalize(absolute) !== path.normalize(home)) {
      items.push({
        action: "up",
        label: "$(arrow-up) ..",
        description: toTildePath(parentAbs),
        target: toTildePath(parentAbs),
        alwaysShow: true,
      });
    }
    for (const name of subdirs) {
      const child = toTildePath(path.join(absolute, name));
      items.push({
        action: "dir",
        label: `$(folder) ${name}`,
        description: child,
        target: child,
      });
    }
    picker.items = items;
    picker.activeItems = items.slice(0, 1);
    picker.busy = false;
  };

  await refresh();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      picker.dispose();
      resolve(value);
    };

    picker.onDidAccept(() => {
      void (async () => {
        const typed = picker.value.trim();
        if (typed) {
          try {
            const normalized = assertLocalPath(typed);
            const abs = expandLocalPath(normalized);
            const stat = await fs.stat(abs);
            if (!stat.isDirectory()) {
              void vscode.window.showWarningMessage(
                "Ce chemin n'est pas un dossier."
              );
              return;
            }
            finish(toTildePath(normalized));
          } catch (error) {
            void vscode.window.showWarningMessage((error as Error).message);
          }
          return;
        }

        const selected = picker.selectedItems[0] ?? picker.activeItems[0];
        if (!selected) {
          return;
        }
        if (selected.action === "use") {
          finish(selected.target);
          return;
        }
        current = selected.target;
        picker.value = "";
        await refresh();
      })();
    });

    picker.onDidHide(() => {
      finish(undefined);
    });
    picker.show();
  });
}

async function pickHost(preferred?: {
  alias?: string;
  local?: boolean;
}): Promise<HostPick | undefined> {
  const listed = await listHostAliases();
  const data = await readFoldersFile().catch(() => undefined);
  const visibleSsh = visibleHostAliases(listed, data);
  const visibleLocal = visibleHostAliases(localVirtualHosts(data), data);
  const sshAliases = sortAlphabetical(data)
    ? sortHostAliases(visibleSsh)
    : visibleSsh;
  const localAliases = sortAlphabetical(data)
    ? sortHostAliases(visibleLocal)
    : visibleLocal;

  if (sshAliases.length === 0 && localAliases.length === 0) {
    void vscode.window.showWarningMessage(
      listed.length === 0 && localAliases.length === 0
        ? "Aucun hôte SSH ni groupe local. Ajoutez un VirtualHost dans local[] ou un Host SSH."
        : "Tous les hôtes sont masqués (defaults.HiddenHosts)."
    );
    return undefined;
  }

  type PickItem = vscode.QuickPickItem & { local: boolean };
  const items: PickItem[] = [
    ...sshAliases.map((label) => ({
      label,
      description: "SSH",
      local: false,
    })),
    ...localAliases.map((label) => ({
      label,
      description: "Local",
      local: true,
    })),
  ];

  const prefillAlias = preferred?.alias?.trim() || currentSshHost() || "";
  const prefillLocal = preferred?.local === true;
  const picker = vscode.window.createQuickPick<PickItem>();
  picker.title = "SSH - Folders";
  picker.placeholder =
    "Hôte SSH ou groupe local (VirtualHost) — saisie libre pour un nouveau groupe local";
  picker.items = items;
  picker.ignoreFocusOut = true;
  const match = prefillAlias
    ? picker.items.find(
        (item) =>
          sameHost(item.label, prefillAlias) && item.local === prefillLocal
      ) ??
      picker.items.find((item) => sameHost(item.label, prefillAlias))
    : undefined;
  if (match) {
    picker.activeItems = [match];
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: HostPick | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      picker.dispose();
      resolve(value);
    };
    picker.onDidAccept(() => {
      const selected = picker.selectedItems[0] ?? picker.activeItems[0];
      const typed = picker.value.trim();
      if (selected && (!typed || sameHost(selected.label, typed))) {
        finish({ alias: selected.label, local: selected.local });
        return;
      }
      if (!typed) {
        finish(undefined);
        return;
      }
      const typedMatch = items.find((item) => sameHost(item.label, typed));
      if (typedMatch) {
        finish({ alias: typedMatch.label, local: typedMatch.local });
        return;
      }
      // Nouveau nom : groupe local (VirtualHost), pas un Host SSH inventé.
      finish({ alias: typed, local: true });
    });
    picker.onDidHide(() => {
      finish(undefined);
    });
    picker.show();
  });
}

async function openTextFile(filePath: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.file(filePath)
  );
  await vscode.window.showTextDocument(document);
}

/** Ferme les onglets du bac à sable exemples, souvent restaurés hors mode sandbox. */
async function closeSandboxEditors(
  context: vscode.ExtensionContext
): Promise<void> {
  if (isDevMode()) {
    return;
  }
  const sandboxRoot = path.join(
    context.globalStorageUri.fsPath,
    "ssh-folders-dev"
  );
  const toClose: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (!(input instanceof vscode.TabInputText)) {
        continue;
      }
      if (input.uri.scheme !== "file") {
        continue;
      }
      const filePath = input.uri.fsPath;
      if (
        filePath === sandboxRoot ||
        filePath.startsWith(`${sandboxRoot}${path.sep}`)
      ) {
        toClose.push(tab);
      }
    }
  }
  if (toClose.length > 0) {
    await vscode.window.tabGroups.close(toClose);
  }
}

let activationDisposables: vscode.Disposable[] | undefined;
let activationInFlight: Promise<void> | undefined;

/** Copie VSIX + F5 dans la même fenêtre : une seule instance doit enregistrer vue/commandes. */
function isDuplicateNonDevelopmentInstance(
  context: vscode.ExtensionContext
): boolean {
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    return false;
  }
  const { id, extensionPath } = context.extension;
  return vscode.extensions.all.some(
    (ext) => ext.id === id && ext.extensionPath !== extensionPath
  );
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  if (isDuplicateNonDevelopmentInstance(context)) {
    return;
  }

  if (activationInFlight) {
    await activationInFlight;
    return;
  }

  activationInFlight = activateOnce(context).finally(() => {
    activationInFlight = undefined;
  });
  await activationInFlight;
}

async function activateOnce(
  context: vscode.ExtensionContext
): Promise<void> {
  activationDisposables?.forEach((d) => d.dispose());
  activationDisposables = [];
  const push = (...disposables: vscode.Disposable[]): void => {
    for (const d of disposables) {
      activationDisposables!.push(d);
      context.subscriptions.push(d);
    }
  };

  initDevMode(context);
  if (isDevMode()) {
    try {
      await prepareDevSandbox(context);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `SSH - Folders : mode dev impossible (${(error as Error).message}). Les fichiers personnels ne sont pas utilisés.`
      );
    }
    invalidateFoldersCache();
    holdViewMode();
  } else {
    releaseViewMode();
    await closeSandboxEditors(context);
  }

  initHostCache(context.globalState);
  const initialMode = getViewMode();
  await vscode.commands.executeCommand(
    "setContext",
    "sshFolders.view",
    initialMode
  );

  const treeProvider = new SshFoldersTreeProvider();
  const treeView = vscode.window.createTreeView("sshFolders", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  treeView.title = viewTitle(initialMode);
  initRecentAccess(
    context.globalState,
    () => treeProvider.refresh(),
    isDevMode()
  );

  const applyViewMode = (mode: ViewMode): void => {
    void vscode.commands.executeCommand("setContext", "sshFolders.view", mode);
    treeView.title = viewTitle(mode);
    treeProvider.refresh();
  };

  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const refresh = (): void => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      applyViewMode(getViewMode());
    }, 50);
  };

  const visibility = treeView.onDidChangeVisibility((event) => {
    if (event.visible) {
      treeProvider.refresh();
    }
  });

  void (async () => {
    try {
      await ensureFoldersFile();
    } catch {
      // Copie impossible : la vue s'affiche avec les hôtes SSH déjà connus.
    }
    await Promise.all([
      reloadHostAliases(),
      readFoldersFile().catch(() => undefined),
    ]);
    treeProvider.markHostsReady();
  })();

  async function setViewMode(mode: ViewMode): Promise<void> {
    if (isDevMode()) {
      rememberViewMode(mode);
      applyViewMode(mode);
      return;
    }
    await vscode.workspace
      .getConfiguration("sshFolders")
      .update("view", mode, vscode.ConfigurationTarget.Global);
    applyViewMode(mode);
  }

  async function addFolder(item?: unknown): Promise<void> {
    const fromTree =
      item instanceof HostItem
        ? { alias: item.alias, local: item.local }
        : undefined;
    const picked = fromTree ?? (await pickHost());
    if (!picked) {
      return;
    }
    const { alias, local } = picked;

    if (local) {
      const localPath = await pickLocalFolderPath(alias);
      if (!localPath) {
        return;
      }
      const folderPath = assertLocalPath(localPath);
      const suggestedLabel = folderLabel({ path: folderPath });
      const label = await vscode.window.showInputBox({
        title: `Libellé — ${alias}`,
        prompt: "Libellé affiché (optionnel)",
        placeHolder: "Projets",
        value: suggestedLabel,
      });
      if (label === undefined) {
        return;
      }
      try {
        await addLocalFolderEntry({
          VirtualHost: alias,
          path: folderPath,
          ...(label.trim() ? { label: label.trim() } : {}),
        });
        refresh();
      } catch (error) {
        void vscode.window.showErrorMessage((error as Error).message);
      }
      return;
    }

    const data = await readFoldersFile();
    const defaultFolder = defaultFolderPath(data);
    const projectsRoot = projectsRootForHost(alias, data.folders, defaultFolder);
    const remotePath = await vscode.window.showInputBox({
      title: `Ajouter un dossier — ${alias}`,
      prompt: "Chemin POSIX absolu sur l'hôte distant",
      placeHolder: defaultFolder ?? "/home/utilisateur/projet",
      value: defaultFolder ?? "",
      valueSelection: defaultFolder
        ? [defaultFolder.length, defaultFolder.length]
        : undefined,
      validateInput: (value) => {
        try {
          const pathValue = assertRemotePath(value);
          if (projectsRoot) {
            const fixed = repairPathUnderProjectsRoot(pathValue, projectsRoot);
            if (fixed !== pathValue) {
              return `Le chemin semble manquer « ${path.posix.basename(projectsRoot.replace(/\/+$/, ""))} ». Utilisez plutôt : ${fixed}`;
            }
          }
          return undefined;
        } catch (error) {
          return (error as Error).message;
        }
      },
    });
    if (!remotePath) {
      return;
    }

    const folderPath = assertRemotePath(remotePath);
    const suggestedLabel = labelFromDefaultFolder(folderPath, defaultFolder);
    const label = await vscode.window.showInputBox({
      title: `Libellé — ${alias}`,
      prompt: "Libellé affiché (optionnel)",
      placeHolder: "projet-api",
      value: suggestedLabel,
    });
    if (label === undefined) {
      return;
    }

    try {
      await addFolderEntry(alias, {
        path: folderPath,
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      refresh();
    } catch (error) {
      void vscode.window.showErrorMessage((error as Error).message);
    }
  }

  async function renameFolder(item?: FolderItem): Promise<void> {
    if (!(item instanceof FolderItem)) {
      return;
    }
    const label = await vscode.window.showInputBox({
      title: "Renommer le dossier",
      value: item.label?.toString() ?? "",
      prompt: "Nouveau libellé (vide = nom du dossier)",
    });
    if (label === undefined) {
      return;
    }
    try {
      if (item.local) {
        await renameLocalFolderEntry(item.alias, item.entry.path, label);
      } else {
        await renameFolderEntry(item.alias, item.entry.path, label);
      }
      refresh();
    } catch (error) {
      void vscode.window.showErrorMessage((error as Error).message);
    }
  }

  async function removeFolder(item?: FolderItem): Promise<void> {
    if (!(item instanceof FolderItem)) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Supprimer « ${item.label} » (${item.entry.path}) ?`,
      { modal: true },
      "Supprimer"
    );
    if (confirmed !== "Supprimer") {
      return;
    }
    try {
      if (item.local) {
        await removeLocalFolderEntry(item.alias, item.entry.path);
      } else {
        await removeFolderEntry(item.alias, item.entry.path);
      }
      refresh();
    } catch (error) {
      void vscode.window.showErrorMessage((error as Error).message);
    }
  }

  push(
    treeView,
    visibility,
    vscode.window.registerFileDecorationProvider(
      new ActiveItemDecorationProvider()
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      treeProvider.refresh();
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      treeProvider.refresh();
    }),
    watchOpenWindows(context, () => treeProvider.refresh()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("sshFolders.view")) {
        refresh();
      }
      if (event.affectsConfiguration("sshFolders.configPath")) {
        invalidateFoldersCache();
        void readFoldersFile().then(() => refresh());
      }
      if (event.affectsConfiguration("remote.SSH.configFile")) {
        void reloadHostAliases().then(() => refresh());
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const saved = document.uri.fsPath;
      if (saved === getFoldersConfigPath()) {
        invalidateFoldersCache();
        void readFoldersFile().then(() => refresh());
      }
      if (isCachedSshSource(saved)) {
        void reloadHostAliases().then(() => refresh());
      }
    }),
    vscode.commands.registerCommand("sshFolders.refresh", () => {
      invalidateFoldersCache();
      void Promise.all([
        reloadHostAliases(),
        readFoldersFile().catch(() => undefined),
      ]).then(() => refresh());
    }),
    vscode.commands.registerCommand("sshFolders.showByHost", () =>
      setViewMode("byHost")
    ),
    vscode.commands.registerCommand("sshFolders.showByFolder", () =>
      setViewMode("byFolder")
    ),
    vscode.commands.registerCommand("sshFolders.showByRecent", () =>
      setViewMode("recent")
    ),
    vscode.commands.registerCommand("sshFolders.addFolder", addFolder),
    vscode.commands.registerCommand("sshFolders.renameFolder", renameFolder),
    vscode.commands.registerCommand("sshFolders.removeFolder", removeFolder),
    vscode.commands.registerCommand(
      "sshFolders.removeRecent",
      async (item?: unknown) => {
        const target = toOpenTarget(item);
        if (!target) {
          return;
        }
        await removeAccess(target);
      }
    ),
    vscode.commands.registerCommand(
      "sshFolders.openInCurrentWindow",
      (item?: unknown) => openTreeItem(item, false)
    ),
    vscode.commands.registerCommand(
      "sshFolders.openInNewWindow",
      (item?: unknown) => openTreeItem(item, true)
    ),
    vscode.commands.registerCommand("sshFolders.openFoldersConfig", async () => {
      const filePath = await ensureFoldersFile();
      await openTextFile(filePath);
      refresh();
    }),
    vscode.commands.registerCommand("sshFolders.openSshConfig", async () => {
      try {
        await openTextFile(getSshConfigPath());
      } catch {
        void vscode.window.showErrorMessage(
          `Fichier SSH config introuvable : ${getSshConfigPath()}`
        );
      }
    })
  );
}

export function deactivate(): void {
  // Rien à nettoyer hors des disposables enregistrés.
}
