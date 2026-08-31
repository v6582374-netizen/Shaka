# Shaka 可调用测试 API

Shaka 把“科学问题 → Qwen 规划 → 契约执行 → 模型外评价 → Qwen 调整 → 第二轮验证”与单次机器人调用生命周期连接为一个可审计案例。

> 公共模式是确定性契约仿真。它证明接口、流程和输出形式闭环，不宣称发生过真实 G1 物理执行。每个响应均携带明确的证据等级与物理执行声明。

<a class="demo-link" href="demo.html">打开交互测试台 →</a>

## 三种使用方式

1. **网页测试台**：静态页面只提供客户端界面，需先启动本地或 Codespaces API，再配置可访问的 HTTPS/API 地址。
2. **本地零依赖调用**：克隆源码后用 Python 标准库启动服务。
3. **GitHub Codespaces**：点击云端入口，服务会自动启动并转发 8787 端口。

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

交互测试台还可直接读取已留存的 Qwen 案例，或调用 `POST /v1/qwen/replay` 重放两轮计划。重放只运行确定性程序，不再次调用 Qwen。

## 交付入口

- [5 分钟快速开始](quickstart.md)
- [API 契约](api-reference.md)
- [Qwen 两轮反馈案例](qwen-feedback-cycle.md)
- [代表性测试案例](examples.md)
- [系统架构与创新](architecture.md)
- [证据边界与真机迁移](evidence-boundary.md)
- [P1–P20 技术报告](paper/Shaka-Technical-Report.pdf)
- [GitHub 源码](https://github.com/v6582374-netizen/Shaka)
