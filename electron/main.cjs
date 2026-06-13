const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { app, BrowserWindow } = require("electron");

const isDev = process.env.ELECTRON_DEV === "1" || process.env.NODE_ENV !== "production";
const backendPort = Number(process.env.PORT || 3001);
const vitePort = 8080;
let backendProcess = null;
let mainWindow = null;

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

  const serverScript = path.join(process.cwd(), "server", "index.js");
  const env = {
    ...process.env,
    SMARTPRINT_ROOT_DIR: rootDir,
    PORT: String(backendPort),
    ELECTRON_RUN_AS_NODE: "1",
  };

  const proc = spawn(process.execPath, [serverScript], {
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
