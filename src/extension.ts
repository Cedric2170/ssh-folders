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
  foldersForHost,
  getFoldersConfigPath,
  invalidateFoldersCache,
  labelFromDefaultFolder,
  listLocalSubdirectories,
  localVirtualHosts,
  readFoldersFile,
  removeFolderEntry,
  removeLocalFolderEntry,
  renameFolderEntry,
  renameLocalFolderEntry,
  sortAlphabetical,
  toTildePath,
  toggleFolderFavorite,
  toggleHostFavorite,
  toggleLocalFolderFavorite,
  visibleHostAliases,
} from "./foldersConfig";
import { sortHostAliases } from "./folderDisplay";
import {
  activeRemotePathForHost,
  canonicalHostAlias,
  currentSshHost,
  getSshConfigPath,
  hostFromRemoteAuthority,
  initHostCache,
  isCachedSshSource,
  listHostAliases,
  reloadHostAliases,
  sameHost,
  sshRemoteAuthority,
  suggestedRemoteAddPath,
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
import { openRemotePathForHost, watchOpenWindows } from "./openWindows";
import { initRecentAccess, recordAccess, removeAccess } from "./recentAccess";
import { initDevMode, isDevMode, prepareDevSandbox } from "./devMode";
import { confirmAndCreateProjectFolder } from "./projectFolder";

/** Dossier local ouvert dans la fenêtre courante, en chemin `~/...` si possible. */
function currentOpenLocalFolderPath(): string | undefined {
  const folder = (vscode.workspace.workspaceFolders ?? []).find(
    (item) => item.uri.scheme === "file"
  );
  if (!folder) {
    return undefined;
  }
  return toTildePath(folder.uri.fsPath);
}

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
  // Pas de DefaultFolder ici : laisse le sélecteur de dossier libre
  // (évite un chemin type /opt/docker/... imposé sur un nouvel hôte).
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
  const created = await confirmAndCreateProjectFolder({
    alias: host,
    folderPath: remotePath,
    local: false,
  });
  if (!created) {
    return undefined;
  }
  // Réutilise l'autorité déjà connectée dans cette fenêtre si possible.
  const liveAuthority = vscode.workspace.workspaceFolders?.find((folder) => {
    if (folder.uri.scheme !== "vscode-remote") {
      return false;
    }
    const remoteHost = hostFromRemoteAuthority(folder.uri.authority);
    return remoteHost ? sameHost(remoteHost, host) : false;
  })?.uri.authority;
  await recordAccess({ kind: "folder", alias: host, path: remotePath });
  const uri = vscode.Uri.from({
    scheme: "vscode-remote",
    authority: liveAuthority ?? sshRemoteAuthority(host),
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
    vscode.l10n.t(
      'SSH - Folders: open a folder under "{0}" (local group).',
      alias
    )
  );
  return undefined;
}

async function openLocalFolder(
  alias: string,
  localPath: string,
  newWindow: boolean
): Promise<unknown> {
  const folderPath = assertLocalPath(localPath);
  const created = await confirmAndCreateProjectFolder({
    alias,
    folderPath,
    local: true,
  });
  if (!created) {
    return undefined;
  }
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
      vscode.l10n.t("SSH - Folders: {0}", (error as Error).message)
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
  picker.title = vscode.l10n.t("Add a local folder — {0}", virtualHost);
  picker.placeholder = vscode.l10n.t(
    "Choose a folder, navigate with Enter, or type a path (~/...)"
  );
  picker.ignoreFocusOut = true;
  picker.matchOnDescription = true;

  let current = currentOpenLocalFolderPath() ?? "~";

  const refresh = async (): Promise<void> => {
    picker.busy = true;
    const display = current === "~" ? "~" : current.replace(/\/+$/, "");
    picker.title = vscode.l10n.t(
      "Add a local folder — {0}  ·  {1}",
      virtualHost,
      display
    );
    const absolute = expandLocalPath(display);
    const home = expandLocalPath("~");
    const subdirs = await listLocalSubdirectories(display);
    const items: LocalPathPickItem[] = [
      {
        action: "use",
        label: vscode.l10n.t("$(check) Use this folder"),
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
            try {
              const stat = await fs.stat(abs);
              if (!stat.isDirectory()) {
                void vscode.window.showWarningMessage(
                  vscode.l10n.t("This path is not a folder.")
                );
                return;
              }
            } catch (error) {
              const err = error as NodeJS.ErrnoException;
              if (err.code !== "ENOENT") {
                void vscode.window.showWarningMessage(
                  err.message || String(error)
                );
                return;
              }
              // Absent : création feuille proposée plus bas (confirmAndCreateProjectFolder).
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
        ? vscode.l10n.t(
            "No SSH host or local group. Add a VirtualHost in local[] or an SSH Host."
          )
        : vscode.l10n.t(
            "All hosts are hidden (defaults.HiddenHosts)."
          )
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
  picker.title = vscode.l10n.t("SSH - Folders");
  picker.placeholder = vscode.l10n.t(
    "SSH host or local group (VirtualHost) — type freely for a new local group"
  );
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
        vscode.l10n.t(
          "SSH - Folders: dev mode unavailable ({0}). Personal files are not used.",
          (error as Error).message
        )
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
      const created = await confirmAndCreateProjectFolder({
        alias,
        folderPath,
        local: true,
      });
      if (!created) {
        return;
      }
      const suggestedLabel = folderLabel({ path: folderPath });
      const label = await vscode.window.showInputBox({
        title: vscode.l10n.t("Label — {0}", alias),
        prompt: vscode.l10n.t("Display label (optional)"),
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
    const openPath =
      activeRemotePathForHost(alias) ?? openRemotePathForHost(alias);
    const knownPaths = foldersForHost(data, alias).map((entry) => entry.path);
    const prefillPath = suggestedRemoteAddPath(
      defaultFolder,
      openPath,
      knownPaths
    );
    const remotePath = await vscode.window.showInputBox({
      title: vscode.l10n.t("Add a folder — {0}", alias),
      prompt: vscode.l10n.t(
        "Absolute POSIX path on the remote host (freely editable)"
      ),
      placeHolder:
        prefillPath || defaultFolder || "/home/utilisateur/projet",
      value: prefillPath,
      // Sélectionne toute la proposition pour la remplacer facilement.
      valueSelection: prefillPath ? [0, prefillPath.length] : undefined,
      validateInput: (value) => {
        try {
          assertRemotePath(value);
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
    const created = await confirmAndCreateProjectFolder({
      alias,
      folderPath,
      local: false,
    });
    if (!created) {
      return;
    }
    const suggestedLabel = labelFromDefaultFolder(folderPath, defaultFolder);
    const label = await vscode.window.showInputBox({
      title: vscode.l10n.t("Label — {0}", alias),
      prompt: vscode.l10n.t("Display label (optional)"),
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
      title: vscode.l10n.t("Rename folder"),
      value: item.label?.toString() ?? "",
      prompt: vscode.l10n.t("New label (empty = folder name)"),
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
    const deleteAction = vscode.l10n.t("Remove");
    const confirmed = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'Remove "{0}" ({1})?',
        String(item.label ?? ""),
        item.entry.path
      ),
      { modal: true },
      deleteAction
    );
    if (confirmed !== deleteAction) {
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
      "sshFolders.toggleFavorite",
      async (item?: unknown) => {
        try {
          if (item instanceof HostItem) {
            const next = await toggleHostFavorite(item.alias);
            refresh();
            void vscode.window.showInformationMessage(
              next
                ? vscode.l10n.t("\"{0}\" added to favorites.", item.alias)
                : vscode.l10n.t("\"{0}\" removed from favorites.", item.alias)
            );
            return;
          }
          if (item instanceof FolderItem) {
            const next = item.local
              ? await toggleLocalFolderFavorite(item.alias, item.path)
              : await toggleFolderFavorite(item.alias, item.path);
            refresh();
            const name = item.label?.toString() ?? item.path;
            void vscode.window.showInformationMessage(
              next
                ? vscode.l10n.t("\"{0}\" added to favorites.", name)
                : vscode.l10n.t("\"{0}\" removed from favorites.", name)
            );
          }
        } catch (error) {
          void vscode.window.showErrorMessage((error as Error).message);
        }
      }
    ),
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
          vscode.l10n.t(
            "SSH config file not found: {0}",
            getSshConfigPath()
          )
        );
      }
    })
  );
}

export function deactivate(): void {
  // Rien à nettoyer hors des disposables enregistrés.
}
