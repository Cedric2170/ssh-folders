import * as vscode from "vscode";
import {
  cachedFoldersFile,
  findFolderEntry,
  folderLabel,
  foldersForHost,
  recentLimit,
  type FolderEntry,
} from "./foldersConfig";
import {
  buildAzFolderTree,
  displayFolderName,
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
import { activeChartColor, activeHex, coloredIconUri } from "./activeColor";
import { isFolderInOpenWindow, isHostInOpenWindow } from "./openWindows";
import { isDevMode } from "./devMode";

const ACTIVE_SCHEME = "ssh-folders-active";
const activeDecorationEmitter = new vscode.EventEmitter<
  vscode.Uri | vscode.Uri[] | undefined
>();

function refreshActiveDecorations(): void {
  activeDecorationEmitter.fire(undefined);
}

function hostIsActive(alias: string): boolean {
  return isActiveSshHost(alias) || isHostInOpenWindow(alias);
}

function folderIsActive(alias: string, folderPath: string): boolean {
  return (
    isActiveRemoteFolder(alias, folderPath) ||
    isFolderInOpenWindow(alias, folderPath)
  );
}

function activeIcon(
  iconId: string,
  active: boolean
): vscode.ThemeIcon | vscode.Uri {
  if (!active) {
    return new vscode.ThemeIcon(iconId);
  }
  return coloredIconUri(iconId, activeHex());
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
    return { color: activeChartColor() };
  }
}

export type OpenTarget = {
  kind: "host" | "folder";
  alias: string;
  path?: string;
};

export class HostItem extends vscode.TreeItem {
  readonly contextValue: "host" | "recentHost";
  readonly kind = "host" as const;

  constructor(
    public readonly alias: string,
    options: { description?: string; tooltip?: string; recent?: boolean } = {}
  ) {
    super(alias, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = options.recent ? "recentHost" : "host";
    this.id = options.recent ? `recent:host:${alias}` : `host:${alias}`;
    const active = hostIsActive(alias);
    this.iconPath = activeIcon("server", active);
    this.tooltip = options.tooltip ?? alias;
    if (active) {
      this.resourceUri = activeResource(this.id);
      this.tooltip = `${this.tooltip}\nConnexion active`;
      this.accessibilityInformation = {
        label: options.description
          ? `${alias}, ${options.description}, connexion active`
          : `${alias}, connexion active`,
      };
    }
    if (options.description) {
      this.description = options.description;
      this.collapsibleState = vscode.TreeItemCollapsibleState.None;
      this.command = {
        command: "sshFolders.openInNewWindow",
        title: "Ouvrir dans une nouvelle fenêtre",
        arguments: [{ kind: "host", alias } satisfies OpenTarget],
      };
    }
  }
}

export class FolderItem extends vscode.TreeItem {
  readonly contextValue: "folder" | "recentFolder";
  readonly kind = "folder" as const;
  readonly path: string;
  readonly active: boolean;

  constructor(
    public readonly alias: string,
    public readonly entry: FolderEntry,
    options: {
      flat?: boolean;
      title?: string;
      description?: string;
      tooltip?: string;
      recent?: boolean;
    } = {}
  ) {
    super(
      options.title ?? folderLabel(entry),
      vscode.TreeItemCollapsibleState.None
    );
    this.contextValue = options.recent ? "recentFolder" : "folder";
    this.path = entry.path;
    this.active = folderIsActive(alias, entry.path);
    this.id = options.recent
      ? `recent:folder:${alias}:${entry.path}`
      : `folder:${alias}:${entry.path}`;
    this.iconPath = activeIcon("symbol-folder", this.active);
    this.command = {
      command: "sshFolders.openInNewWindow",
      title: "Ouvrir dans une nouvelle fenêtre",
      arguments: [{ kind: "folder", alias, path: entry.path } satisfies OpenTarget],
    };
    if (options.description !== undefined) {
      this.description = options.description;
    } else if (options.flat) {
      this.description = alias;
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
    return `Dossiers A-Z${suffix}`;
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
  });
}

function listFoldersAlphabetical(): SshFoldersItem[] {
  const data = cachedFoldersFile() ?? { folders: {} };
  const refs: AzFolderRef[] = [];
  for (const [alias, entries] of Object.entries(data.folders)) {
    for (const entry of entries) {
      refs.push({ alias, entry });
    }
  }

  return buildAzFolderTree(refs).map((node) => {
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
    const relative = formatRelativeAccess(access.at);
    if (access.kind === "host") {
      items.push(
        new HostItem(access.alias, {
          description: relative,
          tooltip: recentTooltip(access, access.alias),
          recent: true,
        })
      );
      continue;
    }
    if (!access.path) {
      continue;
    }
    const entry =
      findFolderEntry(data, access.alias, access.path) ?? { path: access.path };
    items.push(
      new FolderItem(access.alias, entry, {
        flat: true,
        title: displayFolderName(entry),
        description: `${access.alias} · ${relative}`,
        tooltip: recentTooltip(access, `${access.alias}:${access.path}`),
        recent: true,
      })
    );
  }
  return items;
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
        const aliases = cachedHostAliases();
        if (aliases === undefined && !this.hostsReady) {
          return [new StatusItem("Chargement…")];
        }
        return (aliases ?? []).map((alias) => new HostItem(alias));
      }

      if (element instanceof FolderGroupItem) {
        return element.children;
      }

      if (element.contextValue === "host" && getViewMode() === "byHost") {
        const data = cachedFoldersFile() ?? { folders: {} };
        const folders = foldersForHost(data, element.alias);
        return folders.map((entry) => new FolderItem(element.alias, entry));
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
