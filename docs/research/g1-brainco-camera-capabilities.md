# G1、BrainCo 灵巧手与四路相机能力核实

研究日期：2026-08-25

研究问题：基于官方文档、SDK、固件接口和当前可获得的硬件资料，G1、BrainCo 灵巧手与四路相机实际提供哪些动作接口、控制频率、状态反馈、标定能力、力矩或电流信号、时间同步能力和急停机制；哪些关键能力仍需真机测量？

## 结论

现有一手资料足以确认三条边界：

1. G1 可以通过 DDS 获得关节级命令与状态；官方示例分别展示了 50 Hz 的 `/arm_sdk` 上肢控制和 500 Hz 的全身低层控制，但这两个数字是示例调度周期，不是当前真机已经验证的稳定频率、时延或抖动保证。
2. Revo 2 每只手是 **6 个主动关节、11 个机械自由度**，支持位置、速度、电流和 PWM 控制，并可反馈位置、速度、电流和电机状态。它没有公开的直接关节力矩反馈；触觉力只存在于特定触觉版本。
3. “四路相机”目前只有数量描述，没有型号、序列号、USB 拓扑、SDK、固件或触发接线资料。因此无法确认四路相机的帧率、深度、时间戳、硬件同步和标定能力。任何跨相机、相机—机器人状态的同步结论都必须等待硬件清点和实测。

这意味着首版不能把 G1 的 `tau_est`、BrainCo 电流和相机时间戳抽象成一个同名的“力/时间”字段。它们的物理含义和时钟来源不同，记录时必须保留原始语义。

## 能力总表

| 子系统 | 已确认 | 版本或配置依赖 | 必须真机确认 |
|---|---|---|---|
| G1 动作接口 | DDS `LowCmd` 提供 `q`、`dq`、前馈 `tau`、`kp`、`kd`；另有 `/arm_sdk` 上肢接口和高层运动 API | 23/29 自由度版本、G1/G1 EDU、固件与运动服务模式 | 实机自由度、固件版本、接口所有权切换、命令超时行为 |
| G1 控制频率 | 官方 `/arm_sdk` 示例周期 20 ms；全身低层示例周期 2 ms | 示例代码与 SDK 提交版本 | 稳定发布/反馈频率、抖动、丢包和闭环时延 |
| G1 状态 | 关节位置、速度、加速度、估算力矩、温度、电压、状态；IMU 姿态、角速度、加速度；`tick`、遥控器数据 | 字段可用性和数值质量取决于固件及机型 | `tick` 单位、估算力矩偏差、噪声、温漂、状态实际频率 |
| BrainCo 动作接口 | 6 个主动关节；位置+时间、位置+速度、速度、电流、PWM；单指或多指命令 | Revo 2 基础版、进阶版、触觉版及协议不同 | 当前左右手具体 SKU、固件、协议和命令持续时间语义 |
| BrainCo 控制频率 | Unitree 官方 RS-485→DDS 服务以 100 Hz 为目标；BrainCo SDK 的采集器允许配置采样频率 | 串口/CAN FD/EtherCAT、SDK 版本、主机负载 | 实际可持续命令/反馈频率和抖动；100 Hz 循环是否经常超时 |
| BrainCo 状态 | 位置、速度、电流、电机状态；保护阈值、温度/堵转等设备保护 | 触觉数据只在相应 SKU；具体状态字段依协议 | 电流与实际指尖接触力的关系、堵转阈值、停止响应 |
| 相机 | G1 产品页只确认“深度相机”；BrainCo 的 G1 集成示例使用 RealSense D435 工作流 | 实际四路相机型号完全未知 | 四机型号、分辨率/FPS、时间戳域、帧丢失、USB 带宽、触发能力 |
| 标定 | BrainCo 手支持上电或手动位置校准；官方 G1 集成提供单头部 RealSense 的手眼标定流程 | 手眼标定流程仅明确支持 G1 29 自由度配置 | 四相机内参、外参、外参漂移和重标定周期 |
| 急停 | G1 高层 API 有 `Damp`、`ZeroTorque`、`StopMove`；遥控器可强制进入阻尼模式 | 行为取决于当前运动服务和固件 | 从触发到关节停止的端到端时延；断网、进程退出后的最终状态 |

## 1. Unitree G1

### 1.1 硬件版本不能靠名称推断

Unitree 产品页区分 G1 与 G1 EDU：基础 G1 为 23 个关节自由度；G1 EDU 可为 23–43 个自由度，并允许选配额外腰部、腕部和灵巧手。产品页只对 G1 EDU 标注二次开发支持。[Unitree G1 产品页](https://www.unitree.com/g1)

BrainCo 的 G1 集成仓库进一步区分 23 自由度与 29 自由度：简单动作同时支持两者，而相机标定任务只明确支持 29 自由度版本。[BrainCo G1 集成版本说明](https://github.com/BrainCoTech/unitree-g1-brainco-hand/blob/6c09150a89b437a3120fc8c7a4456343001b23de/README.md)

因此，开始实现前必须从真机读取并记录机型、`mode_machine`、关节数量、固件版本和当前运动服务，而不能只记录“G1”。

### 1.2 动作接口

G1 的低层 DDS 命令 `MotorCmd` 明确包含：

- 电机使能模式 `mode`；
- 目标位置 `q`；
- 目标速度 `dq`；
- 前馈力矩 `tau`；
- 比例与微分增益 `kp`、`kd`。

来源：[Unitree `MotorCmd` IDL](https://github.com/unitreerobotics/unitree_sdk2/blob/9754cd153af3da471b0fe5f3aa535e426fb11db3/include/unitree/idl/hg/MotorCmd_.hpp)

官方代码展示了两条主要路径：

- `/arm_sdk`：控制双臂和腰部。5 自由度手臂示例控制 13 个关节，7 自由度手臂示例控制 17 个关节；示例使用位置、速度、增益和前馈力矩，并通过权重逐步接管/释放控制。[7 自由度 `/arm_sdk` 示例](https://github.com/unitreerobotics/unitree_sdk2/blob/9754cd153af3da471b0fe5f3aa535e426fb11db3/example/g1/high_level/g1_arm7_sdk_dds_example.cpp)
- `rt/lowcmd`：低层全身关节控制。29 自由度示例先释放现有运动控制服务，再直接发布全身命令。[全身低层示例](https://github.com/unitreerobotics/unitree_sdk2/blob/9754cd153af3da471b0fe5f3aa535e426fb11db3/example/g1/low_level/g1_dual_arm_example.cpp)

控制所有权不是可忽略的实现细节。BrainCo 的 G1 集成仓库明确说明，启动前会禁用内置上肢控制服务，以避免它与 `/arm_sdk` 同时控制而导致异常手臂运动。[BrainCo G1 集成说明](https://github.com/BrainCoTech/unitree-g1-brainco-hand/blob/6c09150a89b437a3120fc8c7a4456343001b23de/README.md)

### 1.3 控制频率

- `/arm_sdk` C++ 与 Python 示例均使用 `control_dt = 0.02`，即 50 Hz。
- 全身低层示例使用 2 ms 周期，即 500 Hz。

这些是官方示例的发送周期，只能证明 SDK 支持这种调用方式，不能证明当前机器在四路相机和双手同时运行时仍能保持相同频率。状态发布频率、网络抖动、命令到关节响应时延和丢包恢复都没有在公开接口中给出保证。

### 1.4 状态反馈与力矩信号

`LowState` 提供 `tick`、IMU、35 个 `MotorState` 容器、遥控器数据、模式和 CRC。[Unitree `LowState` IDL](https://github.com/unitreerobotics/unitree_sdk2/blob/9754cd153af3da471b0fe5f3aa535e426fb11db3/include/unitree/idl/hg/LowState_.hpp)

单个 `MotorState` 包含：

- `q`、`dq`、`ddq`；
- `tau_est`，即估算力矩；
- 两路温度、母线电压、传感器原始字段和电机状态。

来源：[Unitree `MotorState` IDL](https://github.com/unitreerobotics/unitree_sdk2/blob/9754cd153af3da471b0fe5f3aa535e426fb11db3/include/unitree/idl/hg/MotorState_.hpp)

G1 公共接口没有暴露名为电机电流的字段。`tau_est` 也不是外部六维力/力矩传感器读数；其精度、延迟和接触检测阈值必须在当前真机上标定，不能直接用作精确接触力。

IMU 状态提供四元数、角速度、线加速度、滚转/俯仰/偏航和温度。[Unitree `IMUState` IDL](https://github.com/unitreerobotics/unitree_sdk2/blob/9754cd153af3da471b0fe5f3aa535e426fb11db3/include/unitree/idl/hg/IMUState_.hpp)

### 1.5 停止与连接丢失

G1 高层 API 暴露 `Damp`、`ZeroTorque` 和 `StopMove`。其中 `StopMove` 是把机身速度设为零，不等同于切断所有关节输出；`Damp` 和 `ZeroTorque` 才是不同的整机状态转换。[G1 LocoClient](https://github.com/unitreerobotics/unitree_sdk2/blob/9754cd153af3da471b0fe5f3aa535e426fb11db3/include/unitree/robot/g1/loco/g1_loco_client.hpp)

Unitree 还提供运行时终止条件辅助函数，包括姿态异常、关节速度过大、角速度过大、电机过热、低电量和状态连接超时。官方注释特别指出：网络连接断开后若程序继续发送阶跃命令，可能导致剧烈运动；检测到条件后建议低层控制进入被动模式。[G1 termination helpers](https://github.com/unitreerobotics/unitree_sdk2/blob/9754cd153af3da471b0fe5f3aa535e426fb11db3/include/unitree/robot/g1/common/terminations.hpp)

BrainCo 的 G1 集成教程把遥控器长按 `L2 + B` 超过 5 秒描述为强制进入阻尼模式的紧急处理方式。[BrainCo G1 开发安全建议](https://github.com/BrainCoTech/unitree-g1-brainco-hand/blob/6c09150a89b437a3120fc8c7a4456343001b23de/README.md)

这些都是可用的停止路径，但公开资料没有证明它们满足工业安全标准中的独立硬接线急停，也没有给出最坏响应时间。当前项目只需要防止突然大幅加速和撞坏设备，因此应实测并选出一个响应足够快、在进程失效时仍可用的路径，不必先建设复杂安全系统。

## 2. BrainCo Revo 2 灵巧手

### 2.1 自由度与硬件版本

BrainCo 官方文档确认 Revo 2 有 11 个机械自由度，其中 6 个为主动关节：拇指有两个主动自由度，其余四指各有一个主动自由度。[Revo 2 产品参数](https://www.brainco-hz.com/docs/revolimb-hand/revo2/parameters.html)

因此，一只手的动作向量是 6 个主动关节，不是 11 个独立执行器；双手是 12 个主动关节。蓝图中出现的“BrainCo 26D”不能由当前硬件资料支持。

Revo 2 至少有基础版、进阶版和触觉版：

- 基础版：RS-485、CAN FD；
- 进阶版和触觉版：RS-485、CAN FD、EtherCAT；
- 触觉反馈仅属于触觉版本。

当前仓库没有左右手 SKU 或序列号，所以协议和触觉能力仍是版本依赖事实。

### 2.2 动作与状态接口

官方协议支持五种控制方式：位置+时间、位置+速度、速度、电流和 PWM。支持同时控制六个主动关节，也支持单指命令。位置可用归一化值或 0.1° 分辨率的物理量表达；电流物理单位为 mA。[Revo 2 Modbus/CAN FD 基础版协议](https://www.brainco-hz.com/docs/revolimb-hand/revo2/modbus_foundation.html)

状态寄存器提供六路实际位置、实际速度、实际电流和电机状态；电机状态至少区分空闲、运行、堵转和 Turbo。官方 Python SDK 对外也统一返回 `positions`、`speeds`、`currents` 和 `states`。[BrainCo Python SDK 文档](https://www.brainco-hz.com/docs/revolimb-hand/revo2/python_sdk.html)

Revo 2 提供电流命令和电流反馈，但没有公开的关节力矩反馈。电流只能作为接触或堵转的代理信号；电流到指尖力的映射会受到姿态、摩擦、传动和硅胶结构影响，必须真机标定。

触觉版可提供指尖触觉数据；官方资料根据 SKU 区分三维力、接近信息或压力阵列等形式。不能在未读取 SKU 前假设每只手都有触觉，更不能把触觉读数与电机电流混为同一种“力”。[Revo 2 触觉版协议](https://www.brainco-hz.com/docs/revolimb-hand/revo2/modbus_touch.html)

### 2.3 与 G1 的当前官方桥接

Unitree 的 `brainco_hand_service` 为左右手分别使用一个 USB 转串口设备，并建立：

- `rt/brainco/left/cmd` 与 `rt/brainco/left/state`；
- `rt/brainco/right/cmd` 与 `rt/brainco/right/state`。

服务把位置和速度归一化到 `[0,1]`，使用 460800 baud 的双 RS-485，并以 10 ms 周期执行“写命令→读状态→发布状态”，目标频率为 100 Hz。[Unitree BrainCo 服务说明](https://github.com/unitreerobotics/brainco_hand_service/blob/d71996b6999edb2f838a3dca3d9621429a2ef966/README.md)；[服务实现](https://github.com/unitreerobotics/brainco_hand_service/blob/d71996b6999edb2f838a3dca3d9621429a2ef966/main.cpp)

该桥接有两个必须保留的语义事实：

1. 它把 BrainCo 的电流除以 1000 后写入 Unitree `MotorState.tau_est`。这个字段在该话题中实际代表电流标度值，不是力矩。
2. 循环持续重发订阅对象中的最后一条命令；虽然订阅类能检测超时，工作循环没有使用该超时结果。因此“上游命令发布进程退出后手会自动停止”目前没有代码证据。

首版若复用该服务，应修正状态字段语义并增加命令超时后的明确停止行为；这是最小必要改动，而不是额外安全层。

### 2.4 频率、标定和停止

100 Hz 是 Unitree RS-485 桥接的目标循环频率，不是测得的保证值。单个循环包含一次六指写入和一次状态读取；若串口事务超过 10 ms，代码只跳过睡眠，不会补偿抖动。因此必须记录实际周期分布。

BrainCo SDK 的数据采集接口允许配置电机和触觉采样频率，并给出 1000 Hz 电机、100 Hz 汇总触觉、10 Hz 详细压力等默认参数；这些是采集器配置，不等同于当前 RS-485 双手部署能稳定达到相同物理采样率。[Unitree 服务随附的 BrainCo SDK 头文件](https://github.com/unitreerobotics/brainco_hand_service/blob/d71996b6999edb2f838a3dca3d9621429a2ef966/include/stark-sdk.h)

Revo 2 上电后必须执行一次位置校准；可以开启自动校准，也可以通过寄存器或手背按键手动触发。触觉版本还提供空载复位与触觉参数校准。[Revo 2 产品参数](https://www.brainco-hz.com/docs/revolimb-hand/revo2/parameters.html)

公开协议没有确认独立硬件急停或通信丢失看门狗。官方 GUI 示例会逐个调用 `stop_motor` 停止动作序列，并有电流、堵转、高温和碰撞保护，但这些不能代替对“命令源消失后实际会发生什么”的实测。[BrainCo GUI 停止动作示例](https://github.com/BrainCoTech/brainco-hand-sdk/blob/07a45f18d335d3747963d949ea6f44a5a3b01b55/python/gui/action_sequence_panel.py)

## 3. 四路相机

### 3.1 当前能确认的事实很少

Unitree G1 产品页只写明机身配有“深度相机 + 3D LiDAR”，未给出相机型号、分辨率、帧率或同步方式。[Unitree G1 产品页](https://www.unitree.com/g1)

BrainCo 的 G1 集成代码使用 `pyrealsense2`，测试脚本明确针对 RealSense D435；示例配置使用 30 FPS，并提供深度和彩色对齐、相机内参读取以及棋盘格手眼标定流程。[BrainCo G1 视觉代码](https://github.com/BrainCoTech/unitree-g1-brainco-hand/tree/6c09150a89b437a3120fc8c7a4456343001b23de/brainco_ws/src/control_py/control_py/state_manager/calibrate)；[手眼标定教程](https://github.com/BrainCoTech/unitree-g1-brainco-hand/blob/6c09150a89b437a3120fc8c7a4456343001b23de/tutorials/README_07_test_run_calibrate_en.md)

这只能证明有一条可复用的 RealSense 工作流，不能证明项目中的四台相机都是 D435，也不能证明它们已经完成相互标定或同步。

### 3.2 如果实物确为 RealSense D4xx

官方 librealsense API 可提供：

- 设备硬件时钟、操作系统时钟或转换后的全局时间三种时间戳域；
- 帧计数器、设备帧时间戳、曝光中点时间戳、到达时间和实际 FPS 等逐帧元数据；
- 对部分 D400 型号可查询并设置 `INTER_CAM_SYNC_MODE`，但 SDK 明确要求由设备支持，且不会自动启用硬件同步。

来源：[librealsense 时间戳与元数据定义](https://github.com/realsenseai/librealsense/blob/7c3ee3fb7c640e9f315e663907208cb56c4febfd/include/librealsense2/h/rs_frame.h)；[相机同步选项](https://github.com/realsenseai/librealsense/blob/7c3ee3fb7c640e9f315e663907208cb56c4febfd/include/librealsense2/h/rs_option.h)；[硬件同步不会被自动启用](https://github.com/realsenseai/librealsense/blob/7c3ee3fb7c640e9f315e663907208cb56c4febfd/doc/frame_lifetime.md)

即使四台都是 D4xx，仍需确认具体 SKU、固件、同步线、主从模式、相同 FPS、USB 控制器分布和实际帧间偏差。仅调用软件 `syncer` 或给帧加主机接收时间，不等于硬件曝光同步。

### 3.3 标定能力

BrainCo 的官方 G1 流程使用棋盘格采集图像和机械臂位姿，默认每侧 20 个样本，离线求取相机到左右手/基座的外参。该流程可作为起点，但只覆盖单个头部相机与机械臂的手眼关系。

四路系统至少还需要：

- 每台相机的内参与畸变参数；
- 每台相机到共同机器人坐标系的外参；
- 相机之间的相对外参；
- 机械安装后的外参稳定性复测。

BrainCo 集成文档特别指出 G1 头部是被动关节，运动和振动会改变头部相机位姿，并提供固定支架方案。这说明头部相机外参漂移是已知机械问题，而不是纯软件标定问题。[G1 头部相机安装说明](https://github.com/BrainCoTech/unitree-g1-brainco-hand/blob/6c09150a89b437a3120fc8c7a4456343001b23de/tutorials/README_01_pre_setup_en.md)

## 4. 时间同步的真实边界

当前公开接口不存在一个已经统一好的机器人时钟：

- G1 `LowState` 有 `tick`，但 IDL 没有说明单位、起点或与主机时间的关系，也没有绝对时间戳字段；
- Unitree BrainCo 手 DDS 状态没有时间戳，并且是串口事务完成后发布；
- RealSense 可给出设备时间戳和时间戳域，但只适用于确认过的 RealSense 型号；
- 四台相机是否共享硬件触发未知。

因此首版记录应同时保留：设备原始计数/时间戳、时间戳域、主机单调时钟接收时间、发布/命令时间和序列号。跨设备对齐误差必须通过共同可见事件或硬件触发测量，不能由相近的主机时间推断。

## 5. 上机前必须完成的最小实测

这些测试直接决定接口合同，不需要先建设完整平台：

1. **硬件清点**：记录 G1/EDU、23/29 自由度、固件、左右手 SKU/固件/协议、四台相机型号与序列号、USB 控制器和端口拓扑。
2. **频率与时延**：在四路相机和双手同时开启时，连续记录至少 10 分钟的 G1 状态周期、G1 命令周期、左右手状态周期、每路相机 FPS、丢帧、重复帧和 99.9 百分位抖动。
3. **动作停止**：分别测试上游进程退出、DDS 断开、网线断开、串口断开、`Damp`、`ZeroTorque`、遥控器阻尼和整机断电；记录触发到关节/手指停止的时间及最终姿态。
4. **关节变化限制**：从静止开始下发受控的小阶跃，测出 G1 手臂和 BrainCo 手指在当前位置、速度、加速度限制下的实际响应，用于设置防止突然大幅摆动的最小限幅器。
5. **力信号**：在若干手臂姿态和按压方向下，对 G1 `tau_est`、BrainCo 电流及触觉读数做零点、噪声、迟滞和重复性测试；不追求高精度力控，只确定接触/堵转检测是否可靠。
6. **四相机同步**：用同一快速闪光或运动事件测量每路曝光/帧时间偏差；若相机支持硬件触发，再比较启用前后偏差。
7. **四相机标定**：完成内参、共同外参和机械扰动后的复测；特别检查头部被动关节或支架是否导致外参漂移。

## 6. 对后续架构决策的直接约束

- 首版应优先评估 `/arm_sdk` 的 50 Hz 上肢路径；黄色按钮任务没有证据要求一开始接管 500 Hz 全身低层控制。
- BrainCo 应按每手 6 个主动关节建模，首版可使用位置+速度原语；电流用于监测或受限控制，不能命名为力矩。
- 所有动作源必须经过单一控制所有权切换，不能让内置运动服务、`/arm_sdk` 和 `rt/lowcmd` 同时竞争。
- 最小硬件保护只需要三件事：每周期关节变化限幅、G1 状态连接超时后进入被动/阻尼状态、BrainCo 命令超时后停止或保持当前安全位置。具体阈值由上述实测产生。
- 在相机型号和同步结果出来前，只能承诺“记录四路视频及各自时间信息”，不能承诺四路严格同步观测。

## 资料版本

- Unitree `unitree_sdk2`：提交 `9754cd153af3da471b0fe5f3aa535e426fb11db3`。
- Unitree `unitree_sdk2_python`：提交 `65691c8a8bc53b98d3976dba4dbf9d5d20b2e7f5`。
- BrainCo `brainco-hand-sdk`：提交 `07a45f18d335d3747963d949ea6f44a5a3b01b55`；README 标注 v2.0.3，仓库变更记录最后列出的正式条目为 v2.0.1，因此部署时必须锁定实际 wheel、头文件和固件版本。
- Unitree `brainco_hand_service`：提交 `d71996b6999edb2f838a3dca3d9621429a2ef966`。
- BrainCo `unitree-g1-brainco-hand`：提交 `6c09150a89b437a3120fc8c7a4456343001b23de`。
- RealSense `librealsense`：提交 `7c3ee3fb7c640e9f315e663907208cb56c4febfd`。
