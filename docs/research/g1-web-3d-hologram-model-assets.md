# G1 Web 3D 全息投影：模型资源与实时姿态边界调查

研究日期：2026-08-27
范围：为当前 Web 端的 `OBSERVATION FIELD` 静态示意寻找可替换的、真实 G1 外观模型；不下载、不引入任何资产，也不改变产品代码。

除非另行说明，本文件中每个外部链接均于 **2026-08-27** 访问。这里的“官方”指资源由 Unitree Robotics 官方网站或其 GitHub / Hugging Face 账号发布；第三方平台中的 G1 模型不会因为名称含有 Unitree 而自动获得官方真实性或品牌授权。

## 结论

可以做出真实 G1 外观的 WebGL 全息投影，但**现在不应把它说成实时姿态复现**。

推荐的技术基准是 Unitree 官方 [`unitree_rl_gym` 的 `g1_29dof_rev_1_0` URDF + 分段 STL 模型](https://github.com/unitreerobotics/unitree_rl_gym/tree/main/resources/robots/g1_description)：其 README 明确将该 29 DoF 版本标为 “Up-to-date”，并同时提供 URDF、MJCF、关节层级和视觉网格；整个仓库明确采用 BSD-3-Clause。它不是现成 GLB，也没有贴图包，因此需要一次**离线、可审计的转换/优化**，但许可与机构学信息最清楚。 [G1 描述 README](https://github.com/unitreerobotics/unitree_rl_gym/blob/main/resources/robots/g1_description/README.md) · [模型目录](https://github.com/unitreerobotics/unitree_rl_gym/tree/main/resources/robots/g1_description) · [BSD-3-Clause](https://github.com/unitreerobotics/unitree_rl_gym/blob/main/LICENSE)

Unitree 的官方 `unitree_model` / Hugging Face 数据集还提供更重的 G1 29 DoF USD（根 USD、base、physics、sensor 四层；base 文件约 28.3 MB），很可能值得作为外观质量的**候选/参照**，但该 Hugging Face 数据集没有发布 license card 或 LICENSE；旧 GitHub 仓库虽是 BSD-3-Clause，却明确称已废弃并把后续更新转向 Hugging Face。因此不能把旧仓库许可证自动推断为这套新 USD 的可商业嵌入许可；在获得 Unitree 书面确认前，不建议把 USD 或其转换出的 GLB 打进产品。 [官方旧仓库 README（废弃与迁移声明）](https://github.com/unitreerobotics/unitree_model/blob/main/README.md) · [旧仓库 BSD-3-Clause](https://github.com/unitreerobotics/unitree_model/blob/main/LICENSE) · [官方 Hugging Face G1/29DoF 目录](https://huggingface.co/datasets/unitreerobotics/unitree_model/tree/main/G1/29dof/usd/g1_29dof_rev_1_0) · [数据集卡 API（`cardData: null`）](https://huggingface.co/api/datasets/unitreerobotics/unitree_model)

在检查的 Unitree 官方公开资源中，**没有找到明确发布、且可直接合法嵌入 Web 的 G1 `.glb` / `.gltf`**。官方目录列出的是 USD，或 URDF/MJCF 加 STL；这是对已审查的官方资源范围的结论，不是对整个互联网的全称断言。 [官方 USD 目录](https://huggingface.co/datasets/unitreerobotics/unitree_model/tree/main/G1/29dof/usd/g1_29dof_rev_1_0) · [官方 MJCF/STL 目录](https://github.com/unitreerobotics/unitree_mujoco/tree/main/unitree_robots/g1) · [官方 URDF/STL 目录](https://github.com/unitreerobotics/unitree_rl_gym/tree/main/resources/robots/g1_description)

## 已验证资源清单

| 资源 | 发布者与实际 URL | 格式 / 完整性 | Web 转换成本 | 许可与商业使用判断 | 结论 |
| --- | --- | --- | --- | --- | --- |
| **首选：G1 29DoF rev 1.0 机构学模型** | Unitree 官方：[`g1_29dof_rev_1_0.urdf`](https://github.com/unitreerobotics/unitree_rl_gym/blob/main/resources/robots/g1_description/g1_29dof_rev_1_0.urdf)、[`meshes/`](https://github.com/unitreerobotics/unitree_rl_gym/tree/main/resources/robots/g1_description/meshes) | URDF + MJCF + 64 个 STL（目录还含预览 PNG）；URDF 定义 link、revolute joint、关节原点、轴与范围。README 称该变体 “Up-to-date”。网格为刚性分件，**不是**一个带蒙皮骨骼的角色 GLB。 [README](https://github.com/unitreerobotics/unitree_rl_gym/blob/main/resources/robots/g1_description/README.md) · [URDF](https://github.com/unitreerobotics/unitree_rl_gym/blob/main/resources/robots/g1_description/g1_29dof_rev_1_0.urdf) | **中**：离线把 STL 转为一个以 URDF 关节树父子关系组织的 GLB；保留分件与 pivot，不能简单合并成单网格。Three.js 的 `GLTFLoader` 是运行时目标，`STLLoader` 只适合逐件读取，不是最终交付格式。 [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) · [STLLoader](https://threejs.org/docs/pages/STLLoader.html) | 官方仓库为 BSD-3-Clause：允许以源/二进制形式再分发与修改，需保留版权和免责声明，且不得用 Unitree 名称暗示背书。产品应放入第三方许可证清单。仓库含 `logo_link.STL`；是否在商业 UI 中展示该标识不由模型 README 单独解释，导出前应与 Unitree 确认或移除该零件。 [许可证](https://github.com/unitreerobotics/unitree_rl_gym/blob/main/LICENSE) | **推荐**。是当前可证实的最稳妥技术/许可证起点；先核对真机 DoF/手型，再锁定具体 URDF 变体。 |
| **官方 MuJoCo G1 29DoF 模型** | Unitree 官方：[`g1_29dof.xml`](https://github.com/unitreerobotics/unitree_mujoco/blob/main/unitree_robots/g1/g1_29dof.xml)、[`meshes/`](https://github.com/unitreerobotics/unitree_mujoco/tree/main/unitree_robots/g1/meshes) | MJCF + 60 个 STL。XML 明确列举 mesh，按 body/joint 组装并以 RGBA 指定深灰/浅灰；资产目录没有 PBR 贴图文件。因此它有真实分件与关节层级，但**没有证据表明有 UV/PBR 纹理或角色蒙皮骨骼**。 [模型 XML](https://github.com/unitreerobotics/unitree_mujoco/blob/main/unitree_robots/g1/g1_29dof.xml) · [目录](https://github.com/unitreerobotics/unitree_mujoco/tree/main/unitree_robots/g1) | **中**：与上项相同，要构建关节树/导出 GLB；MJCF 的 physics 属性不应带入 Web 渲染。适合做与 simulator 一致的机械式外观，不是“电影级贴图”来源。 | BSD-3-Clause，条件同上。 [许可证](https://github.com/unitreerobotics/unitree_mujoco/blob/main/LICENSE) | **可用备选**。较适合若项目以 MuJoCo 定义为准；否则优先 `rev_1_0` URDF。 |
| **官方 G1 29DoF USD** | Unitree 官方：[`g1_29dof_rev_1_0.usd`](https://huggingface.co/datasets/unitreerobotics/unitree_model/blob/main/G1/29dof/usd/g1_29dof_rev_1_0/g1_29dof_rev_1_0.usd)、[`g1_29dof_rev_1_0_base.usd`](https://huggingface.co/datasets/unitreerobotics/unitree_model/blob/main/G1/29dof/usd/g1_29dof_rev_1_0/configuration/g1_29dof_rev_1_0_base.usd) | USD。目录元数据列出 root、base、physics、sensor 四文件，base 约 28.3 MB。文件为二进制 USD；本研究未下载或解析其二进制内容，所以**不能声称**它有完整贴图、材质、UV、骨骼或可直接播放的动作。 [目录与大小](https://huggingface.co/api/datasets/unitreerobotics/unitree_model/tree/main?recursive=true&expand=false) | **中到高**：当前 Three.js `USDLoader` 可解析 USD / USDA / USDC / USDZ；但 Unitree 资源是 28 MB 的分层二进制包，本研究未验证 loader 对该包的外部 layer、材质与性能兼容性。生产环境仍宜离线导出并优化 GLB，或先建立可复现的浏览器加载验收。 [Three.js `USDLoader` 源码](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/USDLoader.js) · [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) | **未确认**：当前 Hugging Face 数据集无 license 字段/卡片；不能仅因旧 GitHub 仓库的 BSD 许可就推定新数据集同许可。 | **不推荐现在嵌入**。可向 Unitree 索取 G1 USD/GLB 的书面再分发和商业 Web 展示许可；拿到后再做视觉质量评估。 |
| **第三方 Sketchfab：`Unitree g1 edu u2 (No Rigged bone)`** | 发布页：[`ee7564a618db462ca9e7f7cbfe2ac012`](https://sketchfab.com/3d-models/unitree-g1-edu-u2-no-rigged-bone-ee7564a618db462ca9e7f7cbfe2ac012)；平台元数据：[`API`](https://api.sketchfab.com/v3/models/ee7564a618db462ca9e7f7cbfe2ac012) | 平台报告为可下载、39,840 faces、0 animations，标题明确说 “No Rigged bone”。公开元数据没有给出应在本项目采用的源格式，不能预先承诺会得到 GLB/FBX。 | **未知到中**：必须先按发布页实际下载包检查格式、材质、尺度与关节；无骨骼/零动作意味着仍需自行建机构学。 | 平台元数据标为 CC BY 4.0，且称允许商业使用、要求署名。CC BY 只处理该上传者授予的版权许可；它**不能证明**上传者拥有 Unitree 设计/标识的再许可权，也不能证明模型与现场硬件相同。 [Sketchfab 元数据](https://api.sketchfab.com/v3/models/ee7564a618db462ca9e7f7cbfe2ac012) · [CC BY 4.0 原文](https://creativecommons.org/licenses/by/4.0/legalcode) | **不推荐**。即使可下载和 CC BY，也缺少可验证的出处、关节和真机匹配证明。 |
| **第三方商业候选：`Unirandom G1 Unitree animate.`** | 发布页：[`a4500d272b2c4457a27202b452ccef28`](https://sketchfab.com/3d-models/unirandom-g1-unitree-animate-a4500d272b2c4457a27202b452ccef28)；平台元数据：[`API`](https://api.sketchfab.com/v3/models/a4500d272b2c4457a27202b452ccef28) | 发布者描述声称 Blender/FBX、PBR 4K 贴图、完整 rig、2 个动画；平台元数据同时报告不可下载、无开放 license。此类宣称未经 Unitree 官方验证。 | 若获得正式商业源包，**低到中**：FBX 需离线转 GLB、压缩贴图并测试动画；但高达 617,448 faces 的发布页计数提示需先做移动端/低端 GPU 预算。 | 无开放许可、无可下载包。必须从发布者取得明确的 Web 运行时再分发、商业展示、纹理与品牌/设计权链条；不能把 Sketchfab 预览当作授权。 | **不推荐作为当前资源**。它说明市场上可能有“带材质/绑定”的商业资产，但无法替代 Unitree 授权。 |

## 为什么“真实外观”不等于“实时全息投影”

### 当前页面没有可用的关节姿态合同

当前 G1 页面读取的是 `rt/vegapunk/g1/state_envelope` 的最新到达时间、序号和频率，BMS 汇总字段、三个相机源活性，以及 `rt/lowcmd` 是否已有发布者；桥接输出中没有关节角、根位姿、IMU 姿态或手部状态。桥接代码甚至只校验 state envelope 是否带 `sequence` 与 `assembled_time_ns`，然后将页面使用的流新鲜度封装为快照。因此，现有真实数据足以改变“连接/离线、供电、相机”显示，**不足以让 3D G1 按真机摆姿势**。 [本项目桥接：状态读取与校验](../../scripts/g1_monitor_bridge.py#L153-L205) · [本项目桥接：公开快照字段](../../scripts/g1_monitor_bridge.py#L269-L318) · [本项目视图：实际渲染的监控字段](../../apps/operator-console/src/components/G1MonitorView.tsx#L299-L337)

这也意味着不能以 `rt/lowcmd` 的存在或命令值驱动外观动画：该主题在页面中只用于观察“已有发布者”，而命令不是“实际已到达的关节状态”。保留这种只读边界也避免为视觉效果打开任何控制通道。 [本项目桥接：`rt/lowcmd` 仅观察说明](../../scripts/g1_monitor_bridge.py#L244-L266) · [本项目视图：控制入口文案](../../apps/operator-console/src/components/G1MonitorView.tsx#L334-L337)

### 有潜在的官方只读姿态来源，但尚未在真机确认

Unitree 官方 HG SDK 的 `LowState_` 定义包含固定 35 项 `motor_state`；每项 `MotorState_` 带 `q`、`dq`、`ddq`、估计力矩等字段。Unitree 同时给出了 G1 23 DoF 与 29 DoF 的 DDS 索引表，明确说明这些关节来自 `LowState_.motor_state`，并指出不同 `mode` 下踝和腰的含义不同。 [官方 `LowState_`](https://github.com/unitreerobotics/unitree_sdk2/blob/main/include/unitree/idl/hg/LowState_.hpp) · [官方 `MotorState_`](https://github.com/unitreerobotics/unitree_sdk2/blob/main/include/unitree/idl/hg/MotorState_.hpp) · [官方 G1 DDS 关节索引表](https://github.com/unitreerobotics/unitree_mujoco/blob/main/unitree_robots/g1/g1_joint_index_dds.md)

这只证明 SDK **定义了**可用于姿态的字段，不证明当前有线 G1 在当前 DDS domain 中发布了可订阅的 `rt/lowstate`，也不证明真机是 23 DoF、29 DoF、带何种手或使用哪个 `mode`。在实时动画之前，必须用只读 `DataReader` 进行以下验证：

1. 发现并订阅实际 `LowState` topic，不读取或发布 `LowCmd`；记录其 IDL 类型、频率、35 个槽位的有效性与 `mode`。
2. 根据该真机的 23/29 DoF 与 `mode`，将 SDK 索引表映射到**同一版本** URDF 的关节名称；用站立姿态和受控单关节运动逐项校验轴方向、零位与符号。
3. 把原始 `q` 限幅、时间戳和 freshness 一并传到前端；断流或无法验证映射时，冻结在静态中立姿态并标注“姿态未接入”，绝不外推或循环播放假动作。
4. 手部单独处理：官方索引表把 Dex3 手状态放在 `HandState` / `HandCmd`，不应拿全身 `LowState` 的缺失数据伪造手指运动。 [官方手部索引段](https://github.com/unitreerobotics/unitree_mujoco/blob/main/unitree_robots/g1/g1_joint_index_dds.md#dex3-1-关节电机顺序)

## 推荐落地路径（不在本研究中实施）

### 阶段 A：可信的静态全息外观

采用经真机型号确认的官方 URDF/STL（默认候选 `g1_29dof_rev_1_0`），由受控离线流水线导出一个 GLB：保留每个刚性 link 的局部原点、父子关系、关节轴与中立姿态；压缩网格并把深灰/浅灰实体材质明确记录为“渲染材质”，而非声称来源有 PBR 贴图。交付物要带源提交 hash、转换工具版本、导出日期、三角面数和第三方许可文本。

前端只将已证实的实时监控数据映射为**非姿态**视觉状态，例如：DDS live/stale 改变投影基座的状态标签；BMS live 改变能量读数；相机在线数改变已观测源指示。机器人本体保持中立姿态，文案应写“G1 exterior model / 静态外观模型”，而不是“实时姿态”。这让“真实机型外观”与“当前观测能力”保持诚实一致。来源：现有只读监控合同见 [桥接快照](../../scripts/g1_monitor_bridge.py#L269-L318)。

### 阶段 B：经验证的实时关节投影

仅在上述 `LowState` 实测、索引映射与轴向校验完成后，才把每帧 `q` 应用于对应的 URDF/GLB link 层级。模型资源本身不决定这一步；真正的风险是把不匹配的 23/29 DoF、`mode` 或关节零点错误地显示成“真机姿态”。官方索引表已经提示踝与腰在不同 mode 下不等价，因此这一步必须有真机验收记录。 [官方 G1 索引表](https://github.com/unitreerobotics/unitree_mujoco/blob/main/unitree_robots/g1/g1_joint_index_dds.md)

## 选择与否决摘要

| 决策 | 原因 |
| --- | --- |
| 选择官方 `g1_29dof_rev_1_0` URDF/STL，先转换为项目自持 GLB | 官方来源、关节树和版本状态明确；BSD-3-Clause 条款可审计；适合做分件刚性运动。 |
| 将官方 USD 作为待授权的视觉质量候选 | 资源真实且更完整，但现行公开数据集许可不明确；虽有 Three.js USD loader，仍未对这套分层 28 MB 资源做浏览器兼容性和性能验收。 |
| 不使用第三方 CC BY/商业 G1 模型作为产品基础 | 不能核实它们的 Unitree 外观、标识与再授权权利链；一个无骨骼，另一个无开放许可/下载。 |
| 不把全息模型连接到现有 state envelope、BMS、相机或 `lowcmd` | 这些数据不包含已验证的实际关节姿态；任何肢体动画都会是模拟。 |

最小且可信的下一步是：向 Unitree 确认真机准确型号/DoF 与官方模型的 Web 商业再分发条件；与此同时，以只读方式验证 `LowState` 是否可见及其 IDL/关节映射。二者完成前，页面可以有真实 G1 的静态外观投影，但必须明确它不是实时姿态回放。
