import pkg from "whatsapp-web.js";
import { logger } from "./logger.js";
import { state, whatsappSessionDir, processedMessageIds } from "./state.js";
import { makeDocumentPayload } from "./documents.js";
import { saveDocumentToDatabase } from "./db.js";
import { broadcast } from "./websocket.js";
import { resolveBrowserExecutablePath, isPrintableMedia, removeDirWithRetries } from "./utils.js";

const { Client, LocalAuth } = pkg as any;

let whatsappClient: any = null;
let browserExecutablePath: string | null = null;

export function getClient() {
  return whatsappClient;
}

export async function initializeWhatsAppClient() {
  if (!browserExecutablePath) {
    browserExecutablePath = resolveBrowserExecutablePath();
  }

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

  client.on("qr", (qr: string) => {
    logger.info("✓ QR Code generated - scan now!");
    state.status = "qr";
    state.qr = qr;
    state.error = null;
    broadcast({ type: "status", status: state.status, qr: state.qr });
  });

  client.on("authenticated", () => {
    logger.info("✓ Client authenticated");
    state.status = "connecting";
    broadcast({ type: "status", status: state.status, qr: state.qr });
  });

  client.on("ready", () => {
    logger.info("✓ Client is ready! WhatsApp connected");
    state.status = "connected";
    state.qr = null;
    state.error = null;
    broadcast({ type: "status", status: state.status, qr: state.qr });
  });

  client.on("auth_failure", (message: string) => {
    logger.error("✗ Auth failure:", message);
    state.status = "error";
    state.error = `WhatsApp auth failure: ${message}`;
    broadcast({ type: "error", message: state.error });
  });

  client.on("disconnected", (reason: string) => {
    logger.warn("⚠ Client disconnected:", reason);
    state.status = "offline";
    state.error = `WhatsApp disconnected: ${reason}`;
    broadcast({ type: "error", message: state.error });
    whatsappClient = null;
  });

  client.on("message", async (message: any) => {
    try {
      if (message.fromMe) return;
      const uniqueId = message.id?._serialized || message.id?.id;
      if (uniqueId && processedMessageIds.has(uniqueId)) return;
      if (!message.hasMedia) return;

      logger.info("Incoming message", { id: uniqueId, from: message.from, hasMedia: !!message.hasMedia });
      const media = await message.downloadMedia();
      logger.debug("Media downloaded", { id: uniqueId, mimetype: media?.mimetype, dataLength: media?.data?.length });
      if (!media?.data) return;
      if (!isPrintableMedia(message, media)) {
        logger.info("Ignored non-printable media", { id: uniqueId, mimetype: media?.mimetype });
        return;
      }

      const document = makeDocumentPayload(message, media);
      logger.info("Saving document", { id: document.id, file: document.fileName, sender: document.sender });
      saveDocumentToDatabase(document);
      logger.info("Saved document", { id: document.id });
      processedMessageIds.add(document.id);
      state.documents = [document, ...state.documents].slice(0, 100);
      broadcast({ type: "document", document });
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to process incoming message";
      broadcast({ type: "error", message: state.error });
    }
  });

  state.status = "connecting";
  broadcast({ type: "status", status: state.status, qr: state.qr });
  logger.info("🔄 Connecting to WhatsApp...");
  await client.initialize();
}

export async function destroyWhatsAppClient() {
  if (!whatsappClient) return;
  try {
    await whatsappClient.destroy();
    logger.info("Destroyed WhatsApp client");
  } catch (error) {
    logger.warn("Error while destroying WhatsApp client", error && (error.stack || error.message || error));
  }
  whatsappClient = null;
}

export async function resetWhatsAppSession() {
  const client = whatsappClient;
  whatsappClient = null;
  if (client) {
    await destroyWhatsAppClient();
  }

  await removeSessionDirectory();

  state.status = "connecting";
  state.qr = null;
  state.error = null;
  broadcast({ type: "status", status: state.status, qr: state.qr });
  logger.info("🔄 Restarting WhatsApp session...");
  await initializeWhatsAppClient();
}

export async function removeSessionDirectory() {
  try {
    await removeDirWithRetries(whatsappSessionDir, 8, 400);
  } catch (error) {
    logger.error("Failed to remove whatsapp session dir during reset", error && (error.stack || error.message || error));
  }
}
