import {
  folderLabel,
  lastFolderRank,
  type FolderEntry,
  type FoldersFile,
} from "./foldersConfig";

export type AzFolderRef = {
  alias: string;
  entry: FolderEntry;
};

export type AzGroup = {
  kind: "group";
  name: string;
  stem: string;
  items: AzFolderRef[];
};

export type AzLeaf = {
  kind: "leaf";
  name: string;
  item: AzFolderRef;
};

export type AzNode = AzGroup | AzLeaf;

const COMPARE = { sensitivity: "base", numeric: true } as const;

export function titleCaseName(value: string): string {
  const lower = value.toLocaleLowerCase("fr");
  let result = "";
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    const prev = i === 0 ? "" : lower[i - 1];
    if (i === 0 || prev === " " || prev === "-") {
      result += ch.toLocaleUpperCase("fr");
    } else {
      result += ch;
    }
  }
  return result;
}

export function displayFolderName(entry: FolderEntry): string {
  return titleCaseName(folderLabel(entry));
}

function groupStem(label: string): string {
  const trimmed = label.trim();
  const match = trimmed.match(/^[\p{L}\p{N}]+/u);
  return (match ? match[0] : trimmed).toLocaleLowerCase("fr");
}

function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) {
    return "";
  }
  const lower = values.map((value) => value.toLocaleLowerCase("fr"));
  let prefix = lower[0];
  for (const value of lower.slice(1)) {
    let index = 0;
    while (
      index < prefix.length &&
      index < value.length &&
      prefix[index] === value[index]
    ) {
      index += 1;
    }
    prefix = prefix.slice(0, index);
  }
  return prefix.replace(/[-_\s]+$/u, "");
}

export function compareText(a: string, b: string): number {
  return a.localeCompare(b, "fr", COMPARE);
}

export function sortHostAliases(aliases: readonly string[]): string[] {
  return [...aliases].sort(compareText);
}

function compareByLastFolder(
  aLabel: string,
  bLabel: string,
  data: FoldersFile | undefined
): number {
  const aRank = lastFolderRank(aLabel, data);
  const bRank = lastFolderRank(bLabel, data);
  const aLast = aRank >= 0;
  const bLast = bRank >= 0;
  if (aLast !== bLast) {
    return aLast ? 1 : -1;
  }
  if (aLast && bLast && aRank !== bRank) {
    return aRank - bRank;
  }
  return 0;
}

export function sortFolderEntries(
  entries: readonly FolderEntry[],
  options: { alphabetical?: boolean; data?: FoldersFile } = {}
): FolderEntry[] {
  const alphabetical = options.alphabetical !== false;
  const data = options.data;
  return [...entries].sort((a, b) => {
    const byLast = compareByLastFolder(folderLabel(a), folderLabel(b), data);
    if (byLast !== 0) {
      return byLast;
    }
    if (!alphabetical) {
      return 0;
    }
    const byName = compareText(displayFolderName(a), displayFolderName(b));
    if (byName !== 0) {
      return byName;
    }
    return a.path.localeCompare(b.path);
  });
}

function compareRefs(
  a: AzFolderRef,
  b: AzFolderRef,
  data: FoldersFile | undefined
): number {
  const byLast = compareByLastFolder(
    folderLabel(a.entry),
    folderLabel(b.entry),
    data
  );
  if (byLast !== 0) {
    return byLast;
  }
  const byName = compareText(displayFolderName(a.entry), displayFolderName(b.entry));
  if (byName !== 0) {
    return byName;
  }
  const byHost = compareText(a.alias, b.alias);
  if (byHost !== 0) {
    return byHost;
  }
  return a.entry.path.localeCompare(b.entry.path);
}

function nodeLastFolderRank(
  node: AzNode,
  data: FoldersFile | undefined
): number {
  if (node.kind === "leaf") {
    return lastFolderRank(folderLabel(node.item.entry), data);
  }
  return lastFolderRank(node.name, data);
}

export function buildAzFolderTree(
  items: AzFolderRef[],
  options: { sort?: boolean; data?: FoldersFile } = {}
): AzNode[] {
  const sort = options.sort !== false;
  const data = options.data;
  const buckets = new Map<string, AzFolderRef[]>();
  for (const item of items) {
    const stem = groupStem(folderLabel(item.entry));
    const list = buckets.get(stem) ?? [];
    list.push(item);
    buckets.set(stem, list);
  }

  const nodes: AzNode[] = [];
  for (const [stem, list] of buckets) {
    if (sort) {
      list.sort((a, b) => compareRefs(a, b, data));
    }
    if (list.length === 1) {
      const item = list[0];
      nodes.push({
        kind: "leaf",
        name: displayFolderName(item.entry),
        item,
      });
      continue;
    }
    const prefix = longestCommonPrefix(list.map((item) => folderLabel(item.entry)));
    nodes.push({
      kind: "group",
      name: titleCaseName(prefix || stem),
      stem,
      items: list,
    });
  }

  if (sort) {
    nodes.sort((a, b) => {
      const aRank = nodeLastFolderRank(a, data);
      const bRank = nodeLastFolderRank(b, data);
      const aLast = aRank >= 0;
      const bLast = bRank >= 0;
      if (aLast !== bLast) {
        return aLast ? 1 : -1;
      }
      if (aLast && bLast && aRank !== bRank) {
        return aRank - bRank;
      }
      return compareText(a.name, b.name);
    });
  } else if (data) {
    nodes.sort((a, b) => {
      const aRank = nodeLastFolderRank(a, data);
      const bRank = nodeLastFolderRank(b, data);
      const aLast = aRank >= 0;
      const bLast = bRank >= 0;
      if (aLast !== bLast) {
        return aLast ? 1 : -1;
      }
      if (aLast && bLast && aRank !== bRank) {
        return aRank - bRank;
      }
      return 0;
    });
  }
  return nodes;
}
