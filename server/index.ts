import express from "express";
import http from "http";
import { registerApiRoutes } from "./api.js";
import { createWebSocketServer, broadcast } from "./websocket.js";
import { initializeDatabase, loadDocumentsFromDatabase } from "./db.js";
import { ensureDirectories, state, processedMessageIds } from "./state.js";
import { initializeWhatsAppClient, resetWhatsAppSession } from "./whatsapp.js";
import { logger } from "./logger.js";

let lastResetAt = 0;
const RESET_COOLDOWN_MS = 60 * 1000;

process.on("uncaughtException", (err: unknown) => {
  logger.error(
    "Uncaught exception",
    err instanceof Error ? err.stack || err.message : String(err)
  );
});

process.on("unhandledRejection", async (reason: unknown) => {
  logger.error(
    "Unhandled promise rejection",
    reason instanceof Error ? reason.stack || reason.message : String(reason)
  );

  const text = reason instanceof Error ? reason.message : String(reason);
  if (typeof text === "string" && /(Protocol error|Target closed|frame detached|Runtime.callFunctionOn)/i.test(text)) {
    const now = Date.now();
    if (now - lastResetAt > RESET_COOLDOWN_MS) {
      lastResetAt = now;
      logger.warn("Detected Puppeteer/Protocol error; attempting graceful WhatsApp reset");
      try {
        await resetWhatsAppSession();
      } catch (error) {
        logger.error("Automatic reset after protocol error failed", error && (error.stack || error.message || error));
      }
    } else {
      logger.info("Protocol error detected but reset suppressed due to cooldown");
    }
  }
});

async function startServer() {
  ensureDirectories();
  await initializeDatabase();

  const { documents, processedIds } = loadDocumentsFromDatabase();
  state.documents = documents;
  processedMessageIds.clear();
  for (const id of processedIds) {
    processedMessageIds.add(id);
  }

  const app = express();
  registerApiRoutes(app);

  const server = http.createServer(app);
  createWebSocketServer(server);

  const port = Number(process.env.PORT || 3001);
  server.listen(port, () => {
    logger.info(`\n📱 SmartPrint backend listening on http://localhost:${port}`);
    logger.info(`   WebSocket: ws://localhost:${port}/ws`);
  });

  initializeWhatsAppClient().catch((error) => {
    state.status = "error";
    state.error = error instanceof Error ? error.message : "Unable to start WhatsApp client";
    broadcast({ type: "status", status: state.status, qr: state.qr });
    broadcast({ type: "error", message: state.error });
  });
}

await startServer();
