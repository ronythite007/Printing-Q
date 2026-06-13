import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

const Footer = () => (
  <footer className="bg-ink py-16 text-paper">
    <div className="container">
      <div className="flex flex-col items-start justify-between gap-8 border-b border-paper/15 pb-12 md:flex-row md:items-end">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.3em] text-neon">SmartPrint // POC</div>
          <div className="mt-2 max-w-lg text-balance text-3xl font-bold md:text-4xl">
            Stop clicking. Start printing.
          </div>
        </div>
        <Link
          to="/try-now"
          className="group inline-flex items-center gap-3 border-2 border-neon bg-neon px-7 py-3.5 font-mono text-sm font-bold uppercase tracking-widest text-ink transition-snap hover:bg-paper hover:border-paper"
        >
          Launch the console <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 font-mono text-[10px] uppercase tracking-widest text-paper/50">
        <span>Built as a proof of concept · v0.9.2 · {new Date().getFullYear()}</span>
        <span>WhatsApp ingest · AI parse · Queue · Print · Notify</span>
      </div>
    </div>
  </footer>
);

export default Footer;
