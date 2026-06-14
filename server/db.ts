import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import initSqlJs from "sql.js";
import { sqliteFilePath } from "./state.js";
import { logger } from "./logger.js";

let db: any = null;
let SQL: any = null;

export async function initializeDatabase() {
  SQL = await initSqlJs({
    locateFile: (file: string) => path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "sql.js", "dist", file),
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

function allRows(statement: any) {
  const rows: any[] = [];
  while (statement.step()) {
    rows.push(statement.getAsObject());
  }
  statement.free();
  return rows;
}

export function loadDocumentsFromDatabase() {
  const stmt = db.prepare("SELECT * FROM documents ORDER BY timestamp DESC");
  const rows = allRows(stmt);
  const documents = rows
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

  const processedIds = new Set(rows.map((row) => row.id));
  return { documents, processedIds };
}

export function saveDocumentToDatabase(document: any) {
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

export function updateDocumentStatus(documentId: string, status: string) {
  const stmt = db.prepare("UPDATE documents SET status = ? WHERE id = ?");
  stmt.run(status, documentId);
  stmt.free();
  saveDatabase();
  logger.info("Updated document status", { id: documentId, status });
}

export function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(sqliteFilePath, buffer);
  logger.debug("Database exported to buffer", { size: buffer.length });
}
