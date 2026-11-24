# /brakes hero 3D brake — realism rebuild

Date: 2026-11-23
Status: approved 2026-11-23

## Intent

The `/brakes` page is a paid-ad landing page selling a $369-per-axle pad + rotor service.
The 3D brake in the hero should deliver a "wow" in the first couple of seconds, then stay out
of the way of the copy, which is what sells (offer, price, bonuses, CTA).

Today the brake reads as a toy: it is built from primitive shapes (the caliper is three flat
red slabs), every material is a flat color with no wear or casting texture, lighting is a
generic studio preset with no shadows, and it floats in empty space. The goal is a brake that
looks like real hardware a customer would recognise from their own car, staged so it feels
like something you can almost touch.

## Goals

- **Realistic hardware.** Reads as a real stock brake assembly, not a render of a toy:
  believable shapes, cast-iron and machined-steel surfaces, wear, dust, light oxidation.
- **Immersive staging.** Lighting with real metal highlights, self-shadowing, a grounded
  feel, a cinematic intro, and a heat effect when the visitor "brakes" that feels physical.
- **Keep what works.** Drag to rotate, press-and-hold to brake, exploded view (button +
  scroll), projected HTML labels, reduced-motion support, poster-image fallback without WebGL.

## Non-goals

- Photorealism. Ceiling is "very good real-time render".
- Changes to the copy, layout, stage size, or anything outside the 3D stage.
- New interactions (gyro tilt, sound, configurators).
- Loading a 3D model file (approach B, rejected below).

## Anti-goals (failure even if it "works")

- The stage grows or the copy/CTA moves down. Stage stays in `#brake-stage` with today's size
  caps (300px phones, 400px tablets, sticky square on desktop).
- The page gets slower to show the offer. The poster `<img>` remains the first-paint/LCP
  element; the scene stays lazy-loaded.
- Stutters on a mid-range Android phone.
- It shows performance parts the $369 deal excludes (cross-drilled/slotted rotors,
  multi-piston big-brake calipers).
- It looks *more* cartoonish in a new way: neon glow, oversaturated colors, cartoon sparks.

## Constraints

- Stack: Astro 7, `three@0.187` already bundled (`src/scripts/brake-scene.ts`, ~586 kB
  minified chunk, dynamically imported by `src/pages/brakes.astro` when the stage nears the
  viewport). Only `three` and `three/addons/*` may be used; no new npm dependencies.
- **Budget:** added JS ≤ 60 kB gzipped over today's chunk. Added downloaded assets ≤ 1 MB
  total, requested only after the scene mounts. Prefer runtime-generated textures (zero bytes).
- **Frame rate:** 60 fps on desktop; ≥ 45 fps on a mid-range phone. Pixel-ratio caps stay
  (1.5 coarse pointer, 2 fine).
- Public API unchanged: `mountBrakeScene(stage, { reducedMotion })` returning
  `{ dispose, setExploded }`; label anchors keyed `rotor | pads | caliper | hub`.
- `dispose()` must free every new geometry, material, texture, render target and composer.

## Approaches

- **A. Rebuild the procedural model to a realistic standard — chosen.** Better geometry,
  runtime-generated PBR textures, a real lighting environment, shadows, and a heat effect.
  Keeps every interaction and the exploded view, little extra weight, no licensing.
  Ceiling is a very good real-time render, not a photo.
- **B. Real 3D model file (bought, CC-licensed, or commissioned).** Most realistic, but
  ready-made models are usually one fused mesh, so the exploded view and labels would need
  rework or go. Licensing to check, 1–3 MB even compressed. Rejected.
- **C. Pre-rendered cinematic video / image sequence.** Best looking, but loses drag and
  press-to-brake (the part visitors play with) and is heavy on phones. Rejected.

The user picked A.

## Design

### Hardware (what gets modelled)

Model what a $369 customer actually gets on a typical car:

- **Rotor — plain vented, one-piece cast.** No drilled holes, no slots. Two friction rings
  joined by curved vanes, visible through the gap at the outer edge. Friction faces machined:
  fine concentric grain, bright satin steel. Outer edge, vanes and inner rim as-cast dark grey.
  Hat section: cast grey with light surface rust/oxide (patchy orange-brown), center bore,
  5 lug holes. A faint heat-tint band (straw/blue) where pads sweep, very subtle.
- **Caliper — single-piston floating caliper with bracket.** Rounded, cast-looking body
  (bevelled/filleted, not slabs), a separate anchor bracket, two guide pins with rubber boots,
  bleeder screw with rubber cap, banjo bolt and a braided or rubber hose. Satin painted finish
  with slight orange-peel texture and brake-dust darkening toward edges. Colour: deep satin
  red (see *Decided by owner* below). Keep the "QUEENS" mark, but as a cast/painted-on relief look, not a
  flat white decal.
- **Pads.** Friction material with chamfered ends and a center slot, steel backing plate,
  thin shim, and a small wear-indicator tab on one pad.
- **Hub.** Hub flange with 5 knurled studs, center cap/bearing face; conical chrome lug nuts.
- **Dust shield (new).** A partial stamped-steel backing plate behind the rotor, dark,
  slightly rusty. Adds context and depth behind the rotor.

### Surfaces

- All textures generated at runtime with canvas (noise, grain, rust and dust masks):
  colour/roughness/normal (or bump) maps. 512² on coarse-pointer devices, 1024² otherwise.
  Generated once at mount, disposed with the scene.
- Machined faces use roughness variation along the grain so highlights streak in circles the
  way real rotors do.

### Light and environment

- Replace `RoomEnvironment` with a custom procedural "workshop" environment scene rendered to
  PMREM: a few long softbox strips (for long clean streaks on metal), a warm fill and a cool
  rim. Zero downloaded bytes. (Builder may swap in a ≤ 600 kB CC0 HDRI instead if the
  procedural one can't get metal to read convincingly; say so in the report.)
- Key light casts soft shadows (PCF soft) so the caliper shadows the rotor and parts shadow
  each other. Shadow map 1024 desktop / 512 coarse pointer; shadows only on parts that
  benefit.
- A soft contact shadow / haze under the assembly so it feels grounded, blending into the
  existing blue radial stage background.

### The wow moments

- **Intro.** The camera starts close on the rotor face (grain and light streaks fill the
  frame) and pulls back as the parts fly in and assemble. Must finish within ~2.5s of
  wall-clock time on every device (use real elapsed time, not frame-clamped `dt`).
- **Braking.** Press and hold: pads clamp, rotor slows, then heat builds believably — first a
  dull red where the pads sweep, spreading and brightening toward orange, glowing at the
  vanes. Desktop / capable GPUs: selective bloom on the glow (`UnrealBloomPass` via
  `EffectComposer`, high threshold so only the hot metal blooms). Phones / weak GPUs: no
  post-processing; emissive plus an additive glow sprite instead. Optional and subtle: a
  short spray of small orange sparks from the pad contact point when braking from full
  speed. Physical, not cartoon; drop it if it can't look right.
- **Idle.** Keep the slow spin, sway and pointer parallax.

### Adaptive quality

Start at full quality; measure average frame time over the first ~60 frames after the intro.
If it is too slow (> ~22 ms), step down in order: bloom → shadows → texture size → pixel ratio.
Coarse-pointer devices start without bloom.

### Copy touch-ups inside the stage

- `aria-label` on the canvas and the header comment in `brake-scene.ts`: drop
  "cross-drilled". Visible label stays "Vented rotor".
- Poster image unchanged.

## Verification

- `npm run build` passes; report gzipped size of the `brake-scene` chunk before and after.
- Screenshots (assembled, exploded, braking-hot) at 1440×900 and 390×844, before and after,
  in `.claude/audit/brake-3d/`.
- Frame rate measured on desktop and with mobile emulation + CPU throttling.
- Poster is still the LCP element; hero copy and CTA positions unchanged at 1440×900,
  1280×800, 768×1024, 390×844.
- Reduced motion: no intro fly-in or sway, still interactive.
- No WebGL: poster remains, no console errors.
- `dispose()` leaves no WebGL resources (check `renderer.info` before dispose).

## Left to the builder

Exact dimensions and proportions, texture algorithms, colour values within the constraints
above, light positions, bloom parameters, camera path of the intro, and spark particle
details (or dropping them).

## Decided by owner

- **Caliper colour: red** ("more eye candy"). Deep satin red, less saturated than today's
  `#d1121f` clear-coat, so it stays on-brand and eye-catching without looking like a toy.
  The "QUEENS" mark stays on it.
