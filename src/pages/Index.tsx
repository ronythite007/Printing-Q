import { useRef } from "react";
import Hero from "@/components/poc/Hero";
import Problem from "@/components/poc/Problem";
import Workflow from "@/components/poc/Workflow";
import Architecture from "@/components/poc/Architecture";
import Demo from "@/components/poc/Demo";
import Market from "@/components/poc/Market";
import Footer from "@/components/poc/Footer";

const Index = () => {
  const demoRef = useRef<HTMLElement>(null);
  const scrollDemo = () => demoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <main className="min-h-screen bg-paper">
      <h1 className="sr-only">Smart Print Automation System — Proof of Concept</h1>
      <Hero onDemo={scrollDemo} />
      <Problem />
      <Workflow />
      <Architecture />
      <Demo demoRef={demoRef} />
      <Market />
      <Footer />
    </main>
  );
};

export default Index;
