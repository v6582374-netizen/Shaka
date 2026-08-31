# 代表性测试案例

以下结果来自仓库内可运行的确定性契约仿真，不是物理 G1 实验数据，也不是传感器测量。主案例见 [Qwen 两轮反馈案例](qwen-feedback-cycle.md)；本页四个分支仅用于验证 API 生命周期与故障语义。

## 案例 1：标准黄色按钮任务

```json
{"mode":"simulation","scenario":"nominal","seed":7}
```

期望：`task_result=succeeded`，轨迹包含 7 个阶段，生成 4 个动作路点，`writes_to_robot=0`。

## 案例 2：基座位姿变化

```json
{
  "mode":"simulation",
  "scenario":"shifted_base",
  "seed":11,
  "initial_state":{"base_x_m":0.18,"base_y_m":-0.08,"base_yaw_deg":12}
}
```

期望：接口返回构造型契约指标，用于测试结构化评价与阈值分支。这些数字不能用于真机性能结论。

## 案例 3：目标被遮挡

```json
{"mode":"simulation","scenario":"target_occluded"}
```

期望：独立评估器输出 `abstained`，系统不伪造成功结果，动作计划为空。

## 案例 4：保护守护缺失

```json
{"mode":"simulation","scenario":"guardian_absent","guardian_present":false}
```

期望：在任何模拟动作前输出 `aborted`，轨迹停在 `hardware_protection`。

## 批量复现

```bash
for scenario in nominal shifted_base target_occluded guardian_absent; do
  curl -sS http://127.0.0.1:8787/v1/invocations \
    -H 'Content-Type: application/json' \
    -d "{\"scenario\":\"$scenario\"}"
done
```
