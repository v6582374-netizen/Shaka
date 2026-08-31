from __future__ import annotations

import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from submission_api.core import ApiProblem, build_capabilities, run_invocation
from submission_api.server import SubmissionHandler, ThreadingHTTPServer


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

    def test_interactive_page_and_openapi_are_served(self) -> None:
        with urlopen(self.base + "/", timeout=3) as page:
            html = page.read().decode()
        with urlopen(self.base + "/openapi.json", timeout=3) as contract:
            openapi = json.loads(contract.read())
        self.assertIn("Shaka Test Bench", html)
        self.assertEqual(openapi["openapi"], "3.1.0")
        self.assertIn("/v1/invocations", openapi["paths"])


if __name__ == "__main__":
    unittest.main()
