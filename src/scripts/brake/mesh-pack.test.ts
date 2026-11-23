import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeMeshPack, encodeMeshPack, type MeshPackMesh } from "./mesh-pack.ts";

const tri: MeshPackMesh = {
  name: "body",
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, -0.5]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0.6, 0.8]),
  uvs: new Float32Array([0, 0, 1, 0, 0.25, 1]),
  indices: new Uint32Array([0, 1, 2]),
};

test("mesh pack round-trips names, indices and topology", () => {
  const [m] = decodeMeshPack(encodeMeshPack([tri]));
  assert.equal(m.name, "body");
  assert.deepEqual(Array.from(m.indices), [0, 1, 2]);
  assert.equal(m.positions.length, 9);
});

test("quantized positions stay within 1/30000 of the bounding box", () => {
  const [m] = decodeMeshPack(encodeMeshPack([tri]));
  for (let i = 0; i < 9; i++) assert.ok(Math.abs(m.positions[i] - tri.positions[i]) < 1.5 / 30000, `pos ${i}`);
});

test("normals come back unit length and close to the source", () => {
  const [m] = decodeMeshPack(encodeMeshPack([tri]));
  for (let v = 0; v < 3; v++) {
    const [x, y, z] = [m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2]];
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-3);
    assert.ok(Math.abs(x - tri.normals[v * 3]) < 0.02 && Math.abs(y - tri.normals[v * 3 + 1]) < 0.02 && Math.abs(z - tri.normals[v * 3 + 2]) < 0.02);
  }
});

test("UVs survive within 1/60000", () => {
  const [m] = decodeMeshPack(encodeMeshPack([tri]));
  for (let i = 0; i < 6; i++) assert.ok(Math.abs(m.uvs[i] - tri.uvs[i]) < 1 / 60000);
});

test("several meshes and >65535 vertices are supported", () => {
  const n = 70000;
  const big: MeshPackMesh = {
    name: "big",
    positions: new Float32Array(n * 3).map((_, i) => i % 7),
    normals: new Float32Array(n * 3).map((_, i) => (i % 3 === 2 ? 1 : 0)),
    uvs: new Float32Array(n * 2),
    indices: new Uint32Array([0, n - 2, n - 1]),
  };
  const out = decodeMeshPack(encodeMeshPack([tri, big]));
  assert.deepEqual(out.map((m) => m.name), ["body", "big"]);
  assert.deepEqual(Array.from(out[1].indices), [0, n - 2, n - 1]);
});

test("a corrupt pack is rejected, not half-read", () => {
  const bytes = new Uint8Array(encodeMeshPack([tri]));
  bytes[0] = 0;
  assert.throws(() => decodeMeshPack(bytes.buffer));
});
