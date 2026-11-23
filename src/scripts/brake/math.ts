/**
 * Pure helpers for the brake scene (no three.js, no DOM) so they can be
 * unit-tested with `node --test`.
 */

/** Wall-clock length of the intro camera move + assembly. */
export const INTRO_MS = 2500;

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 0 → 1 eased progress of the intro, driven by real elapsed time. */
export function introProgress(elapsedMs: number): number {
  if (elapsedMs >= INTRO_MS) return 1;
  return smoothstep(clamp01(elapsedMs / INTRO_MS));
}

/**
 * Emissive colour (linear RGB) and intensity for hot cast iron.
 * Low heat: dull cherry red. Full heat: orange.
 */
export function heatRamp(heat: number): { r: number; g: number; b: number; intensity: number } {
  const h = clamp01(heat);
  const t = clamp01((h - 0.35) / 0.65);
  return {
    r: 0.6 + 0.4 * t,
    g: 0.03 + 0.39 * Math.pow(t, 1.5),
    b: 0.06 * t * t,
    intensity: Math.pow(h, 1.6) * 2.4,
  };
}

export type QualityStep = "bloom" | "shadows" | "textures" | "pixelRatio";
const STEPS: QualityStep[] = ["bloom", "shadows", "textures", "pixelRatio"];

/** Watches frame times and says which effect to drop next when a device can't keep up. */
export class QualityGovernor {
  private budgetMs: number;
  private sampleFrames: number;
  private queue: QualityStep[];
  private sum = 0;
  private count = 0;
  private taken = 0;

  /**
   * refreshMs: the display's own frame interval. A 30 Hz-capped screen (Low Power
   * Mode, Energy Saver) delivers ~33 ms frames even when idle, so the budget is
   * never tighter than 1.35 × that.
   */
  constructor(opts: { budgetMs: number; sampleFrames: number; startWithoutBloom: boolean; refreshMs?: number }) {
    this.budgetMs = Math.max(opts.budgetMs, (opts.refreshMs ?? 1000 / 60) * 1.35);
    this.sampleFrames = opts.sampleFrames;
    this.queue = STEPS.filter((s) => !(opts.startWithoutBloom && s === "bloom"));
  }

  get level(): number {
    return this.taken;
  }

  sample(frameMs: number): QualityStep | null {
    this.sum += frameMs;
    this.count += 1;
    if (this.count < this.sampleFrames) return null;
    const mean = this.sum / this.count;
    this.sum = 0;
    this.count = 0;
    if (mean <= this.budgetMs) return null;
    const next = this.queue.shift();
    if (!next) return null;
    this.taken += 1;
    return next;
  }
}
