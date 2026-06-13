import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { WebSocketServer } from "ws";
import initSqlJs from "sql.js";
import whatsappWebJs from "whatsapp-web.js";
import pdfToPrinter from "pdf-to-printer";

const { Client, LocalAuth } = whatsappWebJs;
const { print } = pdfToPrinter;

const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (Number.isFinite(nodeMajor) && nodeMajor < 18) {
  console.error("Node.js v18.0.0 or higher is required for whatsapp-web.js.");
  process.exit(1);
}

function resolveBrowserExecutablePath() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    "Could not find Chrome or Edge. Install Google Chrome, or set PUPPETEER_EXECUTABLE_PATH to a valid browser executable."
  );
}

const browserExecutablePath = resolveBrowserExecutablePath();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const rootDir = process.env.SMARTPRINT_ROOT_DIR || process.cwd();
const stateDir = path.join(rootDir, "server-state");
const downloadsDir = path.join(rootDir, "downloads");
const convertedDir = path.join(downloadsDir, "converted");
const inboxDirs = {
  pdfs: path.join(downloadsDir, "pdfs"),
  images: path.join(downloadsDir, "images"),
  texts: path.join(downloadsDir, "texts"),
  others: path.join(downloadsDir, "others"),
};
const whatsappSessionDir = path.join(stateDir, "whatsapp-session");
const sqliteFilePath = path.join(stateDir, "smartprint.sqlite");
let db = null;
let SQL = null;

app.use(express.json({ limit: "20mb" }));

// Simple timestamped logger that writes to console and to a log file.
const logsDir = path.join(stateDir, "logs");
fs.mkdirSync(logsDir, { recursive: true });
const logFile = path.join(logsDir, `server-${new Date().toISOString().slice(0,10)}.log`);

function formatMessage(level, message, meta) {
  const ts = new Date().toISOString();
  let base = `[${ts}] [${level.toUpperCase()}] ${message}`;
  if (meta) {
    try { base += ` ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`; } catch { /* ignore */ }
  }
  return base;
}

function writeLog(line) {
  try { fs.appendFileSync(logFile, `${line}\n`); } catch (e) { /* don't crash on logging failures */ }
}

const logger = {
  info: (msg, meta) => { const m = formatMessage('info', msg, meta); console.log(m); writeLog(m); },
  warn: (msg, meta) => { const m = formatMessage('warn', msg, meta); console.warn(m); writeLog(m); },
  error: (msg, meta) => { const m = formatMessage('error', msg, meta); console.error(m); writeLog(m); },
  debug: (msg, meta) => { const m = formatMessage('debug', msg, meta); console.debug ? console.debug(m) : console.log(m); writeLog(m); },
};

// Express request logging
app.use((req, _res, next) => {
  logger.info(`HTTP ${req.method} ${req.url}`, { headers: req.headers });
  next();
});

// Global exception handlers to capture unhandled errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err && (err.stack || err.message || err));
});

let lastResetAt = 0;
const RESET_COOLDOWN_MS = 60 * 1000; // don't auto-reset more than once per minute

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function removeDirWithRetries(dir, attempts = 6, delayMs = 300) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      // If last attempt, rethrow
      if (i === attempts - 1) throw e;
      await sleep(delayMs);
    }
  }
}

process.on('unhandledRejection', async (reason) => {
  logger.error('Unhandled promise rejection', reason && (reason.stack || reason));

  const text = reason && (reason.message || reason.stack || String(reason));
  if (typeof text === 'string' && /(Protocol error|Target closed|frame detached|Runtime.callFunctionOn)/i.test(text)) {
    const now = Date.now();
    if (now - lastResetAt > RESET_COOLDOWN_MS) {
      lastResetAt = now;
      logger.warn('Detected Puppeteer/Protocol error; attempting graceful WhatsApp reset');
      try {
        await resetWhatsAppSession();
      } catch (e) {
        logger.error('Automatic reset after protocol error failed', e && (e.stack || e.message || e));
      }
    } else {
      logger.info('Protocol error detected but reset suppressed due to cooldown');
    }
  }
});

const state = {
  status: "connecting",
  qr: null,
  error: null,
  documents: [],
  queue: [],
};

let processedMessageIds = new Set();
let whatsappClient = null;
let queueRunning = false;

function ensureDirectories() {
  [stateDir, downloadsDir, convertedDir, ...Object.values(inboxDirs), whatsappSessionDir].forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true });
  });
}

function resolveSofficePath() {
  const candidates = [
    process.env.SOFFICE_PATH,
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

const CONVERTIBLE_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".txt",
  ".rtf",
  ".odt",
  ".csv",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
]);

async function convertToPdfIfNeeded(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return filePath;

  if (!CONVERTIBLE_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported auto-print format: ${extension || "(no extension)"}. Send a PDF, DOCX, TXT, or another Office document.`);
  }

  const sofficePath = resolveSofficePath();
  if (!sofficePath) {
    throw new Error("LibreOffice was not found. Install LibreOffice or set SOFFICE_PATH to enable DOCX/TXT auto-print conversion.");
  }

  const outputFileName = `${path.basename(filePath, extension)}.pdf`;
  const convertedPath = path.join(convertedDir, outputFileName);

  await new Promise((resolve, reject) => {
    execFile(
      sofficePath,
      ["--headless", "--convert-to", "pdf", "--outdir", convertedDir, filePath],
      { windowsHide: true },
      (error) => {
        if (error) {
          reject(new Error(`Document conversion failed: ${error.message}`));
          return;
        }
        resolve();
      }
    );
  });

  if (!fs.existsSync(convertedPath)) {
    throw new Error("Document conversion finished but no PDF output was created.");
  }

  return convertedPath;
}

function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

async function initializeDatabase() {
  SQL = await initSqlJs({
    locateFile: (file) => path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "sql.js", "dist", file),
  });

  const buffer = fs.existsSync(sqliteFilePath) ? fs.readFileSync(sqliteFilePath) : null;
  db = buffer ? new SQL.Database(buffer) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      sender TEXT,
      timestamp TEXT,
      message_text TEXT,
      local_path TEXT NOT NULL,
      mime_type TEXT,
      size_kb INTEGER,
      category TEXT,
      copies INTEGER,
      page_range TEXT,
      color_mode TEXT,
      orientation TEXT,
      sides TEXT,
      status TEXT DEFAULT 'new',
      processed_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function allRows(statement) {
  const rows = [];
  while (statement.step()) {
    rows.push(statement.getAsObject());
  }
  statement.free();
  return rows;
}

function loadDocumentsFromDatabase() {
  const stmt = db.prepare("SELECT * FROM documents ORDER BY timestamp DESC");
  const rows = allRows(stmt);
  state.documents = rows
    .filter((row) => row.status === "new")
    .slice(0, 100)
    .map((row) => ({
      id: row.id,
      fileName: row.file_name,
      sender: row.sender || "Unknown sender",
      timestamp: row.timestamp,
      messageText: row.message_text || "",
      localPath: row.local_path,
      mimeType: row.mime_type,
      sizeKB: row.size_kb,
      category: row.category || "others",
      autoFill: {
        copies: row.copies || 1,
        pageRange: row.page_range || "All pages",
        colorMode: row.color_mode || "Color",
        orientation: row.orientation || "Portrait",
        sides: row.sides || "Single-sided",
      },
      status: row.status || "new",
    }));
  processedMessageIds = new Set(rows.map((row) => row.id));
}

function saveDocumentToDatabase(document) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO documents (
      id, file_name, sender, timestamp, message_text, local_path,
      mime_type, size_kb, category, copies, page_range,
      color_mode, orientation, sides, status, processed_at
    ) VALUES (
      @id, @fileName, @sender, @timestamp, @messageText, @localPath,
      @mimeType, @sizeKB, @category, @copies, @pageRange,
      @colorMode, @orientation, @sides, @status, @processedAt
    )
  `);

  stmt.run({
    id: document.id,
    fileName: document.fileName,
    sender: document.sender,
    timestamp: document.timestamp,
    messageText: document.messageText,
    localPath: document.localPath,
    mimeType: document.mimeType,
    sizeKB: document.sizeKB,
    category: document.category,
    copies: document.autoFill?.copies || 1,
    pageRange: document.autoFill?.pageRange || "All pages",
    colorMode: document.autoFill?.colorMode || "Color",
    orientation: document.autoFill?.orientation || "Portrait",
    sides: document.autoFill?.sides || "Single-sided",
    status: document.status || "new",
    processedAt: new Date().toISOString(),
  });
  stmt.free();
  saveDatabase();
}

function updateDocumentStatus(documentId, status) {
  const stmt = db.prepare("UPDATE documents SET status = ? WHERE id = ?");
  stmt.run(status, documentId);
  stmt.free();
  try {
    saveDatabase();
    logger.info('Updated document status', { id: documentId, status });
  } catch (err) {
    logger.error('Failed to save database after status update', err && (err.stack || err.message || err));
  }
  state.documents = state.documents.filter((doc) => doc.id !== documentId);
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(sqliteFilePath, buffer);
  logger.debug('Database exported to buffer', { size: buffer.length });
}

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

function categoryFromMime(mimeType = "", fileName = "") {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = fileName.toLowerCase();
  if (lowerMime.includes("pdf") || lowerName.endsWith(".pdf")) return "pdfs";
  if (lowerMime.startsWith("image/") || lowerName.endsWith(".png") || lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") || lowerName.endsWith(".gif") || lowerName.endsWith(".bmp") || lowerName.endsWith(".tiff") || lowerName.endsWith(".tif")) return "images";
  if (lowerMime.startsWith("text/") || lowerName.endsWith(".txt") || lowerName.endsWith(".csv") || lowerName.endsWith(".json") || lowerName.endsWith(".md")) return "texts";
  return "others";
}

function inferExtension(mimeType = "", fileName = "") {
  const existingExtension = path.extname(fileName);
  if (existingExtension) return existingExtension;
  if (mimeType.includes("pdf")) return ".pdf";
  if (mimeType.includes("jpeg")) return ".jpg";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("text/plain")) return ".txt";
  return "";
}

function isPrintableMedia(message, media) {
  const mimeType = (media.mimetype || "").toLowerCase();
  const fileName = path.basename(media.filename || "");
  const extension = path.extname(fileName).toLowerCase();
  if (mimeType.includes("pdf") || extension === ".pdf") return true;
  if (mimeType.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif"].includes(extension)) return true;
  if (mimeType.startsWith("text/") || [".txt", ".csv", ".json", ".md"].includes(extension)) return true;
  if (mimeType.includes("word") || extension === ".doc" || extension === ".docx" || extension === ".ppt" || extension === ".pptx" || extension === ".xls" || extension === ".xlsx") return true;
  return false;
}

function safeName(value) {
  return value.replace(/[^a-z0-9._-]+/gi, "_");
}

function emitStatus() {
  broadcast({ type: "status", status: state.status, qr: state.qr });
}

function emitQueue() {
  broadcast({ type: "queue", queue: state.queue });
}

function snapshot() {
  return {
    status: state.status,
    qr: state.qr,
    documents: state.documents,
    queue: state.queue,
  };
}

function makeDocumentPayload(message, media) {
  const timestamp = new Date((message.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const originalFileName = path.basename(media.filename || `${message.id?._serialized || randomUUID()}.bin`);
  const category = categoryFromMime(media.mimetype || "", originalFileName);
  const folder = inboxDirs[category] || inboxDirs.others;
  const extension = inferExtension(media.mimetype || "", originalFileName);
  const baseName = `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeName(message.id?._serialized || randomUUID())}_${safeName(path.basename(originalFileName, path.extname(originalFileName)) || "incoming")}${extension}`;
  const localPath = path.join(folder, baseName);
  const buffer = Buffer.from(media.data, "base64");
  fs.writeFileSync(localPath, buffer);

  const instructionText = message.body || "";
  const copies = Math.max(1, Number(instructionText.match(/(\d+)\s*(?:copies?|sets?|x)/)?.[1] ?? 1));
  const pageRange = instructionText.match(/pages?\s+([\d,\-\s]+)/)?.[1]?.trim().replace(/\s+/g, "") || "All pages";
  const colorMode = /black\s*&\s*white|b&w|bw|grayscale|gray|monochrome|black/.test(instructionText.toLowerCase()) ? "Black & White" : "Color";
  const orientation = /landscape/.test(instructionText.toLowerCase()) ? "Landscape" : "Portrait";
  const sides = /double\s*-?\s*sided|back\s*-?\s*to\s*-?\s*back|two\s*-?\s*sided|duplex|both\s+sides/.test(instructionText.toLowerCase()) ? "Double-sided" : "Single-sided";

  return {
    id: message.id?._serialized || randomUUID(),
    fileName: originalFileName,
    sender: message._data?.notifyName || message.from || message.author || "Unknown sender",
    timestamp,
    messageText: instructionText,
    localPath,
    mimeType: media.mimetype || "application/octet-stream",
    sizeKB: Math.max(1, Math.round(buffer.length / 1024)),
    category,
    autoFill: {
      copies,
      pageRange,
      colorMode,
      orientation,
      sides,
    },
  };
}

async function processQueue() {
  if (queueRunning) return;
  const nextJob = state.queue.find((job) => job.stage === "pending");
  if (!nextJob) return;

  logger.info('Starting queue processor', { jobId: nextJob.id, documentId: nextJob.documentId });
  queueRunning = true;
  nextJob.stage = "printing";
  nextJob.startedAt = new Date().toISOString();
  emitQueue();
  broadcast({ type: "queue-update", job: nextJob });

  try {
    const printablePath = await convertToPdfIfNeeded(nextJob.filePath);
    nextJob.printFilePath = printablePath;

    await print(printablePath, {
      copies: nextJob.copies,
      pages: nextJob.pageRange === "All pages" ? undefined : nextJob.pageRange,
      monochrome: nextJob.colorMode === "Black & White",
      landscape: nextJob.orientation === "Landscape",
    });

    nextJob.stage = "completed";
    nextJob.finishedAt = new Date().toISOString();
    logger.info('Print job completed', { jobId: nextJob.id, documentId: nextJob.documentId });
  } catch (error) {
    nextJob.stage = "failed";
    nextJob.error = error instanceof Error ? error.message : "Printing failed";
    nextJob.finishedAt = new Date().toISOString();
    logger.error('Print job failed', { jobId: nextJob.id, error: nextJob.error });
  } finally {
    queueRunning = false;
    emitQueue();
    broadcast({ type: "queue-update", job: nextJob });
    processQueue();
  }
}

async function connectWhatsApp(retries = 0) {
  const authPath = retries > 0 ? `${whatsappSessionDir}-retry-${retries}-${Date.now()}` : whatsappSessionDir;
  logger.debug('Using LocalAuth dataPath', { authPath });

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: authPath }),
    puppeteer: {
      headless: true,
      executablePath: browserExecutablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--metrics-recording-only",
        "--mute-audio",
        "--no-first-run",
      ],
    },
  });

  whatsappClient = client;

  client.on("qr", (qr) => {
    logger.info("✓ QR Code generated - scan now!");
    state.status = "qr";
    state.qr = qr;
    state.error = null;
    emitStatus();
  });

  client.on("authenticated", () => {
    logger.info("✓ Client authenticated");
    state.status = "connecting";
    emitStatus();
  });

  client.on("ready", () => {
    logger.info("✓ Client is ready! WhatsApp connected");
    state.status = "connected";
    state.qr = null;
    state.error = null;
    emitStatus();
  });

  client.on("auth_failure", (message) => {
    logger.error("✗ Auth failure:", message);
    state.status = "error";
    state.error = `WhatsApp auth failure: ${message}`;
    emitStatus();
    broadcast({ type: "error", message: state.error });
  });

  client.on("disconnected", (reason) => {
    logger.warn("⚠ Client disconnected:", reason);
    state.status = "offline";
    state.error = `WhatsApp disconnected: ${reason}`;
    emitStatus();
    broadcast({ type: "error", message: state.error });
    whatsappClient = null;
  });

  client.on("message", async (message) => {
    try {
      if (message.fromMe) return;
      const uniqueId = message.id?._serialized || message.id?.id;
      if (uniqueId && processedMessageIds.has(uniqueId)) return;

          if (!message.hasMedia) return;

      logger.info('Incoming message', { id: uniqueId, from: message.from, hasMedia: !!message.hasMedia });
      const media = await message.downloadMedia();
      logger.debug('Media downloaded', { id: uniqueId, mimetype: media?.mimetype, dataLength: media?.data?.length });
      if (!media?.data) return;
      if (!isPrintableMedia(message, media)) {
        logger.info('Ignored non-printable media', { id: uniqueId, mimetype: media?.mimetype });
        return;
      }

      const document = makeDocumentPayload(message, media);
      logger.info('Saving document', { id: document.id, file: document.fileName, sender: document.sender });
      saveDocumentToDatabase(document);
      logger.info('Saved document', { id: document.id });
      processedMessageIds.add(document.id);
      state.documents = [document, ...state.documents].slice(0, 100);

      broadcast({ type: "document", document });
      emitStatus();
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to process incoming message";
      broadcast({ type: "error", message: state.error });
    }
  });

  state.status = "connecting";
  emitStatus();
  logger.info("🔄 Connecting to WhatsApp...");
  try {
    await client.initialize();
  } catch (err) {
    logger.error('WhatsApp client.initialize() failed', err && (err.stack || err.message || err));
    try {
      await client.destroy();
    } catch (e) {
      logger.warn('Error while destroying failed client', e && (e.stack || e.message || e));
    }
    whatsappClient = null;
    if (retries < 3) {
      const backoff = 1000 * (retries + 1);
      logger.info(`Retrying WhatsApp connect in ${backoff}ms (attempt ${retries + 1})`);
      await new Promise((r) => setTimeout(r, backoff));
      return connectWhatsApp(retries + 1);
    }
    throw err;
  }
}

async function startServer() {
  ensureDirectories();
    await initializeDatabase();
    loadDocumentsFromDatabase();

    const port = Number(process.env.PORT || 3001);
    server.listen(port, () => {
      logger.info(`\n📱 SmartPrint backend listening on http://localhost:${port}`);
      logger.info(`   WebSocket: ws://localhost:${port}/ws\n`);
    });

    // Start WhatsApp connection in background so HTTP API is available immediately.
    connectWhatsApp().catch((error) => {
      state.status = "error";
      state.error = error instanceof Error ? error.message : "Unable to start WhatsApp client";
      emitStatus();
      broadcast({ type: "error", message: state.error });
    });
}

async function resetWhatsAppSession() {
  const client = whatsappClient;
  whatsappClient = null;

  if (client) {
    try {
      logger.info('Destroying existing WhatsApp client before reset');
      await client.destroy();
      logger.info('Existing WhatsApp client destroyed');
    } catch (e) {
      logger.warn('Error while destroying WhatsApp client during reset', e && (e.stack || e.message || e));
    }
  }

  // Remove session files and recreate dir. Retry removal if the browser still has locks.
  try {
    await removeDirWithRetries(whatsappSessionDir, 8, 400);
  } catch (e) {
    logger.error('Failed to remove whatsapp session dir during reset', e && (e.stack || e.message || e));
  }
  try { fs.mkdirSync(whatsappSessionDir, { recursive: true }); } catch (e) { /* ignore */ }
  await sleep(700);

  state.status = "connecting";
  state.qr = null;
  state.error = null;
  emitStatus();
  logger.info('🔄 Restarting WhatsApp session...');
  try {
    await connectWhatsApp();
  } catch (error) {
    state.status = "error";
    state.error = error instanceof Error ? error.message : "Unable to restart WhatsApp client";
    emitStatus();
    broadcast({ type: "error", message: state.error });
  }
}

app.get("/api/snapshot", (_request, response) => {
  response.json(snapshot());
});

app.get("/api/documents", (_request, response) => {
  response.json(state.documents);
});

app.get("/api/queue", (_request, response) => {
  response.json(state.queue);
});

app.post("/api/whatsapp/reset", (_request, response) => {
  void resetWhatsAppSession();
  response.json({ ok: true, status: "connecting" });
});

app.post("/api/queue", (request, response) => {
  const body = request.body || {};
  const documents = Array.isArray(body.documents) ? body.documents : [body];

  const jobs = documents.map((document) => {
    const storedDocument = state.documents.find((item) => item.id === document.documentId);
    const {
      documentId = storedDocument?.id,
      fileName = storedDocument?.fileName,
      filePath = storedDocument?.localPath,
      sender = storedDocument?.sender,
      messageText = storedDocument?.messageText,
      copies = storedDocument?.autoFill?.copies,
      pageRange = storedDocument?.autoFill?.pageRange,
      colorMode = storedDocument?.autoFill?.colorMode,
      orientation = storedDocument?.autoFill?.orientation,
      sides = storedDocument?.autoFill?.sides,
    } = document;

    if (!documentId || !filePath || !fileName) {
      return null;
    }

    return {
      id: `JOB-${randomUUID().slice(0, 8).toUpperCase()}`,
      documentId,
      fileName,
      filePath,
      sender: sender || "Unknown sender",
      messageText: messageText || "",
      copies: Math.max(1, Number(copies || 1)),
      pageRange: pageRange || "All pages",
      colorMode: colorMode === "Black & White" ? "Black & White" : "Color",
      orientation: orientation === "Landscape" ? "Landscape" : "Portrait",
      sides: sides === "Double-sided" ? "Double-sided" : "Single-sided",
      stage: "pending",
      createdAt: new Date().toISOString(),
    };
  });

  if (jobs.some((job) => job === null)) {
    const missing = documents
      .map((d) => d.documentId || d.fileName || "<unknown>")
      .filter((id, idx) => jobs[idx] === null);
    response.status(400).json({ error: `Missing document data on server for: ${missing.join(", ")}` });
    return;
  }

  state.queue = [...state.queue, ...jobs];
  logger.info('Queue submitted', { jobs: jobs.map(j => ({ id: j.id, documentId: j.documentId })) });
  for (const job of jobs) {
    updateDocumentStatus(job.documentId, "queued");
    broadcast({ type: "queue-update", job });
  }
  emitQueue();
  processQueue();

  response.json({ jobs, queue: state.queue });
});

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "status", status: state.status, qr: state.qr }));
  socket.send(JSON.stringify({ type: "queue", queue: state.queue }));
  for (const document of state.documents.slice(0, 10)) {
    socket.send(JSON.stringify({ type: "document", document }));
  }
});

await initializeDatabase();
ensureDirectories();
loadDocumentsFromDatabase();
await connectWhatsApp().catch((error) => {
  state.status = "error";
  state.error = error instanceof Error ? error.message : "Unable to start WhatsApp client";
  emitStatus();
  broadcast({ type: "error", message: state.error });
});

const port = Number(process.env.PORT || 3001);
server.listen(port, () => {
  console.log(`\n📱 SmartPrint backend listening on http://localhost:${port}`);
  console.log(`   WebSocket: ws://localhost:${port}/ws\n`);
});
