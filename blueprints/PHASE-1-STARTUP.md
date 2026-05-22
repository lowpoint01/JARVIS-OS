# Phase 1 Startup Blueprint

This is the immediate build plan for the first working foundation of JARVIS-OS.

## Goal

Create a minimal but solid local runtime that can:

- Start a local Gateway.
- Expose health endpoints.
- Persist events.
- Register tools.
- Load config.
- Connect a basic UI/client.
- Provide the foundation for Memory Core and Initiative Engine.

## Proposed Initial Stack

```text
Runtime: Node.js + TypeScript
Package manager: pnpm
API: HTTP + WebSocket
Database: SQLite
Logs: JSONL
Config: YAML
Tests: Vitest
Desktop UI: later, after Gateway foundation
```

## Initial Directory Layout

```text
apps/
  desktop/
services/
  gateway/
  model-router/
  memory-core/
  initiative-engine/
  self-engine/
  tool-runtime/
packages/
  shared/
  config/
  events/
  tools/
  safety/
data/
  events/
  memory/
  logs/
configs/
  config.yaml
  permissions.yaml
docs/
  OVERALL_EXECUTION_PLAN.md
blueprints/
  PHASE-1-STARTUP.md
```

## Phase 1 Modules

### 1. Config Loader

Reads:

- `configs/config.yaml`
- `configs/permissions.yaml`
- environment overrides

Must support:

- model settings
- memory settings
- safety settings
- service ports
- log paths

### 2. Gateway

Endpoints:

```text
GET /health
GET /readyz
GET /version
POST /chat
GET /events/recent
POST /tools/call
WS /events
```

### 3. Event Store

First version can use SQLite plus JSONL mirror.

Event shape:

```json
{
  "id": "evt_001",
  "type": "system.health",
  "source": "gateway",
  "timestamp": 1770000000000,
  "importance": 0.2,
  "payload": {}
}
```

### 4. Tool Registry

Tool shape:

```json
{
  "name": "system.health",
  "description": "Read system health",
  "riskLevel": "L0",
  "requiresConfirmation": false
}
```

### 5. Safety Gate

First rules:

- L0 and L1 can run automatically.
- L2 returns `needs_confirmation`.
- L3 and L4 blocked until confirmation UI exists.

### 6. Self Health

Track:

- gateway uptime
- event store writable
- config loaded
- tool registry loaded
- model router status placeholder
- memory core status placeholder

## Day-1 Tasks

1. Initialize package structure.
2. Add TypeScript config.
3. Add Gateway service skeleton.
4. Add `/health` and `/readyz`.
5. Add config loader.
6. Add event store interface.
7. Add JSONL event writer.
8. Add tool registry interface.
9. Register `system.health` tool.
10. Add first smoke test.

## Phase 1 Acceptance Criteria

Phase 1 is complete when:

- `pnpm install` succeeds.
- `pnpm dev:gateway` starts the Gateway.
- `GET /readyz` returns ready.
- An event can be written and read back.
- A tool can be registered and listed.
- `system.health` can be called.
- Logs are written to `data/logs`.
- Basic tests pass.

## Next Phase Gate

Do not start Memory Core implementation until:

- Gateway starts reliably.
- Event persistence works.
- Tool registry works.
- Safety gate exists.
