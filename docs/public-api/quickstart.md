# 5 分钟快速开始

本页只处理 API 调用。若要先理解项目愿景与真机成果，请打开 [Shaka Evolution Observatory](demo.html)。

## 1. 启动服务

只需要 Python 3.11+，无须安装依赖：

```bash
python3 -m submission_api.server --host 127.0.0.1 --port 8787
```

## 2. 检查服务

```bash
curl -sS http://127.0.0.1:8787/v1/health
```

## 3. 运行一个完整调用

```bash
curl -sS http://127.0.0.1:8787/v1/invocations \
  -H 'Content-Type: application/json' \
  -d @- <<'JSON'
{
  "task_id": "g1-yellow-button-contact-v1",
  "instruction": "定位黄色按钮，以右手食指触碰一次，随后撤离。",
  "mode": "simulation",
  "scenario": "shifted_base",
  "seed": 11,
  "initial_state": {
    "base_x_m": 0.18,
    "base_y_m": -0.08,
    "base_yaw_deg": 12
  }
}
JSON
```

常用确定性场景：

- `nominal`：标准通过路径；
- `shifted_base`：验证初始基座位姿的输入传播；
- `target_occluded`：目标不可见；
- `guardian_absent`：保护条件缺失，预期拒绝。

## 4. 读取与重放 Qwen 案例

```bash
curl -sS http://127.0.0.1:8787/v1/qwen/evidence
curl -sS http://127.0.0.1:8787/v1/qwen/replay \
  -H 'Content-Type: application/json' \
  -d '{}'
python3 scripts/verify_qwen_feedback_cycle.py
```

重放使用仓库中已留存的输入与确定性程序，不会再次调用 Qwen，也不会写入机器人。最后一条验证命令不启动服务、不联网、不写文件。

## 5. 云端零安装

点击 [创建 Codespace](https://codespaces.new/v6582374-netizen/Shaka?quickstart=1)。容器启动后会自动运行 API 并打开转发后的 8787 端口。

## 验证成功的标志

响应同时包含：

- `task_result`：五态结果；
- `trace`：从就绪到证据留存的逐阶段轨迹；
- `action_plan`：被保护边界接纳的动作计划；
- `evaluation`：独立评估事实与指标；
- `evidence_digest`：输入、过程、输出的摘要绑定；
- `physical_execution=false`：防止把形式仿真误当真机证据。
