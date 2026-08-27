from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location(
    "run_single_invocation_adapter_output", ROOT / "scripts" / "run_single_invocation.py"
)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class AdapterOutputTest(unittest.TestCase):
    def test_keeps_final_adapter_result_after_native_sdk_diagnostics(self) -> None:
        result = MODULE._adapter_result(
            "native DDS log\n[ChannelFactory] initialization failed\n"
            '{"result":"failed","reason":"channel factory init error.","writes":0}\n',
            "readiness",
        )

        self.assertEqual(result["result"], "failed")
        self.assertEqual(result["writes"], 0)

    def test_rejects_output_without_a_json_object(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "invalid JSON"):
            MODULE._adapter_result("native DDS log\n", "readiness")
