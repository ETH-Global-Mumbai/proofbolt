import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { mount, Page, Shout, usePoll } from "@/lib/ui";

const REFRESH_MS = 5000;
const SHOWN_ATTEMPTS = 8;
const LOCKER_TTL_SECONDS = 60;

interface AttemptRow { attemptId: string; outcome: string; reason: string; at: number }
interface DecisionRow { attemptId: string; anchorTx: string }
interface Status {
  lockerId: string;
  gateway: string;
  locker: { lockReachable: boolean; expiresInSeconds?: number } | null;
  attempts: AttemptRow[];
  decisions: DecisionRow[];
}

const REASONS: Record<string, string> = {
  AI_HOLD: "Gesture not confirmed",
  AI_ALERT: "Screen, picture or text in the photo",
  ATTEMPT_EXPIRED: "Took too long",
  NO_GRANT: "Access had ended",
  GRANT_EXPIRED: "Access had expired",
  GRANT_REVOKED: "Access was cancelled",
  WRONG_LOCKER: "Access was for another locker",
  ARKIV_UNREACHABLE: "Arkiv couldn't be read",
  "0G_UNREACHABLE": "0G AI couldn't be reached",
  AI_UNAVAILABLE: "0G AI couldn't be reached",
  INVALID_OUTPUT: "No clear answer from the AI",
  LOCK_UNREACHABLE: "Lock didn't respond",
};

function when(at: number) {
  const date = new Date(at);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function StatusPage() {
  const reduce = useReducedMotion();
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [readAt, setReadAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  usePoll(async () => {
    const response = await fetch("/api/status").catch(() => null);
    if (!response?.ok) {
      setFailed(true);
      return;
    }
    setStatus((await response.json()) as Status);
    setReadAt(Date.now());
    setFailed(false);
  }, REFRESH_MS);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const locker = status?.locker;
  const seconds = Math.max(0, (locker?.expiresInSeconds ?? 0) - Math.round((now - readAt) / 1000));
  const online = !failed && locker?.lockReachable;
  const word = failed ? "Unknown" : !status ? "Reading" : !locker ? "Offline" : locker.lockReachable ? "Online" : "No lock";
  const text = failed
    ? "Arkiv can't be read right now."
    : !status
      ? " "
      : !locker
        ? "The gateway stopped renewing its record on Arkiv, so the record expired. The door stays locked."
        : locker.lockReachable
          ? `This record expires in ${seconds} seconds unless the gateway renews it.`
          : "The gateway can't reach the lock. The door stays locked.";

  const attempts = (status?.attempts ?? []).slice(0, SHOWN_ATTEMPTS);

  return (
    <Page side={status?.lockerId}>
      <main className="column">
        <div aria-live="polite">
          <Shout>{word}</Shout>
          <p className="say">{text}</p>
        </div>
        {online && (
          <div className="life" aria-hidden="true">
            <motion.i
              initial={false}
              animate={{ scaleX: Math.min(1, seconds / LOCKER_TTL_SECONDS) }}
              transition={reduce ? { duration: 0 } : { duration: 0.9, ease: "linear" }}
            />
          </div>
        )}
        {attempts.length > 0 && (
          <section className="list">
            <h2>Latest attempts</h2>
            <AnimatePresence initial={false}>
              {attempts.map((attempt) => {
                const opened = attempt.outcome === "OPENED";
                const decision = status?.decisions.find((item) => item.attemptId === attempt.attemptId);
                return (
                  <motion.div
                    key={attempt.attemptId}
                    layout={reduce ? false : "position"}
                    className="row"
                    initial={reduce ? false : { opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <div>
                      <span className={opened ? "yes" : ""}>{opened ? "Opened" : "Refused"}</span>
                      {!opened && <small>{REASONS[attempt.reason] ?? attempt.reason}</small>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <time className="quiet" title={new Date(attempt.at).toLocaleString()}>{when(attempt.at)}</time>
                      {decision && <a style={{ display: "block" }} href={`https://chainscan-galileo.0g.ai/tx/${decision.anchorTx}`} target="_blank" rel="noreferrer">0G record</a>}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </section>
        )}
        {status && <p className="quiet" style={{ marginTop: "auto", paddingTop: 32, fontSize: 13, overflowWrap: "anywhere" }}>Read from Arkiv, not the gateway. Writer {status.gateway}</p>}
      </main>
    </Page>
  );
}

mount(<StatusPage />);
