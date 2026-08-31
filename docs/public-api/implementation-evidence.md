# 实现与证据细节

本页承接技术报告中不适合展开的实现细节。技术报告回答“Shaka 为什么需要、总体如何工作、代表案例说明什么”；本页回答“字段如何约束、指标如何生成、程序如何判定、证据如何复现”。

## 1. 计划级自进化的准确含义

Shaka 当前实现的是计划级自进化，而不是模型训练或机器人技能自学习：

1. 研究者冻结科学问题、固定条件、评价门槛和允许参数域。
2. Qwen 将冻结协议组织为结构化计划，并给出假设、预期和停止条件。
3. 程序检查计划是否合法，随后运行数字具身任务。
4. 独立判定程序逐项比较观测指标与冻结门槛。
5. 第一轮计划、原始结果和逐项判定进入第二轮上下文。
6. Qwen 只能在限定参数域内选择新的控制量，不能改问题、门槛或结果。

因此，“自进化”发生在下一轮计划，而不表示 Qwen 权重、机器人策略网络或真实硬件能力已经学习更新。

## 2. 角色与决策权

| 角色 | 可以决定 | 不可以决定 |
|---|---|---|
| 研究者 | 科学问题、允许变量、门槛、证据等级、物理授权和最终结论 | 在成功周期内部事后改写已保存的计划与结果 |
| Qwen | 假设、预期、停止条件；第二轮有界控制量；证据到变化的解释 | 任务、固定基座、门槛、程序结果、物理授权 |
| `validate_plan` | 字段完整性、固定条件一致性、参数范围 | 选择调参方案或宣布实验成功 |
| `run_invocation` | 运行确定性软件任务，生成路点、阶段、指标和摘要 | 真实机器人写入或物理仿真 |
| `assess_result` | 逐项比较门槛，输出 `adjust` 或 `accept` | 修改门槛或接受模型自报结果 |

## 3. 核心术语

- **实验运行程序**：`run_invocation`。它是公式驱动的软件函数，不是真机控制器或物理引擎。
- **结构化计划规范**：JSON schema 与 `validate_plan` 共同实现的字段和范围检查。
- **逐项判定**：`checks`，即每个观测值是否达到冻结门槛。
- **证据清单**：manifest，记录文件路径、大小与 SHA-256，可检测文件相对清单的变化；已发布 Git commit 与远端历史提供外部时间点锚定。
- **固定随机条件**：`seed`，在当前公式中只产生可重复的微小扰动，不等于统计抽样。
- **安全授权状态**：`guardian_present`，模拟保护门控的布尔输入，不是真实硬件安全系统。
- **任务分支状态**：`succeeded`、`abstained`、`aborted` 分别表示软件任务完成、证据不足和保护条件导致中止。
- **本轮判定**：`adjust` 表示至少一项门槛未满足，需要调整计划；`accept` 表示全部冻结门槛通过。`succeeded` 与 `accept` 不是同一个结论。

## 4. 固定条件与允许变量

主案例冻结：

- `task_id=g1-yellow-button-contact-v1`
- `mode=simulation`
- `scenario=shifted_base`
- `seed=11`
- `guardian_present=true`
- 基座位姿 `x=0.18 m, y=-0.08 m, yaw=12°`
- 四项成功门槛

第二轮只允许改变：

- `observation_duration_ms`：250–650 ms
- `approach_scale`：0.80–1.00
- `motion_duration_scale`：1.00–1.30

计划改变任务、固定基座、seed、场景、保护状态或评价门槛时，`validate_plan` 直接拒绝，不进入运行。

## 5. 指标公式与来源

以下公式来自 [`submission_api/core.py`](https://github.com/v6582374-netizen/Shaka/blob/main/submission_api/core.py) 的 `_nominal_metrics`。它们是验证反馈链路的确定性测试夹具，不是传感器模型或机器人动力学。

令：

- `d = hypot(base_x_m, base_y_m)`
- `yaw = abs(base_yaw_deg)`
- `Δt = observation_duration_ms - 250`
- `a = approach_scale`
- `m = motion_duration_scale`
- `ε = ((seed × 37) mod 17) / 10000`

基础量：

```text
base_localization = 0.989 - 0.14 d - 0.0015 yaw
base_contact_error = 2.1 + 4 d + 0.025 yaw + ε
base_velocity = 0.64 + 0.09 d
base_clearance = 43 - 9 d - 0.08 yaw
```

输出量：

```text
localization_confidence = max(0.82, base_localization + 0.00006 Δt)
predicted_contact_error_mm = base_contact_error - 0.00045 Δt - 0.60 (1-a)
peak_joint_velocity_ratio = base_velocity × a / m
minimum_clearance_mm = base_clearance + 4 (1-a)
retreat_distance_mm = 91 - 3 d
```

代码对结果分别取三位或两位小数。公式的单调关系解释了本案例的方向性：延长观察时间提高构造置信度并降低构造误差；减小接近幅度降低构造误差与速度比并提高间隙；增大动作时标降低速度比。

## 6. 动作计划如何进入运行程序

通过边界检查后，请求直接传入 `run_invocation`，不是人工重新录入。成功分支生成四个路点：

| 路点 | 第一轮时长 | 第二轮时长 | 关节增量变化 |
|---|---:|---:|---|
| `observe` | 250 ms | 500 ms | 七个关节增量均为 0 |
| `pre_contact` | 900 ms | 1080 ms | 七维增量整体乘以 `approach_scale`，第二轮为第一轮的 0.85 |
| `contact` | 420 ms | 504 ms | 七维增量整体乘以 `approach_scale`，第二轮为第一轮的 0.85 |
| `retreat` | 650 ms | 780 ms | 关节增量固定，时长随 `motion_duration_scale` 改变 |

这说明三个控制量真实进入动作计划，而不是只出现在解释文本中。

## 7. 独立判定语义

`assess_result` 固定执行五项检查：

```text
task_result == succeeded
target_localization_confidence >= 0.95
predicted_contact_error_mm <= 3.0
peak_joint_velocity_ratio <= 0.60
minimum_clearance_mm >= 40
```

只有五项全部为真时输出 `accept`，否则输出 `adjust`。Qwen 不写入 `task_result`，也不能覆盖 `checks`。

## 8. 第一轮到第二轮的证据映射

程序核对的映射保存在 [`plan-diff.json`](https://raw.githubusercontent.com/v6582374-netizen/Shaka/main/artifacts/qwen-feedback-cycle/plan-diff.json)：

| 第一轮未达项 | 观测/门槛 | Qwen 第二轮变化 |
|---|---|---|
| 定位置信度 | `0.943 < 0.95` | 观察时长 `250 → 500 ms` |
| 接触误差 | `3.19 > 3.0 mm` | 接近幅度 `1.00 → 0.85` |
| 峰值速度比 | `0.658 > 0.60` | 动作时标 `1.00 → 1.20` |

任务、基座、seed、场景、保护状态、评价门槛和输出结构均保持不变。

## 9. 45 点参数空间审计

[`parameter-space-audit.json`](https://raw.githubusercontent.com/v6582374-netizen/Shaka/main/artifacts/qwen-feedback-cycle/parameter-space-audit.json) 枚举：

- 5 个观察时长：250、350、450、550、650 ms
- 3 个接近幅度：0.80、0.90、1.00
- 3 个动作时标：1.00、1.15、1.30

45 个候选中 15 个为 `accept`，30 个为 `adjust`。允许域没有预先保证成功；Qwen 点 `500/0.85/1.20` 不属于枚举网格，但处于同一连续参数边界内。无反馈点 `250/1.00/1.00` 与固定规则点 `450/0.90/1.10` 均为 `adjust`。

## 10. 主案例选择与失败周期

当前主案例来自提示目标修订后的成功周期。更早一次正式周期为 `adjust → adjust`，第二轮接触误差为 `3.05 mm`。当时失败周期自动留存尚未实现，原始逐文件包被后续运行替换，只保存了捕获摘要和 Request ID；这一缺口公开记录在 [`failed-cycle-disclosure.json`](https://raw.githubusercontent.com/v6582374-netizen/Shaka/main/artifacts/qwen-feedback-cycle/failed-cycle-disclosure.json)。

因此：

- 主案例内部没有改阈值、换 seed 或事后改写计划；
- 主案例选择受到前一失败周期的提示修订影响；
- 单个成功周期不能估计 Qwen 成功率；
- 当前脚本会把未来非成功周期保存到独立目录，避免再次覆盖。

## 11. 调用回执与证据清单

两次有效百炼调用留存：模型、端点、脱敏 Request ID、时间、token、输入/输出 SHA-256。API Key 不进入工件。证据清单验证的是“文件是否仍与清单一致”；Git commit 与公开远端历史用于锚定已发布版本，二者共同构成证据链，但不等同于不可篡改的第三方时间戳服务。

## 12. 复现入口

```bash
python3 scripts/verify_qwen_feedback_cycle.py
python3 -m unittest tests.test_qwen_planner tests.test_qwen_cycle_verifier tests.test_submission_api -v
python3 -m submission_api.server --host 127.0.0.1 --port 8787
curl -sS http://127.0.0.1:8787/v1/qwen/evidence
curl -sS http://127.0.0.1:8787/v1/qwen/replay -H 'Content-Type: application/json' -d '{}'
```

前述验证与重放不再次调用 Qwen。只有显式运行 `scripts/run_qwen_feedback_cycle.py` 才会联网、产生新的百炼 Request ID 和费用。
