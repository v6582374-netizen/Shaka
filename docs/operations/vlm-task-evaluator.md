# 多模态大模型任务评估器

本原型在回合结束后，将同步的四路视觉证据提交给独立多模态大模型，提取指定手指接触与撤离事实。候选实现不能访问或修改评估器配置、提示词和结果映射。

## 边界

- 不预先采集人工标注的开发集或验收集。
- 多模态模型只判断视觉事实。
- `aborted`、`abstained` 和证据完整性由控制日志与确定性规则判断。
- 捕获没有覆盖完整控制释放阶段时，禁止输出 `succeeded`。
- 初版运行在影子模式，所有判断都需要人工审校；审校结果不反馈给当前回合。
- 模型、提示词、图像采样、任务合同或结果映射变化时，必须发布新的评估器版本。

## 证据准备

```bash
python3 scripts/evaluate_episode_with_vlm.py prepare \
  --episode-directory /path/to/episode \
  --output-directory /path/to/evidence
```

程序按照统一时间戳选取回合窗口，将每个时间点的头部左右视角和左右腕视角组成一张四视角面板，并保存面板来源、时间误差和 SHA-256。

## 模型判断

默认后端为 `auto`：如果存在 `OPENAI_API_KEY`，使用 OpenAI Responses API；否则在本机 Codex CLI 已登录时复用其凭据，通过只读、临时会话完成同一结构化判断。两者都不可用时拒绝运行。

```bash
python3 scripts/evaluate_episode_with_vlm.py evaluate \
  --evidence-directory /path/to/evidence \
  --output /path/to/assessment.json
```

模型通过 OpenAI Responses API 接收多张 `input_image`，并使用结构化输出生成固定字段。最终结果由本地规则映射为 `succeeded`、`failed`、`indeterminate`、`aborted` 或 `abstained`。

可通过 `--backend openai` 或 `--backend codex-cli` 固定后端。Codex CLI 后端使用 `--ephemeral`、只读沙箱、`--image` 和 `--output-schema`，不加载仓库规则，也不持久化评估会话。

## 人工审校

人工审校写入独立文件，不覆盖模型原始结果：

```bash
python3 scripts/evaluate_episode_with_vlm.py audit \
  --assessment /path/to/assessment.json \
  --output /path/to/audit.json \
  --auditor-id operator-1 \
  --agreement agree
```

若选择 `disagree`，同时使用 `--audited-result` 记录人工判断。审校只作为评估器审计证据和首次成功确认，不作为当前回合的在线反馈。

官方接口依据：

- [OpenAI Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI GPT-5.6 model](https://developers.openai.com/api/docs/models/gpt-5.6)
- [OpenAI Codex CLI reference](https://developers.openai.com/codex/cli/reference)
