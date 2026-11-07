"""Doruk K-180 surface: UV atlases and baked weathering for the built model.

Called by doruk-k180_model.py after build(). The model is unwrapped into two atlases and
its look comes from procedural shaders baked on the GPU: edges lose their paint, the
underside takes mud, cavities take grime, and low panels rust. Every mask reads the
model's own shape, in chassis space, so a panel weathers where a real one would.

No dents go in here (contract VCD-D13): dents are runtime state. Glass, lamps, tyres and
rubber stay plain materials.

A bake's PNGs land in textures/ with a stamp of the scripts that made them. A stale or
missing stamp bakes again; --bake forces it.
"""

import hashlib
import math
import os

import bmesh
import bpy
from bpy_extras.bmesh_utils import bmesh_linked_uv_islands
from mathutils import Vector, noise

ATLASES = {
    "M_Atlas_Exterior": {"size": 4096, "members": {"M_Body": 1.0, "M_Grille": 1.0, "M_Rim": 0.7, "M_Steel": 0.6}},
    "M_Atlas_Cargo": {"size": 2048, "members": {"M_Wood": 1.0, "M_Engine": 0.4, "M_Interior": 0.4}},
}
BAKE_SAMPLES = 16
MARGIN_PIXELS = 12
SMALL_PART_SIZE = 0.30  # metres: a loose piece shorter than this is one flat island
SMALL_PART_AREA = 0.14  # square metres: so is a thin one, however long
HIDDEN_ISLAND_SCALE = 0.22  # the inside of a panel needs little of the atlas
SMALL_ISLAND_SCALE = 0.45  # nor does a bolt need a panel's detail


class Nodes:
    """A small vocabulary over a material's node tree."""

    def __init__(self, material):
        self.tree = material.node_tree
        self.tree.nodes.clear()
        self.geometry = self.tree.nodes.new("ShaderNodeNewGeometry")

    def link(self, socket, value):
        if isinstance(value, bpy.types.NodeSocket):
            self.tree.links.new(value, socket)
        else:
            socket.default_value = value

    def node(self, kind, **inputs):
        node = self.tree.nodes.new(kind)
        for name, value in inputs.items():
            self.link(node.inputs[name], value)
        return node

    def math(self, operation, a, b=0.0, clamp=False):
        node = self.tree.nodes.new("ShaderNodeMath")
        node.operation = operation
        node.use_clamp = clamp
        self.link(node.inputs[0], a)
        self.link(node.inputs[1], b)
        return node.outputs[0]

    def add(self, a, b):
        return self.math("ADD", a, b, True)

    def multiply(self, a, b):
        return self.math("MULTIPLY", a, b, True)

    def maximum(self, a, b):
        return self.math("MAXIMUM", a, b)

    def invert(self, a):
        return self.math("SUBTRACT", 1.0, a, True)

    def ramp(self, value, low, high):
        """0 at `low`, 1 at `high`, smooth between; either order."""
        node = self.tree.nodes.new("ShaderNodeMapRange")
        node.interpolation_type = "SMOOTHSTEP"
        self.link(node.inputs["Value"], value)
        if low < high:
            node.inputs["From Min"].default_value, node.inputs["From Max"].default_value = low, high
            return node.outputs[0]
        node.inputs["From Min"].default_value, node.inputs["From Max"].default_value = high, low
        return self.invert(node.outputs[0])

    def noise(self, vector, scale, detail=4.0, roughness=0.55):
        node = self.tree.nodes.new("ShaderNodeTexNoise")
        self.link(node.inputs["Vector"], vector)
        node.inputs["Scale"].default_value = scale
        node.inputs["Detail"].default_value = detail
        node.inputs["Roughness"].default_value = roughness
        return node.outputs[0]

    def stretch(self, x, y, z, offset=0.0):
        """Position with its axes scaled, to draw streaks."""
        node = self.tree.nodes.new("ShaderNodeVectorMath")
        node.operation = "MULTIPLY"
        self.link(node.inputs[0], self.geometry.outputs["Position"])
        node.inputs[1].default_value = (x, y, z)
        if not offset:
            return node.outputs[0]
        moved = self.tree.nodes.new("ShaderNodeVectorMath")
        moved.operation = "ADD"
        self.link(moved.inputs[0], node.outputs[0])
        moved.inputs[1].default_value = (offset, offset * 0.7, offset * 1.3)
        return moved.outputs[0]

    def mix(self, factor, a, b):
        node = self.tree.nodes.new("ShaderNodeMix")
        node.data_type = "RGBA"
        self.link(node.inputs[0], factor)
        for socket, value in ((node.inputs[6], a), (node.inputs[7], b)):
            self.link(socket, value if isinstance(value, bpy.types.NodeSocket) else (*value, 1.0))
        return node.outputs[2]

    def blend(self, factor, a, b):
        return self.math("ADD", self.math("MULTIPLY", self.invert(factor), a), self.math("MULTIPLY", factor, b))

    def axes(self, vector):
        return self.node("ShaderNodeSeparateXYZ", Vector=vector).outputs

    def ambient(self, distance, samples=8):
        node = self.tree.nodes.new("ShaderNodeAmbientOcclusion")
        node.samples = samples
        node.only_local = False
        node.inputs["Distance"].default_value = distance
        return node.outputs["AO"]

    def edges(self, radius):
        """1 on a sharp edge of either kind, 0 on a flat."""
        bevel = self.tree.nodes.new("ShaderNodeBevel")
        bevel.samples = 8
        bevel.inputs["Radius"].default_value = radius
        dot = self.tree.nodes.new("ShaderNodeVectorMath")
        dot.operation = "DOT_PRODUCT"
        self.link(dot.inputs[0], bevel.outputs["Normal"])
        self.link(dot.inputs[1], self.geometry.outputs["Normal"])
        return self.ramp(self.invert(dot.outputs["Value"]), 0.006, 0.12)


def surface(n, p):
    """A weathered painted or bare surface. Returns (colour, roughness, metallic, height)."""
    position = n.geometry.outputs["Position"]
    x, y, z = n.axes(position)
    up = n.axes(n.geometry.outputs["Normal"])[2]
    seed = p.get("seed", 0.0)

    broad = n.noise(n.stretch(1, 1, 1, seed), 1.4, 5.0)
    patch = n.noise(n.stretch(1, 1, 1, seed + 3.1), 5.5, 7.0, 0.6)
    grain = n.noise(n.stretch(1, 1, 1, seed + 7.7), 70.0, 4.0)
    streak = n.noise(n.stretch(9, 9, 0.8, seed + 1.9), 1.0, 5.0)

    near = n.ambient(0.10)
    wide = n.ambient(0.70)
    edge = n.edges(0.014)
    outer_edge = n.multiply(edge, n.ramp(near, 0.62, 0.92))  # concave edges are dark in the near AO
    cavity = n.invert(n.ramp(near, 0.30, 0.95))

    low = n.ramp(z, p.get("dirt_top", 1.15), p.get("dirt_bottom", 0.50))
    low = n.multiply(low, n.add(0.45, n.multiply(patch, 1.1)))

    # Paint: faded where the sun reaches it.
    faded = n.multiply(n.ramp(up, 0.15, 0.9), n.ramp(broad, 0.32, 0.72))
    colour = n.mix(n.multiply(faded, p.get("fade", 0.6)), p["paint"], p["paint_faded"])
    colour = n.mix(n.multiply(n.ramp(broad, 0.70, 0.40), 0.35), colour, p["paint_deep"])
    rough = n.blend(n.ramp(patch, 0.35, 0.65), p["rough"], p["rough"] + 0.12)
    metal = p.get("metal", 0.0)
    height = 0.5

    # Chips: small flakes down to bare metal, thick along outer edges.
    chips = n.ramp(n.add(grain, n.multiply(n.add(outer_edge, n.multiply(patch, 0.22)), p.get("chip", 0.34))), 0.72, 0.76)
    colour = n.mix(chips, colour, p["bare"])
    rough = n.blend(chips, rough, 0.55)
    metal = n.blend(chips, metal, 0.6)
    height = n.blend(chips, height, 0.42)

    # Rust: on outer edges, in patches, and in streaks low on the panels.
    edge_rust = n.multiply(outer_edge, n.ramp(patch, 0.45, 0.53))
    low_rust = n.multiply(n.ramp(z, 1.22, 1.0), n.ramp(n.add(streak, n.multiply(patch, 0.3)), 0.66, 0.74))
    specks = n.ramp(n.multiply(n.add(grain, 0.2), n.add(patch, 0.25)), 0.64, 0.67)
    rust = n.multiply(n.add(n.add(edge_rust, low_rust), specks), p.get("rust", 1.0))
    rust_colour = n.mix(n.ramp(grain, 0.38, 0.62), (0.055, 0.024, 0.012), (0.27, 0.095, 0.03))
    colour = n.mix(rust, colour, rust_colour)
    rough = n.blend(rust, rough, 0.9)
    metal = n.blend(rust, metal, 0.0)
    height = n.blend(rust, height, n.math("ADD", 0.45, n.multiply(grain, 0.25)))

    # Grime in cavities and in shade, then dust and mud from below.
    grime = n.multiply(n.add(cavity, n.multiply(n.invert(wide), 0.5)), p.get("grime", 0.8))
    colour = n.mix(grime, colour, (0.035, 0.028, 0.022))
    rough = n.blend(grime, rough, 0.85)
    mud = n.multiply(n.ramp(n.add(low, n.multiply(grain, 0.25)), 0.40, 0.68), p.get("mud", 0.85))
    mud_colour = n.mix(n.ramp(patch, 0.35, 0.65), (0.040, 0.030, 0.021), (0.115, 0.086, 0.058))
    colour = n.mix(mud, colour, mud_colour)
    rough = n.blend(mud, rough, 0.96)
    metal = n.blend(mud, metal, 0.0)
    height = n.blend(mud, height, n.math("ADD", 0.52, n.multiply(patch, 0.16)))
    # A film of dust on what faces the sky.
    dust = n.multiply(n.multiply(n.ramp(up, 0.25, 0.95), n.ramp(broad, 0.38, 0.68)), p.get("dust", 0.28))
    colour = n.mix(dust, colour, (0.24, 0.205, 0.165))
    rough = n.blend(dust, rough, 0.8)
    return colour, rough, metal, height


def wood(n, p):
    """Planks along the truck: grain, old blue paint in patches, grey where it has weathered."""
    planks = n.noise(n.stretch(55, 55, 1.6, 2.2), 1.0, 7.0, 0.62)
    fibres = n.noise(n.stretch(240, 240, 3.0, 4.1), 1.0, 3.0)
    patch = n.noise(n.stretch(1.3, 1.3, 1.0, 6.3), 2.6, 6.0)
    z = n.axes(n.geometry.outputs["Position"])[2]
    base = n.mix(n.ramp(n.multiply(planks, n.add(fibres, 0.45)), 0.18, 0.5), (0.085, 0.052, 0.03), (0.33, 0.235, 0.14))
    grey = n.ramp(patch, 0.34, 0.60)
    colour = n.mix(n.multiply(grey, 0.55), base, (0.26, 0.24, 0.21))
    paint = n.multiply(n.ramp(n.add(n.multiply(patch, 0.8), n.multiply(planks, 0.75)), 0.72, 0.76), p.get("paint_left", 0.75))
    colour = n.mix(paint, colour, (0.05, 0.115, 0.21))
    grime = n.invert(n.ramp(n.ambient(0.12), 0.35, 0.95))
    colour = n.mix(n.multiply(grime, 0.85), colour, (0.02, 0.016, 0.012))
    mud = n.multiply(n.ramp(z, 1.55, 1.2), n.ramp(patch, 0.4, 0.62))
    colour = n.mix(mud, colour, (0.17, 0.13, 0.09))
    rough = n.blend(paint, 0.88, 0.62)
    height = n.math("ADD", n.multiply(planks, 0.6), n.multiply(fibres, 0.3))
    return colour, rough, 0.0, height


LOOKS = {
    "M_Body": dict(paint=(0.040, 0.105, 0.235), paint_faded=(0.085, 0.165, 0.29), paint_deep=(0.022, 0.058, 0.135),
                   bare=(0.20, 0.20, 0.205), rough=0.40, fade=0.75, rust=0.95, mud=0.9, seed=0.0),
    "M_Grille": dict(paint=(0.34, 0.33, 0.31), paint_faded=(0.46, 0.45, 0.42), paint_deep=(0.20, 0.195, 0.18),
                     bare=(0.5, 0.5, 0.5), rough=0.42, metal=0.75, chip=0.2, rust=0.55, grime=1.0, mud=0.5, seed=5.0),
    "M_Steel": dict(paint=(0.030, 0.030, 0.033), paint_faded=(0.055, 0.052, 0.05), paint_deep=(0.016, 0.016, 0.018),
                    bare=(0.26, 0.25, 0.24), rough=0.58, metal=0.4, rust=0.32, mud=0.6, dust=0.12, seed=9.0),
    "M_Rim": dict(paint=(0.05, 0.05, 0.053), paint_faded=(0.08, 0.078, 0.075), paint_deep=(0.03, 0.03, 0.032),
                  bare=(0.24, 0.24, 0.24), rough=0.5, metal=0.3, rust=0.3, mud=0.7, dirt_top=1.0, dirt_bottom=0.2, seed=12.0),
    "M_Engine": dict(paint=(0.11, 0.11, 0.115), paint_faded=(0.15, 0.15, 0.15), paint_deep=(0.06, 0.06, 0.06),
                     bare=(0.3, 0.3, 0.3), rough=0.55, metal=0.3, rust=0.5, mud=0.25, dust=0.1, seed=15.0),
    "M_Interior": dict(paint=(0.085, 0.078, 0.07), paint_faded=(0.11, 0.10, 0.09), paint_deep=(0.05, 0.046, 0.04),
                       bare=(0.15, 0.14, 0.13), rough=0.78, rust=0.0, mud=0.25, chip=0.1, dust=0.15, seed=18.0),
}
WOOD = "M_Wood"


def dust_tyres():
    """Tyres have too many lugs for an atlas: their vertices carry the dust. It sits on the
    lug tops and the shoulders; the grooves stay dark."""
    material = bpy.data.materials["M_Tyre"]
    tree = material.node_tree
    shader = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
    colours = tree.nodes.new("ShaderNodeVertexColor")
    colours.layer_name = "Col"
    tree.links.new(colours.outputs["Color"], shader.inputs["Base Color"])
    for obj in bpy.data.objects:
        if obj.type != "MESH" or not obj.data.materials or obj.data.materials[0] is not material:
            continue
        mesh = obj.data
        attribute = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        mesh.color_attributes.active_color = attribute
        wheel = obj.name.startswith("Wheel_")
        values = []
        for vert in mesh.vertices:
            at = obj.matrix_world @ vert.co
            mottling = 0.5 + 0.5 * noise.noise(at * 7.0)
            if wheel:
                radius = math.hypot(vert.co.y, vert.co.z)
                dust = (0.25 + 0.75 * mottling) * max(0.0, min(1.0, (radius - 0.50) / 0.05))
                dust = max(dust, 0.32 * mottling)
            else:
                dust = 0.55 * max(0.0, min(1.0, (0.9 - at.z) / 0.6)) * mottling
            shade = 0.016 + 0.17 * dust
            values += [shade * 1.06, shade * 0.96, shade * 0.82, 1.0]
        attribute.data.foreach_set("color", values)


def stamp():
    digest = hashlib.sha256()
    here = os.path.dirname(os.path.abspath(__file__))
    for name in ("doruk-k180_model.py", "doruk-k180_texture.py"):
        digest.update(open(os.path.join(here, name), "rb").read())
    return digest.hexdigest()


def members_of(atlas):
    names = ATLASES[atlas]["members"]
    return [obj for obj in bpy.data.objects if obj.type == "MESH" and obj.data.materials and obj.data.materials[0].name in names]


def activate(objects, mode):
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if mode != "OBJECT":
        bpy.ops.object.mode_set(mode=mode)


def linked_parts(bm):
    """The mesh's loose pieces, as lists of faces."""
    seen, parts = set(), []
    for face in bm.faces:
        if face in seen:
            continue
        part, stack = [], [face]
        seen.add(face)
        while stack:
            current = stack.pop()
            part.append(current)
            for edge in current.edges:
                for other in edge.link_faces:
                    if other not in seen:
                        seen.add(other)
                        stack.append(other)
        parts.append(part)
    return parts


def flatten_small_parts(obj):
    """Thousands of bolts and tubes would each take an island and a margin, and the margins
    alone would shrink the panels. Each small piece becomes one island, projected along its
    thinnest axis; both of its sides share those pixels. The rest is selected for unwrapping."""
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    bm = bmesh.new()
    bm.from_mesh(mesh)
    uv = bm.loops.layers.uv.active
    for part in linked_parts(bm):
        points = [vert.co for face in part for vert in face.verts]
        low = [min(point[i] for point in points) for i in range(3)]
        high = [max(point[i] for point in points) for i in range(3)]
        size = [b - a for a, b in zip(low, high)]
        small = max(size) < SMALL_PART_SIZE or sum(face.calc_area() for face in part) < SMALL_PART_AREA
        for face in part:
            face.select_set(not small)
        if not small:
            continue
        thin = size.index(min(size))
        u, v = [axis for axis in range(3) if axis != thin]
        for face in part:
            for loop in face.loops:
                loop[uv].uv = (loop.vert.co[u] - low[u], loop.vert.co[v] - low[v])
    bm.to_mesh(mesh)
    bm.free()


def exposed(obj, faces, depsgraph):
    """Whether light reaches this island: rays leave a sample of its faces outwards, and an
    island whose rays nearly all hit the truck is the inside of something."""
    scene = bpy.context.scene
    matrix = obj.matrix_world
    turn = matrix.to_3x3()
    step = max(1, len(faces) // 16)
    hits = rays = 0
    for face in faces[::step]:
        origin = matrix @ face.calc_center_median()
        normal = (turn @ face.normal).normalized()
        side = normal.orthogonal().normalized()
        other = normal.cross(side)
        origin = origin + normal * 0.012
        for direction in (normal, normal + side, normal - side, normal + other, normal - other):
            hit = scene.ray_cast(depsgraph, origin, direction.normalized(), distance=2.5)[0]
            rays += 1
            hits += 1 if hit else 0
    return hits < rays * 0.8


def uv_area(face, uv):
    points = [loop[uv].uv for loop in face.loops]
    return abs(sum(a.x * b.y - b.x * a.y for a, b in zip(points, points[1:] + points[:1]))) / 2


def weigh_islands(obj, weight, depsgraph):
    """Brings every island to the same pixels per metre, then scales it by what it is worth;
    a pack keeps these proportions. Smart Project leaves its islands in units of its own, so
    this is also what makes a panel and a bolt comparable."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv.active
    for island in bmesh_linked_uv_islands(bm, uv):
        faces = list(island)
        flat = sum(uv_area(face, uv) for face in faces)
        if flat < 1e-12:
            continue
        worth = weight if exposed(obj, faces, depsgraph) else weight * HIDDEN_ISLAND_SCALE
        if sum(face.calc_area() for face in faces) < SMALL_PART_AREA:
            worth = min(worth, SMALL_ISLAND_SCALE)
        scale = worth * math.sqrt(sum(face.calc_area() for face in faces) / flat)
        loops = [loop for face in faces for loop in face.loops]
        centre = sum((loop[uv].uv for loop in loops), Vector((0.0, 0.0))) / len(loops)
        for loop in loops:
            loop[uv].uv = centre + (loop[uv].uv - centre) * scale
    bm.to_mesh(obj.data)
    bm.free()


def unwrap(atlas):
    """One UV space for every member, panels given room by their weight."""
    objects = members_of(atlas)
    weights = ATLASES[atlas]["members"]
    margin = MARGIN_PIXELS / ATLASES[atlas]["size"]
    activate(objects, "OBJECT")
    for obj in objects:
        flatten_small_parts(obj)
    activate(objects, "EDIT")
    bpy.context.tool_settings.use_uv_select_sync = True
    bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        weigh_islands(obj, weights[obj.data.materials[0].name], depsgraph)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, rotate_method="CARDINAL", scale=True, margin_method="FRACTION", margin=margin, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.tool_settings.use_uv_select_sync = False
    hood = bpy.data.objects.get("Hood")
    if hood in objects:
        area = sum(polygon.area for polygon in hood.data.polygons)
        uv_area = 0.0
        layer = hood.data.uv_layers.active.data
        for polygon in hood.data.polygons:
            points = [layer[i].uv for i in polygon.loop_indices]
            for a, b in zip(points, points[1:] + points[:1]):
                uv_area += (a.x * b.y - b.x * a.y) / 2
        print(f"ATLAS {atlas}: hood {ATLASES[atlas]['size'] * math.sqrt(abs(uv_area) / area):.0f} px/m")


def bake_device():
    preferences = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            preferences.compute_device_type = kind
        except TypeError:
            continue
        preferences.get_devices()
        found = [device for device in preferences.devices if device.type == kind]
        if found:
            for device in preferences.devices:
                device.use = device.type == kind
            return "GPU"
    return "CPU"


def bake_pass(atlas, size, name, wire, bake_type, directory, colorspace):
    """Bakes one image over the atlas: `wire(nodes, look)` connects each material's output."""
    image = bpy.data.images.new(f"{atlas}_{name}", size, size, alpha=False, float_buffer=False)
    image.colorspace_settings.name = colorspace
    fill = (0.5, 0.5, 1.0, 1.0) if name == "Normal" else (0.0, 0.0, 0.0, 1.0)
    image.generated_color = fill
    for look_name in ATLASES[atlas]["members"]:
        material = bpy.data.materials[look_name]
        material.use_nodes = True
        n = Nodes(material)
        parts = wood(n, {}) if look_name == WOOD else surface(n, LOOKS[look_name])
        output = n.tree.nodes.new("ShaderNodeOutputMaterial")
        shader = wire(n, parts)
        n.tree.links.new(shader, output.inputs["Surface"])
        target = n.tree.nodes.new("ShaderNodeTexImage")
        target.image = image
        n.tree.nodes.active = target
    activate(members_of(atlas), "OBJECT")
    scene = bpy.context.scene
    scene.render.bake.margin = MARGIN_PIXELS
    scene.render.bake.margin_type = "EXTEND"
    scene.render.bake.use_clear = True
    scene.render.bake.target = "IMAGE_TEXTURES"
    if bake_type == "NORMAL":
        scene.render.bake.normal_space = "TANGENT"
    bpy.ops.object.bake(type=bake_type)
    path = os.path.join(directory, f"{atlas}_{name}.png")
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    print(f"BAKED {path}")
    bpy.data.images.remove(image)


def emission(n, value):
    return n.node("ShaderNodeEmission", Color=value, Strength=1.0).outputs[0]


def wire_colour(n, parts):
    return emission(n, parts[0])


def wire_surface(n, parts):
    """Blue carries metallic and green roughness, as glTF reads them."""
    combine = n.tree.nodes.new("ShaderNodeCombineColor")
    n.link(combine.inputs[0], 0.0)
    n.link(combine.inputs[1], parts[1])
    n.link(combine.inputs[2], parts[2])
    return emission(n, combine.outputs[0])


def wire_normal(n, parts):
    bump = n.node("ShaderNodeBump", Height=parts[3], Strength=0.75, Distance=0.006)
    return n.node("ShaderNodeBsdfPrincipled", Normal=bump.outputs[0]).outputs[0]


def bake(directory):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = bake_device()
    scene.cycles.samples = BAKE_SAMPLES
    scene.cycles.use_denoising = False
    print(f"BAKE on {scene.cycles.device}")
    os.makedirs(directory, exist_ok=True)
    for atlas, settings in ATLASES.items():
        size = settings["size"]
        bake_pass(atlas, size, "Colour", wire_colour, "EMIT", directory, "sRGB")
        bake_pass(atlas, size, "Surface", wire_surface, "EMIT", directory, "Non-Color")
        bake_pass(atlas, size, "Normal", wire_normal, "NORMAL", directory, "Non-Color")
    with open(os.path.join(directory, "stamp.txt"), "w", encoding="utf-8") as out:
        out.write(stamp())


def atlas_material(atlas, directory):
    """The material glTF exports: three images, no procedural left."""
    material = bpy.data.materials.new(atlas)
    material.use_nodes = True
    tree = material.node_tree
    shader = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")

    def image_node(name, colorspace):
        node = tree.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(os.path.join(directory, f"{atlas}_{name}.png"), check_existing=True)
        node.image.colorspace_settings.name = colorspace
        return node

    tree.links.new(image_node("Colour", "sRGB").outputs["Color"], shader.inputs["Base Color"])
    split = tree.nodes.new("ShaderNodeSeparateColor")
    tree.links.new(image_node("Surface", "Non-Color").outputs["Color"], split.inputs[0])
    tree.links.new(split.outputs[1], shader.inputs["Roughness"])
    tree.links.new(split.outputs[2], shader.inputs["Metallic"])
    normal = tree.nodes.new("ShaderNodeNormalMap")
    tree.links.new(image_node("Normal", "Non-Color").outputs["Color"], normal.inputs["Color"])
    tree.links.new(normal.outputs[0], shader.inputs["Normal"])
    return material


def apply(here, force=False):
    """Unwraps, bakes if the textures are out of date, and swaps the atlas materials in."""
    directory = os.path.join(here, "textures")
    stamp_path = os.path.join(directory, "stamp.txt")
    current = os.path.exists(stamp_path) and open(stamp_path, encoding="utf-8").read() == stamp()
    for atlas in ATLASES:
        unwrap(atlas)
    if force or not current:
        bake(directory)
    for atlas in ATLASES:
        objects = members_of(atlas)
        material = atlas_material(atlas, directory)
        for obj in objects:
            obj.data.materials[0] = material
    dust_tyres()
    bpy.ops.object.select_all(action="DESELECT")
