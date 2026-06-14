import path from "path";
import fs from "fs";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");


const isDev = process.env.ELECTRON_DEV === "1" || process.env.NODE_ENV !== "production";
const backendPort = Number(process.env.PORT || 3001);
const vitePort = 8080;
let backendProcess: ChildProcessWithoutNullStreams | null = null;
let mainWindow: BrowserWindow | null = null;

function resolveTsxPath() {
  const binName = process.platform === "win32" ? "tsx.cmd" : "tsx";
  return path.join(process.cwd(), "node_modules", ".bin", binName);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (isDev) {
    window.loadURL(`http://localhost:${vitePort}`);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(process.cwd(), "dist", "index.html");
    window.loadFile(indexPath);
  }

  window.once("ready-to-show", () => {
    window.show();
  });

  return window;
}

function startBackend() {
  const rootDir = app.getPath("userData");
  fs.mkdirSync(rootDir, { recursive: true });

  const tsxPath = resolveTsxPath();
  const serverScript = path.join(process.cwd(), "server", "index.ts");
  const env = {
    ...process.env,
    SMARTPRINT_ROOT_DIR: rootDir,
    PORT: String(backendPort),
    ELECTRON_RUN_AS_NODE: "1",
  };

  const proc = spawn(tsxPath, [serverScript], {
    env,
    stdio: "inherit",
  });

  proc.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`SmartPrint backend exited with code ${code}`);
    }
    if (signal) {
      console.log(`SmartPrint backend was terminated by signal ${signal}`);
    }
  });

  proc.on("error", (error) => {
    console.error("Failed to start SmartPrint backend:", error);
  });

  return proc;
}

app.whenReady().then(() => {
  backendProcess = startBackend();
  mainWindow = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }
});
