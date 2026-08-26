#!/usr/bin/env python3
"""Prepare and evaluate one recorded G1 invocation with a multimodal model."""

from __future__ import annotations

import argparse
import base64
import bisect
import csv
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from PIL import Image, ImageDraw
from pydantic import BaseModel, ConfigDict, Field

DEFAULT_CONFIG = (
    Path(__file__).parents[1]
    / "configs"
    / "g1-evaluator-vlm-v001"
    / "evaluator.json"
)
PROMPT_NAME = "prompt.md"
PHYSICAL_CAMERAS = ("head_camera", "left_wrist_camera", "right_wrist_camera")
LOGICAL_VIEWS = ("head_left", "head_right", "left_wrist", "right_wrist")


class VisualAssessment(BaseModel):
    """Facts extracted from chronological multi-view evidence."""

    model_config = ConfigDict(extra="forbid")

    button_visible: bool
    designated_finger_visible: bool | None
    contact_observed: bool | None
    contact_panel_indices: list[int] = Field(default_factory=list)
    retreat_observed: bool | None
    retreat_panel_indices: list[int] = Field(default_factory=list)
    wrong_finger_contact_observed: bool | None
    visual_evidence_sufficient: bool
    visual_result: Literal["succeeded", "failed", "indeterminate"]
    uncertainty_reasons: list[str] = Field(default_factory=list)
    summary: str


@dataclass(frozen=True)
class FrameReference:
    camera_id: str
    path: Path
    frame_time_ns: int
    payload_sha256: str


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _load_config(path: Path) -> dict[str, Any]:
    configuration = json.loads(path.read_text(encoding="utf-8"))
    required = {
        "evaluator_id",
        "backend",
        "model",
        "codex_model",
        "image_detail",
        "maximum_panels",
        "pre_roll_seconds",
        "post_roll_seconds",
        "designated_fingertip",
        "task_contract",
        "audit_policy",
    }
    missing = sorted(required - configuration.keys())
    if missing:
        raise ValueError(f"evaluator configuration is missing: {missing}")
    if int(configuration["maximum_panels"]) < 2:
        raise ValueError("maximum_panels must be at least two")
    return configuration


def _load_camera_references(
    episode_directory: Path,
) -> dict[str, list[FrameReference]]:
    references: dict[str, list[FrameReference]] = {
        camera_id: [] for camera_id in PHYSICAL_CAMERAS
    }
    timestamp_path = episode_directory / "camera_timestamps.csv"
    with timestamp_path.open(newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream):
            camera_id = row["camera_id"]
            if camera_id not in references:
                continue
            path = episode_directory / row["file_name"]
            references[camera_id].append(
                FrameReference(
                    camera_id=camera_id,
                    path=path,
                    frame_time_ns=int(row["frame_time_ns"]),
                    payload_sha256=row["payload_sha256"],
                )
            )
    for camera_id, items in references.items():
        if not items:
            raise ValueError(f"episode has no {camera_id} frames")
        items.sort(key=lambda item: item.frame_time_ns)
    return references


def _closest_frame(
    references: list[FrameReference], target_time_ns: int
) -> FrameReference:
    times = [item.frame_time_ns for item in references]
    index = bisect.bisect_left(times, target_time_ns)
    candidates = references[max(0, index - 1) : min(len(references), index + 1)]
    return min(candidates, key=lambda item: abs(item.frame_time_ns - target_time_ns))


def _evenly_spaced_times(start_ns: int, end_ns: int, count: int) -> list[int]:
    if end_ns <= start_ns:
        raise ValueError("evidence time window is empty")
    if count == 2:
        return [start_ns, end_ns]
    span = end_ns - start_ns
    return [start_ns + round(span * index / (count - 1)) for index in range(count)]


def _evidence_window(
    metadata: dict[str, Any],
    references: dict[str, list[FrameReference]],
    configuration: dict[str, Any],
) -> tuple[int, int, bool]:
    available_start_ns = max(items[0].frame_time_ns for items in references.values())
    available_end_ns = min(items[-1].frame_time_ns for items in references.values())
    controller = metadata.get("controller") or {}
    if "estimated_start_ns" not in controller or "estimated_end_ns" not in controller:
        return available_start_ns, available_end_ns, False
    requested_start_ns = int(controller["estimated_start_ns"]) - round(
        float(configuration["pre_roll_seconds"]) * 1_000_000_000
    )
    requested_end_ns = int(controller["estimated_end_ns"]) + round(
        float(configuration["post_roll_seconds"]) * 1_000_000_000
    )
    start_ns = max(available_start_ns, requested_start_ns)
    end_ns = min(available_end_ns, requested_end_ns)
    capture_complete = bool(
        metadata.get("capture_quality", {}).get("valid", False)
        and available_start_ns <= int(controller["estimated_start_ns"])
        and available_end_ns >= int(controller["estimated_end_ns"])
    )
    return start_ns, end_ns, capture_complete


def _logical_views(
    head_path: Path, left_wrist_path: Path, right_wrist_path: Path
) -> dict[str, Image.Image]:
    with Image.open(head_path) as source:
        head = source.convert("RGB")
    if head.size != (1280, 480):
        raise ValueError(f"unexpected head image size: {head.size}")
    with Image.open(left_wrist_path) as source:
        left_wrist = source.convert("RGB")
    with Image.open(right_wrist_path) as source:
        right_wrist = source.convert("RGB")
    return {
        "head_left": head.crop((0, 0, 640, 480)),
        "head_right": head.crop((640, 0, 1280, 480)),
        "left_wrist": left_wrist,
        "right_wrist": right_wrist,
    }


def _render_panel(
    output_path: Path,
    panel_index: int,
    target_time_ns: int,
    frames: dict[str, FrameReference],
) -> None:
    views = _logical_views(
        frames["head_camera"].path,
        frames["left_wrist_camera"].path,
        frames["right_wrist_camera"].path,
    )
    canvas = Image.new("RGB", (1280, 1008), "black")
    draw = ImageDraw.Draw(canvas)
    draw.text(
        (8, 8),
        f"panel={panel_index:02d} target_time_ns={target_time_ns}",
        fill="white",
    )
    placements = {
        "head_left": (0, 48),
        "head_right": (640, 48),
        "left_wrist": (0, 528),
        "right_wrist": (640, 528),
    }
    for view_name in LOGICAL_VIEWS:
        image = views[view_name]
        if image.size != (640, 480):
            raise ValueError(f"unexpected {view_name} image size: {image.size}")
        x, y = placements[view_name]
        canvas.paste(image, (x, y))
        draw.rectangle((x, y, x + 170, y + 22), fill="black")
        draw.text((x + 5, y + 5), view_name, fill="white")
    canvas.save(output_path, format="JPEG", quality=92, subsampling=0)


def prepare_evidence(
    episode_directory: Path,
    output_directory: Path,
    config_path: Path = DEFAULT_CONFIG,
) -> dict[str, Any]:
    if output_directory.exists():
        raise FileExistsError(f"output directory already exists: {output_directory}")
    configuration = _load_config(config_path)
    prompt_path = config_path.with_name(PROMPT_NAME)
    metadata_path = episode_directory / "capture_metadata.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    references = _load_camera_references(episode_directory)
    start_ns, end_ns, capture_complete = _evidence_window(
        metadata, references, configuration
    )
    panel_count = min(
        int(configuration["maximum_panels"]),
        max(2, round((end_ns - start_ns) / 1_000_000_000) + 1),
    )
    panel_times = _evenly_spaced_times(start_ns, end_ns, panel_count)

    panel_directory = output_directory / "panels"
    panel_directory.mkdir(parents=True)
    panels = []
    for panel_index, target_time_ns in enumerate(panel_times):
        frames = {
            camera_id: _closest_frame(items, target_time_ns)
            for camera_id, items in references.items()
        }
        panel_path = panel_directory / f"panel-{panel_index:02d}.jpg"
        _render_panel(panel_path, panel_index, target_time_ns, frames)
        panels.append(
            {
                "panel_index": panel_index,
                "target_time_ns": target_time_ns,
                "relative_time_seconds": (target_time_ns - start_ns) / 1e9,
                "path": str(panel_path.relative_to(output_directory)),
                "sha256": _sha256_file(panel_path),
                "source_frames": {
                    camera_id: {
                        "path": str(frame.path.relative_to(episode_directory)),
                        "frame_time_ns": frame.frame_time_ns,
                        "payload_sha256": frame.payload_sha256,
                        "target_delta_ms": (
                            frame.frame_time_ns - target_time_ns
                        )
                        / 1e6,
                    }
                    for camera_id, frame in frames.items()
                },
            }
        )

    source_manifest = episode_directory / "sha256.txt"
    manifest = {
        "schema_version": 1,
        "evaluator_id": configuration["evaluator_id"],
        "episode_id": metadata["episode_id"],
        "source_episode_directory": str(episode_directory.resolve()),
        "source_episode_manifest_sha256": (
            _sha256_file(source_manifest) if source_manifest.is_file() else None
        ),
        "source_capture_metadata_sha256": _sha256_file(metadata_path),
        "configuration_sha256": _sha256_file(config_path),
        "prompt_sha256": _sha256_file(prompt_path),
        "designated_fingertip": configuration["designated_fingertip"],
        "task_contract": configuration["task_contract"],
        "capture_complete": capture_complete,
        "window": {"start_ns": start_ns, "end_ns": end_ns},
        "panels": panels,
    }
    manifest_path = output_directory / "evidence_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return manifest


def _data_url(path: Path) -> str:
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def _response_input(
    evidence_directory: Path,
    manifest: dict[str, Any],
    image_detail: str,
) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = [
        {
            "type": "input_text",
            "text": (
                f"Episode: {manifest['episode_id']}\n"
                f"Task contract: {manifest['task_contract']}\n"
                f"Designated fingertip: {manifest['designated_fingertip']}\n"
                f"Capture complete through controller release: "
                f"{manifest['capture_complete']}\n"
                "The following panels are chronological."
            ),
        }
    ]
    for panel in manifest["panels"]:
        content.append(
            {
                "type": "input_text",
                "text": (
                    f"Panel {panel['panel_index']:02d}, "
                    f"t={panel['relative_time_seconds']:.3f}s"
                ),
            }
        )
        content.append(
            {
                "type": "input_image",
                "image_url": _data_url(evidence_directory / panel["path"]),
                "detail": image_detail,
            }
        )
    return [{"role": "user", "content": content}]


def _codex_prompt(manifest: dict[str, Any], prompt: str) -> str:
    panel_lines = "\n".join(
        f"- attached image {index + 1}: panel {panel['panel_index']:02d}, "
        f"t={panel['relative_time_seconds']:.3f}s"
        for index, panel in enumerate(manifest["panels"])
    )
    return (
        f"{prompt}\n\n"
        f"Episode: {manifest['episode_id']}\n"
        f"Task contract: {manifest['task_contract']}\n"
        f"Designated fingertip: {manifest['designated_fingertip']}\n"
        f"Capture complete through controller release: "
        f"{manifest['capture_complete']}\n"
        "Attached images are chronological four-view panels:\n"
        f"{panel_lines}\n"
    )


def _evaluate_with_codex_cli(
    evidence_directory: Path,
    manifest: dict[str, Any],
    prompt: str,
    model: str,
) -> VisualAssessment:
    executable = shutil.which("codex")
    if executable is None:
        raise RuntimeError("Codex CLI is unavailable")
    with tempfile.TemporaryDirectory(prefix="shaka-vlm-evaluator-") as temporary:
        temporary_directory = Path(temporary)
        schema_path = temporary_directory / "visual-assessment.schema.json"
        output_path = temporary_directory / "visual-assessment.json"
        schema_path.write_text(
            json.dumps(VisualAssessment.model_json_schema(), indent=2) + "\n",
            encoding="utf-8",
        )
        command = [
            executable,
            "exec",
            "--ephemeral",
            "--ignore-rules",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--model",
            model,
            "--output-schema",
            str(schema_path),
            "--output-last-message",
            str(output_path),
        ]
        for panel in manifest["panels"]:
            command.extend(["--image", str(evidence_directory / panel["path"])])
        command.append("-")
        completed = subprocess.run(
            command,
            input=_codex_prompt(manifest, prompt),
            text=True,
            capture_output=True,
            check=False,
            cwd=evidence_directory,
            timeout=300,
        )
        if completed.returncode != 0:
            reason = completed.stderr.strip() or completed.stdout.strip()
            raise RuntimeError(f"Codex visual evaluation failed: {reason}")
        if not output_path.is_file():
            raise RuntimeError("Codex visual evaluation produced no final response")
        return VisualAssessment.model_validate_json(
            output_path.read_text(encoding="utf-8")
        )


def adjudicate(
    capture_complete: bool,
    controller: dict[str, Any] | None,
    assessment: VisualAssessment,
) -> Literal["succeeded", "failed", "indeterminate", "aborted", "abstained"]:
    controller = controller or {}
    outcome = str(controller.get("outcome", ""))
    if outcome == "aborted":
        return "aborted"
    if outcome in {"rejected", "abstained"}:
        return "abstained"
    if not capture_complete:
        return "indeterminate"
    if (
        assessment.visual_result == "succeeded"
        and assessment.visual_evidence_sufficient
        and assessment.contact_observed is True
        and assessment.retreat_observed is True
        and assessment.wrong_finger_contact_observed is not True
    ):
        return "succeeded"
    if assessment.visual_result == "failed" and assessment.visual_evidence_sufficient:
        return "failed"
    return "indeterminate"


def evaluate_evidence(
    evidence_directory: Path,
    config_path: Path = DEFAULT_CONFIG,
    model: str | None = None,
    backend: str | None = None,
    client: Any | None = None,
) -> dict[str, Any]:
    configuration = _load_config(config_path)
    prompt_path = config_path.with_name(PROMPT_NAME)
    manifest_path = evidence_directory / "evidence_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["configuration_sha256"] != _sha256_file(config_path):
        raise ValueError("evidence was prepared with a different configuration")
    if manifest["prompt_sha256"] != _sha256_file(prompt_path):
        raise ValueError("evidence was prepared with a different prompt")
    selected_backend = backend or str(configuration["backend"])
    if client is not None:
        selected_backend = "openai"
    if selected_backend == "auto":
        if os.environ.get("OPENAI_API_KEY"):
            selected_backend = "openai"
        elif shutil.which("codex") is not None:
            selected_backend = "codex-cli"
        else:
            raise RuntimeError(
                "neither OPENAI_API_KEY nor Codex CLI is available"
            )
    if selected_backend == "openai":
        if client is None and not os.environ.get("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY is not configured")
        if client is None:
            from openai import OpenAI

            client = OpenAI()
        selected_model = model or str(configuration["model"])
        response = client.responses.parse(
            model=selected_model,
            instructions=prompt_path.read_text(encoding="utf-8"),
            input=_response_input(
                evidence_directory, manifest, str(configuration["image_detail"])
            ),
            text_format=VisualAssessment,
            store=False,
        )
        assessment = response.output_parsed
        response_id = getattr(response, "id", None)
    elif selected_backend == "codex-cli":
        selected_model = model or str(configuration["codex_model"])
        assessment = _evaluate_with_codex_cli(
            evidence_directory,
            manifest,
            prompt_path.read_text(encoding="utf-8"),
            selected_model,
        )
        response_id = None
    else:
        raise ValueError(f"unsupported evaluator backend: {selected_backend}")
    if not isinstance(assessment, VisualAssessment):
        raise TypeError("model response did not contain a parsed visual assessment")
    source_metadata = json.loads(
        (
            Path(manifest["source_episode_directory"])
            / "capture_metadata.json"
        ).read_text(encoding="utf-8")
    )
    result = adjudicate(
        bool(manifest["capture_complete"]),
        source_metadata.get("controller"),
        assessment,
    )
    audit_policy = configuration["audit_policy"]
    return {
        "schema_version": 1,
        "evaluator_id": configuration["evaluator_id"],
        "mode": audit_policy["mode"],
        "episode_id": manifest["episode_id"],
        "backend": selected_backend,
        "model": selected_model,
        "response_id": response_id,
        "evidence_manifest_sha256": _sha256_file(manifest_path),
        "configuration_sha256": _sha256_file(config_path),
        "prompt_sha256": _sha256_file(prompt_path),
        "visual_assessment": assessment.model_dump(mode="json"),
        "result": result,
        "human_audit_required": bool(audit_policy["audit_all_results"])
        or result == "succeeded",
    }


def record_human_audit(
    assessment_path: Path,
    auditor_id: str,
    agreement: Literal["agree", "disagree", "uncertain"],
    audited_result: str | None,
    notes: str,
) -> dict[str, Any]:
    assessment = json.loads(assessment_path.read_text(encoding="utf-8"))
    allowed_results = {
        "succeeded",
        "failed",
        "indeterminate",
        "aborted",
        "abstained",
    }
    if agreement == "disagree" and audited_result not in allowed_results:
        raise ValueError("a disagreement requires one valid audited result")
    if agreement == "agree":
        audited_result = str(assessment["result"])
    if agreement == "uncertain":
        audited_result = None
    return {
        "schema_version": 1,
        "assessment_sha256": _sha256_file(assessment_path),
        "episode_id": assessment["episode_id"],
        "evaluator_id": assessment["evaluator_id"],
        "model_result": assessment["result"],
        "auditor_id": auditor_id,
        "agreement": agreement,
        "audited_result": audited_result,
        "notes": notes,
        "usage": "audit evidence only; not live rollout feedback",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare = subparsers.add_parser("prepare")
    prepare.add_argument("--episode-directory", type=Path, required=True)
    prepare.add_argument("--output-directory", type=Path, required=True)
    prepare.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    evaluate = subparsers.add_parser("evaluate")
    evaluate.add_argument("--evidence-directory", type=Path, required=True)
    evaluate.add_argument("--output", type=Path, required=True)
    evaluate.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    evaluate.add_argument("--model")
    evaluate.add_argument("--backend", choices=("auto", "openai", "codex-cli"))
    audit = subparsers.add_parser("audit")
    audit.add_argument("--assessment", type=Path, required=True)
    audit.add_argument("--output", type=Path, required=True)
    audit.add_argument("--auditor-id", required=True)
    audit.add_argument(
        "--agreement", choices=("agree", "disagree", "uncertain"), required=True
    )
    audit.add_argument(
        "--audited-result",
        choices=("succeeded", "failed", "indeterminate", "aborted", "abstained"),
    )
    audit.add_argument("--notes", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.command == "prepare":
            result = prepare_evidence(
                args.episode_directory, args.output_directory, args.config
            )
            payload = {
                "result": "vlm_evidence_prepared",
                "episode_id": result["episode_id"],
                "capture_complete": result["capture_complete"],
                "panels": len(result["panels"]),
                "output_directory": str(args.output_directory),
            }
        elif args.command == "evaluate":
            if args.output.exists():
                raise FileExistsError(f"output already exists: {args.output}")
            result = evaluate_evidence(
                args.evidence_directory, args.config, args.model, args.backend
            )
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(
                json.dumps(result, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            payload = {
                "result": "vlm_episode_evaluated",
                "episode_id": result["episode_id"],
                "task_result": result["result"],
                "human_audit_required": result["human_audit_required"],
                "output": str(args.output),
            }
        else:
            if args.output.exists():
                raise FileExistsError(f"output already exists: {args.output}")
            result = record_human_audit(
                args.assessment,
                args.auditor_id,
                args.agreement,
                args.audited_result,
                args.notes,
            )
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(
                json.dumps(result, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            payload = {
                "result": "vlm_episode_audit_recorded",
                "episode_id": result["episode_id"],
                "agreement": result["agreement"],
                "output": str(args.output),
            }
    except Exception as error:  # noqa: BLE001 - one terminal CLI result
        print(
            json.dumps(
                {"result": "vlm_episode_evaluator_rejected", "reason": str(error)},
                sort_keys=True,
            )
        )
        return 2
    print(json.dumps(payload, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
