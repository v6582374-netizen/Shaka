from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from submission_api.core import ApiProblem, build_capabilities, run_invocation
from submission_api.server import SubmissionHandler, ThreadingHTTPServer, verify_qwen_manifest


class SubmissionCoreTest(unittest.TestCase):
    def test_nominal_invocation_closes_the_formal_lifecycle(self) -> None:
        result = run_invocation({"mode": "simulation", "scenario": "nominal", "seed": 7})
        self.assertEqual(result["task_result"], "succeeded")
        self.assertFalse(result["execution"]["physical_execution"])
        self.assertEqual(result["execution"]["writes_to_robot"], 0)
        self.assertEqual([entry["phase"] for entry in result["trace"]], [
            "ready_check", "observe", "plan", "hardware_protection", "execute_simulation", "independent_evaluate", "retain"
        ])
        self.assertTrue(result["evaluation"]["human_audit_required_for_physical_claim"])

    def test_guardian_absence_aborts_before_motion(self) -> None:
        result = run_invocation({"scenario": "guardian_absent", "guardian_present": False})
        self.assertEqual(result["task_result"], "aborted")
        self.assertEqual(result["action_plan"], [])
        self.assertNotIn("execute_simulation", [entry["phase"] for entry in result["trace"]])

    def test_occlusion_makes_the_evaluator_abstain(self) -> None:
        result = run_invocation({"scenario": "target_occluded"})
        self.assertEqual(result["task_result"], "abstained")
        self.assertFalse(result["evaluation"]["visual_facts"]["target_visible"])

    def test_connected_mode_is_explicitly_unavailable(self) -> None:
        with self.assertRaises(ApiProblem) as raised:
            run_invocation({"mode": "connected_g1"})
        self.assertEqual(raised.exception.status, 409)

    def test_capabilities_expose_source_and_claim_boundary(self) -> None:
        capabilities = build_capabilities()
        self.assertEqual(capabilities["task"]["task_id"], "g1-yellow-button-contact-v1")
        self.assertFalse(capabilities["execution_modes"][0]["requires_robot"])


class SubmissionHttpE2ETest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), SubmissionHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def read_json(self, path: str, payload: dict | None = None) -> tuple[int, dict]:
        data = None if payload is None else json.dumps(payload).encode()
        request = Request(
            self.base + path,
            data=data,
            headers={"Content-Type": "application/json"},
            method="GET" if data is None else "POST",
        )
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            try:
                return error.code, json.loads(error.read())
            finally:
                error.close()

    def test_user_path_health_then_invocation(self) -> None:
        health_status, health = self.read_json("/v1/health")
        run_status, run = self.read_json("/v1/invocations", {"scenario": "shifted_base", "seed": 11})
        self.assertEqual((health_status, health["status"]), (200, "ok"))
        self.assertEqual(run_status, 200)
        self.assertEqual(run["task_result"], "succeeded")

    def test_invalid_request_returns_machine_readable_problem(self) -> None:
        status, body = self.read_json("/v1/invocations", {"scenario": "invented"})
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "unsupported_scenario")

    def test_api_root_and_openapi_are_served(self) -> None:
        with urlopen(self.base + "/", timeout=3) as page:
            root = json.loads(page.read())
        with urlopen(self.base + "/openapi.json", timeout=3) as contract:
            openapi = json.loads(contract.read())
        self.assertEqual(root["service"], "Shaka Submission API")
        self.assertEqual(root["interactive_frontend"], "http://118.178.180.10")
        self.assertEqual(root["openapi"], "/openapi.json")
        self.assertEqual(openapi["openapi"], "3.1.0")
        self.assertIn("/v1/invocations", openapi["paths"])
        self.assertIn("/v1/qwen/evidence", openapi["paths"])
        self.assertIn("/v1/qwen/replay", openapi["paths"])
        self.assertEqual(openapi["components"]["schemas"]["PlanControls"]["properties"]["observation_duration_ms"]["minimum"], 200)
        self.assertEqual(openapi["components"]["schemas"]["QwenPlanControls"]["properties"]["observation_duration_ms"]["minimum"], 250)

    def test_qwen_feedback_evidence_is_served_without_credentials(self) -> None:
        status, evidence = self.read_json("/v1/qwen/evidence")
        self.assertEqual(status, 200)
        self.assertEqual(evidence["model"], "qwen3-max")
        self.assertEqual(evidence["round_one"]["decision"], "adjust")
        self.assertEqual(evidence["round_two"]["decision"], "accept")
        self.assertFalse(evidence["credential_recorded"])
        self.assertNotIn("api_key", json.dumps(evidence).lower())

    def test_retained_qwen_cycle_can_be_replayed_without_calling_qwen(self) -> None:
        status, replay = self.read_json("/v1/qwen/replay", {})
        self.assertEqual(status, 200)
        self.assertEqual([item["decision"] for item in replay["rounds"]], ["adjust", "accept"])
        self.assertFalse(replay["qwen_called"])
        self.assertFalse(replay["physical_execution"])
        self.assertTrue(replay["manifest_verified"])
        self.assertEqual(replay["rounds"][0]["plan_controls"]["observation_duration_ms"], 250)
        self.assertEqual(replay["rounds"][1]["plan_controls"]["observation_duration_ms"], 500)

    def test_qwen_replay_rejects_an_unknown_round(self) -> None:
        status, body = self.read_json("/v1/qwen/replay", {"round": 3})
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "unsupported_round")

    def test_qwen_manifest_verification_rejects_tampering(self) -> None:
        source = Path(__file__).resolve().parents[1] / "artifacts" / "qwen-feedback-cycle"
        with tempfile.TemporaryDirectory() as temporary_directory:
            evidence = Path(temporary_directory) / "evidence"
            shutil.copytree(source, evidence)
            self.assertEqual(verify_qwen_manifest(evidence)["schema_version"], 1)
            path = evidence / "cycle-summary.json"
            path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
            with self.assertRaises(ApiProblem) as raised:
                verify_qwen_manifest(evidence)
            self.assertEqual(raised.exception.code, "evidence_integrity_failed")


if __name__ == "__main__":
    unittest.main()
