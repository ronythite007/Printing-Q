import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { inboxDirs } from "./state.js";
import { categoryFromMime, inferExtension, safeName } from "./utils.js";

export function makeDocumentPayload(message: any, media: any) {
  const timestamp = new Date((message.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const originalFileName = path.basename(media.filename || `${message.id?._serialized || randomUUID()}.bin`);
  const category = categoryFromMime(media.mimetype || "", originalFileName);
  const folder = inboxDirs[category] || inboxDirs.others;
  const extension = inferExtension(media.mimetype || "", originalFileName);
  const baseName = `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeName(
    message.id?._serialized || randomUUID()
  )}_${safeName(path.basename(originalFileName, path.extname(originalFileName)) || "incoming")}${extension}`;
  const localPath = path.join(folder, baseName);
  const buffer = Buffer.from(media.data, "base64");
  fs.writeFileSync(localPath, buffer);

  const instructionText = message.body || "";
  const copies = Math.max(1, Number(instructionText.match(/(\d+)\s*(?:copies?|sets?|x)/)?.[1] ?? 1));
  const pageRange = instructionText.match(/pages?\s+([\d,\-\s]+)/)?.[1]?.trim().replace(/\s+/g, "") || "All pages";
  const colorMode: "Color" | "Black & White" = /black\s*&\s*white|b&w|bw|grayscale|gray|monochrome|black/i.test(instructionText)
    ? "Black & White"
    : "Color";
  const orientation: "Portrait" | "Landscape" = /landscape/i.test(instructionText) ? "Landscape" : "Portrait";
  const sides: "Single-sided" | "Double-sided" = /double\s*-?\s*sided|back\s*-?\s*to\s*-?\s*back|two\s*-?\s*sided|duplex|both\s+sides/i.test(instructionText)
    ? "Double-sided"
    : "Single-sided";

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
