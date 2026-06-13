import { Printer, Zap, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const Hero = ({ onDemo }: { onDemo: () => void }) => (
  <header className="relative overflow-hidden border-b-2 border-ink bg-paper grid-paper">
    {/* Top status bar */}
    <div className="border-b border-ink/20 bg-ink text-paper">
      <div className="container flex items-center justify-between gap-3 py-2 font-mono text-[10px] uppercase tracking-widest sm:text-[11px]">
        <span className="flex min-w-0 items-center gap-2 truncate">
          <span className="size-1.5 shrink-0 rounded-full bg-neon animate-blink" />
          <span className="truncate">SYS://SMARTPRINT.v0.9.2 — POC BUILD</span>
        </span>
        <span className="hidden md:block">QUEUE: 03 ACTIVE • LATENCY 142ms • UPTIME 99.98%</span>
      </div>
    </div>

    <div className="container relative grid gap-12 py-14 sm:py-20 md:py-28 lg:grid-cols-12 lg:gap-8">
      <div className="lg:col-span-7">
        <div className="mb-6 inline-flex items-center gap-2 border-2 border-ink bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-widest shadow-brutal-sm sm:text-xs">
          <Zap className="size-3 fill-neon text-neon" /> Print Shop Automation • POC
        </div>
        <h1 className="text-balance font-sans text-4xl font-bold leading-[0.95] tracking-tight sm:text-5xl md:text-7xl lg:text-[5.5rem]">
          Print jobs that <br />
          <span className="relative inline-block">
            <span className="relative z-10">run themselves.</span>
            <span className="absolute -bottom-1 left-0 right-0 h-3 bg-neon/60" />
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-base text-muted-foreground sm:text-lg md:text-xl">
          From WhatsApp message to printed page — zero manual clicks. AI parses
          the instructions, the queue handles the rest.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            to="/try-now"
            className="group inline-flex items-center gap-3 border-2 border-ink bg-neon px-7 py-3.5 font-mono text-sm font-bold uppercase tracking-widest text-ink shadow-brutal transition-snap hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[8px_8px_0_hsl(var(--ink))]"
          >
            <Zap className="size-4 fill-ink" /> Try now
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <button
            onClick={onDemo}
            className="inline-flex items-center gap-3 border-2 border-ink bg-paper px-6 py-3.5 font-mono text-sm font-bold uppercase tracking-widest text-ink shadow-brutal-sm transition-snap hover:bg-ink hover:text-paper"
          >
            <Printer className="size-4" /> Watch demo
          </button>
        </div>

        <dl className="mt-10 grid grid-cols-3 gap-3 border-t-2 border-ink pt-6 sm:mt-14 sm:gap-4 sm:pt-8">
          {[
            ["94%", "less manual work"],
            ["3.2s", "avg. parse time"],
            ["0", "missed files"],
          ].map(([k, v]) => (
            <div key={v}>
              <dt className="font-sans text-2xl font-bold sm:text-3xl md:text-4xl">{k}</dt>
              <dd className="mt-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground sm:text-[10px]">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Printer mock */}
      <div className="relative lg:col-span-5">
        <div className="relative mx-auto w-full max-w-sm">
          <div className="absolute -inset-4 rotate-2 border-2 border-ink bg-neon/30" />
          <div className="relative border-2 border-ink bg-card p-6 shadow-brutal">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">PRINTER_01 / READY</span>
              <span className="size-2 rounded-full bg-success animate-blink" />
            </div>
            <div className="relative h-72 overflow-hidden border-2 border-ink bg-ink">
              {/* paper feed */}
              <div className="absolute inset-x-6 top-0 bottom-0 bg-paper">
                <div className="absolute inset-x-2 top-2 space-y-2">
                  <div className="h-2 w-1/2 bg-ink/80" />
                  <div className="h-1.5 w-full bg-ink/30" />
                  <div className="h-1.5 w-5/6 bg-ink/30" />
                  <div className="h-1.5 w-4/6 bg-ink/30" />
                  <div className="mt-3 h-16 w-full bg-ink/10" />
                  <div className="h-1.5 w-full bg-ink/30" />
                  <div className="h-1.5 w-3/6 bg-ink/30" />
                </div>
                {/* scan line */}
                <div className="absolute inset-x-0 h-8 bg-gradient-to-b from-neon/0 via-neon/60 to-neon/0 animate-scan" />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest">
              <span>JOB #A39F · 12pp · DUPLEX</span>
              <span className="text-neon">PRINTING…</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Ticker */}
    <div className="border-t-2 border-ink bg-ink text-paper">
      <div className="flex overflow-hidden py-3">
        <div className="flex shrink-0 animate-ticker gap-12 whitespace-nowrap font-mono text-xs uppercase tracking-[0.3em]">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex shrink-0 gap-12">
              {["WhatsApp ingest", "● AI parse", "● Validate", "● Queue", "● Print", "● Notify", "● Track", "● Bill"].map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  </header>
);

export default Hero;
