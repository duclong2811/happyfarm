"""Headless Blender generator for HappyFarm's procedural models.

Usage, from the repository root:

    blender --background --python tools/asset-pipeline/blender/generate.py
    blender --background --python tools/asset-pipeline/blender/generate.py -- --spec building_barn --out .tmp/asset-out

This is the *parallel authoring* path. The models the repository actually ships are produced by
`tools/asset-pipeline/node/generate-models.mjs`, which needs no extra software; this script exists so
an artist can take a spec into Blender, tune it, and export the same contract without inventing a new
one. Whatever it exports must pass `tools/asset-pipeline/node/validate.mjs` for its spec, because the
contract - base on y = 0, exact height, footprint inside the envelope, flat normals, one material per
part, no textures - is the art bible's, not this script's.

Status: not yet executed in this repository. Blender is not installed on the development machine, so
the committed models come from the Node generator. See tools/asset-pipeline/README.md.
"""

import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from common.palette import linear_rgba  # noqa: E402  (path is set above)

SPEC_DIR = os.path.join(HERE, "specs")


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material_for(name: str):
    material = bpy.data.materials.get(name)
    if material is not None:
        return material
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = linear_rgba(name)
    principled.inputs["Metallic"].default_value = 0.0
    principled.inputs["Roughness"].default_value = 0.85
    return material


def add_box(bm: bmesh.types.BMesh, part: dict) -> None:
    """A box, optionally tapering towards its top (`top_scale`)."""
    width = part["width"]
    depth = part["depth"]
    height = part["height"]
    top_scale = part.get("top_scale", 1.0)
    x, y, z = part.get("x", 0.0), part.get("y", 0.0), part.get("z", 0.0)
    bottom = [
        (x - width / 2, y, z - depth / 2),
        (x + width / 2, y, z - depth / 2),
        (x + width / 2, y, z + depth / 2),
        (x - width / 2, y, z + depth / 2),
    ]
    top = [
        (x - width / 2 * top_scale, y + height, z - depth / 2 * top_scale),
        (x + width / 2 * top_scale, y + height, z - depth / 2 * top_scale),
        (x + width / 2 * top_scale, y + height, z + depth / 2 * top_scale),
        (x - width / 2 * top_scale, y + height, z + depth / 2 * top_scale),
    ]
    verts_bottom = [bm.verts.new(point) for point in bottom]
    verts_top = [bm.verts.new(point) for point in top]
    for index in range(4):
        nxt = (index + 1) % 4
        bm.faces.new(
            [verts_bottom[index], verts_bottom[nxt], verts_top[nxt], verts_top[index]]
        )
    bm.faces.new(verts_top)
    bm.faces.new(list(reversed(verts_bottom)))


def add_cylinder(bm: bmesh.types.BMesh, part: dict) -> None:
    """A tapered cylinder: trunks, stalks, silos, limbs."""
    segments = part.get("segments", 8)
    bottom_radius = part["bottom_radius"]
    top_radius = part.get("top_radius", bottom_radius)
    height = part["height"]
    x, y, z = part.get("x", 0.0), part.get("y", 0.0), part.get("z", 0.0)
    lean_x, lean_z = part.get("lean_x", 0.0), part.get("lean_z", 0.0)
    bottom = []
    top = []
    for index in range(segments):
        angle = index / segments * math.tau
        bottom.append((x + math.cos(angle) * bottom_radius, y, z + math.sin(angle) * bottom_radius))
        top.append(
            (
                x + lean_x + math.cos(angle) * top_radius,
                y + height,
                z + lean_z + math.sin(angle) * top_radius,
            )
        )
    verts_bottom = [bm.verts.new(point) for point in bottom]
    verts_top = [bm.verts.new(point) for point in top]
    for index in range(segments):
        nxt = (index + 1) % segments
        bm.faces.new([verts_bottom[index], verts_bottom[nxt], verts_top[nxt], verts_top[index]])
    bm.faces.new(verts_top)
    bm.faces.new(list(reversed(verts_bottom)))


def add_leaf(bm: bmesh.types.BMesh, part: dict) -> None:
    """A folded ribbon: the cheapest shape that reads as a leaf from the gameplay camera."""
    length = part["length"]
    width = part["width"]
    yaw = part.get("yaw", 0.0)
    tilt = part.get("tilt", 0.6)
    droop = part.get("droop", 0.3)
    x, y, z = part.get("x", 0.0), part.get("y", 0.0), part.get("z", 0.0)

    def point(along: float, side: float, drop: float) -> tuple[float, float, float]:
        local_y = along * math.sin(tilt) - drop * math.cos(tilt)
        local_z = along * math.cos(tilt) + drop * math.sin(tilt)
        return (
            x + side * math.cos(yaw) - local_z * math.sin(yaw),
            y + local_y,
            z + side * math.sin(yaw) + local_z * math.cos(yaw),
        )

    base = bm.verts.new(point(0, 0, 0))
    left = bm.verts.new(point(length * 0.45, -width, 0))
    right = bm.verts.new(point(length * 0.45, width, 0))
    tip = bm.verts.new(point(length, 0, -length * droop))
    bm.faces.new([base, left, tip])
    bm.faces.new([base, tip, right])


BUILDERS = {"box": add_box, "cylinder": add_cylinder, "leaf": add_leaf}


def build(spec: dict):
    clear_scene()
    scene = bpy.context.scene

    for part in spec["parts"]:
        mesh = bpy.data.meshes.new(f"{spec['id']}_{part['material']}")
        bm = bmesh.new()
        BUILDERS[part["type"]](bm, part)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        mesh.shade_flat()
        mesh.materials.append(material_for(part["material"]))
        obj = bpy.data.objects.new(f"{spec['id']}_{part['material']}", mesh)
        scene.collection.objects.link(obj)

    # Join the parts into one object, then put the base on y = 0 and the footprint on the origin,
    # exactly as the Node generator normalises its triangle soup.
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = scene.collection.objects[0]
    bpy.ops.object.join()
    root = bpy.context.view_layer.objects.active

    corners = [root.matrix_world @ Vector(corner) for corner in root.bound_box]
    min_x = min(corner.x for corner in corners)
    max_x = max(corner.x for corner in corners)
    min_y = min(corner.y for corner in corners)
    min_z = min(corner.z for corner in corners)
    max_z = max(corner.z for corner in corners)
    height = max(corner.y for corner in corners) - min_y
    target_height = spec["envelope"]["height"]
    scale = target_height / height if height > 0 else 1.0

    for vertex in root.data.vertices:
        vertex.co.x = (vertex.co.x - (min_x + max_x) / 2) * scale
        vertex.co.y = (vertex.co.y - min_y) * scale
        vertex.co.z = (vertex.co.z - (min_z + max_z) / 2) * scale
    root.data.update()

    extent = max(abs(min_x - (min_x + max_x) / 2), abs(max_z - (min_z + max_z) / 2)) * scale
    allowed = spec["envelope"]["half_footprint"]
    if extent > allowed + 1e-3:
        raise SystemExit(f"{spec['id']}: footprint {extent:.3f} exceeds {allowed}")


def export(spec: dict, out_dir: str) -> str:
    os.makedirs(out_dir, exist_ok=True)
    target = os.path.join(out_dir, f"{spec['id']}.glb")
    bpy.ops.export_scene.gltf(
        filepath=target,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_texture_dir="",
        export_normals=True,
        export_tangents=False,
        export_animations=False,
        export_skins=False,
    )
    return target


def spec_paths(selected: str | None) -> list[str]:
    if selected is not None:
        return [os.path.join(SPEC_DIR, f"{selected}.json")]
    return sorted(
        os.path.join(SPEC_DIR, name) for name in os.listdir(SPEC_DIR) if name.endswith(".json")
    )


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    selected = None
    out_dir = os.path.join(HERE, "output")
    for index, argument in enumerate(argv):
        if argument == "--spec":
            selected = argv[index + 1]
        elif argument == "--out":
            out_dir = argv[index + 1]

    written = []
    for path in spec_paths(selected):
        with open(path, "r", encoding="utf-8") as handle:
            spec = json.load(handle)
        build(spec)
        written.append(export(spec, out_dir))

    print("Blender generation complete:")
    for path in written:
        print(f"  {path}  {os.path.getsize(path)} bytes")
    print(
        "Validate with: node tools/asset-pipeline/node/validate.mjs "
        "(after copying into apps/web/src/assets/models/...)"
    )


if __name__ == "__main__":
    main()
