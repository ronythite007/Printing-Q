import { Cloud, Database, Cpu, Layers, Smartphone, Printer } from "lucide-react";

const layers = [
  { icon: Smartphone, t: "Frontend", s: "React Dashboard · WhatsApp Bot", c: "neon" },
  { icon: Cpu, t: "API Layer", s: "Flask REST · Webhooks", c: "neon" },
  { icon: Layers, t: "Queue", s: "Redis · Celery Workers", c: "neon" },
  { icon: Database, t: "Storage", s: "MySQL · S3 file vault", c: "neon" },
  { icon: Cloud, t: "AI Service", s: "GPT-4 instruction parser", c: "neon" },
  { icon: Printer, t: "Hardware", s: "CUPS · IPP drivers", c: "neon" },
];

const Architecture = () => (
  <section className="border-b-2 border-ink bg-paper py-16 grid-paper sm:py-24">
    <div className="container">
      <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">03 — Architecture</span>
      <h2 className="mt-2 max-w-2xl text-balance text-3xl font-bold sm:text-4xl md:text-5xl">
        Built like infrastructure, deployed like software.
      </h2>

      <div className="mt-12 grid gap-px border-2 border-ink bg-ink shadow-brutal sm:grid-cols-2 lg:grid-cols-3 sm:mt-16">
        {layers.map(({ icon: Icon, t, s }) => (
          <div key={t} className="bg-paper p-8">
            <Icon className="mb-4 size-7" strokeWidth={1.5} />
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">// {t}</div>
            <div className="mt-1 text-lg font-bold">{s}</div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default Architecture;
