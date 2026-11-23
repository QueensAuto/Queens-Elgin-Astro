# Brake 3D Realism Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/brakes` hero's procedural Three.js brake so it reads as real stock hardware with immersive lighting, a cinematic intro and a physical heat effect — without moving the copy or slowing the page.

**Architecture:** Split the 653-line `src/scripts/brake-scene.ts` into focused modules under `src/scripts/brake/` (pure math, materials + runtime textures, geometry, lighting, effects). `brake-scene.ts` stays the entry point and keeps its public API, state, input, loop and label code. Pure logic is unit-tested with `node --test`; visuals are verified with a Playwright script against the running dev server.

**Tech Stack:** Astro 7, TypeScript, `three@0.187` + `three/addons/*` only, Node 24 (`node --test`, native TS type stripping), Playwright (global `@playwright/cli` install) for browser checks.

**Spec:** `docs/superpowers/specs/2026-11-23-brake-3d-realism-design.md` — read it first; this plan argues from it.

## Global Constraints

- No new npm dependencies. Only `three` and `three/addons/*`.
- Public API unchanged: `mountBrakeScene(stage: HTMLElement, opts: { reducedMotion: boolean }): BrakeSceneHandle | null`, `BrakeSceneHandle = { dispose(): void; setExploded(on: boolean): void }`. Label anchor keys: `rotor | pads | caliper | hub`.
- Gzipped `brake-scene` chunk: baseline **146,381 bytes**; must stay ≤ **207,821 bytes** (+60 kB).
- Downloaded assets added: ≤ 1 MB, requested only after mount. Default is zero (runtime textures, procedural environment).
- Frame rate: 60 fps desktop; ≥ 45 fps mid-range phone. Pixel-ratio caps unchanged: 1.5 coarse pointer, 2 fine.
- Textures 512² on coarse pointer, 1024² otherwise. Shadow map 1024 desktop / 512 coarse pointer.
- Intro completes within **2.5 s wall-clock** after mount on every device.
- Adaptive quality: average frame time over **60** frames; step down when > **22 ms**, in order bloom → shadows → textures → pixelRatio. Coarse pointer starts without bloom.
- Hardware: plain vented one-piece rotor (no drilled holes, no slots); single-piston floating caliper with bracket; caliper deep satin red, less saturated than `#d1121f`, keeps the "QUEENS" mark as painted/relief look.
- Stage size, page layout and copy unchanged. Poster `<img class="bk-poster">` remains the LCP element and the no-WebGL fallback.
- Canvas `aria-label` must not say "cross-drilled". Visible label stays "Vented rotor".
- `prefers-reduced-motion`: no intro fly-in, no sway, no sparks; still interactive.
- Git: do NOT commit, stash, reset or checkout. The tree has unrelated uncommitted work. "Checkpoint" steps mean: build passes, note the state in your report.

## Review Focus

1. **Pointer released off-stage / `pointercancel` mid-brake** — heat must cool and bloom/glow fade; nothing stays stuck hot. Test in Task 7.
2. **Tab hidden during the intro** — on return the intro is finished (wall-clock), not replayed or frozen half-exploded. Test in Task 7.
3. **WebGL context lost** (mobile GPUs drop contexts) — poster image comes back, no console errors, loop stops. Test in Task 7.
4. **Resize / orientation change** — composer, bloom and shadow render targets resize; labels stay inside the stage. Test in Task 7.
5. **Exploded toggle or scroll during the intro** — no jump; the explode target takes over smoothly. Test in Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/scripts/brake/math.ts` (create) | Pure helpers: `introProgress`, `heatRamp`, `QualityGovernor`. No `three`, no DOM. |
| `src/scripts/brake/math.test.ts` (create) | `node --test` unit tests for `math.ts`. |
| `src/scripts/brake/materials.ts` (create) | Runtime canvas textures + all PBR materials; heat-capable materials; dispose; texture downgrade. |
| `src/scripts/brake/parts.ts` (create) | Geometry for rotor, caliper + bracket, pads, hub/studs/nuts, dust shield. Returns a `BrakeRig`. |
| `src/scripts/brake/lighting.ts` (create) | Procedural workshop environment (PMREM), key/rim/heat lights, shadows, contact shadow. |
| `src/scripts/brake/effects.ts` (create) | Heat glow progression, bloom (`EffectComposer` + `UnrealBloomPass`) or glow-sprite fallback, sparks. Owns `render()`. |
| `src/scripts/brake-scene.ts` (modify) | Entry point: mount, state, input, loop, intro camera, labels, adaptive quality wiring, debug hook, dispose. |
| `src/pages/brakes.astro:198-221` (modify) | Canvas `aria-label` only. |
| `.claude/audit/brake-3d/verify.cjs` (create) | Playwright verification script (not shipped). |

---

### Task 1: Verification harness + baseline

**Files:**
- Create: `.claude/audit/brake-3d/verify.cjs`
- Modify: `src/scripts/brake-scene.ts` (debug hook only)

**Interfaces:**
- Produces: debug hook. When the page URL contains `?brakeDebug`, `mountBrakeScene` sets `(stage as any).__brake = { get state(): { heat: number; ex: number; introDone: boolean; qualityLevel: number; info: { geometries: number; textures: number } }, dispose(): void, loseContext(): void }`. `loseContext` calls `renderer.getContext().getExtension("WEBGL_lose_context")?.loseContext()`. `qualityLevel` is 0 until Task 7 wires the governor.
- Produces: `node .claude/audit/brake-3d/verify.cjs <label>` writes `.claude/audit/brake-3d/<label>/results.json` and screenshots; exits non-zero on any failed check.

- [ ] **Step 1: Add the debug hook to `brake-scene.ts`** (no behaviour change without `?brakeDebug`).

- [ ] **Step 2: Write `verify.cjs`.** Playwright from `C:/Users/Izzy/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright`, launch with `executablePath` = the `chromium-1248` (headed, GPU) or `chromium_headless_shell-1248` (headless) binary under `%LOCALAPPDATA%/ms-playwright` — `npx playwright install` is NOT available offline, use what's installed. Base URL `http://127.0.0.1:4321/brakes?brakeDebug`. For each viewport `1440×900` and `390×844` (390: `hasTouch`, `isMobile`):
  - Record console errors and `pageerror`s → check: count === 0 (ignore the Meta Pixel traffic-permission warning).
  - Record `getBoundingClientRect().top` of the first visible `a[href="#book"].lp-btn` in the hero → stored for comparison.
  - Wait for `#brake-stage[data-ready="true"]`; then poll `__brake.state.introDone`; record ms from ready to done.
  - Screenshots of `#brake-stage`: `assembled.png` (after intro), `exploded.png` (click `#brake-explode`, wait 1.5 s, click again), `hot.png` (mouse down at stage center, hold 2.5 s, screenshot while held).
  - FPS: count `requestAnimationFrame` callbacks over 3 s via `page.evaluate`.
  - `heatAfterRelease`: release, wait 4 s, read `__brake.state.heat`.
  - Write all numbers to `results.json`. Checks with thresholds are added by later tasks; the baseline run only records.

- [ ] **Step 3: Run baseline.**
  Run: `node .claude/audit/brake-3d/verify.cjs before`
  Expected: `.claude/audit/brake-3d/before/results.json` + 6 screenshots; console errors 0.

- [ ] **Step 4: Checkpoint.** `npm run build` passes.

---

### Task 2: Pure math — intro timing, heat ramp, quality governor

**Files:**
- Create: `src/scripts/brake/math.ts`, `src/scripts/brake/math.test.ts`

**Interfaces:**
- Produces:
  - `export const INTRO_MS = 2500;`
  - `export function introProgress(elapsedMs: number): number` — 0..1, eased (smoothstep), reaches exactly 1 at `elapsedMs >= INTRO_MS`.
  - `export function heatRamp(heat: number): { r: number; g: number; b: number; intensity: number }` — linear-RGB emissive colour + intensity for heat 0..1. 0 → intensity 0. ~0.35 → dull red (r dominant, g < 0.15·r). 1 → orange (g ≈ 0.35–0.5·r), max intensity. Monotonic intensity.
  - `export type QualityStep = "bloom" | "shadows" | "textures" | "pixelRatio";`
  - `export class QualityGovernor { constructor(opts: { budgetMs: number; sampleFrames: number; startWithoutBloom: boolean }); sample(frameMs: number): QualityStep | null; get level(): number; }` — fills a window of `sampleFrames`; when full, if mean > `budgetMs` returns the next step and clears the window, else clears and returns null. Order `bloom, shadows, textures, pixelRatio`; skips `bloom` when `startWithoutBloom`; returns null forever after the last step. `level` = steps taken.

- [ ] **Step 1: Write failing tests** in `math.test.ts` (`import { test } from "node:test"; import assert from "node:assert/strict"; import { ... } from "./math.ts";`):
  - `introProgress(0) === 0`, `introProgress(2500) === 1`, `introProgress(99999) === 1`, `introProgress(1250)` strictly between 0.3 and 0.7, monotonic over 0..2500 step 50.
  - `heatRamp(0).intensity === 0`; `heatRamp(0.35)`: `g < 0.15 * r`; `heatRamp(1)`: `g / r` in [0.35, 0.5]; intensity monotonic over 0..1 step 0.05.
  - Governor `{budgetMs:22, sampleFrames:60, startWithoutBloom:false}`: 59 samples of 30 → all null; 60th → `"bloom"`; next 60 × 30 → `"shadows"`; then `"textures"`, `"pixelRatio"`, then null; `level === 4`.
  - Governor 60 samples of 16 → null, `level === 0`.
  - Governor `startWithoutBloom:true`: first step returned is `"shadows"`.

- [ ] **Step 2: Run, expect failure.**
  Run: `node --test src/scripts/brake/math.test.ts`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement `math.ts`.** Erasable TS only (no enums, no parameter properties) so Node's type stripping runs it.

- [ ] **Step 4: Run, expect pass.**
  Run: `node --test src/scripts/brake/math.test.ts`
  Expected: all tests pass.

- [ ] **Step 5: Checkpoint.** `npm run build` passes.

---

### Task 3: Materials and runtime textures

**Files:**
- Create: `src/scripts/brake/materials.ts`

**Interfaces:**
- Produces:
  - `export interface BrakeMaterials { rotorFace: THREE.MeshPhysicalMaterial; rotorCast: THREE.MeshStandardMaterial; hatRust: THREE.MeshStandardMaterial; caliperPaint: THREE.MeshPhysicalMaterial; bracket: THREE.MeshStandardMaterial; padFriction: THREE.MeshStandardMaterial; padBacking: THREE.MeshStandardMaterial; zinc: THREE.MeshStandardMaterial; chrome: THREE.MeshStandardMaterial; rubber: THREE.MeshStandardMaterial; shield: THREE.MeshStandardMaterial; brandMark: THREE.MeshStandardMaterial; heatMaterials: THREE.MeshStandardMaterial[]; downgradeTextures(): void; dispose(): void; }`
  - `export function createMaterials(opts: { texSize: 512 | 1024; anisotropy: number }): BrakeMaterials`
  - `heatMaterials` = `[rotorFace, rotorCast]` (emissive starts black, intensity 0; Task 6 drives them).

- [ ] **Step 1: Implement texture generators** (canvas, seeded noise so output is stable between loads): machined concentric grain for the rotor face (roughness varies along the grain so highlights streak in circles; centre-mapped like today's `machinedTexture`) with a very faint straw/blue heat-tint band where the pads sweep, as-cast grey grain for vanes/edges, patchy orange-brown oxide mask for the hat, satin paint with fine orange-peel bump plus darker brake-dust toward edges for the caliper, speckled friction compound for pads, stamped-steel with light rust for the dust shield, and the "QUEENS" mark as an alpha + bump texture (painted/raised, not flat white). Colour textures `SRGBColorSpace`; roughness/bump linear.
- [ ] **Step 2: Implement `createMaterials`.** Caliper: `MeshPhysicalMaterial`, deep satin red (pick around `#9e1218`–`#b3151d`), roughness ~0.45, low clearcoat (≤ 0.35) with clearcoat roughness ≥ 0.3. Rotor face metalness 1, bright satin steel. `downgradeTextures()` regenerates every texture at 512² and swaps maps in place (dispose old). `dispose()` frees all textures and materials.
- [ ] **Step 3: Checkpoint.** `npm run build` passes (module not yet imported; Task 4 wires it).

---

### Task 4: Realistic hardware geometry

**Files:**
- Create: `src/scripts/brake/parts.ts`
- Modify: `src/scripts/brake-scene.ts` (replace inline geometry/material code with `createMaterials` + `buildBrake`)

**Interfaces:**
- Consumes: `createMaterials`, `BrakeMaterials` (Task 3).
- Produces:
  - `export type AnchorKey = "rotor" | "pads" | "caliper" | "hub";`
  - `export interface BrakeRig { assembly: THREE.Group; spin: THREE.Group; rotor: THREE.Group; hub: THREE.Group; nuts: THREE.Group; caliper: THREE.Group; padIn: THREE.Group; padOut: THREE.Group; shield: THREE.Group; dir: THREE.Vector3; anchors: Record<AnchorKey, THREE.Object3D>; padContact: THREE.Object3D; shadowCasters: THREE.Mesh[]; }`
  - `export function buildBrake(mats: BrakeMaterials): BrakeRig`
  - Keep today's world scale and caliper angle (rotor outer radius 1.0, `THETA = 1.05`, `dir = (cos THETA, sin THETA, 0)`) so the existing explode config `E`, camera distances and label code keep working. `padContact` sits where the outer pad meets the rotor face (spark origin, Task 6). `shield` explodes with the hub (orchestrator: `shield.position.z = E.hub.z * 0.6 * eh`).

- [ ] **Step 1: Build the parts** per spec *Hardware*: plain vented rotor (two friction rings, curved vanes visible through the gap, hat with centre bore + 5 lug holes — no drilled holes or slots); single-piston floating caliper body with rounded/bevelled form (lathe/extrude with bevels, not slabs), separate anchor bracket, two guide pins with rubber boots, bleeder with rubber cap, banjo bolt + hose, one large piston on the inboard side, "QUEENS" mark on the outboard face; pads with chamfered ends, centre slot, backing plate, shim, wear tab on one pad; hub flange, 5 knurled studs, centre cap, conical chrome lug nuts; partial dust shield behind the rotor.
- [ ] **Step 2: Wire into `brake-scene.ts`:** remove the old geometry/material helpers, call `createMaterials({ texSize: coarse ? 512 : 1024, anisotropy: renderer.capabilities.getMaxAnisotropy() })` and `buildBrake(mats)`; `applyLayout` uses `rig.*`; add `shield` explode line; `dispose` calls `mats.dispose()`.
- [ ] **Step 3: Verify.**
  Run: `npm run build` then `node .claude/audit/brake-3d/verify.cjs task4`
  Expected: build passes; console errors 0; open `task4/*/assembled.png` and `exploded.png` — plain vented rotor, recognisable floating caliper with bracket, all four labels inside the stage at 390 and 1440.

---

### Task 5: Workshop lighting, shadows, contact shadow

**Files:**
- Create: `src/scripts/brake/lighting.ts`
- Modify: `src/scripts/brake-scene.ts` (replace `RoomEnvironment` + inline lights)

**Interfaces:**
- Consumes: `BrakeRig.shadowCasters`, `BrakeRig.assembly` (Task 4).
- Produces:
  - `export interface Lighting { key: THREE.DirectionalLight; heatLight: THREE.PointLight; contactShadow: THREE.Mesh; setShadows(on: boolean): void; dispose(): void; }`
  - `export function setupLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene, rig: BrakeRig, opts: { coarse: boolean }): Lighting`

- [ ] **Step 1: Procedural environment.** Build a small scene (dark room, 3–4 long emissive softbox strips, warm fill, cool `#6cafde`-ish rim panel), `PMREMGenerator.fromScene` → `scene.environment`. Zero downloads. Keep `scene.background` null (canvas stays transparent over the page's radial gradient).
- [ ] **Step 2: Lights and shadows.** Key `DirectionalLight` with `castShadow`, `PCFSoftShadowMap`, map size 1024 (512 coarse), tight shadow camera around the assembly; only `rig.shadowCasters` cast; rotor faces, hat, shield receive. Heat `PointLight` moved here (intensity 0). `setShadows(false)` disables `renderer.shadowMap.enabled` and the key's `castShadow`.
- [ ] **Step 3: Contact shadow.** Soft radial-gradient plane (canvas texture, `transparent`, `depthWrite: false`) under the assembly, scaled with explode (wider/fainter when exploded). Must blend into the stage background with no visible edge.
- [ ] **Step 4: Verify.**
  Run: `npm run build` then `node .claude/audit/brake-3d/verify.cjs task5`
  Expected: console errors 0; `assembled.png` shows long highlight streaks on the rotor face, caliper shadow on the rotor, no hard plane edge.

---

### Task 6: Heat, bloom / glow fallback, sparks

**Files:**
- Create: `src/scripts/brake/effects.ts`
- Modify: `src/scripts/brake-scene.ts` (loop calls `effects.update` + `effects.render` instead of `renderer.render`)

**Interfaces:**
- Consumes: `heatRamp` (Task 2), `BrakeMaterials.heatMaterials` (Task 3), `BrakeRig.padContact`, `BrakeRig.dir` (Task 4), `Lighting.heatLight` (Task 5).
- Produces:
  - `export interface Effects { update(dt: number, s: { heat: number; omega: number; pressing: boolean }): void; render(): void; setBloom(on: boolean): void; resize(w: number, h: number, pixelRatio: number): void; dispose(): void; }`
  - `export function createEffects(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, rig: BrakeRig, mats: BrakeMaterials, lighting: Lighting, opts: { bloom: boolean; sparks: boolean }): Effects`

- [ ] **Step 1: Heat.** Each frame set `heatMaterials` emissive colour/intensity from `heatRamp(heat)`. Glow concentrated where the pads sweep (use an emissive map shaped as the friction band, brightest at the vanes' outer edge) so it spreads rather than lighting the whole disc. Heat light colour follows the ramp.
- [ ] **Step 2: Bloom.** When `opts.bloom`: `EffectComposer` → `RenderPass` → `UnrealBloomPass` (high threshold so only hot metal blooms; strength tuned so idle frames look identical to no-bloom) → `OutputPass`. Composer must keep the canvas transparent (render target with alpha; verify the page background shows through). `setBloom(false)` switches `render()` to plain `renderer.render`. Fallback (no bloom): additive `Sprite` glow at the pad sweep, opacity from heat.
- [ ] **Step 3: Sparks.** When `opts.sparks` (false for reduced motion): small pool (≤ 48) of short orange streaks (`LineSegments` or instanced quads, additive) emitted from `padContact`, tangent to rotor rotation, only while `pressing && omega > 3`, gravity + quick fade (< 0.4 s life). Subtle: if it reads cartoonish in screenshots, set the default to off and say so.
- [ ] **Step 4: Verify.**
  Run: `npm run build` then `node .claude/audit/brake-3d/verify.cjs task6`
  Expected: console errors 0; `hot.png` at 1440 shows red→orange glow on the friction band with bloom halo, page background visible around the brake (no black box); at 390 the glow sprite shows, no bloom.

---

### Task 7: Orchestrator — intro, adaptive quality, robustness

**Files:**
- Modify: `src/scripts/brake-scene.ts`, `src/pages/brakes.astro` (canvas `aria-label`), `.claude/audit/brake-3d/verify.cjs` (add checks)

**Interfaces:**
- Consumes: everything above. `QualityGovernor`, `introProgress`, `INTRO_MS` (Task 2); `mats.downgradeTextures` (Task 3); `lighting.setShadows` (Task 5); `effects.setBloom`, `effects.resize` (Task 6).

- [ ] **Step 1: Add the Review Focus checks to `verify.cjs`** (they fail on the current code where noted):
  - `introDone` within 2500 ms + 300 ms tolerance of `data-ready` (fails today: frame-clamped dt).
  - Hidden tab: `page.evaluate` to dispatch `visibilitychange` with `document.hidden` stubbed true for 3 s mid-intro, then visible → `introDone === true` within 300 ms.
  - Pointer down on stage, move pointer outside, dispatch `pointercancel` → after 4 s `heat < 0.1`.
  - Toggle exploded at 500 ms into the intro → no console errors; `ex` reaches > 0.9 within 2 s.
  - Resize viewport 390×844 → 844×390 → 390×844 → all labels' rects inside the stage rect.
  - `__brake.loseContext()` → within 1 s `#brake-stage[data-ready]` is not `"true"` (poster visible), console errors 0.
  - `__brake.dispose()` → `state.info.geometries === 0 && state.info.textures === 0` (read before renderer dispose).
  - Hero CTA top equals `before/results.json` value ± 2 px at both viewports.
  - LCP element (via `PerformanceObserver` `largest-contentful-paint`, buffered) is NOT the canvas — it is the poster `img.bk-poster` or hero text, same as `before`.
  - Gzipped `dist/_astro/brake-scene.*.js` ≤ 207,821 bytes.
- [ ] **Step 2: Run; expect the intro, hidden-tab and context-loss checks to fail.**
  Run: `node .claude/audit/brake-3d/verify.cjs task7-red`
- [ ] **Step 3: Intro camera.** Drive the intro from `introProgress(performance.now() - mountTime)` (wall-clock, not `dt`): camera starts close on the rotor face (rotor fills most of the frame) and dollies back to the home framing while parts assemble from exploded. If the tab was hidden, `introProgress` simply reads ≥ 1 on return. Reduced motion: start at progress 1.
- [ ] **Step 4: Adaptive quality.** After intro, feed frame times to `new QualityGovernor({ budgetMs: 22, sampleFrames: 60, startWithoutBloom: coarse })`; apply returned step (`effects.setBloom(false)`, `lighting.setShadows(false)`, `mats.downgradeTextures()`, pixel ratio → 1 then `effects.resize`). Expose `qualityLevel` on the debug hook.
- [ ] **Step 5: Robustness.** `webglcontextlost` → `preventDefault`, stop loop, set `stage.dataset.ready = "false"` (poster CSS shows it). Resize observer also calls `effects.resize`. Pointer `pointercancel`/`lostpointercapture` end the press. `dispose()` frees materials, lighting, effects, composer targets, env.
- [ ] **Step 6: Copy.** Canvas `aria-label` → `"Interactive 3D model of a disc brake: vented rotor, caliper, pads and hub"`; update the header comment in `brake-scene.ts` (no "cross-drilled").
- [ ] **Step 7: Run; expect all checks to pass.**
  Run: `npm run build` then `node .claude/audit/brake-3d/verify.cjs after`
  Expected: exit 0; every check in Step 1 passes.

---

### Task 8: Final verification against the spec

**Files:** none (report only)

- [ ] **Step 1: Unit tests.** `node --test src/scripts/brake/math.test.ts` → all pass.
- [ ] **Step 2: Build + size.** `npm run build` passes; report gzipped chunk before (146,381) / after.
- [ ] **Step 3: Frame rate.** Run `verify.cjs` headed with GPU at 1440 (target ~60 fps) and with mobile emulation + 4× CPU throttle at 390 (target ≥ 45 fps, report `qualityLevel` reached). If no GPU is available headless, say so and report the numbers you have.
- [ ] **Step 4: Reduced motion + no WebGL.** Emulate `prefers-reduced-motion: reduce` → no fly-in/sway/sparks, drag + hold still work. Launch with `--disable-webgl` → poster shown, console errors 0.
- [ ] **Step 5: Visual comparison.** Put `before/` and `after/` screenshots side by side (assembled, exploded, hot at 1440 and 390) and list what changed against the spec's *Hardware*, *Surfaces*, *Light* and *Wow* sections, plus anything not achieved.
- [ ] **Step 6: Report** per item: done / partial / skipped (why), files changed, numbers above. No git commands.
