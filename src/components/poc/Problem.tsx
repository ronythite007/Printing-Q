import { AlertTriangle, Clock, FileX, Settings2, EyeOff } from "lucide-react";

const items = [
  { icon: FileX, t: "Missed files", d: "Files buried in chat threads get skipped or printed twice." },
  { icon: Settings2, t: "Wrong settings", d: "Color, duplex, copies — manually configured for every job." },
  { icon: Clock, t: "Slow turnaround", d: "Operators spend 60% of their time downloading, not printing." },
  { icon: EyeOff, t: "No tracking", d: "Customers call repeatedly: 'Is my print ready yet?'" },
];

const Problem = () => (
  <section className="border-b-2 border-ink bg-paper py-16 sm:py-24">
    <div className="container">
      <div className="mb-10 flex items-end justify-between gap-6 border-b-2 border-ink pb-6 sm:mb-14">
        <div>
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">01 — The problem</span>
          <h2 className="mt-2 max-w-2xl text-balance text-3xl font-bold leading-tight sm:text-4xl md:text-5xl">
            Print shops still run on copy-paste and hope.
          </h2>
        </div>
        <AlertTriangle className="hidden size-16 shrink-0 text-signal md:block" strokeWidth={1.2} />
      </div>

      <div className="grid gap-px bg-ink sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ icon: Icon, t, d }) => (
          <div key={t} className="group bg-paper p-8 transition-snap hover:bg-ink hover:text-paper">
            <Icon className="mb-6 size-8" strokeWidth={1.5} />
            <h3 className="font-mono text-sm font-bold uppercase tracking-widest">{t}</h3>
            <p className="mt-3 text-sm text-muted-foreground group-hover:text-paper/70">{d}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default Problem;
