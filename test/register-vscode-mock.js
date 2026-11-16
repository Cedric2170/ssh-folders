"use strict";

const Module = require("module");
const path = require("path");

const mockPath = path.join(__dirname, "vscode-mock.js");
const originalLoad = Module._load;

Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === "vscode") {
    return originalLoad(mockPath, parent, isMain);
  }
  return originalLoad(request, parent, isMain);
};
