# Animation implementation plans

| # | Plan | Severity | Status | Dependency |
| --- | --- | --- | --- | --- |
| 001 | [Fade the G1 hologram in when its GLB is ready](001-g1-hologram-load-handoff.md) | LOW | DONE | None |

## Recommended execution order

1. Execute plan 001. It is self-contained and has no dependency on robot, bridge, or telemetry changes.

The plan must preserve the Body Status rule that live readings remain still and that the GLB represents a static exterior rather than real-time robot pose.
