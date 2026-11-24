/**
 * Runtime-generated textures + PBR materials for the brake scene.
 * Nothing is downloaded: every map is drawn on a canvas at mount.
 */
import * as THREE from "three";

export interface BrakeMaterials {
  rotorFace: THREE.MeshPhysicalMaterial;
  rotorCast: THREE.MeshStandardMaterial;
  hatRust: THREE.MeshStandardMaterial;
  caliperPaint: THREE.MeshPhysicalMaterial;
  bracket: THREE.MeshStandardMaterial;
  padFriction: THREE.MeshStandardMaterial;
  padBacking: THREE.MeshStandardMaterial;
  zinc: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  shield: THREE.MeshStandardMaterial;
  brandMark: THREE.MeshStandardMaterial;
  heatMaterials: THREE.MeshStandardMaterial[];
  /** Resolves once every texture has been generated and assigned. */
  ready: Promise<void>;
  downgradeTextures(): Promise<void>;
  dispose(): void;
}

// ------------------------------------------------------------------ noise

/** Hand the main thread back between textures so the page stays responsive. */
const yieldToMain = (): Promise<void> => {
  const sched = (globalThis as any).scheduler;
  return sched?.yield ? sched.yield() : new Promise((r) => setTimeout(r, 0));
};


function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable fBm value-noise field, values ~0..1. */
async function fbmField(size: number, seed: number, octaves = 5, base = 4): Promise<Float32Array> {
  let t0 = performance.now();
  const out = new Float32Array(size * size);
  const rand = rng(seed);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = base << o;
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cells;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const r0 = (y0 % cells) * cells;
      const r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const c0 = x0 % cells;
        const c1 = (x0 + 1) % cells;
        const top = grid[r0 + c0] + (grid[r0 + c1] - grid[r0 + c0]) * sx;
        const bot = grid[r1 + c0] + (grid[r1 + c1] - grid[r1 + c0]) * sx;
        out[y * size + x] += (top + (bot - top) * sy) * amp;
      }
      if ((y & 15) === 15 && performance.now() - t0 > SLICE_MS) {
        await yieldToMain();
        t0 = performance.now();
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// ---------------------------------------------------------------- canvases

function canvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return { c, ctx: c.getContext("2d", { willReadFrequently: true })! };
}

/** Time-sliced pixel pass: yields to the browser roughly every SLICE_MS. */
const SLICE_MS = 12;
async function fromPixels(size: number, fill: (i: number, x: number, y: number, px: Uint8ClampedArray) => void) {
  const { c, ctx } = canvas(size);
  const img = ctx.createImageData(size, size);
  const px = img.data;
  let t0 = performance.now();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) fill((y * size + x) * 4, x, y, px);
    if ((y & 15) === 15 && performance.now() - t0 > SLICE_MS) {
      await yieldToMain();
      t0 = performance.now();
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: number; anisotropy: number; centered?: boolean }) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (opts.centered) {
    // ExtrudeGeometry cap UVs are the raw shape XY (-1..1) → map into 0..1
    t.repeat.set(0.5, 0.5);
    t.offset.set(0.5, 0.5);
  } else if (opts.repeat) {
    t.repeat.set(opts.repeat, opts.repeat);
  }
  t.anisotropy = opts.anisotropy;
  if (opts.srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PAD_INNER = 0.66;
const PAD_OUTER = 0.97;

interface TextureSet {
  faceMap: THREE.Texture;
  faceRough: THREE.Texture;
  faceBump: THREE.Texture;
  faceAniso: THREE.Texture;
  faceGlow: THREE.Texture;
  castMap: THREE.Texture;
  castRough: THREE.Texture;
  rustMap: THREE.Texture;
  rustRough: THREE.Texture;
  paintMap: THREE.Texture;
  paintBump: THREE.Texture;
  padMap: THREE.Texture;
  shieldMap: THREE.Texture;
  markMap: THREE.Texture;
  markAlpha: THREE.Texture;
  all: THREE.Texture[];
}


interface Noise {
  N: number;
  n: (x: number, y: number) => number;
  f: (x: number, y: number) => number;
}

async function noiseFields(N: number): Promise<Noise> {
  const noise = await fbmField(N, 1337);
  await yieldToMain();
  const fine = await fbmField(N, 7, 3, 32);
  await yieldToMain();
  return {
    N,
    n: (x, y) => noise[((y % N) * N + (x % N)) | 0],
    f: (x, y) => fine[((y % N) * N + (x % N)) | 0],
  };
}

type FaceSet = Pick<TextureSet, "faceMap" | "faceRough" | "faceBump" | "faceAniso" | "faceGlow"> & { all: THREE.Texture[] };
type SurfaceSet = Omit<TextureSet, keyof FaceSet> & { all: THREE.Texture[] };

/** Rotor friction-face textures (centre-mapped, sized to the device). */
async function buildFace(size: number, anisotropy: number, { n, f }: Noise): Promise<FaceSet> {
  const all: THREE.Texture[] = [];
  const keep = (t: THREE.Texture) => (all.push(t), t);

  // ---- rotor friction face: concentric machining, faint heat tint, circular anisotropy
  const S = size;
  const half = S / 2;
  const ringRand = rng(99);
  const rings = new Float32Array(Math.ceil(half) + 2);
  for (let i = 0; i < rings.length; i++) rings[i] = ringRand();
  const radT = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) radT[y * S + x] = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
    if ((y & 63) === 63) await yieldToMain();
  }
  const radial = (x: number, y: number) => radT[y * S + x];
  await yieldToMain();
  await yieldToMain();
  const faceMap = await fromPixels(S, (i, x, y, px) => {
    const r = radial(x, y);
    const g = rings[Math.floor(r * half * 0.9)] ?? 0.5;
    let v = 168 + g * 40 + (n(x, y) - 0.5) * 26;
    // heat tint: faint straw → blue across the pad sweep
    const band = Math.max(0, 1 - Math.abs((r - (PAD_INNER + PAD_OUTER) / 2) / ((PAD_OUTER - PAD_INNER) / 2)));
    const tint = band * 0.16 * (0.6 + 0.4 * n(x + 50, y + 90));
    px[i] = v * (1 + tint * 0.25);
    px[i + 1] = v * (1 + tint * 0.05);
    px[i + 2] = v * (1 - tint * 0.2) + tint * 30 * (r > 0.85 ? 1 : 0);
    px[i + 3] = 255;
  });
  await yieldToMain();
  const faceRough = await fromPixels(S, (i, x, y, px) => {
    const r = radial(x, y);
    const g = rings[Math.floor(r * half * 0.9)] ?? 0.5;
    const v = 70 + g * 70 + (f(x, y) - 0.5) * 40; // 0.27..0.55 roughness
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  });
  await yieldToMain();
  const faceBump = await fromPixels(S, (i, x, y, px) => {
    const r = radial(x, y);
    const g = rings[Math.floor(r * half * 0.9)] ?? 0.5;
    const v = 128 + (g - 0.5) * 120;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  });
  await yieldToMain();
  const faceAniso = await fromPixels(S, (i, x, y, px) => {
    // tangential direction (machining lathe marks run around the disc)
    const dx = x + 0.5 - half;
    const dy = -(y + 0.5 - half);
    const len = Math.hypot(dx, dy) || 1;
    px[i] = (-dy / len) * 127.5 + 127.5;
    px[i + 1] = (dx / len) * 127.5 + 127.5;
    px[i + 2] = 255;
    px[i + 3] = 255;
  });
  await yieldToMain();
  const faceGlow = await fromPixels(S, (i, x, y, px) => {
    // heat concentrates where the pads sweep, strongest toward the outer edge
    const r = radial(x, y);
    const t = (r - PAD_INNER + 0.04) / (PAD_OUTER - PAD_INNER + 0.06);
    const band = t <= 0 || t >= 1 ? 0 : Math.pow(Math.sin(t * Math.PI), 0.7) * (0.55 + 0.45 * t);
    const v = Math.max(0, Math.min(255, band * 255 * (0.8 + 0.4 * n(x, y))));
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  });

  return {
    faceMap: keep(tex(faceMap, { srgb: true, centered: true, anisotropy })),
    faceRough: keep(tex(faceRough, { centered: true, anisotropy })),
    faceBump: keep(tex(faceBump, { centered: true, anisotropy })),
    faceAniso: keep(tex(faceAniso, { centered: true, anisotropy })),
    faceGlow: keep(tex(faceGlow, { centered: true, anisotropy })),
    all,
  };
}

/** Tiling surface textures for every other part. */
async function buildSurface(anisotropy: number, { N, n, f }: Noise): Promise<SurfaceSet> {
  const all: THREE.Texture[] = [];
  const keep = (t: THREE.Texture) => (all.push(t), t);

  // ---- as-cast grey iron (vanes, rotor edge, hub, bracket)
  await yieldToMain();
  const castMap = await fromPixels(N, (i, x, y, px) => {
    const v = 92 + (n(x, y) - 0.5) * 40 + (f(x, y) - 0.5) * 34;
    px[i] = v;
    px[i + 1] = v * 0.99;
    px[i + 2] = v * 0.97;
    px[i + 3] = 255;
  });
  await yieldToMain();
  const castRough = await fromPixels(N, (i, x, y, px) => {
    const v = 175 + (f(x, y) - 0.5) * 80;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  });

  // ---- hat: cast iron with patchy surface rust
  // light surface oxide: soft, low-contrast brown bloom, mostly toward patches
  const rustAmount = (x: number, y: number) =>
    0.55 * Math.min(1, Math.max(0, (n(x + 200, y + 31) - 0.5) * 3.2 + (f(x, y) - 0.5) * 0.8));
  await yieldToMain();
  const rustMap = await fromPixels(N, (i, x, y, px) => {
    const k = rustAmount(x, y);
    const base = 96 + (f(x, y) - 0.5) * 26 + (n(x, y) - 0.5) * 20;
    const dark = 0.8 + 0.35 * f(x + 9, y + 3);
    px[i] = base * (1 - k) + 112 * dark * k;
    px[i + 1] = base * (1 - k) + 70 * dark * k;
    px[i + 2] = base * 0.97 * (1 - k) + 48 * dark * k;
    px[i + 3] = 255;
  });
  await yieldToMain();
  const rustRough = await fromPixels(N, (i, x, y, px) => {
    const v = 160 + rustAmount(x, y) * 85;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  });

  // ---- caliper paint: mottled brake-dust grime (multiplies the red), orange-peel bump
  await yieldToMain();
  const paintMap = await fromPixels(N, (i, x, y, px) => {
    const grime = Math.max(0, (n(x + 77, y + 12) - 0.42) * 1.4);
    const v = 255 * (1 - grime * 0.55) - (f(x, y) < 0.3 ? 18 : 0);
    px[i] = v;
    px[i + 1] = v * 0.97;
    px[i + 2] = v * 0.95;
    px[i + 3] = 255;
  });
  await yieldToMain();
  const paintBump = await fromPixels(N, (i, x, y, px) => {
    const v = 128 + (f(x * 2, y * 2) - 0.5) * 90;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  });

  // ---- pad friction compound: dark speckle with metal flecks
  const flecks = rng(5);
  await yieldToMain();
  const padMap = await fromPixels(N, (i, x, y, px) => {
    let v = 46 + (f(x, y) - 0.5) * 30 + (n(x, y) - 0.5) * 18;
    if (flecks() > 0.985) v += 60 + flecks() * 60;
    px[i] = v;
    px[i + 1] = v * 0.97;
    px[i + 2] = v * 0.93;
    px[i + 3] = 255;
  });

  // ---- dust shield: black stamped steel with rust freckles
  await yieldToMain();
  const shieldMap = await fromPixels(N, (i, x, y, px) => {
    const k = Math.max(0, (n(x + 400, y + 400) - 0.55) * 4) * (f(x, y) > 0.45 ? 1 : 0.3);
    const base = 34 + (f(x, y) - 0.5) * 14;
    px[i] = base * (1 - k) + 110 * k;
    px[i + 1] = base * (1 - k) + 56 * k;
    px[i + 2] = base * (1 - k) + 30 * k;
    px[i + 3] = 255;
  });

  // ---- QUEENS mark: painted-on lettering
  const mark = (() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = "#fff";
    ctx.font = "italic 900 168px 'Big Shoulders Display', Impact, 'Arial Black', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("QUEENS", 512, 134);
    return c;
  })();
  const markAlpha = keep(tex(mark, { anisotropy }));
  markAlpha.wrapS = markAlpha.wrapT = THREE.ClampToEdgeWrapping;
  await yieldToMain();
  const markMap = keep(tex(await fromPixels(N, (i, x, y, px) => {
    const v = 226 - Math.max(0, (n(x, y) - 0.5) * 120);
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v * 0.98;
    px[i + 3] = 255;
  }), { srgb: true, anisotropy }));

  return {
    castMap: keep(tex(castMap, { srgb: true, repeat: 2, anisotropy })),
    castRough: keep(tex(castRough, { repeat: 2, anisotropy })),
    rustMap: keep(tex(rustMap, { srgb: true, repeat: 1, anisotropy })),
    rustRough: keep(tex(rustRough, { repeat: 1, anisotropy })),
    paintMap: keep(tex(paintMap, { srgb: true, repeat: 1.5, anisotropy })),
    paintBump: keep(tex(paintBump, { repeat: 3, anisotropy })),
    padMap: keep(tex(padMap, { srgb: true, repeat: 2, anisotropy })),
    shieldMap: keep(tex(shieldMap, { srgb: true, repeat: 1.5, anisotropy })),
    markMap,
    markAlpha,
    all,
  };
}

// --------------------------------------------------------------- materials

export function createMaterials(opts: { texSize: 512 | 1024; anisotropy: number }): BrakeMaterials {
  let face: FaceSet | null = null;
  let surf: SurfaceSet | null = null;
  let downgraded = false;
  let disposed = false;

  const rotorFace = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0.85, // scaled by roughnessMap
    bumpScale: 0.35,
    anisotropy: 0.6, // lathe marks stretch highlights into radial streaks
    anisotropyRotation: Math.PI / 2,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0,
  });
  const rotorCast = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.85,
    roughness: 1,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0,
    side: THREE.DoubleSide,
  });
  const hatRust = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.75, roughness: 1, side: THREE.DoubleSide });
  const caliperPaint = new THREE.MeshPhysicalMaterial({
    color: 0xa3141b, // deep satin red, less saturated than the old #d1121f
    metalness: 0.15,
    roughness: 0.46,
    bumpScale: 0.12,
    clearcoat: 0.3,
    clearcoatRoughness: 0.38,
  });
  const bracket = new THREE.MeshStandardMaterial({ color: 0x6a6e74, metalness: 0.8, roughness: 1 });
  const padFriction = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.15, roughness: 0.92 });
  const padBacking = new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.6, roughness: 0.55 });
  const zinc = new THREE.MeshStandardMaterial({ color: 0xc9c2a8, metalness: 1, roughness: 0.32 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe6e9ee, metalness: 1, roughness: 0.12 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111113, metalness: 0, roughness: 0.7 });
  const shield = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.62, side: THREE.DoubleSide });
  const brandMark = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.1,
    roughness: 0.5,
    transparent: true,
    alphaTest: 0.35,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  function assign() {
    if (!face || !surf) return;
    const t = { ...face, ...surf };
    rotorFace.map = t.faceMap;
    rotorFace.roughnessMap = t.faceRough;
    rotorFace.bumpMap = t.faceBump;
    rotorFace.anisotropyMap = t.faceAniso;
    rotorFace.emissiveMap = t.faceGlow;
    rotorCast.map = t.castMap;
    rotorCast.roughnessMap = t.castRough;
    hatRust.map = t.rustMap;
    hatRust.roughnessMap = t.rustRough;
    caliperPaint.map = t.paintMap;
    caliperPaint.bumpMap = t.paintBump;
    bracket.map = t.castMap;
    bracket.roughnessMap = t.castRough;
    padFriction.map = t.padMap;
    shield.map = t.shieldMap;
    brandMark.map = t.markMap;
    brandMark.alphaMap = t.markAlpha;
  }

  const all = [rotorFace, rotorCast, hatRust, caliperPaint, bracket, padFriction, padBacking, zinc, chrome, rubber, shield, brandMark];

  // Textures are generated in slices after this returns; render once `ready` resolves.
  const ready = (async () => {
    await yieldToMain(); // return to the caller first
    const noise = await noiseFields(opts.texSize === 512 ? 256 : 512);
    const fs = await buildFace(opts.texSize, opts.anisotropy, noise);
    const ss = await buildSurface(opts.anisotropy, noise);
    if (disposed) {
      fs.all.forEach((x) => x.dispose());
      ss.all.forEach((x) => x.dispose());
      return;
    }
    face = fs;
    surf = ss;
    assign();
    all.forEach((m) => (m.needsUpdate = true));
  })();

  return {
    rotorFace,
    rotorCast,
    hatRust,
    caliperPaint,
    bracket,
    padFriction,
    padBacking,
    zinc,
    chrome,
    rubber,
    shield,
    brandMark,
    heatMaterials: [rotorFace, rotorCast],
    ready,
    async downgradeTextures() {
      // phones already run 512² faces and 256² surfaces: nothing cheaper to swap to
      if (downgraded || opts.texSize === 512 || !face) return;
      downgraded = true;
      const old = face;
      const next = await buildFace(512, Math.min(4, opts.anisotropy), await noiseFields(256));
      if (disposed) return next.all.forEach((x) => x.dispose());
      face = next;
      assign();
      old.all.forEach((x) => x.dispose());
    },
    dispose() {
      disposed = true;
      face?.all.forEach((x) => x.dispose());
      surf?.all.forEach((x) => x.dispose());
      all.forEach((m) => m.dispose());
    },
  };
}
