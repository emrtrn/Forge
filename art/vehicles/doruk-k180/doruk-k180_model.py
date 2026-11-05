"""Doruk K-180 (RB-V-001) model.

Same script + same Blender version = same GLB. Nothing is random; all geometry
comes from the parameter block below, which mirrors DIMENSIONS.md.

Run (Blender 5.2 LTS, not on PATH):

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
      --factory-startup --python art/vehicles/doruk-k180/doruk-k180_model.py

Options after `--`:
  --glb PATH      GLB output (default public/assets/vehicles/doruk-k180/doruk-k180_base.glb)
  --no-renders    skip the orthographic and 3/4 renders

All coordinates below are Forge chassis space, in metres:
  +X = vehicle left, +Y = up, +Z = forward, y = 0 ground, z = 0 mid wheelbase.
`to_blender` turns them into Blender space (front -Y, left +X, up +Z), which the
glTF +Y Up export turns back.

The master .blend is an output of this script: hand edits to it are lost on the
next run. Node names, pivots and the sizes of DIMENSIONS.md are a contract with
the damage data; a mesh with a second material gets a child node (`*_Trim`).
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
NOSE_Z = 3.17
TAIL_Z = -3.90
FRONT_WHEEL_X = 2.05 / 2
REAR_WHEEL_X = 1.80 / 2
FRONT_TYRE_WIDTH = 0.32
DUAL_TYRE_WIDTH = 0.28
DUAL_GAP = 0.04
ROOF_Y = 2.65
CAB_HALF_WIDTH = 2.15 / 2
HOOD_TOP_Y = 1.92
BUMPER_Y = (0.72, 0.98)
BUMPER_BACK_Z = 2.975
BED_FRONT_Z = -0.10
BED_HALF_WIDTH = 2.45 / 2
BED_FLOOR_Y = 1.25
BED_TOP_Y = 2.05
MIRROR_MAX_X = 2.80 / 2

# --- Derived layout ----------------------------------------------------------
CAB_BACK_Z = 0.02
FIREWALL_Z = 1.30
HOOD_REAR_Z = 1.68
HOOD_FRONT_Z = 2.93  # just behind the fender's front and the grille frame: the frame leads
FENDER_FRONT_Z = 2.945
HOOD_NOSE_Y = 1.80  # the hood's centre line where its nose starts to roll over
HOOD_FRONT_LIP_Y = 1.69  # the nose's lower edge, over the grille frame
HOOD_EDGE_Y = 1.66  # the fender's shelf, the same height from nose to cowl
HOOD_LIP_Y = 1.645  # the hood's side skirt ends down in the gutter, under the shelf
HOOD_HALF_WIDTH = 0.98
HOOD_REAR_HALF = 1.045
LID_SQUARENESS = 5.0  # a lid's section: flat on top, a tight shoulder, straight sides
COWL_EDGE_Y = 1.60  # where the cowl's sides go down behind the fender
FENDER_INNER_X = 0.88  # under the hood; the front stretches further in, to the grille frame
FENDER_FRONT_INNER_X = 0.70
FENDER_FRONT_OUTSIDE_X = 1.08
FENDER_OUTER_X = 1.20
FENDER_FRONT_ANGLE = 20.0  # degrees round the arch, 0 = straight ahead of the axle
FENDER_REAR_ANGLE = 171.0
GUTTER_DEPTH = 0.032
INNER_FENDER_X = 0.60  # clear of the tyre at full lock
WINDSHIELD_BASE = (1.50, 1.94)  # (z, y)
WINDSHIELD_TOP = (1.24, 2.46)
ROOF_BASE_Y = 2.46
DOOR_Y = (0.96, 2.40)
DOOR_Z = (0.12, 1.26)
DOOR_WINDOW_Y = 1.90
DOOR_SKIN = 0.05
BED_PLANK_OUTER_X = 1.205
BED_PLANK_DEPTH = 0.03
BED_RAIL_TOP_Y = 1.30
FRAME_Y = (0.78, 1.00)
FRAME_FRONT_Z = 2.84  # the rails stop behind the grille; the tow lugs carry the bumper

CYLINDER_SEGMENTS = 32
SMOOTH_ANGLE = 38.0  # degrees; a sharper edge stays a crease
DOOR_GAP = 0.012
WINDSHIELD_WRAP = 0.13  # how far the windshield's corners sweep back, metres at x = 1

EXPOSED_HIDDEN = {"Front_Bumper", "Hood", "Grille_Panel", "Door_L", "Fender_FL", "Windshield",
                  "Mirror_L", "Wood_Side_Panel_L", "Headlight_L", "Headlight_R",
                  "Turn_Signal_L", "Turn_Signal_R", "Wiper_L", "Wiper_R"}

MATERIALS = {
    "M_Body": (0.055, 0.14, 0.27, 0.5),
    "M_Grille": (0.40, 0.39, 0.36, 0.45),
    "M_Steel": (0.05, 0.05, 0.055, 0.6),
    "M_Wood": (0.36, 0.25, 0.14, 0.8),
    "M_Tyre": (0.018, 0.018, 0.018, 0.9),
    "M_Rim": (0.075, 0.075, 0.08, 0.55),
    "M_Glass": (0.20, 0.30, 0.34, 0.1),
    "M_Lamp": (0.90, 0.85, 0.65, 0.2),
    "M_Amber": (0.85, 0.36, 0.04, 0.3),
    "M_Red": (0.55, 0.04, 0.03, 0.3),
    "M_Interior": (0.10, 0.09, 0.08, 0.8),
    "M_Engine": (0.16, 0.16, 0.17, 0.6),
    "M_Rubber": (0.02, 0.02, 0.022, 0.75),
}


def to_blender(point):
    return Vector((point[0], -point[2], point[1]))


def lerp(a, b, t):
    return a + (b - a) * t


def windshield_z(y):
    """The windshield line at height y."""
    (z0, y0), (z1, y1) = WINDSHIELD_BASE, WINDSHIELD_TOP
    return lerp(z0, z1, (y - y0) / (y1 - y0))


def clamp01(value):
    return max(0.0, min(1.0, value))


def cab_half(y):
    """Half width of the cab at height y: straight to the belt line, then tucking in."""
    t = clamp01((y - 1.88) / 0.60)
    below = clamp01((1.88 - y) / 1.0)
    return CAB_HALF_WIDTH - 0.085 * t * t - 0.035 * below * below


def cab_plan(z):
    """Share of cab_half at z: the back corners are rounded in plan."""
    t = clamp01((z - CAB_BACK_Z) / 0.18)
    return 1.0 - 0.07 * (1.0 - t) ** 2


def side_point(z, y, depth=0.0):
    return (cab_half(y) * cab_plan(z) - depth, y, z)


def front_z(x, y):
    """The cab's front face, curved in plan around the windshield line."""
    return windshield_z(y) - WINDSHIELD_WRAP * x * x


def front_point(x, y, depth=0.0):
    return (x, y, front_z(x, y) - depth)


def fillet_loop(corners, radii, arc=6):
    """Closed 2D polygon with rounded corners, as a point list."""
    count = len(corners)
    out = []
    for i in range(count):
        p, a, b = Vector(corners[i]), Vector(corners[i - 1]), Vector(corners[(i + 1) % count])
        radius = radii[i] if isinstance(radii, (list, tuple)) else radii
        if radius <= 0:
            out.append((p.x, p.y))
            continue
        u, v = (a - p).normalized(), (b - p).normalized()
        half = math.acos(max(-1.0, min(1.0, u.dot(v)))) / 2
        reach = min(radius / math.tan(half), (a - p).length * 0.49, (b - p).length * 0.49)
        radius = reach * math.tan(half)
        centre = p + (u + v).normalized() * (radius / math.sin(half))
        start, end = p + u * reach - centre, p + v * reach - centre
        a0 = math.atan2(start.y, start.x)
        delta = math.atan2(end.y, end.x) - a0
        delta = (delta + math.pi) % (2 * math.pi) - math.pi
        for k in range(arc + 1):
            angle = a0 + delta * k / arc
            out.append((centre.x + radius * math.cos(angle), centre.y + radius * math.sin(angle)))
    return out


def resample(loop, count, start=None):
    """`count` points evenly along a closed loop, from the point nearest `start`."""
    if start is not None:
        first = min(range(len(loop)), key=lambda i: (loop[i][0] - start[0]) ** 2 + (loop[i][1] - start[1]) ** 2)
        loop = loop[first:] + loop[:first]
    closed = loop + [loop[0]]
    lengths = [math.dist(a, b) for a, b in zip(closed, closed[1:])]
    total = sum(lengths)
    out, walked, index = [], 0.0, 0
    for i in range(count):
        target = total * i / count
        while walked + lengths[index] < target and index < len(lengths) - 1:
            walked += lengths[index]
            index += 1
        t = (target - walked) / max(lengths[index], 1e-9)
        a, b = closed[index], closed[index + 1]
        out.append((lerp(a[0], b[0], t), lerp(a[1], b[1], t)))
    return out


def shrink_loop(loop, factor):
    """A loop pulled towards its centre, for filling a window with a sheet."""
    cx = sum(p[0] for p in loop) / len(loop)
    cy = sum(p[1] for p in loop) / len(loop)
    return [(lerp(cx, p[0], factor), lerp(cy, p[1], factor)) for p in loop]


def ray_exit(loop, centre, angle):
    """Where a ray from inside a closed loop leaves it."""
    dx, dy = math.cos(angle), math.sin(angle)
    best = None
    for a, b in zip(loop, loop[1:] + loop[:1]):
        ex, ey = b[0] - a[0], b[1] - a[1]
        denom = dx * ey - dy * ex
        if abs(denom) < 1e-12:
            continue
        along = ((a[0] - centre[0]) * ey - (a[1] - centre[1]) * ex) / denom
        across = ((a[0] - centre[0]) * dy - (a[1] - centre[1]) * dx) / denom
        if along > 0 and -1e-9 <= across <= 1 + 1e-9 and (best is None or along < best):
            best = along
    return (centre[0] + dx * best, centre[1] + dy * best)


def radial_pair(outer, inner, centre=None, count=64):
    """A panel's two loops for `sheet`, matched along rays from the hole's centre. Loops
    matched by length do not line up when the hole is off centre, and the panel's ribs then
    cut across the hole's corners. Every corner of either loop gets a ray of its own."""
    if centre is None:
        centre = (sum(p[0] for p in inner) / len(inner), sum(p[1] for p in inner) / len(inner))
    angles = [2 * math.pi * i / count - math.pi for i in range(count)]
    angles += [math.atan2(p[1] - centre[1], p[0] - centre[0]) for p in outer + inner]
    kept = []
    for angle in sorted(angles):
        if not kept or angle - kept[-1] > 0.004:
            kept.append(angle)
    return [ray_exit(outer, centre, a) for a in kept], [ray_exit(inner, centre, a) for a in kept]


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

    def sheet(self, outer, inner, rings, place, thickness, side=1):
        """A panel between two closed 2D loops of equal length; `place(u, v, depth)` puts it on a surface."""
        count = len(outer)

        def layer(depth):
            return [[self._vert(self._flip(place(lerp(a[0], b[0], r / rings), lerp(a[1], b[1], r / rings), depth), side))
                     for a, b in zip(outer, inner)] for r in range(rings + 1)]

        skin, back = layer(0.0), layer(thickness)
        for grid in (skin, back):
            for r in range(rings):
                for i in range(count):
                    j = (i + 1) % count
                    self._face([grid[r][i], grid[r][j], grid[r + 1][j], grid[r + 1][i]])
        for r in (0, rings):
            for i in range(count):
                j = (i + 1) % count
                self._face([skin[r][i], skin[r][j], back[r][j], back[r][i]])

    def patch(self, u_range, v_range, segments, place, thickness, side=1):
        """A closed curved sheet over a (u, v) rectangle."""
        nu, nv = segments

        def layer(depth):
            return [[self._vert(self._flip(place(lerp(u_range[0], u_range[1], i / nu), lerp(v_range[0], v_range[1], j / nv), depth), side))
                     for j in range(nv + 1)] for i in range(nu + 1)]

        skin, back = layer(0.0), layer(thickness)
        for grid in (skin, back):
            for i in range(nu):
                for j in range(nv):
                    self._face([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]])
        for i in range(nu):
            for j in (0, nv):
                self._face([skin[i][j], skin[i + 1][j], back[i + 1][j], back[i][j]])
        for j in range(nv):
            for i in (0, nu):
                self._face([skin[i][j], skin[i][j + 1], back[i][j + 1], back[i][j]])

    def sweep(self, points, radius, closed=False, sides=6, squash=1.0):
        """A tube along a 3D polyline; the frame follows the line without twisting."""
        pts = [Vector(point) for point in points]
        count = len(pts)
        rings = []
        normal = None
        for i in range(count):
            before = pts[i - 1] if closed or i > 0 else pts[i]
            after = pts[(i + 1) % count] if closed or i < count - 1 else pts[i]
            axis = (after - before).normalized()
            if normal is None:
                helper = Vector((0, 1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))
                normal = axis.cross(helper).normalized()
            normal = (normal - axis * normal.dot(axis)).normalized()
            binormal = axis.cross(normal)
            rings.append([tuple(pts[i] + normal * (radius * math.cos(2 * math.pi * k / sides))
                                + binormal * (radius * squash * math.sin(2 * math.pi * k / sides))) for k in range(sides)])
        verts = [[self._vert(point) for point in ring] for ring in rings]
        for i in range(count if closed else count - 1):
            a, b = verts[i], verts[(i + 1) % count]
            for k in range(sides):
                j = (k + 1) % sides
                self._face([a[k], a[j], b[j], b[k]])
        if not closed:
            self._face(verts[0])
            self._face(verts[-1])

    def tread_block(self, centre, along, angle, radius, taper=0.004):
        """A tyre lug: a block on a wheel turning about x, open underneath."""
        (a0, a1), (t0, t1), (r0, r1) = along, angle, radius

        def corner(a, t, r):
            return (a, centre[1] + r * math.cos(t), centre[2] + r * math.sin(t))

        low = [self._vert(corner(a, t, r0)) for a, t in ((a0, t0), (a1, t0), (a1, t1), (a0, t1))]
        high = [self._vert(corner(a, t, r1)) for a, t in ((a0 + taper, t0 + taper), (a1 - taper, t0 + taper), (a1 - taper, t1 - taper), (a0 + taper, t1 - taper))]
        for i in range(4):
            j = (i + 1) % 4
            self._face([low[i], low[j], high[j], high[i]])
        self._face(high)

    @staticmethod
    def _flip(point, side):
        return (point[0] * side, point[1], point[2])

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
        data.shade_smooth()
        data.set_sharp_from_angle(angle=math.radians(SMOOTH_ANGLE))
        obj = bpy.data.objects.new(mesh.name, data)
        self.collection.objects.link(obj)
        obj.parent = parent
        parent_offset = parent.matrix_world.translation if parent.type == "EMPTY" else parent["pivot"]
        obj.location = offset - Vector(parent_offset)
        obj["pivot"] = tuple(offset)
        return obj


SIDES = (("L", 1), ("R", -1))


def leaf_spring(m, x, z0, z1, top):
    """A stack of leaves, each shorter than the one above, arched over the axle."""
    for leaf in range(5):
        shrink = 0.86 ** leaf
        mid, half = (z0 + z1) / 2, (z1 - z0) / 2 * shrink
        y = top - leaf * 0.024
        points = [(x, y - 0.05 * (1 - ((i - 5) / 5) ** 2) * -1 - 0.05, mid + half * (i - 5) / 5) for i in range(11)]
        m.sweep(points, 0.05, sides=4, squash=0.2)


def chassis_frame():
    m = Mesh("Chassis_Frame", "M_Steel")
    for side in (1, -1):
        # C-section rails.
        m.box((side * 0.41, FRAME_Y[0], -3.80), (side * 0.425, FRAME_Y[1], FRAME_FRONT_Z))
        m.box((side * 0.41, FRAME_Y[1] - 0.018, -3.80), (side * 0.49, FRAME_Y[1], FRAME_FRONT_Z))
        m.box((side * 0.41, FRAME_Y[0], -3.80), (side * 0.49, FRAME_Y[0] + 0.018, FRAME_FRONT_Z))
        leaf_spring(m, side * 0.45, 1.55, 2.65, FRAME_Y[0] - 0.02)
        leaf_spring(m, side * 0.45, -2.75, -1.45, FRAME_Y[0] - 0.02)
        for z in (FRONT_AXLE_Z - 0.06, FRONT_AXLE_Z + 0.06, REAR_AXLE_Z - 0.07, REAR_AXLE_Z + 0.07):
            m.strut((side * 0.40, 0.60, z), (side * 0.40, 0.72, z), 0.016)  # U bolts
            m.strut((side * 0.50, 0.60, z), (side * 0.50, 0.72, z), 0.016)
        # Shock absorbers and steering knuckle.
        m.sweep([(side * 0.52, 0.86, FRONT_AXLE_Z - 0.22), (side * 0.56, 0.60, FRONT_AXLE_Z - 0.06)], 0.022, sides=8)
        m.sweep([(side * 0.52, 0.86, REAR_AXLE_Z + 0.22), (side * 0.56, 0.60, REAR_AXLE_Z + 0.08)], 0.024, sides=8)
        m.cylinder((side * 0.86, AXLE_Y, FRONT_AXLE_Z), 0.075, 0.09, "x", 12)
        m.cylinder((side * 0.62, AXLE_Y, REAR_AXLE_Z), 0.085, 0.10, "x", 12)
    for z in (2.78, 1.60, 0.20, -1.00, -2.10, -3.20, -3.70):
        m.box((-0.41, 0.82, z - 0.04), (0.41, 0.96, z + 0.04))
    # Axles: an I beam in front, a banjo and pumpkin behind.
    m.sweep([(-0.86, AXLE_Y + 0.02, FRONT_AXLE_Z), (-0.5, AXLE_Y + 0.08, FRONT_AXLE_Z), (0.5, AXLE_Y + 0.08, FRONT_AXLE_Z), (0.86, AXLE_Y + 0.02, FRONT_AXLE_Z)], 0.045, sides=4)
    m.sweep([(-0.80, 0.50, FRONT_AXLE_Z - 0.2), (0.80, 0.50, FRONT_AXLE_Z - 0.2)], 0.018, sides=8)  # tie rod
    m.cylinder((0, AXLE_Y, REAR_AXLE_Z), 0.055, 1.24, "x", 12)
    m.revolve((0, AXLE_Y, REAR_AXLE_Z), [(-0.16, 0.06), (-0.14, 0.15), (0.0, 0.19), (0.14, 0.15), (0.16, 0.06)], "z", 20)
    m.revolve((0, AXLE_Y, REAR_AXLE_Z), [(-0.15, 0.06), (0.0, 0.17), (0.15, 0.06)], "x", 20)
    m.sweep([(0, 0.60, REAR_AXLE_Z + 0.17), (0, 0.82, 1.72)], 0.045, sides=10)  # propshaft
    m.cylinder((0, 0.70, -0.50), 0.08, 0.10, "z", 10)  # centre bearing
    m.box((0.49, 0.82, -1.05), (0.60, 0.88, -0.95))  # tank brackets
    m.box((0.49, 0.82, -0.50), (0.60, 0.88, -0.40))
    # A pintle hook behind.
    m.box((-0.06, 0.74, -3.92 + 0.02), (0.06, 0.86, -3.80))
    return m


DOOR_FRONT_POST = 0.07


def a_pillar_z(y):
    """Where the cab side meets the front face at height y."""
    half = cab_half(y)
    return front_z(half, y)


def door_outline(grow=0.0):
    """The door's edge in (z, y); `grow` opens it up into the shell's opening."""
    (z0, z1), (y0, y1) = DOOR_Z, DOOR_Y
    top_front = a_pillar_z(y1) - DOOR_FRONT_POST
    return fillet_loop([(z0 - grow, y0 - grow), (z1 + grow, y0 - grow), (z1 + grow, DOOR_WINDOW_Y),
                        (top_front + grow, y1 + grow), (z0 - grow, y1 + grow)],
                       (0.06, 0.06, 0.0, 0.05, 0.07))


def door_front_z(y):
    """The door's front edge at height y."""
    return lerp(DOOR_Z[1], a_pillar_z(DOOR_Y[1]) - DOOR_FRONT_POST, clamp01((y - DOOR_WINDOW_Y) / (DOOR_Y[1] - DOOR_WINDOW_Y)))


def window_outline():
    """The door window in (z, y)."""
    y0, y1 = DOOR_WINDOW_Y + 0.03, DOOR_Y[1] - 0.075
    z0, z1 = DOOR_Z[0] + 0.08, DOOR_Z[1] - 0.075
    return fillet_loop([(z0, y0), (z1, y0), (a_pillar_z(y1) - DOOR_FRONT_POST - 0.075, y1), (z0, y1)], 0.055)


def windshield_outline():
    y0, y1 = WINDSHIELD_BASE[1] + 0.055, ROOF_BASE_Y - 0.055
    return fillet_loop([(-0.985, y0), (0.985, y0), (0.915, y1), (-0.915, y1)], 0.10, 12)


def rear_window_outline():
    return fillet_loop([(-0.60, 1.75), (0.60, 1.75), (0.60, 2.25), (-0.60, 2.25)], 0.07)


def lift(loop, place):
    """A 2D loop as 3D points on a surface."""
    return [place(u, v, 0.0) for u, v in loop]


def back_point(x, y, depth=0.0):
    return (x, y, CAB_BACK_Z + depth)


def roof_point(u, t, depth=0.0):
    """u runs back to front, t across; the crown falls off to every edge and the front
    edge follows the windshield's curve with a short lip."""
    rise = ROOF_Y - ROOF_BASE_Y
    half = cab_half(ROOF_BASE_Y)
    z = lerp(CAB_BACK_Z, front_z(t * half, ROOF_BASE_Y) + 0.05, u)
    back = clamp01(u / 0.34)
    front = clamp01((1 - u) / 0.28)
    fall = math.sqrt(1 - (1 - back) ** 2) * (0.25 + 0.75 * math.sqrt(1 - (1 - front) ** 2))
    return (t * half * cab_plan(z), ROOF_BASE_Y + rise * fall * math.sqrt(max(0.0, 1 - abs(t) ** 3.4)) - depth, z)


def cowl_point(u, t, depth=0.0):
    """From the hood's rear edge (u = 0) to the windshield's base (u = 1): a straight, flat
    panel as wide as the cab, whose sides stand in the plane of the door."""
    base_y = WINDSHIELD_BASE[1]
    x = t * (CAB_HALF_WIDTH - 0.006 - depth)
    top = lerp(HOOD_TOP_Y - 0.03, base_y, u)
    n = lerp(LID_SQUARENESS, 16.0, u)
    y = COWL_EDGE_Y + (top - COWL_EDGE_Y) * max(0.0, 1 - abs(t) ** n) ** (1 / n)
    return (x, y - depth, lerp(HOOD_REAR_Z + 0.03, front_z(x, base_y), u))


def cabin_shell():
    m = Mesh("Cabin_Shell", "M_Body")
    half = CAB_HALF_WIDTH
    m.box((-half + 0.02, 1.06, CAB_BACK_Z), (half - 0.02, 1.10, FIREWALL_Z), (10, 1, 10))  # floor
    m.box((-half, 0.92, FIREWALL_Z - 0.02), (half, WINDSHIELD_BASE[1], FIREWALL_Z + 0.02), (10, 6, 1))  # firewall

    # Each side: the cab's silhouette around the door opening. In front of the door it runs
    # on behind the fender's sweep to the hood's rear edge, flat with the door.
    base_y = WINDSHIELD_BASE[1]
    corners = [(CAB_BACK_Z, 0.90), (1.38, 0.90), (1.62, 1.32), (HOOD_REAR_Z - 0.012, 1.58),
               (HOOD_REAR_Z - 0.012, 1.86), (a_pillar_z(base_y), base_y),
               (a_pillar_z(ROOF_BASE_Y), ROOF_BASE_Y), (CAB_BACK_Z, ROOF_BASE_Y)]
    outer, opening = radial_pair(fillet_loop(corners, 0.0), door_outline(DOOR_GAP), count=96)
    for side in (1, -1):
        m.sheet(outer, opening, 3, side_point, 0.05, side)

    # The front around the windshield.
    low = WINDSHIELD_BASE[1]
    outer = resample([(-cab_half(low), low), (0.0, low), (cab_half(low), low), (cab_half(ROOF_BASE_Y), ROOF_BASE_Y),
                      (0.0, ROOF_BASE_Y), (-cab_half(ROOF_BASE_Y), ROOF_BASE_Y)], 112, (-cab_half(low), low))
    m.sheet(outer, resample(windshield_outline(), 112, (-1.0, WINDSHIELD_BASE[1])), 2, front_point, 0.05)

    # The back around the rear window.
    width = cab_plan(CAB_BACK_Z)
    outer = resample([(-half * width, 0.92), (half * width, 0.92), (cab_half(ROOF_BASE_Y) * width, ROOF_BASE_Y),
                      (-cab_half(ROOF_BASE_Y) * width, ROOF_BASE_Y)], 64, (-half, 0.92))
    m.sheet(outer, resample(rear_window_outline(), 64, (-0.6, 1.7)), 3, back_point, 0.04)

    m.patch((0.0, 1.0), (-1.0, 1.0), (8, 56), lambda u, v, depth: cowl_point(u, math.sin(v * math.pi / 2), depth), 0.03)
    m.patch((0.0, 1.0), (-1.0, 1.0), (18, 36), roof_point, 0.03)
    return m


def cabin_trim():
    """Window rubbers, the windshield's centre post and the drip rails."""
    m = Mesh("Cabin_Trim", "M_Rubber")
    # The door seal: a dark rebate behind the shut line, which also keeps daylight out.
    opening = resample(door_outline(DOOR_GAP * 2), 80, (DOOR_Z[0], DOOR_Y[0]))
    rebate = resample(door_outline(-0.012), 80, (DOOR_Z[0], DOOR_Y[0]))
    for side in (1, -1):
        m.sheet(opening, rebate, 1, lambda z, y, depth: side_point(z, y, 0.012 + depth), 0.012, side)
        # The maker's badge on the cowl side.
        m.box((side * (CAB_HALF_WIDTH - 0.006), 1.70, 1.33), (side * (CAB_HALF_WIDTH + 0.004), 1.76, 1.46))
    m.sweep([front_point(u, v, -0.005) for u, v in resample(windshield_outline(), 112, (-1.0, WINDSHIELD_BASE[1]))], 0.016, True)
    m.sweep([back_point(u, v, -0.006) for u, v in resample(rear_window_outline(), 48, (-0.6, 1.7))], 0.016, True)
    m.sweep([front_point(0.0, lerp(WINDSHIELD_BASE[1] + 0.055, ROOF_BASE_Y - 0.055, i / 8), -0.004) for i in range(9)], 0.016)
    for side in (1, -1):
        rail = [side_point(z, ROOF_BASE_Y - 0.012, -0.012) for z in (lerp(0.12, a_pillar_z(ROOF_BASE_Y) - 0.02, i / 10) for i in range(11))]
        m.sweep([(x * side, y, z) for x, y, z in rail], 0.013)
    return m


def cabin_interior():
    m = Mesh("Cabin_Interior", "M_Interior")
    cushion = fillet_loop([(0.15, 1.28), (0.75, 1.28), (0.75, 1.50), (0.15, 1.50)], 0.07)
    m.loft([[(x, y, z) for z, y in cushion] for x in (-0.92, -0.70, 0.70, 0.92)])
    m.box((-0.90, 1.10, 0.18), (0.90, 1.30, 0.72), (6, 1, 3))  # seat base
    back = fillet_loop([(0.10, 1.50), (0.26, 1.50), (0.22, 2.12), (0.08, 2.12)], 0.06)
    m.loft([[(x, y, z) for z, y in back] for x in (-0.92, -0.70, 0.70, 0.92)])
    m.box((-1.0, 1.62, 1.10), (1.0, 1.90, FIREWALL_Z - 0.02), (6, 2, 1))  # dashboard
    m.box((0.28, 1.90, 1.12), (0.72, 1.96, 1.26))  # gauge hood
    wheel = (0.50, 1.84, 0.98)
    tilt = Matrix.Rotation(math.radians(-25), 3, "X")
    m.revolve(wheel, [(-0.018, 0.195), (-0.018, 0.225), (0.018, 0.225), (0.018, 0.195)],
              "z", 24, tilt)  # steering wheel rim
    m.strut(wheel, (0.50, 1.64, 1.27), 0.05)  # column
    m.strut((0.30, 1.84, 0.98), (0.70, 1.84, 0.98), 0.03)  # spoke
    for x in (0.34, 0.50, 0.66):
        m.box((x - 0.05, 1.14, 1.12), (x + 0.05, 1.16, 1.26))  # pedals
    m.strut((0.0, 1.10, 1.05), (0.0, 1.62, 0.94), 0.025)  # gear lever
    return m


def engine_block():
    m = Mesh("Engine_Block", "M_Engine")
    m.box((-0.24, 0.78, 1.64), (0.24, 1.22, 2.48), (3, 3, 4))  # block
    m.box((-0.20, 1.22, 1.68), (0.20, 1.34, 2.44), (2, 1, 4))  # head
    loop = fillet_loop([(-0.16, 1.34), (0.16, 1.34), (0.16, 1.44), (-0.16, 1.44)], 0.04)
    m.loft([[(x, y, z) for x, y in resample(loop, 20, (-0.16, 1.34))] for z in (1.70, 2.42)])  # rocker cover
    m.revolve((0, 1.32, 2.52), [(-0.02, 0.04), (0.02, 0.04), (0.02, 0.20), (-0.02, 0.20)], "z", 20)  # fan shroud ring
    for i in range(5):
        angle = 2 * math.pi * i / 5
        m.strut((0, 1.32, 2.52), (0.19 * math.cos(angle), 1.32 + 0.19 * math.sin(angle), 2.52), 0.05, 0.008)  # fan
    m.cylinder((0.33, 1.22, 2.34), 0.08, 0.18, "z", 14)  # alternator
    m.cylinder((-0.34, 1.34, 1.98), 0.14, 0.14, "y", 18)  # air filter
    m.sweep([(-0.26, 1.10, 2.30), (-0.34, 1.05, 2.10), (-0.34, 0.90, 1.80), (-0.34, 0.74, 1.55)], 0.04, sides=8)  # exhaust
    m.box((-0.52, 0.95, 2.63), (0.52, 1.64, 2.77), (3, 3, 1))  # radiator
    for i in range(8):
        y = lerp(1.0, 1.55, i / 7)
        m.box((-0.50, y, 2.77), (0.50, y + 0.02, 2.79))
    return m


def tow_hook(name, side):
    m = Mesh(name, "M_Steel", side, (0.45, 0.66, 2.92))
    m.box((0.41, 0.72, 2.82), (0.49, FRAME_Y[0], 2.95))
    m.box((0.41, 0.64, 2.82), (0.49, 0.72, 3.09))
    # A U shackle on a pin through the lug.
    x, y, z = 0.45, 0.665, 3.07
    span = 0.062
    u = [(x + span * math.cos(a), y - 0.055 - span * math.sin(a), z) for a in (math.pi * i / 12 for i in range(13))]
    m.sweep([(x + span, y + 0.01, z)] + u + [(x - span, y + 0.01, z)], 0.015, sides=8)
    m.sweep([(x - span - 0.02, y + 0.01, z), (x + span + 0.02, y + 0.01, z)], 0.012, sides=8)
    return m


def fuel_tank():
    m = Mesh("Fuel_Tank", "M_Steel", 1, (0.60, 0.80, -0.72))
    section = resample(fillet_loop([(0.60, 0.56), (1.10, 0.56), (1.10, 0.92), (0.60, 0.92)], 0.09), 36, (0.60, 0.56))
    rings = []
    for i in range(11):
        z = lerp(-1.20, -0.25, i / 10)
        end = abs(2 * i / 10 - 1) ** 8
        rings.append([(lerp(0.85, x, 1 - 0.04 * end), lerp(0.74, y, 1 - 0.04 * end), z) for x, y in section])
    m.loft(rings)
    for z in (-1.02, -0.43):  # straps
        m.sweep([(lerp(0.85, x, 1.03), lerp(0.74, y, 1.05), z) for x, y in section], 0.012, True, sides=4, squash=2.0)
    m.cylinder((0.90, 0.94, -0.72), 0.05, 0.05, "y", 16)  # filler
    return m


def rear_bumper():
    m = Mesh("Rear_Bumper", "M_Steel", 1, (0.0, 0.80, -3.80))
    section = resample(fillet_loop([(TAIL_Z, 0.74), (-3.80, 0.74), (-3.80, 0.86), (TAIL_Z, 0.86)], 0.018), 18, (TAIL_Z, 0.74))
    m.loft([[(lerp(-1.10, 1.10, i / 20), y, z) for z, y in section] for i in range(21)])
    return m


def cab_step(name, side):
    m = Mesh(name, "M_Steel", side, (0.98, 0.72, 0.60))
    m.box((0.98, 0.70, 0.28), (1.16, 0.72, 0.98))  # tread
    for i in range(8):
        m.box((0.985, 0.72, lerp(0.30, 0.96, i / 7) - 0.012), (1.155, 0.728, lerp(0.30, 0.96, i / 7) + 0.012))
    m.box((1.145, 0.70, 0.28), (1.16, 0.90, 0.98), (1, 2, 6))  # riser
    m.strut((0.49, 0.84, 0.32), (1.00, 0.72, 0.32), 0.04)
    m.strut((0.49, 0.84, 0.92), (1.00, 0.72, 0.92), 0.04)
    return m


def rear_mudflap(name, side, z, x, y):
    """A flap on a stay braced back to the frame."""
    m = Mesh(name, "M_Tyre", side, (x[0], y[1], z))
    loop = resample(fillet_loop([(x[0], y[0]), (x[1], y[0]), (x[1], y[1]), (x[0], y[1])], (0.04, 0.04, 0.0, 0.0)), 24, (x[0], y[0]))
    m.loft([[(u, v, z + offset) for u, v in loop] for offset in (-0.012, 0.012)])
    m.sweep([(x[0] + 0.05, 0.60, z + 0.02), (x[0] + 0.05, y[1], z + 0.02), (0.49, 0.96, z + 0.55)], 0.016, sides=6)
    m.sweep([(x[1] - 0.05, 0.60, z + 0.02), (x[1] - 0.05, y[1], z + 0.02), (x[1] - 0.05, 1.14, z + 0.5)], 0.016, sides=6)
    return m


def front_mudflap(name, side):
    """As wide as the tyre, its top bolted to the firewall behind the fender's tail: it
    narrows above the tail's tip to fit inside the fender."""
    z = FIREWALL_Z + 0.03
    x0, x1, inside = 0.86, 1.19, CAB_HALF_WIDTH - 0.04
    top = 0.96
    m = Mesh(name, "M_Tyre", side, (x0, top, z))
    outline = [(x0, 0.32), (x1, 0.32), (x1, 0.58), (inside, 0.66), (inside, top), (x0, top)]
    loop = resample(fillet_loop(outline, (0.04, 0.04, 0.03, 0.03, 0.0, 0.0)), 28, (x0, 0.32))
    m.loft([[(u, v, z + offset) for u, v in loop] for offset in (-0.012, 0.012)])
    return m


def front_bumper():
    z0, z1 = BUMPER_BACK_Z, NOSE_Z - 0.005
    m = Mesh("Front_Bumper", "M_Steel", 1, (0.0, sum(BUMPER_Y) / 2, z0))
    y0, y1 = BUMPER_Y
    section = resample(fillet_loop([(z0, y0), (z1, y0), (z1, y1), (z0, y1)], 0.03), 28, (z0, y0))
    rings = []
    for i in range(33):
        x = lerp(-FENDER_OUTER_X, FENDER_OUTER_X, i / 32)
        end = clamp01((abs(x) - 1.10) / 0.10) ** 2  # a steel beam: square, with its ends just eased
        rings.append([(x, lerp(sum(BUMPER_Y) / 2, y, 1 - 0.05 * end), lerp(z0, z, 1 - 0.08 * end)) for z, y in section])
    m.loft(rings)
    m.box((-0.33, 0.785, NOSE_Z - 0.01), (0.33, 0.915, NOSE_Z), (6, 1, 1))  # number plate
    for x in (-0.86, -0.66, 0.66, 0.86):
        for y in (0.79, 0.91):
            m.cylinder((x, y, NOSE_Z - 0.006), 0.016, 0.012, "z", 8)
    return m


def smoothstep(a, b, value):
    t = clamp01((value - a) / (b - a))
    return t * t * (3 - 2 * t)


def hood_half(s):
    """Half the hood's width, s from its rear edge (0) to its nose (1): near enough parallel."""
    return lerp(HOOD_REAR_HALF, HOOD_HALF_WIDTH, s)


def hood_point(z, t, depth=0.0):
    """t runs from -1 to 1 across the hood. It is a lid: a flat, gently crowned top, a tight
    shoulder and short straight sides that end in the gutter along the fender's shelf. Seen
    from the side its centre line falls almost straight to a blunt nose."""
    s = clamp01((z - HOOD_REAR_Z) / (HOOD_FRONT_Z - HOOD_REAR_Z))
    a = abs(t)
    ridge = lerp(HOOD_TOP_Y, HOOD_NOSE_Y, s ** 1.6) - 0.035 * a * a
    n = LID_SQUARENESS
    y = HOOD_LIP_Y + (ridge - HOOD_LIP_Y) * max(0.0, 1 - a ** n) ** (1 / n)
    # The nose rolls over in a quarter round.
    nose = clamp01((s - 0.93) / 0.07)
    lip = min(HOOD_FRONT_LIP_Y, y)
    y = lip + (y - lip) * math.sqrt(max(0.0, 1 - nose * nose))
    y += 0.014 * math.sin(math.pi * s) ** 0.4 * (1 - smoothstep(0.0, 0.05, a))  # centre spine
    return (t * (hood_half(s) - depth), y - depth, z - 0.05 * t * t * s)


def hood():
    m = Mesh("Hood", "M_Body", 1, (0.0, HOOD_TOP_Y, HOOD_REAR_Z))
    # Rows close up towards the nose and the sides, where the lid turns.
    place = lambda u, v, depth: hood_point(lerp(HOOD_REAR_Z, HOOD_FRONT_Z, 1 - (1 - u) ** 1.7), math.sin(v * math.pi / 2), depth)
    m.patch((0.0, 1.0), (-1.0, 1.0), (32, 56), place, 0.025)
    return m


def wheel_arch():
    """The wheel opening in (z, y): a flat top, and a rear edge that runs down and back with
    the fender's sweep. It goes on below the fender so a ray from the axle always leaves it."""
    return fillet_loop([(2.78, 0.30), (2.76, 0.80), (2.47, 1.33), (1.70, 1.33), (1.37, 0.68), (1.33, 0.30)],
                       (0.0, 0.02, 0.26, 0.22, 0.02, 0.0), 10)


def fender_outline():
    """The fender's edge in (z, y): a square front, a flat shelf, then a long sweep down and
    back past the door's foot."""
    return fillet_loop([(FENDER_FRONT_Z, 0.30), (FENDER_FRONT_Z, HOOD_EDGE_Y), (1.62, HOOD_EDGE_Y), (1.14, 0.60), (1.14, 0.30)],
                       (0.0, 0.085, 0.24, 0.0, 0.0), 10)


def fender(name, side):
    """Hollow front fender: a raised band round the arch, a broad side, a tight shoulder and
    a flat shelf with a gutter for the hood's side to stand in."""
    m = Mesh(name, "M_Body", side, (FENDER_INNER_X, HOOD_EDGE_Y, FRONT_AXLE_Z))
    axle = (FRONT_AXLE_Z, AXLE_Y)
    arch, edge = wheel_arch(), fender_outline()
    wide = FENDER_OUTER_X + 0.012
    steps = 64
    angles = [lerp(FENDER_FRONT_ANGLE, FENDER_REAR_ANGLE, i / steps) for i in range(steps + 1)]
    angles = sorted(set(angles + [lerp(47.0, 60.0, i / 8) for i in range(9)]))  # the front corner
    rings = []
    for degrees in angles:
        angle = math.radians(degrees)
        c, s = math.cos(angle), math.sin(angle)
        ra = math.hypot(*(a - b for a, b in zip(ray_exit(arch, axle, angle), axle)))
        rim = ray_exit(edge, axle, angle)
        rb = max(math.hypot(rim[0] - axle[0], rim[1] - axle[1]), ra + 0.09)
        # The front stops outside the lamp sockets, then reaches in to the grille frame over
        # the pods' shoulder; further back the hood covers it.
        inner = lerp(FENDER_FRONT_OUTSIDE_X, FENDER_FRONT_INNER_X, smoothstep(43.0, 50.0, degrees))
        inner = lerp(inner, FENDER_INNER_X, smoothstep(62.0, 80.0, degrees))
        # The tail eases in towards the door instead of ending proud of it.
        outer = lerp(wide, CAB_HALF_WIDTH + 0.02, smoothstep(112.0, FENDER_REAR_ANGLE, degrees))
        band = min(0.105, (rb - ra) * 0.45)
        h = max(0.012, min(0.085, (rb - ra - band - 0.02) * 0.7))
        # The gutter only lies along the flat of the shelf.
        on_shelf = smoothstep(HOOD_EDGE_Y - 0.03, HOOD_EDGE_Y - 0.005, rim[1])
        gutter_x = min(hood_half(clamp01((rim[0] - HOOD_REAR_Z) / (HOOD_FRONT_Z - HOOD_REAR_Z))) + 0.012, outer - 0.11)
        gutter_x = max(gutter_x, inner + 0.03)
        drop = GUTTER_DEPTH * on_shelf
        section = [
            (inner, ra), (outer - 0.03, ra), (outer, ra + 0.012), (outer, ra + band), (outer - 0.022, ra + band + 0.018),
            (outer - 0.024, rb - h), (outer - 0.034, rb - h * 0.55), (outer - 0.06, rb - h * 0.14), (outer - 0.10, rb),
            (gutter_x, rb), (gutter_x - 0.012, rb - drop), (inner, rb - drop),
            (inner, rb - drop - 0.024), (gutter_x - 0.03, rb - drop - 0.024), (outer - 0.11, rb - 0.03),
            (outer - 0.07, rb - h * 0.14 - 0.03), (outer - 0.055, rb - h * 0.55 - 0.02),
            (outer - 0.05, ra + band + 0.02), (outer - 0.05, ra + 0.03), (inner, ra + 0.03),
        ]
        rings.append([(x, AXLE_Y + r * s, FRONT_AXLE_Z + r * c) for x, r in section])
    m.loft(rings)
    return m


def fender_marker(name, side):
    m = Mesh(name, "M_Amber", side, (1.188, 1.51, 2.62))
    m.revolve((1.188, 1.51, 2.62), [(-0.006, 0.002), (-0.006, 0.034), (0.012, 0.03), (0.02, 0.018), (0.024, 0.002)], "x", 16)
    return m


def inner_fender(name, side):
    """The wheel well's closed inner wall and roof: they keep the engine bay out of sight
    through the arch, and are what shows once the fender has gone. A dark strip lies in the
    fender's gutter, for the line along the hood's side."""
    x0, x1 = INNER_FENDER_X, FENDER_FRONT_OUTSIDE_X + 0.01
    m = Mesh(name, "M_Rubber", side, (x0, 1.15, FRONT_AXLE_Z))
    axle = (FRONT_AXLE_Z, AXLE_Y)
    arch = wheel_arch()

    def roof(t, x, depth):
        angle = math.radians(lerp(16.0, 164.0, t))
        z, y = ray_exit(arch, axle, angle)
        grow = 0.03 - depth
        return (x, y + grow * math.sin(angle), z + grow * math.cos(angle))

    wall = [(FENDER_FRONT_Z - 0.04, 0.76), (FENDER_FRONT_Z - 0.04, HOOD_EDGE_Y - 0.02),
            (FIREWALL_Z + 0.03, HOOD_EDGE_Y - 0.02), (FIREWALL_Z + 0.03, 0.76)]
    m.prism(wall, x0 - 0.012, x0)
    m.patch((0.0, 1.0), (x0, x1), (36, 3), roof, 0.012)
    gutter = [(hood_half(i / 16) + 0.004, HOOD_EDGE_Y - GUTTER_DEPTH + 0.004, lerp(HOOD_REAR_Z, HOOD_FRONT_Z - 0.07, i / 16)) for i in range(17)]
    m.sweep(gutter, 0.016, sides=6)
    return m


def door(name, side):
    m = Mesh(name, "M_Body", side, (CAB_HALF_WIDTH, DOOR_WINDOW_Y, DOOR_Z[1]))
    outer, inner = radial_pair(door_outline(), window_outline(), count=80)
    m.sheet(outer, inner, 9, side_point, DOOR_SKIN)
    # Pressed lines: the belt under the window and a frame round the lower panel.
    belt = DOOR_WINDOW_Y - 0.035
    m.sweep([side_point(lerp(DOOR_Z[0] + 0.05, DOOR_Z[1] - 0.05, i / 18), belt, -0.002) for i in range(19)], 0.009, sides=6, squash=0.5)
    frame = resample(fillet_loop([(0.22, 1.05), (1.14, 1.05), (1.14, 1.68), (0.22, 1.68)], 0.07), 64, (0.22, 1.05))
    m.sweep([side_point(z, y, -0.002) for z, y in frame], 0.008, True, sides=6, squash=0.5)
    return m


def door_trim(name, side):
    """Window rubber, the vent post and the handle: they leave with the door."""
    m = Mesh(name, "M_Rubber", side, (CAB_HALF_WIDTH, DOOR_WINDOW_Y, DOOR_Z[1]))
    window = resample(window_outline(), 120, (DOOR_Z[0], DOOR_Y[0]))
    m.sweep([side_point(z, y, -0.004) for z, y in window], 0.013, True)
    post_z = DOOR_Z[1] - 0.42
    m.sweep([side_point(post_z, lerp(DOOR_WINDOW_Y + 0.03, DOOR_Y[1] - 0.075, i / 4), -0.003) for i in range(5)], 0.011)
    handle = [side_point(z, 1.76, -0.016) for z in (0.20, 0.24, 0.30, 0.36, 0.38)]
    m.sweep(handle, 0.011)
    for z in (0.21, 0.37):
        m.sweep([side_point(z, 1.76, 0.0), side_point(z, 1.76, -0.018)], 0.008, sides=4)
    for y in (1.22, 1.72):
        m.box((CAB_HALF_WIDTH - 0.01, y, DOOR_Z[1] - 0.05), (CAB_HALF_WIDTH + 0.008, y + 0.06, DOOR_Z[1] - 0.012))
    return m


def side_glass(name, side):
    x = DOOR_SKIN / 2
    loop = resample(window_outline(), 120, (DOOR_Z[0], DOOR_Y[0]))
    m = Mesh(name, "M_Glass", side, (CAB_HALF_WIDTH - x, DOOR_WINDOW_Y, DOOR_Z[0] + 0.07))
    m.sheet(loop, shrink_loop(loop, 0.02), 2, lambda z, y, depth: side_point(z, y, x + depth), 0.008)
    return m


def mirror(name, side):
    """Both arms stand on the door, so the door can open and the mirror leaves with it."""
    x0, x1 = MIRROR_MAX_X - 0.18, MIRROR_MAX_X
    z = 1.20
    upper = side_point(door_front_z(2.30) - 0.035, 2.30)  # on the window frame
    lower = side_point(DOOR_Z[1] - 0.10, 1.84)  # under the window
    m = Mesh(name, "M_Rubber", side, lower)
    # The head: a rounded slab.
    loop = resample(fillet_loop([(x0, 2.00), (x1, 2.00), (x1, 2.40), (x0, 2.40)], 0.035), 28, (x0, 2.00))
    m.loft([[(u, v, z + offset) for u, v in loop] for offset in (-0.025, 0.025)])
    # The arms: a bent tube from the window frame to the head and a brace from below.
    m.sweep([upper, (upper[0] + 0.05, 2.34, upper[2] + 0.03), (x0 - 0.02, 2.38, z - 0.02), (x0 + 0.08, 2.38, z)], 0.011)
    m.sweep([lower, (lower[0] + 0.07, 1.90, lower[2] + 0.02), (x0 + 0.08, 2.03, z)], 0.011)
    for foot in (upper, lower):
        m.cylinder((foot[0] + 0.002, foot[1], foot[2]), 0.024, 0.012, "x", 12)
    return m


HEADLIGHT = (0.90, 1.25)
HEADLIGHT_RADIUS = 0.128
SOCKET_RADIUS = 0.150
SIGNAL_Y = 1.505
GRILLE_BOTTOM_Y = 0.90  # behind the bumper, whose top is at 0.98
POD_Z = 2.95  # the lamp pods' face
POD_TOP_Y = 1.585  # the shoulder steps down from the frame to here
FRAME_Z = 2.985  # the grille frame's face, the body's front
FRAME_HALF = 0.71
FRAME_Y_RANGE = (1.00, 1.665)
OPENING_HALF = 0.655
OPENING_Y = (1.07, 1.60)


def circle(centre, radius, count, start=None):
    points = [(centre[0] + radius * math.cos(2 * math.pi * i / count), centre[1] + radius * math.sin(2 * math.pi * i / count))
              for i in range(count)]
    return resample(points, count, start)


def grille_panel():
    """The face: a thick frame round the grille stands proud of two lamp pods. Its top sits
    under the hood's nose and the pods step down from it, with a bead round the frame's two
    edges. The casting runs on behind the bumper, so no gap shows over it."""
    m = Mesh("Grille_Panel", "M_Grille", 1, (0.0, 1.33, 2.90))
    half, (bottom, top) = FRAME_HALF, FRAME_Y_RANGE
    frame = fillet_loop([(-half, bottom), (half, bottom), (half, top - 0.03), (0.36, top - 0.008), (0.0, top),
                         (-0.36, top - 0.008), (-half, top - 0.03)], (0.05, 0.05, 0.07, 0.0, 0.0, 0.0, 0.07), 8)
    opening = fillet_loop([(-OPENING_HALF, OPENING_Y[0]), (OPENING_HALF, OPENING_Y[0]), (OPENING_HALF, OPENING_Y[1]),
                           (-OPENING_HALF, OPENING_Y[1])], 0.05, 8)
    outer, hole = radial_pair(frame, opening, (0.0, 1.335), 96)
    m.sheet(outer, hole, 2, lambda u, v, depth: (u, v, FRAME_Z - depth), 0.09)
    for loop, radius in ((frame, 0.015), (opening, 0.012)):
        m.sweep([(u, v, FRAME_Z + 0.001) for u, v in resample(loop, 96, (-half, bottom))], radius, True, sides=6)
    # The lamp pods, and the strip that carries the casting down behind the bumper.
    pod = fillet_loop([(0.60, GRILLE_BOTTOM_Y), (1.12, GRILLE_BOTTOM_Y), (1.12, POD_TOP_Y), (0.60, POD_TOP_Y)], (0.0, 0.08, 0.09, 0.0), 8)
    place = lambda u, v, depth: (u, v, POD_Z - depth)
    cx, cy = HEADLIGHT
    for side in (1, -1):
        outer_pod, socket = radial_pair(pod, circle(HEADLIGHT, SOCKET_RADIUS, 72), HEADLIGHT, 72)
        m.sheet(outer_pod, socket, 4, place, 0.09, side)
        m.cylinder((side * cx, cy, 2.87), SOCKET_RADIUS, 0.02, "z", 28)  # socket floor
    m.box((-0.62, GRILLE_BOTTOM_Y, POD_Z - 0.09), (0.62, FRAME_Y_RANGE[0] + 0.02, POD_Z), (4, 1, 1))
    # Bars: six across, three upright behind them, a badge in the middle.
    for i in range(6):
        y = lerp(1.112, 1.558, i / 5)
        m.sweep([(lerp(-OPENING_HALF - 0.01, OPENING_HALF + 0.01, k / 8), y, 2.958) for k in range(9)], 0.027, sides=8, squash=0.55)
    for x in (-0.34, 0.0, 0.34):
        m.box((x - 0.02, OPENING_Y[0] - 0.01, 2.90), (x + 0.02, OPENING_Y[1] + 0.01, 2.948))
    m.revolve((0.0, 1.335, 2.968), [(-0.006, 0.002), (-0.006, 0.04), (0.008, 0.036), (0.012, 0.002)], "z", 16)
    return m


def grille_back(name="Grille_Panel_Back"):
    """The dark behind the bars, the lamp bezels and the signal housings."""
    m = Mesh(name, "M_Rubber", 1, (0.0, 1.33, 2.90))
    m.box((-OPENING_HALF - 0.01, OPENING_Y[0] - 0.01, 2.882), (OPENING_HALF + 0.01, OPENING_Y[1] + 0.01, 2.90), (6, 4, 1))
    cx, cy = HEADLIGHT
    for side in (1, -1):
        # A dark sleeve down the socket, so the lamp sits deep, and a narrow lip round its mouth.
        m.revolve((side * cx, cy, POD_Z), [(-0.08, SOCKET_RADIUS - 0.006), (-0.012, SOCKET_RADIUS - 0.006), (-0.002, SOCKET_RADIUS + 0.014),
                                           (0.006, SOCKET_RADIUS + 0.012), (0.009, SOCKET_RADIUS + 0.002), (0.004, SOCKET_RADIUS - 0.010)], "z", 36)
        lens = fillet_loop([(cx - 0.125, SIGNAL_Y - 0.05), (cx + 0.125, SIGNAL_Y - 0.05), (cx + 0.125, SIGNAL_Y + 0.05), (cx - 0.125, SIGNAL_Y + 0.05)], 0.035)
        m.loft([[(side * u, v, z) for u, v in resample(lens, 28, (cx - 0.13, SIGNAL_Y - 0.05))] for z in (POD_Z - 0.01, POD_Z + 0.012)])
    return m


def windshield():
    m = Mesh("Windshield", "M_Glass", 1, (0.0, WINDSHIELD_BASE[1], WINDSHIELD_BASE[0]))
    loop = resample(windshield_outline(), 112, (-1.0, WINDSHIELD_BASE[1]))
    m.sheet(loop, shrink_loop(loop, 0.02), 10, lambda x, y, depth: front_point(x, y, 0.022 + depth), 0.008)
    return m


def rear_window():
    m = Mesh("Rear_Window", "M_Glass", 1, (0.0, 2.0, CAB_BACK_Z))
    loop = resample(rear_window_outline(), 48, (-0.6, 1.7))
    m.sheet(loop, shrink_loop(loop, 0.02), 2, lambda x, y, depth: back_point(x, y, 0.018 + depth), 0.008)
    return m


def headlight(name, side):
    """A domed lens set back in the socket."""
    z = POD_Z - 0.078
    m = Mesh(name, "M_Lamp", side, (HEADLIGHT[0], HEADLIGHT[1], z))
    m.revolve((HEADLIGHT[0], HEADLIGHT[1], z), [(-0.03, HEADLIGHT_RADIUS), (0.018, HEADLIGHT_RADIUS),
                                                (0.034, 0.106), (0.045, 0.066), (0.047, 0.02), (0.048, 0.001), (-0.03, 0.001)], "z", 32)
    return m


def turn_signal(name, side):
    cx = HEADLIGHT[0]
    z = POD_Z + 0.008
    m = Mesh(name, "M_Amber", side, (cx, SIGNAL_Y, z))
    lens = fillet_loop([(cx - 0.10, SIGNAL_Y - 0.034), (cx + 0.10, SIGNAL_Y - 0.034), (cx + 0.10, SIGNAL_Y + 0.034), (cx - 0.10, SIGNAL_Y + 0.034)], 0.025)
    m.loft([[(u, v, w) for u, v in resample(lens, 24, (cx - 0.1, SIGNAL_Y - 0.03))] for w in (z, z + 0.015)])
    return m


def tail_lamp(name, side):
    m = Mesh(name, "M_Red", side, (0.92, 0.93, -3.86))
    loop = resample(fillet_loop([(0.78, 0.88), (1.06, 0.88), (1.06, 0.98), (0.78, 0.98)], 0.02), 24, (0.78, 0.88))
    m.loft([[(u, v, z) for u, v in loop] for z in (TAIL_Z, -3.84)])
    return m


def wiper(name, x):
    m = Mesh(name, "M_Steel", 1, (x, 2.0, front_z(x, 2.0)))
    m.strut((x, 2.0, front_z(x, 2.0) + 0.012), (x - 0.34, 2.18, front_z(x - 0.34, 2.18) + 0.012), 0.012)
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
            # Stake pockets under the rail.
            m.box((side * (half - 0.05), 1.18, z - 0.05), (side * (half + 0.018), 1.22, z + 0.05))
    # Floor boards, proud of the steel.
    for i in range(10):
        x = lerp(-1.08, 1.08, i / 9)
        m.box((x - 0.112, BED_FLOOR_Y, TAIL_Z + 0.04), (x + 0.112, BED_FLOOR_Y + 0.008, BED_FRONT_Z - 0.04))
    return m


def plank(m, lo, hi, axis_x, stations):
    """One board with softened edges along its length."""
    round_ = 0.008
    y0, y1 = lo[1], hi[1]
    if axis_x:
        section = [(lo[2] + round_, y0), (hi[2] - round_, y0), (hi[2], y0 + round_), (hi[2], y1 - round_),
                   (hi[2] - round_, y1), (lo[2] + round_, y1), (lo[2], y1 - round_), (lo[2], y0 + round_)]
        m.loft([[(lerp(lo[0], hi[0], i / stations), y, z) for z, y in section] for i in range(stations + 1)])
    else:
        section = [(lo[0] + round_, y0), (hi[0] - round_, y0), (hi[0], y0 + round_), (hi[0], y1 - round_),
                   (hi[0] - round_, y1), (lo[0] + round_, y1), (lo[0], y1 - round_), (lo[0], y0 + round_)]
        m.loft([[(x, y, lerp(lo[2], hi[2], i / stations)) for x, y in section] for i in range(stations + 1)])


def planks(m, lo, hi, axis_x, count=4):
    """Stacked boards with a groove between them, a thicker cap on top."""
    y0, y1 = BED_RAIL_TOP_Y, BED_TOP_Y
    groove = 0.012
    pitch = (y1 - y0) / count
    for i in range(count):
        a, b = y0 + i * pitch + groove / 2, y0 + (i + 1) * pitch - groove / 2
        grow = 0.008 if i == count - 1 else 0.0
        if axis_x:
            plank(m, (lo[0], a, lo[1] - grow), (hi[0], b, hi[1] + grow), True, 16)
        else:
            plank(m, (lo[0] - grow, a, lo[1]), (hi[0] + grow, b, hi[1]), False, 24)


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
    planks(m, (-half, TAIL_Z + 0.008), (half, TAIL_Z + 0.038), True)  # the top board is 8 mm prouder
    return m


def cargo_stake(name, side, z):
    m = Mesh(name, "M_Body", side, (BED_HALF_WIDTH, BED_RAIL_TOP_Y, z))
    x0, x1 = BED_PLANK_OUTER_X, BED_HALF_WIDTH
    y0, y1 = BED_FLOOR_Y - 0.08, BED_TOP_Y + 0.02
    # A U channel over the boards.
    m.box((x1 - 0.006, y0, z - 0.04), (x1, y1, z + 0.04), (1, 6, 1))
    for offset in (-0.04, 0.034):
        m.box((x0, y0, z + offset), (x1, y1, z + offset + 0.006), (1, 6, 1))
    # Hinge straps riveted across the boards.
    for y in (BED_RAIL_TOP_Y + 0.10, BED_TOP_Y - 0.12):
        back, front = max(z - 0.10, TAIL_Z + 0.002), min(z + 0.10, BED_FRONT_Z - 0.002)
        m.box((x0 - 0.002, y, back), (x0 + 0.006, y + 0.05, front), (1, 1, 2))
        for rivet in (back + 0.025, front - 0.025):
            m.cylinder((x0 + 0.008, y + 0.025, rivet), 0.012, 0.008, "x", 8)
    return m


def cargo_latch(name, side):
    m = Mesh(name, "M_Steel", side, (1.10, 1.85, TAIL_Z))
    # All of it stays inside the tail line, which is the truck's length.
    m.box((1.02, 1.83, TAIL_Z + 0.004), (1.20, 1.87, TAIL_Z + 0.015))
    m.cylinder((1.16, 1.85, TAIL_Z + 0.010), 0.026, 0.02, "z", 10)
    m.sweep([(1.06, 1.85, TAIL_Z + 0.007), (1.16, 1.85, TAIL_Z + 0.007)], 0.006, sides=6)
    return m


def cab_guard():
    m = Mesh("Cab_Guard", "M_Steel", 1, (0.0, 1.30, -0.05))
    z = -0.045
    frame = [(-0.92, BED_FLOOR_Y, z), (-0.92, 2.34, z), (-0.86, 2.42, z), (0.86, 2.42, z), (0.92, 2.34, z), (0.92, BED_FLOOR_Y, z)]
    m.sweep(frame, 0.024, sides=8)
    m.sweep([(-0.92, 2.16, z), (0.92, 2.16, z)], 0.018, sides=8)
    for x in (-0.46, 0.0, 0.46):
        m.sweep([(x, 2.16, z), (x, 2.42, z)], 0.012, sides=6)
    return m


TREAD_LUGS = 32
TREAD_ROOT = 0.532


def tyre_profile(centre, width):
    half = width / 2
    return [(centre - half, 0.345), (centre - half + 0.008, 0.42), (centre - half, 0.49), (centre - half + 0.022, TREAD_ROOT),
            (centre + half - 0.022, TREAD_ROOT), (centre + half, 0.49), (centre + half - 0.008, 0.42), (centre + half, 0.345)]


def tread(m, wheel_centre, cx, width):
    """Block lugs in staggered rows, with shoulder blocks turning down the sidewall.
    The count is a multiple of four, so the tyre's box stays centred on the axle."""
    half = width / 2
    pitch = 2 * math.pi / TREAD_LUGS
    gap = pitch * 0.13
    centre = (0.0, wheel_centre[1], wheel_centre[2])
    rows = 4
    row_width = (width - 0.03) / rows
    for row in range(rows):
        a0 = cx - half + 0.015 + row * row_width
        a1 = a0 + row_width - 0.012
        phase = pitch / 2 if row % 2 else 0.0
        for i in range(TREAD_LUGS):
            t = i * pitch + phase
            m.tread_block(centre, (a0, a1), (t + gap, t + pitch - gap), (TREAD_ROOT - 0.004, WHEEL_RADIUS))
            if row in (0, rows - 1):
                outer = (cx - half - 0.004, cx - half + 0.02) if row == 0 else (cx + half - 0.02, cx + half + 0.004)
                m.tread_block(centre, outer, (t + gap * 2, t + pitch - gap * 2), (0.475, WHEEL_RADIUS - 0.012))


def wheel(name, side, x, front):
    """Tyre mesh at the axle centre. Everything stays inside the tyre's width, so the
    node's bounding box centre is the wheel centre that bindModelWheel pivots on."""
    centre = (x, AXLE_Y, FRONT_AXLE_Z if front else REAR_AXLE_Z)
    tyre = Mesh(name, "M_Tyre", side, centre)
    rim = Mesh(f"{name}_Rim", "M_Rim", side, centre)
    if front:
        tyres = [0.0]
        width = FRONT_TYRE_WIDTH
    else:
        offset = (DUAL_TYRE_WIDTH + DUAL_GAP) / 2
        tyres = [-offset, offset]
        width = DUAL_TYRE_WIDTH
    axis = (x, AXLE_Y, centre[2])
    for along in tyres:
        tyre.revolve(axis, tyre_profile(along, width), "x", 40)
        tread(tyre, axis, x + along, width)
    # The steel wheel: a flanged rim, a dished disc with vent holes, a hub with nuts and a cap.
    c = max(tyres)
    f = width / 2 - 0.035
    rim.revolve(axis, [(c - f, 0.30), (c - f, 0.345), (c + f - 0.01, 0.345), (c + f, 0.352), (c + f + 0.006, 0.345),
                       (c + f - 0.005, 0.325), (c + f - 0.05, 0.30), (c + f - 0.075, 0.18), (c + f - 0.04, 0.145),
                       (c + f - 0.012, 0.135), (c + f, 0.09), (c + f + 0.014, 0.066), (c + f + 0.014, 0.002),
                       (c - f, 0.002)], "x", 40)
    if len(tyres) == 2:
        rim.revolve(axis, [(min(tyres) - f, 0.30), (min(tyres) - f, 0.345), (c - f, 0.345), (c - f, 0.30)], "x", 40)
    for i in range(8):
        angle = 2 * math.pi * (i + 0.5) / 8
        tyre.cylinder((x + c + f - 0.052, AXLE_Y + 0.235 * math.cos(angle), centre[2] + 0.235 * math.sin(angle)), 0.03, 0.012, "x", 12)
    for i in range(10):
        angle = 2 * math.pi * i / 10
        rim.cylinder((x + c + f + 0.002, AXLE_Y + 0.108 * math.cos(angle), centre[2] + 0.108 * math.sin(angle)), 0.015, 0.028, "x", 6)
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
        shell = b.add(mesh, chassis)
        if mesh.name == "Cabin_Shell":
            b.add(cabin_trim(), shell)
    for suffix, side in SIDES:
        b.add(tow_hook(f"Tow_Hook_{suffix}", side), chassis)
        b.add(cab_step(f"Cab_Step_{suffix}", side), chassis)
        b.add(front_mudflap(f"Mudflap_F{suffix}", side), chassis)
        b.add(rear_mudflap(f"Mudflap_R{suffix}", side, -2.76, (0.58, 1.22), (0.36, 1.12)), chassis)

    b.add(front_bumper(), parts)
    b.add(hood(), parts)
    b.add(grille_back(), b.add(grille_panel(), parts))
    b.add(windshield(), parts)
    b.add(rear_window(), parts)
    fender_names = {"L": "Fender_FL", "R": "Fender_FR"}
    for suffix, side in SIDES:
        fender_object = b.add(fender(fender_names[suffix], side), parts)
        b.add(fender_marker(f"{fender_names[suffix]}_Marker", side), fender_object)
        b.add(inner_fender(f"Inner_Fender_{suffix}", side), chassis)
        door_object = b.add(door(f"Door_{suffix}", side), parts)
        b.add(side_glass(f"SideGlass_{suffix}", side), door_object)
        b.add(door_trim(f"Door_{suffix}_Trim", side), door_object)
        b.add(mirror(f"Mirror_{suffix}", side), door_object)
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
        ground.hide_render = False
        camera_data.type = "PERSP"
        camera_data.lens = 45
        look(camera, to_blender(eye), centre)
        scene.render.filepath = os.path.join(directory, f"{name}.png")
        bpy.ops.render.render(write_still=True)
    camera_data.lens = 50
    look(camera, to_blender((4.2, 2.1, 7.6)), to_blender((0.25, 1.15, 1.9)))
    scene.render.filepath = os.path.join(directory, "nose.png")
    bpy.ops.render.render(write_still=True)
    camera_data.lens = 45
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
