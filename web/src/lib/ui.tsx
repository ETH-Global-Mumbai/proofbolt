import { useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { FlipWord, Shutter } from "./motion";
import "@/styles.css";

/** The page. A flood turns the whole screen one colour, so the result reads from across a room. */
export function Page({ flood, side, children }: { flood?: "open" | "stop"; side?: ReactNode; children: ReactNode }) {
  return (
    <div className="page" data-flood={flood}>
      <Shutter flood={flood} />
      <header className="bar">
        <span className="brand">proofbolt</span>
        <span>{side}</span>
      </header>
      {children}
    </div>
  );
}

export function Shout({ children, as: Tag = "h1", delay }: { children: string; as?: "h1" | "p"; delay?: number }) {
  return <Tag className="shout"><FlipWord text={children} delay={delay} /></Tag>;
}

/** Calls fn now and then on a timer, and stops when the page goes away. */
export function usePoll(fn: () => void, ms: number) {
  useEffect(() => {
    fn();
    const timer = setInterval(fn, ms);
    return () => clearInterval(timer);
    // The latest fn isn't needed here: each one reads fresh data from the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms]);
}

export function mount(node: ReactNode) {
  createRoot(document.getElementById("root")!).render(node);
}
