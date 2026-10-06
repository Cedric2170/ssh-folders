import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import SSHConfig from "ssh-config";

function expandHome(filePath: string): string {
  if (filePath === "~") {
    return os.homedir();
  }
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

export function getSshConfigPath(): string {
  const custom = vscode.workspace
    .getConfiguration("remote.SSH")
    .get<string>("configFile");
  if (custom && custom.trim()) {
    return expandHome(custom.trim());
  }
  return path.join(os.homedir(), ".ssh", "config");
}

export function sameHost(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function sshRemoteAuthority(alias: string): string {
  const encoded = Buffer.from(JSON.stringify({ hostName: alias }), "utf8").toString(
    "hex"
  );
  return `ssh-remote+${encoded}`;
}

export function hostFromRemoteAuthority(
  authority: string | undefined
): string | undefined {
  if (!authority || !authority.startsWith("ssh-remote+")) {
    return undefined;
  }
  const rest = authority.slice("ssh-remote+".length).split("@")[0];
  if (!rest) {
    return undefined;
  }
  if (/^[0-9a-fA-F]+$/.test(rest) && rest.length % 2 === 0) {
    try {
      const parsed = JSON.parse(Buffer.from(rest, "hex").toString("utf8")) as {
        hostName?: unknown;
      };
      if (typeof parsed.hostName === "string" && parsed.hostName.trim()) {
        return parsed.hostName.trim();
      }
    } catch {
      // Autorité non encodée en JSON hex, on utilise le texte brut.
    }
  }
  return rest;
}

export function currentSshHost(): string | undefined {
  const fromEnv = (vscode.env as { remoteAuthority?: string }).remoteAuthority;
  const fromFolder = vscode.workspace.workspaceFolders?.find(
    (folder) => folder.uri.scheme === "vscode-remote"
  )?.uri.authority;
  return hostFromRemoteAuthority(fromEnv ?? fromFolder);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

async function expandGlob(pattern: string): Promise<string[]> {
  if (!/[*?]/.test(pattern)) {
    try {
      await fs.access(pattern);
      return [pattern];
    } catch {
      return [];
    }
  }

  const dir = path.dirname(pattern);
  const base = path.basename(pattern);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const re = globToRegExp(base);
  return names
    .filter((name) => re.test(name))
    .map((name) => path.join(dir, name))
    .sort();
}

async function readWithIncludes(
  filePath: string,
  seen: Set<string>,
  includePatterns: string[]
): Promise<string> {
  const resolved = path.resolve(filePath);
  if (seen.has(resolved)) {
    return "";
  }
  seen.add(resolved);

  let content: string;
  try {
    content = await fs.readFile(resolved, "utf8");
  } catch {
    return "";
  }

  const dir = path.dirname(resolved);
  const lines: string[] = [];

  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*Include\s+(.+)$/i.exec(line);
    if (!match) {
      lines.push(line);
      continue;
    }

    const raw = match[1].trim().replace(/^["']|["']$/g, "");
    const expanded = expandHome(raw);
    const pattern = path.isAbsolute(expanded)
      ? expanded
      : path.join(dir, expanded);
    includePatterns.push(pattern);
    const files = await expandGlob(pattern);
    for (const included of files) {
      lines.push(await readWithIncludes(included, seen, includePatterns));
    }
  }

  return lines.join("\n");
}

function isConcreteHostAlias(alias: string): boolean {
  return alias.length > 0 && !alias.startsWith("!") && !/[*?]/.test(alias);
}

function hostPatterns(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "val" in part) {
          const token = (part as { val: unknown }).val;
          return typeof token === "string" ? token : "";
        }
        return "";
      })
      .filter((alias) => alias.length > 0);
  }
  return [];
}

type FileStamp = { path: string; mtimeMs: number };

type AliasesCache = {
  path: string;
  stamps: FileStamp[];
  includePatterns: string[];
  aliases: string[];
};

type PersistedHostCache = {
  path: string;
  aliases: string[];
};

const HOST_STATE_KEY = "hostAliasesCache";

let hostMemento: vscode.Memento | undefined;
let aliasesCache: AliasesCache | undefined;
let reloadInFlight: Promise<string[]> | undefined;

export function initHostCache(state: vscode.Memento): void {
  hostMemento = state;
  const raw = state.get<PersistedHostCache>(HOST_STATE_KEY);
  const configPath = getSshConfigPath();
  if (
    !raw ||
    raw.path !== configPath ||
    !Array.isArray(raw.aliases)
  ) {
    return;
  }
  aliasesCache = {
    path: raw.path,
    stamps: [],
    includePatterns: [],
    aliases: raw.aliases.filter(
      (alias): alias is string => typeof alias === "string" && alias.length > 0
    ),
  };
}

function persistHostCache(): void {
  if (!hostMemento || !aliasesCache) {
    return;
  }
  void hostMemento.update(HOST_STATE_KEY, {
    path: aliasesCache.path,
    aliases: aliasesCache.aliases,
  });
}

export function cachedHostAliases(): string[] | undefined {
  const configPath = getSshConfigPath();
  if (aliasesCache && aliasesCache.path === configPath) {
    return aliasesCache.aliases;
  }
  return undefined;
}

export function isCachedSshSource(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  if (path.resolve(getSshConfigPath()) === resolved) {
    return true;
  }
  return Boolean(
    aliasesCache?.stamps.some((item) => item.path === resolved)
  );
}

async function stampFiles(paths: Iterable<string>): Promise<FileStamp[]> {
  const stamps: FileStamp[] = [];
  for (const filePath of paths) {
    try {
      stamps.push({
        path: filePath,
        mtimeMs: (await fs.stat(filePath)).mtimeMs,
      });
    } catch {
      // Fichier disparu : le prochain parse le verra.
    }
  }
  return stamps;
}

async function cacheIsFresh(
  cache: AliasesCache,
  configPath: string
): Promise<boolean> {
  if (cache.path !== configPath) {
    return false;
  }

  const resolvedConfig = path.resolve(configPath);
  try {
    const mtimeMs = (await fs.stat(configPath)).mtimeMs;
    const main = cache.stamps.find((item) => item.path === resolvedConfig);
    if (!main || main.mtimeMs !== mtimeMs) {
      return false;
    }
  } catch {
    return cache.stamps.length === 0;
  }

  const expected = new Set(cache.stamps.map((item) => item.path));
  for (const pattern of cache.includePatterns) {
    for (const included of await expandGlob(pattern)) {
      if (!expected.has(path.resolve(included))) {
        return false;
      }
    }
  }

  for (const item of cache.stamps) {
    try {
      if ((await fs.stat(item.path)).mtimeMs !== item.mtimeMs) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

export async function reloadHostAliases(): Promise<string[]> {
  if (!reloadInFlight) {
    reloadInFlight = parseHostAliases().finally(() => {
      reloadInFlight = undefined;
    });
  }
  return reloadInFlight;
}

export async function listHostAliases(): Promise<string[]> {
  const cached = cachedHostAliases();
  if (cached) {
    return cached;
  }
  return reloadHostAliases();
}

async function parseHostAliases(): Promise<string[]> {
  const configPath = getSshConfigPath();
  const previous = aliasesCache;
  if (
    aliasesCache &&
    aliasesCache.stamps.length > 0 &&
    (await cacheIsFresh(aliasesCache, configPath))
  ) {
    return aliasesCache.aliases;
  }

  const seen = new Set<string>();
  const includePatterns: string[] = [];
  const content = await readWithIncludes(configPath, seen, includePatterns);
  const stamps = await stampFiles(seen);
  if (!content.trim()) {
    let readable = false;
    try {
      readable = (await fs.stat(configPath)).size >= 0;
    } catch {
      readable = false;
    }
    if (!readable && previous?.aliases.length) {
      return previous.aliases;
    }
    aliasesCache = { path: configPath, stamps, includePatterns, aliases: [] };
    persistHostCache();
    return [];
  }

  const parsed = SSHConfig.parse(content);
  const aliases: string[] = [];
  const seenAliases = new Set<string>();

  for (const section of parsed) {
    if (section.type !== SSHConfig.DIRECTIVE) {
      continue;
    }
    if (section.param.toLowerCase() !== "host") {
      continue;
    }
    for (const alias of hostPatterns(section.value)) {
      if (!isConcreteHostAlias(alias)) {
        continue;
      }
      const key = alias.toLowerCase();
      if (seenAliases.has(key)) {
        continue;
      }
      seenAliases.add(key);
      aliases.push(alias);
    }
  }

  aliasesCache = { path: configPath, stamps, includePatterns, aliases };
  persistHostCache();
  return aliases;
}

export async function canonicalHostAlias(name: string): Promise<string> {
  const aliases = await listHostAliases();
  return aliases.find((alias) => sameHost(alias, name)) ?? name;
}
