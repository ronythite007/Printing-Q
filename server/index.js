import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { WebSocketServer } from "ws";
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
const processedIdsFile = path.join(stateDir, "processed-message-ids.json");
const whatsappSessionDir = path.join(stateDir, "whatsapp-session");

app.use(express.json({ limit: "20mb" }));

const state = {
  status: "connecting",
  qr: null,
  error: null,
  documents: [],
  queue: [],
};

const processedMessageIds = new Set(loadJson(processedIdsFile, []));
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
  if (lowerMime.startsWith("image/")) return "images";
  if (lowerMime.startsWith("text/") || lowerName.endsWith(".txt") || lowerName.endsWith(".csv") || lowerName.endsWith(".json")) return "texts";
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
  } catch (error) {
    nextJob.stage = "failed";
    nextJob.error = error instanceof Error ? error.message : "Printing failed";
    nextJob.finishedAt = new Date().toISOString();
  } finally {
    queueRunning = false;
    emitQueue();
    broadcast({ type: "queue-update", job: nextJob });
    processQueue();
  }
}

async function connectWhatsApp() {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: whatsappSessionDir }),
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
    console.log("✓ QR Code generated - scan now!");
    state.status = "qr";
    state.qr = qr;
    state.error = null;
    emitStatus();
  });

  client.on("authenticated", () => {
    console.log("✓ Client authenticated");
    state.status = "connecting";
    emitStatus();
  });

  client.on("ready", () => {
    console.log("✓ Client is ready! WhatsApp connected");
    state.status = "connected";
    state.qr = null;
    state.error = null;
    emitStatus();
  });

  client.on("auth_failure", (message) => {
    console.error("✗ Auth failure:", message);
    state.status = "error";
    state.error = `WhatsApp auth failure: ${message}`;
    emitStatus();
    broadcast({ type: "error", message: state.error });
  });

  client.on("disconnected", (reason) => {
    console.warn("⚠ Client disconnected:", reason);
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

      const media = await message.downloadMedia();
      if (!media?.data) return;

      const document = makeDocumentPayload(message, media);
      state.documents = [document, ...state.documents].slice(0, 100);
      if (uniqueId) {
        processedMessageIds.add(uniqueId);
        saveJson(processedIdsFile, Array.from(processedMessageIds));
      }

      broadcast({ type: "document", document });
      emitStatus();
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to process incoming message";
      broadcast({ type: "error", message: state.error });
    }
  });

  state.status = "connecting";
  emitStatus();
  console.log("🔄 Connecting to WhatsApp...");
  await client.initialize();
}

async function resetWhatsAppSession() {
  const client = whatsappClient;
  whatsappClient = null;

  if (client) {
    try {
      await client.destroy();
    } catch {
      // Ignore teardown errors; a fresh client is the goal.
    }
  }

  fs.rmSync(whatsappSessionDir, { recursive: true, force: true });
  fs.mkdirSync(whatsappSessionDir, { recursive: true });
  state.status = "connecting";
  state.qr = null;
  state.error = null;
  emitStatus();
  console.log("🔄 Restarting WhatsApp session...");
  void connectWhatsApp().catch((error) => {
    state.status = "error";
    state.error = error instanceof Error ? error.message : "Unable to restart WhatsApp client";
    emitStatus();
    broadcast({ type: "error", message: state.error });
  });
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
  emitQueue();
  for (const job of jobs) {
    broadcast({ type: "queue-update", job });
  }
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

ensureDirectories();
connectWhatsApp().catch((error) => {
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
