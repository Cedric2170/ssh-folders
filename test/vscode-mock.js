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

module.exports = {
  ExtensionMode: {
    Production: 1,
    Development: 2,
    Test: 3,
  },
  Uri: {
    file(fsPath) {
      return { fsPath, scheme: "file" };
    },
  },
  workspace: {
    getConfiguration,
    workspaceFolders: [],
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
