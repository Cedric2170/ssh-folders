import * as vscode from "vscode";
import {
  cachedFoldersFile,
  expandLocalPath,
  findFolderEntry,
  findLocalFolderEntry,
  folderLabel,
  foldersForHost,
  groupSameName,
  isHostHidden,
  localFoldersForHost,
  localVirtualHosts,
  recentLimit,
  sameLocalPath,
  sortAlphabetical,
  visibleHostAliases,
  type FolderEntry,
} from "./foldersConfig";
import {
  buildAzFolderTree,
  displayFolderName,
  sortFolderEntries,
  type AzFolderRef,
} from "./folderDisplay";
import {
  formatRelativeAccess,
  listRecentAccess,
  type RecentAccess,
} from "./recentAccess";
import {
  cachedHostAliases,
  isActiveRemoteFolder,
  isActiveSshHost,
} from "./sshConfig";
import { isFolderInOpenWindow, isHostInOpenWindow } from "./openWindows";
import { isDevMode } from "./devMode";

const ACTIVE_SCHEME = "ssh-folders-active";
const activeColor = new vscode.ThemeColor("sshFolders.activeForeground");
const activeDecorationEmitter = new vscode.EventEmitter<
  vscode.Uri | vscode.Uri[] | undefined
>();

function refreshActiveDecorations(): void {
  activeDecorationEmitter.fire(undefined);
}

function isActiveLocalFolder(folderPath: string): boolean {
  const target = expandLocalPath(folderPath);
  return (vscode.workspace.workspaceFolders ?? []).some(
    (folder) =>
      folder.uri.scheme === "file" &&
      sameLocalPath(folder.uri.fsPath, target)
  );
}

function hostIsActive(alias: string, local: boolean): boolean {
  if (local) {
    const data = cachedFoldersFile();
    return localFoldersForHost(data, alias).some((entry) =>
      isActiveLocalFolder(entry.path)
    );
  }
  return isActiveSshHost(alias) || isHostInOpenWindow(alias);
}

function folderIsActive(
  alias: string,
  folderPath: string,
  local: boolean
): boolean {
  if (local) {
    return isActiveLocalFolder(folderPath);
  }
  return (
    isActiveRemoteFolder(alias, folderPath) ||
    isFolderInOpenWindow(alias, folderPath)
  );
}

function activeIcon(iconId: string, active: boolean): vscode.ThemeIcon {
  return new vscode.ThemeIcon(iconId, active ? activeColor : undefined);
}

function activeResource(id: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: ACTIVE_SCHEME,
    path: "/item",
    query: id,
  });
}

export class ActiveItemDecorationProvider
  implements vscode.FileDecorationProvider
{
  readonly onDidChangeFileDecorations = activeDecorationEmitter.event;

  provideFileDecoration(
    uri: vscode.Uri
  ): vscode.FileDecoration | undefined {
    if (uri.scheme !== ACTIVE_SCHEME) {
      return undefined;
    }
    return { color: activeColor };
  }
}

export type OpenTarget = {
  kind: "host" | "folder";
  alias: string;
  path?: string;
  local?: boolean;
};

export class HostItem extends vscode.TreeItem {
  readonly contextValue:
    | "host"
    | "recentHost"
    | "localHost"
    | "recentLocalHost";
  readonly kind = "host" as const;
  readonly local: boolean;

  constructor(
    public readonly alias: string,
    options: {
      description?: string;
      tooltip?: string;
      recent?: boolean;
      local?: boolean;
    } = {}
  ) {
    super(alias, vscode.TreeItemCollapsibleState.Collapsed);
    this.local = options.local === true;
    if (this.local) {
      this.contextValue = options.recent ? "recentLocalHost" : "localHost";
      this.id = options.recent
        ? `recent:localHost:${alias}`
        : `localHost:${alias}`;
    } else {
      this.contextValue = options.recent ? "recentHost" : "host";
      this.id = options.recent ? `recent:host:${alias}` : `host:${alias}`;
    }
    const active = hostIsActive(alias, this.local);
    this.iconPath = activeIcon(
      this.local ? "device-desktop" : "server",
      active
    );
    this.tooltip =
      options.tooltip ??
      (this.local ? `${alias} (local)` : alias);
    if (active) {
      this.resourceUri = activeResource(this.id);
      this.tooltip = `${this.tooltip}\n${
        this.local ? "Dossier local ouvert" : "Connexion active"
      }`;
      this.accessibilityInformation = {
        label: options.description
          ? `${alias}, ${options.description}, ${
              this.local ? "local ouvert" : "connexion active"
            }`
          : `${alias}, ${this.local ? "local ouvert" : "connexion active"}`,
      };
    }
    if (options.description) {
      this.description = options.description;
      this.collapsibleState = vscode.TreeItemCollapsibleState.None;
      this.command = {
        command: "sshFolders.openInNewWindow",
        title: "Ouvrir dans une nouvelle fenêtre",
        arguments: [
          {
            kind: "host",
            alias,
            ...(this.local ? { local: true } : {}),
          } satisfies OpenTarget,
        ],
      };
    }
  }
}

export class FolderItem extends vscode.TreeItem {
  readonly contextValue:
    | "folder"
    | "recentFolder"
    | "localFolder"
    | "recentLocalFolder";
  readonly kind = "folder" as const;
  readonly path: string;
  readonly active: boolean;
  readonly local: boolean;

  constructor(
    public readonly alias: string,
    public readonly entry: FolderEntry,
    options: {
      flat?: boolean;
      title?: string;
      description?: string;
      tooltip?: string;
      recent?: boolean;
      local?: boolean;
    } = {}
  ) {
    super(
      options.title ?? folderLabel(entry),
      vscode.TreeItemCollapsibleState.None
    );
    this.local = options.local === true;
    if (this.local) {
      this.contextValue = options.recent ? "recentLocalFolder" : "localFolder";
      this.id = options.recent
        ? `recent:localFolder:${alias}:${entry.path}`
        : `localFolder:${alias}:${entry.path}`;
    } else {
      this.contextValue = options.recent ? "recentFolder" : "folder";
      this.id = options.recent
        ? `recent:folder:${alias}:${entry.path}`
        : `folder:${alias}:${entry.path}`;
    }
    this.path = entry.path;
    this.active = folderIsActive(alias, entry.path, this.local);
    this.iconPath = activeIcon(
      this.local ? "folder" : "symbol-folder",
      this.active
    );
    this.command = {
      command: "sshFolders.openInNewWindow",
      title: "Ouvrir dans une nouvelle fenêtre",
      arguments: [
        {
          kind: "folder",
          alias,
          path: entry.path,
          ...(this.local ? { local: true } : {}),
        } satisfies OpenTarget,
      ],
    };
    if (options.description !== undefined) {
      this.description = options.description;
    } else if (options.flat) {
      this.description = this.local ? `${alias} · local` : alias;
    } else {
      this.description = entry.path;
    }
    this.tooltip =
      options.tooltip ??
      (options.flat
        ? `${this.label} — ${alias}:${entry.path}`
        : `${alias}:${entry.path}`);
    if (this.active) {
      this.resourceUri = activeResource(this.id);
      this.tooltip = `${this.tooltip}\nDossier actif`;
      const label = this.label?.toString() ?? folderLabel(entry);
      this.accessibilityInformation = {
        label: `${label}, ${this.description ?? entry.path}, dossier actif`,
      };
    }
  }
}

export class FolderGroupItem extends vscode.TreeItem {
  readonly contextValue = "folderGroup";
  readonly kind = "group" as const;

  constructor(
    public readonly groupName: string,
    public readonly stem: string,
    public readonly children: FolderItem[],
    active = false
  ) {
    super(groupName, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `group:${stem}`;
    this.iconPath = activeIcon("layers", active);
    this.tooltip = active ? `${groupName}\nDossier actif` : groupName;
    if (active) {
      this.resourceUri = activeResource(this.id);
      this.accessibilityInformation = {
        label: `${groupName}, dossier actif`,
      };
    }
  }
}

export class StatusItem extends vscode.TreeItem {
  readonly contextValue = "status";
  readonly kind = "status" as const;

  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `status:${label}`;
    this.iconPath = new vscode.ThemeIcon("sync~spin");
  }
}

export type SshFoldersItem = HostItem | FolderItem | FolderGroupItem | StatusItem;

export type ViewMode = "byHost" | "byFolder" | "recent";

let heldViewMode: ViewMode | undefined;

function configuredViewMode(): ViewMode {
  const value = vscode.workspace
    .getConfiguration("sshFolders")
    .get<string>("view");
  if (value === "byFolder" || value === "recent") {
    return value;
  }
  return "byHost";
}

/** Garde le mode d'affichage en mémoire pour ne pas écrire sshFolders.view. */
export function holdViewMode(): void {
  heldViewMode = configuredViewMode();
}

export function releaseViewMode(): void {
  heldViewMode = undefined;
}

export function rememberViewMode(mode: ViewMode): void {
  heldViewMode = mode;
}

export function getViewMode(): ViewMode {
  return heldViewMode ?? configuredViewMode();
}

export function viewTitle(mode: ViewMode): string {
  const suffix = isDevMode() ? " · dev" : "";
  if (mode === "byFolder") {
    const title = sortAlphabetical(cachedFoldersFile()) ? "Dossiers A-Z" : "Dossiers";
    return `${title}${suffix}`;
  }
  if (mode === "recent") {
    return `Derniers accès${suffix}`;
  }
  return `SSH - Folders${suffix}`;
}

function toFlatFolderItem(ref: AzFolderRef): FolderItem {
  return new FolderItem(ref.alias, ref.entry, {
    flat: true,
    title: displayFolderName(ref.entry),
    local: ref.local,
  });
}

function listFoldersAlphabetical(): SshFoldersItem[] {
  const data = cachedFoldersFile() ?? { folders: {} };
  const refs: AzFolderRef[] = [];
  for (const [alias, entries] of Object.entries(data.folders)) {
    if (isHostHidden(alias, data)) {
      continue;
    }
    for (const entry of entries) {
      refs.push({ alias, entry });
    }
  }
  for (const alias of localVirtualHosts(data)) {
    if (isHostHidden(alias, data)) {
      continue;
    }
    for (const entry of localFoldersForHost(data, alias)) {
      refs.push({
        alias,
        entry: { path: entry.path, ...(entry.label ? { label: entry.label } : {}) },
        local: true,
      });
    }
  }

  return buildAzFolderTree(refs, {
    sort: sortAlphabetical(data),
    group: groupSameName(data),
    data,
  }).map((node) => {
    if (node.kind === "leaf") {
      return toFlatFolderItem(node.item);
    }
    const children = node.items.map(toFlatFolderItem);
    return new FolderGroupItem(
      node.name,
      node.stem,
      children,
      children.some((child) => child.active)
    );
  });
}

function recentTooltip(entry: RecentAccess, detail: string): string {
  const when = new Date(entry.at).toLocaleString("fr-CH");
  return `${detail}\nDernier accès : ${when}`;
}

function listRecentItems(): SshFoldersItem[] {
  const data = cachedFoldersFile() ?? { folders: {} };
  const items: SshFoldersItem[] = [];
  for (const access of listRecentAccess(recentLimit(data))) {
    if (isHostHidden(access.alias, data)) {
      continue;
    }
    const relative = formatRelativeAccess(access.at);
    const local = access.local === true;
    if (access.kind === "host") {
      items.push(
        new HostItem(access.alias, {
          description: relative,
          tooltip: recentTooltip(
            access,
            local ? `${access.alias} (local)` : access.alias
          ),
          recent: true,
          local,
        })
      );
      continue;
    }
    if (!access.path) {
      continue;
    }
    const entry = local
      ? findLocalFolderEntry(data, access.alias, access.path) ?? {
          path: access.path,
        }
      : findFolderEntry(data, access.alias, access.path) ?? {
          path: access.path,
        };
    items.push(
      new FolderItem(access.alias, entry, {
        flat: true,
        title: displayFolderName(entry),
        description: `${access.alias}${local ? " · local" : ""} · ${relative}`,
        tooltip: recentTooltip(access, `${access.alias}:${access.path}`),
        recent: true,
        local,
      })
    );
  }
  return items;
}

function listByHostRoots(hostsReady: boolean): SshFoldersItem[] {
  const aliases = cachedHostAliases();
  if (aliases === undefined && !hostsReady) {
    return [new StatusItem("Chargement…")];
  }
  const data = cachedFoldersFile();
  const sshHosts = visibleHostAliases(aliases ?? [], data);
  const localHosts = visibleHostAliases(localVirtualHosts(data), data);
  const sshSet = new Set(sshHosts.map((alias) => alias.toLowerCase()));
  const roots: HostItem[] = [
    ...sshHosts.map((alias) => new HostItem(alias)),
    ...localHosts
      .filter((alias) => !sshSet.has(alias.toLowerCase()))
      .map((alias) => new HostItem(alias, { local: true })),
  ];
  // Même nom SSH + VirtualHost : les deux apparaissent (icônes distinctes).
  for (const alias of localHosts) {
    if (sshSet.has(alias.toLowerCase())) {
      roots.push(new HostItem(alias, { local: true }));
    }
  }
  if (sortAlphabetical(data)) {
    roots.sort((a, b) => {
      const byName = a.alias.localeCompare(b.alias, "fr", {
        sensitivity: "base",
        numeric: true,
      });
      if (byName !== 0) {
        return byName;
      }
      return Number(a.local) - Number(b.local);
    });
  }
  return roots;
}

export class SshFoldersTreeProvider
  implements vscode.TreeDataProvider<SshFoldersItem>
{
  private readonly onDidChangeTreeDataEmitter =
    new vscode.EventEmitter<SshFoldersItem | undefined | void>();

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private hostsReady = false;

  markHostsReady(): void {
    this.hostsReady = true;
    this.refresh();
  }

  refresh(): void {
    refreshActiveDecorations();
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: SshFoldersItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SshFoldersItem): SshFoldersItem[] {
    try {
      if (!element) {
        const mode = getViewMode();
        if (mode === "byFolder") {
          return listFoldersAlphabetical();
        }
        if (mode === "recent") {
          return listRecentItems();
        }
        return listByHostRoots(this.hostsReady);
      }

      if (element instanceof FolderGroupItem) {
        return element.children;
      }

      if (
        element instanceof HostItem &&
        (element.contextValue === "host" ||
          element.contextValue === "localHost") &&
        getViewMode() === "byHost"
      ) {
        const data = cachedFoldersFile() ?? { folders: {} };
        if (element.local) {
          const folders = localFoldersForHost(data, element.alias).map(
            (entry) => ({
              path: entry.path,
              ...(entry.label ? { label: entry.label } : {}),
            })
          );
          const ordered = sortFolderEntries(folders, {
            alphabetical: sortAlphabetical(data),
            data,
          });
          return ordered.map(
            (entry) => new FolderItem(element.alias, entry, { local: true })
          );
        }
        const folders = foldersForHost(data, element.alias);
        const ordered = sortFolderEntries(folders, {
          alphabetical: sortAlphabetical(data),
          data,
        });
        return ordered.map((entry) => new FolderItem(element.alias, entry));
      }

      return [];
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `SSH - Folders : impossible de charger l'arbre. ${message}`
      );
      return [];
    }
  }
}
