// Wrapper to load TypeScript main file with tsx
require("tsx").default([require.resolve("./main.ts")]);
const tsx = require("tsx/cjs");
const path = require("path");
tsx.register();
require(path.join(__dirname, "main.ts"));
