import { useEffect, useRef, useState } from "react";
import { Send, FileText, Check, Brain, Printer, AlertCircle, Loader2 } from "lucide-react";

type Stage = "queued" | "parsing" | "validated" | "printing" | "done" | "error";

interface Job {
  id: string;
  file: string;
  pages: number;
  raw: string;
  parsed?: { copies: number; color: boolean; duplex: boolean; range: string };
  stage: Stage;
  progress: number;
  ts: number;
}

interface ChatMsg {
  from: "user" | "bot";
  text: string;
  attach?: string;
  ts: number;
}

const PRESETS = [
  { file: "Resume_Final.pdf", pages: 2, raw: "2 copies, color, single side" },
  { file: "Notes_Unit3.pdf", pages: 18, raw: "Print 3 copies, B&W, both sides please" },
  { file: "Invoice_0942.pdf", pages: 1, raw: "1 copy color" },
  { file: "Thesis_Draft.pdf", pages: 84, raw: "1 copy, b&w, duplex, pages 1-40" },
];

const id = () => Math.random().toString(36).slice(2, 6).toUpperCase();
const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function parseInstruction(raw: string, totalPages: number) {
  const r = raw.toLowerCase();
  const copies = parseInt(r.match(/(\d+)\s*(?:cop|x)/)?.[1] ?? "1", 10);
  const color = /color|colour/.test(r) && !/b&w|bw|black/.test(r);
  const duplex = /duplex|both side|double|two side/.test(r);
  const rangeMatch = r.match(/pages?\s*(\d+)\s*-\s*(\d+)/);
  const range = rangeMatch ? `${rangeMatch[1]}-${rangeMatch[2]}` : `1-${totalPages}`;
  return { copies, color, duplex, range };
}

const stageLabel: Record<Stage, string> = {
  queued: "QUEUED",
  parsing: "AI PARSING",
  validated: "VALIDATED",
  printing: "PRINTING",
  done: "COMPLETED",
  error: "ERROR",
};

const stageColor: Record<Stage, string> = {
  queued: "bg-muted text-foreground",
  parsing: "bg-warning/30 text-foreground",
  validated: "bg-neon/40 text-ink",
  printing: "bg-ink text-paper",
  done: "bg-success text-paper",
  error: "bg-destructive text-paper",
};

const Demo = ({ demoRef }: { demoRef: React.RefObject<HTMLElement> }) => {
  const [chat, setChat] = useState<ChatMsg[]>([
    { from: "bot", text: "Hi! Send me PDFs with print instructions. I'll handle the rest.", ts: Date.now() },
  ]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [draft, setDraft] = useState(0);
  const [instr, setInstr] = useState(PRESETS[0].raw);
  const chatEnd = useRef<HTMLDivElement>(null);
  const chatWindow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatWindow.current?.scrollTo({ top: chatWindow.current.scrollHeight, behavior: "smooth" });
  }, [chat]);

  // job lifecycle
  useEffect(() => {
    const t = setInterval(() => {
      setJobs((prev) =>
        prev.map((j) => {
          if (j.stage === "done" || j.stage === "error") return j;
          const elapsed = Date.now() - j.ts;
          if (elapsed < 1200) return { ...j, stage: "queued", progress: 5 };
          if (elapsed < 2800) {
            if (j.stage !== "parsing") {
              const parsed = parseInstruction(j.raw, j.pages);
              setChat((c) => [
                ...c,
                {
                  from: "bot",
                  text: `🧠 Parsed #${j.id}: ${parsed.copies}× · ${parsed.color ? "Color" : "B&W"} · ${parsed.duplex ? "Duplex" : "Single"} · pp ${parsed.range}`,
                  ts: Date.now(),
                },
              ]);
              return { ...j, stage: "parsing", parsed, progress: 25 };
            }
            return { ...j, progress: 25 };
          }
          if (elapsed < 4000) return { ...j, stage: "validated", progress: 45 };
          if (elapsed < 8500) {
            const p = Math.min(95, 45 + ((elapsed - 4000) / 4500) * 50);
            return { ...j, stage: "printing", progress: p };
          }
          {
            setChat((c) => [
              ...c,
              { from: "bot", text: `✅ Job #${j.id} printed. Pickup ready.`, ts: Date.now() },
            ]);
            return { ...j, stage: "done", progress: 100 };
          }
          return j;
        })
      );
    }, 400);
    return () => clearInterval(t);
  }, []);

  const submit = () => {
    const p = PRESETS[draft];
    const jid = id();
    setChat((c) => [
      ...c,
      { from: "user", text: instr, attach: p.file, ts: Date.now() },
      { from: "bot", text: `📥 Received ${p.file}. Job #${jid} queued.`, ts: Date.now() + 1 },
    ]);
    const newJob: Job = { id: jid, file: p.file, pages: p.pages, raw: instr, stage: "queued", progress: 0, ts: Date.now() };
    setJobs((prev) => [newJob, ...prev].slice(0, 6));
  };

  const active = jobs.filter((j) => j.stage !== "done" && j.stage !== "error").length;
  const done = jobs.filter((j) => j.stage === "done").length;

  return (
    <section ref={demoRef} className="border-b-2 border-ink bg-paper py-16 grid-paper sm:py-24">
      <div className="container">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6 border-b-2 border-ink pb-6">
          <div>
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">06 — Live POC</span>
            <h2 className="mt-2 text-balance text-3xl font-bold sm:text-4xl md:text-5xl">Try it. Watch it print.</h2>
            <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
              Simulated end-to-end pipeline. Send a "WhatsApp" message → the AI parses it → the queue runs it → the printer streams it.
            </p>
          </div>
          <div className="flex gap-3 font-mono text-xs uppercase tracking-widest">
            <span className="border-2 border-ink bg-paper px-3 py-2 shadow-brutal-sm">ACTIVE: <b className="text-neon">{active}</b></span>
            <span className="border-2 border-ink bg-paper px-3 py-2 shadow-brutal-sm">DONE: <b className="text-success">{done}</b></span>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          {/* WhatsApp */}
          <div className="lg:col-span-4">
            <div className="border-2 border-ink bg-card shadow-brutal">
              <div className="flex items-center justify-between border-b-2 border-ink bg-[#075E54] px-4 py-3 text-white">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-full bg-[#25D366] font-bold text-ink">SP</div>
                  <div>
                    <div className="text-sm font-semibold">SmartPrint Bot</div>
                    <div className="text-[10px] opacity-80">online · auto-replies</div>
                  </div>
                </div>
                <span className="font-mono text-[10px] opacity-80">WHATSAPP</span>
              </div>
              <div ref={chatWindow} className="h-80 space-y-2 overflow-y-auto bg-[#ECE5DD] p-3">
                {chat.map((m, i) => (
                  <div key={i} className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.from === "user" ? "bg-[#DCF8C6] text-ink" : "bg-white text-ink"}`}>
                      {m.attach && (
                        <div className="mb-1 flex items-center gap-2 rounded bg-ink/5 p-2 font-mono text-xs">
                          <FileText className="size-4" /> {m.attach}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap">{m.text}</div>
                      <div className="mt-1 text-right text-[9px] opacity-50">{now()}</div>
                    </div>
                  </div>
                ))}
                <div ref={chatEnd} />
              </div>
              <div className="border-t-2 border-ink bg-paper p-3">
                <div className="mb-2 flex flex-wrap gap-1">
                  {PRESETS.map((p, i) => (
                    <button
                      key={p.file}
                      onClick={() => { setDraft(i); setInstr(p.raw); }}
                      className={`border border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-snap ${draft === i ? "bg-ink text-paper" : "bg-paper hover:bg-neon"}`}
                    >
                      {p.file.replace(".pdf", "")}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={instr}
                    onChange={(e) => setInstr(e.target.value)}
                    placeholder="e.g. 2 copies, color, duplex"
                    className="w-full border-2 border-ink bg-paper px-3 py-2 font-mono text-xs outline-none focus:bg-neon/20"
                  />
                  <button onClick={submit} className="grid place-items-center border-2 border-ink bg-ink px-3 text-paper transition-snap hover:bg-neon hover:text-ink">
                    <Send className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* AI Parser feed */}
          <div className="lg:col-span-3">
            <div className="h-full border-2 border-ink bg-ink p-5 text-paper shadow-brutal">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-neon">AI PARSER</span>
                <Brain className="size-4 text-neon" />
              </div>
              <div className="space-y-3 font-mono text-xs">
                {jobs.length === 0 && <div className="text-paper/40">// awaiting input...</div>}
                {jobs.slice(0, 5).map((j) => (
                  <div key={j.id} className="border border-paper/15 p-3">
                    <div className="flex items-center justify-between text-paper/60">
                      <span>#{j.id}</span>
                      {j.stage === "parsing" ? <Loader2 className="size-3 animate-spin text-neon" /> : <Check className="size-3 text-success" />}
                    </div>
                    <div className="mt-2 truncate text-paper/80">"{j.raw}"</div>
                    {j.parsed && (
                      <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-neon">
                        <span>copies: {j.parsed.copies}</span>
                        <span>{j.parsed.color ? "color" : "b&w"}</span>
                        <span>{j.parsed.duplex ? "duplex" : "single"}</span>
                        <span>pp {j.parsed.range}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Queue + printer */}
          <div className="lg:col-span-5">
            <div className="border-2 border-ink bg-card shadow-brutal">
              <div className="flex items-center justify-between border-b-2 border-ink bg-paper px-5 py-3">
                <span className="font-mono text-[10px] uppercase tracking-widest">PRINT QUEUE — REDIS://workers</span>
                <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
                  <span className="size-1.5 rounded-full bg-success animate-blink" /> 4 workers
                </span>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[480px]">
                  <div className="grid grid-cols-5 border-b-2 border-ink bg-muted px-5 py-2 font-mono text-[10px] uppercase tracking-widest">
                    <span>JOB</span><span className="col-span-2">FILE</span><span>STAGE</span><span>PROGRESS</span>
                  </div>

                  <div className="max-h-72 divide-y divide-ink/10 overflow-y-auto">
                    {jobs.length === 0 && (
                      <div className="flex items-center gap-3 p-8 font-mono text-xs text-muted-foreground">
                        <AlertCircle className="size-4" /> No jobs. Send one from WhatsApp →
                      </div>
                    )}
                    {jobs.map((j) => (
                      <div key={j.id} className="grid grid-cols-5 items-center gap-2 px-5 py-3 text-sm">
                        <span className="font-mono text-xs">#{j.id}</span>
                        <span className="col-span-2 truncate">
                          <div className="flex items-center gap-2">
                            <FileText className="size-3 shrink-0" />
                            <span className="truncate">{j.file}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">{j.pages}p</span>
                          </div>
                        </span>
                        <span>
                          <span className={`inline-block px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest ${stageColor[j.stage]}`}>
                            {stageLabel[j.stage]}
                          </span>
                        </span>
                        <span>
                          <div className="h-1.5 w-full overflow-hidden bg-muted">
                            <div className="h-full bg-neon transition-all duration-500" style={{ width: `${j.progress}%` }} />
                          </div>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Printer status */}
              <div className="border-t-2 border-ink bg-ink p-5 text-paper">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Printer className="size-5 text-neon" />
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-paper/60">PRINTER_01 / Lexmark MX622</div>
                      <div className="text-sm font-bold">{active > 0 ? `Streaming job #${jobs.find(j => j.stage === "printing")?.id ?? "..."}` : "Idle · ready"}</div>
                    </div>
                  </div>
                  <div className="relative h-12 w-20 overflow-hidden border border-paper/30 bg-paper">
                    {active > 0 && <div className="absolute inset-x-0 h-3 bg-neon/70 animate-feed" />}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Demo;
