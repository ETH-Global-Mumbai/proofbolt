import { lazy, Suspense, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/arc/button/button";
import { ProductFilm } from "@/lib/film";
import { Bolt, RollNumber, ScanGrid } from "@/lib/motion";
import { hasWebGL } from "@/lib/scene3d";
import type { LockFace } from "@/lib/lock3d";
import { mount, Page, Shout } from "@/lib/ui";

const Lock3D = lazy(() => import("@/lib/lock3d"));
const SOLID = hasWebGL();

/** The big word: on the lock's face in 3D, or on the page if the browser can't do 3D. */
function Title({ children, delay }: { children: string; delay?: number }) {
  return SOLID ? <h1 className="sr">{children}</h1> : <Shout delay={delay}>{children}</Shout>;
}

const OPEN_SECONDS = 5;
const COUNTDOWN_SECONDS = 3;
const CONTACT = "Ask whoever gave you access.";

interface Attempt {
  id: string;
  state: "CHECKING_ACCESS" | "AWAITING_PHOTO" | "DECIDING" | "OPENED" | "DENIED";
  challenge: string | null;
  reason: string | null;
  triesLeft: number;
  retrying: boolean;
}
interface Access { grantId: string; code: string }

// What happened, and whether trying again can help.
const REASONS: Record<string, [string, boolean]> = {
  AI_HOLD: ["We couldn't confirm your gesture.", true],
  AI_ALERT: ["That looked like a screen, a picture or text. Show your own hand.", true],
  ATTEMPT_EXPIRED: ["That took too long. Each attempt lasts 3 minutes.", true],
  NO_GRANT: [`This access link has ended. ${CONTACT}`, false],
  BAD_CODE: [`This access link isn't valid. Try opening it again. ${CONTACT}`, false],
  CODE_NOT_VERIFIED: ["This access link isn't valid. Please open it again.", false],
  GRANT_EXPIRED: [`This access has expired. ${CONTACT}`, false],
  GRANT_REVOKED: [`This access was cancelled. ${CONTACT}`, false],
  WRONG_LOCKER: ["This link is for another locker.", false],
  ARKIV_UNREACHABLE: ["We can't check your access right now.", true],
  "0G_UNREACHABLE": ["The AI check is unavailable right now.", true],
  AI_UNAVAILABLE: ["The AI check is unavailable right now.", true],
  INVALID_OUTPUT: ["The AI check gave no clear answer.", true],
  LOCK_UNREACHABLE: ["The lock isn't responding right now.", true],
};

// Convenience only: without browser storage, a refresh just asks for the link again.
function remembered(): Access | null {
  try {
    return JSON.parse(sessionStorage.getItem("access") ?? "null");
  } catch {
    return null;
  }
}
function remember(access: Access) {
  try {
    sessionStorage.setItem("access", JSON.stringify(access));
  } catch {}
}
const readable = (challenge: string | null) => {
  const text = (challenge ?? "").replace(/^SHOW /, "").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function PhotoScreen({ attempt, video, onPhoto, onCount }: { attempt: Attempt; video: RefObject<HTMLVideoElement | null>; onPhoto: (image: string) => void; onCount: (count: number | null) => void }) {
  const [cameraError, setCameraError] = useState(false);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  const openCamera = useCallback(async () => {
    setCameraError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      if (video.current) video.current.srcObject = stream;
      setReady(true);
    } catch {
      setCameraError(true);
    }
  }, [video]);

  useEffect(() => onCount(count), [count, onCount]);

  useEffect(() => {
    void openCamera();
    const node = video.current;
    return () => (node?.srcObject as MediaStream | null)?.getTracks().forEach((track) => track.stop());
  }, [openCamera]);

  // A new challenge after a retry resets the capture.
  useEffect(() => setCount(null), [attempt.challenge]);

  const capture = useCallback(() => {
    const node = video.current;
    if (!node?.videoWidth) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 640 / node.videoWidth);
    canvas.width = node.videoWidth * scale;
    canvas.height = node.videoHeight * scale;
    canvas.getContext("2d")!.drawImage(node, 0, 0, canvas.width, canvas.height);
    onPhoto(canvas.toDataURL("image/jpeg", 0.8));
  }, [onPhoto, video]);

  useEffect(() => {
    if (count === null) return;
    if (count === 0) {
      capture();
      return;
    }
    const timer = setTimeout(() => setCount(count - 1), 1000);
    return () => clearTimeout(timer);
  }, [count, capture]);

  const start = useCallback(() => {
    if (ready && count === null) setCount(COUNTDOWN_SECONDS);
  }, [ready, count]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      start();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [start]);

  return (
    <>
      <p className="quiet" style={{ margin: "0 0 6px" }}>
        {attempt.retrying
          ? `Not quite. Try this one. ${attempt.triesLeft === 1 ? "Last try." : `${attempt.triesLeft} tries left.`}`
          : "Show the camera"}
      </p>
      <Title>{readable(attempt.challenge)}</Title>
      {cameraError ? (
        <p className="say" role="alert">
          {navigator.mediaDevices ? "We couldn't open the camera. Allow it for this page." : "The camera needs a secure (https) link."}
        </p>
      ) : (
        // Hidden, not removed, in 3D: its picture is what gets drawn onto the lock's face.
        <div className={SOLID ? "offscreen" : "frame"}>
          <video ref={video} autoPlay playsInline muted />
          {count !== null && count > 0 && <div className="count"><RollNumber value={count} /></div>}
        </div>
      )}
      <div className="foot">
        {cameraError ? (
          <Button variant="primary" size="lg" className="wide" onClick={() => void openCamera()}>Try the camera again</Button>
        ) : (
          <Button variant="primary" size="lg" className="wide" disabled={!ready || count !== null} onClick={start}>
            {count === null ? "Take photo" : "Hold it"}
          </Button>
        )}
      </div>
    </>
  );
}

function CheckingScreen({ image }: { image: string }) {
  return (
    <>
      <p className="quiet" style={{ margin: "0 0 6px" }}>One moment</p>
      <Title>Checking</Title>
      {!SOLID && (
        <div className="frame">
          <img src={image} alt="The photo you took" />
          <ScanGrid />
          <span className="flash" aria-hidden="true" />
        </div>
      )}
    </>
  );
}

function OpenedScreen({ onDone, onLeft }: { onDone: () => void; onLeft: (left: number) => void }) {
  const [left, setLeft] = useState(OPEN_SECONDS);
  useEffect(() => onLeft(left), [left, onLeft]);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return (
    <>
      <Title delay={0.3}>{left > 0 ? "Open" : "Locked again"}</Title>
      {!SOLID && <Bolt state={left > 0 ? "open" : "locked"} />}
      <p className="say" role="status">
        {left > 0 ? (SOLID ? "It locks again by itself." : <>Locks again in <RollNumber value={left} className="mono" />.</>) : "Thanks. You can close this page."}
      </p>
      <div className="foot"><Button variant="secondary" size="lg" className="wide" onClick={onDone}>Done</Button></div>
    </>
  );
}

function DeniedScreen({ attempt, onRetry }: { attempt: Attempt; onRetry: () => void }) {
  const [text, canRetry] = REASONS[attempt.reason ?? ""] ?? ["Please try again.", true];
  return (
    <>
      <Title delay={0.3}>Still locked</Title>
      {!SOLID && <Bolt state="refused" />}
      <p className="say">{text}</p>
      <div className="foot">
        {canRetry && <Button variant="primary" size="lg" className="wide" onClick={onRetry}>Try again</Button>}
        <p className="mono quiet" style={{ margin: "12px 0 0", fontSize: 12 }}>{attempt.reason}</p>
      </div>
    </>
  );
}

function StartScreen({ access, error, busy, onStart }: { access: Access | null; error: boolean; busy: boolean; onStart: () => void }) {
  return (
    <>
      {error ? <Shout>No connection</Shout> : <Title>Locked</Title>}
      {!SOLID && !error && <Bolt state="locked" />}
      <p className="say">
        {error ? "We couldn't reach the locker." : "Show a quick hand gesture to open it."}
      </p>
      {access && (
        <div className="foot">
          <Button variant="primary" size="lg" className="wide" disabled={busy} onClick={onStart}>
            {busy ? "Starting…" : error ? "Try again" : "Unlock"}
          </Button>
        </div>
      )}
    </>
  );
}

function Kiosk() {
  const video = useRef<HTMLVideoElement | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [openLeft, setOpenLeft] = useState(OPEN_SECONDS);
  const [access, setAccess] = useState<Access | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/attempts/${id}`);
      if (response.status === 404) {
        setAttempt(null);
        return;
      }
      const next = (await response.json()) as Attempt;
      setAttempt(next);
      if (next.state === "DECIDING") setTimeout(() => void refresh(id), 1000);
    } catch {
      setTimeout(() => void refresh(id), 2000);
    }
  }, []);

  const begin = useCallback(async (credentials: Access) => {
    setBusy(true);
    setError(false);
    setPhoto(null);
    try {
      const response = await fetch("/api/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credentials),
      });
      if (!response.ok) throw new Error();
      const next = (await response.json()) as Attempt;
      // Keeps a refresh on this attempt, and takes the secret code out of the address bar.
      history.replaceState(null, "", `/?attempt=${next.id}`);
      setAttempt(next);
    } catch {
      setAttempt(null);
      setError(true);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = new URLSearchParams(location.hash.slice(1)).get("code");
    const grantId = params.get("grant");
    setAccess(remembered());
    if (grantId && code) {
      const link = { grantId, code };
      remember(link);
      setAccess(link);
      void begin(link);
    } else if (params.get("attempt")) {
      void refresh(params.get("attempt")!);
    }
  }, [begin, refresh]);

  const sendPhoto = useCallback(async (image: string) => {
    if (!attempt) return;
    setPhoto(image);
    try {
      const response = await fetch(`/api/attempts/${attempt.id}/photo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image }),
      });
      if (response.ok) setAttempt((await response.json()) as Attempt);
      else await refresh(attempt.id);
    } catch {
      // The result may still have gone through, so ask rather than assume.
      setTimeout(() => void refresh(attempt.id), 2000);
    } finally {
      setPhoto(null);
    }
  }, [attempt, refresh]);

  const done = useCallback(() => {
    history.replaceState(null, "", "/");
    setAttempt(null);
  }, []);

  const view = photo ? "checking" : attempt?.state === "AWAITING_PHOTO" ? "photo" : attempt?.state === "OPENED" ? "opened" : attempt?.state === "DENIED" ? "denied" : "start";

  // /?film shows the film on a device that also has an access link saved.
  const face: LockFace =
    view === "photo"
      ? { mode: "photo", title: readable(attempt?.challenge ?? null), count, video }
      : view === "checking"
        ? { mode: "checking", title: "Checking", photo }
        : view === "opened"
          ? { mode: openLeft > 0 ? "open" : "locked", title: openLeft > 0 ? "OPEN" : "LOCKED", count: openLeft > 0 ? openLeft : null }
          : view === "denied"
            ? { mode: "denied", title: "STILL LOCKED" }
            : { mode: "locked", title: "LOCKED" };
  const landing = view === "start" && !error && (!access || new URLSearchParams(location.search).has("film"));

  return (
    <Page flood={view === "opened" ? "open" : view === "denied" ? "stop" : undefined}>
      {SOLID && !error && (
        <Suspense fallback={<div style={{ height: landing ? "78dvh" : "56dvh" }} />}>
          <Lock3D face={face} height={landing ? "78dvh" : "56dvh"} captions={landing} />
        </Suspense>
      )}
      <main className={landing ? "column film-column" : "column"}>
        {landing && (
          <>
            {!SOLID && <Shout>Proof first. Then the bolt.</Shout>}
            <p className="say">A physical lock that only moves when a live grant and a 0G AI decision both pass.</p>
            <div style={{ height: 40 }} />
            <ProductFilm />
          </>
        )}
        {view === "start" && !landing && <StartScreen access={access} error={error} busy={busy} onStart={() => access && void begin(access)} />}
        {view === "photo" && attempt && <PhotoScreen attempt={attempt} video={video} onCount={setCount} onPhoto={(image) => void sendPhoto(image)} />}
        {view === "checking" && photo && <CheckingScreen image={photo} />}
        {view === "opened" && <OpenedScreen onDone={done} onLeft={setOpenLeft} />}
        {view === "denied" && attempt && <DeniedScreen attempt={attempt} onRetry={() => (access ? void begin(access) : done())} />}
      </main>
    </Page>
  );
}

mount(<Kiosk />);
