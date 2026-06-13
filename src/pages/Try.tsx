import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Upload, FileText, Send, Brain, Printer as PrinterIcon, Check, X,
  Loader2, ArrowLeft, Trash2, RotateCcw, Activity, Wallet, Files,
  CheckCircle2, Clock, AlertCircle, Mail, MessageCircle, Globe,
  Settings2, Search, Circle, Layers, Timer,
} from "lucide-react";
import {
  PrintJob, Stage, MOCK_PRINTERS, MOCK_USERS, SAMPLE_FILES,
  id, parseInstruction, estimateCost, loadJobs, saveJobs,
  pickPrinter, estimateEta, formatEta,
} from "@/lib/printSystem";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const stageMeta: Record<Stage, { label: string; tone: string; icon: typeof Clock }> = {
  queued:    { label: "Queued",     tone: "bg-muted text-foreground border-border",                  icon: Clock },
  parsing:   { label: "Parsing",    tone: "bg-warning/15 text-foreground border-warning/40",        icon: Brain },
  validated: { label: "Validated",  tone: "bg-accent/15 text-foreground border-accent/40",          icon: CheckCircle2 },
  printing:  { label: "Printing",   tone: "bg-primary text-primary-foreground border-primary",      icon: PrinterIcon },
  done:      { label: "Completed",  tone: "bg-success/15 text-foreground border-success/40",        icon: Check },
  error:     { label: "Failed",     tone: "bg-destructive/15 text-destructive border-destructive/40", icon: AlertCircle },
};

const sourceIcon = { web: Globe, whatsapp: MessageCircle, email: Mail } as const;

export default function Try() {
  const [jobs, setJobs] = useState<PrintJob[]>(() => loadJobs());
  const [draft, setDraft] = useState(0);
  const [bulkSel, setBulkSel] = useState<Set<number>>(new Set());
  const [instr, setInstr] = useState("2 copies, color, single side, A4");
  const [user] = useState(MOCK_USERS[0]);
  const [source, setSource] = useState<PrintJob["source"]>("web");
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "done">("all");
  const [search, setSearch] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => saveJobs(jobs), [jobs]);

  useEffect(() => {
    const t = setInterval(() => {
      setJobs((prev) => {
        // Zomato model: each printer processes one "printing" job at a time.
        // Other queued/validated jobs wait. Promote next per printer when free.
        const printingByPrinter: Record<string, string> = {};
        prev.forEach((j) => {
          if (j.stage === "printing" && j.printer) printingByPrinter[j.printer] = j.id;
        });

        return prev.map((j) => {
          if (j.stage === "done" || j.stage === "error") return j;
          const e = Date.now() - j.ts;

          // Parsing happens fast for everyone (AI is parallel)
          if (!j.parsed && e > 600) {
            const parsed = parseInstruction(j.raw, j.pages);
            const printer = pickPrinter(MOCK_PRINTERS, prev);
            const ahead = prev.filter(
              (o) => o.printer === printer && o.id !== j.id && o.ts < j.ts && o.stage !== "done" && o.stage !== "error"
            ).length;
            const etaSec = estimateEta(parsed, j.pages, ahead);
            return {
              ...j, stage: "parsing", parsed, progress: 22,
              cost: estimateCost(parsed, j.pages),
              printer: j.printer ?? printer, etaSec,
            };
          }
          if (j.stage === "parsing" && e > 1800) {
            return { ...j, stage: "validated", progress: 42 };
          }

          // Promote to printing only if printer is free
          if ((j.stage === "validated" || j.stage === "queued") && j.printer) {
            const occupant = printingByPrinter[j.printer];
            const nextForPrinter = prev
              .filter((o) => o.printer === j.printer && o.stage !== "done" && o.stage !== "error" && o.stage !== "printing")
              .sort((a, b) => a.ts - b.ts)[0];
            if (!occupant && nextForPrinter?.id === j.id) {
              printingByPrinter[j.printer] = j.id;
              return { ...j, stage: "printing", progress: 50, ts: j.ts };
            }
            // Update live ETA based on remaining queue ahead
            const ahead = prev.filter(
              (o) => o.printer === j.printer && o.id !== j.id && o.ts < j.ts && o.stage !== "done" && o.stage !== "error"
            ).length;
            return { ...j, etaSec: estimateEta(j.parsed, j.pages, ahead) };
          }

          if (j.stage === "printing") {
            const next = Math.min(99, j.progress + 1.6);
            if (next >= 99) return { ...j, stage: "done", progress: 100 };
            return { ...j, progress: next, etaSec: Math.max(0, (j.etaSec ?? 10) - 0.4) };
          }
          return j;
        });
      });
    }, 350);
    return () => clearInterval(t);
  }, []);

  const buildJob = (f: { file: string; pages: number; sizeKB: number }, batch?: { id: string; i: number; total: number }, offset = 0): PrintJob => ({
    id: id(), file: f.file, pages: f.pages, sizeKB: f.sizeKB,
    raw: instr, stage: "queued", progress: 0, ts: Date.now() + offset,
    source, user,
    batchId: batch?.id, batchIndex: batch?.i, batchTotal: batch?.total,
  });

  const submit = (override?: { file: string; pages: number; sizeKB: number }) => {
    const f = override ?? SAMPLE_FILES[draft];
    const job = buildJob(f);
    setJobs((p) => [job, ...p].slice(0, 50));
    setSelected(job.id);
  };

  const submitBulk = (files: { file: string; pages: number; sizeKB: number }[]) => {
    if (!files.length) return;
    const bid = "B-" + id();
    const newJobs = files.map((f, i) => buildJob(f, { id: bid, i: i + 1, total: files.length }, i));
    setJobs((p) => [...newJobs.reverse(), ...p].slice(0, 50));
    setSelected(newJobs[newJobs.length - 1].id);
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const mapped = files.map((file) => ({
      file: file.name,
      pages: Math.max(1, Math.round(file.size / 50000)),
      sizeKB: Math.round(file.size / 1024),
    }));
    if (mapped.length === 1) submit(mapped[0]);
    else submitBulk(mapped);
    e.target.value = "";
  };

  const reprint = (j: PrintJob) => {
    const copy: PrintJob = { ...j, id: id(), stage: "queued", progress: 0, ts: Date.now(), parsed: undefined, printer: undefined, etaSec: undefined };
    setJobs((p) => [copy, ...p].slice(0, 50));
    setSelected(copy.id);
  };

  const remove = (jid: string) => setJobs((p) => p.filter((x) => x.id !== jid));
  const clearAll = () => { setJobs([]); setSelected(null); };

  const stats = useMemo(() => {
    const today = jobs.filter((j) => Date.now() - j.ts < 86400000);
    return {
      active: jobs.filter((j) => j.stage !== "done" && j.stage !== "error").length,
      done: jobs.filter((j) => j.stage === "done").length,
      pages: today.reduce((s, j) => s + (j.parsed ? j.pages * j.parsed.copies : j.pages), 0),
      revenue: jobs.reduce((s, j) => s + (j.cost ?? 0), 0),
    };
  }, [jobs]);

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (filter === "active" && (j.stage === "done" || j.stage === "error")) return false;
      if (filter === "done" && j.stage !== "done") return false;
      if (search && !`${j.file} ${j.id} ${j.user}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [jobs, filter, search]);

  const focused = jobs.find((j) => j.id === selected) ?? jobs[0];

  return (
    <TooltipProvider delayDuration={150}>
    <main className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3 sm:gap-6">
            <Link to="/" className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="size-4" /> <span className="hidden sm:inline">Overview</span>
            </Link>
            <Separator orientation="vertical" className="hidden h-5 sm:block" />
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-7 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground">
                <PrinterIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold leading-none">SmartPrint Console</div>
                <div className="hidden text-[10px] text-muted-foreground sm:block">Working POC · mock data</div>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-success" />
              </span>
              <span className="hidden sm:inline">System online</span>
            </div>
            <Separator orientation="vertical" className="hidden h-5 lg:block" />
            <span className="hidden text-muted-foreground lg:inline">{MOCK_PRINTERS.length} printers</span>
            <Separator orientation="vertical" className="hidden h-5 lg:block" />
            <span className="hidden text-muted-foreground lg:inline">{user}</span>
          </div>
        </div>
      </header>

      <div className="container py-4 sm:py-8">
        {/* Title row */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Print Operations</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Submit a job, watch the AI parse it, and route it across the printer fleet in real time.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={clearAll} className="gap-2">
            <Trash2 className="size-3.5" /> Clear all jobs
          </Button>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {[
            { i: Activity, l: "Active jobs",   v: stats.active,  hint: "In queue or printing" },
            { i: Check,    l: "Completed",     v: stats.done,    hint: "All time" },
            { i: Files,    l: "Pages today",   v: stats.pages,   hint: "Last 24h" },
            { i: Wallet,   l: "Revenue",       v: `₹${stats.revenue}`, hint: "All time" },
          ].map(({ i: Icon, l, v, hint }) => (
            <Card key={l}>
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-muted-foreground">{l}</span>
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{v}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          {/* SUBMIT PANEL */}
          <section className="space-y-6 lg:col-span-4">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Send className="size-4" /> New print job
                </CardTitle>
                <CardDescription>Choose a source, attach a file, describe in plain English.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Source tabs */}
                <div>
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">Source channel</label>
                  <Tabs value={source} onValueChange={(v) => setSource(v as PrintJob["source"])}>
                    <TabsList className="grid w-full grid-cols-3">
                      {(["web", "whatsapp", "email"] as const).map((s) => {
                        const Icon = sourceIcon[s];
                        return (
                          <TabsTrigger key={s} value={s} className="gap-1.5 capitalize">
                            <Icon className="size-3.5" /> {s}
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>
                  </Tabs>
                </div>

                {/* Upload — single or bulk */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">Document(s)</label>
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <Layers className="size-3" /> Bulk supported
                    </Badge>
                  </div>
                  <button
                    onClick={() => fileInput.current?.click()}
                    className="group flex w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/30 px-4 py-6 transition-colors hover:border-accent hover:bg-accent/5"
                  >
                    <Upload className="size-5 text-muted-foreground group-hover:text-accent" />
                    <div className="text-center">
                      <div className="text-sm font-medium">Click to upload — single or many</div>
                      <div className="text-[11px] text-muted-foreground">Drop 5, 10, 20 PDFs · auto-batched & routed</div>
                    </div>
                  </button>
                  <input ref={fileInput} type="file" multiple hidden onChange={onUpload} />
                </div>

                {/* Sample — single click sets draft, checkbox toggles bulk */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">
                      Sample files {bulkSel.size > 0 && <span className="ml-1 text-foreground">· {bulkSel.size} selected</span>}
                    </label>
                    {bulkSel.size > 0 && (
                      <button
                        onClick={() => setBulkSel(new Set())}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {SAMPLE_FILES.map((p, i) => {
                      const checked = bulkSel.has(i);
                      return (
                        <button
                          key={p.file}
                          onClick={() => {
                            setBulkSel((s) => {
                              const next = new Set(s);
                              next.has(i) ? next.delete(i) : next.add(i);
                              return next;
                            });
                            setDraft(i);
                          }}
                          className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                            checked
                              ? "border-primary bg-primary/10"
                              : draft === i
                              ? "border-primary/60 bg-primary/5"
                              : "border-border bg-card hover:border-primary/40 hover:bg-muted/40"
                          }`}
                        >
                          <div className={`grid size-4 shrink-0 place-items-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                            {checked && <Check className="size-3" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{p.file.replace(".pdf", "")}</div>
                            <div className="text-[10px] text-muted-foreground">{p.pages}p · {p.sizeKB}KB</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="outline" size="sm" className="flex-1 gap-1.5 text-xs"
                      onClick={() => setBulkSel(new Set(SAMPLE_FILES.map((_, i) => i)))}
                    >
                      <Layers className="size-3.5" /> Select all ({SAMPLE_FILES.length})
                    </Button>
                    <Button
                      size="sm" className="flex-1 gap-1.5 text-xs"
                      disabled={bulkSel.size === 0}
                      onClick={() => {
                        submitBulk(Array.from(bulkSel).sort().map((i) => SAMPLE_FILES[i]));
                        setBulkSel(new Set());
                      }}
                    >
                      <Send className="size-3.5" /> Queue {bulkSel.size || ""} batch
                    </Button>
                  </div>
                </div>

                {/* Instruction */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">Print instruction</label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <Brain className="size-3" /> AI parsed
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>GPT-4 extracts copies, color, duplex, range</TooltipContent>
                    </Tooltip>
                  </div>
                  <Textarea
                    value={instr}
                    onChange={(e) => setInstr(e.target.value)}
                    rows={3}
                    placeholder="e.g. 3 copies, color, both sides, A4, pages 1–10"
                    className="resize-none font-mono text-xs"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {["2 copies, color", "1 copy, b&w, duplex", "5 sets, color, A3"].map((q) => (
                      <button
                        key={q}
                        onClick={() => setInstr(q)}
                        className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                <Button onClick={() => submit()} className="w-full gap-2" size="lg">
                  <Send className="size-4" /> Submit print job
                </Button>
              </CardContent>
            </Card>

            {/* Printer fleet */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings2 className="size-4" /> Printer fleet
                </CardTitle>
                <CardDescription>Live status across {MOCK_PRINTERS.length} units</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {MOCK_PRINTERS.map((p) => {
                  const busy = jobs.some((j) => j.stage === "printing" && j.printer === p.id);
                  return (
                    <div key={p.id} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`flex size-9 items-center justify-center rounded-md ${busy ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                            <PrinterIcon className="size-4" />
                          </div>
                          <div>
                            <div className="text-sm font-medium leading-none">{p.name}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">{p.id} · {p.model}</div>
                          </div>
                        </div>
                        <Badge variant={busy ? "default" : "secondary"} className="gap-1 text-[10px]">
                          <Circle className={`size-1.5 fill-current ${busy ? "" : "text-success"}`} />
                          {busy ? "Busy" : "Online"}
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div>
                          <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                            <span>Paper</span><span>{p.paper}%</span>
                          </div>
                          <Progress value={p.paper} className="h-1" />
                        </div>
                        <div>
                          <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                            <span>Toner</span><span>{p.toner}%</span>
                          </div>
                          <Progress value={p.toner} className="h-1" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </section>

          {/* QUEUE */}
          <section className="lg:col-span-5">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Print queue</CardTitle>
                    <CardDescription>{jobs.filter((j) => j.stage !== "done").length} pending · {jobs.length} total</CardDescription>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search"
                      className="h-8 w-32 pl-8 text-xs sm:w-44"
                    />
                  </div>
                </div>
                <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)} className="mt-3">
                  <TabsList className="grid w-full max-w-xs grid-cols-3">
                    <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                    <TabsTrigger value="active" className="text-xs">Active</TabsTrigger>
                    <TabsTrigger value="done" className="text-xs">Completed</TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent className="p-0">
                {filtered.length === 0 ? (
                  <div className="px-6 py-16 text-center">
                    <FileText className="mx-auto mb-3 size-10 text-muted-foreground/50" strokeWidth={1.2} />
                    <div className="text-sm font-medium">No jobs to show</div>
                    <div className="mt-1 text-xs text-muted-foreground">Submit one from the panel on the left to start.</div>
                  </div>
                ) : (
                  <div className="max-h-[680px] divide-y divide-border overflow-y-auto">
                    {filtered.map((j) => {
                      const Meta = stageMeta[j.stage];
                      const SIcon = sourceIcon[j.source];
                      const active = focused?.id === j.id;
                      return (
                        <button
                          key={j.id}
                          onClick={() => setSelected(j.id)}
                          className={`block w-full px-5 py-3 text-left transition-colors ${active ? "bg-accent/10" : "hover:bg-muted/40"}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded bg-muted">
                                <FileText className="size-4 text-muted-foreground" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="truncate text-sm font-medium">{j.file}</span>
                                  <span className="font-mono text-[10px] text-muted-foreground">#{j.id}</span>
                                  {j.batchId && (
                                    <Badge variant="outline" className="h-4 gap-1 px-1.5 text-[9px] font-mono">
                                      <Layers className="size-2.5" /> {j.batchIndex}/{j.batchTotal}
                                    </Badge>
                                  )}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                                  <span className="flex items-center gap-1"><SIcon className="size-3" /> {j.source}</span>
                                  <span>·</span>
                                  <span>{j.pages}p</span>
                                  {j.printer && <><span>·</span><span className="font-mono">{j.printer}</span></>}
                                  {j.stage !== "done" && j.etaSec != null && (
                                    <>
                                      <span>·</span>
                                      <span className="flex items-center gap-1 font-medium text-foreground">
                                        <Timer className="size-3" /> {formatEta(Math.round(j.etaSec))}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <Badge variant="outline" className={`shrink-0 gap-1 border ${Meta.tone}`}>
                              {j.stage === "parsing" || j.stage === "printing" ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Meta.icon className="size-3" />
                              )}
                              {Meta.label}
                            </Badge>
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <Progress value={j.progress} className="h-1 flex-1" />
                            <span className="w-9 text-right font-mono text-[10px] text-muted-foreground">{Math.round(j.progress)}%</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* DETAIL PANEL */}
          <section className="lg:col-span-3">
            <Card className="lg:sticky lg:top-20">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Job details</CardTitle>
                  {focused && (
                    <div className="flex gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => reprint(focused)}>
                            <RotateCcw className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Reprint</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" onClick={() => remove(focused.id)}>
                            <X className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Remove</TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!focused ? (
                  <div className="py-12 text-center">
                    <FileText className="mx-auto mb-3 size-10 text-muted-foreground/50" strokeWidth={1.2} />
                    <div className="text-sm font-medium">No job selected</div>
                    <div className="mt-1 text-xs text-muted-foreground">Pick one from the queue.</div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {/* File */}
                    <div className="rounded-md border border-border bg-muted/30 p-3">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 text-muted-foreground" />
                        <span className="truncate text-sm font-medium">{focused.file}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span>#{focused.id}</span>
                        <span>·</span>
                        <span>{focused.pages} pages</span>
                        <span>·</span>
                        <span>{focused.sizeKB} KB</span>
                      </div>
                    </div>

                    {/* Stage */}
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs">
                        <span className="font-medium text-muted-foreground">Status</span>
                        <Badge variant="outline" className={`gap-1 border ${stageMeta[focused.stage].tone}`}>
                          {focused.stage === "parsing" || focused.stage === "printing" ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : null}
                          {stageMeta[focused.stage].label}
                        </Badge>
                      </div>
                      <Progress value={focused.progress} className="h-1.5" />
                      <div className="mt-1 text-right font-mono text-[10px] text-muted-foreground">{Math.round(focused.progress)}%</div>
                      {focused.stage !== "done" && focused.etaSec != null && (
                        <div className="mt-2 flex items-center justify-between rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5">
                          <span className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                            <Timer className="size-3.5 text-accent" /> ETA
                          </span>
                          <span className="font-mono text-xs font-semibold">{formatEta(Math.round(focused.etaSec))}</span>
                        </div>
                      )}
                      {focused.batchId && (
                        <div className="mt-2 flex items-center justify-between rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
                          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Layers className="size-3.5" /> Batch {focused.batchId}
                          </span>
                          <span className="font-mono text-[11px]">{focused.batchIndex} of {focused.batchTotal}</span>
                        </div>
                      )}
                    </div>

                    {/* Instruction */}
                    <div>
                      <div className="mb-2 text-xs font-medium text-muted-foreground">User instruction</div>
                      <div className="rounded-md border-l-2 border-accent bg-muted/40 p-2.5 font-mono text-xs italic text-foreground">
                        "{focused.raw}"
                      </div>
                    </div>

                    {/* Parsed */}
                    {focused.parsed && (
                      <div>
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Brain className="size-3" /> AI parsed parameters
                        </div>
                        <dl className="grid grid-cols-2 gap-2">
                          {[
                            ["Copies", focused.parsed.copies],
                            ["Color",  focused.parsed.color ? "Yes" : "No"],
                            ["Duplex", focused.parsed.duplex ? "Yes" : "No"],
                            ["Pages",  focused.parsed.range],
                            ["Paper",  focused.parsed.paper],
                            ["Cost",   `₹${focused.cost ?? 0}`],
                          ].map(([k, v]) => (
                            <div key={k as string} className="rounded-md border border-border bg-card p-2">
                              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{k}</dt>
                              <dd className="mt-0.5 text-sm font-semibold">{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}

                    {/* Printer */}
                    <div className="rounded-md border border-border bg-primary p-3 text-primary-foreground">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-medium uppercase tracking-wide text-primary-foreground/60">Routed to</div>
                          <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
                            <PrinterIcon className="size-4 text-accent" />
                            {focused.printer ?? "Awaiting validation…"}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Meta */}
                    <Separator />
                    <div className="space-y-1 text-[11px] text-muted-foreground">
                      <div>Submitted via <span className="font-medium text-foreground">{focused.source}</span></div>
                      <div>By <span className="font-medium text-foreground">{focused.user}</span></div>
                      <div>{new Date(focused.ts).toLocaleString()}</div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </main>
    </TooltipProvider>
  );
}
