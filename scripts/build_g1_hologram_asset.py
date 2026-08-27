#!/usr/bin/env python3
"""Build a static WebGL G1 model from Unitree's BSD-3-Clause URDF/STL source.

The generated GLB deliberately stores the URDF link tree and neutral pose only.
It does not contain an animation and must not be presented as live robot posture.

Example:
  python scripts/build_g1_hologram_asset.py \
    --source-root /tmp/unitree_rl_gym \
    --output apps/operator-console/public/assets/g1/g1_29dof_rev_1_0.glb
"""

from __future__ import annotations

import argparse
import json
import math
import struct
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree


SOURCE_REPOSITORY = "https://github.com/unitreerobotics/unitree_rl_gym"
SOURCE_REVISION = "276801e46c5d433564f24658bac64f254b7d2d4b"
MODEL_PATH = Path("resources/robots/g1_description/g1_29dof_rev_1_0.urdf")
EXCLUDED_LINKS = frozenset({"logo_link"})


@dataclass(frozen=True)
class Transform:
    translation: tuple[float, float, float]
    rotation: tuple[float, float, float, float]


def _origin(element: ElementTree.Element | None) -> Transform:
    if element is None:
        return Transform((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))
    xyz = tuple(float(value) for value in element.attrib.get("xyz", "0 0 0").split())
    roll, pitch, yaw = (float(value) for value in element.attrib.get("rpy", "0 0 0").split())
    cr, sr = math.cos(roll / 2), math.sin(roll / 2)
    cp, sp = math.cos(pitch / 2), math.sin(pitch / 2)
    cy, sy = math.cos(yaw / 2), math.sin(yaw / 2)
    return Transform(
        xyz,
        (
            sr * cp * cy - cr * sp * sy,
            cr * sp * cy + sr * cp * sy,
            cr * cp * sy - sr * sp * cy,
            cr * cp * cy + sr * sp * sy,
        ),
    )


def _pad(blob: bytearray) -> None:
    blob.extend(b"\0" * ((4 - len(blob) % 4) % 4))


def _read_binary_stl(path: Path) -> tuple[list[float], list[int], list[float], list[float]]:
    """Return indexed positions and bounds from a binary STL without dependencies."""

    raw = path.read_bytes()
    if len(raw) < 84:
        raise ValueError(f"STL is too small: {path}")
    facets = struct.unpack_from("<I", raw, 80)[0]
    expected = 84 + facets * 50
    if len(raw) != expected:
        raise ValueError(f"only binary STL is supported ({path} has {len(raw)} bytes, expected {expected})")

    positions: list[float] = []
    indices: list[int] = []
    vertices: dict[bytes, int] = {}
    minimum = [math.inf, math.inf, math.inf]
    maximum = [-math.inf, -math.inf, -math.inf]
    offset = 84
    for _ in range(facets):
        offset += 12  # facet normal; hologram uses an unlit material at runtime
        for _vertex in range(3):
            key = raw[offset : offset + 12]
            index = vertices.get(key)
            if index is None:
                x, y, z = struct.unpack_from("<3f", raw, offset)
                index = len(positions) // 3
                vertices[key] = index
                positions.extend((x, y, z))
                minimum[0] = min(minimum[0], x)
                minimum[1] = min(minimum[1], y)
                minimum[2] = min(minimum[2], z)
                maximum[0] = max(maximum[0], x)
                maximum[1] = max(maximum[1], y)
                maximum[2] = max(maximum[2], z)
            indices.append(index)
            offset += 12
        offset += 2  # attribute byte count
    return positions, indices, minimum, maximum


def _accessor(
    document: dict[str, Any],
    buffer: bytearray,
    values: list[float] | list[int],
    *,
    component_type: int,
    element_type: str,
    target: int,
    minimum: list[float] | None = None,
    maximum: list[float] | None = None,
) -> int:
    _pad(buffer)
    offset = len(buffer)
    if component_type == 5126:
        buffer.extend(struct.pack(f"<{len(values)}f", *values))
    elif component_type == 5125:
        buffer.extend(struct.pack(f"<{len(values)}I", *values))
    else:  # pragma: no cover - this controlled converter uses two types only
        raise ValueError(f"unsupported component type {component_type}")
    view = {"buffer": 0, "byteOffset": offset, "byteLength": len(buffer) - offset, "target": target}
    document["bufferViews"].append(view)
    accessor: dict[str, Any] = {
        "bufferView": len(document["bufferViews"]) - 1,
        "componentType": component_type,
        "count": len(values) // (3 if element_type == "VEC3" else 1),
        "type": element_type,
    }
    if minimum is not None:
        accessor["min"] = minimum
    if maximum is not None:
        accessor["max"] = maximum
    document["accessors"].append(accessor)
    return len(document["accessors"]) - 1


def _node_transform(node: dict[str, Any], transform: Transform) -> None:
    if transform.translation != (0.0, 0.0, 0.0):
        node["translation"] = list(transform.translation)
    if transform.rotation != (0.0, 0.0, 0.0, 1.0):
        node["rotation"] = list(transform.rotation)


def build(source_root: Path, output: Path) -> None:
    urdf_path = source_root / MODEL_PATH
    source_license = source_root / "LICENSE"
    if not urdf_path.is_file() or not source_license.is_file():
        raise FileNotFoundError("--source-root must be a unitree_rl_gym checkout containing the selected URDF and LICENSE")

    robot = ElementTree.parse(urdf_path).getroot()
    document: dict[str, Any] = {
        "asset": {
            "version": "2.0",
            "generator": "Shaka scripts/build_g1_hologram_asset.py",
            "copyright": "Unitree Robotics; BSD-3-Clause. See accompanying license notice.",
            "extras": {
                "sourceRepository": SOURCE_REPOSITORY,
                "sourceRevision": SOURCE_REVISION,
                "sourceUrdf": MODEL_PATH.as_posix(),
                "pose": "neutral-static-only",
            },
        },
        "scene": 0,
        "scenes": [{"name": "G1 neutral exterior", "nodes": []}],
        "nodes": [],
        "meshes": [],
        "accessors": [],
        "bufferViews": [],
        "buffers": [{"byteLength": 0}],
    }
    binary = bytearray()
    links = {link.attrib["name"]: link for link in robot.findall("link")}
    children: dict[str, list[tuple[ElementTree.Element, str]]] = defaultdict(list)
    child_names: set[str] = set()
    for joint in robot.findall("joint"):
        parent = joint.find("parent")
        child = joint.find("child")
        if parent is None or child is None:
            continue
        parent_name, child_name = parent.attrib["link"], child.attrib["link"]
        children[parent_name].append((joint, child_name))
        child_names.add(child_name)
    root_links = [name for name in links if name not in child_names]
    if len(root_links) != 1:
        raise ValueError(f"expected one root link, found {root_links}")

    mesh_cache: dict[str, int] = {}

    def mesh_index(filename: str) -> int:
        if filename in mesh_cache:
            return mesh_cache[filename]
        positions, indices, minimum, maximum = _read_binary_stl(source_root / "resources/robots/g1_description" / filename)
        position_accessor = _accessor(document, binary, positions, component_type=5126, element_type="VEC3", target=34962, minimum=minimum, maximum=maximum)
        index_accessor = _accessor(document, binary, indices, component_type=5125, element_type="SCALAR", target=34963)
        document["meshes"].append({"name": Path(filename).stem, "primitives": [{"attributes": {"POSITION": position_accessor}, "indices": index_accessor, "mode": 4}]})
        mesh_cache[filename] = len(document["meshes"]) - 1
        return mesh_cache[filename]

    def append_link(link_name: str, joint: ElementTree.Element | None = None) -> int:
        link = links[link_name]
        node: dict[str, Any] = {"name": link_name, "children": []}
        if joint is not None:
            _node_transform(node, _origin(joint.find("origin")))
            axis = joint.find("axis")
            limit = joint.find("limit")
            node["extras"] = {
                "jointName": joint.attrib.get("name"),
                "jointType": joint.attrib.get("type"),
                "jointAxis": axis.attrib.get("xyz") if axis is not None else None,
                "jointLower": limit.attrib.get("lower") if limit is not None else None,
                "jointUpper": limit.attrib.get("upper") if limit is not None else None,
            }
        node_index = len(document["nodes"])
        document["nodes"].append(node)
        if link_name not in EXCLUDED_LINKS:
            for visual in link.findall("visual"):
                mesh = visual.find("./geometry/mesh")
                if mesh is None:
                    continue
                visual_node: dict[str, Any] = {"name": f"{link_name}:visual", "mesh": mesh_index(mesh.attrib["filename"])}
                _node_transform(visual_node, _origin(visual.find("origin")))
                document["nodes"].append(visual_node)
                node["children"].append(len(document["nodes"]) - 1)
        for child_joint, child_name in children[link_name]:
            node["children"].append(append_link(child_name, child_joint))
        if not node["children"]:
            node.pop("children")
        return node_index

    document["scenes"][0]["nodes"].append(append_link(root_links[0]))
    _pad(binary)
    document["buffers"][0]["byteLength"] = len(binary)
    encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((4 - len(encoded) % 4) % 4)
    total_length = 12 + 8 + len(encoded) + 8 + len(binary)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as stream:
        stream.write(struct.pack("<4sII", b"glTF", 2, total_length))
        stream.write(struct.pack("<I4s", len(encoded), b"JSON"))
        stream.write(encoded)
        stream.write(struct.pack("<I4s", len(binary), b"BIN\0"))
        stream.write(binary)

    manifest = {
        "model": "Unitree G1 29DoF rev 1.0",
        "source_repository": SOURCE_REPOSITORY,
        "source_revision": SOURCE_REVISION,
        "source_urdf": MODEL_PATH.as_posix(),
        "license": "BSD-3-Clause",
        "excluded_links": sorted(EXCLUDED_LINKS),
        "animation": "none; neutral static exterior only",
        "generator": "scripts/build_g1_hologram_asset.py",
    }
    output.with_suffix(".manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    output.with_name("UNITREE-RL-GYM-BSD-3-CLAUSE.txt").write_text(source_license.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"wrote {output} ({output.stat().st_size:,} bytes; {len(mesh_cache)} meshes)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True, help="unitree_rl_gym checkout at the pinned source revision")
    parser.add_argument("--output", type=Path, required=True, help="output .glb path")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    build(args.source_root, args.output)
