#!/usr/bin/env python3
"""Capture one CRC-independent read-only 14-joint G1 arm entry pose."""
from __future__ import annotations
import argparse, json, math, time
from pathlib import Path

ARM_MOTOR_FIRST = 15
ARM_DIMENSION = 14

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network-interface", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit("refusing to overwrite entry pose")
    from unitree_sdk2py.core.channel import ChannelFactoryInitialize, ChannelSubscriber
    from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowState_
    ChannelFactoryInitialize(0, args.network_interface)
    reader = ChannelSubscriber("rt/lowstate", LowState_)
    reader.Init()
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        message = reader.Read()
        if message is not None and len(message.motor_state) >= ARM_MOTOR_FIRST + ARM_DIMENSION:
            positions = [float(message.motor_state[index].q) for index in range(ARM_MOTOR_FIRST, ARM_MOTOR_FIRST + ARM_DIMENSION)]
            if all(math.isfinite(value) for value in positions):
                args.output.write_text(json.dumps(positions) + "\n", encoding="utf-8")
                print(json.dumps({"result": "g1_arm_entry_pose_captured", "positions": positions, "writes": 0}))
                return 0
        time.sleep(0.002)
    print(json.dumps({"result": "g1_arm_entry_pose_rejected", "reason": "no finite lowstate", "writes": 0}))
    return 2

if __name__ == "__main__":
    raise SystemExit(main())
