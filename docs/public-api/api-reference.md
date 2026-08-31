# API 契约

完整机器可读定义：[OpenAPI 3.1](https://raw.githubusercontent.com/v6582374-netizen/Shaka/main/submission_api/openapi.json)。本地服务也在 `/openapi.json` 暴露同一文件。

## `GET /v1/health`

服务存活检查。

## `GET /v1/capabilities`

返回任务、五态结果语义、支持场景、执行模式和源码入口。客户端应先调用该端点，而不是假设真机存在。

## `GET /v1/qwen/evidence`

返回仓库已留存的 Qwen3-Max 两轮反馈案例摘要，包括百炼 provider、模型、Request ID、token 总量、两轮计划标识、模型外判定和证据边界。该端点不返回 API Key，也不把契约仿真描述为物理实验。

## `POST /v1/qwen/replay`

先核对案例 manifest，再只读加载已留存的两轮计划，并用当前确定性执行器和评价器重放。请求体可为空，或使用 `{"round":1}` / `{"round":2}` 只重放一轮。响应固定声明 `manifest_verified=true`、`qwen_called=false` 与 `physical_execution=false`；该端点不会产生百炼费用，也不会改写案例包。

## `POST /v1/invocations`

创建并同步完成一次单次尝试调用。

### 请求字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `task_id` | string | 否 | 固定为 `g1-yellow-button-contact-v1` |
| `instruction` | string | 否 | 1–500 字符的任务意图 |
| `mode` | string | 否 | 公共端点固定为 `simulation` |
| `scenario` | enum | 否 | `nominal`、`shifted_base`、`target_occluded`、`guardian_absent` |
| `seed` | integer | 否 | 确定性变化种子 |
| `guardian_present` | boolean | 否 | 硬件保护守护是否在线 |
| `initial_state` | object | 否 | 基座 x/y 偏移与偏航角 |
| `plan_controls` | object | 否 | 观察时长、接近幅度与动作时标；代表案例用它改变真实动作路点 |

### 五态输出

| 结果 | 语义 |
| --- | --- |
| `succeeded` | 证据显示接触且撤离 |
| `failed` | 完整证据显示任务未完成 |
| `indeterminate` | 证据完整但无法可靠裁决 |
| `aborted` | 保护边界中止执行 |
| `abstained` | 评估器因证据不足拒绝裁决 |

### HTTP 错误

- `400`：JSON 或请求格式错误；
- `409`：请求了当前不可用的真机模式；
- `413`：请求体过大；
- `422`：任务契约校验失败。

错误统一为：

```json
{
  "error": {
    "code": "unsupported_scenario",
    "message": "scenario must be one of: nominal, shifted_base, target_occluded, guardian_absent"
  }
}
```
