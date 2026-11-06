// What the 3D lock and key share: a transparent renderer, studio lighting and pointer tracking.
import { useRef, type RefObject } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export const hasWebGL = () => !!document.createElement("canvas").getContext("webgl2");

export function makeRenderer(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  host.appendChild(renderer.domElement);

  let width = 0, height = 0;
  /** Fits the camera to the box, backing away on narrow screens so the model isn't cropped. */
  const resize = (camera: THREE.PerspectiveCamera, distance: number) => {
    const w = host.clientWidth, h = host.clientHeight;
    if (w === width && h === height) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.position.z = distance * Math.max(1, 1.05 / camera.aspect);
    camera.updateProjectionMatrix();
  };
  const dispose = () => {
    renderer.dispose();
    renderer.domElement.remove();
  };
  return { renderer, resize, dispose };
}

/** Soft reflections, plus coloured lights in the interface's yellow, red and green. */
export function addStudio(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();
  const lights = [0xffd400, 0xff4a2b, 0x17e088].map((color) => {
    const light = new THREE.PointLight(color, 42, 16);
    scene.add(light);
    return light;
  });
  return lights;
}

/** Smoothed pointer position, -1 to 1 across the window. */
export function followPointer(host: HTMLElement) {
  const state = { x: 0, y: 0, dispose: () => {} };
  let targetX = 0, targetY = 0, raf = 0;
  const onMove = (event: PointerEvent) => {
    targetX = (event.clientX / innerWidth) * 2 - 1;
    targetY = (event.clientY / innerHeight) * 2 - 1;
  };
  const tick = () => {
    raf = requestAnimationFrame(tick);
    state.x += (targetX - state.x) * 0.07;
    state.y += (targetY - state.y) * 0.07;
  };
  tick();
  window.addEventListener("pointermove", onMove, { passive: true });
  state.dispose = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", onMove);
  };
  void host;
  return state;
}
