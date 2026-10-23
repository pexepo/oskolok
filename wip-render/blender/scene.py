import bpy, bmesh, sys, math
from math import radians
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--")+1:]
SRC, OUT = argv[0], argv[1]
QUESTION = "--question" in argv
BLEND = next((a.split("=",1)[1] for a in argv if a.startswith("--blend=")), None)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scn = bpy.context.scene
vl = bpy.context.view_layer
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
bpy.data.objects["Icosphere"].hide_render = True
face = bpy.data.objects["Face"]; body = bpy.data.objects["Body"]; hair = bpy.data.objects["Hair"]

# ---------- helpers ----------
def pb(n): return arm.pose.bones[n]
def rot(name, axis, deg):
    vl.update()
    b = pb(name); m = b.matrix.copy(); h = m.translation.copy()
    b.matrix = Matrix.Translation(h) @ Matrix.Rotation(radians(deg), 4, axis) @ Matrix.Translation(-h) @ m
    vl.update()
X, Y, Z = 'X', 'Y', 'Z'

def toon(name, color, shadow=0.55):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = 'CONSTANT'
    e = ramp.color_ramp.elements
    e[0].position = 0.0; e[0].color = (*[c*shadow for c in color], 1)
    e[1].position = 0.12; e[1].color = (*color, 1)
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(dif.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], em.inputs[0])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m

def outline(obj, thick=0.006):
    mat = bpy.data.materials.get("Outline")
    if not mat:
        mat = bpy.data.materials.new("Outline"); mat.use_nodes = True
        nt = mat.node_tree; nt.nodes.clear()
        o = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
        em.inputs[0].default_value = (0.05, 0.04, 0.05, 1)
        nt.links.new(em.outputs[0], o.inputs[0])
        mat.use_backface_culling = True
    obj.data.materials.append(mat)
    mod = obj.modifiers.new("outline", 'SOLIDIFY')
    mod.thickness = thick; mod.offset = 1; mod.use_flip_normals = True
    mod.material_offset = len(obj.data.materials) - 1
    for s in obj.data.materials[:-1]: s.use_backface_culling = True

# ---------- hard hat (built in rest pose, parented to head bone) ----------
YEL = (1.0, 0.72, 0.05)
C = Vector((0.0, 0.04, 1.875))
def ellipsoid_dome(name, r, zr, cut=0.0):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut - 1e-4], context='VERTS')
    for v in bm.verts: v.co = Vector((v.co.x*r[0], v.co.y*r[1], v.co.z*zr))
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); scn.collection.objects.link(ob); return ob

dome = ellipsoid_dome("HatDome", (0.166, 0.18), 0.19)
dome.location = C
sol = dome.modifiers.new("thick", 'SOLIDIFY'); sol.thickness = 0.012
# ridge on top (front-to-back)
ridge = ellipsoid_dome("HatRidge", (0.042, 0.19), 0.204)
ridge.location = C
# brim: flat ring, bigger in front (peak)
me = bpy.data.meshes.new("HatBrim"); bm = bmesh.new()
N = 128
inner, outer = [], []
for i in range(N):
    a = 2*math.pi*i/N
    cx, cy = math.sin(a), -math.cos(a)  # a=0 -> front (-Y)
    front = max(0.0, -cy)  # 1 at front
    ri = (0.164, 0.178); ro = 0.012 + 0.085*front**1.8 + 0.012*max(0.0, cy)
    inner.append(bm.verts.new((cx*ri[0], cy*ri[1], 0.0)))
    outer.append(bm.verts.new((cx*(ri[0]+ro), cy*(ri[1]+ro), -0.006 - 0.022*front + 0.004*max(0.0, cy))))
for i in range(N):
    j = (i+1) % N
    bm.faces.new((inner[i], inner[j], outer[j], outer[i]))
bm.to_mesh(me); bm.free()
brim = bpy.data.objects.new("HatBrim", me); scn.collection.objects.link(brim)
brim.location = C
brim.modifiers.new("thick", 'SOLIDIFY').thickness = 0.012
hat_mat = toon("HardHat", YEL)
rib_mat = toon("HardHatRib", (0.93, 0.6, 0.02))
for o in (dome, ridge, brim):
    o.data.materials.append(rib_mat if o is ridge else hat_mat)
    for p in o.data.polygons: p.use_smooth = True
    outline(o, 0.005)
head = pb("J_Bip_C_Head")
for o in (dome, ridge, brim):
    vl.update()
    mw = o.matrix_world.copy()
    o.parent = arm; o.parent_type = 'BONE'; o.parent_bone = "J_Bip_C_Head"
    vl.update()
    o.matrix_world = mw

# ---------- face: blank, clueless ----------
keys = face.data.shape_keys.key_blocks
FACES = [
    {"Fcl_EYE_Surprised": 0.55, "Fcl_EYE_Highlight_Hide": 1.0, "Fcl_BRW_Sorrow": 0.35, "Fcl_MTH_A": 0.22, "Fcl_MTH_Small": 0.4},
    {"Fcl_EYE_Close": 0.3, "Fcl_EYE_Highlight_Hide": 1.0, "Fcl_MTH_O": 0.35, "Fcl_BRW_Surprised": 0.3},
    {"Fcl_EYE_Spread": 0.7, "Fcl_EYE_Highlight_Hide": 1.0, "Fcl_MTH_Surprised": 0.35, "Fcl_BRW_Sorrow": 0.5},
    {"Fcl_EYE_Surprised": 1.0, "Fcl_EYE_Highlight_Hide": 1.0, "Fcl_MTH_O": 0.45, "Fcl_BRW_Surprised": 0.6, "Fcl_EYE_Close": 0.15},
    {"Fcl_EYE_Close": 0.42, "Fcl_EYE_Highlight_Hide": 1.0, "Fcl_MTH_A": 0.3, "Fcl_MTH_Down": 0.4, "Fcl_BRW_Sorrow": 0.25},
    {"Fcl_EYE_Spread": 1.0, "Fcl_EYE_Surprised": 0.6, "Fcl_EYE_Highlight_Hide": 1.0, "Fcl_MTH_Small": 0.6, "Fcl_MTH_O": 0.25, "Fcl_BRW_Angry": 0.0, "Fcl_BRW_Sorrow": 0.6},
]
FACES[3]["Fcl_MTH_O"] = 0.0; FACES[3]["Fcl_MTH_Small"] = 0.35
FACE = int(next((a.split("=",1)[1] for a in argv if a.startswith("--face=")), "3"))
for k, v in FACES[FACE].items():
    keys[k].value = v

# ---------- pose: slumped sitting ----------
rot("J_Bip_C_Spine", X, 3); rot("J_Bip_C_Chest", X, 2)
rot("J_Bip_C_Neck", X, 4)
rot("J_Bip_C_Head", X, -4); rot("J_Bip_C_Head", Y, -12); rot("J_Bip_C_Head", Z, 10)
for s, sg in (("L", 1), ("R", -1)):
    rot(f"J_Bip_{s}_UpperLeg", X, -86); rot(f"J_Bip_{s}_UpperLeg", Z, -7*sg)
    rot(f"J_Bip_{s}_LowerLeg", X, 80); rot(f"J_Bip_{s}_LowerLeg", Y, -12*sg)
    rot(f"J_Bip_{s}_Foot", Z, -18*sg)
    rot(f"J_Bip_{s}_UpperArm", Y, 80*sg); rot(f"J_Bip_{s}_UpperArm", X, -22); rot(f"J_Bip_{s}_UpperArm", Z, 6*sg)
    rot(f"J_Bip_{s}_LowerArm", X, -40); rot(f"J_Bip_{s}_LowerArm", Z, -44*sg)
    rot(f"J_Bip_{s}_Hand", X, 22); rot(f"J_Bip_{s}_Hand", Z, -5*sg)
    for f in ("Index", "Middle", "Ring", "Little"):
        for i, a in ((1, 10), (2, 14), (3, 10)):
            rot(f"J_Bip_{s}_{f}{i}", Y, -a*sg)
# skirts: lift front panels over the thighs
for b in arm.pose.bones:
    n = b.name
    if not n.startswith("J_Sec_") or "Skirt" not in n or "end" in n: continue
    if n.split("_")[-1] != "01": continue
    if "Front" in n: rot(n, X, -82)
    elif "Side" in n: rot(n, X, -55)
    elif "Back" in n: rot(n, X, -10)

vl.update()
dg = bpy.context.evaluated_depsgraph_get()
def eval_verts(o):
    e = o.evaluated_get(dg); me = e.to_mesh()
    vs = [o.matrix_world @ v.co for v in me.vertices]; e.to_mesh_clear(); return vs
bv = eval_verts(body)
minz = min(v.z for v in bv)
hips = arm.matrix_world @ pb("J_Bip_C_Hips").head
butt = [v for v in bv if abs(v.x) < 0.17 and hips.y - 0.05 < v.y < hips.y + 0.2 and v.z < hips.z + 0.05]
seat_z = min(v.z for v in butt)
print("MINZ", minz, "SEAT", seat_z, "HIPS", hips)
arm.location.z -= minz
seat_z -= minz; hips.z -= minz

# ---------- props: crate seat + traffic cone ----------
def box(name, size, loc, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    bev = o.modifiers.new("bevel", 'BEVEL'); bev.width = 0.012; bev.segments = 2
    o.data.materials.append(mat); outline(o, 0.006); return o
wood = toon("Crate", (0.62, 0.42, 0.24), 0.6)
wood_d = toon("CrateDark", (0.42, 0.27, 0.15), 0.6)
cw, cd = 0.86, 0.62
cy = hips.y - 0.06
box("Crate", (cw, cd, seat_z), (0, cy, seat_z/2), wood)
for zz in (0.12, 0.5, 0.88):
    for yy in (-1, 1):
        box("Slat", (cw + 0.012, 0.014, seat_z*0.08), (0, cy + yy*cd/2, seat_z*zz), wood_d)

# traffic cone
org = toon("Cone", (1.0, 0.33, 0.08)); wht = toon("ConeWhite", (0.96, 0.95, 0.92))
cone_x = -0.8
bpy.ops.mesh.primitive_cube_add(size=1, location=(cone_x, -0.05, 0.02))
base = bpy.context.object; base.scale = (0.36, 0.36, 0.04); bpy.ops.object.transform_apply(scale=True)
base.modifiers.new("b", 'BEVEL').width = 0.02; base.data.materials.append(org); outline(base)
bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.15, radius2=0.025, depth=0.62, location=(cone_x, -0.05, 0.04 + 0.31))
cone = bpy.context.object; cone.data.materials.append(org); cone.data.materials.append(wht)
for p in cone.data.polygons:
    p.use_smooth = True
    z = p.center.z + 0.31  # 0..0.62 from bottom
    if 0.22 < z < 0.32 or 0.42 < z < 0.5: p.material_index = 1
outline(cone, 0.006)
# re-slice cone faces into bands
bm = bmesh.new(); bm.from_mesh(cone.data)
for h in (0.22, 0.32, 0.42, 0.5):
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:]+bm.edges[:]+bm.faces[:], plane_co=(0,0,h-0.31), plane_no=(0,0,1))
bm.to_mesh(cone.data); bm.free()
for p in cone.data.polygons:
    z = p.center.z + 0.31
    p.material_index = 1 if (0.22 < z < 0.32 or 0.42 < z < 0.5) and p.normal.z < 0.99 else 0

# question marks
if QUESTION:
    qm = toon("Question", (0.15, 0.13, 0.17), 0.8)
    for i, (dx, dz, s, r) in enumerate(((0.28, 2.05, 0.2, -12), (0.43, 1.9, 0.13, 10), (0.18, 2.3, 0.1, 18))):
        bpy.ops.object.text_add(location=(dx, hips.y - 0.05, dz - minz))
        t = bpy.context.object; t.data.body = "?"; t.data.size = s; t.data.extrude = 0.012
        t.data.align_x = 'CENTER'; t.rotation_euler = (radians(90), radians(r), radians(-12))
        t.data.materials.append(qm)

# ---------- lighting / camera / render ----------
bpy.ops.object.light_add(type='SUN', rotation=(radians(50), radians(-10), radians(-35)))
bpy.context.object.data.energy = 3.0; bpy.context.object.data.angle = radians(6)
world = bpy.data.worlds.new("W"); scn.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.2, 0.2, 0.2, 1)

CLOSE = "--close" in argv
head_w = arm.matrix_world @ pb("J_Bip_C_Head").head
if CLOSE:
    target = head_w + Vector((0, 0, 0.08))
    for o in (dome, ridge, brim): o.hide_render = "--nohat" in argv
else:
    target = Vector((-0.2, hips.y, head_w.z * 0.53))
bpy.ops.object.camera_add()
cam = bpy.context.object; scn.camera = cam
SIDE = "--side" in argv
cam.data.lens = 85 if not CLOSE else 135
off = Vector((0.9, -5.4, 1.15)) if not CLOSE else Vector((0.5, -2.4, 0.0))
cam.location = target + off
if SIDE: cam.location = target + Vector((-5.5, 0, 0)); cam.data.lens = 70
d = target - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

# ---------- line art (Freestyle) on the character ----------
LINEART = "--lineart" in argv
char = bpy.data.collections.new("Character"); scn.collection.children.link(char)
for o in (body, face, hair): char.objects.link(o)
scn.render.use_freestyle = True
scn.render.line_thickness_mode = 'ABSOLUTE'
fs = vl.freestyle_settings
fs.crease_angle = radians(100)
ls = fs.linesets[0] if fs.linesets else fs.linesets.new("LineSet")
ls.select_by_collection = not LINEART; ls.collection = char
ls.select_by_visibility = True; ls.visibility = 'VISIBLE'
ls.select_silhouette = True; ls.select_border = False; ls.select_crease = True
ls.select_external_contour = True
if ls.linestyle is None: ls.linestyle = bpy.data.linestyles.new("Line")
ls.linestyle.color = (0.05, 0.04, 0.05)
lst = ls.linestyle
lst.thickness = 3.4
lst.caps = 'ROUND'
lst.chaining = 'PLAIN'; lst.use_same_object = True
lst.geometry_modifiers.new("smooth", 'BEZIER_CURVE').error = 3.0
lst.geometry_modifiers.new("tips", 'TIP_REMOVER').tip_length = 4.0
tap = lst.thickness_modifiers.new("taper", 'ALONG_STROKE')
tap.mapping = 'CURVE'; tap.blend = 'MULTIPLY'; tap.influence = 1.0
cv = tap.curve; pts = cv.curves[0].points
pts[0].location = (0, 0.35); pts[1].location = (1, 0.35); pts.new(0.5, 1.0)
cv.update()
# solid hull outline on the body mesh: closes gaps where skin touches skin (hands on knees)
if not LINEART:
    om = bpy.data.materials.get("Outline")
    body.data.materials.append(om)
    hm = body.modifiers.new("outline", 'SOLIDIFY')
    hm.thickness = 0.0075; hm.offset = 1; hm.use_flip_normals = True; hm.use_rim = False
    hm.material_offset = len(body.data.materials) - 1
    # thin the hull on hands/fingers so it doesn't blob between fingers
    hand_groups = [vg.index for vg in body.vertex_groups if any(k in vg.name for k in ("Hand", "Thumb", "Index", "Middle", "Ring", "Little"))]
    ow = body.vertex_groups.new(name="outline_w")
    for v in body.data.vertices:
        hw = sum(g.weight for g in v.groups if g.group in hand_groups)
        ow.add([v.index], max(0.0, 1.0 - hw), 'REPLACE')
    hm.vertex_group = "outline_w"; hm.thickness_vertex_group = 0.2
if LINEART:
    flat = bpy.data.materials.new("Paper"); flat.use_nodes = True
    nt = flat.node_tree; nt.nodes.clear()
    o_ = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (1, 1, 1, 1); nt.links.new(em.outputs[0], o_.inputs[0])
    for ob in scn.objects:
        if ob.type in ('MESH', 'FONT'):
            for m in ob.modifiers:
                if m.name == "outline": m.show_render = False
            for slot in ob.material_slots: slot.link = 'OBJECT'; slot.material = flat
    ls.select_border = True

scn.render.engine = 'BLENDER_EEVEE'
scn.render.resolution_x = 1600; scn.render.resolution_y = 2000
scn.render.film_transparent = True
scn.view_settings.view_transform = 'Standard'
scn.render.image_settings.file_format = 'PNG'
scn.render.image_settings.color_mode = 'RGBA'
scn.render.filepath = OUT
if BLEND: bpy.ops.wm.save_as_mainfile(filepath=BLEND)
bpy.ops.render.render(write_still=True)
print("DONE", OUT)
