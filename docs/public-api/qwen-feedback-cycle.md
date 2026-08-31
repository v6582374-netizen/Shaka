# Qwen 两轮反馈案例

## 科学问题与证据等级

代表案例询问：在基座位姿、任务和保护边界保持不变时，Qwen 能否依据第一轮失败证据调整真正进入动作计划的观察时长、接近幅度与动作时标，使黄色按钮任务的软件准入指标全部达标？

本案例使用阿里云百炼 OpenAI 兼容端点调用 `qwen3-max`。Qwen 只生成计划、解释第一轮反馈并提出有界调整；任务输出和阈值判定由确定性 Python 程序完成。整个案例的证据等级是 `deterministic_contract_simulation_only`，不构成真实 G1、传感器数据或物理仿真结论。

## 上下文结构

```text
科学问题 + 已有事实 + 工作假设 + 冻结阈值 + 允许变量
  → Qwen 第一轮 JSON 计划
  → 契约执行器原始输出
  → 确定性阈值检查
  → 第一轮计划 + 原始指标 + 每项检查结果
  → Qwen 第二轮 JSON 调整计划
  → 同一执行器与同一阈值再次判断
```

入口 schema 锁定 `mode=simulation`、`scenario=shifted_base`、`seed=11`、保护守护存在、固定基座 `x=0.18 m / y=-0.08 m / yaw=12°` 与固定成功阈值。第一轮控制量固定为 `250 ms / 1.00 / 1.00`；第二轮只能在 `250–650 ms / 0.80–1.00 / 1.00–1.30` 内调整。任何越界输出都会被拒绝，Qwen 不能自行赋予任务结果。

## 已保存的两轮结果

| 项目 | 第一轮 | 第二轮 |
| --- | ---: | ---: |
| `base_x_m / base_y_m / yaw` | `0.18 / -0.08 / 12°` | `0.18 / -0.08 / 12°` |
| `observation_duration_ms` | 250 | 500 |
| `approach_scale` | 1.00 | 0.85 |
| `motion_duration_scale` | 1.00 | 1.20 |
| 构造型定位置信度 | 0.943 | 0.958 |
| 构造型接触误差 / mm | 3.19 | 2.99 |
| 峰值关节速度占比 | 0.658 | 0.466 |
| 最小间隙 / mm | 40.27 | 40.87 |
| 程序判定 | `adjust` | `accept` |

Qwen 在第二轮把第一轮三个失败检查逐项映射为控制量变化：定位置信度对应观察时长 `250→500 ms`，接触误差对应接近幅度 `1.00→0.85`，峰值速度对应动作时标 `1.00→1.20`。程序核对每个 observed value、criterion value 与 from/to value；任务、固定基座、seed、场景、保护状态、执行器和成功标准保持不变。

第二轮接触误差为 `2.99 mm`，只比 `3.0 mm` 软件门槛低 `0.01 mm`；这不是稳健余量。当前材料只能表明“提示目标修订后的一个成功案例优于当前固定规则基线”，不能推导 Qwen 的成功率或普遍优于规则方法。

## 对照与重复性边界

无反馈对照原样重放第一轮计划，规则式反馈固定采用 `450 ms / 0.90 / 1.10`，两者都得到 `adjust`；Qwen 反馈采用 `500 ms / 0.85 / 1.20`，得到 `accept`。45 点参数网格中有 15 个 `accept` 与 30 个 `adjust` 候选，因此允许域没有预先保证成功。两轮各重复 20 次只证明软件确定性，不能当作统计稳健性或物理重复性。

本次正式周期为 `qwen-cycle-0be3f41b-a390754c`，两次百炼 Request ID 分别是 `chatcmpl-c7dd766d-e698-9239-b713-423b7d26f2cb` 与 `chatcmpl-00e923b3-6b35-970b-97bb-7dd390696bc9`，合计 3490 tokens。

在它之前，一次正式运行得到 `adjust → adjust`：第二轮控制量为 `450 ms / 0.92 / 1.15`，接触误差仍为 `3.05 mm`。当时主目录被后续运行替换，未保留完整逐文件回执；仓库以 [失败周期披露](https://raw.githubusercontent.com/v6582374-netizen/Shaka/main/artifacts/qwen-feedback-cycle/failed-cycle-disclosure.json) 保存已捕获摘要并明确这一证据缺口。当前脚本会把未来的非成功周期自动保存在独立失败目录，不再覆盖或隐去。

## 脱敏回执与复现

- [完整案例目录](https://github.com/v6582374-netizen/Shaka/tree/main/artifacts/qwen-feedback-cycle)
- [两轮摘要](https://raw.githubusercontent.com/v6582374-netizen/Shaka/main/artifacts/qwen-feedback-cycle/cycle-summary.json)
- [Qwen 脱敏回执](https://raw.githubusercontent.com/v6582374-netizen/Shaka/main/artifacts/qwen-feedback-cycle/qwen-receipts.json)
- [计划差异](https://raw.githubusercontent.com/v6582374-netizen/Shaka/main/artifacts/qwen-feedback-cycle/plan-diff.json)
- [三种反馈策略对照](https://raw.githubusercontent.com/v6582374-netizen/Shaka/main/artifacts/qwen-feedback-cycle/method-comparison.json)
- [参数空间审计](https://raw.githubusercontent.com/v6582374-netizen/Shaka/main/artifacts/qwen-feedback-cycle/parameter-space-audit.json)
- [SHA-256 manifest](https://raw.githubusercontent.com/v6582374-netizen/Shaka/main/artifacts/qwen-feedback-cycle/artifact-manifest.json)

本地重新运行会产生新的百炼 Request ID：

```bash
python3 scripts/verify_qwen_feedback_cycle.py
python3 -m submission_api.server --host 127.0.0.1 --port 8787
curl -sS http://127.0.0.1:8787/v1/qwen/evidence
curl -sS http://127.0.0.1:8787/v1/qwen/replay -H 'Content-Type: application/json' -d '{}'
```

前三条复现路径均不调用 Qwen。只有显式运行 `python3 scripts/run_qwen_feedback_cycle.py` 才会联网并产生新的百炼 Request ID 与费用；凭证只从 `DASHSCOPE_API_KEY` 或本机 Qwen 官方 CLI 配置读取，不会写入案例包。
