# 评估器材料模板

- `dataset_manifest.json`：绑定数据集版本、保管位置、硬件和所有冻结配置摘要。
- `episode_manifest.csv`：已列出最低 55 个案例并固定 `development` / `acceptance` 分组。保留无效采集行，不跨组挪动案例。
- `labels.csv`：逐回合记录可观察事实；`expected_result` 必须按采集协议的固定优先级派生。

正式使用时复制这些模板到受控外部存储，并删除 `labels.csv` 的示例行。字段枚举、目录合同、隔离方式和完成判据见 [`training-proxy-evaluator-evidence-protocol.md`](../../operations/training-proxy-evaluator-evidence-protocol.md)。
