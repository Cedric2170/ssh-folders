import * as vscode from "vscode";
import {
  expandLocalPath,
  hostPatternMatches,
  isArchiveFolderPath,
  isFavoriteFolder,
  isFavoriteHost,
  parseIconPaletteColor,
  type FolderEntry,
  type FoldersFile,
  type IconColorFilter,
  type IconPaletteName,
  type LocalFolderEntry,
} from "./foldersConfig";
import { sameHost } from "./sshConfig";

export type { IconColorFilter } from "./foldersConfig";

const PALETTE_THEME_COLOR_IDS: Record<IconPaletteName, string> = {
  green: "charts.green",
  blue: "charts.blue",
  orange: "charts.orange",
  red: "charts.red",
  purple: "charts.purple",
  yellow: "charts.yellow",
  cyan: "terminal.ansiCyan",
  teal: "terminal.ansiBrightCyan",
  magenta: "terminal.ansiMagenta",
  pink: "terminal.ansiBrightMagenta",
  brown: "terminal.ansiBrightBlack",
  grey: "disabledForeground",
  lime: "terminal.ansiBrightGreen",
  indigo: "terminal.ansiBlue",
  gold: "terminal.ansiBrightYellow",
  coral: "terminal.ansiBrightRed",
  olive: "terminal.ansiGreen",
  navy: "terminal.ansiBlue",
  rose: "terminal.ansiRed",
  amber: "terminal.ansiYellow",
};

export function themeColorForPalette(name: IconPaletteName): vscode.ThemeColor {
  return new vscode.ThemeColor(PALETTE_THEME_COLOR_IDS[name]);
}

function pathPatternMatches(pattern: string, folderPath: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = folderPath.includes("~")
    ? expandLocalPath(folderPath)
    : folderPath;
  if (!/[*?]/.test(trimmed)) {
    return normalized.localeCompare(trimmed, undefined, {
      sensitivity: "accent",
    }) === 0;
  }
  const escaped = trimmed
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(normalized);
}

function filterHasMatcher(filter: IconColorFilter): boolean {
  return (
    filter.name !== undefined ||
    filter.path !== undefined ||
    filter.favorite === true ||
    filter.archive === true
  );
}

function iconColorFilters(data: FoldersFile | undefined): IconColorFilter[] {
  const list = data?.defaults?.IconColorFilters;
  return Array.isArray(list) ? list : [];
}

function explicitHostIconColor(
  alias: string,
  data: FoldersFile | undefined
): IconPaletteName | undefined {
  const map = data?.defaults?.HostIconColors;
  if (!map || typeof map !== "object") {
    return undefined;
  }
  for (const [key, value] of Object.entries(map)) {
    if (!sameHost(key, alias)) {
      continue;
    }
    if (typeof value === "string") {
      return parseIconPaletteColor(value) ?? undefined;
    }
  }
  return undefined;
}

function explicitFolderIconColor(
  entry: FolderEntry | LocalFolderEntry
): IconPaletteName | undefined {
  return entry.color;
}

function filterMatchesHost(
  filter: IconColorFilter,
  alias: string,
  data: FoldersFile | undefined
): boolean {
  if (filter.scope !== "host" || !filterHasMatcher(filter)) {
    return false;
  }
  if (filter.archive === true || filter.path) {
    return false;
  }
  if (filter.favorite === true && !isFavoriteHost(alias, data)) {
    return false;
  }
  if (filter.name && !hostPatternMatches(filter.name, alias)) {
    return false;
  }
  return true;
}

function filterMatchesFolder(
  filter: IconColorFilter,
  alias: string,
  entry: FolderEntry | LocalFolderEntry,
  data: FoldersFile | undefined
): boolean {
  if (filter.scope !== "folder" || !filterHasMatcher(filter)) {
    return false;
  }
  if (filter.favorite === true && !isFavoriteFolder(entry)) {
    return false;
  }
  if (
    filter.archive === true &&
    !isArchiveFolderPath(entry.path, data)
  ) {
    return false;
  }
  if (filter.name && !hostPatternMatches(filter.name, alias)) {
    return false;
  }
  if (filter.path && !pathPatternMatches(filter.path, entry.path)) {
    return false;
  }
  return true;
}

export function resolveHostIconPalette(
  alias: string,
  data: FoldersFile | undefined
): IconPaletteName | undefined {
  const explicit = explicitHostIconColor(alias, data);
  if (explicit) {
    return explicit;
  }
  for (const filter of iconColorFilters(data)) {
    if (filterMatchesHost(filter, alias, data)) {
      return filter.color;
    }
  }
  return undefined;
}

export function resolveFolderIconPalette(
  alias: string,
  entry: FolderEntry | LocalFolderEntry,
  data: FoldersFile | undefined
): IconPaletteName | undefined {
  const explicit = explicitFolderIconColor(entry);
  if (explicit) {
    return explicit;
  }
  for (const filter of iconColorFilters(data)) {
    if (filterMatchesFolder(filter, alias, entry, data)) {
      return filter.color;
    }
  }
  return undefined;
}