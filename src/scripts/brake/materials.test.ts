import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal 2D-canvas stub so the texture code runs under Node.
const ctx2d = () => ({
  createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {},
  fillRect() {},
  fillText() {},
  createRadialGradient: () => ({ addColorStop() {} }),
});
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: ctx2d }) };

const { createMaterials } = await import("./materials.ts");

/** Longest stretch the event loop was blocked while `p` settles. */
async function longestBlock(p: Promise<unknown>) {
  let worst = 0;
  let last = performance.now();
  let done = false;
  p.then(() => (done = true));
  while (!done) {
    await new Promise((r) => setTimeout(r, 0));
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
  }
  return worst;
}

test("createMaterials returns immediately; textures arrive via `ready`", async () => {
  const t0 = performance.now();
  const m = createMaterials({ texSize: 1024, anisotropy: 8 });
  assert.ok(performance.now() - t0 < 30, "constructor blocked");
  await m.ready;
  assert.ok(m.rotorFace.map, "face map missing after ready");
  assert.ok(m.hatRust.map, "rust map missing after ready");
  m.dispose();
});

test("texture generation never blocks the main thread for more than 30 ms (desktop size)", async () => {
  const m = createMaterials({ texSize: 1024, anisotropy: 8 });
  const worst = await longestBlock(m.ready);
  assert.ok(worst < 30, `blocked ${worst.toFixed(0)} ms`);
  m.dispose();
});

test("downgradeTextures on a phone-sized set does not rebuild anything", async () => {
  const m = createMaterials({ texSize: 512, anisotropy: 8 });
  await m.ready;
  const face = m.rotorFace.map;
  const cast = m.rotorCast.map;
  const t0 = performance.now();
  await m.downgradeTextures();
  assert.ok(performance.now() - t0 < 5, "phone downgrade did work");
  assert.equal(m.rotorFace.map, face);
  assert.equal(m.rotorCast.map, cast);
  m.dispose();
});

test("downgradeTextures on desktop only rebuilds the rotor-face set", async () => {
  const m = createMaterials({ texSize: 1024, anisotropy: 8 });
  await m.ready;
  const face = m.rotorFace.map;
  const cast = m.rotorCast.map;
  const rust = m.hatRust.map;
  await m.downgradeTextures();
  assert.notEqual(m.rotorFace.map, face, "face not rebuilt");
  assert.equal(m.rotorCast.map, cast, "cast rebuilt needlessly");
  assert.equal(m.hatRust.map, rust, "rust rebuilt needlessly");
  m.dispose();
});
