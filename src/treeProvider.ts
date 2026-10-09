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
import { cachedHostAliases } from "./sshConfig";
import { isDevMode } from "./devMode";

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
    this.iconPath = new vscode.ThemeIcon("server");
    this.tooltip = options.tooltip ?? alias;
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
    this.id = options.recent
      ? `recent:folder:${alias}:${entry.path}`
      : `folder:${alias}:${entry.path}`;
    this.iconPath = new vscode.ThemeIcon("symbol-folder");
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
  }
}

export class FolderGroupItem extends vscode.TreeItem {
  readonly contextValue = "folderGroup";
  readonly kind = "group" as const;

  constructor(
    public readonly groupName: string,
    public readonly stem: string,
    public readonly children: FolderItem[]
  ) {
    super(groupName, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `group:${stem}`;
    this.iconPath = new vscode.ThemeIcon("layers");
    this.tooltip = groupName;
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
    return new FolderGroupItem(
      node.name,
      node.stem,
      node.items.map(toFlatFolderItem)
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
