# Shaka API 手册

这里是 Shaka 的开发者文档，负责说明如何调用、验证和扩展系统；接口字段、错误语义、证据校验和实现细节以本手册为准。

> 公共 API 的默认模式是确定性契约仿真。它用于验证接口、生命周期与证据结构，不代表一次 G1 物理执行。真实 G1 金丝雀及其安全中止证据在[证据边界](evidence-boundary.md)中单独说明。

## 最短路径

1. 按[5 分钟快速开始](quickstart.md)启动零依赖本地服务。
2. 查看[API 契约](api-reference.md)理解端点、请求和响应。
3. 用[代表性测试案例](examples.md)验证成功、拒绝与错误路径。
4. 用[实现与证据细节](implementation-evidence.md)核验清单、摘要与回放结果。

[GitHub Codespaces 一键启动](https://codespaces.new/v6582374-netizen/Shaka?quickstart=1)

## 最短调用

```bash
git clone https://github.com/v6582374-netizen/Shaka.git
cd Shaka
python3 -m submission_api.server --host 127.0.0.1 --port 8787
```

另开终端：

```bash
curl -sS http://127.0.0.1:8787/v1/invocations \
  -H 'Content-Type: application/json' \
  -d '{"mode":"simulation","scenario":"nominal","seed":7}'
```

`GET /v1/qwen/evidence` 可读取已留存案例，`POST /v1/qwen/replay` 可重放两轮计划。重放只运行确定性程序，不再次调用 Qwen。

## 手册结构

- [5 分钟快速开始](quickstart.md)
- [API 契约](api-reference.md)
- [Qwen 两轮反馈案例](qwen-feedback-cycle.md)
- [实现与证据细节](implementation-evidence.md)
- [代表性测试案例](examples.md)
- [系统架构与创新](architecture.md)
- [证据边界与真机迁移](evidence-boundary.md)
- [P1–P20 技术报告](paper/Shaka-Technical-Report.pdf)
- [GitHub 源码](https://github.com/v6582374-netizen/Shaka)
