# 固定工作台黄色按钮任务：候选技术路线证据审计

> 调研日期：2026-08-25  
> 决策问题：对于 Unitree G1、BrainCo 灵巧手、四路相机且没有遥操作设备的固定工作台任务，程序化视觉与运动原语、ACT 复用、UniFoLM-VLA 适配、有界残差强化学习分别成熟到什么程度，集成成本在哪里？

## 结论

首个黄色按钮技能应以**程序化视觉定位、一次性几何标定、受约束运动规划和参数化按压动作**为主路线。它是唯一不以新的示范数据或大规模在线交互为前提，并且能把感知、几何、运动控制和接触失败分别诊断的路线。

另外三条路线不应并列竞争主路线：

1. **ACT 复用是低成本诊断支线。** 官方 Unitree LeRobot 已同时支持 ACT 训练、G1 真机推理和 BrainCo 末端执行器，因此“G1 + BrainCo 完全没有 ACT 部署基础”并不成立。但 ACT 的公开证据建立在每项任务 50 条成功遥操作示范上；现有 checkpoint 只有通过观测、动作、频率和归一化契约核对后才有复用价值。
2. **有界残差强化学习是接触阶段的条件升级。** 残差强化学习在真实接触装配上有实验依据，但原始结果约需 8,000 个环境步、约 3 小时，并不是“数十回合即可”的证据。RLPD 又明确假设存在离线先验数据。只有程序化路线已经稳定到达按钮、失败集中在最后接触阶段、奖励和复位可靠时，才值得启用。
3. **UniFoLM-VLA 暂不适合首技能。** 官方已经发布训练代码、推理代码、约 19 GB 权重和 G1 数据，但公开部署链针对 G1 + Dex1，公开训练数据也是双臂夹爪数据；仓库没有论文或可复核的任务级成功率。适配 BrainCo、当前四相机布局和黄色按钮任务仍需要新数据、动作接口改造与大规模微调。

这不是对算法潜力的排序，而是对**当前任务达到首次可复现成功所需新增证据和集成工作的排序**。

## 证据强度说明

- **已证实**：第一手论文、官方仓库或官方数据直接支持。
- **工程推断**：由已证实接口和当前约束推导，但尚未在本项目硬件上验证。
- **未验证假设**：缺少当前设备、场景或 checkpoint 的测量数据，不能用于承诺样本量或成功率。

## 路线比较

| 路线 | 公开实现与成熟度 | 对数据/交互的要求 | 与当前硬件的距离 | 本项目角色 |
| --- | --- | --- | --- | --- |
| 程序化视觉 + 几何 + 运动原语 | Grounding DINO、SAM 2、OpenCV、Unitree SDK 和 BrainCo DDS 服务均有官方代码；但组合后的按钮技能是本项目集成件 | 可从 0 条训练样本开始；需要一次性相机与机器人标定以及少量真机校准回合 | G1 和 BrainCo 控制接口已有；四路相机的内外参、同步、是否含深度仍未知 | **主路线** |
| ACT 复用 | ACT 原始实现为 MIT；Unitree LeRobot 已支持 ACT、G1 和 BrainCo；现有 checkpoint 内容未提供 | 公开 ACT 真机实验每任务 50 条成功遥操作示范；复用 checkpoint 可免重采集的前提是契约同构 | 部署支撑存在，但 checkpoint 的相机顺序、动作维数、关节顺序、频率和归一化未知 | **先做离线兼容性审计的诊断基线** |
| UniFoLM-VLA 适配 | 官方代码和权重已发布，但仓库年轻、无正式 release、无论文；模型权重为 CC BY-NC-SA 4.0 | 官方单任务 G1 数据示例为 200 回合；自定义任务需要 RLDS 数据与微调，官方脚本示例使用 8 个进程、150,000 训练步 | 官方数据/部署以 Dex1 夹爪为主，BrainCo 6 自由度手和当前相机布局需要适配 | **跨技能阶段挑战者，不进入 0→1 主线** |
| 有界残差 RL / RLPD | 残差 RL 有真机接触装配论文；RLPD 有 MIT 代码和基准；SERL 有真机软件但以 Franka、RealSense、SpaceMouse 为中心且已标记弃用 | 需要可用的标称控制器、奖励、复位和在线交互；RLPD 还需要离线先验数据 | 需要新建 G1 Gym 环境、动作投影、奖励、复位和 actor/learner 接口 | **仅在接触动力学成为主失败后启用** |

## 1. 程序化视觉、三维定位与运动原语

### 已证实的能力

Grounding DINO 是文本提示驱动的开放集目标检测器，官方实现输出候选框及文本相似度；它不是关键点检测器，也不输出机器人坐标。[Grounding DINO 官方仓库](https://github.com/IDEA-Research/GroundingDINO)提供 Apache-2.0 代码和 checkpoint，最新 GitHub release 仍标为 `v0.1.0-alpha2`。[Grounding DINO releases](https://github.com/IDEA-Research/GroundingDINO/releases)

SAM 2 提供图像和视频中的提示式分割、checkpoint、训练代码与推理接口，代码为 Apache-2.0。[SAM 2 官方仓库](https://github.com/facebookresearch/sam2) 因而可以把检测框细化为按钮区域，但“区域中心等于可按压点”“分割轮廓可以给出表面法向”都不是 SAM 2 保证的能力。

OpenCV 官方标定文档提供相机内参、畸变和外参估计；`triangulatePoints` 提供双视图三角化。[OpenCV camera calibration](https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html) [OpenCV triangulation API](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html) 这些工具能完成坐标恢复，但前提是视图已标定、时间同步、目标对应关系可靠。仅知道“有四路相机”不足以证明可直接恢复毫米级接触点。

G1 的官方 Python SDK 已包含 5/7 自由度手臂动作接口和低层控制示例。[Unitree SDK2 Python：G1 examples](https://github.com/unitreerobotics/unitree_sdk2_python/tree/master/example/g1) Unitree 也提供 BrainCo Revo2 服务，把每只手的串口控制转换为 DDS 命令与状态主题，手指位置和速度归一化到 `[0, 1]`。[Unitree BrainCo hand service](https://github.com/unitreerobotics/brainco_hand_service)

### 成熟度与许可证

- Grounding DINO、SAM 2 和 OpenCV 都是可直接调用的成熟基础组件，许可证明确；Grounded-Segment-Anything 本身只是把检测与分割组合起来，不能替代标定、机器人坐标变换、IK、轨迹生成和接触验证。
- Unitree 的 G1 与 BrainCo 控制代码证明硬件接口存在，但不证明对当前机器固件、网络接口和相机配置即插即用。
- 在本次审阅到的官方公开项目中，没有一个仓库能够端到端完成“看见黄色按钮并由 G1 + BrainCo 按下”。真正的工作量集中在接口组合和真机校准，而不是训练模型。

### 样本需求

**已证实：**上述预训练视觉模型不要求为黄色按钮先采集训练集；几何方法要求标定观测，不是任务示范。

**工程推断：**固定设备和工作台下，可以先尝试更小的视觉方案：黄色颜色分割或模板定位，加工作平面标定；只有在反光、遮挡或背景干扰使其不稳定时，再引入 Grounding DINO + SAM 2。是否可行必须用当前四路相机的图像验证，不能从“按钮是黄色的”直接推出。

**未验证假设：**一次性标定后，二维按钮中心能够以足够精度映射到机器人基坐标；BrainCo 某一手指预置形态能在不探索全部手指自由度的情况下可靠按压；G1 当前控制接口能稳定跟踪所需的小幅笛卡尔运动。

### 必须补齐的集成件

1. 四路相机清单、分辨率、帧率、同步方式、内参与相对 G1 基座的外参；若没有深度，决定采用已知工作平面投影还是标定双目。
2. 从按钮区域到接触点、接近方向和安全撤离方向的确定规则。
3. G1 正/逆运动学、关节限位、速度/加速度限制及轨迹跟踪接口。
4. BrainCo 手指预置和按压阶段的动作接口；按钮按压本身不需要让六个手指自由度进入搜索空间。
5. 在真机控制入口中记录原始目标、投影后命令和关节反馈，以区分视觉、规划和跟踪错误。

## 2. ACT checkpoint 复用

### 已证实的能力

ACT 原论文在 ALOHA 双臂平台上使用四路 RGB 相机和关节位置，以 50 Hz 采集与控制；六个真机任务各采集 50 条成功遥操作示范，每项任务约 10–20 分钟数据、30–60 分钟墙钟采集时间。[ACT 论文](https://arxiv.org/abs/2304.13705) 原始代码为 MIT，支持仿真与 ALOHA 真机，但没有 G1 或 BrainCo 适配。[ACT 官方仓库](https://github.com/tonyzhaozh/act)

关键的新证据是 Unitree 的官方 `unitree_lerobot`：

- 支持把 `Unitree_G1_Brainco` 数据转换为 LeRobot 格式；
- 给出 ACT 训练命令；
- 真机评估脚本的末端执行器参数明确包含 `brainco`；
- 仓库 v0.2 说明新增 BrainCo 数据转换和模型部署支持。

来源：[Unitree LeRobot 官方仓库](https://github.com/unitreerobotics/unitree_lerobot)

因此，ACT 到 G1 + BrainCo 的底层适配不是从零开始；主要未知量转移到了**当前 checkpoint 是否与当前观测和动作契约一致**。

### 样本与硬件假设

ACT 是行为克隆方法。公开的高成功率结果依赖成功示范，不支持“无示范、只靠失败回合自行学会”的主张。当前项目没有遥操作设备，因此若现有 checkpoint 不可复用，就缺少与论文一致的数据来源。

现有 checkpoint 需要逐项核对：

1. 训练时机器人型号、G1 自由度模式和 BrainCo 型号；
2. 四路图像的相机身份、排序、分辨率、裁剪和归一化；
3. observation/state 与 action 的维度、关节顺序、单位和绝对/增量语义；
4. 控制频率、action chunk 长度和时间聚合设置；
5. 黄色按钮是否在训练任务、场景和动作分布内；
6. checkpoint 所依赖的 LeRobot/ACT 代码版本。

任何一项不一致都可能让 checkpoint 正常加载却输出无意义动作。因此验证顺序应为：读取元数据与训练配置 → 离线数据回放 → 只计算不下发的影子推理 → 受限真机测试。

### 成熟度与许可证

ACT 原始仓库许可证为 MIT，但没有 tagged release，提交活动也有限；更实际的部署基础是仍在更新的 Unitree LeRobot。Unitree LeRobot 顶层 `LICENSE` 为 Apache-2.0，并明确要求分别核查 LeRobot 和 Unitree DDS Wrapper 等上游依赖的许可证。[Unitree LeRobot license](https://github.com/unitreerobotics/unitree_lerobot/blob/main/LICENSE)

### 未验证假设

- 当前已有 ACT checkpoint 来自同一台 G1、同一 BrainCo 手、同一四相机布局和黄色按钮数据。
- checkpoint 即使任务不同，也能作为黄色按钮策略初始化；ACT 原论文没有提供这种跨任务迁移证据。
- 程序化成功轨迹可以直接替代人类示范进行 ACT 巩固。算法上可以训练，但需要本项目实验证明数据覆盖和闭环鲁棒性。

## 3. UniFoLM-VLA 适配

### 已证实的公开资产

Unitree 于 2026-01-29 发布 UniFoLM-VLA-0 的训练代码、推理代码和 checkpoint；仓库说明基于 CUDA 12.4、Python 3.10，并支持自定义 LeRobot v2.1 数据转 HDF5 再转 RLDS。[UniFoLM-VLA 官方仓库](https://github.com/unitreerobotics/unifolm-vla)

官方基础模型 checkpoint 文件约 18.98 GB，模型权重许可证为 CC BY-NC-SA 4.0，禁止商业使用且派生物需要相同许可证。[UniFoLM-VLA-Base 模型页](https://huggingface.co/unitreerobotics/UnifoLM-VLA-Base) 代码仓库没有顶层 `LICENSE` 文件，而 `pyproject.toml` 声明 BSD-3-Clause；这使代码授权的表达不完整，部署前应向维护方确认。

官方 G1 堆叠数据集包含 200 个回合、93,131 帧、30 Hz、四路 640×480 RGB 视频，硬件为 G1 双臂和夹爪；数据卡还要求实际场景尽量匹配数据第一帧。[G1 Dex1 Stack Block 数据集](https://huggingface.co/datasets/unitreerobotics/G1_Dex1_Stack_Block)

训练示例使用 8 个 `accelerate` 进程、每进程 batch size 6、最多 150,000 步；这些是官方示例配置，不是黄色按钮任务的最低要求。[UniFoLM training script](https://github.com/unitreerobotics/unifolm-vla/blob/main/scripts/run_scripts/run_unifolm_vla_train.sh)

### 证据缺口

截至调研日期，官方仓库只有自引格式，没有论文链接；arXiv 以 `UniFoLM` 搜索不到论文。仓库声称单一策略完成 12 类真机任务，但没有公开每任务成功率、试验次数、基线或消融。因此这项能力应记为**厂商第一方演示主张**，不能当作可复核性能指标。

公开常量显示 G1 joint policy 为 16 维 action/proprio，G1 end-effector policy 为 23 维；这与 BrainCo 双手各 6 个归一化手指自由度并非显然同构。[UniFoLM G1 constants](https://github.com/unitreerobotics/unifolm-vla/blob/main/src/unifolm_vla/rlds_dataloader/constants.py) 官方真机部署文档指向 G1 + Dex1 服务，没有给出 BrainCo 运行范例。[UniFoLM deployment guide](https://github.com/unitreerobotics/unifolm-world-model-action/tree/main/unitree_deploy)

### 集成成本

1. 建立当前四相机、G1 状态和 BrainCo 动作到 UniFoLM 输入/输出的明确映射。
2. 采集黄色按钮任务数据并转为 RLDS；没有证据支持零任务数据直接成功。
3. 确定冻结骨干、小适配层或全量微调策略；官方脚本没有“小适配头即可”的承诺。
4. 建立服务器推理延迟、网络故障和动作 chunk 中断策略。
5. 处理 CC BY-NC-SA 4.0 模型权重对未来用途的限制。

**未验证假设：**UniFoLM 的语义预训练能让黄色按钮任务所需数据显著少于 ACT；当前没有同任务、同硬件的对照实验支持这一判断。

## 4. 有界残差强化学习与 RLPD

### 已证实的能力

残差强化学习把固定的标称控制器与学习到的动作修正相加。2018 年的真机研究在 Sawyer 接触装配任务上，用手工控制器加 TD3 残差，在约 8,000 个环境步、约 3 小时内学会稳健插入；从仿真策略初始化时，论文报告不到 1,000 步即可解决该实验设置。[Residual Reinforcement Learning for Robot Control](https://arxiv.org/abs/1812.03201)

这证明了“接触控制器上学习小修正”可以在真机成立，但没有证明 G1 黄色按钮只需数十回合。论文使用相机估计物块状态、力/力矩观测、密集几何奖励和 Sawyer 阻抗控制器；这些条件与当前系统不同。

RLPD 的核心是在线 off-policy RL 与固定离线数据缓冲区对称采样；论文明确研究的是“用先验离线数据加速在线学习”，而不是无数据启动。[RLPD 论文](https://arxiv.org/abs/2302.02948) 官方 MIT 代码主要提供 D4RL、Adroit 和 V-D4RL 基准脚本，其中 Adroit 示例配置最高运行 1,000,000 环境步。[RLPD 官方仓库](https://github.com/ikostrikov/rlpd)

SERL 把 RLPD 风格的 actor/learner、视觉策略和真机环境组织成软件套件，但官方代码面向 Franka、Robotiq、RealSense 和 SpaceMouse。其最小 peg insertion 指南要求 20 条 SpaceMouse 示范，宣称固定复位时可在约 30 分钟收敛；仓库同时明确标记已弃用并推荐 HIL-SERL。[SERL 官方仓库](https://github.com/rail-berkeley/serl) [SERL real-robot guide](https://github.com/rail-berkeley/serl/blob/main/docs/real_franka.md)

### “有界”不是 RLPD 自带能力

RLPD 和残差 RL 论文都不自动提供本项目要求的动作安全边界。必须由机器人执行层另行实现，例如：

- 只在接近完成后的短接触阶段启用残差；
- 将学习输出限制在低维笛卡尔位移、速度或受控接触参数，而不是全部 G1 和手指关节；
- 对残差做幅值、变化率、工作空间和关节约束投影；
- 无论策略如何在线更新，都不能绕过最终执行层。

这些是**工程设计要求**，不是现有 RLPD 代码已经验证的特性。

### 启用条件

只有同时满足以下条件，残差 RL 才比继续调运动原语更有价值：

1. 程序化策略能稳定识别按钮并到达正确接触前位姿；
2. 失败证据集中在接触深度、方向、速度、保持时长或小范围顺应性；
3. 标称策略已有非零成功率，或者存在可靠的自动几何进度奖励；
4. 成功判定在训练频率上足够稳定，误判不会成为学习捷径；
5. 每回合复位可重复，且人工复位吞吐量能够支撑预期交互规模；
6. 已积累的程序化回合能作为 RLPD 的离线先验数据，或明确改用不依赖离线数据的算法。

### 未验证假设

- 程序化轨迹产生的失败和少量成功数据足以替代 RLPD/SERL 文献中的人类示范。
- 仅靠任务终点的稀疏视觉奖励就能在当前复位预算内训练成功。
- G1 的位置控制与 BrainCo 电流/状态反馈足以替代论文中的阻抗控制和力/力矩观测。
- “毫米级残差”既覆盖真实接触误差，又不会因为限幅过小而无法改变结果。该范围必须从接触失败数据估计。

## 推荐的验证顺序

### 立即进行：不下发真机动作的证据检查

1. **ACT checkpoint 契约审计**：读取 checkpoint 配置、训练数据 schema 和 normalization statistics，与当前 G1/BrainCo/四相机接口逐字段比较。若不匹配，保留为历史诊断资料，不投入重训。
2. **相机能力清单**：记录每路相机是否有深度、内参、外参、硬件同步和稳定可见范围。这个结果决定二维工作平面映射是否足够，还是需要双目/多视图三维。
3. **控制接口最小测试**：验证 G1 手臂和 BrainCo 单指预置能否通过统一控制入口做小幅、平滑、可中止运动。

### 首次成功主线

按最小复杂度递增：颜色/模板定位 → 必要时 Grounding DINO + SAM 2 → 标定工作平面或三角化 → 受约束 IK → 接近、按压、保持、撤离原语。每次只改变一个可归因参数。

### 条件升级

- 若视觉在允许的光照与位置变化下失效，才增加开放词汇检测/分割或采集少量标定图像训练专用检测器。
- 若正确到达但接触结果不稳定，先扫描少量按压深度、速度和保持时间；只有固定参数无法覆盖变化时，再建立低维有界残差 RL。
- 当系统已经自生成足够多的成功轨迹时，再比较 ACT 巩固与 UniFoLM-VLA 适配的速度、抗扰动和第二技能复用收益。

## 对蓝图中关键主张的裁决

| 蓝图主张 | 裁决 |
| --- | --- |
| 程序化候选可用 0 条任务训练样本启动 | **有条件成立。** 预训练视觉和几何控制不要求示范，但仍需标定和真机校准；首次成功回合数未知。 |
| GroundedSAM 能直接给出 3D 关键点和法向 | **不成立。** 它提供检测/分割；3D、法向和机器人坐标变换需要额外传感与几何。 |
| ACT 只是遥远的 ALOHA 候选 | **需要修正。** Unitree 官方已有 G1 + BrainCo 的 LeRobot/ACT 训练与部署支撑；真正问题是 checkpoint 契约和任务数据。 |
| 有界残差 RLPD 只需数十至百回合 | **未被证实。** 真机残差 RL 有约 8,000 步/3 小时证据；SERL 快速结果依赖 20 条遥操作示范和不同硬件。 |
| UniFoLM-VLA 是 G1 原生、加小适配头即可 | **前半句部分成立，后半句未证实。** 官方数据与部署支持 G1，但以 Dex1 为主；小适配头、BrainCo 和黄色按钮样本量没有公开证据。 |
| UniFoLM-VLA 适合作为首技能主路线 | **不支持。** 任务级评测缺失、模型与训练成本高、动作与硬件适配未完成。 |

## 最终决策建议

把四条路线改成一个有条件的决策树，而不是固定流水线：

1. 程序化路线负责获得第一次可复现成功。
2. ACT checkpoint 先做完全离线的兼容性审计；只有契约高度同构时才进入影子推理和真机基线。
3. 残差 RL 只修复已经被证据定位为接触动力学的问题，不参与视觉搜索、长程接近或整手探索。
4. UniFoLM-VLA 推迟到有自生成数据和第二技能需求后，用严格对照实验判断其跨任务收益。

这一路线保留了未来学习能力，但不会让未经验证的基础模型或强化学习样本效率阻塞黄色按钮的 0→1。
