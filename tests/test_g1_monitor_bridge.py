from __future__ import annotations

import importlib.util
import json
import sys
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location("g1_monitor_bridge", SCRIPTS / "g1_monitor_bridge.py")
assert SPEC is not None and SPEC.loader is not None
bridge = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bridge
SPEC.loader.exec_module(bridge)


class BmsSample:
    cell_vol = [3721, 3717, 3719, 3722, 3718, 3721, 3717, 3717, 3722, 3709, 3722, 3708, 3718] + [0] * 27
    bmsvoltage = [48295, 48322, 0]
    current = -1947
    soc = 55
    soh = 94
    temperature = [39, 40, 37, 39] + [0] * 8
    cycle = 22


class G1MonitorBridgeTest(unittest.TestCase):
    def test_translates_observed_hg_bms_without_summing_multiple_voltage_slots(self) -> None:
        values = bridge.bms_metrics(BmsSample())

        self.assertEqual(values["soc_percent"], 55)
        self.assertEqual(values["soh_percent"], 94)
        self.assertEqual(values["pack_voltage_v"], 48.295)
        self.assertEqual(values["pack_current_a"], -1.947)
        self.assertAlmostEqual(values["power_w"], -94.030365)
        self.assertEqual(values["temperature_c"], 40)
        self.assertAlmostEqual(values["cell_voltage_spread_v"], 0.014)
        self.assertEqual(values["cycle_count"], 22)

    def test_staleness_never_promotes_an_absent_observation_to_live(self) -> None:
        self.assertEqual(bridge._state_for_age(None, 1), "unavailable")
        self.assertEqual(bridge._state_for_age(1, 1), "live")
        self.assertEqual(bridge._state_for_age(2, 1), "stale")

    def test_invalid_values_are_left_empty(self) -> None:
        sample = BmsSample()
        sample.soc = 101
        sample.soh = -1
        sample.cell_vol = [0] * 40
        sample.bmsvoltage = [0, 0, 0]
        sample.temperature = [0] * 12
        sample.cycle = -1

        values = bridge.bms_metrics(sample)

        self.assertIsNone(values["soc_percent"])
        self.assertIsNone(values["soh_percent"])
        self.assertIsNone(values["pack_voltage_v"])
        self.assertIsNone(values["power_w"])
        self.assertIsNone(values["temperature_c"])
        self.assertIsNone(values["cell_voltage_spread_v"])
        self.assertIsNone(values["cycle_count"])

    def test_relays_each_camera_offer_only_to_its_fixed_private_endpoint(self) -> None:
        calls: list[tuple[str, dict[str, str]]] = []

        class Client:
            def __init__(self, **_kwargs: object) -> None:
                pass

            def __enter__(self) -> "Client":
                return self

            def __exit__(self, *_args: object) -> bool:
                return False

            def post(self, url: str, json: dict[str, str]) -> object:
                calls.append((url, json))
                return SimpleNamespace(status_code=200, json=lambda: {"sdp": "answer", "type": "answer"})

        fake_httpx = SimpleNamespace(Client=Client, HTTPError=RuntimeError)
        with patch.dict(sys.modules, {"httpx": fake_httpx}):
            answer = bridge.relay_camera_offer("192.168.123.164", "head", {"sdp": "offer", "type": "offer"})

        self.assertEqual(answer, {"sdp": "answer", "type": "answer"})
        self.assertEqual(calls, [("https://192.168.123.164:60001/offer", {"sdp": "offer", "type": "offer"})])

    def test_refuses_public_or_non_literal_camera_destinations(self) -> None:
        for host in ("93.184.216.34", "robot.internal"):
            with self.assertRaises(bridge.CameraRelayError):
                bridge.relay_camera_offer(host, "head", {"sdp": "offer", "type": "offer"})

    def test_exposes_the_original_sidecar_offer_route(self) -> None:
        monitor = bridge.G1Monitor("unused", "unused", ("unused",))
        server = bridge.MonitorServer(("127.0.0.1", 0), monitor)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        request = Request(
            f"http://127.0.0.1:{server.server_port}/v1/embodied/cameras/head/offer",
            data=json.dumps({"host": "192.168.123.164", "offer": {"sdp": "offer", "type": "offer"}}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with patch.object(bridge, "relay_camera_offer", return_value={"sdp": "answer", "type": "answer"}) as relay:
                with urlopen(request) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(json.loads(response.read()), {"sdp": "answer", "type": "answer"})
                relay.assert_called_once_with("192.168.123.164", "head", {"sdp": "offer", "type": "offer"})
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=1)


if __name__ == "__main__":
    unittest.main()
