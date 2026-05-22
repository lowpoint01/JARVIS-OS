# JARVIS-OS

JARVIS-OS 是一个从零创作的个人 AI 操作层，灵感来自电影里“贾维斯”式的智能助手：它不是单纯的聊天机器人，而是一个长期运行、具备主动性、记忆能力、工具调用能力、自检能力和语音交互能力的本地智能系统。

它的目标是成为一个始终在线的个人 AI 操作中枢，能够理解当前状态、主动观察环境、回忆长期记忆、判断下一步行动，并在安全边界内帮助你完成任务。

核心循环：

```text
感知 -> 理解 -> 回忆 -> 预测 -> 决策 -> 执行 -> 验证 -> 记忆 -> 改进
```

## 当前文档

- `docs/OVERALL_EXECUTION_PLAN.md`：完整产品方案、系统架构、模块拆分、阶段规划和验收标准。
- `blueprints/PHASE-1-STARTUP.md`：第一阶段启动方案，用于搭建最小可用基础系统。

## 快速开始

```powershell
pnpm install
pnpm dev:gateway
```

常用服务命令：

```powershell
pnpm service:start
pnpm service:status
pnpm service:stop
pnpm voice:start
pnpm voice:status
pnpm voice:stop
pnpm check:runtime
pnpm check:backend
pnpm check:full
pnpm check:enterprise
```

默认本地地址：

```text
http://127.0.0.1:31888
```

本地控制台：

```text
http://127.0.0.1:31888/
```

## 常用检查

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:31888/readyz
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:31888/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:31888/perception/status
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:31888/models/status
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:31888/voice/status
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:31888/voice/devices
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:31888/briefing
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:31888/self/model
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:31888/enterprise/readiness
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:31888/tools/list
```

## 密钥配置

密钥只在运行时读取，不应该提交到仓库。

推荐方式：

- 使用环境变量：`JARVIS_MOONSHOT_API_KEY`、`JARVIS_VOLCENGINE_API_KEY`
- 或复制 `configs/secrets.local.yaml.example` 为 `configs/secrets.local.yaml`
- 或在 `configs/config.yaml` 中开启 OpenClaw 本地配置导入

本地密钥文件示例：

```yaml
moonshotApiKey: sk-...
volcengineApiKey: ...

# 可选：Windows 上 faster-whisper 找不到 CUDA DLL 时使用。
# 如果不想把机器路径写入配置，也可以使用 JARVIS_ASR_CUDA_DLL_DIRS 环境变量。
asrCudaDllDirs: []
```

`configs/secrets.local.yaml` 已被 `.gitignore` 忽略，请不要提交真实密钥。

## 核心能力

- 本地 Web 控制台
- Kimi 对话模型接入
- 豆包向量模型接入
- 长期记忆存储与主动回忆
- 记忆保险库 Markdown 镜像
- 主动循环与感知循环
- 世界模型与实体关系
- 反思记录与经验沉淀
- 本地工具调用与安全审批
- 通知、动作、提醒和事件流
- 自检、自我画像、预检和修复建议
- 本地语音输出 TTS
- 本地语音识别 ASR
- 实时语音对话模式

## 语音模式

JARVIS-OS 当前支持两种语音入口：

- 控制台实时语音：打开控制台，点击 `开启实时语音对话`。系统会持续监听、自动断句、本地转写、发送对话，并朗读回复。
- 后台持续语音：使用 `pnpm voice:start` 启动，使用 `pnpm voice:stop` 停止。

语音链路：

```text
麦克风 -> faster-whisper 本地 ASR -> JARVIS 对话 -> msedge-tts 语音输出 -> 继续监听
```

Windows 上默认使用：

- ASR：`faster-whisper / large-v3-turbo`
- TTS：`msedge-tts / zh-CN-XiaoxiaoNeural`
- 兜底识别：Windows SAPI
- 兜底朗读：Windows SAPI

## 核心接口

- `POST /chat`：发送对话消息
- `POST /embeddings`：生成向量
- `POST /memory/store`：写入长期记忆
- `POST /memory/recall`：召回相关记忆
- `GET /models/status`：查看模型状态
- `POST /models/probe`：测试模型链路
- `GET /voice/status`：查看语音能力状态
- `GET /voice/devices`：检查麦克风、扬声器和语音识别器
- `POST /voice/speak`：朗读文本
- `POST /voice/transcribe?language=zh-CN`：上传音频并用本地 ASR 转写
- `POST /voice/listen`：使用本机识别器听写一次
- `GET /briefing`：生成当前态势简报
- `GET /self/diagnose`：执行自检
- `GET /self/model`：查看自我模型
- `GET /self/preflight`：运行启动前检查
- `GET /self/repair-plan`：生成修复建议
- `GET /enterprise/readiness`：查看企业级就绪报告
- `GET /events/recent`：查看最近事件
- `ws://127.0.0.1:31888/events`：实时事件流

## 工具能力

所有工具都通过 `POST /tools/call` 调用。

常用工具包括：

- `memory.vault_status`
- `initiative.status`
- `initiative.tick`
- `files.search`
- `files.read`
- `files.backup`
- `powershell.run`
- `world.upsert_entity`
- `world.find`
- `world.link`
- `world.snapshot`
- `reflection.record`
- `reflection.find`
- `reflection.list`
- `model.status`
- `model.probe`
- `self.model`
- `self.preflight`
- `self.repair_plan`
- `voice.status`
- `voice.devices`
- `voice.transcribe_audio`
- `voice.speak`
- `voice.tts_probe`
- `voice.listen_once`
- `maintenance.status`
- `maintenance.prune_full_check`
- `briefing.generate`
- `enterprise.readiness`

## 产品方向

JARVIS-OS 的核心不是“问一句答一句”，而是构建一个主动型个人 AI 操作系统层。

系统有两个核心引擎：

- 主动引擎：负责观察、判断、准备、提醒和安全行动。
- 自我引擎：负责自检、自我诊断、自我学习、自我修复和稳定性守护。

其他模块都服务于这两个核心：记忆、工具、模型路由、感知、安全、工作流、语音和人格化交互。

## 当前目标

当前版本需要做到：

- 可以通过本地控制台对话
- 可以保存长期记忆
- 可以在对话前主动召回相关记忆
- 可以观察系统事件
- 可以在有价值时主动提醒
- 可以安全调用本地工具
- 可以区分低风险与高风险动作
- 可以自检服务、模型、记忆和工具健康状态
- 可以从基础故障中恢复
- 可以通过实时语音进行连续对话

## 开源说明

本仓库不包含本地运行数据、真实密钥、个人记忆、音频缓存、模型缓存、构建产物或依赖目录。

已排除的本地内容包括：

- `configs/secrets.local.yaml`
- `data/`
- `dist/`
- `node_modules/`
- `.pnpm-store/`

## 许可证

本项目使用 MIT License。
