import * as vscode from "vscode";
import {
  addFolderEntry,
  assertRemotePath,
  defaultFolderPath,
  ensureFoldersFile,
  getFoldersConfigPath,
  invalidateFoldersCache,
  labelFromDefaultFolder,
  readFoldersFile,
  removeFolderEntry,
  renameFolderEntry,
} from "./foldersConfig";
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
    return { kind: "host", alias: item.alias };
  }
  if (item instanceof FolderItem) {
    return { kind: "folder", alias: item.alias, path: item.path };
  }
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const rec = item as {
    contextValue?: string;
    alias?: string;
    path?: string;
    entry?: { path?: string };
  };
  if (rec.contextValue === "host" || rec.contextValue === "recentHost") {
    if (typeof rec.alias === "string") {
      return { kind: "host", alias: rec.alias };
    }
  }
  if (rec.contextValue === "folder" || rec.contextValue === "recentFolder") {
    const remotePath = rec.path ?? rec.entry?.path;
    if (typeof rec.alias === "string" && typeof remotePath === "string") {
      return { kind: "folder", alias: rec.alias, path: remotePath };
    }
  }
  return undefined;
}

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

async function openTreeItem(
  item: unknown,
  newWindow: boolean
): Promise<unknown> {
  const target = toOpenTarget(item);
  if (!target) {
    return undefined;
  }
  try {
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

async function pickHost(preferred?: string): Promise<string | undefined> {
  const aliases = await listHostAliases();
  if (aliases.length === 0) {
    void vscode.window.showWarningMessage(
      "Aucun hôte trouvé dans le fichier SSH config."
    );
    return undefined;
  }

  const prefill = preferred?.trim() || currentSshHost() || "";
  const picker = vscode.window.createQuickPick();
  picker.title = "SSH - Folders";
  picker.placeholder = "Hôte SSH";
  picker.items = aliases.map((label) => ({ label }));
  picker.ignoreFocusOut = true;
  const match = prefill
    ? picker.items.find((item) => sameHost(item.label, prefill))
    : undefined;
  if (match) {
    picker.activeItems = [match];
  }

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
      const selected =
        picker.selectedItems[0]?.label ?? picker.activeItems[0]?.label;
      const typed = picker.value.trim();
      finish(selected || typed || undefined);
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

  async function addFolder(item?: HostItem): Promise<void> {
    const alias = await pickHost(
      item instanceof HostItem ? item.alias : undefined
    );
    if (!alias) {
      return;
    }

    const data = await readFoldersFile();
    const defaultFolder = defaultFolderPath(data);
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
      await renameFolderEntry(item.alias, item.entry.path, label);
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
      await removeFolderEntry(item.alias, item.entry.path);
      refresh();
    } catch (error) {
      void vscode.window.showErrorMessage((error as Error).message);
    }
  }

  push(
    treeView,
    visibility,
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
