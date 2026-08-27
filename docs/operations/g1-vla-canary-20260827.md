# G1 VLA canary — 2026-08-27

This is an execution record, not a successful-evaluation claim.

The frozen UniFoLM-VLA projected plan was bound to SHA-256
`5f3e53af9a4e6000dc964209957ca57989b92cb894ab92a5ad252bf9af965758`.
It was sent from the auxiliary host over `eth2` through `rt/arm_sdk`; BrainCo
accepted both fresh command streams.

| Attempt | Result | Observed dynamic boundary | Postflight |
| --- | --- | --- | --- |
| V7 | rejected | A zero-displacement 4 N m upper-body gate rejected shortly after trajectory entry. | CRC-valid V5 dry run: 2,625 samples, no foreign `rt/arm_sdk` publisher, zero writes. |
| V8 | rejected | Right arm channel 8 (`right_shoulder_roll_joint`) reported 16.625 N m, exceeding the 12.5 N m (50% of its 25 N m URDF effort limit) gate. | After settling, CRC-valid V5 dry run: 2,613 samples, no foreign `rt/arm_sdk` publisher, zero writes. |

The BrainCo service logged fresh left and right streams for both attempts, then
stopped serial writes after its 100 ms freshness timeout when the executor
aborted. No arm authority publisher remained after either attempt.

## Consequence for evolution

The current absolute-pose VLA output is mechanically within static URDF bounds
but is not dynamically admissible under the live controller's torque feedback.
Future policy/control evolution must treat the measured shoulder-load boundary
as a negative physical sample and produce a trajectory with feedback-aware
retiming or an action representation calibrated to the `rt/arm_sdk` stiffness
controller. It must not record either canary as a task success.
