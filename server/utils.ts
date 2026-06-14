import fs from "fs";
import path from "path";

export function resolveBrowserExecutablePath() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    "Could not find Chrome or Edge. Install Google Chrome, or set PUPPETEER_EXECUTABLE_PATH to a valid browser executable."
  );
}

export function resolveSofficePath() {
  const candidates = [
    process.env.SOFFICE_PATH,
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function removeDirWithRetries(dir: string, attempts = 6, delayMs = 300) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (i === attempts - 1) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
}

export function categoryFromMime(mimeType = "", fileName = "") {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = fileName.toLowerCase();
  if (lowerMime.includes("pdf") || lowerName.endsWith(".pdf")) return "pdfs";
  if (
    lowerMime.startsWith("image/") ||
    [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif"].some((ext) => lowerName.endsWith(ext))
  ) {
    return "images";
  }
  if (
    lowerMime.startsWith("text/") ||
    [".txt", ".csv", ".json", ".md"].some((ext) => lowerName.endsWith(ext))
  ) {
    return "texts";
  }
  return "others";
}

export function inferExtension(mimeType = "", fileName = "") {
  const existingExtension = path.extname(fileName);
  if (existingExtension) return existingExtension;
  if (mimeType.includes("pdf")) return ".pdf";
  if (mimeType.includes("jpeg")) return ".jpg";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("text/plain")) return ".txt";
  return "";
}

export function isPrintableMedia(message: any, media: any) {
  const mimeType = (media.mimetype || "").toLowerCase();
  const fileName = path.basename(media.filename || "");
  const extension = path.extname(fileName).toLowerCase();
  if (mimeType.includes("pdf") || extension === ".pdf") return true;
  if (mimeType.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif"].includes(extension)) return true;
  if (mimeType.startsWith("text/") || [".txt", ".csv", ".json", ".md"].includes(extension)) return true;
  if (mimeType.includes("word") || [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"].includes(extension)) return true;
  return false;
}

export function safeName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "_");
}
