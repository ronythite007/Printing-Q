import express from "express";
import { randomUUID } from "crypto";
import { state } from "./state.js";
import { logger } from "./logger.js";
import { broadcast } from "./websocket.js";
import { updateDocumentStatus } from "./db.js";
import { processQueue } from "./queue.js";
import { resetWhatsAppSession } from "./whatsapp.js";

export function registerApiRoutes(app: express.Express) {
  app.use(express.json({ limit: "20mb" }));

  app.get("/api/snapshot", (_request, response) => {
    response.json({
      status: state.status,
      qr: state.qr,
      documents: state.documents,
      queue: state.queue,
    });
  });

  app.get("/api/documents", (_request, response) => {
    response.json(state.documents);
  });

  app.get("/api/queue", (_request, response) => {
    response.json(state.queue);
  });

  app.post("/api/whatsapp/reset", async (_request, response) => {
    void resetWhatsAppSession().catch((error) => {
      logger.error("WhatsApp reset failed", error && (error.stack || error.message || error));
      state.status = "error";
      state.error = error instanceof Error ? error.message : "Reset failed";
      broadcast({ type: "error", message: state.error });
    });
    response.json({ ok: true, status: "connecting" });
  });

  app.post("/api/queue", (request, response) => {
    const body = request.body || {};
    const documents = Array.isArray(body.documents) ? body.documents : [body];

    const jobs = documents.map((document: any) => {
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
        stage: "pending" as const,
        createdAt: new Date().toISOString(),
      };
    });

    if (jobs.some((job) => job === null)) {
      const missing = documents
        .map((d: any) => d.documentId || d.fileName || "<unknown>")
        .filter((_: unknown, idx: number) => jobs[idx] === null);
      response.status(400).json({ error: `Missing document data on server for: ${missing.join(", ")}` });
      return;
    }

    state.queue = [...state.queue, ...(jobs as any[])];
    logger.info("Queue submitted", { jobs: (jobs as any[]).map((j) => ({ id: j.id, documentId: j.documentId })) });
    for (const job of jobs as any[]) {
      updateDocumentStatus(job.documentId, "queued");
      broadcast({ type: "queue-update", job });
    }
    broadcast({ type: "queue", queue: state.queue });
    processQueue();

    response.json({ jobs, queue: state.queue });
  });
}
