# 5 分钟快速开始

## 方案 A：浏览器交互

打开 [交互测试台](demo.html)。若页面由本地 API 服务打开，地址保持“当前地址”即可；若从 GitHub Pages 打开，将 API 地址改为本机或 Codespaces 转发地址。

## 方案 B：本地 API

只需要 Python 3.11+，无须安装依赖：

```bash
python3 -m submission_api.server --host 127.0.0.1 --port 8787
```

健康检查：

```bash
curl -sS http://127.0.0.1:8787/v1/health
```

读取或重放已留存的 Qwen 两轮案例：

```bash
curl -sS http://127.0.0.1:8787/v1/qwen/evidence
curl -sS http://127.0.0.1:8787/v1/qwen/replay \
  -H 'Content-Type: application/json' -d '{}'
python3 scripts/verify_qwen_feedback_cycle.py
```

最后一条命令不启动服务、不联网、不写文件。

发起一次调用：

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

## 方案 C：云端零安装

点击 [创建 Codespace](https://codespaces.new/v6582374-netizen/Shaka?quickstart=1)。容器启动后会自动运行 API 并打开转发后的 8787 端口。

## 验证成功的标志

响应同时包含：

- `task_result`：五态结果；
- `trace`：从就绪到证据留存的逐阶段轨迹；
- `action_plan`：被保护边界接纳的动作计划；
- `evaluation`：独立评估事实与指标；
- `evidence_digest`：输入、过程、输出的摘要绑定；
- `physical_execution=false`：防止把形式仿真误当真机证据。
