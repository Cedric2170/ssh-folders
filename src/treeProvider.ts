import * as vscode from "vscode";
import {
  cachedFoldersFile,
  compareHostRoots,
  expandLocalPath,
  findFolderEntry,
  findLocalFolderEntry,
  folderLabel,
  foldersForHost,
  groupSameName,
  isArchiveFolderPath,
  isFavoriteFolder,
  isFavoriteHost,
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
  compareText,
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
import {
  resolveFolderIconPalette,
  resolveHostIconPalette,
  themeColorForPalette,
} from "./iconColors";
import type { IconPaletteName } from "./foldersConfig";

const ACTIVE_SCHEME = "ssh-folders-active";
const ARCHIVE_SCHEME = "ssh-folders-archive";
const activeColor = new vscode.ThemeColor("sshFolders.activeForeground");
const archiveColor = new vscode.ThemeColor("disabledForeground");
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

function treeItemIcon(
  iconId: string,
  options: {
    active: boolean;
    archive: boolean;
    palette?: IconPaletteName;
  }
): vscode.ThemeIcon {
  if (options.active) {
    return new vscode.ThemeIcon(iconId, activeColor);
  }
  if (options.archive) {
    return new vscode.ThemeIcon(iconId, archiveColor);
  }
  if (options.palette) {
    return new vscode.ThemeIcon(iconId, themeColorForPalette(options.palette));
  }
  return new vscode.ThemeIcon(iconId);
}

function activeResource(id: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: ACTIVE_SCHEME,
    path: "/item",
    query: id,
  });
}

function archiveResource(id: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: ARCHIVE_SCHEME,
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
    if (uri.scheme === ACTIVE_SCHEME) {
      return { color: activeColor };
    }
    if (uri.scheme === ARCHIVE_SCHEME) {
      return { color: archiveColor, tooltip: vscode.l10n.t("Archive") };
    }
    return undefined;
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
  readonly favorite: boolean;

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
    this.favorite =
      options.recent !== true && isFavoriteHost(alias, cachedFoldersFile());
    if (this.local) {
      this.contextValue = options.recent ? "recentLocalHost" : "localHost";
      this.id = options.recent
        ? `recent:localHost:${alias}`
        : `localHost:${alias}`;
    } else {
      this.contextValue = options.recent ? "recentHost" : "host";
      this.id = options.recent ? `recent:host:${alias}` : `host:${alias}`;
    }
    const data = cachedFoldersFile();
    const active = hostIsActive(alias, this.local);
    const baseIcon = this.local
      ? "device-desktop"
      : this.favorite
        ? "star-full"
        : "server";
    const palette = active ? undefined : resolveHostIconPalette(alias, data);
    this.iconPath = treeItemIcon(baseIcon, { active, archive: false, palette });
    this.tooltip =
      options.tooltip ??
      (this.local ? vscode.l10n.t("{0} (local)", alias) : alias);
    if (this.favorite) {
      this.tooltip = `${this.tooltip}\n${vscode.l10n.t("Favorite")}`;
    }
    if (active) {
      this.resourceUri = activeResource(this.id);
      this.tooltip = `${this.tooltip}\n${
        this.local
          ? vscode.l10n.t("Local folder open")
          : vscode.l10n.t("Active connection")
      }`;
      const activeLabel = this.local
        ? vscode.l10n.t("local open")
        : vscode.l10n.t("active connection");
      this.accessibilityInformation = {
        label: options.description
          ? vscode.l10n.t("{0}, {1}, {2}", alias, options.description, activeLabel)
          : vscode.l10n.t("{0}, {1}", alias, activeLabel),
      };
    }
    if (options.description) {
      this.description = options.description;
      this.collapsibleState = vscode.TreeItemCollapsibleState.None;
      this.command = {
        command: "sshFolders.openInNewWindow",
        title: vscode.l10n.t("Open in new window"),
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
  readonly archive: boolean;
  readonly favorite: boolean;
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
      /** Préfixe d'id pour une copie en section Favoris (vue A-Z). */
      idPrefix?: string;
    } = {}
  ) {
    super(
      options.title ?? folderLabel(entry),
      vscode.TreeItemCollapsibleState.None
    );
    this.local = options.local === true;
    this.favorite = isFavoriteFolder(entry);
    const idPrefix = options.idPrefix ?? "";
    if (this.local) {
      this.contextValue = options.recent ? "recentLocalFolder" : "localFolder";
      this.id = options.recent
        ? `recent:localFolder:${alias}:${entry.path}`
        : `${idPrefix}localFolder:${alias}:${entry.path}`;
    } else {
      this.contextValue = options.recent ? "recentFolder" : "folder";
      this.id = options.recent
        ? `recent:folder:${alias}:${entry.path}`
        : `${idPrefix}folder:${alias}:${entry.path}`;
    }
    this.path = entry.path;
    this.active = folderIsActive(alias, entry.path, this.local);
    this.archive =
      !this.active &&
      isArchiveFolderPath(entry.path, cachedFoldersFile());
    // Même icône local/distant : le glyphe `folder` décale le libellé (fausse indentation).
    // La distinction reste dans la description (`· local`) et l'icône du VirtualHost.
    const iconId = this.favorite ? "star-full" : "symbol-folder";
    const palette =
      this.active || this.archive
        ? undefined
        : resolveFolderIconPalette(alias, entry, cachedFoldersFile());
    this.iconPath = treeItemIcon(iconId, {
      active: this.active,
      archive: this.archive,
      palette,
    });
    this.command = {
      command: "sshFolders.openInNewWindow",
      title: vscode.l10n.t("Open in new window"),
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
      this.description = this.local
        ? vscode.l10n.t("{0} · local", alias)
        : alias;
    } else {
      this.description = entry.path;
    }
    this.tooltip =
      options.tooltip ??
      (options.flat
        ? `${this.label} — ${alias}:${entry.path}`
        : `${alias}:${entry.path}`);
    if (this.favorite) {
      this.tooltip = `${this.tooltip}\n${vscode.l10n.t("Favorite")}`;
    }
    if (this.active) {
      this.resourceUri = activeResource(this.id);
      this.tooltip = `${this.tooltip}\n${vscode.l10n.t("Active folder")}`;
      const label = this.label?.toString() ?? folderLabel(entry);
      this.accessibilityInformation = {
        label: vscode.l10n.t(
          "{0}, {1}, active folder",
          label,
          String(this.description ?? entry.path)
        ),
      };
    } else if (this.archive) {
      this.resourceUri = archiveResource(this.id);
      this.tooltip = `${this.tooltip}\n${vscode.l10n.t("Archive (inactive)")}`;
      const label = this.label?.toString() ?? folderLabel(entry);
      this.accessibilityInformation = {
        label: vscode.l10n.t(
          "{0}, {1}, archive",
          label,
          String(this.description ?? entry.path)
        ),
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
    active = false,
    options: { favorites?: boolean } = {}
  ) {
    super(
      groupName,
      options.favorites
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    const archive =
      !active &&
      !options.favorites &&
      children.length > 0 &&
      children.every((child) => child.archive);
    this.id = options.favorites
      ? `group:favorites:${stem}`
      : archive
        ? `group:archive:${stem}`
        : `group:${stem}`;
    this.iconPath = options.favorites
      ? new vscode.ThemeIcon("star-full")
      : archive
        ? new vscode.ThemeIcon("layers", archiveColor)
        : treeItemIcon("layers", { active, archive, palette: undefined });
    this.tooltip = options.favorites
      ? vscode.l10n.t(
          "{0}\nPinned at the top; also shown in the list below",
          groupName
        )
      : active
        ? vscode.l10n.t("{0}\nActive folder", groupName)
        : archive
          ? vscode.l10n.t("{0}\nArchive (inactive)", groupName)
          : groupName;
    if (active) {
      this.resourceUri = activeResource(this.id);
      this.accessibilityInformation = {
        label: vscode.l10n.t("{0}, active folder", groupName),
      };
    } else if (archive) {
      this.resourceUri = archiveResource(this.id);
      this.accessibilityInformation = {
        label: vscode.l10n.t("{0}, archive", groupName),
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
    const title = sortAlphabetical(cachedFoldersFile())
      ? vscode.l10n.t("Folders A-Z")
      : vscode.l10n.t("Folders");
    return `${title}${suffix}`;
  }
  if (mode === "recent") {
    return `${vscode.l10n.t("Recent access")}${suffix}`;
  }
  return `${vscode.l10n.t("SSH - Folders")}${suffix}`;
}

function toFlatFolderItem(
  ref: AzFolderRef,
  options: { idPrefix?: string } = {}
): FolderItem {
  return new FolderItem(ref.alias, ref.entry, {
    flat: true,
    title: displayFolderName(ref.entry),
    local: ref.local,
    ...(options.idPrefix ? { idPrefix: options.idPrefix } : {}),
  });
}

function toFolderEntryFromLocal(entry: {
  path: string;
  label?: string;
  favorite?: boolean;
}): FolderEntry {
  return {
    path: entry.path,
    ...(entry.label ? { label: entry.label } : {}),
    ...(entry.favorite === true ? { favorite: true } : {}),
  };
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
        entry: toFolderEntryFromLocal(entry),
        local: true,
      });
    }
  }

  const favorites = refs
    .filter((ref) => isFavoriteFolder(ref.entry))
    .sort((a, b) => {
      const byName = compareText(
        displayFolderName(a.entry),
        displayFolderName(b.entry)
      );
      if (byName !== 0) {
        return byName;
      }
      return compareText(a.alias, b.alias);
    });

  const normal = buildAzFolderTree(refs, {
    sort: sortAlphabetical(data),
    group: groupSameName(data),
    data,
  }).map((node) => {
    if (node.kind === "leaf") {
      return toFlatFolderItem(node.item);
    }
    const children = node.items.map((item) => toFlatFolderItem(item));
    return new FolderGroupItem(
      node.name,
      node.stem,
      children,
      children.some((child) => child.active)
    );
  });

  if (favorites.length === 0) {
    return normal;
  }
  const favoriteItems = favorites.map((ref) =>
    toFlatFolderItem(ref, { idPrefix: "fav:" })
  );
  return [
    new FolderGroupItem(vscode.l10n.t("Favorites"), "favoris", favoriteItems, false, {
      favorites: true,
    }),
    ...normal,
  ];
}

function recentTooltip(entry: RecentAccess, detail: string): string {
  const when = new Date(entry.at).toLocaleString(vscode.env.language);
  return vscode.l10n.t("{0}\nLast access: {1}", detail, when);
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
            local
              ? vscode.l10n.t("{0} (local)", access.alias)
              : access.alias
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
        description: local
          ? vscode.l10n.t("{0} · local · {1}", access.alias, relative)
          : `${access.alias} · ${relative}`,
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
    return [new StatusItem(vscode.l10n.t("Loading…"))];
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
  roots.sort((a, b) => compareHostRoots(a, b, data));
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
            (entry) => toFolderEntryFromLocal(entry)
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
        vscode.l10n.t(
          "SSH - Folders: unable to load the tree. {0}",
          message
        )
      );
      return [];
    }
  }
}
