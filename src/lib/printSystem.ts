// Shared types + mock store for the working POC

export type Stage = "queued" | "parsing" | "validated" | "printing" | "done" | "error";

export interface ParsedInstr {
  copies: number;
  color: boolean;
  duplex: boolean;
  range: string;
  paper: "A4" | "A3" | "Letter";
}

export interface PrintJob {
  id: string;
  file: string;
  pages: number;
  sizeKB: number;
  raw: string;
  parsed?: ParsedInstr;
  stage: Stage;
  progress: number;
  ts: number;
  source: "web" | "whatsapp" | "email";
  user: string;
  cost?: number;
  printer?: string;
  error?: string;
  batchId?: string;
  batchIndex?: number;
  batchTotal?: number;
  etaSec?: number;
}

export interface Printer {
  id: string;
  name: string;
  model: string;
  status: "online" | "busy" | "offline";
  paper: number; // % remaining
  toner: number;
}

export const MOCK_PRINTERS: Printer[] = [
  { id: "PR-01", name: "Front Desk", model: "Lexmark MX622", status: "online", paper: 78, toner: 64 },
  { id: "PR-02", name: "Back Office", model: "HP LaserJet M404", status: "online", paper: 92, toner: 41 },
  { id: "PR-03", name: "Color Bay", model: "Canon iR-ADV C5560", status: "online", paper: 55, toner: 88 },
];

export const SAMPLE_FILES = [
  { file: "Resume_Final.pdf", pages: 2, sizeKB: 184 },
  { file: "Lecture_Notes_Unit3.pdf", pages: 18, sizeKB: 1240 },
  { file: "Invoice_INV-0942.pdf", pages: 1, sizeKB: 92 },
  { file: "Thesis_Draft_v4.pdf", pages: 84, sizeKB: 5620 },
  { file: "Wedding_Card_Final.pdf", pages: 1, sizeKB: 2400 },
  { file: "Project_Report.pdf", pages: 32, sizeKB: 3140 },
  { file: "Boarding_Pass.pdf", pages: 1, sizeKB: 64 },
  { file: "Presentation_Deck.pdf", pages: 24, sizeKB: 4820 },
];

export const MOCK_USERS = ["+91 98•••43210", "+91 90•••11220", "rohit@acme.io", "kavya.s@uni.edu", "Walk-in #04"];

export const id = () => Math.random().toString(36).slice(2, 6).toUpperCase();

export function parseInstruction(raw: string, totalPages: number): ParsedInstr {
  const r = raw.toLowerCase();
  const copies = Math.max(1, parseInt(r.match(/(\d+)\s*(?:cop|x|set)/)?.[1] ?? "1", 10));
  const color = /colou?r/.test(r) && !/b&w|bw|black|grayscale|gray/.test(r);
  const duplex = /duplex|both side|double side|two side|back to back/.test(r);
  const rangeMatch = r.match(/pages?\s*(\d+)\s*[-to]+\s*(\d+)/);
  const range = rangeMatch ? `${rangeMatch[1]}-${rangeMatch[2]}` : `1-${totalPages}`;
  const paper: ParsedInstr["paper"] = /a3/.test(r) ? "A3" : /letter/.test(r) ? "Letter" : "A4";
  return { copies, color, duplex, range, paper };
}

export function estimateCost(p: ParsedInstr, pages: number) {
  const rangePages = (() => {
    const m = p.range.match(/(\d+)-(\d+)/);
    if (!m) return pages;
    return Math.max(1, parseInt(m[2]) - parseInt(m[1]) + 1);
  })();
  const per = p.color ? 8 : 2;
  const sides = p.duplex ? 0.55 : 1;
  return Math.round(rangePages * per * p.copies * sides);
}

// Zomato-style assignment: pick the least-loaded online printer (fewest active jobs, then most paper)
export function pickPrinter(printers: Printer[], jobs: PrintJob[]): string {
  const load = (pid: string) =>
    jobs.filter((j) => j.printer === pid && j.stage !== "done" && j.stage !== "error").length;
  const sorted = [...printers]
    .filter((p) => p.status !== "offline")
    .sort((a, b) => load(a.id) - load(b.id) || b.paper - a.paper);
  return (sorted[0] ?? printers[0]).id;
}

// ETA in seconds — like Zomato's "arriving in X min" — based on processing + queue position
export function estimateEta(parsed: ParsedInstr | undefined, pages: number, queueAhead: number) {
  const per = parsed?.color ? 3 : 1.5;
  const sides = parsed?.duplex ? 0.6 : 1;
  const copies = parsed?.copies ?? 1;
  return Math.round(pages * per * sides * copies + queueAhead * 8);
}

export function formatEta(sec: number) {
  if (sec <= 0) return "any moment";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

const KEY = "smartprint:jobs:v1";

export function loadJobs(): PrintJob[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveJobs(jobs: PrintJob[]) {
  localStorage.setItem(KEY, JSON.stringify(jobs.slice(0, 50)));
}
