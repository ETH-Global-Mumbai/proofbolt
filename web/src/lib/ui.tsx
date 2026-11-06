import { useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { motion, useReducedMotion } from "motion/react";
import "@/styles.css";

/** The page. A flood turns the whole screen one colour, so the result reads from across a room. */
export function Page({ flood, side, children }: { flood?: "open" | "stop"; side?: ReactNode; children: ReactNode }) {
  return (
    <div className="page" data-flood={flood}>
      <header className="bar">
        <span className="brand">proofbolt</span>
        <span>{side}</span>
      </header>
      {children}
    </div>
  );
}

/** A big word that rises into place when it changes, which is the one movement a result needs. */
export function Shout({ children, as: Tag = "h1" }: { children: string; as?: "h1" | "p" }) {
  const reduce = useReducedMotion();
  return (
    <Tag className="shout">
      <span className="mask">
        <motion.span
          key={children}
          initial={reduce ? false : { y: "105%" }}
          animate={{ y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.span>
      </span>
    </Tag>
  );
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
