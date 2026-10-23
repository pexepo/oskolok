"""Login-page mascot: oskolok VRM crouching, arms crossed on knees (pose ref: photo), toon-shaded, navy grade."""
import bpy, sys, math
from math import radians
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--")+1:]
SRC, OUT = argv[0], argv[1]
VIEW = next((a.split("=",1)[1] for a in argv if a.startswith("--view=")), "main")
BLEND = next((a.split("=",1)[1] for a in argv if a.startswith("--blend=")), None)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scn = bpy.context.scene; vl = bpy.context.view_layer
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
bpy.data.objects["Icosphere"].hide_render = True
face = bpy.data.objects["Face"]; body = bpy.data.objects["Body"]; hair = bpy.data.objects["Hair"]

def pb(n): return arm.pose.bones[n]
def rot(name, axis, deg):
    vl.update()
    b = pb(name); m = b.matrix.copy(); h = m.translation.copy()
    b.matrix = Matrix.Translation(h) @ Matrix.Rotation(radians(deg), 4, axis) @ Matrix.Translation(-h) @ m
    vl.update()
X, Y, Z = 'X', 'Y', 'Z'

# ---------- toon shading on the VRM materials (keeps texture colours, adds lit/shadow + cool rim) ----------
SHADOW = (0.70, 0.69, 0.82)   # navy-tinted shadow, matches the #0a1626 page
RIM = (0.47, 0.73, 1.0)       # #79baff accent
def toonify(mat):
    nt = mat.node_tree
    em = next((n for n in nt.nodes if n.type == 'EMISSION'), None)
    if not em or not em.inputs['Color'].is_linked: return
    src = em.inputs['Color'].links[0].from_socket
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    ramp = nt.nodes.new("ShaderNodeValToRGB"); cr = ramp.color_ramp
    cr.interpolation = 'CONSTANT'
    cr.elements[0].position = 0.0; cr.elements[0].color = (*SHADOW, 1)
    cr.elements[1].position = 0.09; cr.elements[1].color = (0.96, 0.95, 0.95, 1)
    mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'
    mul.inputs[0].default_value = 1.0
    lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs[0].default_value = 0.18
    rr = nt.nodes.new("ShaderNodeValToRGB"); rc = rr.color_ramp; rc.interpolation = 'CONSTANT'
    rc.elements[0].position = 0.0; rc.elements[0].color = (0, 0, 0, 1)
    rc.elements[1].position = 0.55; rc.elements[1].color = (*[c*0.55 for c in RIM], 1)
    add = nt.nodes.new("ShaderNodeMix"); add.data_type = 'RGBA'; add.blend_type = 'ADD'
    add.inputs[0].default_value = 1.0
    L = nt.links.new
    L(dif.outputs[0], s2r.inputs[0]); L(s2r.outputs[0], ramp.inputs[0])
    L(src, mul.inputs[6]); L(ramp.outputs[0], mul.inputs[7])
    L(lw.outputs['Facing'], rr.inputs[0])
    L(mul.outputs[2], add.inputs[6]); L(rr.outputs[0], add.inputs[7])
    L(add.outputs[2], em.inputs['Color'])
skip = ("EyeHighlight", "EyeIris", "EyeWhite", "FaceEyeline", "FaceEyelash", "FaceBrow", "FaceMouth")
for m in bpy.data.materials:
    if m.node_tree and not any(k in m.name for k in skip): toonify(m)

# ---------- face: calm, heavy-lidded gaze like the photo ----------
keys = face.data.shape_keys.key_blocks
FACES = {
    "blank": {"Fcl_EYE_Surprised": 0.45, "Fcl_EYE_Highlight_Hide": 1.0, "Fcl_BRW_Sorrow": 0.45, "Fcl_MTH_Small": 0.5},
    # cute «ну не знаю»: bright eyes, a small closed smile, brows up
    "cute": {"Fcl_BRW_Surprised": 0.35, "Fcl_BRW_Sorrow": 0.2, "Fcl_MTH_Fun": 0.45, "Fcl_MTH_Small": 0.25, "Fcl_EYE_Spread": 0.15},
    "joy": {"Fcl_EYE_Joy": 0.85, "Fcl_MTH_Fun": 0.6, "Fcl_BRW_Fun": 0.5},
    "listen": {"Fcl_EYE_Close": 0.35, "Fcl_MTH_Fun": 0.3, "Fcl_BRW_Fun": 0.2},
}
FACE_NAME = next((a.split("=",1)[1] for a in argv if a.startswith("--face=")), "cute")
for k, v in FACES[FACE_NAME].items(): keys[k].value = v

# ---------- manga emanata, built in rest pose and parented to the head bone ----------
FX = "--nofx" not in argv
noline = bpy.data.collections.new("NoLine"); scn.collection.children.link(noline)
def flat_mat(name, rgb, alpha=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission"); em.inputs[0].default_value = (*rgb, 1)
    if alpha < 1:
        tr = nt.nodes.new("ShaderNodeBsdfTransparent"); mix = nt.nodes.new("ShaderNodeMixShader"); mix.inputs[0].default_value = alpha
        nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2]); nt.links.new(mix.outputs[0], out.inputs[0])
        try: m.surface_render_method = 'BLENDED'
        except Exception: m.blend_method = 'BLEND'
    else: nt.links.new(em.outputs[0], out.inputs[0])
    return m
def to_head(o):
    vl.update(); mw = o.matrix_world.copy()
    o.parent = arm; o.parent_type = 'BONE'; o.parent_bone = "J_Bip_C_Head"; vl.update(); o.matrix_world = mw
def mesh_obj(name, verts, faces, mat, coll=None):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    o = bpy.data.objects.new(name, me); (coll or scn.collection).objects.link(o); o.data.materials.append(mat); return o
if FX:
    # Blush: a soft pink oval with three short hatch strokes on each cheek, just in front of the skin.
    pink = flat_mat("Blush", (1.0, 0.45, 0.52), 0.42); hatch = flat_mat("BlushHatch", (0.86, 0.28, 0.36), 0.9)
    fv = [(v.co.x, v.co.y, v.co.z) for v in face.data.vertices]
    for sx in (1, -1):
        cx, cz = 0.066 * sx, 1.748
        near = [v for v in fv if abs(v[0] - cx) < 0.012 and abs(v[2] - cz) < 0.012]
        cy = (min(v[1] for v in near) if near else -0.09) - 0.004
        ring = [(cx + 0.024 * math.cos(a) , cy, cz + 0.011 * math.sin(a)) for a in [i * 2 * math.pi / 24 for i in range(24)]]
        o = mesh_obj("Blush", [(cx, cy, cz)] + ring, [(0, i + 1, (i + 1) % 24 + 1) for i in range(24)], pink, noline); to_head(o)
        for k in range(3):
            x0 = cx - 0.012 * sx + k * 0.0095 * sx
            o = mesh_obj("Hatch", [(x0, cy - 0.001, cz - 0.007), (x0 + 0.0022, cy - 0.001, cz - 0.007), (x0 + 0.0062 * sx + 0.0022, cy - 0.001, cz + 0.008), (x0 + 0.0062 * sx, cy - 0.001, cz + 0.008)], [(0, 1, 2, 3)], hatch, noline); to_head(o)
    # Sweat drop at the temple (character's left), the classic «uh…» sign: a round belly and a pointed top.
    drop = flat_mat("Sweat", (0.72, 0.88, 1.0), 1.0)
    dx, dy, dz, r = 0.158, -0.05, 1.865, 0.017
    arc = [math.radians(35 - k * 250 / 24) for k in range(25)]
    pts = [(dx + r * math.cos(a), dy, dz + r * math.sin(a)) for a in arc] + [(dx, dy, dz + r * 2.3)]
    o = mesh_obj("SweatDrop", [(dx, dy, dz)] + pts, [(0, i + 1, (i + 1) % len(pts) + 1) for i in range(len(pts))], drop); to_head(o)
    shine = flat_mat("SweatShine", (1, 1, 1), 1.0)
    o = mesh_obj("SweatShine", [(dx - 0.008, dy - 0.002, dz - 0.002), (dx - 0.004, dy - 0.002, dz - 0.002), (dx - 0.003, dy - 0.002, dz + 0.012), (dx - 0.007, dy - 0.002, dz + 0.012)], [(0, 1, 2, 3)], shine, noline); to_head(o)

# ---------- pose: deep crouch, forearms crossed on the knees, cheek on the arm ----------
P = dict(thigh=-112, shin=152, foot=-38, spine=28, chest=14, twist=22, ua_fwd=1.1, la_in=0.32, la_fwd=0.95, la_up=0.85,
         stack_up=0.0, stack_fwd=0.0, la_roll=90, hand=0.9, neck=12, head_fwd=0, head_tilt=-26, head_turn=30, knee_spread=-3)
for a in argv:
    if a.startswith("--p."):
        k, v = a[4:].split("="); P[k] = float(v)
def aim(name, d):
    """Point a bone (head->tail) along direction d, armature space, rotating about its head."""
    vl.update()
    b = pb(name)
    # glTF bones point straight up, so measure the limb from this joint to the next one
    nxt = {"UpperArm": "LowerArm", "LowerArm": "Hand", "Hand": "Middle1"}
    child = pb(name.replace(name.split("_")[-1], nxt[name.split("_")[-1]]))
    cur = (child.head - b.head).normalized()
    q = cur.rotation_difference(Vector(d).normalized())
    h = b.matrix.translation.copy()
    b.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ b.matrix
    vl.update()
POSE = next((a.split("=",1)[1] for a in argv if a.startswith("--pose=")), "shrug")
S = dict(leg_out=6, toe_out=20, ua_out=0.55, ua_fwd=0.05, la_out=0.95, la_fwd=0.25, la_up=0.5, roll=105, hand_up=0.15, shrug=9,
         curl=14, spine=-2, twist=-6, neck=-3, head_tilt=-14, head_turn=9, head_fwd=-6, hip=0, hip_tilt=9, knee=26)
for a in argv:
    if a.startswith("--s."):
        k, v = a[4:].split("="); S[k] = float(v)
if POSE == "shrug":
    for s, sg in (("L", 1), ("R", -1)):
        rot(f"J_Bip_{s}_UpperLeg", Z, S['leg_out']*sg)
        rot(f"J_Bip_{s}_Foot", Z, S['toe_out']*sg)
        rot(f"J_Bip_{s}_Shoulder", Y, S['shrug']*sg)
        aim(f"J_Bip_{s}_UpperArm", (S['ua_out']*sg, -S['ua_fwd'], -1.0))
        # Asymmetric shrug: one palm higher and further out reads alive, a mirrored pose reads like a mannequin.
        up = S['la_up'] * (1.35 if s == 'R' else 0.75)
        aim(f"J_Bip_{s}_LowerArm", (S['la_out']*sg, -S['la_fwd'] * (1.4 if s == 'L' else 0.8), up))
        vl.update()
        la = pb(f"J_Bip_{s}_LowerArm"); axis = (pb(f"J_Bip_{s}_Hand").head - la.head).normalized()
        h_ = la.matrix.translation.copy()
        la.matrix = Matrix.Translation(h_) @ Matrix.Rotation(radians(S['roll']*sg), 4, axis) @ Matrix.Translation(-h_) @ la.matrix
        aim(f"J_Bip_{s}_Hand", (S['la_out']*sg, -S['la_fwd'] - 0.1, up + S['hand_up']))
        for f in ("Index", "Middle", "Ring", "Little"):
            for i, a_ in ((1, S['curl']), (2, S['curl']*1.2), (3, S['curl'])):
                rot(f"J_Bip_{s}_{f}{i}", X, a_)
        rot(f"J_Bip_{s}_Thumb1", X, -10)
    # Weight on the right leg: pelvis tilts, the free left knee bends and turns in, the torso answers the other way.
    rot("J_Bip_C_Hips", Y, S['hip_tilt'])
    rot("J_Bip_R_UpperLeg", Y, -S['hip_tilt']); rot("J_Bip_L_UpperLeg", Y, -S['hip_tilt'])
    rot("J_Bip_L_UpperLeg", X, -S['knee']); rot("J_Bip_L_LowerLeg", X, S['knee'] * 1.7); rot("J_Bip_L_Foot", X, -S['knee'] * 0.6)
    rot("J_Bip_L_UpperLeg", Z, -S['knee'] * 0.5)
    rot("J_Bip_C_Spine", Y, -S['hip_tilt'] * 1.3); rot("J_Bip_C_Chest", Y, -S['hip_tilt'] * 0.6)
    rot("J_Bip_C_Spine", Z, S['twist']*0.5); rot("J_Bip_C_Chest", Z, S['twist']*0.5)
    rot("J_Bip_C_Spine", X, S['spine'])
    rot("J_Bip_C_Neck", X, S['neck'])
    rot("J_Bip_C_Head", X, S['head_fwd']); rot("J_Bip_C_Head", Y, S['head_tilt']); rot("J_Bip_C_Head", Z, S['head_turn'])
else:
    # limbs first, in the unrotated body frame (front = -Y, character's left = +X)
    for s, sg in (("L", 1), ("R", -1)):
        rot(f"J_Bip_{s}_UpperLeg", X, P['thigh']); rot(f"J_Bip_{s}_UpperLeg", Z, P['knee_spread']*sg)
        rot(f"J_Bip_{s}_LowerLeg", X, P['shin'])
        rot(f"J_Bip_{s}_Foot", X, P['foot'])
        aim(f"J_Bip_{s}_UpperArm", (0.18*sg, -P['ua_fwd'], -1.0))
        # the two forearms stack instead of intersecting: right one higher and further out
        aim(f"J_Bip_{s}_LowerArm", (-P['la_in']*sg, -(P['la_fwd'] + (P['stack_fwd'] if s == "R" else 0.0)), P['la_up'] + (P['stack_up'] if s == "R" else 0.0)))
        vl.update()
        la = pb(f"J_Bip_{s}_LowerArm"); axis = (pb(f"J_Bip_{s}_Hand").head - la.head).normalized()
        h_ = la.matrix.translation.copy()
        la.matrix = Matrix.Translation(h_) @ Matrix.Rotation(radians(P['la_roll']*sg), 4, axis) @ Matrix.Translation(-h_) @ la.matrix
        aim(f"J_Bip_{s}_Hand", (-0.55*sg, -0.35, -P['hand']))
        for f in ("Index", "Middle", "Ring", "Little"):
            for i, a_ in ((1, 18), (2, 22), (3, 14)):
                rot(f"J_Bip_{s}_{f}{i}", X, a_)
    # then the torso leans over the knees and turns toward the camera
    rot("J_Bip_C_Spine", X, P['spine']); rot("J_Bip_C_Chest", X, P['chest'])
    rot("J_Bip_C_Spine", Z, P['twist']*0.5); rot("J_Bip_C_Chest", Z, P['twist']*0.5)
    rot("J_Bip_C_Neck", X, P['neck'])
    rot("J_Bip_C_Head", X, P['head_fwd']); rot("J_Bip_C_Head", Y, P['head_tilt']); rot("J_Bip_C_Head", Z, P['head_turn'])
    # skirt panels follow the thighs so nothing shows between the legs
    for b in arm.pose.bones:
        n = b.name
        if not n.startswith("J_Sec_") or "Skirt" not in n or "end" in n or n.split("_")[-1] != "01": continue
        if "Front" in n: rot(n, X, -100)
        elif "Side" in n: rot(n, X, -70)
        elif "Back" in n: rot(n, X, -25)

vl.update()
dg = bpy.context.evaluated_depsgraph_get()
e = body.evaluated_get(dg); me = e.to_mesh(); minz = min((body.matrix_world @ v.co).z for v in me.vertices); e.to_mesh_clear()
arm.location.z -= minz
arm.rotation_mode = 'XYZ'; arm.rotation_euler = (0, 0, 0)
arm.rotation_euler.z = radians(float(next((a.split("=",1)[1] for a in argv if a.startswith("--turn=")), "-45" if POSE == "crouch" else "-14")))

# ---------- sparkles by the open palms (manga «ta-da») ----------
if FX and POSE == "shrug" and "--nosparkle" not in argv:
    vl.update()
    gold = flat_mat("Sparkle", (1.0, 0.93, 0.62), 1.0)
    def star(name, c, size, rot_deg=0):
        pts = []
        for k in range(8):
            a = math.radians(rot_deg + k * 45); rr = size if k % 2 == 0 else size * 0.28
            pts.append((c.x + rr * math.cos(a), c.y - 0.02, c.z + rr * math.sin(a)))
        return mesh_obj(name, [(c.x, c.y - 0.02, c.z)] + pts, [(0, k + 1, (k + 1) % 8 + 1) for k in range(8)], gold)
    for s_, sg in (("L", 1), ("R", -1)):
        h = arm.matrix_world @ pb(f"J_Bip_{s_}_Middle1").head
        star("SparkA", h + Vector((0.07 * sg, 0, 0.13)), 0.035, 10 * sg)
        star("SparkB", h + Vector((0.15 * sg, 0, 0.04)), 0.02, -15 * sg)
        star("SparkC", h + Vector((0.02 * sg, 0, 0.22)), 0.014, 0)

# ---------- outlines: hull on body (+thin on hands) and Freestyle for inner lines ----------
om = bpy.data.materials.new("Outline"); om.use_nodes = True
nt = om.node_tree; nt.nodes.clear()
o_ = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
em.inputs[0].default_value = (0.03, 0.035, 0.06, 1); nt.links.new(em.outputs[0], o_.inputs[0])
om.use_backface_culling = True
body.data.materials.append(om)
hm = body.modifiers.new("outline", 'SOLIDIFY')
hm.thickness = 0.0075; hm.offset = 1; hm.use_flip_normals = True; hm.use_rim = False
hm.material_offset = len(body.data.materials) - 1
hand_groups = [vg.index for vg in body.vertex_groups if any(k in vg.name for k in ("Hand", "Thumb", "Index", "Middle", "Ring", "Little"))]
ow = body.vertex_groups.new(name="outline_w")
for v in body.data.vertices:
    hw = sum(g.weight for g in v.groups if g.group in hand_groups)
    ow.add([v.index], max(0.0, 1.0 - hw), 'REPLACE')
hm.vertex_group = "outline_w"; hm.thickness_vertex_group = 0.2

scn.render.use_freestyle = True; scn.render.line_thickness_mode = 'ABSOLUTE'
fs = vl.freestyle_settings; fs.crease_angle = radians(100)
ls = fs.linesets[0] if fs.linesets else fs.linesets.new("LineSet")
ls.select_by_visibility = True; ls.visibility = 'VISIBLE'
# Blush and hatch strokes are drawn flat, without contour lines.
ls.select_by_collection = True; ls.collection = noline; ls.collection_negation = 'EXCLUSIVE'
ls.select_silhouette = True; ls.select_border = False; ls.select_crease = True; ls.select_external_contour = True
if ls.linestyle is None: ls.linestyle = bpy.data.linestyles.new("Line")
lst = ls.linestyle; lst.color = (0.03, 0.035, 0.06); lst.thickness = 3.4; lst.caps = 'ROUND'
lst.chaining = 'PLAIN'; lst.use_same_object = True
lst.geometry_modifiers.new("smooth", 'BEZIER_CURVE').error = 3.0
lst.geometry_modifiers.new("tips", 'TIP_REMOVER').tip_length = 4.0
tap = lst.thickness_modifiers.new("taper", 'ALONG_STROKE'); tap.mapping = 'CURVE'; tap.blend = 'MULTIPLY'
pts = tap.curve.curves[0].points; pts[0].location = (0, 0.35); pts[1].location = (1, 0.35); pts.new(0.5, 1.0); tap.curve.update()

# ---------- light: soft key from upper-left-front, navy world, shadows on ----------
bpy.ops.object.light_add(type='SUN', rotation=(radians(48), radians(0), radians(-28)))
sun = bpy.context.object.data; sun.energy = 3.2; sun.angle = radians(4); sun.use_shadow = True
world = bpy.data.worlds.new("W"); scn.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.04, 0.07, 0.13, 1)

# ---------- camera ----------
vl.update()
dg = bpy.context.evaluated_depsgraph_get()
pts_ = []
for o in (body, hair):
    e = o.evaluated_get(dg); me = e.to_mesh(); pts_ += [o.matrix_world @ v.co for v in me.vertices]; e.to_mesh_clear()
mn = Vector((min(p.x for p in pts_), min(p.y for p in pts_), min(p.z for p in pts_)))
mx = Vector((max(p.x for p in pts_), max(p.y for p in pts_), max(p.z for p in pts_)))
top = mx.z
target = (mn + mx) / 2
H = max(mx.z - mn.z, (mx.x - mn.x) * 1600 / 1400 if POSE == "crouch" else (mx.x - mn.x) * 1.5)
dist = H * 1.18 / 2 / (18 / 85)
bpy.ops.object.camera_add(); cam = bpy.context.object; scn.camera = cam
CAM = dict(lens=45, el=0.12, az=-12) if POSE == "crouch" else dict(lens=60, el=0.0, az=0.0)
for a in argv:
    if a.startswith("--cam."):
        k, v = a[6:].split("="); CAM[k] = float(v)
cam.data.lens = CAM['lens']
dist *= CAM['lens'] / 85
if VIEW == "face":
    hw = arm.matrix_world @ pb("J_Bip_C_Head").head
    target = hw + Vector((0, 0, 0.08)); cam.data.lens = 135
    cam.location = target + Vector((0.0, -1, 0.05)).normalized() * 1.6
elif VIEW == "side":
    cam.location = target + Vector((-dist, 0, 0.1))
elif VIEW == "front":
    cam.location = target + Vector((0, -dist, 0.1))
else:
    az = radians(CAM['az'])
    cam.location = target + Vector((math.sin(az), -math.cos(az), CAM['el'])).normalized() * dist
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()

if "--nosweat" in argv:
    for o in scn.objects:
        if o.name.startswith("Sweat"): o.hide_render = True
scn.render.engine = 'BLENDER_EEVEE'
scn.eevee.taa_render_samples = 96
RW, RH = (1400, 1600) if POSE == "crouch" else (1600, 2400)
scn.render.resolution_x = RW; scn.render.resolution_y = RH
scn.render.film_transparent = True
scn.view_settings.view_transform = 'Standard'
scn.render.image_settings.file_format = 'PNG'; scn.render.image_settings.color_mode = 'RGBA'
scn.render.filepath = OUT
if BLEND: bpy.ops.wm.save_as_mainfile(filepath=BLEND)
bpy.ops.render.render(write_still=True)
print("DONE", OUT, "TOP", top)
