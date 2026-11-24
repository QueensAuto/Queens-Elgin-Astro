/**
 * Lighting for the brake scene: a procedural "workshop" environment (long
 * softbox strips give metal its streaky highlights), a shadow-casting key,
 * a cool brand-blue rim, the heat point light and a soft contact shadow.
 * Zero downloads.
 */
import * as THREE from "three";
import type { BrakeRig } from "./parts";

export interface Lighting {
  key: THREE.DirectionalLight;
  heatLight: THREE.PointLight;
  contactShadow: THREE.Mesh;
  setShadows(on: boolean): void;
  dispose(): void;
}

function workshopScene() {
  const env = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const room = new THREE.BoxGeometry(14, 9, 14);
  const roomMat = new THREE.MeshStandardMaterial({ color: 0x343840, side: THREE.BackSide, roughness: 1, metalness: 0 });
  disposables.push(room, roomMat);
  env.add(new THREE.Mesh(room, roomMat));
  env.add(new THREE.AmbientLight(0xffffff, 0.6));

  const panel = (w: number, h: number, color: THREE.ColorRepresentation, strength: number, pos: [number, number, number], look: [number, number, number] = [0, 0, 0]) => {
    const g = new THREE.PlaneGeometry(w, h);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), side: THREE.DoubleSide });
    disposables.push(g, m);
    const p = new THREE.Mesh(g, m);
    p.position.set(...pos);
    p.lookAt(...look);
    env.add(p);
  };
  // big soft key behind the camera: what the outboard faces mirror back at the viewer
  panel(7, 3.2, 0xf4f7fb, 2.6, [0.8, 1.6, 6.8]);
  // long overhead strips (the classic studio streaks on machined metal)
  panel(9, 0.45, 0xffffff, 8, [0, 4.2, 2.4]);
  panel(9, 0.3, 0xffffff, 4, [0, 4.2, -1.2]);
  // tall strips camera-right and front-left
  panel(0.5, 6, 0xffffff, 6, [5.5, 0.6, 3.2]);
  panel(0.4, 5, 0xffffff, 3.5, [-4.5, 0.4, 5]);
  // neutral fill camera-left
  panel(3.5, 3.5, 0xf2ece6, 1.2, [-5.5, 0.2, 2]);
  // cool rim behind (brand blue)
  panel(5, 2, 0x6cafde, 3.2, [-2.5, 1.2, -6]);
  // faint floor bounce
  panel(8, 8, 0x2a2f38, 1, [0, -4.4, 0], [0, 0, 0]);
  return { env, dispose: () => disposables.forEach((d) => d.dispose()) };
}

function contactShadowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(0,0,0,0.85)");
  g.addColorStop(0.35, "rgba(0,0,0,0.5)");
  g.addColorStop(0.7, "rgba(0,0,0,0.12)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export function setupLighting(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  rig: BrakeRig,
  opts: { coarse: boolean },
): Lighting {
  // ---- environment
  const pmrem = new THREE.PMREMGenerator(renderer);
  const ws = workshopScene();
  const envTex = pmrem.fromScene(ws.env, 0.03).texture;
  ws.dispose();
  pmrem.dispose();
  scene.environment = envTex;
  scene.environmentIntensity = 2.2;

  // ---- shadows
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const key = new THREE.DirectionalLight(0xfff4e8, 2.0);
  key.position.set(2.6, 4.2, 5);
  key.castShadow = true;
  const size = opts.coarse ? 512 : 1024;
  key.shadow.mapSize.set(size, size);
  const cam = key.shadow.camera;
  cam.left = cam.bottom = -2.2;
  cam.right = cam.top = 2.2;
  cam.near = 1;
  cam.far = 14;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight(0x6cafde, 1.8);
  rim.position.set(-4, 1.5, -3);
  scene.add(rim);

  const heatLight = new THREE.PointLight(0xff5a1f, 0, 4, 2);
  scene.add(heatLight);

  // ---- contact shadow (stays level; the assembly rotates above it)
  const shadowTex = contactShadowTexture();
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 3.2),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55, toneMapped: false }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = -1.35;
  contactShadow.scale.set(1, 0.55, 1);
  contactShadow.renderOrder = -1;
  scene.add(contactShadow);

  function setShadows(on: boolean) {
    if (renderer.shadowMap.enabled === on) return;
    renderer.shadowMap.enabled = on;
    key.castShadow = on;
    // shadow on/off changes shader programs
    scene.traverse((o: any) => {
      const m = o.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x: THREE.Material) => (x.needsUpdate = true));
    });
  }

  return {
    key,
    heatLight,
    contactShadow,
    setShadows,
    dispose() {
      envTex.dispose();
      shadowTex.dispose();
      contactShadow.geometry.dispose();
      (contactShadow.material as THREE.Material).dispose();
      key.shadow.map?.dispose();
    },
  };
}
