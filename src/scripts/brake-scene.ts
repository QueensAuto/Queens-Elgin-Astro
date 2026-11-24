/**
 * Procedural 3D disc-brake assembly for the /brakes hero.
 *
 * Everything is generated in code (no model file to download), modelled on
 * a stock front brake: plain vented rotor · hat · hub + studs · lug nuts ·
 * single-piston floating caliper on its bracket · two pads · dust shield.
 * See src/scripts/brake/ for materials, parts, lighting and effects.
 *
 * Behaviour
 *   - Intro (2.5 s wall-clock): camera starts tight on the rotor and pulls
 *     back while the parts fly in and assemble.
 *   - Scroll: the assembly explodes as the stage rises past mid-screen.
 *   - Drag: rotate. Press & hold: "brake" — pads clamp, rotor slows, glows and sparks.
 *   - Adaptive quality: drops bloom → shadows → textures → pixel ratio on slow devices.
 *   - Honors prefers-reduced-motion (no intro / sway; still interactive).
 *
 * Loaded lazily (dynamic import) so it never blocks first paint.
 */
import * as THREE from "three";
import { createMaterials } from "./brake/materials";
import { buildBrake, loadCaliperGeometry, useCaliperAsset } from "./brake/parts";

/** Detailed cast caliper body (CC0), exported by tools/blender/export-caliper.py. */
const CALIPER_URL = "/models/brake-caliper.bin";
import { setupLighting } from "./brake/lighting";
import { createEffects } from "./brake/effects";
import { QualityGovernor, introProgress, type QualityStep } from "./brake/math";

const IDLE_SPIN = 1.4;

export interface BrakeSceneHandle {
  dispose(): void;
  setExploded(on: boolean): void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

// ------------------------------------------------------------------ mount

export function mountBrakeScene(
  stage: HTMLElement,
  opts: { reducedMotion: boolean; refreshMs?: number },
): BrakeSceneHandle | null {
  const canvas = stage.querySelector("canvas") as HTMLCanvasElement | null;
  if (!canvas) return null;

  // probe quietly first: three logs console errors when it cannot get a context
  const probe = document.createElement("canvas");
  const probeCtx = probe.getContext("webgl2") || probe.getContext("webgl");
  if (!probeCtx) return null; // no WebGL → poster image stays
  probeCtx.getExtension("WEBGL_lose_context")?.loseContext();

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch {
    return null; // no WebGL → poster image stays
  }

  const reduced = opts.reducedMotion;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps the caliper red true
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

  // ------------------------------------------------- materials + parts
  const mats = createMaterials({
    texSize: coarse ? 512 : 1024,
    anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
  });
  const rig = buildBrake(mats);
  const { assembly, spin, hub, nuts, caliper, padIn, padOut, shield, dir, anchors } = rig;
  scene.add(assembly);

  const lighting = setupLighting(renderer, scene, rig, { coarse });
  const { contactShadow } = lighting;
  const shadowMat = contactShadow.material as THREE.MeshBasicMaterial;
  const effects = createEffects(renderer, scene, camera, rig, mats, lighting, { bloom: !coarse, sparks: !reduced });

  const labels = Array.from(stage.querySelectorAll<HTMLElement>("[data-part]"), (marker) => {
    const pill = marker.querySelector<HTMLElement>(".bk-label")!;
    return { marker, pill, anchor: anchors[marker.dataset.part!], width: 0, height: 0 };
  });
  function measureLabels() {
    for (const label of labels) {
      const { width, height } = label.pill.getBoundingClientRect();
      label.width = width;
      label.height = height;
    }
  }
  const labelSizes = new ResizeObserver(measureLabels);
  labels.forEach(({ pill }) => labelSizes.observe(pill));
  measureLabels();

  // ------------------------------------------------------------- state
  let ex = reduced ? 0 : 0.6; // explode amount (animated); intro starts part-exploded
  let exTarget = reduced ? 0 : 1;
  let toggled = false;
  let omega = reduced ? 0.6 : 7; // wheel spin rad/s (idle settles at IDLE_SPIN)
  let heat = 0;
  let clamp = 0; // pad clamp 0..1 (animated)
  let pressing = false;
  let yawBase = reduced ? -0.55 : -0.15; // intro opens nearly face-on to the rotor
  let dragYaw = 0;
  let dragVel = 0;
  let pointerNX = 0;
  let pointerNY = 0;
  // intro: driven by wall-clock time from the first frame (see INTRO_MS)
  let introStart = -1;
  let introCut = reduced; // toggle/scroll during the intro hands control over early
  let introActive = !reduced;
  let camDist = 0; // damped camera distance (0 = not yet initialised)
  let contextLost = false;
  let texturesReady = false; // textures are generated in slices; the poster covers the wait
  let maxEx = 0; // debug: largest explode value seen (must stay ≤ 1)
  let resumed = false; // loop restarted after being paused (hidden tab / off-screen)
  const governor = new QualityGovernor({ budgetMs: 22, sampleFrames: 60, startWithoutBloom: coarse, refreshMs: opts.refreshMs });

  // per-part explode config: z / radial distance + stagger delay
  const E = {
    hub: { z: -1.35, delay: 0.0 },
    rotor: { z: 0, delay: 0.1 },
    padIn: { z: -0.8, r: 0.32, delay: 0.2 },
    padOut: { z: 0.8, r: 0.32, delay: 0.2 },
    caliper: { r: 1.0, delay: 0.32 },
    nuts: { z: 1.7, delay: 0.4 },
  };
  const part = (delay: number) => smooth(clamp01(ex * 1.4 - delay));

  function applyLayout() {
    const eh = part(E.hub.delay);
    hub.position.z = E.hub.z * eh;
    const en = part(E.nuts.delay);
    nuts.position.z = E.nuts.z * en;

    const ei = part(E.padIn.delay);
    const eo = part(E.padOut.delay);
    const clampOffset = clamp * 0.0135;
    padIn.position.set(dir.x * E.padIn.r * ei, dir.y * E.padIn.r * ei, E.padIn.z * ei + clampOffset);
    padOut.position.set(dir.x * E.padOut.r * eo, dir.y * E.padOut.r * eo, E.padOut.z * eo - clampOffset);

    const ec = part(E.caliper.delay);
    caliper.position.set(dir.x * E.caliper.r * ec, dir.y * E.caliper.r * ec, 0);
    shield.position.z = E.hub.z * 0.6 * eh;
  }

  // ------------------------------------------------------------ sizing
  function resize() {
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    effects.resize(w, h, renderer.getPixelRatio());
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  // ------------------------------------------------------------- input
  let dragging = false;
  let lastX = 0;
  const onDown = (e: PointerEvent) => {
    if (e.target instanceof Element && e.target.closest("button")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return; // right/middle click: no brake
    pressing = true;
    dragging = true;
    lastX = e.clientX;
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {}
    stage.classList.add("is-pressing");
  };
  const onMove = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    pointerNX = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointerNY = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (dragging) {
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      dragYaw += dx * 0.008;
      dragVel = dx * 0.008;
    }
  };
  const onUp = () => {
    pressing = false;
    dragging = false;
    stage.classList.remove("is-pressing");
  };
  const onLeave = () => {
    pointerNX = 0;
    pointerNY = 0;
  };
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("lostpointercapture", onUp);
  window.addEventListener("blur", onUp); // Alt/Cmd-Tab mid-press never sends pointerup
  stage.addEventListener("pointerleave", onLeave);

  // ------------------------------------------------------------- loop
  let raf = 0;
  let visible = true;
  let disposed = false;
  let last = performance.now();
  let t = 0;
  const v3 = new THREE.Vector3();

  const desktopMQ = window.matchMedia("(min-width: 1024px)");
  function scrollExplode() {
    const vh = window.innerHeight;
    if (desktopMQ.matches) {
      // Sticky stage: explode as the page scrolls through the hero copy
      return clamp01((window.scrollY - vh * 0.12) / (vh * 0.5));
    }
    // Stacked (mobile): explode once the stage passes mid-screen
    const r = stage.getBoundingClientRect();
    const center = r.top + r.height / 2;
    return clamp01((vh * 0.5 - center) / (vh * 0.3));
  }

  function applyQualityStep(step: QualityStep) {
    if (step === "bloom") effects.setBloom(false);
    else if (step === "shadows") lighting.setShadows(false);
    else if (step === "textures") void mats.downgradeTextures();
    else {
      renderer.setPixelRatio(1);
      resize();
    }
  }

  function frame(now: number) {
    raf = 0;
    if (disposed || !visible || contextLost) return;
    // rAF timestamps can predate the last start() (main thread was busy building
    // textures), so the gap can be negative: never let time run backwards
    const gapMs = Math.max(0, now - last);
    // a long gap (hidden tab, off-screen) → jump straight to the settled state
    const snap = gapMs > 250 || resumed;
    resumed = false;
    const dt = Math.min(0.05, gapMs / 1000);
    last = now;
    t += dt;
    // the first frame compiles every shader; start the intro clock after it
    if (introStart < 0 && stage.dataset.ready === "true") introStart = now;

    // explode target: the intro curve, then toggle button OR scroll position
    const userTarget = Math.max(toggled ? 1 : 0, reduced ? 0 : scrollExplode());
    if (introActive && (introCut || userTarget > 0.05)) introCut = true;
    const introP = introCut ? 1 : introStart < 0 ? 0 : introProgress(now - introStart);
    introActive = introP < 1;
    exTarget = introActive ? 0.6 * Math.pow(1 - introP, 1.4) : userTarget;
    if (snap && !introActive) ex = exTarget;
    else ex += (exTarget - ex) * (1 - Math.exp(-dt * (introActive ? 14 : 3.2)));

    // adaptive quality (after the intro, ignoring long gaps)
    if (!introActive && !snap) {
      const step = governor.sample(gapMs);
      if (step) applyQualityStep(step);
    }

    // braking
    const target = pressing ? 1 : 0;
    clamp += (target - clamp) * (1 - Math.exp(-dt * 14));
    const spinTarget = pressing ? 0 : IDLE_SPIN;
    omega += (spinTarget - omega) * (1 - Math.exp(-dt * (pressing ? 1.6 : 1.1)));
    // friction work heats the band; holding builds from dull red to orange in ~2.5 s
    if (pressing) heat = Math.min(1, heat + dt * (0.22 + 0.06 * Math.min(omega, 4)));
    heat *= Math.exp(-dt * (pressing ? 0.15 : 0.7));
    spin.rotation.z -= omega * dt;


    applyLayout();
    if (ex > maxEx) maxEx = ex;

    // contact shadow spreads and fades as the parts fly apart
    contactShadow.scale.set(1 + ex * 0.6, 0.55 + ex * 0.25, 1);
    shadowMat.opacity = 0.55 * (1 - ex * 0.55);

    // camera + orientation
    dragYaw += dragVel;
    dragVel *= Math.exp(-dt * 4);
    if (!dragging) dragYaw *= Math.exp(-dt * 0.35); // ease back toward home
    const yawHome = -0.55 - 0.5 * ex;
    yawBase += (yawHome - yawBase) * (1 - Math.exp(-dt * 1.6));
    const sway = reduced ? 0 : Math.sin(t * 0.35) * 0.1;
    assembly.rotation.y = yawBase + dragYaw + sway + pointerNX * 0.12;
    assembly.rotation.x = 0.2 + pointerNY * 0.08 + ex * 0.04;

    const narrow = camera.aspect < 1 ? 1 / Math.max(0.6, camera.aspect * 1.05) : 1;
    const homeDist = (6.9 + ex * 3.4) * narrow;
    // intro: start tight on the rotor face, dolly back as the parts assemble
    const distTarget = introActive ? THREE.MathUtils.lerp(3.4 * narrow, homeDist, smooth(introP)) : homeDist;
    if (camDist === 0 || snap) camDist = distTarget;
    else camDist += (distTarget - camDist) * (1 - Math.exp(-dt * (introActive ? 16 : 5)));
    camera.position.set(0.1, 0.15, camDist);
    camera.lookAt(0.05 + ex * 0.25, 0.3 + ex * 0.05, 0);

    // sparks need a pad on the rotor: none in exploded view
    effects.update(dt, { heat, omega, pressing: pressing && ex < 0.2 });
    effects.render();


    // labels
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const inset = 12;
    const gap = 12;
    const labelGap = 4;
    const opacity = introActive ? "0" : String(clamp01((ex - 0.55) / 0.3));
    const placed: { left: number; right: number; top: number; bottom: number }[] = [];
    for (const { marker, pill, anchor, width, height } of labels) {
      anchor.getWorldPosition(v3);
      v3.project(camera);
      const x = THREE.MathUtils.clamp((v3.x * 0.5 + 0.5) * w, inset, w - inset);
      const y = THREE.MathUtils.clamp((-v3.y * 0.5 + 0.5) * h, inset, h - inset);
      const leftSide = x - gap - width;
      const rightSide = x + gap;
      const preferLeft = marker.dataset.part === "rotor" && leftSide >= inset;
      const left = preferLeft || rightSide + width > w - inset ? leftSide : rightSide;
      const pillX = THREE.MathUtils.clamp(left, inset, w - inset - width);
      const centeredY = THREE.MathUtils.clamp(y - height / 2, inset, h - inset - height);
      const pillRight = pillX + width;
      // Keep labels readable when their projected anchors line up.
      const neighbors = placed.filter((box) => pillX < box.right + labelGap && pillRight > box.left - labelGap);
      const rows = [centeredY];
      for (const box of neighbors) rows.push(box.top - height - labelGap, box.bottom + labelGap);
      rows.sort((a, b) => Math.abs(a - centeredY) - Math.abs(b - centeredY));
      const pillY = rows.find((top) => {
        const bottom = top + height;
        return top >= inset && bottom <= h - inset &&
          neighbors.every((box) => bottom <= box.top - labelGap || top >= box.bottom + labelGap);
      }) ?? centeredY;
      placed.push({ left: pillX, right: pillRight, top: pillY, bottom: pillY + height });
      marker.style.transform = `translate(${x}px, ${y}px)`;
      marker.style.opacity = opacity;
      pill.style.transform = `translate(${pillX - x}px, ${pillY - y}px)`;
    }

    if (stage.dataset.ready !== "true") stage.dataset.ready = "true";
    raf = requestAnimationFrame(frame);
  }

  const start = () => {
    if (!raf && !disposed && !contextLost && texturesReady) {
      resumed = stage.dataset.ready === "true";
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  const io = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting;
      if (visible) start();
    },
    { rootMargin: "100px" },
  );
  io.observe(stage);
  const onVis = () => {
    if (document.hidden) {
      visible = false;
      onUp();
    } else {
      visible = true;
      start();
    }
  };
  document.addEventListener("visibilitychange", onVis);
  // mobile GPUs drop contexts: stop drawing and let the poster image come back
  const onContextLost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
    cancelAnimationFrame(raf);
    raf = 0;
    stage.dataset.ready = "false";
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  // The detailed caliper body downloads alongside the texture build. If it fails or
  // is slow, the procedural body stays (never swapped in mid-show).
  let caliperSource: "procedural" | "asset" = "procedural";
  const caliperReady = Promise.race([
    loadCaliperGeometry(CALIPER_URL),
    new Promise<null>((r) => setTimeout(() => r(null), 4000)),
  ]).then((geo) => {
    if (!geo || disposed) return;
    useCaliperAsset(rig, geo, mats);
    caliperSource = "asset";
  });
  Promise.all([mats.ready, caliperReady])
    .then(() => (disposed ? undefined : effects.warmUp()))
    .catch(() => {}) // a failed warm-up only means a hitch later
    .then(() => {
      texturesReady = true;
      start();
    });

  if (location.search.includes("brakeDebug")) {
    (stage as any).__brake = {
      get state() {
        return {
          heat,
          ex,
          maxEx,
          introDone: !introActive && Math.abs(ex - exTarget) < 0.02,
          qualityLevel: governor.level,
          caliper: caliperSource,
          msaaSamples: effects.msaaSamples,
          info: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
        };
      },
      tune: { scene, renderer, mats, lighting, THREE },
      dispose: () => handle.dispose(),
      loseContext: () => renderer.getContext().getExtension("WEBGL_lose_context")?.loseContext(),
    };
  }

  const handle: BrakeSceneHandle = {
    setExploded(on: boolean) {
      toggled = on;
      if (introActive) introCut = true;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      labelSizes.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("lostpointercapture", onUp);
      window.removeEventListener("blur", onUp);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      stage.removeEventListener("pointerleave", onLeave);
      scene.traverse((o: any) => {
        o.geometry?.dispose?.();
        const m = o.material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x: any) => x.dispose?.());
      });
      mats.dispose();
      effects.dispose();
      lighting.dispose();
      renderer.dispose();
    },
  };
  return handle;
}
