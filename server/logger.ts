import fs from "fs";
import path from "path";
import { stateDir } from "./state.js";

const logsDir = path.join(stateDir, "logs");
fs.mkdirSync(logsDir, { recursive: true });
const logFile = path.join(logsDir, `server-${new Date().toISOString().slice(0, 10)}.log`);

type LogMeta = unknown;

function formatMessage(level: string, message: string, meta?: LogMeta) {
  const ts = new Date().toISOString();
  let base = `[${ts}] [${level.toUpperCase()}] ${message}`;
  if (meta) {
    try {
      base += ` ${typeof meta === "string" ? meta : JSON.stringify(meta)}`;
    } catch {
      // ignore JSON errors
    }
  }
  return base;
}

function writeLog(line: string) {
  try {
    fs.appendFileSync(logFile, `${line}\n`);
  } catch {
    // don't crash on logging failures
  }
}

export const logger = {
  info: (msg: string, meta?: LogMeta) => {
    const entry = formatMessage("info", msg, meta);
    console.log(entry);
    writeLog(entry);
  },
  warn: (msg: string, meta?: LogMeta) => {
    const entry = formatMessage("warn", msg, meta);
    console.warn(entry);
    writeLog(entry);
  },
  error: (msg: string, meta?: LogMeta) => {
    const entry = formatMessage("error", msg, meta);
    console.error(entry);
    writeLog(entry);
  },
  debug: (msg: string, meta?: LogMeta) => {
    const entry = formatMessage("debug", msg, meta);
    if (console.debug) {
      console.debug(entry);
    } else {
      console.log(entry);
    }
    writeLog(entry);
  },
};
