# JARVIS-OS Overall Execution Plan

## 1. Product Definition

JARVIS-OS is a proactive personal AI operating layer. It is designed to feel less like a chat app and more like a persistent intelligent companion that can observe, remember, prepare, act, verify, and improve.

The project should not be built around the question "How do we answer user messages?" It should be built around the question "How do we keep a useful, safe, proactive intelligence present around the user?"

Primary goal:

```text
Create a proactive, self-monitoring, memory-driven, tool-using personal AI system that runs on the user's computer and can gradually become more useful over time.
```

Non-goal:

```text
Do not claim real consciousness or true self-awareness. The "self" layer means system-level self-modeling, self-diagnosis, self-improvement, and self-maintenance.
```

## 2. Core Philosophy

JARVIS-OS must be designed around two master engines.

### 2.1 Initiative Engine

The Initiative Engine is responsible for proactive behavior.

It answers:

- What is happening?
- What is the user likely doing?
- Is this important?
- Should I stay silent?
- Should I remember this?
- Should I prepare something in the background?
- Should I notify the user?
- Can I safely act now?
- Do I need confirmation?

### 2.2 Self Engine

The Self Engine is responsible for the system's own operational awareness and improvement.

It answers:

- Am I online?
- Are my services healthy?
- Are my models slow or failing?
- Is memory retrieval working?
- Are tools failing repeatedly?
- Did my last action help?
- Did I interrupt the user too often?
- Do I need to reindex, restart, update, or roll back?
- What should be improved next?

## 3. System Architecture

```text
JARVIS Shell
  Desktop window, floating HUD, voice button, hotkeys, mobile bridge later

Perception Core
  Screen, microphone, window title, clipboard, files, browser, system metrics

Event Bus
  Durable event log, dedupe, ordering, replay, subscriptions

Situation Engine
  Understands current user context and work mode

Attention Engine
  Decides whether interruption is useful or harmful

Goal Engine
  Tracks long-term goals, daily goals, current tasks, implicit goals

Memory Core
  Short-term memory, long-term memory, vector search, markdown vault, graph state

World Model
  People, projects, devices, apps, files, services, tasks, relationships

Model Router
  Local models, API models, embedding models, vision models, safety models

Tool Runtime
  Browser, files, PowerShell, apps, screenshots, OCR, notifications, backups

Workflow Engine
  Durable tasks, schedules, retries, waiting conditions, resumable execution

Safety Kernel
  Permissions, confirmations, sandboxing, audit, rollback, secret isolation

Self Engine
  Self-health, self-diagnosis, self-repair, self-update, self-test, rollback

Reflection Engine
  Post-action review, learning, training-data generation, policy adjustment
```

## 4. Runtime Loop

The core proactive loop:

```text
Observe -> Interpret -> Recall -> Predict -> Decide -> Act -> Verify -> Remember -> Improve
```

### 4.1 Observe

Collect signals from:

- Current active window.
- Screen snapshots and OCR.
- Clipboard changes.
- File system changes.
- Browser tabs and pages.
- Terminal/process status.
- System CPU/GPU/memory/disk/network.
- Calendar and time.
- Voice input.
- Notifications and messages.
- Existing tasks and workflows.

### 4.2 Interpret

Convert raw events into a situation model:

```json
{
  "mode": "coding",
  "project": "JARVIS-OS",
  "attention": "focused",
  "interruptCost": 0.85,
  "risk": "low",
  "currentGoal": "build Initiative Engine foundation"
}
```

### 4.3 Recall

Retrieve relevant memory before deciding or responding:

- User preferences.
- Current project state.
- Similar past issues.
- Known procedures.
- People/project/device relationships.
- Recent unfinished tasks.
- Safety rules.

### 4.4 Predict

Predict likely needs:

- The user may need a command.
- The user may need a warning.
- The user may need a file opened.
- The user may need a previous solution recalled.
- The user may need silence.
- The user may need recovery from a failed service.

### 4.5 Decide

Use the proactive scoring model:

```text
initiative_score =
  importance * 0.30
+ urgency * 0.20
+ relevance * 0.20
+ actionability * 0.15
+ success_probability * 0.10
- interruption_cost * 0.25
- risk_cost * 0.30
- uncertainty * 0.20
```

Decision levels:

| Level | Name | Behavior |
|---|---|---|
| A0 | Silent Observe | Record only, no visible output |
| A1 | Auto Memory | Save memory silently |
| A2 | Background Prepare | Gather context or draft help quietly |
| A3 | Proactive Notify | Notify the user |
| A4 | Reversible Execute | Execute safe reversible actions |
| A5 | Confirmed Execute | Ask before high-risk actions |

### 4.6 Act

Possible actions:

- Store memory.
- Search memory.
- Create a task.
- Send notification.
- Open a browser page.
- Read or write a file.
- Run a safe command.
- Create a backup.
- Restart a service.
- Ask the user for approval.

### 4.7 Verify

Every action must produce a verification result:

```json
{
  "actionId": "act_001",
  "status": "success",
  "evidence": "service returned ready=true",
  "durationMs": 830
}
```

### 4.8 Remember

Store:

- What happened.
- What action was taken.
- Whether it helped.
- What should be done differently next time.

### 4.9 Improve

The Self Engine and Reflection Engine use action history to adjust policies, update procedures, and generate training/evaluation data.

## 5. Memory Design

Memory must be layered, not just vector search.

### 5.1 Memory Types

| Type | Purpose |
|---|---|
| Identity Memory | User identity, device profile, environment |
| Preference Memory | Style, workflow, response preferences |
| Fact Memory | Stable project/config/factual information |
| Episodic Memory | What happened in a time-bound context |
| Task Memory | Goals, progress, blockers, next actions |
| Procedural Memory | Reusable "how to do this" workflows |
| Relationship Memory | People, projects, devices, services, ownership |
| Reflection Memory | Lessons learned from success/failure |

### 5.2 Storage

Recommended first implementation:

```text
SQLite
  memories
  memory_links
  events
  tasks
  tools
  actions
  audits
  self_health

LanceDB
  memory_vectors
  file_vectors
  conversation_vectors

Markdown Vault
  MEMORY.md
  PROJECTS.md
  PEOPLE.md
  PROCEDURES.md
  REFLECTIONS.md
```

### 5.3 Memory Write Policy

The system should auto-save when content looks like:

- Stable preference.
- Reusable fact.
- Project decision.
- User identity or environment fact.
- Repeated behavior pattern.
- Task progress.
- Failure lesson.
- Successful procedure.

The system should not auto-save:

- Raw secrets.
- Temporary emotional noise.
- One-off irrelevant messages.
- Sensitive data without clear permission.
- Low-confidence inferences as facts.

### 5.4 Memory Recall Policy

Before each meaningful response or action:

- Build a query from current user message, current situation, active project, and task.
- Search vector memory and exact keyword memory.
- Filter by relevance, recency, confidence, and safety.
- Inject only the most useful memories.
- Record which memories were used.

## 6. World Model

The World Model stores relationships.

Entities:

- User.
- People.
- Projects.
- Devices.
- Apps.
- Files.
- Services.
- Accounts.
- Tasks.
- Procedures.
- Locations.

Relationships:

- User works on project.
- Project uses service.
- Service runs on device.
- File belongs to project.
- Person owns project.
- Task depends on file/service/person.

This enables JARVIS to answer and act with context, not isolated memory snippets.

## 7. Tool Runtime

Every tool must use a standard declaration:

```json
{
  "name": "filesystem.search",
  "description": "Search local files",
  "riskLevel": "L0",
  "requiresConfirmation": false,
  "canRollback": false,
  "inputSchema": {
    "query": "string",
    "root": "string"
  }
}
```

### 7.1 Initial Tools

- `memory.search`
- `memory.store`
- `task.create`
- `task.resume`
- `notification.send`
- `filesystem.search`
- `filesystem.read`
- `filesystem.write`
- `backup.create`
- `browser.open`
- `browser.extract`
- `powershell.run`
- `app.launch`
- `screen.capture`
- `screen.ocr`
- `clipboard.read`
- `system.health`

## 8. Safety Kernel

Proactivity without safety becomes dangerous. The Safety Kernel is mandatory.

### 8.1 Permission Levels

| Level | Examples | Default |
|---|---|---|
| L0 | Read memory, check status, search filenames | Automatic |
| L1 | Open browser, create draft, create backup | Automatic |
| L2 | Modify files, run known safe scripts | Light confirmation |
| L3 | Delete, send messages, change system settings | Strong confirmation |
| L4 | Secrets, payment, irreversible actions | Blocked unless explicitly enabled |

### 8.2 Audit Requirements

All tool calls must log:

- Who/what initiated it.
- Which memory/context caused it.
- Tool name and input.
- Risk level.
- Confirmation status.
- Output summary.
- Verification result.
- Rollback artifact if applicable.

## 9. Self Engine

The Self Engine gives the system operational self-awareness.

### 9.1 Self-State

It tracks:

- Service health.
- Model health.
- Memory health.
- Tool health.
- Latency.
- Error rates.
- Action success rates.
- User dismissal rate.
- Interruption frequency.
- Upgrade status.

### 9.2 Self Loop

```text
Observe Self -> Diagnose -> Learn -> Propose Fix -> Test -> Apply -> Monitor -> Rollback
```

### 9.3 Self Actions

- Restart a failed internal service.
- Rebuild memory index.
- Disable a failing tool.
- Switch model provider.
- Lower proactive notification frequency.
- Generate a bug report.
- Propose an upgrade.
- Run upgrade in sandbox.
- Roll back after failed checks.

## 10. Model Router

Do not bind the system to one model.

Model roles:

```text
fast_local_model
  Classification, proactive scoring, low-risk background judgment

strong_model
  Complex reasoning, planning, coding, long-form analysis

embedding_model
  Memory/file/conversation retrieval

vision_model
  Screen and image understanding

safety_model_or_rules
  Risk classification and policy checks
```

Recommended runtime modes:

```text
Hybrid Mode
  Local small model always-on + API strong model for hard work

Local Mode
  Ollama/llama.cpp + local embeddings + local ASR/TTS

API Mode
  Best model quality, fastest product iteration
```

## 11. Voice Layer

Voice pipeline:

```text
Wake word -> ASR -> Intent/Situation -> Model/Tools -> TTS
```

Recommended components:

- Wake word: openWakeWord.
- ASR: whisper.cpp.
- TTS: Piper or Kokoro.
- Voice states: idle, listening, thinking, acting, speaking, muted.

Voice modes:

- Normal: listens only after wake word.
- Silent: no speech, only text/HUD.
- Tactical: more frequent spoken updates during active work.
- Meeting: summarize and extract action items.

## 12. Proactive Scenarios

First scenarios to implement:

1. Service down detection and recovery suggestion.
2. Error log detection and historical fix recall.
3. Clipboard error detection and background diagnosis.
4. Long idle/block detection with gentle reminder.
5. Repeated operation detection and automation suggestion.
6. High-risk delete/modify interception.
7. New project detection and memory creation.
8. Daily unfinished task recovery.
9. System resource anomaly warning.
10. Memory retrieval failure self-repair.
11. Model latency degradation fallback.
12. Upgrade preflight test and rollback.

## 13. Development Phases

### Phase 0: Product Boundary

Duration: 1-2 days.

Deliverables:

- Personality definition.
- Permission policy.
- Proactive levels.
- Project layout.
- Config format.

### Phase 1: Foundation

Duration: 1 week.

Build:

- Local Gateway.
- WebSocket/HTTP API.
- Event Bus.
- Plugin/tool registry.
- Config loader.
- JSONL logs.
- Health endpoint.

Acceptance:

- Service starts reliably.
- Health check works.
- Events can be written/read.
- Tools can register.
- Basic UI can connect.

### Phase 2: Model Router

Duration: 1 week.

Build:

- OpenAI-compatible model adapter.
- Ollama/local adapter.
- Embedding adapter.
- JSON/structured output helper.
- Model fallback policy.

Acceptance:

- Local model call works.
- API model call works.
- Embedding call works.
- Failure can switch fallback.

### Phase 3: Memory Core

Duration: 2 weeks.

Build:

- SQLite memory store.
- LanceDB vector store.
- Auto memory write.
- Auto memory recall.
- Memory dedupe.
- Markdown vault mirror.

Acceptance:

- Durable memory survives restart.
- New conversation recalls old memory.
- Memory search returns relevant results.
- No raw secrets stored.

### Phase 4: Initiative Engine

Duration: 2-3 weeks.

Build:

- Situation classifier.
- Attention score.
- Initiative score.
- Proactive decision state machine.
- Background preparation queue.
- Notification strategy.

Acceptance:

- System can decide silence vs notify.
- Low-value events do not interrupt.
- High-value events produce useful suggestions.
- Decisions are auditable.

### Phase 5: Tool Runtime and Safety

Duration: 2 weeks.

Build:

- Filesystem tools.
- Browser tools.
- PowerShell tools.
- Screenshot/OCR tools.
- Notification tools.
- Backup tools.
- Confirmation UI.
- Audit logs.

Acceptance:

- L0/L1 tools run automatically.
- L2+ asks confirmation.
- Tool calls are logged.
- Reversible actions create rollback artifacts.

### Phase 6: Self Engine

Duration: 2-3 weeks.

Build:

- Health monitors.
- Failure counters.
- Self-diagnosis rules.
- Self-repair actions.
- Upgrade preflight.
- Rollback policy.

Acceptance:

- Failed service can be detected.
- Memory/tool/model failures are reported.
- Safe self-repair can run.
- Bad upgrade can roll back.

### Phase 7: Voice and Personality

Duration: 2 weeks.

Build:

- Wake word.
- ASR.
- TTS.
- Floating HUD.
- Personality prompts.
- Voice state machine.

Acceptance:

- User can wake JARVIS by voice.
- JARVIS can answer by voice.
- Voice can be muted.
- Personality remains consistent.

### Phase 8: Long-Term Learning

Duration: ongoing.

Build:

- Reflection records.
- Feedback capture.
- Training dataset export.
- Evaluation set.
- LoRA/SFT pipeline later.

Acceptance:

- System can explain what it learned.
- Behavior policies can be adjusted from feedback.
- Training data can be exported without secrets.

## 14. MVP Definition

The first usable MVP must include:

- Desktop/web chat.
- Local Gateway.
- Model Router.
- Memory Core.
- Event Bus.
- Basic Initiative Engine.
- Tool Runtime with filesystem/browser/notification.
- Safety confirmation.
- Self-health endpoint.

MVP user experience:

```text
JARVIS runs quietly.
It remembers stable facts.
It recalls relevant context before replying.
It sees basic computer events.
It suggests help when useful.
It executes safe tools.
It asks before risky actions.
It reports its own health.
```

## 15. Immediate Build Order

1. Create monorepo structure.
2. Add Gateway service.
3. Add config loader.
4. Add event store.
5. Add health endpoint.
6. Add tool registry.
7. Add model router interface.
8. Add first chat endpoint.
9. Add memory schema.
10. Add initiative decision schema.

This order keeps the system testable from the first day.
