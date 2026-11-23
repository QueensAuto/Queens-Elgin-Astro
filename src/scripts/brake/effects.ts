/**
 * Heat effects for the brake scene: emissive glow on the friction band,
 * bloom (desktop) or an additive halo (phones / weak GPUs), and a short
 * spray of sparks when braking hard. Owns the per-frame render call.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { heatRamp } from "./math";
import type { BrakeMaterials } from "./materials";
import type { BrakeRig } from "./parts";
import type { Lighting } from "./lighting";

export interface Effects {
  update(dt: number, s: { heat: number; omega: number; pressing: boolean }): void;
  render(): void;
  setBloom(on: boolean): void;
  /** Compile every hot-path shader ahead of time so the first press doesn't hitch. */
  warmUp(): Promise<void>;
  /** MSAA samples on the bloom path's final render target (0 when bloom is off). */
  readonly msaaSamples: number;
  resize(w: number, h: number, pixelRatio: number): void;
  dispose(): void;
}

/** Adds the blurred glow onto the scene and rebuilds alpha so the page shows through. */
const MixShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, tBloom: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      // drop the faint wide haze so the canvas edge never shows as a tinted box
      vec3 glow = max(texture2D(tBloom, vUv).rgb - 0.02, 0.0) * 1.02;
      float a = clamp(base.a + max(glow.r, max(glow.g, glow.b)), 0.0, 1.0);
      gl_FragColor = vec4(base.rgb + glow, a);
    }`,
};

function haloTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  // brightest across the pad sweep (r ≈ 0.66–0.97 of the rotor), soft either side
  g.addColorStop(0.0, "rgba(255,255,255,0)");
  g.addColorStop(0.5, "rgba(255,255,255,0)");
  g.addColorStop(0.66, "rgba(255,255,255,0.55)");
  g.addColorStop(0.8, "rgba(255,255,255,1)");
  g.addColorStop(0.9, "rgba(255,255,255,0.6)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

const SPARKS = 48;

export function createEffects(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  rig: BrakeRig,
  mats: BrakeMaterials,
  lighting: Lighting,
  opts: { bloom: boolean; sparks: boolean },
): Effects {
  const heatColor = new THREE.Color();

  // ------------------------------------------------------------ bloom
  // Selective: a second render where only the hot friction band (and sparks)
  // emit light and everything else is black, blurred, then added on top.
  let bloomOn = opts.bloom;
  let bloomComposer: EffectComposer | null = null;
  let finalComposer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const glowFace = new THREE.MeshBasicMaterial({ map: mats.rotorFace.emissiveMap, color: 0x000000 });
  const glowCast = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const saved = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();
  const [faceMat, castMat] = mats.heatMaterials;
  function swapForBloom() {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!(mesh as any).isMesh) return;
      saved.set(mesh, mesh.material);
      const m = mesh.material;
      if (Array.isArray(m)) mesh.material = m.map((x) => (x === faceMat ? glowFace : x === castMat ? glowCast : black));
      else mesh.material = m === faceMat ? glowFace : m === castMat ? glowCast : black;
    });
    lighting.contactShadow.visible = false;
  }
  function restore() {
    saved.forEach((m, o) => ((o as THREE.Mesh).material = m));
    saved.clear();
    lighting.contactShadow.visible = true;
  }
  function buildComposer() {
    const size = renderer.getSize(new THREE.Vector2());
    bloomComposer = new EffectComposer(renderer);
    bloomComposer.renderToScreen = false;
    bloomComposer.addPass(new RenderPass(scene, camera, undefined, new THREE.Color(0x000000), 0));
    bloomPass = new UnrealBloomPass(size, 0, 0.22, 0);
    bloomComposer.addPass(bloomPass);
    // own multisampled target: composer targets lose the canvas' antialiasing
    const pr = renderer.getPixelRatio();
    finalComposer = new EffectComposer(
      renderer,
      new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 }),
    );
    finalComposer.addPass(new RenderPass(scene, camera, undefined, new THREE.Color(0x000000), 0));
    const mix = new ShaderPass(MixShader);
    mix.uniforms.tBloom.value = bloomComposer.renderTarget2.texture;
    finalComposer.addPass(mix);
    finalComposer.addPass(new OutputPass());
  }
  if (bloomOn) buildComposer();

  // ------------------------------------------------------- halo fallback
  const haloTex = haloTexture();
  const haloMat = new THREE.MeshBasicMaterial({
    map: haloTex,
    color: 0xff5a1f,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), haloMat);
  halo.position.z = 0.152; // just off the outboard friction face
  halo.visible = false;
  rig.assembly.add(halo);

  // ------------------------------------------------------------ sparks
  const sparkPos = new Float32Array(SPARKS * 6);
  const sparkCol = new Float32Array(SPARKS * 6);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
  const sparkMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const sparkLines = new THREE.LineSegments(sparkGeo, sparkMat);
  sparkLines.frustumCulled = false;
  sparkLines.visible = false;
  scene.add(sparkLines);
  const sparks = Array.from({ length: SPARKS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1 }));
  let emitCarry = 0;
  let nextSpark = 0;
  const origin = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  function emit(omega: number) {
    const s = sparks[nextSpark];
    nextSpark = (nextSpark + 1) % SPARKS;
    rig.padContact.getWorldPosition(origin);
    // rotor turns clockwise seen from +Z: surface velocity at the contact point
    const a = Math.atan2(rig.padContact.position.y, rig.padContact.position.x);
    tangent.set(Math.sin(a), -Math.cos(a), 0.15 + Math.random() * 0.25).transformDirection(rig.assembly.matrixWorld);
    s.p.copy(origin);
    s.v.copy(tangent).multiplyScalar(1.2 + omega * 0.18 + Math.random() * 0.9);
    s.v.x += (Math.random() - 0.5) * 0.5;
    s.v.y += (Math.random() - 0.5) * 0.5;
    s.max = s.life = 0.22 + Math.random() * 0.2;
  }

  function updateSparks(dt: number, emitting: boolean, omega: number) {
    if (emitting) {
      emitCarry += dt * 110;
      while (emitCarry >= 1) {
        emit(omega);
        emitCarry -= 1;
      }
    } else emitCarry = 0;
    let any = false;
    for (let i = 0; i < SPARKS; i++) {
      const s = sparks[i];
      const o = i * 6;
      if (s.life <= 0) {
        sparkPos.fill(0, o, o + 6);
        sparkCol.fill(0, o, o + 6);
        continue;
      }
      any = true;
      s.life -= dt;
      s.v.y -= 3.2 * dt;
      s.v.multiplyScalar(Math.exp(-dt * 1.5));
      s.p.addScaledVector(s.v, dt);
      const k = Math.max(0, s.life / s.max);
      sparkPos[o] = s.p.x;
      sparkPos[o + 1] = s.p.y;
      sparkPos[o + 2] = s.p.z;
      sparkPos[o + 3] = s.p.x - s.v.x * 0.06;
      sparkPos[o + 4] = s.p.y - s.v.y * 0.06;
      sparkPos[o + 5] = s.p.z - s.v.z * 0.06;
      // head white-hot → tail orange, fading with life
      sparkCol[o] = 1.6 * k;
      sparkCol[o + 1] = 1.0 * k;
      sparkCol[o + 2] = 0.55 * k;
      sparkCol[o + 3] = 0.9 * k;
      sparkCol[o + 4] = 0.28 * k;
      sparkCol[o + 5] = 0.02 * k;
    }
    sparkLines.visible = any;
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;
  }

  let lastHeat = 0;

  return {
    update(dt, { heat, omega, pressing }) {
      lastHeat = heat;
      const r = heatRamp(heat);
      heatColor.setRGB(r.r, r.g, r.b);
      const [face, cast] = mats.heatMaterials;
      face.emissive.copy(heatColor);
      face.emissiveIntensity = r.intensity;
      cast.emissive.copy(heatColor);
      cast.emissiveIntensity = r.intensity * 0.55;
      lighting.heatLight.color.copy(heatColor);
      lighting.heatLight.intensity = Math.pow(heat, 1.3) * 5;
      lighting.heatLight.position.copy(rig.dir).multiplyScalar(0.85).setZ(0.9);

      // hot iron darkens and stops mirroring the room; the glow takes over
      faceMat.color.setScalar(1 - 0.6 * heat);
      glowFace.color.copy(heatColor).multiplyScalar(r.intensity * 0.8);
      glowCast.color.copy(heatColor).multiplyScalar(r.intensity * 0.3);
      if (bloomPass) bloomPass.strength = Math.min(0.85, 0.2 + heat * 0.7);
      halo.visible = !bloomOn && heat > 0.01;
      haloMat.color.copy(heatColor);
      haloMat.opacity = Math.min(0.6, r.intensity * 0.28);

      if (opts.sparks) updateSparks(dt, pressing && omega > 0.45, omega);
    },
    render() {
      if (bloomOn && bloomComposer && finalComposer && lastHeat > 0.01) {
        swapForBloom();
        try {
          bloomComposer.render();
        } finally {
          restore();
        }
        finalComposer.render();
      } else renderer.render(scene, camera);
    },
    // Runs before the first visible frame (the poster is still up). compileAsync uses
    // KHR_parallel_shader_compile where available, so most of this stays off the main thread.
    async warmUp() {
      halo.visible = true;
      sparkLines.visible = true;
      try {
        await renderer.compileAsync(scene, camera);
      } finally {
        halo.visible = false;
        sparkLines.visible = false;
      }
      if (bloomOn && bloomComposer && finalComposer) {
        swapForBloom();
        try {
          await renderer.compileAsync(scene, camera);
          bloomComposer.render(); // compiles the blur / composite passes
        } finally {
          restore();
        }
        finalComposer.render();
      }
    },
    get msaaSamples() {
      return finalComposer ? finalComposer.renderTarget1.samples : 0;
    },
    setBloom(on) {
      bloomOn = on;
      if (on && !bloomComposer) buildComposer();
    },
    resize(w, h, pixelRatio) {
      for (const c of [bloomComposer, finalComposer]) {
        if (!c) continue;
        c.setPixelRatio(pixelRatio);
        c.setSize(w, h);
      }
    },
    dispose() {
      bloomComposer?.dispose();
      finalComposer?.dispose();
      bloomPass?.dispose();
      black.dispose();
      glowFace.dispose();
      glowCast.dispose();
      haloTex.dispose();
      haloMat.dispose();
      halo.geometry.dispose();
      sparkGeo.dispose();
      sparkMat.dispose();
    },
  };
}
