const path = require("path");

// Import tsx/cjs to register TypeScript loading support for Electron.
require("tsx/cjs");

require(path.join(__dirname, "main.ts"));
