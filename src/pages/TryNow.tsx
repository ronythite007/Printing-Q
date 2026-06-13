import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Monitor,
  Printer,
  ListChecks,
  RefreshCw,
  Send,
  Smartphone,
  Upload,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ConnectionStatus = "connecting" | "qr" | "connected" | "ready" | "error" | "offline";
type ColorMode = "Color" | "Black & White";
type Orientation = "Portrait" | "Landscape";
type Sides = "Single-sided" | "Double-sided";
type JobStage = "pending" | "printing" | "completed" | "failed";

interface PrintSettings {
  copies: number;
  pageRange: string;
  colorMode: ColorMode;
  orientation: Orientation;
  sides: Sides;
}

interface IncomingDocument {
  id: string;
  fileName: string;
  sender: string;
  timestamp: string;
  messageText: string;
  localPath: string;
  mimeType: string;
  sizeKB: number;
  category: string;
  autoFill: PrintSettings;
}

interface QueueJob {
  id: string;
  documentId: string;
  fileName: string;
  filePath: string;
  sender: string;
  messageText: string;
  copies: number;
  pageRange: string;
  colorMode: ColorMode;
  orientation: Orientation;
  sides: Sides;
  stage: JobStage;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

interface ServerSnapshot {
  status: ConnectionStatus;
  qr?: string | null;
  documents: IncomingDocument[];
  queue: QueueJob[];
}

interface ServerEvent {
  type: "status" | "document" | "queue" | "queue-update" | "error";
  status?: ConnectionStatus;
  qr?: string | null;
  document?: IncomingDocument;
  queue?: QueueJob[];
  job?: QueueJob;
  message?: string;
}

const initialSettings: PrintSettings = {
  copies: 1,
  pageRange: "All pages",
  colorMode: "Color",
  orientation: "Portrait",
  sides: "Single-sided",
};

const backendBaseUrl = () => {
  if (typeof window === "undefined") return "http://127.0.0.1:3001";
  if (window.location.protocol === "file:" || !window.location.host) return "http://127.0.0.1:3001";
  return "";
};

const apiUrl = (path: string) => {
  const base = backendBaseUrl();
  return base ? `${base}${path}` : path;
};

const wsUrl = () => {
  const base = backendBaseUrl();
  if (base) return `${base.replace(/^http/, "ws")}/ws`;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
};

const kindIcon: Record<string, typeof FileText> = {
  pdf: FileText,
  image: ImageIcon,
  text: Upload,
  other: Monitor,
};

const displayFileName = (value: string) => {
  const basename = value.split(/[\\/]/).pop() || value;
  const generatedPrefixMatch = basename.match(/^\d{4}-\d{2}-\d{2}T[\d-]+_[^_]+_(.+)$/);
  return generatedPrefixMatch?.[1] ?? basename;
};

export default function TryNow() {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [qr, setQr] = useState<string | null>(null);
  const [documents, setDocuments] = useState<IncomingDocument[]>([]);
  const [queue, setQueue] = useState<QueueJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<IncomingDocument[]>([]);
  const [settings, setSettings] = useState<PrintSettings>(initialSettings);
  const [notes, setNotes] = useState("");
  const [manualPageRange, setManualPageRange] = useState("");
  const [resetting, setResetting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const initialSnapshotLoaded = useRef(false);
  const autoRefreshTriggered = useRef(false);

  const activeJobs = queue.filter((job) => job.stage === "pending" || job.stage === "printing");
  const completedJobs = queue.filter((job) => job.stage === "completed");
  const failedJobs = queue.filter((job) => job.stage === "failed");

  const selectedSummary = useMemo(() => {
    if (selectedDocs.length === 0) return null;
    const senderSet = Array.from(new Set(selectedDocs.map((doc) => doc.sender || "Unknown sender")));
    return {
      fileName: selectedDocs[0].fileName,
      sender: senderSet.length === 1 ? senderSet[0] : `${senderSet.length} senders`,
      timestamp: selectedDocs[0].timestamp,
      messageText:
        selectedDocs.length === 1
          ? selectedDocs[0].messageText || "No instructions sent."
          : "Multiple documents selected.",
    };
  }, [selectedDocs]);

  useEffect(() => {
    const controller = new AbortController();

    const loadSnapshot = async () => {
      try {
        const response = await fetch(apiUrl("/api/snapshot"), { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Snapshot failed (${response.status})`);
        }
        const snapshot = (await response.json()) as ServerSnapshot;
        setStatus(snapshot.status);
        setQr(snapshot.qr ?? null);
        setDocuments(snapshot.documents ?? []);
        setQueue(snapshot.queue ?? []);
        initialSnapshotLoaded.current = true;
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setStatus("offline");
        setError(loadError instanceof Error ? loadError.message : "Unable to load snapshot");
      }
    };

    loadSnapshot();

    const socket = new WebSocket(wsUrl());
    wsRef.current = socket;

    socket.addEventListener("close", () => {
      setStatus((current) => (current === "connected" || current === "ready" ? current : "offline"));
    });
    socket.addEventListener("error", () => {
      setStatus("offline");
      setError("Realtime connection failed.");
    });
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data) as ServerEvent;
      if (payload.type === "status") {
        if (payload.status) setStatus(payload.status);
        if (payload.qr !== undefined) setQr(payload.qr);
      }
      if (payload.type === "document" && payload.document) {
        setDocuments((current) => {
          if (current.some((doc) => doc.id === payload.document?.id)) return current;
          return [payload.document!, ...current].slice(0, 50);
        });

        // Only auto-open / auto-select documents after the initial snapshot has loaded.
        // During initial websocket warm-up the server re-sends recent documents; we don't
        // want to open the popup for historical items on every page refresh.
        if (initialSnapshotLoaded.current) {
          setSelectedDocs((current) => {
            if (!payload.document) return current;
            if (current.some((doc) => doc.id === payload.document?.id)) return current;
            return [payload.document, ...current];
          });
          setSettings(payload.document?.autoFill ?? initialSettings);
          setNotes(payload.document?.messageText || "");
          setManualPageRange(payload.document?.autoFill?.pageRange === "All pages" ? "" : payload.document?.autoFill?.pageRange ?? "");
        }
      }
      if (payload.type === "queue" && payload.queue) {
        setQueue(payload.queue);
      }
      if (payload.type === "queue-update" && payload.job) {
        setQueue((current) => {
          const exists = current.some((job) => job.id === payload.job?.id);
          return exists ? current.map((job) => (job.id === payload.job?.id ? payload.job! : job)) : [payload.job!, ...current];
        });
      }
      if (payload.type === "error" && payload.message) {
        setError(payload.message);
      }
    });

    return () => {
      controller.abort();
      socket.close();
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status === "connected" || status === "ready" || qr) {
      autoRefreshTriggered.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      if (autoRefreshTriggered.current) return;
      autoRefreshTriggered.current = true;
      void resetWhatsAppSession();
    }, 6000);

    return () => window.clearTimeout(timer);
  }, [status, qr]);

  const queueDocument = async () => {
    if (selectedDocs.length === 0) return;

    const pageRange = manualPageRange.trim() || settings.pageRange;

    // Enrich selected documents with stored `documents` state if any field is missing.
    const docsPayload = selectedDocs.map((doc) => {
      const stored = documents.find((d) => d.id === doc.id);
      return {
        documentId: doc.id || stored?.id,
        fileName: doc.fileName || stored?.fileName,
        filePath: doc.localPath || stored?.localPath,
        sender: doc.sender || stored?.sender,
        messageText: notes || doc.messageText || stored?.messageText || "",
        copies: settings.copies ?? stored?.autoFill?.copies ?? 1,
        pageRange,
        colorMode: settings.colorMode || stored?.autoFill?.colorMode || "Color",
        orientation: settings.orientation || stored?.autoFill?.orientation || "Portrait",
        sides: settings.sides || stored?.autoFill?.sides || "Single-sided",
      };
    });

    const missing = docsPayload.filter((d) => !d.documentId || !d.fileName || !d.filePath);
    if (missing.length > 0) {
      const list = missing.map((m) => m.documentId || m.fileName || "<unknown>").join(", ");
      throw new Error(`Missing documentId/fileName/filePath for: ${list}`);
    }

    const response = await fetch(apiUrl("/api/queue"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents: docsPayload }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || "Could not add documents to queue");
    }

    const payload = (await response.json()) as { queue?: QueueJob[]; jobs?: any };
    if (payload.queue) setQueue(payload.queue);

    // clear selection after enqueue
    setSelectedDocs([]);
  };

  const reconnect = () => {
    void resetWhatsAppSession();
  };

  const resetWhatsAppSession = async () => {
    setResetting(true);
    setError(null);
    try {
      const response = await fetch(apiUrl("/api/whatsapp/reset"), { method: "POST" });
      if (!response.ok) {
        throw new Error(`Reset failed (${response.status})`);
      }
      setQr(null);
      setStatus("connecting");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to reset WhatsApp session");
    } finally {
      setResetting(false);
    }
  };

  const statusTone =
    status === "connected" || status === "ready"
      ? "bg-success text-white"
      : status === "qr"
        ? "bg-warning text-black"
        : status === "error"
          ? "bg-destructive text-white"
          : status === "offline"
            ? "bg-muted text-foreground"
            : "bg-primary text-primary-foreground";

  const isConnected = status === "connected" || status === "ready";

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/80 backdrop-blur">
        <div className="container flex min-h-16 items-center justify-between gap-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="size-4" /> Overview
            </Link>
            <div className="hidden h-5 w-px bg-border sm:block" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">SmartPrint WhatsApp Console</div>
              <div className="truncate text-xs text-muted-foreground">Realtime QR login, auto-downloads, and FIFO printing</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge className={statusTone}>
              {isConnected && <CheckCircle2 className="mr-1 size-3.5" />}
              {isConnected
                ? "Connected"
                : status === "qr"
                  ? "QR ready"
                  : status === "offline"
                    ? "Offline"
                    : "Connecting"}
            </Badge>
            <Button variant="outline" size="sm" onClick={reconnect} className="gap-2">
              <RefreshCw className="size-3.5" /> Refresh QR
            </Button>
          </div>
        </div>
      </header>

      <div className="container py-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Try Now</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl">WhatsApp-driven document printing</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Scan the QR code, receive documents from WhatsApp in real time, review the popup, and push jobs into a managed print queue.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4" /> {error}
            </div>
            <button type="button" onClick={() => setError(null)} className="text-xs font-medium uppercase tracking-widest text-destructive/80">
              Dismiss
            </button>
          </div>
        )}

        {!isConnected ? (
          <section className="grid min-h-[62vh] place-items-center">
            <Card className="w-full max-w-xl border-border/80 shadow-sm">
              <CardHeader className="space-y-3 text-center">
                <div className="mx-auto grid size-10 place-items-center rounded-full bg-muted">
                  <Smartphone className="size-5 text-foreground" />
                </div>
                <CardTitle className="text-xl">Scan WhatsApp QR</CardTitle>
                <CardDescription className="mx-auto max-w-md text-sm">
                  Open WhatsApp on your phone and scan this QR code to connect the print console.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="mx-auto grid max-w-[320px] place-items-center rounded-xl border border-border bg-white p-4">
                  {qr ? (
                    <QRCodeCanvas value={qr} size={250} includeMargin className="max-w-full" />
                  ) : (
                    <div className="flex min-h-64 w-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                      <Loader2 className="size-10 animate-spin" />
                      <div>
                        <div className="font-medium text-foreground">Preparing QR code</div>
                        <div className="text-xs text-muted-foreground">Please wait, QR will appear automatically.</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="outline" size="sm" onClick={reconnect} className="gap-2">
                    <RefreshCw className="size-3.5" /> Reconnect
                  </Button>
                  <Button variant="secondary" size="sm" onClick={resetWhatsAppSession} disabled={resetting} className="gap-2">
                    {resetting ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    Force QR
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>
        ) : (
          <section className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              {[
                { label: "Incoming documents", value: documents.length, icon: Upload },
                { label: "Pending queue", value: activeJobs.length, icon: ListChecks },
                { label: "Completed", value: completedJobs.length, icon: CheckCircle2 },
                { label: "Failed", value: failedJobs.length, icon: AlertCircle },
              ].map(({ label, value, icon: Icon }) => (
                <Card key={label}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm text-muted-foreground">{label}</div>
                      <Icon className="size-4 text-muted-foreground" />
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <MessageCircle className="size-4" /> Live document feed
                  </CardTitle>
                  <CardDescription>Every incoming WhatsApp document appears here instantly.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {documents.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      Waiting for a WhatsApp document.
                    </div>
                  ) : (
                    documents.slice(0, 6).map((doc) => {
                      const Icon = kindIcon[doc.category] ?? kindIcon.other;
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={(ev) => {
                            if (ev.ctrlKey || ev.metaKey) {
                              // toggle selection
                              setSelectedDocs((cur) => (cur.some((d) => d.id === doc.id) ? cur.filter((d) => d.id !== doc.id) : [...cur, doc]));
                            } else {
                              // single click selects and opens modal
                              setSelectedDocs([doc]);
                            }
                            setSettings(doc.autoFill);
                            setNotes(doc.messageText);
                            setManualPageRange(doc.autoFill.pageRange === "All pages" ? "" : doc.autoFill.pageRange);
                          }}
                          className="w-full rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
                        >
                          <div className="flex items-start gap-3">
                            <div className="grid size-10 shrink-0 place-items-center rounded-md bg-muted">
                              <Icon className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="truncate font-medium">{displayFileName(doc.fileName)}</div>
                                <Badge variant="secondary" className="shrink-0 text-[10px] uppercase tracking-widest">
                                  {doc.category}
                                </Badge>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                                <span>{doc.sender}</span>
                                <span>{doc.timestamp}</span>
                                <span>{doc.sizeKB} KB</span>
                              </div>
                              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{doc.messageText || "No message text"}</p>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Printer className="size-4" /> Print queue
                  </CardTitle>
                  <CardDescription>Queued jobs, printer state, and completion history.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {queue.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                      No jobs in queue yet.
                    </div>
                  ) : (
                    queue.slice(0, 8).map((job) => (
                      <div key={job.id} className="rounded-md border border-border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{displayFileName(job.fileName)}</div>
                            <div className="text-xs text-muted-foreground">
                              {job.copies} × {job.colorMode} · {job.orientation} · {job.sides}
                            </div>
                          </div>
                          <Badge variant={job.stage === "completed" ? "default" : job.stage === "failed" ? "destructive" : "secondary"}>{job.stage}</Badge>
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="size-3.5" /> {job.createdAt}
                        </div>
                        {job.error && <p className="mt-2 text-xs text-destructive">{job.error}</p>}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </section>
        )}
        </div>

      {selectedDocs.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-[2px]">
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl">
            {/* Header */}
            <div className="flex gap-3 border-b border-border/80 bg-muted/20 px-5 py-4">
              <div className="flex-1 min-w-0">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Print Job</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {selectedDocs.length} {selectedDocs.length === 1 ? "file selected" : "files selected"}
                </div>
              </div>
              <button type="button" onClick={() => setSelectedDocs([])} className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            {/* Content */}
            <div className="max-h-[calc(100vh-160px)] space-y-4 overflow-y-auto p-5">
              {/* Sender & Timestamp (from first selected) */}
              {selectedSummary && (
                <div className="grid gap-4 rounded-lg border border-border/80 bg-muted/15 p-4 text-sm sm:grid-cols-2">
                  <div className="min-w-0">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Name</div>
                    <div className="truncate text-base font-semibold">{selectedSummary.sender}</div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Received time</div>
                    <div className="font-medium text-sm text-foreground/90">{new Date(selectedSummary.timestamp).toLocaleString()}</div>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-border/80 bg-muted/10 p-4">
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {selectedDocs.length === 1 ? "File name" : "Files"}
                </div>
                {selectedDocs.length === 1 ? (
                  <p className="text-sm font-medium break-words text-foreground">{displayFileName(selectedDocs[0].fileName)}</p>
                ) : (
                  <div className="space-y-1.5 text-sm text-foreground/95">
                    {selectedDocs.map((d) => (
                      <div key={d.id} className="truncate">• {displayFileName(d.fileName)}</div>
                    ))}
                  </div>
                )}
              </div>

              {/* Message Text (from first selected) */}
              {selectedSummary?.messageText && (
                <div className="rounded-lg border border-border/80 bg-muted/20 p-4">
                  <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Message</div>
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground/80">{selectedSummary.messageText}</p>
                </div>
              )}

              {/* Print Settings Grid */}
              <div className="space-y-3">
                <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Print Settings</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Copies */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Copies</label>
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={settings.copies}
                    onChange={(event) => setSettings((current) => ({ ...current, copies: Math.max(1, Number(event.target.value || 1)) }))}
                    className="h-10 rounded-md text-sm"
                  />
                </div>

                {/* Page Range */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Page range</label>
                  <Input
                    value={manualPageRange}
                    onChange={(event) => setManualPageRange(event.target.value)}
                    placeholder="All, 1-5, 1,3,5 or 2-4,6"
                    className="h-10 rounded-md text-sm"
                  />
                </div>

                {/* Color Mode */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Color mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["Color", "Black & White"] as ColorMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={settings.colorMode === mode}
                        onClick={() => setSettings((current) => ({ ...current, colorMode: mode }))}
                        className={`rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                          settings.colorMode === mode
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted"
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Orientation */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Orientation</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["Portrait", "Landscape"] as Orientation[]).map((orientation) => (
                      <button
                        key={orientation}
                        type="button"
                        aria-pressed={settings.orientation === orientation}
                        onClick={() => setSettings((current) => ({ ...current, orientation }))}
                        className={`rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                          settings.orientation === orientation
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted"
                        }`}
                      >
                        {orientation}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sides */}
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Sides</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["Single-sided", "Double-sided"] as Sides[]).map((side) => (
                      <button
                        key={side}
                        type="button"
                        aria-pressed={settings.sides === side}
                        onClick={() => setSettings((current) => ({ ...current, sides: side }))}
                        className={`rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                          settings.sides === side
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted"
                        }`}
                      >
                        {side}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-border/80 bg-muted/10 px-5 py-4">
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => setSelectedDocs([])}
                className="h-10 flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  queueDocument().catch((queueError) => setError(queueError instanceof Error ? queueError.message : "Failed to queue document"));
                }}
                className="h-10 flex-1 gap-2"
              >
                <Send className="size-4" /> Add to Queue
              </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
