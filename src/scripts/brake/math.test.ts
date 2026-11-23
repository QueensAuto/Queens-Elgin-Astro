import { test } from "node:test";
import assert from "node:assert/strict";
import { INTRO_MS, introProgress, heatRamp, QualityGovernor } from "./math.ts";

test("introProgress starts at 0 and reaches exactly 1 at INTRO_MS (2500)", () => {
  assert.equal(INTRO_MS, 2500);
  assert.equal(introProgress(0), 0);
  assert.equal(introProgress(2500), 1);
  assert.equal(introProgress(99999), 1);
});

test("introProgress is eased: midpoint lands between 0.3 and 0.7", () => {
  const mid = introProgress(1250);
  assert.ok(mid > 0.3 && mid < 0.7, `mid=${mid}`);
});

test("introProgress is monotonic", () => {
  let prev = -1;
  for (let ms = 0; ms <= 2500; ms += 50) {
    const p = introProgress(ms);
    assert.ok(p >= prev, `not monotonic at ${ms}`);
    prev = p;
  }
});

test("heatRamp(0) emits nothing", () => {
  assert.equal(heatRamp(0).intensity, 0);
});

test("heatRamp(0.35) is a dull red", () => {
  const { r, g } = heatRamp(0.35);
  assert.ok(r > 0 && g < 0.15 * r, `r=${r} g=${g}`);
});

test("heatRamp(1) is orange", () => {
  const { r, g } = heatRamp(1);
  const ratio = g / r;
  assert.ok(ratio >= 0.35 && ratio <= 0.5, `g/r=${ratio}`);
});

test("heatRamp intensity is monotonic", () => {
  let prev = -1;
  for (let h = 0; h <= 1.0001; h += 0.05) {
    const { intensity } = heatRamp(h);
    assert.ok(intensity >= prev, `not monotonic at ${h}`);
    prev = intensity;
  }
});

const slow = (g: QualityGovernor, n: number, ms = 30) => {
  let out: string | null = null;
  for (let i = 0; i < n; i++) out = g.sample(ms);
  return out;
};

test("QualityGovernor steps down bloom → shadows → textures → pixelRatio, then stops", () => {
  const g = new QualityGovernor({ budgetMs: 22, sampleFrames: 60, startWithoutBloom: false });
  for (let i = 0; i < 59; i++) assert.equal(g.sample(30), null);
  assert.equal(g.sample(30), "bloom");
  assert.equal(slow(g, 60), "shadows");
  assert.equal(slow(g, 60), "textures");
  assert.equal(slow(g, 60), "pixelRatio");
  assert.equal(slow(g, 60), null);
  assert.equal(g.level, 4);
});

test("QualityGovernor keeps quality when frames are within budget", () => {
  const g = new QualityGovernor({ budgetMs: 22, sampleFrames: 60, startWithoutBloom: false });
  assert.equal(slow(g, 60, 16), null);
  assert.equal(g.level, 0);
});

test("QualityGovernor skips bloom when starting without it", () => {
  const g = new QualityGovernor({ budgetMs: 22, sampleFrames: 60, startWithoutBloom: true });
  assert.equal(slow(g, 60), "shadows");
});

test("QualityGovernor leaves a 30 Hz-capped display alone (Low Power Mode, Energy Saver)", () => {
  const g = new QualityGovernor({ budgetMs: 22, sampleFrames: 60, startWithoutBloom: false, refreshMs: 33.3 });
  assert.equal(slow(g, 60, 33.4), null);
  assert.equal(slow(g, 60, 34), null);
  assert.equal(g.level, 0);
});

test("QualityGovernor still steps down a 60 Hz display that only manages 30 fps", () => {
  const g = new QualityGovernor({ budgetMs: 22, sampleFrames: 60, startWithoutBloom: false, refreshMs: 16.7 });
  assert.equal(slow(g, 60, 33.4), "bloom");
});

test("QualityGovernor steps down a 30 Hz display that drops to 20 fps", () => {
  const g = new QualityGovernor({ budgetMs: 22, sampleFrames: 60, startWithoutBloom: false, refreshMs: 33.3 });
  assert.equal(slow(g, 60, 50), "bloom");
});
