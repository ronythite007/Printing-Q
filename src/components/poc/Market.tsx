const Market = () => (
  <section className="border-b-2 border-ink bg-paper py-16 sm:py-24">
    <div className="container grid gap-12 lg:grid-cols-2">
      <div>
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">04 — Business</span>
        <h2 className="mt-2 text-balance text-3xl font-bold sm:text-4xl md:text-5xl">Three revenue streams. One platform.</h2>
        <div className="mt-10 space-y-px bg-ink">
          {[
            ["SUBSCRIPTION", "Monthly SaaS for print shops", "₹2,499/mo"],
            ["API USAGE", "Pay-per-print for developers", "₹0.40/job"],
            ["ENTERPRISE", "Self-hosted licensing", "Custom"],
          ].map(([k, d, p]) => (
            <div key={k} className="flex flex-wrap items-center justify-between gap-3 bg-paper p-5 sm:p-6">
              <div className="min-w-0">
                <div className="font-mono text-xs uppercase tracking-widest text-neon">{k}</div>
                <div className="mt-1 text-base font-medium sm:text-lg">{d}</div>
              </div>
              <div className="font-mono text-xl font-bold sm:text-2xl">{p}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">05 — Target market</span>
        <h2 className="mt-2 text-balance text-3xl font-bold sm:text-4xl md:text-5xl">Anywhere paper still rules.</h2>
        <ul className="mt-10 grid grid-cols-2 gap-4">
          {[
            ["12k+", "Local print shops"],
            ["3.4k", "Corporate vendors"],
            ["1.8k", "Universities"],
            ["6k+", "Co-working spaces"],
          ].map(([n, l]) => (
            <li key={l} className="border-2 border-ink p-5 shadow-brutal-sm transition-snap hover:bg-neon sm:p-6">
              <div className="text-3xl font-bold sm:text-4xl">{n}</div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-widest">{l}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </section>
);

export default Market;
