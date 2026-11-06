// A 3D key for the owner's page. Each access link cuts its own key: the teeth come from the grant's
// ID, so a new link visibly makes a new key.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { addStudio, makeRenderer, followPointer, useLatest } from "./scene3d";

const TEETH = 7;
const DEFAULT_SEED = "proofbolt";

function teethFrom(seed: string): number[] {
  let hash = 2166136261;
  return Array.from({ length: TEETH }, (_, tooth) => {
    for (let index = 0; index < seed.length; index++) hash = Math.imul(hash ^ seed.charCodeAt(index) ^ tooth, 16777619);
    return 0.12 + (((hash >>> 8) % 100) / 100) * 0.34;
  });
}

function keyShape(seed: string) {
  const shape = new THREE.Shape();
  const teeth = teethFrom(seed);
  const top = 0.17, step = 0.32, start = 0.5;
  shape.absarc(-1.45, 0, 0.82, 0.24, Math.PI * 2 - 0.24, false);
  shape.lineTo(start, -top);
  teeth.forEach((depth, tooth) => {
    const x = start + tooth * step;
    shape.lineTo(x + 0.03, -top - depth);
    shape.lineTo(x + step - 0.07, -top - depth);
    shape.lineTo(x + step, -top);
  });
  shape.lineTo(start + TEETH * step + 0.22, 0);
  shape.lineTo(start + TEETH * step, top);
  shape.lineTo(-0.66, top);
  const hole = new THREE.Path();
  hole.absarc(-1.45, 0, 0.38, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

function keyGeometry(seed: string) {
  const geometry = new THREE.ExtrudeGeometry(keyShape(seed), { depth: 0.2, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 4, curveSegments: 48 });
  geometry.center();
  return geometry;
}

export default function Key3D({ seed, busy, height }: { seed?: string; busy: boolean; height: string }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useLatest({ seed: seed ?? DEFAULT_SEED, busy });

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const { renderer, resize, dispose: disposeRenderer } = makeRenderer(node);
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    const lights = addStudio(scene, renderer);

    const brass = new THREE.MeshPhysicalMaterial({ color: 0xffc800, metalness: 1, roughness: 0.22, clearcoat: 0.5, clearcoatRoughness: 0.2 });
    let cut = latest.current.seed;
    const key = new THREE.Mesh(keyGeometry(cut), brass);
    scene.add(key);

    const pointer = followPointer(node);
    const clock = new THREE.Clock();
    let spin = 0, spinSpeed = 0.5, burst = 0, raf = 0;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 1 / 20);
      const time = clock.elapsedTime;
      const { seed: wanted, busy: writing } = latest.current;

      if (wanted !== cut) {
        // A new grant: swap to its teeth, with a full turn and a small pop to show the change.
        cut = wanted;
        key.geometry.dispose();
        key.geometry = keyGeometry(cut);
        burst = 1;
        spinSpeed = 11;
      }
      const cruising = writing ? 8 : 0.5;
      spinSpeed += (cruising - spinSpeed) * Math.min(1, dt * 2.4);
      burst = Math.max(0, burst - dt * 1.8);
      if (!reduce) spin += spinSpeed * dt;

      key.rotation.y = reduce ? -0.45 : spin;
      key.rotation.z = reduce ? 0.32 : 0.32 + pointer.x * 0.16;
      key.rotation.x = reduce ? 0 : -0.1 + pointer.y * 0.2;
      key.position.y = reduce ? 0 : Math.sin(time * 0.9) * 0.06;
      key.scale.setScalar(0.92 + Math.sin(burst * Math.PI) * 0.16);

      lights.forEach((light, index) => {
        const phase = time * 0.5 + index * 2.1;
        light.position.set(Math.cos(phase) * 5, Math.sin(phase) * 3, 3.5);
      });

      resize(camera, 8.2);
      renderer.render(scene, camera);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      pointer.dispose();
      key.geometry.dispose();
      brass.dispose();
      disposeRenderer();
    };
  }, [latest]);

  return <div ref={host} style={{ height, width: "100%", position: "relative" }} aria-hidden="true" />;
}
