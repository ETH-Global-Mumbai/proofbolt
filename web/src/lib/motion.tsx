// The interface moves like the hardware it controls: letters flip like a departure board, a bolt
// slides, a shutter comes down, buttons press into a base plate. Ideas from OriginKit's
// mechanical-flip, tactile-button, rolling-counter and scan-grid-button.
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const SNAP = [0.16, 1, 0.3, 1] as const;
const LETTER_STAGGER = 0.028;
const SLATS = 7;
const SCAN_CELLS = 64;

/** A word whose letters flip into place one by one when it changes. */
export function FlipWord({ text, delay = 0 }: { text: string; delay?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{text}</>;
  let index = 0;
  return (
    <span aria-label={text} role="text" key={text} style={{ display: "inline-block", perspective: 700 }}>
      {text.split(" ").map((word, wordIndex) => (
        <span key={wordIndex} aria-hidden="true" style={{ display: "inline-block", whiteSpace: "nowrap", marginRight: "0.24em" }}>
          {[...word].map((letter, letterIndex) => (
            <motion.span
              key={letterIndex}
              style={{ display: "inline-block", transformOrigin: "50% 100%", backfaceVisibility: "hidden" }}
              initial={{ rotateX: -92, opacity: 0 }}
              animate={{ rotateX: 0, opacity: 1 }}
              transition={{ duration: 0.5, ease: SNAP, delay: delay + index++ * LETTER_STAGGER }}
            >
              {letter}
            </motion.span>
          ))}
        </span>
      ))}
    </span>
  );
}

export type BoltState = "locked" | "open" | "refused";

/** A drawing of the real bolt. It moves when, and only when, the door's state changes. */
export function Bolt({ state }: { state: BoltState }) {
  const reduce = useReducedMotion();
  const open = state === "open";
  return (
    <div className="bolt" role="img" aria-label={open ? "Bolt drawn back" : "Bolt shut"}>
      <span className="bolt-strike" />
      <motion.span
        className="bolt-bar"
        initial={false}
        animate={
          state === "refused" && !reduce
            ? { x: ["0%", "-7%", "0%", "-4%", "0%"] }
            : { x: open ? "-46%" : "0%" }
        }
        transition={
          reduce
            ? { duration: 0 }
            : state === "refused"
              ? { duration: 0.5, delay: 0.3, ease: "easeInOut" }
              : { type: "spring", stiffness: 190, damping: 17, delay: open ? 0.35 : 0 }
        }
      />
    </div>
  );
}

/** Slats that close across the screen, like a roller shutter, as the page changes colour. */
export function Shutter({ flood }: { flood?: "open" | "stop" }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!flood) return setShown(null);
    setShown(flood);
    const timer = setTimeout(() => setShown(null), 800);
    return () => clearTimeout(timer);
  }, [flood]);
  if (reduce || !shown) return null;
  return (
    <div className="shutter" aria-hidden="true">
      {Array.from({ length: SLATS }, (_, slat) => (
        <motion.i
          key={slat}
          style={{ background: `var(--${shown})`, transformOrigin: slat % 2 ? "100% 50%" : "0% 50%" }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.28, ease: SNAP, delay: slat * 0.022 }}
        />
      ))}
    </div>
  );
}

/** A number that rolls to its new value, like an odometer. */
export function RollNumber({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={`roll ${className ?? ""}`} aria-live="assertive">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={reduce ? false : { y: "100%" }}
          animate={{ y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: "-100%" }}
          transition={{ duration: 0.34, ease: SNAP }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Cells that light across the photo in waves while the AI decides. */
export function ScanGrid() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <div className="scan" aria-hidden="true">
      {Array.from({ length: SCAN_CELLS }, (_, cell) => {
        const row = Math.floor(cell / 8);
        const column = cell % 8;
        return <i key={cell} style={{ animationDelay: `${(row + column) * 70}ms` }} />;
      })}
    </div>
  );
}

/** The record's life as a row of lamps. They go out one at a time and refill when it's renewed. */
export function Lamps({ share, count = 30 }: { share: number; count?: number }) {
  const lit = Math.ceil(share * count);
  return (
    <div className="lamps" aria-hidden="true">
      {Array.from({ length: count }, (_, lamp) => (
        <i key={lamp} className={lamp < lit ? "on" : ""} style={{ transitionDelay: `${lamp * 8}ms` }} />
      ))}
    </div>
  );
}
