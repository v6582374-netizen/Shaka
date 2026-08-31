# Qwen feedback-cycle evidence

This directory retains one genuine two-round `qwen3-max` planning cycle through Alibaba Cloud Model Studio (Bailian/DashScope).

Evidence boundary: the executor is a deterministic contract fixture. It does not contain physical Unitree G1 execution, sensor measurements, or physics-engine results.

## Reading order

1. `qwen-context.json` — exact system/user context retained for both rounds.
2. `round-1-plan.json` — Qwen plan accepted before execution.
3. `round-1-result.json` — raw deterministic executor output.
4. `round-1-assessment.json` — model-external frozen-threshold decision (`adjust`).
5. `round-2-plan.json` — Qwen adjustment after reading round-one evidence.
6. `round-2-result.json` — second executor output under the same evaluator.
7. `round-2-assessment.json` — second model-external decision (`accept`).
8. `plan-diff.json` — machine-readable parameter changes and frozen fields.
9. `method-comparison.json` — no-feedback, fixed-rule, and Qwen feedback policies.
10. `parameter-space-audit.json` — 45 bounded candidates containing both decisions.
11. `repeatability.json` — 20 deterministic replays per round and their interpretation limit.
12. `qwen-receipts.json` — redacted provider/model/Request ID/token/SHA-256 receipts.
13. `cycle-summary.json` — compact public API response.
14. `failed-cycle-disclosure.json` — the earlier `adjust → adjust` run and its incomplete-retention boundary.
15. `artifact-manifest.json` — SHA-256 and byte size for every JSON artifact except itself.

`qwen-attempts.json` records accepted/rejected schema attempts without retaining credentials. The API key is read only from `DASHSCOPE_API_KEY` or the local official Qwen CLI settings.

## Reproduce

```bash
python3 scripts/verify_qwen_feedback_cycle.py
python3 -m submission_api.server --host 127.0.0.1 --port 8787
curl -sS http://127.0.0.1:8787/v1/qwen/evidence
curl -sS http://127.0.0.1:8787/v1/qwen/replay -H 'Content-Type: application/json' -d '{}'
```

These commands do not call Qwen. Running `python3 scripts/run_qwen_feedback_cycle.py` explicitly creates a new networked, billable cycle with new Request IDs and timestamps.
