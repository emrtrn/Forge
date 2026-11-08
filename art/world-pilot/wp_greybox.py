"""World Builder pilot greybox models (docs/world-builder/PILOT_MOUNTAIN_VALLEY.md).

Run: blender --background --factory-startup --python art/world-pilot/wp_greybox.py

Blender Z up, metres. Each model stands on the origin with its front towards -Y,
which the glTF +Y Up export turns into +Z, the direction World Builder placements
face. Flat colours only: these models settle form, size and placement.
"""
import math
import os
import random

import bpy

SCRIPT_PATH = os.path.abspath(__file__) if os.path.isabs(__file__) else os.path.abspath(os.path.join(os.getcwd(), __file__))
ROOT = os.path.normpath(os.path.join(os.path.dirname(SCRIPT_PATH), "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "world-builder")
COLOURS = {
    "stone": (0.42, 0.41, 0.38), "plank": (0.46, 0.31, 0.18), "timber": (0.36, 0.23, 0.13),
    "roof": (0.24, 0.20, 0.17), "door": (0.30, 0.19, 0.11), "glass": (0.14, 0.20, 0.24),
    "log": (0.50, 0.36, 0.22), "sign": (0.62, 0.50, 0.32), "rock": (0.47, 0.46, 0.43),
}


def linear(channel):
    """COLOURS are display (sRGB) values; Blender and glTF take linear ones."""
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name):
    found = bpy.data.materials.get(name)
    if found:
        return found
    made = bpy.data.materials.new(name)
    made.use_nodes = True
    node = made.node_tree.nodes["Principled BSDF"]
    node.inputs["Base Color"].default_value = (*(linear(channel) for channel in COLOURS[name]), 1)
    node.inputs["Roughness"].default_value = 0.9
    return made


def add_mesh(name, verts, faces, colour):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    mesh.materials.append(material(colour))
    item = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(item)
    return item


def box(name, low, high, colour):
    x0, y0, z0 = low
    x1, y1, z1 = high
    verts = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return add_mesh(name, verts, faces, colour)


def gable(name, half_width, front, back, eave, ridge, thickness, colour):
    """A roof over X, ridge along Y: two sloped slabs meeting at the ridge."""
    verts = [
        (-half_width, front, eave), (0, front, ridge), (half_width, front, eave),
        (-half_width, back, eave), (0, back, ridge), (half_width, back, eave),
        (-half_width, front, eave + thickness), (0, front, ridge + thickness), (half_width, front, eave + thickness),
        (-half_width, back, eave + thickness), (0, back, ridge + thickness), (half_width, back, eave + thickness),
    ]
    faces = [
        (6, 7, 10, 9), (7, 8, 11, 10), (0, 3, 4, 1), (1, 4, 5, 2),
        (0, 1, 7, 6), (1, 2, 8, 7), (3, 9, 10, 4), (4, 10, 11, 5), (0, 6, 9, 3), (2, 5, 11, 8),
    ]
    return add_mesh(name, verts, faces, colour)


def gable_wall(name, half_width, y, eave, ridge, colour):
    return add_mesh(name, [(-half_width, y, eave), (half_width, y, eave), (0, y, ridge)], [(0, 1, 2)], colour)


def cylinder_x(name, centre, radius, length, colour, sides=10):
    verts = []
    for side in (-1, 1):
        for index in range(sides):
            angle = 2 * math.pi * index / sides
            verts.append((centre[0] + side * length / 2, centre[1] + radius * math.cos(angle), centre[2] + radius * math.sin(angle)))
    faces = [tuple(range(sides - 1, -1, -1)), tuple(range(sides, 2 * sides))]
    faces += [(index, (index + 1) % sides, sides + (index + 1) % sides, sides + index) for index in range(sides)]
    return add_mesh(name, verts, faces, colour)


def export(path):
    target = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=target, export_format="GLB", export_yup=True, export_apply=True,
        export_animations=False, export_cameras=False, export_lights=False,
    )
    print("wrote", target)


def cabin():
    reset()
    half_w, half_d, base, wall = 3.0, 4.0, 0.6, 2.8
    eave = base + wall
    ridge = eave + 1.9
    box("Base", (-half_w - 0.1, -half_d - 0.1, 0), (half_w + 0.1, half_d + 0.1, base), "stone")
    box("Walls", (-half_w, -half_d, base), (half_w, half_d, eave), "plank")
    gable_wall("GableFront", half_w, -half_d, eave, ridge, "plank")
    gable_wall("GableBack", half_w, half_d, eave, ridge, "plank")
    gable("Roof", half_w + 0.6, -half_d - 2.3, half_d + 0.5, eave - 0.25, ridge, 0.16, "roof")
    box("Porch", (-half_w - 0.1, -half_d - 2.1, 0), (half_w + 0.1, -half_d, base), "timber")
    for index, x in enumerate((-half_w, 0.9, half_w - 0.2)):
        box(f"PorchPost{index}", (x, -half_d - 2.1, base), (x + 0.2, -half_d - 1.9, eave - 0.15), "timber")
    box("PorchBeam", (-half_w, -half_d - 2.1, eave - 0.3), (half_w, -half_d - 1.9, eave - 0.15), "timber")
    for index, (x0, x1) in enumerate(((-half_w, -1.0), (1.1, half_w - 0.2))):
        box(f"Rail{index}", (x0, -half_d - 2.08, base + 0.9), (x1, -half_d - 1.98, base + 1.0), "timber")
    for index in range(3):
        depth = 0.32 * (index + 1)
        box(f"Step{index}", (-0.9, -half_d - 2.1 - depth, 0), (1.1, -half_d - 2.1, base * (3 - index) / 3), "timber")
    box("Door", (-0.45, -half_d - 0.04, base), (0.55, -half_d, base + 2.05), "door")
    box("WindowFront", (-2.3, -half_d - 0.04, base + 1.0), (-1.3, -half_d, base + 2.0), "glass")
    box("WindowSide", (half_w, 0.2, base + 1.0), (half_w + 0.04, 1.2, base + 2.0), "glass")
    box("Chimney", (1.5, 1.6, base), (2.5, 2.6, ridge + 0.8), "stone")
    export("structures/wp-cabin.glb")


def woodpile():
    reset()
    random_source = random.Random(3)
    for row, count in enumerate((5, 4, 3)):
        for index in range(count):
            y = (index - (count - 1) / 2) * 0.42
            z = 0.2 + row * 0.36
            jitter = random_source.uniform(-0.06, 0.06)
            cylinder_x(f"Log{row}_{index}", (jitter, y, z), 0.2, 1.3, "log")
    box("SupportLeft", (-0.55, -1.1, 0), (-0.45, 1.1, 0.06), "timber")
    box("SupportRight", (0.45, -1.1, 0), (0.55, 1.1, 0.06), "timber")
    export("props/wp-woodpile.glb")


def fence_module():
    reset()
    length, height = 3.0, 1.1
    for index, x in enumerate((-length / 2, length / 2 - 0.12)):
        box(f"Post{index}", (x, -0.06, 0), (x + 0.12, 0.06, height), "timber")
    for index, z in enumerate((0.45, 0.9)):
        box(f"Rail{index}", (-length / 2, -0.03, z), (length / 2, 0.03, z + 0.09), "timber")
    export("props/wp-fence-module.glb")


def signpost():
    reset()
    box("Post", (-0.06, -0.06, 0), (0.06, 0.06, 2.3), "timber")
    box("Board", (-0.65, -0.1, 1.6), (0.65, -0.06, 2.05), "sign")
    export("props/wp-signpost.glb")


def rock(name, seed):
    reset()
    random_source = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1)
    item = bpy.context.active_object
    item.name = "Rock"
    stretch = (random_source.uniform(0.9, 1.3), random_source.uniform(0.8, 1.2), random_source.uniform(0.55, 0.85))
    # Cut flat faces off the ball: a boulder is broken, not eroded.
    cuts = []
    for _ in range(11):
        normal = [random_source.gauss(0, 1) for _ in range(3)]
        length = math.sqrt(sum(value * value for value in normal))
        cuts.append(([value / length for value in normal], random_source.uniform(0.5, 0.8)))
    for vertex in item.data.vertices:
        point = list(vertex.co)
        for normal, depth in cuts:
            over = sum(a * b for a, b in zip(point, normal)) - depth
            if over > 0:
                point = [a - b * over for a, b in zip(point, normal)]
        vertex.co = (point[0] * stretch[0], point[1] * stretch[1], (point[2] + 0.3) * stretch[2])
    item.data.materials.append(material("rock"))
    for polygon in item.data.polygons:
        polygon.use_smooth = False
    export(f"props/{name}.glb")


cabin()
woodpile()
fence_module()
signpost()
rock("wp-rock-a", 11)
rock("wp-rock-b", 12)
rock("wp-rock-c", 13)
