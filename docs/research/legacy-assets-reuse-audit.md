# 旧资产可复用价值审计

日期：2026-08-25  
对应问题：[审计旧资产的可复用价值](https://github.com/v6582374-netizen/Shaka/issues/5)

## 结论

旧资产应当按“**冻结为证据、提取窄接口、不继承旧架构**”处理。

现有资产并不是与黄色按钮任务无关的遗留物。`oilpressure-open-0308` 的 59 个 episode 确实记录了 G1 使用 BrainCo 灵巧手按黄色按钮并打开同一台仪器盖子的过程；50,000 step 的 ACT checkpoint 也正是用这批数据训练，输入为四路 `480×640 RGB` 图像和 26 维上肢状态，输出为同顺序的 26 维关节位置动作。[D1][D2][C1]

但这些事实只证明它们是高价值的**同域先验和诊断基线**，不证明旧 ACT 已经是可安装技能：训练没有独立验证集，现有离线回放明确是 in-sample 诊断；九次真机轨迹只记录“执行完成或中止”，没有独立的任务成功判定；最新两次完成轨迹中，手臂轨迹限制器均介入 751 帧，说明实际执行结果不能简单归因于原始 checkpoint。[C1][R1][T1]

因此，本票的决策是：

1. **直接复用为诊断资产**：冻结的 ACT checkpoint、原始 LeRobot v3 数据、离线回放工具、九次真机轨迹和 BrainCo 单关节 commissioning 证据。
2. **提取后复用为组件**：26 维关节顺序与单位转换、checkpoint 完整性校验、四路观察适配、状态/相机时序检查、速度/加速度/单步变化限制、唯一写入对象和逐帧命令/反馈记录。
3. **只作为后续候选准备复用**：已经生成的 HDF5/RLDS 数据、UniFoLM-VLA Base、UniFoLM-WMA Base 及 1,000-step 本地 WMA checkpoint。它们不是已经验证过的黄色按钮策略。
4. **明确不继承**：`vegapunk/embodied/act_candidate.py` 的简化“ACT”训练器、2,665 行的 ACT 专用真机脚本整体、旧阈值、旧授权口令以及“程序运行完成即任务完成”的含义。

## 资产清单与处置

| 资产 | 已核实事实 | 处置 | 主要缺口 |
|---|---|---|---|
| `oilpressure-open-0308` | 59 episodes、22,524 frames、30 Hz、四路相机、26 维状态/动作；视频可见按黄色按钮后仪器盖打开 | **保留，作为同域历史数据与回归集** | 原始 task 元数据只有宽泛描述；没有 episode 成功位、reset 证据、环境变化标签、采集时刻血统或失败样本 [D1][D2] |
| 另外三组仪器数据 | 放杯 31 段、取杯 31 段、按绿色按钮关盖 27 段；四组共 148 段、61,822 帧 | **保留，作为第二技能复用研究和表示学习数据** | 不属于黄色按钮最小任务；各阶段相互独立，不是完整连续流程 [D1][D3] |
| ACT 50k checkpoint | artifact digest `2b66cca2c8ec2bf8`；约 207 MB；四图像 + 26D 状态输入，100×26 动作块，30 Hz | **冻结为首要诊断基线** | 全 59 段用于训练；无 held-out 指标、无 task-success 指标、真机输出强依赖轨迹整形 [C1][R1][T1] |
| ACT 5k–50k checkpoint 序列 | 每 5,000 step 保存一次，共十个正式里程碑 | **暂时保留，仅用于离线 checkpoint sweep** | 训练日志只有训练 loss，不能据此挑选真机最优版本 [C1][C2] |
| `replay_act_checkpoint.py` 与 `act_offline.py` | 本地严格加载模型与 normalizer；验证输入 schema；区分原始动作、手部投影动作和完整目标契约；没有硬件写权限 | **优先移植为通用离线回放骨架** | 当前硬编码 ACT 的四路图像、26D、100-step chunk 和 `WholeBodyTarget` [S1][S2] |
| 相机/状态观察链 | 帧身份、序号、时钟、尺寸、JPEG payload、状态 envelope 和跨流时间窗都有显式结构 | **提取 schema 与拒绝规则** | 当前在线组装实际按 `read_completed` 而非 hardware capture time 配对；不应把接收时刻当成最终采集真值 [S3][S4] |
| G1/BrainCo 执行代码 | 明确的 14 臂 + 12 手通道映射、BrainCo `[0,1]` 与弧度换算、唯一 `HandPair.write()`、速度/加速度/单步限制和反馈记录 | **提取为新执行入口的硬件适配层** | 混在 ACT 专用脚本中；绑定 Python 3.10 原生扩展、固定 DDS topic、固定站立姿态和旧现场阈值 [S5][S6] |
| 九次 ACT 真机轨迹 | 5 次中止、4 次完成；完成轨迹有逐帧命令/反馈和限制器统计 | **保留为故障分类与执行回归证据** | 没有 `succeeded/failed/indeterminate`、盖子状态或 reset 快照；`completed` 只表示控制流程走完 [T1] |
| HDF5/RLDS BrainCo26 数据 | 119 train / 29 held-out；HDF5 与 RLDS 均已生成；黄色按钮为 47 train / 12 held-out | **保留为候选模型数据入口** | 只保留 `cam_left_high`；tail-block split 仍可能共享同一采集布置和相邻视觉分布 [V1][V2] |
| UniFoLM-WMA 本地 1,000-step checkpoint | 26D 配置、四任务等权训练，checkpoint 约 9.4 GB | **仅保留为离线研究资产** | 配置只有 train loader，使用全部 148 段，没有 held-out 验证，也没有 ACT 候选排序或真机接入证据 [W1] |
| UniFoLM-VLA/WMA/VLM Base | 本地基础权重完整存在 | **作为以后候选的缓存，不计入已获得能力** | 没有本地 BrainCo26 VLA 微调 checkpoint；公开动作头与当前 26D BrainCo 契约并不天然一致 [A1][L2] |
| `act_candidate.py` | 名称是 ACT，但实现是对齐 episode 的动作模板平均，加上图像摘要到 yaw-rate residual 的简化逻辑 | **不作为真实 ACT 训练器复用** | 与 LeRobot ACT 神经策略不是同一实现；只能参考其中的 provenance、whole-episode split 和 immutable record 测试思想 [S7] |

## ACT checkpoint 的证据强度

### 它为什么值得保留

这是当前唯一一个同时满足以下条件的本地策略资产：

- 目标对象、黄色按钮和成功后的盖子状态与首个技能同域；
- 机器人本体是 Unitree G1，末端执行器是 BrainCo 双手；
- 26 维状态/动作顺序与现有硬件代码一致；
- 四路训练相机槽位与现有实时适配器一致；
- checkpoint、normalizer 和训练配置能被本地 LeRobot 环境严格加载；
- artifact digest 已由离线工具和真机脚本共同冻结为 `2b66cca2c8ec2bf8`。[C1][S1][T1]

对 episode 0 的第 0、282、540 帧做 CPU 离线回放，首个预测动作相对记录动作的误差为：手臂 MAE `0.007997 rad`、手部 MAE `0.000672 rad`；300 个解码后动作帧全部通过旧 `WholeBodyTarget` 位置契约。但这三个点都来自训练数据，只能证明 checkpoint、normalizer、输入解码和输出映射仍可运行，不能证明新初始状态下的任务成功。[R1]

### 它为什么不能直接安装

1. **没有真正的留出验证。** `train_config.json` 的 dataset `episodes` 为 `null`，即训练使用全部 59 个 episode；训练日志到 50k step 只报告 train loss，末值约 `0.043`，没有验证 loss 或任务成功率。[C1][C2]
2. **没有独立结果判定。** 九个真机 JSON 的顶层只有 `outcome`、`reason`、`preflight`、`frames` 和 `summary`；四个 `completed` 文件也没有盖子开闭或 Oracle 字段。[T1]
3. **原始策略输出不是直接执行结果。** v13、v14 均有 751 帧触发手臂轨迹限制；v14 另有 99 帧触发手部单步限制。该 checkpoint 的价值恰恰是暴露“感知/策略、动作适配、限制器、跟踪、任务结果”必须分开记录，而不是证明旧策略已经成功。[T1]
4. **环境覆盖不足。** 抽样检查 episode 0、10、20、30、40、50、58 的第一帧，可见相机/仪器姿态有小幅变化，但设备、背景和照明基本相同；没有证据证明它覆盖当前约定的日常位置、光照和初始姿态变化范围。[D2]

所以应把该 checkpoint 固定为 `legacy_act_50k@2b66cca2c8ec2bf8` 这一诊断基线：每次新候选都可在相同历史帧、相同实时 shadow 输入和相同 fresh-reset 分布上与它比较，但它自身不享有安装资格。

## 最值得提取的代码边界

### 1. Checkpoint 与离线回放边界

`ACTCheckpointArtifact` 校验七个必要文件并对各文件 SHA-256 汇总；`LeRobotACTOfflinePolicy` 使用本地 strict load，恢复保存的 preprocessor/postprocessor，并拒绝错维度、非有限值和错误图像范围。`replay_act_checkpoint.py` 同时报告原始动作、显式手部投影动作、完整目标验证、推理延迟和动作连续性。[S1][S2]

这套机制应改造成后端无关的 `PolicyArtifact + OfflineReplay` 接口。应保留 artifact digest、输入 schema、输出 schema、normalizer、运行环境和诊断报告；删除 ACT 专属的类名和固定 100-step 假设。

### 2. 观察事实边界

`ACTCameraFrame` 已经显式区分硬件采集时间与主机接收时间；相机集合与 G1 state envelope 也有独立的完整性和时间窗检查。这些结构比具体传输方式更有价值，应当保留。[S3][S4]

但当前 `ACTLiveObservationBuffer.next_observation()` 把 `camera_time_basis` 固定为 `read_completed`。这可以作为过渡性的低延迟选择规则，不能被新契约描述成严格的 capture-time 同步。新系统要么接入可靠的采集时刻，要么在 episode 中诚实记录 `time_origin=host_receive`，并把同步不确定性作为诊断字段，而不是伪装成精确时间。[S4]

### 3. 唯一真机写入边界

旧脚本已经证明一个有用的最小模式：策略只产生候选；`HandPair` 是进程内唯一 BrainCo 写入对象；G1 手臂由单一 writer 发出；发送前统一经过关节范围、速度、加速度和单步变化约束；发送后记录实际反馈。[S5][S6]

应复用这个边界，不应复用整个 `run_g1_act_pilot.py`。新实现只需要保留：

- 26D canonical joint order 与单位转换；
- 单一 arm/hand writer；
- 关节位置、速度、加速度和手部单步变化限制；
- 新鲜度、非有限值、反馈异常时停止当前动作；
- `candidate → limited_command → measured_feedback` 三条动作流。

旧脚本的协议版本、固定 15 秒时长、checkpoint 白名单、密集 preflight、站立接管流程和特定 warning 阈值都是一次 pilot 的现场实现，不是平台接口。

## 与新任务契约的兼容性缺口

下面只相对当前已经确定的范围判断：固定设备和工作台，允许日常位置/光照/初始姿态变化；人可做物理复位但不提供训练标签；安全只防止突然的大幅运动、自碰撞或撞坏设备，边界内效率优先。

| 契约面 | 旧资产现状 | 新系统必须补齐 |
|---|---|---|
| 任务后置条件 | 训练视频中盖子会打开，但数据和轨迹没有机器可读结果字段 | 明确定义“按键触发并使盖子进入 open”为任务结果；执行完成与任务成功分开 |
| reset | episode 从闭盖开始，但没有独立 reset artifact 或初始状态验收 | 每回合记录 reset 后图像、设备状态和机器人初始状态；人工只负责物理复位 |
| 环境分布 | 单设备、近固定背景与照明，只有有限视角/位置漂移 | 为验收集显式采样日常位置、照明和初始姿态变化；旧 59 段只算历史分布 |
| 观察 schema | 四路固定 `480×640` RGB + 26D state，在线时间基准是接收完成时刻 | 新候选契约允许声明所需视角；必须记录相机身份、mount/calibration revision、time origin 和同步误差 |
| 动作 schema | 14 臂关节 + 12 手关节位置，单位主要靠代码约定 | 版本化每个通道的名称、单位、方向、范围、频率和保持语义；候选不能只交匿名 26 数组 |
| 执行安全 | 旧 pilot 含大量特定门槛和授权流程 | 只抽取防突然运动和撞击所需的关节/工作空间/速度/加速度/反馈约束；阈值重新实测，不继承旧常量 |
| 动作血统 | pilot trace 有 candidate、command、feedback，但训练数据没有，且报告未绑定任务结果 | 新 EpisodeArtifact 将候选、限制后命令、反馈、限制事件和结果判定放在同一回合身份下 |
| 评估拆分 | ACT 无 held-out；VLA 转换有 tail split；WMA run 无验证 loader | 先冻结按采集批次/布置分组的 train/validation/test；禁止用旧全量训练结果冒充泛化证据 |
| 回滚与安装 | checkpoint digest 存在，但没有 skill contract、fresh-reset 证据和 rollback manifest | checkpoint 只能作为候选 artifact；通过新契约验收后再包装成技能版本 |

## 对后续设计票的约束

本审计给后续决策留下五条明确边界：

1. **不要从零重新发明硬件数据面。** 先迁移并缩小旧相机、状态和 BrainCo/G1 适配层，再对照新契约补字段。
2. **不要把旧 ACT 当默认 actor。** 它必须与程序化按压原语、后续 VLA 或其他候选走同一输入、执行和结果判定协议。
3. **不要重新训练 ACT 作为第一动作。** 先用冻结 50k checkpoint 做离线、shadow 和一次受控 fresh-reset 基线，得到独立结果判定和动作血统；证据指向模型问题时才决定是否训练。
4. **不要丢弃 148 段数据，也不要高估它。** 原始 LeRobot v3 是权威来源；HDF5/RLDS 是可再生派生物；任何新训练都必须使用新冻结的分组拆分和数据 manifest。
5. **不要把 WMA 1,000-step checkpoint 纳入 0→1 路线。** 它最多是未来的离线候选排序实验；在 held-out 上证明能区分好坏动作以前，没有真机投票权。

## 验证记录

- 代码结构使用 codebase-memory 项目 `home-loongge-Vegapunk`，generation `2026-08-25T05:03:24Z`，Tier 2 verification；所有引用代码路径的 coverage 检查均为 `no_recorded_issue`。索引 metadata 的 ignored-file 记录被截断，因此二进制模型、数据、未索引视频和 Markdown 结论均以直接文件检查为准。
- `ACTCheckpointArtifact` 重新计算得到 digest `2b66cca2c8ec2bf8`，与真机脚本及九个轨迹一致。
- 离线回放命令在本机 LeRobot 环境成功运行：

  ```bash
  PYTHONPATH=/home/loongge/Vegapunk \
    /home/loongge/miniconda3/envs/lerobot/bin/python \
    /home/loongge/Vegapunk/scripts/replay_act_checkpoint.py \
    --checkpoint /mnt/data-hdd/unifolm-vla/act-training/act-open-20260821-b16-50k-v5/checkpoints/050000/pretrained_model \
    --dataset-root /mnt/data-hdd/unifolm-vla/datasets/oilpressure-open-0308 \
    --dataset-index 0 --dataset-index 282 --dataset-index 540 --device cpu
  ```

- 相关单元测试使用基础 Python 环境运行：`61 passed in 0.36s`。LeRobot 环境本身未安装 pytest，但不影响实际 checkpoint 加载与推理验证。

## 证据来源

### 新目标

- **[L1]** `/home/loongge/Shaka/self-evolving-embodied-intelligence-architectural-blueprint.md:4-9, 31-32, 188-196, 355-363`：黄色按钮目标、ACT 诊断基线定位、执行完成与任务成功的区分。
- **[L2]** `/home/loongge/Vegapunk/docs/research/2026-08-24-unifolm-vla-vs-wma-current-project.md:153-186, 317-322`：公开 UniFoLM 动作契约与 BrainCo26 的差异及建议边界。

### 数据与转换资产

- **[D1]** `/mnt/data-hdd/unifolm-vla/datasets/{oilpressure-open-0308,oilpressure-move-forward-0319,oilpressure-move-back-0319,oilpressure-close-0320}/meta/info.json` 与 `meta/episodes/chunk-000/file-000.parquet`：episode、frame、fps、相机和 26D schema。
- **[D2]** `/mnt/data-hdd/unifolm-vla/datasets/oilpressure-open-0308/videos/observation.images.cam_left_high/chunk-000/file-000.mp4`：黄色按钮按压、盖子打开及抽样初始场景。
- **[D3]** `/home/loongge/Vegapunk/docs/research/2026-08-24-unifolm-vla-vs-wma-current-project.md:4-5, 57-63`：四阶段数据总量与非连续流程边界。
- **[V1]** `/mnt/data-hdd/unifolm-vla/brainco26-vla-full/split_manifest.json`，SHA-256 `cbbee8d0f34a93bb3788eedf4f697dc68f235aeaac29d7da6983873627055d56`。
- **[V2]** `/mnt/data-hdd/unifolm-vla/brainco26-vla-full/conversion_summary.json` 及 `rlds/rlds_brainco26/1.0.0/dataset_info.json`：148 个 HDF5、119/29 split 和 RLDS shards。

### ACT 模型、代码与运行证据

- **[C1]** `/mnt/data-hdd/unifolm-vla/act-training/act-open-20260821-b16-50k-v5/checkpoints/050000/pretrained_model/{config.json,train_config.json,model.safetensors,policy_*}`：模型 I/O、训练数据、训练步数及权重。
- **[C2]** `/mnt/data-hdd/unifolm-vla/act-training/logs/act-open-20260821-b16-50k-v5.log`：训练过程和 checkpoint 序列；未出现独立验证指标。
- **[S1]** `/home/loongge/Vegapunk/vegapunk/operation/act_offline.py:37-111, 115-146, 163-258, 261-406`：ACT schema、artifact digest、手部动作解码、目标映射和 strict load。
- **[S2]** `/home/loongge/Vegapunk/scripts/replay_act_checkpoint.py:147-311`：离线诊断输出与无执行权限语义。
- **[S3]** `/home/loongge/Vegapunk/vegapunk/operation/act_camera_frame.py:50-95, 158-278`；`act_camera_observation.py:54-175`：相机帧和多相机完整性契约。
- **[S4]** `/home/loongge/Vegapunk/vegapunk/operation/g1_state_envelope.py:34-61, 183-260`；`act_live_observation.py:159-216`：原子状态、相机配对及实际 `read_completed` 时间基准。
- **[S5]** `/home/loongge/Vegapunk/scripts/run_g1_act_pilot.py:888-1070, 1247-1342, 1666-2165`：反馈保护、唯一手部 writer、单位转换、速度/加速度/单步限制和执行记录。
- **[S6]** `/home/loongge/Vegapunk/vegapunk/operation/g1_dds_feedback.py:14-54`；`scripts/probe_g1_brainco_hand.py:91-154, 157-210, 270-423`：G1/BrainCo feedback 与单关节 commissioning。
- **[S7]** `/home/loongge/Vegapunk/vegapunk/embodied/act_candidate.py:446-517, 618-680`：简化训练器的动作模板平均与图像摘要 residual 实现。
- **[T1]** `/home/loongge/Vegapunk/.scratch/g1-act-pilot-traces/*.json`：九次 v1–v14 真机轨迹、checkpoint digest、中止原因、执行完成和限制器统计。
- **[R1]** 本审计的三帧 CPU 离线回放输出，命令见“验证记录”。

### 其他模型资产

- **[A1]** `/mnt/data-hdd/unifolm-vla/models/{UnifoLM-VLA-Base,Unifolm-VLM-Base,UnifoLM-WMA-0-Base}`：本地基础权重目录。
- **[W1]** `/home/loongge/wma-training/runs/oilpressure-sim-26d-1000-action-only-v11/configs/model.yaml`，SHA-256 `24774b1b9461ad872f850fc7cdd71f3d6b40763e473e9a2b6881cf24071a768d`；同目录训练日志与 `epoch=6-step=1000.ckpt`。

## 限制

- 本审计没有执行新的真机动作，也没有根据视频替旧轨迹补写成功标签；这样可以避免把研究者推断伪装成历史事实。
- 对 59 个黄色按钮 episode 的场景变化判断来自元数据与七个分散 episode 的首帧抽样，不是逐帧全量视觉聚类。因此可以肯定“尚无覆盖证据”，不能声称数据完全没有任何光照或位置变化。
- Vegapunk 工作树当前包含大量未提交的具身代码和研究文档；本审计引用的是 2026-08-25 当地文件状态，而不是仅引用 HEAD `c9b41d843f5a6d302bd988aff082d00c4d943e04`。后续真正迁移前应先冻结来源 commit 或生成 source manifest。
