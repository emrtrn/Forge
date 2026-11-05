"""Doruk K-180 (RB-V-001) metric greybox.

Same script + same Blender version = same GLB. Nothing is random; all geometry
comes from the parameter block below, which mirrors DIMENSIONS.md.

Run (Blender 5.2 LTS, not on PATH):

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
      --factory-startup --python art/vehicles/doruk-k180/doruk-k180_greybox.py

Options after `--`:
  --glb PATH      GLB output (default public/assets/vehicles/doruk-k180/doruk-k180_base.glb)
  --no-renders    skip the orthographic and 3/4 renders

All coordinates below are Forge chassis space, in metres:
  +X = vehicle left, +Y = up, +Z = forward, y = 0 ground, z = 0 mid wheelbase.
`to_blender` turns them into Blender space (front -Y, left +X, up +Z), which the
glTF +Y Up export turns back.

The master .blend is an output of this script at the greybox stage: hand edits
to it are lost on the next run.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

BLENDER_VERSION = (5, 2)

# --- Dimensions (DIMENSIONS.md) ----------------------------------------------
WHEEL_RADIUS = 0.56
AXLE_Y = WHEEL_RADIUS
FRONT_AXLE_Z = 2.10
REAR_AXLE_Z = -2.10
NOSE_Z = 3.30
TAIL_Z = -3.90
FRONT_WHEEL_X = 2.05 / 2
REAR_WHEEL_X = 1.80 / 2
FRONT_TYRE_WIDTH = 0.32
DUAL_TYRE_WIDTH = 0.28
DUAL_GAP = 0.04
ROOF_Y = 2.65
CAB_HALF_WIDTH = 2.15 / 2
HOOD_TOP_Y = 1.75
BUMPER_Y = (0.72, 0.98)
BED_FRONT_Z = -0.10
BED_HALF_WIDTH = 2.45 / 2
BED_FLOOR_Y = 1.25
BED_TOP_Y = 2.05
MIRROR_MAX_X = 2.80 / 2

# --- Derived layout ----------------------------------------------------------
CAB_BACK_Z = 0.02
FIREWALL_Z = 1.30
HOOD_REAR_Z = 1.52
HOOD_FRONT_Z = 3.00
HOOD_FRONT_RISE = 0.10
HOOD_EDGE_Y = 1.56
HOOD_HALF_WIDTH = 0.82
FENDER_INNER_X = 0.80  # tucks under the hood edge, so the seam shows no gap
FENDER_OUTER_X = 1.20
FENDER_FRONT_ANGLE = 20.0  # degrees round the arch, 0 = straight ahead of the axle
FENDER_REAR_ANGLE = 165.0
ARCH_RADIUS = 0.72
WINDSHIELD_BASE = (1.40, 1.82)  # (z, y)
WINDSHIELD_TOP = (1.20, 2.50)
ROOF_BASE_Y = 2.50
DOOR_Y = (0.96, 2.44)
DOOR_Z = (0.12, 1.26)
DOOR_WINDOW_Y = 1.72
DOOR_SKIN = 0.05
BED_PLANK_OUTER_X = 1.205
BED_PLANK_DEPTH = 0.03
BED_RAIL_TOP_Y = 1.30
FRAME_Y = (0.78, 1.00)

CYLINDER_SEGMENTS = 32

EXPOSED_HIDDEN = {"Front_Bumper", "Hood", "Grille_Panel", "Door_L", "Fender_FL", "Windshield",
                  "Mirror_L", "Wood_Side_Panel_L", "Headlight_L", "Headlight_R",
                  "Turn_Signal_L", "Turn_Signal_R", "Wiper_L", "Wiper_R"}

MATERIALS = {
    "M_Body": (0.13, 0.23, 0.37, 0.45),
    "M_Grille": (0.62, 0.59, 0.52, 0.5),
    "M_Steel": (0.05, 0.05, 0.055, 0.6),
    "M_Wood": (0.36, 0.25, 0.14, 0.8),
    "M_Tyre": (0.018, 0.018, 0.018, 0.9),
    "M_Rim": (0.30, 0.28, 0.25, 0.5),
    "M_Glass": (0.20, 0.30, 0.34, 0.1),
    "M_Lamp": (0.90, 0.85, 0.65, 0.2),
    "M_Amber": (0.85, 0.36, 0.04, 0.3),
    "M_Red": (0.55, 0.04, 0.03, 0.3),
    "M_Interior": (0.10, 0.09, 0.08, 0.8),
    "M_Engine": (0.16, 0.16, 0.17, 0.6),
}


def to_blender(point):
    return Vector((point[0], -point[2], point[1]))


def lerp(a, b, t):
    return a + (b - a) * t


def windshield_z(y):
    """The windshield line at height y."""
    (z0, y0), (z1, y1) = WINDSHIELD_BASE, WINDSHIELD_TOP
    return lerp(z0, z1, (y - y0) / (y1 - y0))


class Mesh:
    """One glTF node with one material. Points go in as Forge chassis space."""

    def __init__(self, name, material, side=1, pivot=(0.0, 0.0, 0.0)):
        self.name = name
        self.material = material
        self.side = side
        self.pivot = (pivot[0] * side, pivot[1], pivot[2])
        self.bm = bmesh.new()

    def _vert(self, point):
        return self.bm.verts.new(to_blender((point[0] * self.side, point[1], point[2])))

    def _face(self, verts):
        self.bm.faces.new(verts)

    def box(self, lo, hi, segs=(1, 1, 1)):
        """Closed box; segs subdivides each axis."""
        nx, ny, nz = segs
        grid = {}

        def vert(i, j, k):
            key = (i, j, k)
            if key not in grid:
                grid[key] = self._vert((lerp(lo[0], hi[0], i / nx),
                                        lerp(lo[1], hi[1], j / ny),
                                        lerp(lo[2], hi[2], k / nz)))
            return grid[key]

        for j in range(ny):
            for k in range(nz):
                for i in (0, nx):
                    self._face([vert(i, j, k), vert(i, j + 1, k), vert(i, j + 1, k + 1), vert(i, j, k + 1)])
        for i in range(nx):
            for k in range(nz):
                for j in (0, ny):
                    self._face([vert(i, j, k), vert(i + 1, j, k), vert(i + 1, j, k + 1), vert(i, j, k + 1)])
        for i in range(nx):
            for j in range(ny):
                for k in (0, nz):
                    self._face([vert(i, j, k), vert(i + 1, j, k), vert(i + 1, j + 1, k), vert(i, j + 1, k)])

    def loft(self, rings):
        """Skins equal-length closed rings and caps both ends."""
        verts = [[self._vert(point) for point in ring] for ring in rings]
        count = len(rings[0])
        for a, b in zip(verts, verts[1:]):
            for i in range(count):
                j = (i + 1) % count
                self._face([a[i], a[j], b[j], b[i]])
        self._face(verts[0])
        self._face(verts[-1])

    def prism(self, outline, x0, x1, stations=1):
        """A (z, y) outline swept across x."""
        self.loft([[(lerp(x0, x1, s / stations), y, z) for z, y in outline] for s in range(stations + 1)])

    def strut(self, a, b, width, height=None):
        """A box bar from a to b."""
        height = height or width
        a, b = Vector(a), Vector(b)
        axis = (b - a).normalized()
        helper = Vector((0, 1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))
        u = axis.cross(helper).normalized() * width / 2
        v = axis.cross(u).normalized() * height / 2
        corners = [u + v, u - v, -u - v, -u + v]
        self.loft([[tuple(end + c) for c in corners] for end in (a, b)])

    @staticmethod
    def _axis_point(axis, along, radius, angle):
        c, s = radius * math.cos(angle), radius * math.sin(angle)
        if axis == "x":
            return (along, c, s)
        if axis == "y":
            return (c, along, s)
        return (c, s, along)

    def cylinder(self, centre, radius, length, axis, segments=CYLINDER_SEGMENTS):
        """Solid capped cylinder."""
        rings = []
        for end in (-length / 2, length / 2):
            ring = []
            for i in range(segments):
                p = self._axis_point(axis, end, radius, 2 * math.pi * i / segments)
                ring.append((p[0] + centre[0], p[1] + centre[1], p[2] + centre[2]))
            rings.append(ring)
        self.loft(rings)

    def revolve(self, centre, profile, axis, segments=CYLINDER_SEGMENTS, transform=None):
        """Revolves a closed (along, radius) profile about an axis through centre."""
        verts = []
        for i in range(segments):
            angle = 2 * math.pi * i / segments
            ring = []
            for along, radius in profile:
                p = Vector(self._axis_point(axis, along, radius, angle))
                if transform is not None:
                    p = transform @ p
                ring.append(self._vert((p.x + centre[0], p.y + centre[1], p.z + centre[2])))
            verts.append(ring)
        count = len(profile)
        for i in range(segments):
            a, b = verts[i], verts[(i + 1) % segments]
            for j in range(count):
                k = (j + 1) % count
                self._face([a[j], a[k], b[k], b[j]])


class Builder:
    def __init__(self):
        self.collection = bpy.context.scene.collection
        self.materials = {name: self._material(name, *value) for name, value in MATERIALS.items()}

    @staticmethod
    def _material(name, r, g, b, roughness):
        material = bpy.data.materials.new(name)
        principled = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        principled.inputs["Base Color"].default_value = (r, g, b, 1)
        principled.inputs["Roughness"].default_value = roughness
        principled.inputs["Metallic"].default_value = 0
        return material

    def empty(self, name, parent=None, location=(0.0, 0.0, 0.0)):
        obj = bpy.data.objects.new(name, None)
        obj.empty_display_size = 0.2
        self.collection.objects.link(obj)
        obj.parent = parent
        obj.location = to_blender(location)
        return obj

    def add(self, mesh, parent):
        """Turns a Mesh into an object whose origin is its pivot."""
        bm = mesh.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        offset = to_blender(mesh.pivot)
        for vert in bm.verts:
            vert.co -= offset
        data = bpy.data.meshes.new(mesh.name)
        bm.to_mesh(data)
        bm.free()
        data.materials.append(self.materials[mesh.material])
        obj = bpy.data.objects.new(mesh.name, data)
        self.collection.objects.link(obj)
        obj.parent = parent
        parent_offset = parent.matrix_world.translation if parent.type == "EMPTY" else parent["pivot"]
        obj.location = offset - Vector(parent_offset)
        obj["pivot"] = tuple(offset)
        return obj


SIDES = (("L", 1), ("R", -1))


def chassis_frame():
    m = Mesh("Chassis_Frame", "M_Steel")
    for side in (1, -1):
        m.box((side * 0.41, FRAME_Y[0], -3.80), (side * 0.49, FRAME_Y[1], 3.10))
        m.box((side * 0.38, 0.60, 1.55), (side * 0.52, FRAME_Y[0], 2.65))  # front leaf spring
        m.box((side * 0.38, 0.60, -2.75), (side * 0.52, FRAME_Y[0], -1.45))  # rear leaf spring
    for z in (2.90, 1.60, 0.20, -1.00, -2.10, -3.20, -3.70):
        m.box((-0.41, 0.82, z - 0.04), (0.41, 0.96, z + 0.04))
    m.box((-0.86, 0.52, FRONT_AXLE_Z - 0.04), (0.86, 0.60, FRONT_AXLE_Z + 0.04))
    m.box((-0.62, 0.52, REAR_AXLE_Z - 0.05), (0.62, 0.60, REAR_AXLE_Z + 0.05))
    m.box((-0.18, 0.40, REAR_AXLE_Z - 0.15), (0.18, 0.72, REAR_AXLE_Z + 0.15))  # differential
    m.strut((0, 0.62, REAR_AXLE_Z + 0.15), (0, 0.82, 1.72), 0.09)  # propshaft
    m.box((0.49, 0.82, -1.05), (0.60, 0.88, -0.95))  # tank brackets
    m.box((0.49, 0.82, -0.50), (0.60, 0.88, -0.40))
    return m


def cabin_shell():
    m = Mesh("Cabin_Shell", "M_Body")
    half = CAB_HALF_WIDTH
    m.box((-half, 1.06, CAB_BACK_Z), (half, 1.10, FIREWALL_Z), (10, 1, 10))  # floor
    m.box((-half, 0.92, FIREWALL_Z - 0.02), (half, 1.82, FIREWALL_Z + 0.02), (10, 6, 1))  # firewall
    # Back wall around the rear window.
    wall = (CAB_BACK_Z - 0.02, CAB_BACK_Z + 0.02)
    m.box((-half, 0.92, wall[0]), (half, 1.75, wall[1]), (10, 5, 1))
    m.box((-half, 2.25, wall[0]), (half, ROOF_BASE_Y, wall[1]), (10, 2, 1))
    for side in (1, -1):
        m.box((side * 0.60, 1.75, wall[0]), (side * half, 2.25, wall[1]), (2, 3, 1))
        rail = (side * (half - 0.075), side * half)
        m.box((rail[0], 0.90, CAB_BACK_Z), (rail[1], 0.95, FIREWALL_Z))  # sill
        m.box((rail[0], 0.92, CAB_BACK_Z), (rail[1], ROOF_BASE_Y, 0.08))  # B pillar
        m.box((rail[0], ROOF_BASE_Y - 0.04, CAB_BACK_Z), (rail[1], ROOF_BASE_Y, WINDSHIELD_TOP[0]))  # roof rail
        m.prism([WINDSHIELD_BASE, WINDSHIELD_TOP,
                 (WINDSHIELD_TOP[0] - 0.06, WINDSHIELD_TOP[1]),
                 (WINDSHIELD_BASE[0] - 0.06, WINDSHIELD_BASE[1])], rail[0], rail[1])  # A pillar
        m.prism([(FIREWALL_Z - 0.02, 1.50), (FIREWALL_Z - 0.02, 2.03),
                 WINDSHIELD_BASE, (WINDSHIELD_BASE[0], 1.50)], rail[0], rail[1])  # quarter panel
        # Door jamb: a flange behind the door gap, so the gap is never see-through.
        jamb = (side * (half - 0.075), side * (half - 0.055))
        m.box((jamb[0], 0.95, 0.08), (jamb[1], 1.00, FIREWALL_Z))
        m.box((jamb[0], DOOR_Y[1] - 0.03, 0.08), (jamb[1], ROOF_BASE_Y, FIREWALL_Z - 0.10))
        m.box((jamb[0], 0.95, 0.08), (jamb[1], ROOF_BASE_Y, 0.15))
        m.box((jamb[0], 0.95, DOOR_Z[1] - 0.03), (jamb[1], DOOR_WINDOW_Y, FIREWALL_Z))
        m.prism([(DOOR_Z[1] - 0.03, DOOR_WINDOW_Y), (windshield_z(DOOR_Y[1]) - 0.11, DOOR_Y[1]),
                 (windshield_z(DOOR_Y[1]) - 0.06, DOOR_Y[1]), (FIREWALL_Z, DOOR_WINDOW_Y)], jamb[0], jamb[1])
    # Cowl: the slope from the hood's rear edge up to the windshield base.
    m.prism([(FIREWALL_Z, HOOD_EDGE_Y), (FIREWALL_Z, WINDSHIELD_BASE[1]), WINDSHIELD_BASE,
             (HOOD_REAR_Z, HOOD_TOP_Y), (HOOD_REAR_Z, HOOD_EDGE_Y)], -half, half, 6)
    # Crowned roof, slightly overhanging the windshield.
    crown = [(-1.0, 0.0), (-0.93, 0.62), (-0.70, 0.90), (-0.30, 1.0),
             (0.30, 1.0), (0.70, 0.90), (0.93, 0.62), (1.0, 0.0)]
    rise = ROOF_Y - ROOF_BASE_Y
    rings = []
    for station in range(9):
        t = station / 8
        z = lerp(CAB_BACK_Z - 0.02, WINDSHIELD_TOP[0] + 0.08, t)
        shrink = 1.0 - 0.45 * max(0.0, (t - 0.8) / 0.2) ** 2
        rings.append([(x * half, ROOF_BASE_Y + y * rise * shrink, z) for x, y in crown])
    m.loft(rings)
    return m


def cabin_interior():
    m = Mesh("Cabin_Interior", "M_Interior")
    m.box((-0.92, 1.10, 0.15), (0.92, 1.50, 0.75), (6, 2, 3))  # bench
    m.box((-0.92, 1.50, 0.10), (0.92, 2.08, 0.26), (6, 3, 1))  # backrest
    m.box((-1.0, 1.48, 1.10), (1.0, 1.78, FIREWALL_Z - 0.02), (6, 2, 1))  # dashboard
    wheel = (0.50, 1.76, 0.98)
    tilt = Matrix.Rotation(math.radians(-25), 3, "X")
    m.revolve(wheel, [(-0.018, 0.195), (-0.018, 0.225), (0.018, 0.225), (0.018, 0.195)],
              "z", 24, tilt)  # steering wheel rim
    m.strut(wheel, (0.50, 1.55, 1.27), 0.05)  # column
    m.strut((0.30, 1.76, 0.98), (0.70, 1.76, 0.98), 0.03)  # spoke
    for x in (0.34, 0.50, 0.66):
        m.box((x - 0.05, 1.14, 1.12), (x + 0.05, 1.16, 1.26))  # pedals
    m.strut((0.0, 1.10, 1.05), (0.0, 1.62, 0.94), 0.025)  # gear lever
    return m


def engine_block():
    m = Mesh("Engine_Block", "M_Engine")
    m.box((-0.30, 0.85, 1.72), (0.30, 1.50, 2.62), (3, 3, 4))
    m.box((-0.52, 0.95, 2.74), (0.52, 1.60, 2.90), (3, 3, 1))  # radiator
    return m


def tow_hook(name, side):
    m = Mesh(name, "M_Steel", side, (0.45, 0.66, 3.05))
    m.box((0.41, 0.72, 2.95), (0.49, FRAME_Y[0], 3.08))
    m.box((0.41, 0.64, 2.95), (0.49, 0.72, 3.22))
    m.revolve((0.45, 0.59, 3.21), [(-0.014, 0.046), (-0.014, 0.074), (0.014, 0.074), (0.014, 0.046)], "x", 16)
    return m


def fuel_tank():
    m = Mesh("Fuel_Tank", "M_Steel", 1, (0.60, 0.80, -0.72))
    m.box((0.60, 0.56, -1.20), (1.10, 0.92, -0.25), (5, 4, 8))
    return m


def rear_bumper():
    m = Mesh("Rear_Bumper", "M_Steel", 1, (0.0, 0.80, -3.80))
    m.box((-1.10, 0.74, TAIL_Z), (1.10, 0.86, -3.80), (10, 1, 1))
    return m


def cab_step(name, side):
    m = Mesh(name, "M_Steel", side, (0.98, 0.72, 0.60))
    m.box((0.98, 0.70, 0.28), (1.16, 0.75, 0.98))
    m.strut((0.49, 0.84, 0.32), (1.00, 0.72, 0.32), 0.04)
    m.strut((0.49, 0.84, 0.92), (1.00, 0.72, 0.92), 0.04)
    return m


def mudflap(name, side, z, x, y):
    m = Mesh(name, "M_Tyre", side, (x[0], y[1], z))
    m.box((x[0], y[0], z - 0.015), (x[1], y[1], z + 0.015), (3, 3, 1))
    return m


def front_bumper():
    m = Mesh("Front_Bumper", "M_Steel", 1, (0.0, sum(BUMPER_Y) / 2, 3.10))
    m.box((-FENDER_OUTER_X, BUMPER_Y[0], 3.10), (FENDER_OUTER_X, BUMPER_Y[1], NOSE_Z), (24, 3, 3))
    return m


def hood():
    m = Mesh("Hood", "M_Body", 1, (0.0, HOOD_TOP_Y, HOOD_REAR_Z))
    crown = [(-1.0, 0.0), (-0.95, 0.70), (-0.76, 0.92), (-0.37, 1.0),
             (0.37, 1.0), (0.76, 0.92), (0.95, 0.70), (1.0, 0.0)]
    thickness = 0.03
    rings = []
    for station in range(13):
        t = station / 12
        z = lerp(HOOD_REAR_Z, HOOD_FRONT_Z, t)
        rise = lerp(HOOD_TOP_Y - HOOD_EDGE_Y, HOOD_FRONT_RISE, t ** 2)
        outer = [(x * HOOD_HALF_WIDTH, HOOD_EDGE_Y + y * rise, z) for x, y in crown]
        inner = [(x * (HOOD_HALF_WIDTH - thickness), HOOD_EDGE_Y + y * (rise - thickness), z)
                 for x, y in reversed(crown)]
        rings.append(outer + inner)
    m.loft(rings)
    return m


def fender(name, side):
    """Hollow front fender around the wheel: arch band, side sheet and top."""
    m = Mesh(name, "M_Body", side, (FENDER_INNER_X, HOOD_EDGE_Y, FRONT_AXLE_Z))
    ahead = HOOD_FRONT_Z - FRONT_AXLE_Z
    behind = FRONT_AXLE_Z - FIREWALL_Z
    top = HOOD_EDGE_Y - AXLE_Y
    corners = {math.degrees(math.atan2(top, ahead)), 180.0 - math.degrees(math.atan2(top, behind))}
    angles = sorted({FENDER_FRONT_ANGLE, FENDER_REAR_ANGLE} | corners
                    | {a for a in (15.0 * i for i in range(13)) if FENDER_FRONT_ANGLE < a < FENDER_REAR_ANGLE})
    inner, outer = FENDER_INNER_X, FENDER_OUTER_X
    rings = []
    for degrees in angles:
        angle = math.radians(degrees)
        c, s = math.cos(angle), math.sin(angle)
        rb = max(min((ahead if c >= 0 else behind) / max(abs(c), 1e-6), top / max(s, 1e-6)), ARCH_RADIUS + 0.14)
        section = [(inner, ARCH_RADIUS), (outer, ARCH_RADIUS), (outer, rb - 0.08), (outer - 0.08, rb),
                   (inner, rb), (inner, rb - 0.03), (outer - 0.11, rb - 0.03), (outer - 0.03, rb - 0.09),
                   (outer - 0.03, ARCH_RADIUS + 0.03), (inner, ARCH_RADIUS + 0.03)]
        rings.append([(x, AXLE_Y + r * s, FRONT_AXLE_Z + r * c) for x, r in section])
    m.loft(rings)
    return m


def door(name, side):
    x1 = CAB_HALF_WIDTH
    x0 = x1 - DOOR_SKIN
    y0, y1 = DOOR_Y
    z0, z1 = DOOR_Z
    window_y = DOOR_WINDOW_Y
    m = Mesh(name, "M_Body", side, (x1, window_y, z1))
    m.box((x0, y0, z0), (x1, window_y, z1), (1, 8, 11))
    front = lambda y: min(z1, windshield_z(y) - 0.07)
    frame = 0.07
    m.box((x0, window_y, z0), (x1, y1, z0 + frame), (1, 7, 1))  # rear post
    m.box((x0, y1 - frame, z0 + frame), (x1, y1, front(y1)), (1, 1, 8))  # top rail
    m.prism([(front(window_y), window_y), (front(y1), y1),
             (front(y1) - frame, y1), (front(window_y) - frame, window_y)], x0, x1)  # front post
    m.box((x1, 1.60, 0.20), (x1 + 0.02, 1.63, 0.34))  # handle
    return m


def side_glass(name, side):
    window_y = DOOR_WINDOW_Y
    y1 = DOOR_Y[1] - 0.07
    z0 = DOOR_Z[0] + 0.07
    front = lambda y: min(DOOR_Z[1], windshield_z(y) - 0.07) - 0.07
    x = CAB_HALF_WIDTH - DOOR_SKIN / 2
    m = Mesh(name, "M_Glass", side, (x, window_y, z0))
    m.prism([(z0, window_y), (z0, y1), (front(y1), y1), (front(window_y), window_y)], x - 0.005, x + 0.005)
    return m


def mirror(name, side):
    x0 = MIRROR_MAX_X - 0.18
    x1 = MIRROR_MAX_X
    z = 1.34
    m = Mesh(name, "M_Steel", side, (CAB_HALF_WIDTH, 1.80, z))
    m.box((x0, 1.90, z - 0.025), (x1, 2.32, z + 0.025))
    m.strut((CAB_HALF_WIDTH, 1.80, z), (x0 + 0.04, 1.93, z), 0.022)
    m.strut((CAB_HALF_WIDTH, 2.30, windshield_z(2.30) - 0.03), (x0 + 0.04, 2.28, z), 0.022)
    return m


def grille_panel():
    m = Mesh("Grille_Panel", "M_Grille", 1, (0.0, 1.33, 3.00))
    z0, z1 = 3.00, 3.08
    half, slot = 1.02, 0.58
    y0, y1 = 1.00, 1.66
    m.box((-half, y0, z0), (half, y0 + 0.05, z1), (12, 1, 1))
    m.box((-half, y1 - 0.06, z0), (half, y1, z1), (12, 1, 1))
    for side in (1, -1):
        m.box((side * slot, y0 + 0.05, z0), (side * half, y1 - 0.06, z1), (3, 4, 1))
        m.box((side * 0.18, y0 + 0.05, z0 + 0.01), (side * 0.21, y1 - 0.06, z1 - 0.01))
    for y in (1.18, 1.32, 1.46):
        m.box((-slot, y, z0 + 0.01), (slot, y + 0.03, z1 - 0.01), (4, 1, 1))
    return m


def windshield():
    m = Mesh("Windshield", "M_Glass", 1, (0.0, WINDSHIELD_BASE[1], WINDSHIELD_BASE[0]))
    (z0, y0), (z1, y1) = WINDSHIELD_BASE, WINDSHIELD_TOP
    m.prism([(z0 - 0.03, y0), (z1 - 0.03, y1), (z1 - 0.04, y1), (z0 - 0.04, y0)],
            -(CAB_HALF_WIDTH - 0.075), CAB_HALF_WIDTH - 0.075, 6)
    return m


def rear_window():
    m = Mesh("Rear_Window", "M_Glass", 1, (0.0, 2.0, CAB_BACK_Z))
    m.box((-0.60, 1.75, CAB_BACK_Z - 0.005), (0.60, 2.25, CAB_BACK_Z + 0.005))
    return m


def headlight(name, side):
    m = Mesh(name, "M_Lamp", side, (0.80, 1.28, 3.08))
    m.cylinder((0.80, 1.28, 3.09), 0.115, 0.04, "z", 24)
    return m


def turn_signal(name, side):
    m = Mesh(name, "M_Amber", side, (0.80, 1.52, 3.08))
    m.box((0.70, 1.49, 3.08), (0.90, 1.55, 3.10))
    return m


def tail_lamp(name, side):
    m = Mesh(name, "M_Red", side, (0.92, 0.93, -3.86))
    m.box((0.78, 0.88, TAIL_Z), (1.06, 0.98, -3.84))
    return m


def wiper(name, x):
    m = Mesh(name, "M_Steel", 1, (x, 1.87, windshield_z(1.87)))
    m.strut((x, 1.87, windshield_z(1.87) + 0.012), (x - 0.34, 2.05, windshield_z(2.05) + 0.012), 0.012)
    return m


def bed_base():
    half = BED_PLANK_OUTER_X
    m = Mesh("Bed_Base", "M_Steel")
    m.box((-half, BED_FLOOR_Y - 0.05, TAIL_Z + 0.02), (half, BED_FLOOR_Y, BED_FRONT_Z), (10, 1, 16))
    for side in (1, -1):
        m.box((side * (half - 0.04), BED_FLOOR_Y - 0.08, TAIL_Z + 0.02),
              (side * half, BED_RAIL_TOP_Y, BED_FRONT_Z))  # edge rail
    for i in range(6):
        z = lerp(-0.25, -3.75, i / 5)
        m.box((-half, 1.12, z - 0.04), (half, BED_FLOOR_Y - 0.05, z + 0.04))  # cross bearers
        for side in (1, -1):
            m.box((side * 0.40, FRAME_Y[1], z - 0.05), (side * 0.50, 1.12, z + 0.05))  # frame mounts
    return m


def planks(m, lo, hi, axis_x, count=4):
    """Stacked boards with a groove between them."""
    y0, y1 = BED_RAIL_TOP_Y, BED_TOP_Y
    groove = 0.008
    pitch = (y1 - y0) / count
    for i in range(count):
        a, b = y0 + i * pitch + groove / 2, y0 + (i + 1) * pitch - groove / 2
        if axis_x:
            m.box((lo[0], a, lo[1]), (hi[0], b, hi[1]), (16, 1, 1))
        else:
            m.box((lo[0], a, lo[1]), (hi[0], b, hi[1]), (1, 1, 24))


def wood_side_panel(name, side):
    m = Mesh(name, "M_Wood", side, (BED_PLANK_OUTER_X, BED_RAIL_TOP_Y, -2.0))
    planks(m, (BED_PLANK_OUTER_X - BED_PLANK_DEPTH, TAIL_Z + 0.04),
           (BED_PLANK_OUTER_X, BED_FRONT_Z - 0.04), False)
    return m


def bed_front_panel():
    m = Mesh("Bed_Front_Panel", "M_Wood", 1, (0.0, BED_RAIL_TOP_Y, BED_FRONT_Z))
    half = BED_PLANK_OUTER_X - BED_PLANK_DEPTH
    planks(m, (-half, BED_FRONT_Z - 0.04), (half, BED_FRONT_Z - 0.01), True)
    return m


def tailgate():
    m = Mesh("Tailgate", "M_Wood", 1, (0.0, BED_RAIL_TOP_Y, TAIL_Z + 0.02))
    half = BED_PLANK_OUTER_X - BED_PLANK_DEPTH
    planks(m, (-half, TAIL_Z), (half, TAIL_Z + 0.03), True)
    return m


def cargo_stake(name, side, z):
    m = Mesh(name, "M_Body", side, (BED_HALF_WIDTH, BED_RAIL_TOP_Y, z))
    m.box((BED_PLANK_OUTER_X, BED_FLOOR_Y - 0.08, z - 0.04), (BED_HALF_WIDTH, BED_TOP_Y + 0.02, z + 0.04))
    return m


def cargo_latch(name, side):
    m = Mesh(name, "M_Steel", side, (1.10, 1.85, TAIL_Z))
    m.box((1.02, 1.83, TAIL_Z - 0.0), (1.20, 1.87, TAIL_Z + 0.015))
    return m


def cab_guard():
    m = Mesh("Cab_Guard", "M_Steel", 1, (0.0, 1.30, -0.05))
    z = (-0.07, -0.02)
    for side in (1, -1):
        m.box((side * 0.86, BED_FLOOR_Y, z[0]), (side * 0.92, 2.45, z[1]))
    for y in (2.40, 2.18):
        m.box((-0.92, y, z[0]), (0.92, y + 0.05, z[1]))
    return m


def tyre_profile(centre, width):
    half = width / 2
    return [(centre - half, 0.34), (centre - half, WHEEL_RADIUS - 0.03), (centre - half + 0.03, WHEEL_RADIUS),
            (centre + half - 0.03, WHEEL_RADIUS), (centre + half, WHEEL_RADIUS - 0.03), (centre + half, 0.34)]


def wheel(name, side, x, front):
    """Tyre mesh at the axle centre. The rim stays inside the tyre width, so the
    node's bounding box centre is the wheel centre that bindModelWheel pivots on."""
    centre = (x, AXLE_Y, FRONT_AXLE_Z if front else REAR_AXLE_Z)
    tyre = Mesh(name, "M_Tyre", side, centre)
    rim = Mesh(f"{name}_Rim", "M_Rim", side, centre)
    axis_centre = (x, AXLE_Y, centre[2])
    if front:
        tyres = [0.0]
        width = FRONT_TYRE_WIDTH
    else:
        offset = (DUAL_TYRE_WIDTH + DUAL_GAP) / 2
        tyres = [-offset, offset]
        width = DUAL_TYRE_WIDTH
    for along in tyres:
        tyre.revolve(axis_centre, tyre_profile(along, width), "x")
        rim.cylinder((x + along, AXLE_Y, centre[2]), 0.34, width - 0.12, "x")
    # Hub and lugs stand off a recessed rim face and show the spin. They stay
    # inside the tyre width, and each mirrored wheel faces outward.
    outer = max(tyres) + width / 2 - 0.06
    rim.cylinder((x + outer + 0.025, AXLE_Y, centre[2]), 0.15, 0.05, "x", 16)
    for i in range(6):
        angle = 2 * math.pi * i / 6
        y, z = AXLE_Y + 0.25 * math.cos(angle), centre[2] + 0.25 * math.sin(angle)
        rim.box((x + outer, y - 0.03, z - 0.03), (x + outer + 0.03, y + 0.03, z + 0.03))
    return tyre, rim


def build():
    b = Builder()
    root = b.empty("DorukK180")
    chassis = b.empty("CHASSIS", root)
    parts = b.empty("PARTS", root)
    cargo = b.empty("CARGO", root)
    wheels = b.empty("VEHICLE_WHEELS", root)
    sockets = b.empty("SOCKETS", root)

    for mesh in (chassis_frame(), cabin_shell(), cabin_interior(), engine_block(), fuel_tank(), rear_bumper()):
        b.add(mesh, chassis)
    for suffix, side in SIDES:
        b.add(tow_hook(f"Tow_Hook_{suffix}", side), chassis)
        b.add(cab_step(f"Cab_Step_{suffix}", side), chassis)
        b.add(mudflap(f"Mudflap_F{suffix}", side, 1.34, (0.86, 1.19), (0.32, 0.62)), chassis)
        b.add(mudflap(f"Mudflap_R{suffix}", side, -2.76, (0.58, 1.22), (0.36, 1.12)), chassis)

    b.add(front_bumper(), parts)
    b.add(hood(), parts)
    b.add(grille_panel(), parts)
    b.add(windshield(), parts)
    b.add(rear_window(), parts)
    fender_names = {"L": "Fender_FL", "R": "Fender_FR"}
    for suffix, side in SIDES:
        b.add(fender(fender_names[suffix], side), parts)
        door_object = b.add(door(f"Door_{suffix}", side), parts)
        b.add(side_glass(f"SideGlass_{suffix}", side), door_object)
        b.add(mirror(f"Mirror_{suffix}", side), parts)
        b.add(headlight(f"Headlight_{suffix}", side), parts)
        b.add(turn_signal(f"Turn_Signal_{suffix}", side), parts)
        b.add(tail_lamp(f"Tail_Lamp_{suffix}", side), parts)
    b.add(wiper("Wiper_L", 0.62), parts)
    b.add(wiper("Wiper_R", -0.02), parts)

    b.add(bed_base(), cargo)
    b.add(bed_front_panel(), cargo)
    b.add(tailgate(), cargo)
    b.add(cab_guard(), cargo)
    for suffix, side in SIDES:
        b.add(wood_side_panel(f"Wood_Side_Panel_{suffix}", side), cargo)
        b.add(cargo_latch(f"Cargo_Latch_{suffix}", side), cargo)
        for index, z in enumerate((BED_FRONT_Z - 0.08, -1.35, -2.60, TAIL_Z + 0.06), 1):
            b.add(cargo_stake(f"Cargo_Stake_{suffix}{index}", side, z), cargo)

    for suffix, side in SIDES:
        for axle, x, front in (("F", FRONT_WHEEL_X, True), ("R", REAR_WHEEL_X, False)):
            tyre, rim = wheel(f"Wheel_{axle}{suffix}", side, x, front)
            tyre_object = b.add(tyre, wheels)
            b.add(rim, tyre_object)

    b.empty("Socket_CargoAnchor", sockets, (0.0, BED_FLOOR_Y, -2.0))
    b.empty("Socket_DriverSeat", sockets, (0.50, 1.55, 0.45))
    b.empty("Socket_CameraAnchor", sockets, (0.0, 3.20, 0.0))

    for obj in bpy.context.scene.objects:
        if "pivot" in obj:
            del obj["pivot"]


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_materials="EXPORT",
        use_selection=False,
    )


def render_views(directory):
    os.makedirs(directory, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.compression = 100
    scene.render.dither_intensity = 0
    world = bpy.data.worlds.new("Studio")
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.64, 0.68, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.75
    scene.world = world

    ground_data = bpy.data.meshes.new("RenderGround")
    ground_bm = bmesh.new()
    bmesh.ops.create_grid(ground_bm, x_segments=1, y_segments=1, size=60)
    ground_bm.to_mesh(ground_data)
    ground_bm.free()
    ground_material = bpy.data.materials.new("RenderGround")
    next(n for n in ground_material.node_tree.nodes if n.type == "BSDF_PRINCIPLED") \
        .inputs["Base Color"].default_value = (0.42, 0.42, 0.40, 1)
    ground_data.materials.append(ground_material)
    ground = bpy.data.objects.new("RenderGround", ground_data)
    scene.collection.objects.link(ground)

    sun_data = bpy.data.lights.new("RenderSun", "SUN")
    sun_data.energy = 2.2
    sun = bpy.data.objects.new("RenderSun", sun_data)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scene.collection.objects.link(sun)

    centre = to_blender((0.0, 1.32, -0.30))
    camera_data = bpy.data.cameras.new("RenderCamera")
    camera = bpy.data.objects.new("RenderCamera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    views = {
        "front": ((0, 1.32, 30), 4.6),
        "rear": ((0, 1.32, -30), 4.6),
        "left": ((30, 1.32, -0.30), 8.2),
        "right": ((-30, 1.32, -0.30), 8.2),
        "top": ((0, 30, -0.30), 11.8),
    }
    for name, (eye, ortho) in views.items():
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = ortho
        look(camera, to_blender(eye), centre)
        ground.hide_render = name == "top"
        scene.render.filepath = os.path.join(directory, f"{name}.png")
        bpy.ops.render.render(write_still=True)
    ground.hide_render = False
    for name, eye in (("three_quarter", (9.0, 3.2, 10.5)), ("three_quarter_rear", (-9.0, 3.6, -11.5))):
        camera_data.type = "PERSP"
        camera_data.lens = 45
        look(camera, to_blender(eye), centre)
        scene.render.filepath = os.path.join(directory, f"{name}.png")
        bpy.ops.render.render(write_still=True)
    # What shows once the parts that tear off are gone.
    for obj in scene.objects:
        if obj.name in EXPOSED_HIDDEN or (obj.parent and obj.parent.name in EXPOSED_HIDDEN):
            obj.hide_render = True
    look(camera, to_blender((8.5, 3.0, 8.5)), to_blender((0.0, 1.20, 1.0)))
    scene.render.filepath = os.path.join(directory, "exposed.png")
    bpy.ops.render.render(write_still=True)


def look(camera, eye, target):
    camera.location = eye
    camera.rotation_euler = (target - eye).to_track_quat("-Z", "Y").to_euler()


def main():
    if bpy.app.version[:2] != BLENDER_VERSION:
        raise SystemExit(f"Blender {BLENDER_VERSION} expected, got {bpy.app.version_string}")
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.abspath(os.path.join(here, "..", "..", ".."))
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    glb = os.path.join(repo, "public", "assets", "vehicles", "doruk-k180", "doruk-k180_base.glb")
    if "--glb" in args:
        glb = os.path.abspath(args[args.index("--glb") + 1])
    renders = "--no-renders" not in args

    bpy.ops.wm.read_factory_settings(use_empty=True)
    build()
    bpy.context.view_layer.update()
    export_glb(glb)
    if renders:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(here, "Doruk-K180_Master.blend"))
        render_views(os.path.join(here, "renders"))
    print(f"DORUK OK {glb}")


main()
