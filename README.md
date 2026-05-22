# JARVIS-OS

JARVIS-OS is a from-scratch personal AI operating layer inspired by the film-like idea of Jarvis: an assistant that is proactive, self-aware at the system level, memory-driven, tool-capable, safe, and able to improve over time.

This project is not a chatbot first. It is an always-on agent system.

Core principle:

```text
Perceive -> Understand -> Recall -> Predict -> Decide -> Act -> Verify -> Remember -> Improve
```

## Current Documents

- `docs/OVERALL_EXECUTION_PLAN.md`: full product, architecture, modules, phases, and acceptance criteria.
- `blueprints/PHASE-1-STARTUP.md`: immediate Phase 1 build plan for the first working foundation.

## Quick Start

```powershell
pnpm install
pnpm dev:gateway
```

Manual service controls:

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

Default local endpoint:

```text
http://127.0.0.1:31888
```

Local cockpit:

```text
http://127.0.0.1:31888/
```

Useful checks:

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

Secrets are runtime-only. Put model keys in environment variables such as
`JARVIS_MOONSHOT_API_KEY` and `JARVIS_VOLCENGINE_API_KEY`, put them in ignored
`configs/secrets.local.yaml`, or enable the OpenClaw local config import in
`configs/config.yaml`. Do not commit local secret files.

Optional `configs/secrets.local.yaml`:

```yaml
moonshotApiKey: sk-...
volcengineApiKey: ...

# Optional Windows GPU runtime path for faster-whisper.
# Prefer JARVIS_ASR_CUDA_DLL_DIRS when you do not want machine-specific paths in config.
asrCudaDllDirs: []
```

Core endpoints:

- `POST /chat` with `{ "message": "hello" }`
- `POST /embeddings` with `{ "text": "memory text" }`
- `POST /memory/store` with `{ "text": "remember this", "kind": "preference" }`
- `POST /memory/recall` with `{ "query": "what should you remember?" }`
- Tool call `memory.vault_status` through `POST /tools/call`
- Tool call `initiative.status` and `initiative.tick` through `POST /tools/call`
- Tool call `files.search`, `files.read`, `files.backup` through `POST /tools/call`
- Tool call `powershell.run` through `POST /tools/call`; it requires approval before execution
- Tool call `world.upsert_entity`, `world.find`, `world.link`, `world.snapshot` through `POST /tools/call`
- Tool call `reflection.record`, `reflection.find`, `reflection.list` through `POST /tools/call`
- Tool call `model.status` and `model.probe` through `POST /tools/call`
- Tool call `self.model`, `self.preflight`, and `self.repair_plan` through `POST /tools/call`
- Tool call `voice.status`, `voice.devices`, `voice.transcribe_audio`, `voice.speak`, `voice.tts_probe`, and `voice.listen_once` through `POST /tools/call`
- Tool call `maintenance.status` and `maintenance.prune_full_check` through `POST /tools/call`
- Tool call `briefing.generate` through `POST /tools/call`
- Tool call `enterprise.readiness` through `POST /tools/call`
- `GET /actions/pending`
- `POST /actions/approve` with `{ "actionId": "act_..." }`
- `POST /actions/reject` with `{ "actionId": "act_...", "reason": "not now" }`
- `GET /notifications/unread`
- `POST /notifications/read` with `{ "notificationId": "ntf_..." }`
- `POST /notifications/dismiss` with `{ "notificationId": "ntf_..." }`
- `GET /reminders`
- `POST /reminders/create` with `{ "title": "Stretch", "message": "Stand up", "dueAt": 1770000000000 }`
- `POST /reminders/cancel` with `{ "reminderId": "rmd_..." }`
- `GET /perception/status`
- `GET /initiative/status`
- `POST /initiative/tick`
- `GET /world/snapshot`
- `GET /world/find?query=JARVIS`
- `POST /world/upsert`
- `GET /reflection/status`
- `GET /reflection/list`
- `POST /reflection/tick`
- `GET /models/status`
- `POST /models/probe`
- `GET /voice/status`
- `GET /voice/devices`
- `POST /voice/speak` with `{ "text": "hello" }`
- `POST /voice/transcribe?language=zh-CN` with raw browser audio, using local faster-whisper ASR
- `POST /voice/listen` with `{ "timeoutMs": 7000 }`
- Browser realtime voice mode: open the cockpit and click `开启实时语音对话`; it continuously listens, detects speech turns, transcribes locally, sends chat, and speaks replies.
- Continuous voice conversation: `pnpm voice:start`, `pnpm voice:status`, `pnpm voice:stop`; it prefers local faster-whisper ASR and falls back to Windows SAPI
- `GET /briefing`
- `GET /self/diagnose`
- `GET /self/model`
- `GET /self/preflight`
- `GET /self/repair-plan`
- `GET /enterprise/readiness`
- `GET /events/recent`
- WebSocket events at `ws://127.0.0.1:31888/events`

## Product Direction

JARVIS-OS has two central engines:

- `Initiative Engine`: proactive observation, judgment, preparation, reminders, and safe action.
- `Self Engine`: self-health, self-diagnosis, self-learning, self-update, self-test, and rollback.

Everything else exists to support these two engines: memory, tools, model routing, perception, safety, workflows, and personality.

## MVP Target

The first usable version must be able to:

- Chat through a local desktop/web interface.
- Store durable memories.
- Proactively recall relevant memory before responses.
- Observe system events.
- Proactively notify only when useful.
- Call local tools safely.
- Distinguish low-risk and high-risk actions.
- Self-check service/model/memory/tool health.
- Recover from basic failures.
