import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/arc/button/button";
import { ConfirmMorph } from "@/components/arc/confirm-morph/confirm-morph";
import { CopyButton } from "@/components/arc/copy-button/copy-button";
import { Input } from "@/components/arc/input/input";
import { mount, Page, Shout, usePoll } from "@/lib/ui";

const REFRESH_MS = 5000;
const DURATIONS = [
  { minutes: 1, label: "1 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 1440, label: "1 day" },
  { minutes: 10080, label: "7 days" },
];

interface GrantRow { id: string; label: string; revoked: boolean; expiresInSeconds: number }
interface OwnerState { lockerId: string; statusUrl: string; locker: { lockReachable: boolean } | null; grants: GrantRow[] }
interface Created { id: string; link: string; qr: string }

async function post<T>(path: string, body: object): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result as T;
}

function timeLeft(seconds: number) {
  if (seconds < 60) return `${seconds} s left`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min left`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h left`;
  return `${Math.round(seconds / 86400)} days left`;
}

function OwnerPage() {
  const reduce = useReducedMotion();
  const [state, setState] = useState<OwnerState | null>(null);
  const [failed, setFailed] = useState(false);
  const [readAt, setReadAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [minutes, setMinutes] = useState(60);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const refresh = async () => {
    const response = await fetch("/api/state").catch(() => null);
    if (!response?.ok) {
      setFailed(true);
      return;
    }
    setState((await response.json()) as OwnerState);
    setReadAt(Date.now());
    setFailed(false);
  };
  usePoll(refresh, REFRESH_MS);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCreated(await post<Created>("/api/grants", { minutes, label }));
      setLabel("");
      await refresh();
    } catch (problem) {
      setError((problem as Error).message || "Couldn't create the link.");
    } finally {
      setBusy(false);
    }
  };

  const elapsed = Math.floor((now - readAt) / 1000);
  const live = (state?.grants ?? []).filter((grant) => !grant.revoked && grant.expiresInSeconds - elapsed > 0);
  const lock = failed ? "Arkiv can't be read" : !state ? "Reading" : !state.locker ? "Gateway offline" : state.locker.lockReachable ? "Lock online" : "Lock not responding";

  return (
    <Page side={state ? <a href={state.statusUrl} target="_blank" rel="noreferrer">{lock}</a> : lock}>
      <main className="column">
        <AnimatePresence mode="wait" initial={false}>
          {created ? (
            <motion.section
              key="created"
              aria-live="polite"
              initial={reduce ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <Shout>Scan it</Shout>
              <p className="say">Only shown now. Anyone with it can try the door.</p>
              <img className="qr" style={{ marginTop: 20 }} src={created.qr} alt="QR code of the access link" />
              <p className="code">{created.link}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <CopyButton value={created.link} label="Copy link" />
                <Button variant="secondary" onClick={() => setCreated(null)}>Done</Button>
              </div>
            </motion.section>
          ) : (
            <motion.form
              key="form"
              onSubmit={(event) => void create(event)}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Shout>New access</Shout>
              <label className="field" style={{ marginTop: 26 }} id="lasts">Lasts</label>
              <div className="choices" role="group" aria-labelledby="lasts">
                {DURATIONS.map((option) => (
                  <button key={option.minutes} type="button" aria-pressed={minutes === option.minutes} onClick={() => setMinutes(option.minutes)}>
                    {minutes === option.minutes && <motion.i layoutId="choice" transition={reduce ? { duration: 0 } : { type: "spring", duration: 0.35, bounce: 0.05 }} />}
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
              <Input label="Note" description="Public on Arkiv. Leave out names." maxLength={40} autoComplete="off" value={label} onChange={(event) => setLabel(event.target.value)} />
              <div style={{ marginTop: 22 }}>
                <Button variant="primary" size="lg" className="wide" type="submit" disabled={busy}>{busy ? "Writing to Arkiv…" : "Create link"}</Button>
              </div>
              {error && <p role="alert" style={{ color: "var(--stop)", margin: "12px 0 0" }}>{error}</p>}
            </motion.form>
          )}
        </AnimatePresence>

        {live.length > 0 && (
          <section className="list">
            <h2>Live access</h2>
            <AnimatePresence initial={false}>
              {live.map((grant) => (
                <motion.div
                  key={grant.id}
                  layout={reduce ? false : "position"}
                  className="row"
                  style={{ alignItems: "center" }}
                  initial={reduce ? false : { opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16, transition: { duration: 0.18 } }}
                >
                  <div>
                    {grant.label || "Access"}
                    <small>{timeLeft(grant.expiresInSeconds - elapsed)}</small>
                  </div>
                  <ConfirmMorph
                    label="Revoke"
                    prompt="Revoke?"
                    confirmLabel="Revoke"
                    cancelLabel="Keep"
                    pendingLabel="Writing"
                    doneLabel="Revoked"
                    errorLabel="Failed"
                    retryLabel="Retry"
                    onConfirm={async () => {
                      await post(`/api/grants/${grant.id}/revoke`, {});
                      await refresh();
                    }}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </section>
        )}
      </main>
    </Page>
  );
}

mount(<OwnerPage />);
