# Shaka 可调用测试 API

Shaka 把“任务意图 → 就绪检查 → 观察 → 规划 → 硬件保护 → 单次执行 → 独立评估 → 证据留存”压缩为一个评委无需 G1 也能调用的稳定接口。

> 公共模式是确定性契约仿真。它证明接口、流程和输出形式闭环，不宣称发生过真实 G1 物理执行。每个响应均携带明确的证据等级与物理执行声明。

<a class="demo-link" href="demo.html">打开交互测试台 →</a>

## 三种使用方式

1. **网页直接试用**：打开交互测试台，选择场景并查看完整 JSON。
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

## 交付入口

- [5 分钟快速开始](quickstart.md)
- [API 契约](api-reference.md)
- [代表性测试案例](examples.md)
- [系统架构与创新](architecture.md)
- [证据边界与真机迁移](evidence-boundary.md)
- [科研论文式技术报告](paper/Shaka-Technical-Report.pdf)
- [GitHub 源码](https://github.com/v6582374-netizen/Shaka)
