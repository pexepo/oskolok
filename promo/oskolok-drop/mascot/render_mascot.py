"""Promo mascot: Осколок VRM "vibing" with glass headphones, soft cel shading + brand-blue rim.

Usage:
  Blender -b --factory-startup --python render_mascot.py -- <model.glb> <out_dir> [--mode=still|turn|face] [--frames=48] [--res=900x1350]
Outputs RGBA PNGs: still -> <out_dir>/still.png, face -> <out_dir>/face.png, turn -> <out_dir>/turn_###.png
"""
import bpy, bmesh, sys, math, os
from math import radians
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]
opt = {a[2:].split("=", 1)[0]: (a.split("=", 1)[1] if "=" in a else "1") for a in argv[2:] if a.startswith("--")}
MODE = opt.get("mode", "still")
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scn = bpy.context.scene; vl = bpy.context.view_layer
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
bpy.data.objects["Icosphere"].hide_render = True
face = bpy.data.objects["Face"]; body = bpy.data.objects["Body"]; hair = bpy.data.objects["Hair"]
X, Y, Z = 'X', 'Y', 'Z'

def pb(n): return arm.pose.bones[n]
def rot(name, axis, deg):
    vl.update(); b = pb(name); m = b.matrix.copy(); h = m.translation.copy()
    b.matrix = Matrix.Translation(h) @ Matrix.Rotation(radians(deg), 4, axis) @ Matrix.Translation(-h) @ m
    vl.update()
def aim(name, d):
    vl.update(); b = pb(name)
    nxt = {"UpperArm": "LowerArm", "LowerArm": "Hand", "Hand": "Middle1"}
    last = name.split("_")[-1]
    child = pb(name[: -len(last)] + nxt[last])
    q = (child.head - b.head).normalized().rotation_difference(Vector(d).normalized())
    h = b.matrix.translation.copy()
    b.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ b.matrix
    vl.update()

# ---------- soft cel shading: texture colour × eased 2-tone light (violet-navy shadow) + brand rim ----------
SHADOW = (0.52, 0.54, 0.86)
RIM = (0.45, 0.70, 1.0)
def celify(mat, rim_k=1.0):
    nt = mat.node_tree
    em = next((n for n in nt.nodes if n.type == 'EMISSION'), None)
    if not em or not em.inputs['Color'].is_linked: return
    src = em.inputs['Color'].links[0].from_socket
    N = nt.nodes.new; L = nt.links.new
    dif = N("ShaderNodeBsdfDiffuse"); s2r = N("ShaderNodeShaderToRGB"); bw = N("ShaderNodeRGBToBW")
    ramp = N("ShaderNodeValToRGB"); cr = ramp.color_ramp; cr.interpolation = 'EASE'
    cr.elements[0].position = 0.04; cr.elements[0].color = (*SHADOW, 1)
    cr.elements[1].position = 0.13; cr.elements[1].color = (1.0, 1.0, 1.0, 1)
    mul = N("ShaderNodeMix"); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1.0
    lw = N("ShaderNodeLayerWeight"); lw.inputs[0].default_value = 0.12
    rr = N("ShaderNodeValToRGB"); rc = rr.color_ramp; rc.interpolation = 'EASE'
    rc.elements[0].position = 0.45; rc.elements[0].color = (0, 0, 0, 1)
    rc.elements[1].position = 0.85; rc.elements[1].color = (*[c * 0.85 * rim_k for c in RIM], 1)
    add = N("ShaderNodeMix"); add.data_type = 'RGBA'; add.blend_type = 'ADD'; add.inputs[0].default_value = 1.0
    L(dif.outputs[0], s2r.inputs[0]); L(s2r.outputs[0], bw.inputs[0]); L(bw.outputs[0], ramp.inputs[0])
    L(src, mul.inputs[6]); L(ramp.outputs[0], mul.inputs[7])
    L(lw.outputs['Fresnel'], rr.inputs[0])
    L(mul.outputs[2], add.inputs[6]); L(rr.outputs[0], add.inputs[7])
    L(add.outputs[2], em.inputs['Color'])
skip = ("EyeHighlight", "EyeIris", "EyeWhite", "FaceEyeline", "FaceEyelash", "FaceBrow", "FaceMouth")
for m in bpy.data.materials:
    if m.node_tree and not any(k in m.name for k in skip):
        celify(m, 0.6 if ("Face" in m.name or "SKIN" in m.name) else 1.0)

# ---------- face ----------
keys = face.data.shape_keys.key_blocks
FACES = {
    "vibe": {"Fcl_EYE_Joy": 0.9, "Fcl_MTH_Fun": 0.55, "Fcl_BRW_Fun": 0.45},
    "cheer": {"Fcl_EYE_Joy": 1.0, "Fcl_MTH_Joy": 0.55, "Fcl_MTH_A": 0.25, "Fcl_BRW_Fun": 0.6},
    "smile": {"Fcl_EYE_Fun": 0.25, "Fcl_MTH_Fun": 0.5, "Fcl_BRW_Joy": 0.3, "Fcl_EYE_Spread": 0.1},
}
for k, v in FACES[opt.get("face", "vibe")].items(): keys[k].value = v

POSE = opt.get("pose", "vibe")
if POSE == "cheer":
    # "cheer": both arms thrown up in a V, one knee up, head back — the end-card celebration
    for s, sg in (("L", 1), ("R", -1)):
        rot(f"J_Bip_{s}_UpperLeg", Z, 6 * sg); rot(f"J_Bip_{s}_Foot", Z, 14 * sg)
        aim(f"J_Bip_{s}_UpperArm", (0.62 * sg, -0.15, 0.85))
        aim(f"J_Bip_{s}_LowerArm", (0.38 * sg, -0.1, 1.0))
        aim(f"J_Bip_{s}_Hand", (0.3 * sg, -0.05, 1.0))
        for f in ("Index", "Middle", "Ring", "Little"):
            for i, a_ in ((1, 6), (2, 8), (3, 5)):
                rot(f"J_Bip_{s}_{f}{i}", X, a_)
    rot("J_Bip_L_UpperLeg", X, -55); rot("J_Bip_L_LowerLeg", X, 85); rot("J_Bip_L_Foot", X, -25)
    rot("J_Bip_C_Hips", Y, 6); rot("J_Bip_C_Spine", Y, -6); rot("J_Bip_C_Spine", X, -6); rot("J_Bip_C_Chest", X, -4)
    rot("J_Bip_C_Head", X, -10); rot("J_Bip_C_Head", Y, -8)
for s, sg in ((("L", 1), ("R", -1)) if POSE == "vibe" else ()):
    rot(f"J_Bip_{s}_UpperLeg", Z, 5 * sg); rot(f"J_Bip_{s}_Foot", Z, 16 * sg)
if POSE == "vibe":
    aim("J_Bip_R_UpperArm", (-0.95, -0.25, -0.25))
    aim("J_Bip_R_LowerArm", (0.55, -0.35, 1.0))
    aim("J_Bip_R_Hand", (0.35, -0.15, 1.0))
    aim("J_Bip_L_UpperArm", (0.42, -0.12, -1.0))
    aim("J_Bip_L_LowerArm", (0.35, -0.75, -0.45))
    aim("J_Bip_L_Hand", (0.3, -0.8, -0.5))
    for s in ("L", "R"):
        for f in ("Index", "Middle", "Ring", "Little"):
            for i, a_ in ((1, 16), (2, 20), (3, 12)):
                rot(f"J_Bip_{s}_{f}{i}", X, a_ * (0.6 if s == "R" else 1.0))
        rot(f"J_Bip_{s}_Thumb1", X, -8)
    rot("J_Bip_C_Hips", Y, -8)
    rot("J_Bip_L_UpperLeg", Y, 8); rot("J_Bip_R_UpperLeg", Y, 8)
    rot("J_Bip_R_UpperLeg", X, -20); rot("J_Bip_R_LowerLeg", X, 34); rot("J_Bip_R_Foot", X, -12); rot("J_Bip_R_UpperLeg", Z, 9)
    rot("J_Bip_C_Spine", Y, 9); rot("J_Bip_C_Chest", Y, 5)
    rot("J_Bip_C_Spine", X, -3)
    rot("J_Bip_C_Neck", Y, 5)
    rot("J_Bip_C_Head", Y, 13); rot("J_Bip_C_Head", Z, -10); rot("J_Bip_C_Head", X, 4)

# ---------- glass headphones, authored in head-bone space ----------
vl.update()
hb = arm.matrix_world @ pb("J_Bip_C_Head").matrix
hinv = hb.inverted()
dg = bpy.context.evaluated_depsgraph_get()
e = hair.evaluated_get(dg); me = e.to_mesh()
loc = [hinv @ (hair.matrix_world @ v.co) for v in me.vertices]; e.to_mesh_clear()
ey = bpy.data.objects["Face"].evaluated_get(dg); fm = ey.to_mesh()
floc = [hinv @ (face.matrix_world @ v.co) for v in fm.vertices]; ey.to_mesh_clear()
# bone-local +Y runs up the head; ears sit around mid-face height
fy0, fy1 = min(p.y for p in floc), max(p.y for p in floc)
ear_y = fy0 + (fy1 - fy0) * float(opt.get('eary', '0.31'))
band = [p for p in loc if abs(p.y - ear_y) < 0.025]
half_w = max(abs(p.x) for p in band) if band else 0.13
fz0, fz1 = min(p.z for p in floc), max(p.z for p in floc)
zc = fz0 + (fz1 - fz0) * float(opt.get('earz', '0.17'))
print('FACE y', round(fy0,3), round(fy1,3), 'z', round(fz0,3), round(fz1,3))
top_y = max(p.y for p in loc if abs(p.x) < 0.05)
def mat_glass(name, rgb, emit=0.0, rough=0.12, metal=0.4):
    m = bpy.data.materials.new(name); m.use_nodes = True; bs = m.node_tree.nodes["Principled BSDF"]
    bs.inputs["Base Color"].default_value = (*rgb, 1); bs.inputs["Roughness"].default_value = rough
    bs.inputs["Metallic"].default_value = metal
    try: bs.inputs["Coat Weight"].default_value = 1.0
    except KeyError: pass
    if emit:
        bs.inputs["Emission Color"].default_value = (*rgb, 1); bs.inputs["Emission Strength"].default_value = emit
    return m
blue = mat_glass("HP_Blue", (0.10, 0.32, 1.0), 0.25)
ice = mat_glass("HP_Ice", (0.65, 0.85, 1.0), 2.2, 0.2, 0.0)
dark = mat_glass("HP_Dark", (0.03, 0.05, 0.12), 0.0, 0.35, 0.2)
parts = []
def add_obj(op, mat, **kw):
    op(**kw); o = bpy.context.object; o.data.materials.append(mat); bpy.ops.object.shade_smooth(); parts.append(o); return o
R = min(half_w, 0.142) + 0.004
for sg in (1, -1):
    c = add_obj(bpy.ops.mesh.primitive_cylinder_add, blue, vertices=48, radius=0.056, depth=0.046,
                location=(sg * (R + 0.024), ear_y, zc), rotation=(0, radians(90), 0))
    bv = c.modifiers.new("bev", 'BEVEL'); bv.width = 0.014; bv.segments = 5
    add_obj(bpy.ops.mesh.primitive_torus_add, ice, major_radius=0.043, minor_radius=0.0065,
            location=(sg * (R + 0.05), ear_y, zc), rotation=(0, radians(90), 0))
    add_obj(bpy.ops.mesh.primitive_torus_add, dark, major_radius=0.044, minor_radius=0.015,
            location=(sg * (R - 0.004), ear_y, zc), rotation=(0, radians(90), 0))
bh = top_y - ear_y + 0.03
sx, sy = R + 0.024, bh
bd = add_obj(bpy.ops.mesh.primitive_torus_add, blue, major_radius=1.0, minor_radius=0.014 / ((sx + sy) / 2), major_segments=72,
             location=(0, 0, 0))
bd.scale = (sx, sy, (sx + sy) / 2)  # ring in the head's XY plane: X = across the head, Y = up the bone
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bm = bmesh.new(); bm.from_mesh(bd.data)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.01], context='VERTS')
for v in bm.verts: v.co.y += ear_y; v.co.z += zc
bm.to_mesh(bd.data); bm.free()
for o in parts:
    o.matrix_world = hb @ o.matrix_world
vl.update()
for o in parts:
    mw = o.matrix_world.copy(); o.parent = arm; o.parent_type = 'BONE'; o.parent_bone = "J_Bip_C_Head"; vl.update(); o.matrix_world = mw

# ---------- thin clean outline (inverted hull), no sketch lines ----------
om = bpy.data.materials.new("Outline"); om.use_nodes = True; nt = om.node_tree; nt.nodes.clear()
o_ = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
em.inputs[0].default_value = (0.05, 0.06, 0.14, 1); nt.links.new(em.outputs[0], o_.inputs[0])
om.use_backface_culling = True
for ob, th in ((body, 0.0032), (hair, 0.0028)):
    ob.data.materials.append(om)
    hm = ob.modifiers.new("outline", 'SOLIDIFY'); hm.thickness = th; hm.offset = 1; hm.use_flip_normals = True
    hm.use_rim = False; hm.material_offset = len(ob.data.materials) - 1

# ---------- ground the model ----------
vl.update(); dg = bpy.context.evaluated_depsgraph_get()
e = body.evaluated_get(dg); me = e.to_mesh(); minz = min((body.matrix_world @ v.co).z for v in me.vertices); e.to_mesh_clear()
arm.location.z -= minz
arm.rotation_mode = 'XYZ'

# ---------- lights: warm-white key + cool back fill (the rim itself is in the shader) ----------
def sun(rot_deg, energy, col, ang=3):
    bpy.ops.object.light_add(type='SUN', rotation=tuple(radians(a) for a in rot_deg))
    l = bpy.context.object.data; l.energy = energy; l.color = col; l.angle = radians(ang); return l
sun((50, 0, -32), 3.4, (1.0, 0.97, 0.94))
sun((60, 0, 150), 1.4, (0.55, 0.65, 1.0))
world = bpy.data.worlds.new("W"); scn.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.07, 0.16, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6

# ---------- camera ----------
vl.update(); dg = bpy.context.evaluated_depsgraph_get()
pts = []
for o in (body, hair):
    e = o.evaluated_get(dg); me = e.to_mesh(); pts += [o.matrix_world @ v.co for v in me.vertices]; e.to_mesh_clear()
mxz = max(p.z for p in pts)
bpy.ops.object.camera_add(); cam = bpy.context.object; scn.camera = cam
RW, RH = (int(v) for v in opt.get("res", "900x1350").split("x"))
if MODE == "face":
    hw = arm.matrix_world @ pb("J_Bip_C_Head").head
    target = hw + Vector((0, 0, 0.1)); cam.data.lens = 110
    cam.location = target + Vector((0.12, -1, 0.06)).normalized() * 1.5
    RW, RH = 640, 640
else:
    target = Vector((0, 0, mxz / 2 + 0.02))
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = mxz + 0.16
    cam.location = target + Vector((0, -6, 0.35))
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()

for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    try: scn.render.engine = eng; break
    except TypeError: pass
scn.eevee.taa_render_samples = int(opt.get("samples", "48"))
scn.render.resolution_x = RW; scn.render.resolution_y = RH
scn.render.film_transparent = True
scn.view_settings.view_transform = 'Standard'
scn.render.image_settings.file_format = 'PNG'; scn.render.image_settings.color_mode = 'RGBA'

base_turn = float(opt.get("turn", "-18"))
if MODE == "turn":
    n = int(opt.get("frames", "48"))
    for i in range(n):
        arm.rotation_euler.z = radians(base_turn + i * 360.0 / n)
        scn.render.filepath = os.path.join(OUT, "turn_%03d.png" % i)
        bpy.ops.render.render(write_still=True)
else:
    arm.rotation_euler.z = radians(base_turn if MODE != "face" else -12)
    scn.render.filepath = os.path.join(OUT, MODE + ".png")
    bpy.ops.render.render(write_still=True)
print("DONE", MODE, "half_w", round(half_w, 3), "ear_y", round(ear_y, 3), "top_y", round(top_y, 3), "zc", round(zc, 3))
