import fs from "fs";
import path from "path";

export interface DocumentAutoFill {
  copies: number;
  pageRange: string;
  colorMode: "Color" | "Black & White";
  orientation: "Portrait" | "Landscape";
  sides: "Single-sided" | "Double-sided";
}

export interface DocumentItem {
  id: string;
  fileName: string;
  sender: string;
  timestamp: string;
  messageText: string;
  localPath: string;
  mimeType: string;
  sizeKB: number;
  category: string;
  autoFill: DocumentAutoFill;
  status?: string;
}

export interface QueueJob {
  id: string;
  documentId: string;
  fileName: string;
  filePath: string;
  sender: string;
  messageText: string;
  copies: number;
  pageRange: string;
  colorMode: "Color" | "Black & White";
  orientation: "Portrait" | "Landscape";
  sides: "Single-sided" | "Double-sided";
  stage: "pending" | "printing" | "completed" | "failed";
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  printFilePath?: string;
  error?: string;
}

export interface AppState {
  status: "connecting" | "connected" | "offline" | "error" | "qr";
  qr: string | null;
  error: string | null;
  documents: DocumentItem[];
  queue: QueueJob[];
  queueRunning: boolean;
}

export const rootDir = process.env.SMARTPRINT_ROOT_DIR || process.cwd();
export const stateDir = path.join(rootDir, "server-state");
export const downloadsDir = path.join(rootDir, "downloads");
export const convertedDir = path.join(downloadsDir, "converted");
export const inboxDirs = {
  pdfs: path.join(downloadsDir, "pdfs"),
  images: path.join(downloadsDir, "images"),
  texts: path.join(downloadsDir, "texts"),
  others: path.join(downloadsDir, "others"),
};
export const whatsappSessionDir = path.join(stateDir, "whatsapp-session");
export const sqliteFilePath = path.join(stateDir, "smartprint.sqlite");

export const state: AppState = {
  status: "connecting",
  qr: null,
  error: null,
  documents: [],
  queue: [],
  queueRunning: false,
};

export const processedMessageIds = new Set<string>();

export function ensureDirectories() {
  [stateDir, downloadsDir, convertedDir, ...Object.values(inboxDirs), whatsappSessionDir].forEach((dir) => {
    fs.mkdirSync(dir, { recursive: true });
  });
}
