"""Execute one candidate stage inside the zero-write sandbox."""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import multiprocessing
import os
import pickle
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

WORKER_MARKER = "SHAKA_CANDIDATE_STAGE_RESULT="
INNER_MARKER = "SHAKA_INNER_CANDIDATE_STAGE_RESULT="


def _read_object(path: Path, description: str) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"{description} must be a JSON object")
    return value


def _load_callable(path: Path, name: str, stage: str) -> Callable[..., Any]:
    spec = importlib.util.spec_from_file_location(f"candidate_{stage}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"candidate {stage} artifact cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    function = getattr(module, name, None)
    if not callable(function):
        raise TypeError(f"candidate {stage} callable is absent: {name}")
    return function


def _entrypoint(
    runtime_path: Path, package: dict[str, Any], stage: str
) -> Callable[..., Any]:
    runtime = package.get("runtime")
    artifacts = package.get("artifacts")
    if not isinstance(runtime, dict) or not isinstance(artifacts, dict):
        raise TypeError("candidate runtime package is invalid")
    entrypoint = runtime.get(stage)
    if not isinstance(entrypoint, dict):
        raise TypeError(f"candidate runtime {stage} must be an object")
    reference = artifacts.get(entrypoint.get("artifact"))
    callable_name = entrypoint.get("callable")
    if not isinstance(reference, dict) or not isinstance(callable_name, str):
        raise TypeError(f"candidate runtime {stage} entrypoint is invalid")
    return _load_callable(
        (runtime_path.parent / str(reference["path"])).resolve(), callable_name, stage
    )


def _serialize_preprocessed(value: Any) -> tuple[bytes, str]:
    try:
        return (
            json.dumps(
                value, allow_nan=False, separators=(",", ":"), sort_keys=True
            ).encode(),
            "canonical-json",
        )
    except (TypeError, ValueError):
        return pickle.dumps(value, protocol=5), "pickle-v5"


def _deserialize_preprocessed(path: Path, encoding: str) -> Any:
    content = path.read_bytes()
    if encoding == "canonical-json":
        return json.loads(content)
    if encoding == "pickle-v5":
        return pickle.loads(content)
    raise ValueError("candidate model-input encoding is unsupported")


def _result_payload(content: bytes, encoding: str) -> dict[str, Any]:
    return {
        "status": "completed",
        "encoding": encoding,
        "payload_base64": base64.b64encode(content).decode("ascii"),
    }


def _candidate_stage(args: argparse.Namespace) -> dict[str, Any]:
    runtime_path = args.runtime_package.resolve()
    package = _read_object(runtime_path, "candidate runtime package")
    artifacts = package["artifacts"]
    configuration = _read_object(
        (runtime_path.parent / artifacts["configuration"]["path"]).resolve(),
        "candidate configuration",
    )
    if args.stage == "preprocess":
        observation = _read_object(args.observation.resolve(), "candidate observation")
        return _result_payload(
            *_serialize_preprocessed(
                _entrypoint(runtime_path, package, "preprocess")(
                    observation, configuration
                )
            )
        )

    model_input = _deserialize_preprocessed(
        args.model_input.resolve(), args.model_input_encoding
    )
    output = _entrypoint(runtime_path, package, "inference")(model_input, configuration)
    if not isinstance(output, dict):
        raise TypeError("candidate inference output must be an object")
    try:
        content = json.dumps(
            output, allow_nan=False, separators=(",", ":"), sort_keys=True
        ).encode()
    except (TypeError, ValueError):
        try:
            evidence = pickle.dumps(output, protocol=5)
            encoding = "pickle-v5"
        except Exception:  # noqa: BLE001 - retain malformed output evidence
            evidence = type(output).__qualname__.encode()
            encoding = "type-name"
        return {
            **_result_payload(evidence, encoding),
            "status": "failed",
            "reason": "candidate inference output must be JSON-serializable",
        }
    return _result_payload(content, "canonical-json")


def _sandbox_prefix_mounts() -> list[str]:
    prefix = Path(sys.prefix).resolve()
    if not prefix.is_relative_to(Path("/home")) and not prefix.is_relative_to(
        Path("/root")
    ):
        return []
    arguments: list[str] = []
    parent = prefix.parent
    parents: list[Path] = []
    while parent not in {Path("/"), Path("/home"), Path("/root")}:
        parents.append(parent)
        parent = parent.parent
    for directory in reversed(parents):
        arguments.extend(["--dir", str(directory)])
    arguments.extend(["--ro-bind", str(prefix), str(prefix)])
    return arguments


def _inner_command(args: argparse.Namespace) -> list[str]:
    sandbox = shutil.which("bwrap") or "/usr/bin/bwrap"
    if not Path(sandbox).is_file():
        raise RuntimeError("nested bubblewrap is required for candidate replay")
    executable = Path(sys.executable).resolve()
    worker = Path(__file__).resolve()
    command = [
        sandbox,
        "--ro-bind", "/", "/",
        "--tmpfs", "/tmp",
        "--tmpfs", "/run",
        "--tmpfs", "/home",
        "--tmpfs", "/root",
        *_sandbox_prefix_mounts(),
        "--proc", "/proc",
        "--dev", "/dev",
        "--unshare-net",
        "--unshare-pid",
        "--unshare-ipc",
        "--unshare-uts",
        "--new-session",
        "--die-with-parent",
        "--cap-drop", "ALL",
        "--dir", "/tmp/sandbox",
        "--ro-bind", str(worker), "/tmp/sandbox/worker.py",
        "--dir", "/tmp/candidate",
        "--ro-bind", str(args.runtime_package.parent.resolve()), "/tmp/candidate",
    ]
    if args.model_input is not None:
        command.extend(
            ["--ro-bind", str(args.model_input.resolve()), "/tmp/model-input.bin"]
        )
    command.extend(
        [
            "--clearenv",
            "--setenv", "HOME", "/tmp",
            "--setenv", "TMPDIR", "/tmp",
            "--setenv", "PATH", str(executable.parent),
            "--setenv", "PYTHONDONTWRITEBYTECODE", "1",
            "--setenv", "PYTHONHASHSEED", "0",
            "--chdir", "/tmp/candidate",
            str(executable), "/tmp/sandbox/worker.py",
            "--inner-stage",
            "--stage", args.stage,
            "--runtime-package", "/tmp/candidate/candidate-runtime.json",
        ]
    )
    if args.observation is not None:
        command.extend(["--observation", "/tmp/candidate/candidate-observation.json"])
    if args.model_input is not None and args.model_input_encoding is not None:
        command.extend(
            [
                "--model-input", "/tmp/model-input.bin",
                "--model-input-encoding", args.model_input_encoding,
            ]
        )
    return command


def _inner_result(completed: subprocess.CompletedProcess[str]) -> dict[str, Any]:
    marked = [
        line.removeprefix(INNER_MARKER)
        for line in completed.stdout.splitlines()
        if line.startswith(INNER_MARKER)
    ]
    if len(marked) != 1:
        detail = completed.stderr.strip()
        raise RuntimeError(
            "nested candidate sandbox returned an invalid number of results"
            + (f": {detail}" if detail else "")
        )
    result = json.loads(marked[0])
    if not isinstance(result, dict):
        raise TypeError("nested candidate sandbox result must be an object")
    status = result.get("status")
    if completed.returncode not in {0, 2} or (
        completed.returncode == 0 and status != "completed"
    ) or (completed.returncode == 2 and status == "completed"):
        raise RuntimeError("nested candidate sandbox exit status is inconsistent")
    return result


def _run_candidate_stage(sender: Any, args: argparse.Namespace) -> None:
    """Run untrusted code in a nested PID namespace without this pipe."""
    try:
        result = _inner_result(
            subprocess.run(
                _inner_command(args),
                capture_output=True,
                close_fds=True,
                text=True,
                check=False,
            )
        )
    except BaseException as error:  # noqa: BLE001 - preserve supervisor failure
        result = {"status": "failed", "reason": str(error) or type(error).__name__}
    try:
        sender.send(result)
    finally:
        sender.close()


def _run(args: argparse.Namespace) -> dict[str, Any]:
    context = multiprocessing.get_context("fork")
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=_run_candidate_stage, args=(sender, args))
    process.start()
    sender.close()
    try:
        process.join()
        if not receiver.poll():
            raise RuntimeError("candidate stage exited without a result")
        try:
            result = receiver.recv()
        except EOFError as error:
            raise RuntimeError("candidate stage exited without a result") from error
    finally:
        receiver.close()
        if process.is_alive():
            process.kill()
            process.join()
    if not isinstance(result, dict):
        raise TypeError("candidate stage result must be an object")
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inner-stage", action="store_true")
    parser.add_argument("--stage", choices=("preprocess", "inference"), required=True)
    parser.add_argument("--runtime-package", type=Path, required=True)
    parser.add_argument("--observation", type=Path)
    parser.add_argument("--model-input", type=Path)
    parser.add_argument("--model-input-encoding")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = _candidate_stage(args) if args.inner_stage else _run(args)
    except BaseException as error:  # noqa: BLE001 - sandbox returns stage evidence
        result = {"status": "failed", "reason": str(error) or type(error).__name__}
    payload = json.dumps(result, separators=(",", ":"), sort_keys=True)
    marker = INNER_MARKER if args.inner_stage else WORKER_MARKER
    os.write(sys.stdout.fileno(), f"{marker}{payload}\n".encode())
    return 0 if result.get("status") == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
