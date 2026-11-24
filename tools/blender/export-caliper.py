"""
Export the caliper body from CarCaliper.blend (CC0) as a mesh pack for the
/brakes hero (src/scripts/brake/mesh-pack.ts describes the format).

Run with Python auto-exec disabled:
  blender -b -Y CarCaliper.blend --python tools/blender/export-caliper.py -- \
      public/models/brake-caliper.bin [tangential_scale=1.0] [decimate=0.13] [size=1.12]

Keeps the cast body + centre bridge only. The performance cues (chrome pad pin
and clip, two-piece body bolts, fittings) are left out on purpose: the $369 deal
covers standard brakes. Output axes match the scene: rotor radius = 1, radial
direction = +Y, tangential = +X, rotor axle = +Z (outboard toward the camera).
"""
import bpy, struct, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
K = float(argv[1]) if len(argv) > 1 else 1.0  # tangential (length) scale; 1 = as modelled
RATIO = float(argv[2]) if len(argv) > 2 else 0.13
SIZE = float(argv[3]) if len(argv) > 3 else 1.12  # grow outward from the rotor axis (caliper overhangs the rotor edge)
KEEP = ["PieceOne", "Cube"]

face_a = bpy.data.objects["Cylinder.005"]
face_b = bpy.data.objects["Cylinder.011"]
R = max(face_a.dimensions) / 2
CTR = (face_a.matrix_world.translation + face_b.matrix_world.translation) / 2
S = SIZE / R

def to_scene(p):
    q = p - CTR
    return Vector((q.z * S * K, q.y * S, -q.x * S))

def normal_to_scene(n):
    v = Vector((n.z / K, n.y, -n.x))
    return v.normalized()

verts, norms, uvs, idx = [], [], [], []
dg = bpy.context.evaluated_depsgraph_get()
for name in KEEP:
    ob = bpy.data.objects[name]
    dec = ob.modifiers.new("export_decimate", "DECIMATE")
    dec.ratio = RATIO
    dec.use_collapse_triangulate = True
    dg.update()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    nmat = ob.matrix_world.to_3x3().inverted().transposed()
    cn = me.corner_normals
    seen = {}
    for tri in me.loop_triangles:
        corner = []
        for li in tri.loops:
            vi = me.loops[li].vertex_index
            n = normal_to_scene((nmat @ cn[li].vector).normalized())
            key = (vi, round(n.x, 2), round(n.y, 2), round(n.z, 2))
            if key not in seen:
                seen[key] = len(verts)
                p = to_scene(ob.matrix_world @ me.vertices[vi].co)
                verts.append(p)
                norms.append(n)
                ax = max(range(3), key=lambda a: abs(n[a]))
                u, v = [(p.y, p.z), (p.x, p.z), (p.x, p.y)][ax]
                uvs.append((u * 1.5, v * 1.5))
            corner.append(seen[key])
        idx.extend(corner)
    ev.to_mesh_clear()
    ob.modifiers.remove(dec)

def pad(b):
    return b + b"\0" * ((-len(b)) % 4)

vc, ic = len(verts), len(idx)
ib = 4 if vc > 65535 else 2
pmin = [min(p[a] for p in verts) for a in range(3)]
pmax = [max(p[a] for p in verts) for a in range(3)]
umin = [min(u[a] for u in uvs) for a in range(2)]
umax = [max(u[a] for u in uvs) for a in range(2)]
def q16(x, lo, hi):
    return int(round((x - lo) / ((hi - lo) or 1) * 65534 - 32767))
out = bytearray()
out += struct.pack("<II", 0x314B5242, 1)
name = b"caliper"
out += pad(bytes([len(name)]) + name)
out += struct.pack("<IIB3x", vc, ic, ib)
out += struct.pack("<10f", *pmin, *pmax, *umin, *umax)
out += pad(b"".join(struct.pack("<3h", *(q16(p[a], pmin[a], pmax[a]) for a in range(3))) for p in verts))
out += pad(b"".join(struct.pack("<3b", *(max(-127, min(127, int(round(n[a] * 127)))) for a in range(3))) for n in norms))
out += pad(b"".join(struct.pack("<2H", *(int(round((u[a] - umin[a]) / ((umax[a] - umin[a]) or 1) * 65535)) for a in range(2))) for u in uvs))
out += pad(struct.pack(f"<{ic}{'H' if ib == 2 else 'I'}", *idx))
with open(OUT, "wb") as f:
    f.write(out)
print(f"EXPORT verts={vc} tris={ic // 3} bytes={len(out)} bbox_min={[round(x,3) for x in pmin]} bbox_max={[round(x,3) for x in pmax]}")
