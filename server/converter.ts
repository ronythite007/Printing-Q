import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { resolveSofficePath } from "./utils.js";
import { convertedDir } from "./state.js";

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

export async function convertToPdfIfNeeded(filePath: string) {
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

  await new Promise<void>((resolve, reject) => {
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
