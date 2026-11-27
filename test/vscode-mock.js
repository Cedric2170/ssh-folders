"use strict";

/** Mock minimal de l'API vscode pour les tests Node. */
const configStore = new Map();

function getConfiguration(section) {
  return {
    get(key, defaultValue) {
      const full = section ? `${section}.${key}` : key;
      if (configStore.has(full)) {
        return configStore.get(full);
      }
      if (configStore.has(key)) {
        return configStore.get(key);
      }
      return defaultValue;
    },
  };
}

function l10nT(message, ...args) {
  return String(message).replace(/\{(\d+)\}/g, (_, index) => {
    const value = args[Number(index)];
    return value === undefined || value === null ? "" : String(value);
  });
}

function createUri(parts) {
  const uri = {
    scheme: parts.scheme,
    authority: parts.authority ?? "",
    path: parts.path ?? "",
    fsPath: parts.fsPath ?? parts.path ?? "",
    with(change) {
      return createUri({
        scheme: change.scheme ?? uri.scheme,
        authority: change.authority ?? uri.authority,
        path: change.path ?? uri.path,
        fsPath: change.fsPath ?? change.path ?? uri.fsPath,
      });
    },
  };
  return uri;
}

module.exports = {
  ExtensionMode: {
    Production: 1,
    Development: 2,
    Test: 3,
  },
  FileType: {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64,
  },
  Uri: {
    file(fsPath) {
      return createUri({ scheme: "file", path: fsPath, fsPath });
    },
    from(components) {
      return createUri(components);
    },
  },
  env: {
    language: "fr",
  },
  l10n: {
    t: l10nT,
  },
  workspace: {
    getConfiguration,
    workspaceFolders: [],
    fs: {
      async stat() {
        const err = new Error("File not found");
        err.code = "FileNotFound";
        throw err;
      },
      async createDirectory() {},
    },
  },
  window: {
    createTreeView() {
      return { dispose() {} };
    },
    showErrorMessage() {
      return Promise.resolve(undefined);
    },
    showWarningMessage() {
      return Promise.resolve(undefined);
    },
    showInformationMessage() {
      return Promise.resolve(undefined);
    },
  },
  /** Helper tests : fixe sshFolders.configPath (ou autre). */
  __setConfig(key, value) {
    configStore.set(key, value);
  },
  __clearConfig() {
    configStore.clear();
  },
};
