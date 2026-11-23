/**
 * "Mesh pack": a tiny quantized binary mesh format for the brake scene, so we
 * don't ship a full glTF loader for one model. Written by
 * tools/blender/export-caliper.py, read by decodeMeshPack().
 *
 * Layout (little-endian, every block 4-byte aligned):
 *   "BRK1" · u32 meshCount
 *   per mesh:
 *     u8 nameLen · name (utf-8) · pad
 *     u32 vertexCount · u32 indexCount · u8 indexBytes (2|4) · pad×3
 *     f32 posMin[3] · f32 posMax[3] · f32 uvMin[2] · f32 uvMax[2]
 *     i16 positions[3·v] · pad      (quantized to the bounding box)
 *     i8  normals[3·v]   · pad      (×127)
 *     u16 uvs[2·v]       · pad      (quantized to the uv range)
 *     u16|u32 indices[i] · pad
 */
export interface MeshPackMesh {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array | Uint16Array;
}

const MAGIC = 0x314b5242; // "BRK1"
const pad4 = (n: number) => (n + 3) & ~3;

export function decodeMeshPack(buf: ArrayBuffer): MeshPackMesh[] {
  const dv = new DataView(buf);
  if (buf.byteLength < 8 || dv.getUint32(0, true) !== MAGIC) throw new Error("not a mesh pack");
  const count = dv.getUint32(4, true);
  let o = 8;
  const out: MeshPackMesh[] = [];
  for (let m = 0; m < count; m++) {
    const nameLen = dv.getUint8(o);
    const name = new TextDecoder().decode(new Uint8Array(buf, o + 1, nameLen));
    o = pad4(o + 1 + nameLen);
    const vc = dv.getUint32(o, true);
    const ic = dv.getUint32(o + 4, true);
    const ib = dv.getUint8(o + 8);
    o += 12;
    const f = (k: number) => dv.getFloat32(o + k * 4, true);
    const pMin = [f(0), f(1), f(2)];
    const pMax = [f(3), f(4), f(5)];
    const uMin = [f(6), f(7)];
    const uMax = [f(8), f(9)];
    o += 40;

    const qp = new Int16Array(buf.slice(o, o + vc * 6));
    o = pad4(o + vc * 6);
    const qn = new Int8Array(buf.slice(o, o + vc * 3));
    o = pad4(o + vc * 3);
    const qu = new Uint16Array(buf.slice(o, o + vc * 4));
    o = pad4(o + vc * 4);
    const indices = ib === 2 ? new Uint16Array(buf.slice(o, o + ic * 2)) : new Uint32Array(buf.slice(o, o + ic * 4));
    o = pad4(o + ic * ib);
    if (o > buf.byteLength) throw new Error("truncated mesh pack");

    const positions = new Float32Array(vc * 3);
    const normals = new Float32Array(vc * 3);
    const uvs = new Float32Array(vc * 2);
    for (let v = 0; v < vc; v++) {
      for (let a = 0; a < 3; a++) {
        positions[v * 3 + a] = pMin[a] + ((qp[v * 3 + a] + 32767) / 65534) * (pMax[a] - pMin[a]);
      }
      const nx = qn[v * 3] / 127;
      const ny = qn[v * 3 + 1] / 127;
      const nz = qn[v * 3 + 2] / 127;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals[v * 3] = nx / len;
      normals[v * 3 + 1] = ny / len;
      normals[v * 3 + 2] = nz / len;
      uvs[v * 2] = uMin[0] + (qu[v * 2] / 65535) * (uMax[0] - uMin[0]);
      uvs[v * 2 + 1] = uMin[1] + (qu[v * 2 + 1] / 65535) * (uMax[1] - uMin[1]);
    }
    out.push({ name, positions, normals, uvs, indices });
  }
  return out;
}

/** Encoder (mirrors the Blender exporter); used by tests and tooling. */
export function encodeMeshPack(meshes: MeshPackMesh[]): ArrayBuffer {
  const parts: Uint8Array[] = [];
  const push = (bytes: ArrayBufferView) => {
    const u = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    parts.push(u);
    const extra = pad4(u.byteLength) - u.byteLength;
    if (extra) parts.push(new Uint8Array(extra));
  };
  const head = new DataView(new ArrayBuffer(8));
  head.setUint32(0, MAGIC, true);
  head.setUint32(4, meshes.length, true);
  push(head);
  for (const m of meshes) {
    const name = new TextEncoder().encode(m.name);
    push(new Uint8Array([name.length, ...name]));
    const vc = m.positions.length / 3;
    const ib = vc > 65535 ? 4 : 2;
    const meta = new DataView(new ArrayBuffer(12));
    meta.setUint32(0, vc, true);
    meta.setUint32(4, m.indices.length, true);
    meta.setUint8(8, ib);
    push(meta);
    const pMin = [Infinity, Infinity, Infinity];
    const pMax = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < vc; v++)
      for (let a = 0; a < 3; a++) {
        pMin[a] = Math.min(pMin[a], m.positions[v * 3 + a]);
        pMax[a] = Math.max(pMax[a], m.positions[v * 3 + a]);
      }
    const uMin = [Infinity, Infinity];
    const uMax = [-Infinity, -Infinity];
    for (let v = 0; v < vc; v++)
      for (let a = 0; a < 2; a++) {
        uMin[a] = Math.min(uMin[a], m.uvs[v * 2 + a]);
        uMax[a] = Math.max(uMax[a], m.uvs[v * 2 + a]);
      }
    push(new Float32Array([...pMin, ...pMax, ...uMin, ...uMax]));
    const qp = new Int16Array(vc * 3);
    for (let i = 0; i < qp.length; i++) {
      const a = i % 3;
      const span = pMax[a] - pMin[a] || 1;
      qp[i] = Math.round(((m.positions[i] - pMin[a]) / span) * 65534 - 32767);
    }
    push(qp);
    push(Int8Array.from(m.normals, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 127)));
    const qu = new Uint16Array(vc * 2);
    for (let i = 0; i < qu.length; i++) {
      const a = i % 2;
      const span = uMax[a] - uMin[a] || 1;
      qu[i] = Math.round(((m.uvs[i] - uMin[a]) / span) * 65535);
    }
    push(qu);
    push(ib === 2 ? Uint16Array.from(m.indices) : Uint32Array.from(m.indices));
  }
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out.buffer;
}
