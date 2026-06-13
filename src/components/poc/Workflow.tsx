import { MessageSquare, Download, Brain, ListChecks, Printer, BellRing } from "lucide-react";

const steps = [
  { icon: MessageSquare, t: "Ingest", d: "User sends PDFs to WhatsApp bot or web upload." },
  { icon: Download, t: "Auto-fetch", d: "Files downloaded, deduped, virus-scanned." },
  { icon: Brain, t: "AI parse", d: "NLP extracts copies, color, duplex, page range." },
  { icon: ListChecks, t: "Validate & queue", d: "Job pushed to Redis/Celery worker pool." },
  { icon: Printer, t: "Print", d: "Driver streams to nearest available printer." },
  { icon: BellRing, t: "Notify", d: "User pinged with status + receipt." },
];

const Workflow = () => (
  <section id="workflow" className="border-b-2 border-ink bg-ink py-16 text-paper sm:py-24">
    <div className="container">
      <span className="font-mono text-xs uppercase tracking-widest text-neon">02 — Workflow</span>
      <h2 className="mt-2 max-w-2xl text-balance text-3xl font-bold sm:text-4xl md:text-5xl">
        Six steps. Zero clicks from the operator.
      </h2>

      <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 sm:mt-16">
        {steps.map(({ icon: Icon, t, d }, i) => (
          <li key={t} className="group relative border-2 border-paper/20 bg-ink p-6 transition-snap hover:border-neon hover:shadow-neon">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-widest text-paper/40">STEP / {String(i + 1).padStart(2, "0")}</span>
              <Icon className="size-6 text-neon" strokeWidth={1.5} />
            </div>
            <h3 className="mt-8 text-2xl font-bold">{t}</h3>
            <p className="mt-2 text-sm text-paper/60">{d}</p>
            <div className="mt-6 h-px w-full bg-paper/20 group-hover:bg-neon" />
          </li>
        ))}
      </ol>
    </div>
  </section>
);

export default Workflow;
