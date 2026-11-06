// A 3D padlock shot like a phone commercial: dark studio, moving strip lights, and a camera that
// glides past the details in close-up before pulling back. The interface is lit onto its face, and
// the shackle opens only when the gateway reports the door really opened.
import { useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FlipWord } from "./motion";
import { makeRenderer, followPointer, useLatest } from "./scene3d";

export interface LockFace {
  mode: "locked" | "photo" | "checking" | "open" | "denied";
  title: string;
  count?: number | null;
  video?: RefObject<HTMLVideoElement | null>;
  photo?: string | null;
}

const FACE_W = 1024;
const FACE_H = 768;
const INK = "#0c0c0c";
const PAPER = "#f4f2ec";
const SIGNAL = "#ffd400";
const OPEN = "#17e088";
const STOP = "#ff4a2b";
const DISPLAY = '"Archivo Variable", system-ui, sans-serif';

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number) {
  let size = start;
  do {
    ctx.font = `800 ${size}px ${DISPLAY}`;
    size -= 4;
  } while (ctx.measureText(text).width > maxWidth && size > 28);
}

function cover(ctx: CanvasRenderingContext2D, source: CanvasImageSource, w: number, h: number) {
  const scale = Math.max(FACE_W / w, FACE_H / h);
  ctx.save();
  ctx.translate(FACE_W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, (FACE_W - w * scale) / 2, (FACE_H - h * scale) / 2, w * scale, h * scale);
  ctx.restore();
}

/** Draws one frame of the interface onto the lock's face. */
function drawFace(ctx: CanvasRenderingContext2D, face: LockFace, photo: HTMLImageElement | null, time: number) {
  const video = face.video?.current;
  const flood = face.mode === "open" ? OPEN : face.mode === "denied" ? STOP : INK;
  ctx.fillStyle = flood;
  ctx.fillRect(0, 0, FACE_W, FACE_H);
  ctx.textBaseline = "alphabetic";
  try {
    ctx.fontStretch = "expanded";
  } catch {}

  if (face.mode === "photo" && video?.videoWidth) cover(ctx, video, video.videoWidth, video.videoHeight);
  if (face.mode === "checking" && photo?.complete && photo.naturalWidth) cover(ctx, photo, photo.naturalWidth, photo.naturalHeight);

  if (face.mode === "checking") {
    // Yellow cells sweep the photo while the AI decides.
    const cell = FACE_W / 12;
    ctx.fillStyle = SIGNAL;
    for (let row = 0; row < 9; row++) {
      for (let column = 0; column < 12; column++) {
        const wave = (time * 1.1 - (row + column) * 0.07) % 1;
        const glow = wave > 0 && wave < 0.22 ? 1 - wave / 0.22 : 0;
        if (glow > 0) {
          ctx.globalAlpha = glow * 0.75;
          ctx.fillRect(column * cell, row * cell, cell - 2, cell - 2);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  const ink = face.mode === "open" || face.mode === "denied" ? INK : PAPER;
  if (face.mode === "photo" || face.mode === "checking") {
    // The instruction sits on a solid band, so a busy camera picture can't hide it.
    ctx.fillStyle = INK;
    ctx.fillRect(0, FACE_H - 190, FACE_W, 190);
    ctx.fillStyle = face.mode === "photo" ? SIGNAL : PAPER;
    fitText(ctx, face.title, FACE_W - 96, 120);
    ctx.fillText(face.title, 48, FACE_H - 62);
  } else {
    ctx.fillStyle = ink;
    fitText(ctx, face.title, FACE_W - 112, 210);
    ctx.fillText(face.title, 56, 440);
  }

  if (face.count) {
    if (face.mode === "photo") {
      ctx.font = `800 380px ${DISPLAY}`;
      ctx.fillStyle = SIGNAL;
      ctx.textAlign = "center";
      ctx.fillText(String(face.count), FACE_W / 2, 400);
      ctx.textAlign = "left";
    } else {
      ctx.fillStyle = INK;
      ctx.font = `800 110px ${DISPLAY}`;
      ctx.fillText(String(face.count), 56, FACE_H - 70);
    }
  }

  // Faint scan lines, so it reads as light on metal and not a sticker.
  ctx.fillStyle = "rgba(0,0,0,0.13)";
  for (let y = 0; y < FACE_H; y += 6) ctx.fillRect(0, y, FACE_W, 2);
}

type Vec = readonly [number, number, number];
interface Shot { from: Vec; to: Vec; lookFrom: Vec; lookTo: Vec; fov: number; seconds: number; caption: string }

// The commercial: slow moves past each detail, cut together, ending on a wide reveal.
const SHOTS: Shot[] = [
  { from: [-2.1, 2.5, 2.1], to: [0.9, 2.9, 2.3], lookFrom: [-0.5, 2.2, 0], lookTo: [0.3, 2.3, 0], fov: 22, seconds: 4.2, caption: "It only moves on proof" },
  { from: [3.9, -0.9, 1.7], to: [3.3, 0.8, 2.4], lookFrom: [1.3, -0.2, 0.4], lookTo: [1.2, 0.3, 0.4], fov: 20, seconds: 3.8, caption: "No AI on the board" },
  { from: [1.2, -3.3, 2.4], to: [-1.2, -3.1, 2.7], lookFrom: [0.1, -1, 0.1], lookTo: [-0.1, -1, 0.1], fov: 20, seconds: 3.8, caption: "A live grant on Arkiv" },
  { from: [3, 2.2, -1.9], to: [3.6, 1.7, 0.9], lookFrom: [0.8, 1.1, 0], lookTo: [0.8, 1, 0.1], fov: 21, seconds: 3.8, caption: "A decision from 0G" },
  { from: [-3.4, 1.1, 8.6], to: [2.8, 0.7, 9.6], lookFrom: [0, 0.5, 0], lookTo: [0, 0.5, 0], fov: 26, seconds: 6.5, caption: "proofbolt" },
];
const CUT_FADE_SECONDS = 0.32;
const OPEN_MACRO_SECONDS = 1.5;

const ease = (t: number) => t * t * (3 - 2 * t);
const point = (a: Vec, b: Vec, t: number) => new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

function shacklePoints(): THREE.Vector3[] {
  const halfGap = 0.74;
  const crown = 1.82;
  const points = [new THREE.Vector3(-halfGap, 0.98, 0), new THREE.Vector3(-halfGap, crown, 0)];
  for (let step = 1; step < 16; step++) {
    const angle = Math.PI - (step / 16) * Math.PI;
    points.push(new THREE.Vector3(Math.cos(angle) * halfGap, crown + Math.sin(angle) * halfGap, 0));
  }
  points.push(new THREE.Vector3(halfGap, crown, 0), new THREE.Vector3(halfGap, 0.2, 0));
  return points;
}

/** A dark room with long softboxes. Their reflections are the streaks of light on the metal. */
function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const room = new THREE.Scene();
  room.background = new THREE.Color(0x030303);
  const strip = (color: number, power: number, width: number, height: number, position: Vec, rotation: Vec) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    room.add(mesh);
  };
  strip(0xffffff, 14, 14, 1.1, [0, 9, 2], [Math.PI / 2, 0, 0]);
  strip(0xffffff, 10, 1, 16, [-9, 0, 3], [0, Math.PI / 2, 0]);
  strip(0xffe9a8, 9, 0.8, 16, [9, 1, 4], [0, -Math.PI / 2, 0]);
  strip(0xffffff, 5, 12, 0.5, [0, -8, 4], [-Math.PI / 2, 0, 0]);
  strip(0xc9d8ff, 4, 0.5, 12, [3, 0, 10], [0, Math.PI, 0]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.012).texture;
  pmrem.dispose();
  return texture;
}

/** Fine horizontal grain, like brushed metal. */
function brushedTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 512, 512);
  for (let line = 0; line < 2600; line++) {
    const shade = 90 + Math.floor(Math.random() * 90);
    ctx.fillStyle = `rgba(${shade},${shade},${shade},0.35)`;
    ctx.fillRect(Math.random() * 512 - 120, Math.random() * 512, 90 + Math.random() * 300, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function engraving(lines: string[]) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(235,235,225,0.72)";
  lines.forEach((line, index) => {
    ctx.font = index === 0 ? `800 62px ${DISPLAY}` : "26px monospace";
    ctx.fillText(line, 10, index === 0 ? 70 : 90 + index * 38);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function Lock3D({ face, height, captions = false }: { face: LockFace; height: string; captions?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useLatest(face);
  const [caption, setCaption] = useState(SHOTS[0]!.caption);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const { renderer, resize, dispose: disposeRenderer } = makeRenderer(node);
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
    const environment = studioEnvironment(renderer);
    scene.environment = environment;
    scene.environmentIntensity = 1.5;

    const grain = brushedTexture();
    grain.repeat.set(1.4, 1.4);
    const metal = new THREE.MeshPhysicalMaterial({ color: 0x4a4b52, metalness: 1, roughness: 0.4, roughnessMap: grain, bumpMap: grain, bumpScale: 0.25, clearcoat: 0.35, clearcoatRoughness: 0.35 });
    const steel = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f0, metalness: 1, roughness: 0.09 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0.6, roughness: 0.5 });

    const lock = new THREE.Group();
    scene.add(lock);
    const body = new THREE.Mesh(new RoundedBoxGeometry(2.72, 2.16, 0.98, 10, 0.2), metal);
    lock.add(body);

    // Face: the interface, then a sheet of glass that catches the moving lights, like a phone screen.
    const canvas = document.createElement("canvas");
    canvas.width = FACE_W;
    canvas.height = FACE_H;
    const ctx = canvas.getContext("2d")!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(2.46, 1.9, 0.04, 4, 0.02), dark);
    bezel.position.z = 0.487;
    body.add(bezel);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.38, 1.785), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    screen.position.z = 0.509;
    body.add(screen);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.46, 1.9), new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.1, envMapIntensity: 2.4 }));
    glass.position.z = 0.514;
    body.add(glass);

    // Details for the close-ups: collars, keyway, screws and an engraving, all as on a real padlock.
    [-0.74, 0.74].forEach((x) => {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.27, 0.1, 40), steel);
      collar.position.set(x, 1.09, 0);
      lock.add(collar);
    });
    const keyRing = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 40), steel);
    keyRing.position.y = -1.085;
    lock.add(keyRing);
    const keyHole = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 32), dark);
    keyHole.position.y = -1.092;
    lock.add(keyHole);
    const keySlot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.07, 0.05), dark);
    keySlot.position.y = -1.11;
    keySlot.rotation.y = 0.7;
    lock.add(keySlot);
    const screwGeometry = new THREE.CylinderGeometry(0.075, 0.075, 0.03, 24);
    [-0.72, 0.72].forEach((y) => [-1, 1].forEach((side) => {
      const screw = new THREE.Mesh(screwGeometry, steel);
      screw.rotation.z = Math.PI / 2;
      screw.position.set(side * 1.365, y, 0);
      lock.add(screw);
    }));
    const markTexture = engraving(["proofbolt", "LOCKER-1", "ESP8266 / SIGNED COMMANDS ONLY"]);
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), new THREE.MeshBasicMaterial({ map: markTexture, transparent: true, toneMapped: false }));
    mark.position.set(1.366, -0.1, 0);
    mark.rotation.y = Math.PI / 2;
    lock.add(mark);

    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(shacklePoints(), false, "centripetal"), 180, 0.165, 28);
    tube.translate(-0.74, 0, 0); // The shackle turns on its right leg, so that leg sits on the pivot.
    const shackle = new THREE.Mesh(tube, steel);
    const pivot = new THREE.Group();
    pivot.position.x = 0.74;
    pivot.add(shackle);
    lock.add(pivot);

    const pointer = followPointer(node);
    const photoImage = new Image();
    let photoSrc: string | null = null;
    let lift = 0, liftSpeed = 0, turn = 0, turnSpeed = 0, shake = 0;
    let lastMode = "", lastKey = "", raf = 0;
    let shotIndex = 0, shotTime = 0, modeTime = 0, fade = 1, settled = false;
    const eye = new THREE.Vector3(0, 0.5, 11);
    const look = new THREE.Vector3(0, 0.5, 0);
    const wantEye = new THREE.Vector3();
    const wantLook = new THREE.Vector3();
    const clock = new THREE.Clock();
    void document.fonts?.load?.(`800 100px ${DISPLAY}`).then(() => { lastKey = ""; });

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 1 / 20);
      const time = clock.elapsedTime;
      const current = latest.current;

      if (current.photo && current.photo !== photoSrc) {
        photoSrc = current.photo;
        photoImage.src = photoSrc;
      }
      if (current.mode !== lastMode) {
        if (current.mode === "denied") shake = 1;
        lastMode = current.mode;
        modeTime = 0;
        settled = false;
      }
      modeTime += dt;

      const key = `${current.mode}|${current.title}|${current.count}`;
      if (key !== lastKey || current.mode === "photo" || current.mode === "checking") {
        drawFace(ctx, current, photoImage, time);
        texture.needsUpdate = true;
        lastKey = key;
      }

      // Shackle springs: it lifts out, swings aside, and drops back with a small bounce.
      const open = current.mode === "open";
      const targetLift = open ? 0.62 : 0;
      liftSpeed += ((targetLift - lift) * 70 - liftSpeed * 8) * dt;
      lift += liftSpeed * dt;
      const targetTurn = open && lift > 0.42 ? -2.1 : 0;
      turnSpeed += ((targetTurn - turn) * 30 - turnSpeed * 6.5) * dt;
      turn += turnSpeed * dt;
      if (!open && turn > -0.05 && lift < 0) { lift = 0; liftSpeed = Math.abs(liftSpeed) * 0.3; }
      if (reduce) { lift = targetLift; turn = targetTurn; }
      const rattle = reduce ? 0 : shake * Math.sin(time * 42);
      shake = Math.max(0, shake - dt * 1.7);
      pivot.position.y = lift + Math.max(0, rattle) * 0.09;
      pivot.rotation.y = turn;
      lock.rotation.z = rattle * 0.03;

      resize(camera, 10);
      const narrow = Math.max(1, 1.5 / camera.aspect);
      let fov = 26, follow = 3.2;

      if (reduce) {
        wantEye.set(1.6, 0.8, 11 * narrow);
        wantLook.set(0, 0.5, 0);
        follow = 100;
      } else if (current.mode === "locked") {
        // The film: each shot is one slow move, with a quick fade over the cut.
        const shot = SHOTS[shotIndex]!;
        shotTime += dt;
        if (shotTime >= shot.seconds) {
          shotTime = 0;
          shotIndex = (shotIndex + 1) % SHOTS.length;
          fade = 0;
          settled = false;
          setCaption(SHOTS[shotIndex]!.caption);
        }
        const active = SHOTS[shotIndex]!;
        const progress = ease(shotTime / active.seconds);
        const position = point(active.from, active.to, progress);
        wantEye.copy(position).multiplyScalar(narrow > 1 && shotIndex === SHOTS.length - 1 ? narrow : 1);
        wantLook.copy(point(active.lookFrom, active.lookTo, progress));
        fov = active.fov;
        // Coming from a screen, glide in. After that, each cut starts exactly on its first frame.
        follow = settled || fade < 1 ? 100 : 2.4;
        if (modeTime > 1.6) settled = true;
      } else if (current.mode === "photo" || current.mode === "checking") {
        // Straight on and close, with the face filling the frame so the person can use it.
        fov = 26;
        const fit = (Math.max(2.9 / camera.aspect, 2.5) / 2) / Math.tan((fov * Math.PI) / 360);
        const drift = current.mode === "checking" ? 0.18 : Math.sin(time * 0.5) * 0.08;
        wantEye.set(drift, 0.05, fit + 0.5);
        wantLook.set(0, 0.02, 0);
        follow = 3;
      } else if (open) {
        // A close look at the shackle as it lifts, then a low sweep back to show the open lock.
        if (modeTime < OPEN_MACRO_SECONDS) {
          wantEye.set(1.5, 2.1, 3.9 * narrow);
          wantLook.set(0.3, 1.5, 0);
          fov = 24;
          follow = 4;
        } else {
          const sweep = ease(Math.min(1, (modeTime - OPEN_MACRO_SECONDS) / 3.5));
          wantEye.set(-3.2 + sweep * 4.6, -0.5 + sweep * 0.9, 8.6 * narrow);
          wantLook.set(0, 0.9, 0);
          fov = 27;
          follow = 1.8;
        }
      } else {
        // Refused: in close on the jammed shackle, then back to face the message.
        if (modeTime < 0.9) {
          wantEye.set(-1, 1.7, 4.1 * narrow);
          wantLook.set(0, 1.1, 0);
          fov = 24;
          follow = 7;
        } else {
          wantEye.set(0.5, 0.3, 8.8 * narrow);
          wantLook.set(0, 0.35, 0);
          fov = 26;
          follow = 2;
        }
      }

      const blend = 1 - Math.exp(-dt * follow);
      eye.lerp(wantEye, blend);
      look.lerp(wantLook, blend);
      camera.fov += (fov - camera.fov) * blend;
      camera.updateProjectionMatrix();
      if (!reduce) {
        camera.position.set(eye.x + pointer.x * 0.18, eye.y - pointer.y * 0.12, eye.z);
      } else camera.position.copy(eye);
      camera.lookAt(look);

      // The room's lights turn slowly, so highlights travel along the metal even when nothing else moves.
      if (!reduce) scene.environmentRotation.y = time * 0.22;

      fade = Math.min(1, fade + dt / CUT_FADE_SECONDS);
      renderer.domElement.style.opacity = String(ease(fade));
      renderer.render(scene, camera);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      pointer.dispose();
      [texture, grain, markTexture, environment].forEach((item) => item.dispose());
      scene.traverse((item) => { if (item instanceof THREE.Mesh) item.geometry.dispose(); });
      [metal, steel, dark].forEach((item) => item.dispose());
      disposeRenderer();
    };
  }, [latest]);

  return (
    <div ref={host} className="cine" style={{ height }} aria-hidden="true">
      {captions && <p className="cine-caption"><FlipWord text={caption} /></p>}
    </div>
  );
}
