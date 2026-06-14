import { logger } from "./logger.js";
import { state } from "./state.js";
import { broadcast } from "./websocket.js";
import { convertToPdfIfNeeded } from "./converter.js";

export async function processQueue() {
  if (state.queueRunning) return;
  const nextJob = state.queue.find((job) => job.stage === "pending");
  if (!nextJob) return;

  logger.info("Starting queue processor", { jobId: nextJob.id, documentId: nextJob.documentId });
  state.queueRunning = true;
  nextJob.stage = "printing";
  nextJob.startedAt = new Date().toISOString();
  broadcast({ type: "queue", queue: state.queue });
  broadcast({ type: "queue-update", job: nextJob });

  try {
    const printablePath = await convertToPdfIfNeeded(nextJob.filePath);
    nextJob.printFilePath = printablePath;

    const printerPkg = await import("pdf-to-printer");
    const printFn = (printerPkg.default?.print ?? printerPkg.print) as (
      filePath: string,
      options?: Record<string, unknown>
    ) => Promise<void>;

    await printFn(printablePath, {
      copies: nextJob.copies,
      pages: nextJob.pageRange === "All pages" ? undefined : nextJob.pageRange,
      monochrome: nextJob.colorMode === "Black & White",
      landscape: nextJob.orientation === "Landscape",
    });

    nextJob.stage = "completed";
    nextJob.finishedAt = new Date().toISOString();
    logger.info("Print job completed", { jobId: nextJob.id, documentId: nextJob.documentId });
  } catch (error) {
    nextJob.stage = "failed";
    nextJob.error = error instanceof Error ? error.message : "Printing failed";
    nextJob.finishedAt = new Date().toISOString();
    logger.error("Print job failed", { jobId: nextJob.id, error: nextJob.error });
  } finally {
    state.queueRunning = false;
    broadcast({ type: "queue", queue: state.queue });
    broadcast({ type: "queue-update", job: nextJob });
    void processQueue();
  }
}
