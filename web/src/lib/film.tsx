// A short product film of the locker, built from real 3D-transformed elements, not video. A camera
// moves around the locker as one unlock plays out, then the door opens and the parts come apart.
// The labelled exploded view is an idea from OriginKit's brioche-aloft.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { Hand, Pause, Play } from "lucide-react";
import { FlipWord } from "./motion";

const SCENE_MS = 3400;
const STAGE_WIDTH = 800;
const CAMERA: Transition = { type: "spring", stiffness: 42, damping: 15 };
const PART: Transition = { type: "spring", stiffness: 70, damping: 15 };

type Point = readonly [number, number];
const PHONE: Point = [142, 250];
const ZERO_G: Point = [664, 112];
const LOCK: Point = [400, 250];
const ARKIV: Point = [664, 388];

interface Scene {
  title: string;
  note: string;
  camera: { rotateX: number; rotateY: number; scale: number; x: number };
  lcd: [string, string];
  phone: "qr" | "hand" | "wait" | "open";
  signals?: { from: Point; to: Point; label: string }[];
  active?: "0g" | "arkiv" | "both";
  chip?: string;
}

const SCENES: Scene[] = [
  {
    title: "Scan the link",
    note: "Arkiv confirms the grant is live.",
    camera: { rotateX: -12, rotateY: -28, scale: 0.92, x: 0 },
    lcd: ["LOCKED", ""],
    phone: "qr",
    signals: [{ from: ARKIV, to: PHONE, label: "Grant live" }],
    active: "arkiv",
  },
  {
    title: "Show the gesture",
    note: "A random challenge, so an old photo won't do.",
    camera: { rotateX: -8, rotateY: 22, scale: 0.96, x: 10 },
    lcd: ["Do this:", "4 FINGERS"],
    phone: "hand",
  },
  {
    title: "0G decides",
    note: "The AI answers open, hold or alert.",
    camera: { rotateX: -16, rotateY: -14, scale: 0.9, x: -10 },
    lcd: ["Do this:", "4 FINGERS"],
    phone: "wait",
    signals: [{ from: PHONE, to: ZERO_G, label: "Photo" }],
    active: "0g",
    chip: "OPEN",
  },
  {
    title: "The lock gets a signed command",
    note: "The gateway checks the rules, then signs it. It only works once.",
    camera: { rotateX: -10, rotateY: 30, scale: 1.02, x: 0 },
    lcd: ["Do this:", "4 FINGERS"],
    phone: "wait",
    signals: [{ from: ZERO_G, to: LOCK, label: "Signed" }],
    active: "0g",
    chip: "OPEN",
  },
  {
    title: "The bolt slides back",
    note: "It relocks by itself after 5 seconds.",
    camera: { rotateX: -8, rotateY: -14, scale: 1.04, x: 40 },
    lcd: ["OPEN", "Relocks shortly"],
    phone: "open",
  },
  {
    title: "Nothing clever inside",
    note: "No AI on the board. No valid command, no movement.",
    camera: { rotateX: -12, rotateY: -6, scale: 0.98, x: 30 },
    lcd: ["OPEN", "Relocks shortly"],
    phone: "open",
  },
  {
    title: "Every decision goes on record",
    note: "0G keeps the proof. Arkiv shows it to everyone.",
    camera: { rotateX: -12, rotateY: -20, scale: 0.92, x: 0 },
    lcd: ["LOCKED", ""],
    phone: "qr",
    signals: [
      { from: LOCK, to: ZERO_G, label: "Record" },
      { from: LOCK, to: ARKIV, label: "Status" },
    ],
    active: "both",
    chip: "SAVED",
  },
];

const OPEN_SCENE = 4;
const INSIDE_SCENE = 5;

// A fixed pattern, so the drawing doesn't change between renders.
const QR_CELLS = Array.from({ length: 81 }, (_, cell) => (cell * cell * 7 + cell * 13) % 5 < 2);

function PhoneScreen({ mode }: { mode: Scene["phone"] }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={mode}
        className={`film-screen ${mode === "open" ? "is-open" : ""}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        {mode === "qr" && <div className="film-qr">{QR_CELLS.map((on, cell) => <i key={cell} className={on ? "on" : ""} />)}</div>}
        {mode === "hand" && (
          <>
            <b>4 fingers</b>
            <motion.span animate={{ y: [0, -5, 0] }} transition={{ duration: 1.2, repeat: Infinity }}><Hand size={46} /></motion.span>
          </>
        )}
        {mode === "wait" && (
          <>
            <b>Checking</b>
            <div className="film-wait"><motion.i animate={{ x: ["-100%", "300%"] }} transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }} /></div>
          </>
        )}
        {mode === "open" && <b className="big">Open</b>}
      </motion.div>
    </AnimatePresence>
  );
}

function Locker({ scene, index }: { scene: Scene; index: number }) {
  const open = index === OPEN_SCENE || index === INSIDE_SCENE;
  const inside = index === INSIDE_SCENE;
  return (
    <motion.div className="film-world" initial={false} animate={scene.camera} transition={CAMERA}>
      <div className="face back" />
      <div className="face left" />
      <div className="face right" />
      <div className="face top" />
      <div className="face bottom" />

      {/* The parts on the back wall. They come forward and spread out for the exploded view. */}
      <motion.div className="part board" initial={false} animate={inside ? { x: -96, y: -96, z: 170 } : { x: 0, y: -60, z: -60 }} transition={PART}>
        <span>ESP8266</span>
      </motion.div>
      <motion.div className="part servo" initial={false} animate={inside ? { x: 150, y: -6, z: 200 } : { x: 0, y: 30, z: -40 }} transition={PART}>
        <span>Servo</span>
      </motion.div>
      <motion.div className="part latch" initial={false} animate={inside ? { x: -62, y: 112, z: 230 } : { x: 0, y: 92, z: -20 }} transition={PART}>
        <span>Bolt</span>
      </motion.div>

      <motion.div className="door" initial={false} animate={{ rotateY: open ? -112 : 0 }} transition={{ type: "spring", stiffness: 60, damping: 13, delay: open && !inside ? 0.45 : 0 }}>
        <div className="door-front">
          <div className="lcd"><span>{scene.lcd[0]}</span><span>{scene.lcd[1]}</span></div>
          <motion.i className="led" animate={{ backgroundColor: open ? "#17e088" : "#ff4a2b" }} />
          <div className="slot">
            <motion.i animate={{ x: open ? "-62%" : "0%" }} transition={{ type: "spring", stiffness: 190, damping: 17 }} />
          </div>
          <b>locker-1</b>
        </div>
        <div className="door-back" />
      </motion.div>
    </motion.div>
  );
}

function Signal({ from, to, label }: { from: Point; to: Point; label: string }) {
  return (
    <>
      <svg className="film-line" viewBox={`0 0 ${STAGE_WIDTH} 500`} aria-hidden="true">
        <motion.line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: "easeInOut", delay: 0.3 }} />
      </svg>
      <motion.div
        className="film-packet"
        initial={{ x: from[0], y: from[1], opacity: 0 }}
        animate={{ x: to[0], y: to[1], opacity: [0, 1, 1, 0] }}
        transition={{ duration: 1.3, ease: "easeInOut", delay: 0.3, times: [0, 0.1, 0.9, 1] }}
      >
        <span>{label}</span>
      </motion.div>
    </>
  );
}

function Chip({ name, at, active, text }: { name: string; at: Point; active: boolean; text?: string }) {
  return (
    <motion.div
      className={`film-chip ${active ? "active" : ""}`}
      style={{ left: at[0] - 62, top: at[1] - 44 }}
      animate={{ scale: active ? 1.06 : 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 16 }}
    >
      <b>{name}</b>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={text ?? "idle"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          {text ?? " "}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  );
}

export function ProductFilm() {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!reduce);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setIndex((index + 1) % SCENES.length), SCENE_MS);
    return () => clearTimeout(timer);
  }, [index, playing]);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry!.contentRect.width / STAGE_WIDTH));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const scene = SCENES[index]!;
  const zeroGActive = scene.active === "0g" || scene.active === "both";
  const arkivActive = scene.active === "arkiv" || scene.active === "both";

  return (
    <section aria-label="How proofbolt works" className="film">
      <div className="film-box" ref={box} style={{ height: 500 * scale }}>
        <div className="film-stage" style={{ transform: `scale(${scale})` }} aria-hidden="true">
          <div className="film-3d"><Locker scene={scene} index={index} /></div>
          {/* Everything else steps back while the parts come apart. */}
          <motion.div className="film-side" initial={false} animate={{ opacity: index === INSIDE_SCENE ? 0 : 1, x: index === INSIDE_SCENE ? -30 : 0 }} transition={{ duration: 0.3 }}>
            <div className="film-phone"><PhoneScreen mode={scene.phone} /></div>
          </motion.div>
          <motion.div className="film-side" initial={false} animate={{ opacity: index === INSIDE_SCENE ? 0 : 1, x: index === INSIDE_SCENE ? 30 : 0 }} transition={{ duration: 0.3 }}>
            <Chip name="0G" at={ZERO_G} active={zeroGActive} text={zeroGActive ? scene.chip : undefined} />
            <Chip name="Arkiv" at={ARKIV} active={arkivActive} text={arkivActive ? "Live" : undefined} />
          </motion.div>
          <AnimatePresence>
            {!reduce && scene.signals?.map((signal) => (
              <motion.div key={`${index}-${signal.label}`} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                <Signal {...signal} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <div className="film-caption" aria-live={playing ? "off" : "polite"}>
        <h2 className="film-title"><FlipWord text={scene.title} /></h2>
        <p className="quiet">{scene.note}</p>
      </div>

      <div className="film-controls">
        <button type="button" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <div className="film-scenes">
          {SCENES.map((item, scenePosition) => (
            <button
              key={item.title}
              type="button"
              aria-label={`Scene ${scenePosition + 1}: ${item.title}`}
              aria-current={scenePosition === index ? "step" : undefined}
              onClick={() => setIndex(scenePosition)}
            >
              <span>
                {scenePosition === index ? (
                  <motion.i
                    key={`${index}-${playing}`}
                    initial={{ scaleX: playing ? 0 : 1 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: playing ? SCENE_MS / 1000 : 0, ease: "linear" }}
                  />
                ) : (
                  <i style={{ transform: `scaleX(${scenePosition < index ? 1 : 0})` }} />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
