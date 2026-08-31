# Shaka

Shaka is a contract-first embodied skill-acquisition system for Unitree G1. It closes the formal lifecycle from task intent through guarded execution, independent evaluation, evidence retention, and the next improvement decision.

## Competition entry points

- Public documentation and interactive test page: <https://v6582374-netizen.github.io/Shaka/>
- One-click cloud test environment: <https://codespaces.new/v6582374-netizen/Shaka?quickstart=1>
- OpenAPI contract: [`submission_api/openapi.json`](submission_api/openapi.json)
- Technical paper: [`deliverables/Shaka-Technical-Report.pdf`](deliverables/Shaka-Technical-Report.pdf)
- Source repository: <https://github.com/v6582374-netizen/Shaka>

## Test the API without a robot

The submission adapter has no third-party Python dependencies and defaults to deterministic simulation:

```bash
python3 -m submission_api.server --host 127.0.0.1 --port 8787
```

Open <http://127.0.0.1:8787> or call it directly:

```bash
curl -sS http://127.0.0.1:8787/v1/invocations \
  -H 'Content-Type: application/json' \
  -d '{"mode":"simulation","scenario":"nominal","seed":7}'
```

Every response states whether physical execution occurred. The public simulator exercises the interface and lifecycle form; it does not present synthetic output as real G1 evidence.

## Verification

```bash
python3 -m unittest tests.test_submission_api -v
```
