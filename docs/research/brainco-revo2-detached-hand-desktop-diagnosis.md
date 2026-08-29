# 已拆下 BrainCo Revo 2 灵巧手：官方上位机与台架诊断

> 目的：确认这只从 G1 上拆下的六电机 BrainCo 手是否存在可观察的机械、供电、通信或单电机故障；不将本次台架诊断当作 VLA 测试，也不接入 G1。
>
> 本文仅采用 BrainCo/Unitree 一方发布的一手资料。本文的“小幅逐指动作”是保守的工程诊断策略，不是厂家规定的动作序列。

## 下载

- 官方下载中心：[BrainCo Revo 2 下载中心](https://www.brainco-hz.com/docs/revolimb-hand/revo2/download.html)。该页将该程序称为「Windows 桌面工具」。
- 直接下载（官方 OSS）：[BrainCo_RevoII_Hand_Tool_win_0635_v0.0.19_20251218.7z](https://brainco-common-public.oss-cn-hangzhou.aliyuncs.com/web-config/docs-sdk/BrainCo_RevoII_Hand_Tool_win_0635_v0.0.19_20251218.7z)。下载后用能解开 `.7z` 的工具解压，运行其中的 Windows 客户端；不要安装或运行 OTA/firmware 工具。
- 官方 GUI 指南：[Revo 2 上位机使用说明](https://www.brainco-hz.com/docs/revolimb-hand/revo2/guide.html)。
- 官方产品手册（包含随附线缆/接口资料）：[Revo 2 产品手册 V2.1](https://brainco-common-public.oss-cn-hangzhou.aliyuncs.com/web-config/docs-sdk/Revo-2-%E7%81%B5%E5%B7%A7%E6%89%8B%E4%BA%A7%E5%93%81%E6%89%8B%E5%86%8C-V2.1.pdf)。

BrainCo 的 SDK 系统要求页明确列出 Windows 10/11；这也是台式 GUI 可依赖的操作系统范围。见[官方 SDK 要求](https://www.brainco-hz.com/docs/revolimb-hand/revo2/get_sdk.html)。

## 先确认台架条件

这不是「只插 USB 就能测」的设备：G1 使用的正是 BrainCo **Revo 2** 六主动关节手，官方 Unitree 服务也说明它由串口控制。见[Unitree 官方 BrainCo 服务](https://github.com/unitreerobotics/brainco_hand_service)。

1. 识别手腕标签上的 SKU：基础版 `XRL/XRR`、进阶版 `XEL/XER`、触觉版 `XTL/XTR`。只有基础版供电范围是 **12–28 V**；进阶/触觉版是 **12–64 V**。先按实际 SKU 决定电源，不能仅按线色猜测。见[官方参数表](https://www.brainco-hz.com/docs/revolimb-hand/revo2/parameters.html)。
2. 使用原厂手部线束及原厂 485 转 USB 调试模块；没有调试模块时，只能使用已确认接线和隔离规格的 **USB–RS485** 转换器，不能把普通 TTL-UART 或 USB 线直接接到手。接口针脚以产品手册为准。
3. 将手掌固定在非导电台面、手指前方留出完整张开空间、全程录像；电源的物理开关应在操作者可立即触及的位置。上电即可能产生手指运动：官方说明上电会自动进行位置校准并打开手指，校准完成前不能正常控制。[官方参数/校准说明](https://www.brainco-hz.com/docs/revolimb-hand/revo2/parameters.html)
4. 用 **RS485/Modbus** 做桌面端检查。基础版要确认手腕拨码在 Modbus/RS485；进阶/触觉版要确认拨码在 RS485（而非 EtherCAT）。切换拨码只在断电后进行。接口支持情况和拨码位置见[官方参数页](https://www.brainco-hz.com/docs/revolimb-hand/revo2/parameters.html)。

## 读取优先的诊断流程

### 0. 断电目检

拍下序列号/SKU、接口、线缆与六个指根；检查壳体裂纹、松脱的腱线/线束、异物或手指机械卡滞。**不要**按手背按钮：官方 FAQ 指出长按会恢复出厂，短按会触发校准。[官方 FAQ](https://www.brainco-hz.com/docs/revolimb-hand/revo2/faq.html)

### 1. 上电观察（无桌面端动作）

给手供电并只观察自动校准：预期是手指打开、校准结束后背灯绿色常亮。黄色闪烁表示低供电，红色常亮为异常；校准无法完成、反复抽击、异响、冒烟/异味或红灯时，立即断电，保存视频，不进入后续动作测试。[官方状态灯与校准定义](https://www.brainco-hz.com/docs/revolimb-hand/revo2/parameters.html)

### 2. 上位机连接与只读证据

在 GUI 的 `Connect` 中选择 Windows 分配的 COM 口、设备 ID 和波特率，随后点击 `OK`。对未改过配置的手，默认左手 ID 是 `126`、右手 ID 是 `127`；官方协议记录复位后的 RS485 默认波特率为 `460800`。如果先前改过任一项，不能假定该默认值；不要为了探测而恢复出厂。[GUI 连接说明](https://www.brainco-hz.com/docs/revolimb-hand/revo2/guide.html)；[官方协议](https://www.brainco-hz.com/docs/revolimb-hand/revo2/modbus_foundation.html)。

保持 **Broadcast 关闭**。官方说明开启它会以广播方式下发指令；`Check` 会扫描全部 ID 且可能约 10 分钟，只有在确认 ID/端口/波特率未知且手已稳定时才作为最后的只读通信排障步骤使用。[GUI 指南](https://www.brainco-hz.com/docs/revolimb-hand/revo2/guide.html)

连接后，只读取并截图保存以下项目：固件版本、序列号、六路实际位置/速度/电流和电机状态。协议定义了实际位置寄存器 `2000–2005`、速度 `2006–2011`、电流 `2012–2017`、状态 `2018–2023`、固件 `3000` 与序列号 `3010`；状态 `2` 是 `MOTOR_STALL`。GUI 的 Motor 页面也会显示实时位置、速度与电流曲线。[官方 Modbus 诊断寄存器](https://www.brainco-hz.com/docs/revolimb-hand/revo2/modbus_foundation.html)；[GUI 指南](https://www.brainco-hz.com/docs/revolimb-hand/revo2/guide.html)。

判定为 **停止并报修** 的信号：红灯、无法完成上电校准、静止时持续 `MOTOR_STALL`、单指持续自行运动/敲击、或明显异常电流/发热/异响。不要仅凭 GUI 显示“已连接”就判断机械完好。

### 3. 仅在只读结果正常后：逐指小幅验证

这一步首次会写入运动命令，因此先录像并保持断电开关可及。

1. 仅进入 `Motor`，使用 **位置**模式；不要选 PWM 或电流模式。官方 GUI 的位置范围为 `0–100`，且可看实时曲线。[GUI 指南](https://www.brainco-hz.com/docs/revolimb-hand/revo2/guide.html)
2. 一次只选一个电机，使用 GUI 允许的最低非零速度，将当前位置仅改变约 **5–10 个位置点**，静止观察后再回到起始位置；确认状态/电流稳定后才测试下一指。不要做全握拳或多指并发动作。
3. 六路的顺序是：拇指屈伸、拇指辅助、食指、中指、无名指、小指；这与 G1 BrainCo 服务的官方映射一致。[Unitree 官方映射](https://github.com/unitreerobotics/brainco_hand_service)
4. 任一手指不跟随、触发堵转、带动非目标指、出现抽击或电流/温度异常，立即断电；保存该指的前后截图、视频和时间点。此时结论是“硬件/执行链异常待厂家诊断”，不继续用更大幅度的命令逼测。

## 明确禁止的 GUI 操作

- `Broadcast`；
- PWM / 电流模式；
- `Action Sequence` 的 `Download` 或 `Run`；
- `Hand Parameters` 中的 Set/写入、恢复出厂、按手背按钮；
- `Tools → OTA` 或任何固件包。

官方指南明确这些界面会下发命令、下载动作序列或升级固件；它们会改变设备状态，不能用于损坏鉴定。[GUI 动作序列与 OTA 说明](https://www.brainco-hz.com/docs/revolimb-hand/revo2/guide.html)

## 结束时应保留的证据

保留：手的标签/SKU照片、供电与线束照片、上电校准视频、绿色/红色灯状态、COM/ID/波特率、固件版本和序列号、六路只读截图，以及若做过逐指测试的每指视频与状态/电流截图。这些证据能把“通信没连上”“电源/校准异常”“单一电机或机械故障”三类问题分开，并可直接提交给 BrainCo 的官方帮助入口。
