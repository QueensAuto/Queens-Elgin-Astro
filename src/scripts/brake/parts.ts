/**
 * Geometry for a stock front brake: plain vented one-piece rotor, single-piston
 * floating caliper on an anchor bracket, two pads, hub with studs, lug nuts and
 * a partial dust shield. Rotor axis = Z, outboard face (+Z) toward the camera.
 */
import * as THREE from "three";
import type { BrakeMaterials } from "./materials";
import { decodeMeshPack } from "./mesh-pack";

export type AnchorKey = "rotor" | "pads" | "caliper" | "hub";

export interface BrakeRig {
  assembly: THREE.Group;
  spin: THREE.Group;
  rotor: THREE.Group;
  hub: THREE.Group;
  nuts: THREE.Group;
  caliper: THREE.Group;
  /** Procedural caliper body, bracket and guide pins (swapped out by useCaliperAsset). */
  caliperBody: THREE.Group;
  padIn: THREE.Group;
  padOut: THREE.Group;
  shield: THREE.Group;
  dir: THREE.Vector3;
  anchors: Record<AnchorKey, THREE.Object3D>;
  padContact: THREE.Object3D;
  shadowCasters: THREE.Mesh[];
}

/** Caliper position angle on the rotor (upper right as seen from the camera). */
export const THETA = 1.05;
const PAD_HALF = 0.55; // pads fill the big caliper's window
/** Angular half-span of the caliper body around THETA (detailed model at size 1.12). */
const CALIPER_HALF = 0.9;
const RING_T = 0.075; // friction ring thickness
const RING_Z = 0.1125; // ring centre offset → faces at ±0.15
const FACE_Z = RING_Z + RING_T / 2;

// ---------------------------------------------------------------- helpers

function ringGeo(ro: number, ri: number, depth: number, holes: Array<[number, number, number]> = [], bevel = 0.006, seg = 96) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, ro, 0, Math.PI * 2, false);
  const inner = new THREE.Path();
  inner.absarc(0, 0, ri, 0, Math.PI * 2, true);
  shape.holes.push(inner);
  for (const [x, y, r] of holes) {
    const h = new THREE.Path();
    h.absarc(x, y, r, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: seg,
  });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  return g;
}

/** Annular sector extruded along Z, with soft (cast-looking) bevels. */
function sectorGeo(r1: number, r2: number, a0: number, a1: number, depth: number, bevel = 0.02, segs = 4) {
  const s = new THREE.Shape();
  s.moveTo(r1 * Math.cos(a0), r1 * Math.sin(a0));
  s.lineTo(r2 * Math.cos(a0), r2 * Math.sin(a0));
  s.absarc(0, 0, r2, a0, a1, false);
  s.lineTo(r1 * Math.cos(a1), r1 * Math.sin(a1));
  s.absarc(0, 0, r1, a1, a0, true);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, depth - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: segs,
    curveSegments: 40,
  });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  g.computeVertexNormals();
  return g;
}

/** Pad friction block: sector with chamfered leading/trailing ends. */
function padBlockGeo(r1: number, r2: number, a0: number, a1: number, depth: number, chamfer: number) {
  const s = new THREE.Shape();
  const at = (r: number, a: number) => new THREE.Vector2(r * Math.cos(a), r * Math.sin(a));
  const c = chamfer;
  const p = [at(r1, a0 + c * 0.6), at(r2 - c, a0), at(r2, a0 + c), at(r2, a1 - c), at(r2 - c, a1), at(r1, a1 - c * 0.6)];
  s.moveTo(p[0].x, p[0].y);
  s.lineTo(p[1].x, p[1].y);
  s.lineTo(p[2].x, p[2].y);
  s.absarc(0, 0, r2, a0 + c, a1 - c, false);
  s.lineTo(p[4].x, p[4].y);
  s.lineTo(p[5].x, p[5].y);
  s.absarc(0, 0, r1, a1 - c * 0.6, a0 + c * 0.6, true);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: depth - 0.006,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 1,
    curveSegments: 32,
  });
  g.translate(0, 0, -(depth - 0.006) / 2);
  return g;
}

/** Cylinder whose axis is Z (three's cylinders are Y-aligned). */
function cylZ(r: number, h: number, seg = 32, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, h, seg);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Lathe around Z from (radius, z) pairs. */
function latheZ(pts: Array<[number, number]>, seg = 64, phiStart = 0, phiLength = Math.PI * 2) {
  const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg, phiStart, phiLength);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Point at radius r, angle a, depth z. */
const polar = (r: number, a: number, z = 0) => new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), z);

// ------------------------------------------------------------------ build

export function buildBrake(m: BrakeMaterials): BrakeRig {
  const casters: THREE.Mesh[] = [];
  const mesh = (g: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], cast = true) => {
    const x = new THREE.Mesh(g, mat);
    x.receiveShadow = true;
    if (cast) {
      x.castShadow = true;
      casters.push(x);
    }
    return x;
  };

  const assembly = new THREE.Group();
  const spin = new THREE.Group();
  assembly.add(spin);
  const dir = new THREE.Vector3(Math.cos(THETA), Math.sin(THETA), 0);

  // ---------------------------------------------------------------- rotor
  const rotor = new THREE.Group();
  spin.add(rotor);
  // ExtrudeGeometry groups: 0 = caps (machined friction faces), 1 = sides (as-cast edges)
  const faceMats = [m.rotorFace, m.rotorCast];
  const ringOut = mesh(ringGeo(1.0, 0.6, RING_T), faceMats);
  ringOut.position.z = RING_Z;
  const ringIn = mesh(ringGeo(1.0, 0.6, RING_T), faceMats);
  ringIn.position.z = -RING_Z;
  rotor.add(ringOut, ringIn);

  // curved cooling vanes between the rings
  const vane = (() => {
    const s = new THREE.Shape();
    const steps = 10;
    const r0 = 0.615;
    const r1 = 0.985;
    const curve = 0.32;
    const th = 0.03;
    const side = (sign: number) => {
      const out: THREE.Vector2[] = [];
      for (let k = 0; k <= steps; k++) {
        const r = r0 + ((r1 - r0) * k) / steps;
        const a = curve * ((r - r0) / (r1 - r0)) ** 1.3 + (sign * th) / (2 * r);
        out.push(new THREE.Vector2(r * Math.cos(a), r * Math.sin(a)));
      }
      return out;
    };
    const left = side(1);
    const right = side(-1).reverse();
    s.setFromPoints([...left, ...right]);
    const g = new THREE.ExtrudeGeometry(s, { depth: 2 * (RING_Z - RING_T / 2) + 0.01, bevelEnabled: false });
    g.translate(0, 0, -(RING_Z - RING_T / 2) - 0.005);
    return g;
  })();
  const VANES = 37;
  const vanes = new THREE.InstancedMesh(vane, m.rotorCast, VANES);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < VANES; i++) {
    dummy.rotation.set(0, 0, (i / VANES) * Math.PI * 2);
    dummy.updateMatrix();
    vanes.setMatrixAt(i, dummy.matrix);
  }
  vanes.castShadow = vanes.receiveShadow = true;
  rotor.add(vanes);

  // hat: rises from the outboard ring toward the camera
  const HAT_FACE_Z = 0.42;
  rotor.add(
    mesh(
      latheZ(
        [
          [0.605, FACE_Z - 0.01],
          [0.6, FACE_Z + 0.02],
          [0.565, FACE_Z + 0.06],
          [0.53, FACE_Z + 0.12],
          [0.518, HAT_FACE_Z - 0.06],
          [0.515, HAT_FACE_Z - 0.02],
        ],
        96,
      ),
      m.hatRust,
    ),
  );
  const lugHoles: Array<[number, number, number]> = [];
  const lugAngle = (i: number) => (i / 5) * Math.PI * 2 + Math.PI / 2;
  for (let i = 0; i < 5; i++) lugHoles.push([Math.cos(lugAngle(i)) * 0.3, Math.sin(lugAngle(i)) * 0.3, 0.034]);
  const hatFace = mesh(ringGeo(0.525, 0.14, 0.05, lugHoles, 0.012, 96), m.hatRust);
  hatFace.position.z = HAT_FACE_Z;
  rotor.add(hatFace);

  // ------------------------------------------------------------------ hub
  const hub = new THREE.Group();
  spin.add(hub);
  const barrel = mesh(cylZ(0.16, 0.72, 48), m.bracket);
  barrel.position.z = -0.02;
  const flange = mesh(latheZ([[0.13, 0.33], [0.4, 0.33], [0.41, 0.345], [0.41, 0.375], [0.38, 0.39], [0.13, 0.39]], 64), m.bracket);
  const pilot = mesh(latheZ([[0, 0.53], [0.1, 0.53], [0.125, 0.51], [0.13, 0.48], [0.13, 0.38]], 48), m.zinc);
  hub.add(barrel, flange, pilot);
  for (let i = 0; i < 5; i++) {
    const a = lugAngle(i);
    const knurl = mesh(cylZ(0.031, 0.06, 14), m.zinc);
    knurl.position.copy(polar(0.3, a, 0.41));
    const shaft = mesh(cylZ(0.024, 0.3, 16), m.zinc);
    shaft.position.copy(polar(0.3, a, 0.585));
    hub.add(knurl, shaft);
  }

  // ------------------------------------------------------------- lug nuts
  const nuts = new THREE.Group();
  spin.add(nuts);
  const nutSeat = latheZ([[0.03, 0.0], [0.034, 0.0], [0.056, 0.032], [0.056, 0.036]], 32);
  const nutHex = cylZ(0.06, 0.07, 6);
  nutHex.translate(0, 0, 0.071);
  const nutDome = latheZ([[0.056, 0.106], [0.052, 0.12], [0.038, 0.135], [0.0, 0.142]], 32);
  for (let i = 0; i < 5; i++) {
    const a = lugAngle(i);
    const nut = new THREE.Group();
    nut.add(mesh(nutSeat, m.chrome), mesh(nutHex, m.chrome), mesh(nutDome, m.chrome));
    nut.position.copy(polar(0.3, a, HAT_FACE_Z + 0.025));
    nut.rotation.z = a;
    nuts.add(nut);
  }

  // ---------------------------------------------------------- dust shield
  const shield = new THREE.Group();
  assembly.add(shield);
  const gapHalf = CALIPER_HALF + 0.05; // opening around the caliper
  shield.add(
    mesh(
      latheZ(
        [
          [0.24, -0.33],
          [0.7, -0.33],
          [0.98, -0.3],
          [1.06, -0.26],
          [1.08, -0.2],
        ],
        72,
        THETA + Math.PI / 2 + gapHalf,
        Math.PI * 2 - gapHalf * 2,
      ),
      m.shield,
    ),
  );

  // ------------------------------------------------- caliper + bracket
  const caliper = new THREE.Group();
  assembly.add(caliper);
  const span = PAD_HALF + 0.02;
  const A0 = THETA - span;
  const A1 = THETA + span;
  // procedural floating-caliper body + bracket; swapped for the detailed body when it loads
  const caliperBody = new THREE.Group();
  caliper.add(caliperBody);

  // anchor bracket: two arms straddling the rotor edge at the pad ends + inboard tie bar
  for (const a of [THETA - (PAD_HALF + 0.105), THETA + (PAD_HALF + 0.105)]) {
    const w = 0.055;
    const bridgeArm = mesh(sectorGeo(1.005, 1.075, a - w, a + w, 0.5, 0.015, 2), m.bracket);
    const inner = mesh(sectorGeo(0.6, 1.075, a - w, a + w, 0.07, 0.015, 2), m.bracket);
    inner.position.z = -0.215;
    const tab = mesh(sectorGeo(0.79, 1.075, a - w * 0.8, a + w * 0.8, 0.05, 0.012, 2), m.bracket);
    tab.position.z = 0.205;
    caliperBody.add(bridgeArm, inner, tab);
    const bolt = mesh(cylZ(0.045, 0.06, 6), m.zinc);
    bolt.position.copy(polar(0.66, a, -0.28));
    caliperBody.add(bolt);
  }
  const tie = mesh(sectorGeo(0.56, 0.68, THETA - (PAD_HALF + 0.16), THETA + (PAD_HALF + 0.16), 0.07, 0.02, 3), m.bracket);
  tie.position.z = -0.215;
  caliperBody.add(tie);

  // caliper body: inboard housing, bridge over the rotor, outboard fingers
  const housing = mesh(sectorGeo(0.66, 1.13, A0 + 0.03, A1 - 0.03, 0.15, 0.045, 5), m.caliperPaint);
  housing.position.z = -0.315;
  const bridge = mesh(sectorGeo(1.07, 1.19, A0 + 0.05, A1 - 0.05, 0.72, 0.045, 5), m.caliperPaint);
  bridge.position.z = -0.02;
  const fingers = mesh(sectorGeo(0.72, 1.15, A0 + 0.07, A1 - 0.07, 0.1, 0.04, 5), m.caliperPaint);
  fingers.position.z = 0.285;
  caliperBody.add(housing, bridge, fingers);
  // finger notch (the slot between the two fingers on real floating calipers)
  const notch = mesh(sectorGeo(0.705, 0.82, THETA - 0.045, THETA + 0.045, 0.104, 0.004, 1), m.padBacking, false);
  notch.position.z = 0.285;
  caliperBody.add(notch);
  // piston boss on the back of the housing
  const boss = mesh(
    latheZ([[0, -0.53], [0.12, -0.53], [0.165, -0.51], [0.185, -0.47], [0.19, -0.38], [0.19, -0.34]], 48),
    m.caliperPaint,
  );
  boss.position.copy(polar(0.835, THETA));
  caliperBody.add(boss);
  // guide pin bosses + rubber boots
  for (const a of [A0 - 0.035, A1 + 0.035]) {
    const pinBoss = mesh(cylZ(0.062, 0.2, 24), m.caliperPaint);
    pinBoss.position.copy(polar(1.1, a, -0.33));
    const boot = mesh(
      latheZ([[0.05, -0.2], [0.062, -0.19], [0.048, -0.175], [0.062, -0.16], [0.048, -0.145], [0.06, -0.13], [0.045, -0.12]], 24),
      m.rubber,
    );
    boot.position.copy(polar(1.1, a));
    const pinHead = mesh(cylZ(0.04, 0.05, 6), m.zinc);
    pinHead.position.copy(polar(1.1, a, -0.455));
    caliperBody.add(pinBoss, boot, pinHead);
  }
  // bleeder screw with rubber cap, on top of the housing
  const bleedPos = polar(1.14, THETA - 0.12, -0.36);
  const bleeder = mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.11, 12), m.zinc);
  bleeder.position.copy(bleedPos);
  bleeder.rotation.z = THETA - 0.12 - Math.PI / 2;
  const bleedCap = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 16), m.rubber);
  bleedCap.position.copy(polar(1.2, THETA - 0.12, -0.36));
  bleedCap.rotation.z = bleeder.rotation.z;
  bleeder.name = "bleeder";
  bleedCap.name = "bleedCap";
  caliper.add(bleeder, bleedCap);
  // banjo bolt + hose leaving the back of the housing
  const banjoPos = polar(1.0, THETA + 0.14, -0.43);
  const banjo = mesh(cylZ(0.055, 0.05, 24), m.zinc);
  banjo.position.copy(banjoPos);
  const banjoHead = mesh(cylZ(0.042, 0.045, 6), m.zinc);
  banjoHead.position.copy(banjoPos).add(new THREE.Vector3(0, 0, -0.045));
  caliper.add(banjo, banjoHead);
  const hose = new THREE.CatmullRomCurve3([
    banjoPos.clone().add(polar(0.05, THETA + 0.14)),
    banjoPos.clone().add(polar(0.22, THETA + 0.25, -0.05)),
    banjoPos.clone().add(polar(0.4, THETA + 0.5, -0.12)),
    banjoPos.clone().add(polar(0.55, THETA + 0.85, -0.22)),
  ]);
  caliper.add(mesh(new THREE.TubeGeometry(hose, 48, 0.034, 12), m.rubber));
  // QUEENS mark on the outboard fingers
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.145), m.brandMark);
  plate.name = "brandMark";
  plate.position.copy(polar(0.98, THETA, 0.285 + 0.051));
  plate.rotation.z = THETA - Math.PI / 2;
  caliper.add(plate);

  // ------------------------------------------------------------------ pads
  function makePad(sign: 1 | -1, wearTab: boolean) {
    const g = new THREE.Group();
    const a0 = THETA - PAD_HALF;
    const a1 = THETA + PAD_HALF;
    const slot = 0.012;
    const FR_T = 0.045;
    const frZ = sign * (FACE_Z + 0.015 + FR_T / 2);
    for (const [s0, s1] of [[a0, THETA - slot], [THETA + slot, a1]] as const) {
      const fr = mesh(padBlockGeo(0.665, 0.965, s0, s1, FR_T, 0.035), m.padFriction);
      fr.position.z = frZ;
      g.add(fr);
    }
    const backZ = sign * (FACE_Z + 0.015 + FR_T + 0.011);
    const backing = mesh(sectorGeo(0.645, 0.985, a0 - 0.02, a1 + 0.02, 0.022, 0.004, 1), m.padBacking);
    backing.position.z = backZ;
    g.add(backing);
    for (const a of [a0 - 0.075, a1 + 0.075]) {
      const ear = mesh(sectorGeo(0.83, 0.92, a - 0.06, a + 0.06, 0.022, 0.004, 1), m.padBacking);
      ear.position.z = backZ;
      g.add(ear);
    }
    const shim = mesh(sectorGeo(0.66, 0.97, a0 + 0.02, a1 - 0.02, 0.006, 0.001, 1), m.bracket, false); // coated anti-squeal shim
    shim.position.z = backZ + sign * 0.014;
    g.add(shim);
    if (wearTab) {
      const tab = mesh(new THREE.BoxGeometry(0.012, 0.06, 0.05), m.zinc);
      tab.position.copy(polar(0.94, a1 - 0.01, backZ - sign * 0.025));
      tab.rotation.z = a1;
      g.add(tab);
    }
    return g;
  }
  const padOut = makePad(1, false);
  const padIn = makePad(-1, true);
  assembly.add(padOut, padIn);

  // -------------------------------------------------------------- anchors
  const mk = (parent: THREE.Object3D, p: THREE.Vector3) => {
    const o = new THREE.Object3D();
    o.position.copy(p);
    parent.add(o);
    return o;
  };
  const anchors: Record<AnchorKey, THREE.Object3D> = {
    rotor: mk(assembly, new THREE.Vector3(-0.86, -0.34, FACE_Z)),
    caliper: mk(caliper, polar(1.15, THETA, 0.3)),
    pads: mk(padOut, polar(0.97, THETA - 0.25, 0.22)),
    hub: mk(hub, new THREE.Vector3(0, -0.2, -0.3)),
  };
  // just past the caliper's trailing edge (rotor turns clockwise): spark origin
  const padContact = mk(assembly, polar(0.93, THETA - CALIPER_HALF - 0.05, FACE_Z + 0.02));

  return { assembly, spin, rotor, hub, nuts, caliper, caliperBody, padIn, padOut, shield, dir, anchors, padContact, shadowCasters: casters };
}

/**
 * Swap the procedural caliper body for the detailed cast body (CC0 model, built
 * by tools/blender/export-caliper.py). The geometry is authored with radial = +Y,
 * so it is turned to the caliper angle. It is a fixed caliper that bolts straight
 * to the knuckle, so the floating caliper's bracket and guide pins are hidden too.
 */
export function useCaliperAsset(rig: BrakeRig, geo: THREE.BufferGeometry, m: BrakeMaterials) {
  const hidden = new Set<THREE.Object3D>();
  rig.caliperBody.traverse((o) => hidden.add(o));
  rig.caliperBody.visible = false;
  rig.shadowCasters = rig.shadowCasters.filter((x) => !hidden.has(x));

  const body = new THREE.Mesh(geo, m.caliperPaint);
  body.name = "caliperAsset";
  body.rotation.z = THETA - Math.PI / 2;
  body.castShadow = body.receiveShadow = true;
  rig.caliper.add(body);
  rig.shadowCasters.push(body);

  // sit the QUEENS mark on the outboard face of the new body
  geo.computeBoundingBox();
  const plate = rig.caliper.getObjectByName("brandMark");
  if (plate && geo.boundingBox) plate.position.z = geo.boundingBox.max.z + 0.004;

  // bleeder screw: out of the top of the inboard half, pointing radially
  const a = THETA - 0.1;
  rig.caliper.getObjectByName("bleeder")?.position.copy(polar(1.25, a, -0.24));
  rig.caliper.getObjectByName("bleedCap")?.position.copy(polar(1.31, a, -0.24));
  for (const n of ["bleeder", "bleedCap"]) {
    const o = rig.caliper.getObjectByName(n);
    if (o) o.rotation.z = a - Math.PI / 2;
  }
}

/** Fetch + decode the caliper mesh pack. Resolves null on any failure (procedural body stays). */
export async function loadCaliperGeometry(url: string): Promise<THREE.BufferGeometry | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const [mesh] = decodeMeshPack(await res.arrayBuffer());
    if (!mesh) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    return g;
  } catch {
    return null;
  }
}
