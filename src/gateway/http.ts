import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { ActionStore } from "../actions/action-store.js";
import { briefingToPrompt, generateBriefing } from "../briefing/briefing.js";
import type { LoadedConfig } from "../config/config.js";
import { ConversationStore, normalizeSessionId } from "../conversation/conversation-store.js";
import { buildEnterpriseReadinessReport } from "../enterprise/readiness.js";
import { JsonlEventStore } from "../events/event-store.js";
import { buildActionTools } from "./action-tools.js";
import { buildBriefingTools } from "./briefing-tools.js";
import { buildEnterpriseTools } from "./enterprise-tools.js";
import { buildInitiativeTools } from "./initiative-tools.js";
import { buildMemoryTools } from "./memory-tools.js";
import { buildMaintenanceTools } from "./maintenance-tools.js";
import { buildNotificationTools } from "./notification-tools.js";
import { buildPerceptionTools } from "./perception-tools.js";
import { buildReflectionTools } from "./reflection-tools.js";
import { buildRepairTools } from "./repair-tools.js";
import { buildReminderTools } from "./reminder-tools.js";
import { buildSelfTools } from "./self-tools.js";
import { buildVoiceTools } from "./voice-tools.js";
import { buildWorldTools } from "./world-tools.js";
import { ActiveLoop } from "../initiative/active-loop.js";
import { extractMemoryCandidates } from "../memory/memory-intake.js";
import { ModelRouter, UpstreamHttpError, type ChatMessage } from "../model-router/model-router.js";
import { createNotificationForEvent } from "../notifications/event-notifications.js";
import { NotificationStore } from "../notifications/notification-store.js";
import { PerceptionLoop } from "../perception/perception-loop.js";
import { ReflectionLoop } from "../reflection/reflection-loop.js";
import { ReflectionStore } from "../reflection/reflection-store.js";
import { ReminderLoop } from "../reminders/reminder-loop.js";
import { ReminderStore } from "../reminders/reminder-store.js";
import { diagnoseSelf } from "../self/self-diagnostics.js";
import { buildSelfAwarenessReport } from "../self/self-model.js";
import { buildSelfRepairPlan, runSelfPreflight } from "../self/self-repair.js";
import { VectorMemoryStore } from "../memory/vector-memory-store.js";
import type { HealthSnapshot, JarvisEvent } from "../shared/types.js";
import { resolveProjectPath } from "../config/config.js";
import { SafetyKernel } from "../safety/safety-kernel.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import { buildLocalRuntimeTools } from "../tool-runtime/local-tools.js";
import { WindowsVoice } from "../voice/windows-voice.js";
import { WorldStore } from "../world/world-store.js";
import { buildSystemTools } from "./system-tools.js";

const VERSION = "0.1.0";

type JsonBody = Record<string, unknown>;

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

async function readJsonBody(req: http.IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as JsonBody) : {};
}

async function readRawBody(req: http.IncomingMessage, maxBytes = 30 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new Error(`Request body is too large (${totalBytes} > ${maxBytes}).`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function writeJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const raw = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function notFound(res: http.ServerResponse): void {
  writeJson(res, 404, { ok: false, error: "Not found" });
}

function recordFrom(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nestedRecordFrom(value: unknown, key: string): Record<string, unknown> | undefined {
  const record = recordFrom(value);
  if (!record || !(key in record)) {
    return undefined;
  }
  return recordFrom(record[key]);
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function serveFile(
  res: http.ServerResponse,
  rootDir: string,
  relativePath: string,
): Promise<boolean> {
  const root = path.resolve(rootDir);
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== root) {
    writeJson(res, 403, { ok: false, error: "Forbidden" });
    return true;
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": STATIC_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      "Content-Length": data.byteLength,
      "Cache-Control": "no-store",
    });
    res.end(data);
    return true;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

export type GatewayRuntime = {
  server: http.Server;
  actionStore: ActionStore;
  conversationStore: ConversationStore;
  eventStore: JsonlEventStore;
  notificationStore: NotificationStore;
  reminderStore: ReminderStore;
  reminderLoop: ReminderLoop;
  perceptionLoop: PerceptionLoop;
  worldStore: WorldStore;
  reflectionStore: ReflectionStore;
  reflectionLoop: ReflectionLoop;
  voice: WindowsVoice;
  memoryStore: VectorMemoryStore;
  activeLoop: ActiveLoop;
  toolRegistry: ToolRegistry;
  modelRouter: ModelRouter;
  health: () => HealthSnapshot;
};

export async function createGateway(loaded: LoadedConfig): Promise<GatewayRuntime> {
  const startedAt = Date.now();
  const eventStore = new JsonlEventStore(
    resolveProjectPath(loaded.rootDir, loaded.config.storage.eventLogPath),
  );
  await eventStore.initialize();
  const actionStore = new ActionStore(
    resolveProjectPath(loaded.rootDir, loaded.config.storage.actionLogPath),
  );
  await actionStore.initialize();
  const notificationStore = new NotificationStore(
    resolveProjectPath(loaded.rootDir, loaded.config.storage.notificationLogPath),
  );
  await notificationStore.initialize();
  const reminderStore = new ReminderStore(
    resolveProjectPath(loaded.rootDir, loaded.config.storage.reminderLogPath),
  );
  await reminderStore.initialize();
  const worldStore = new WorldStore(
    resolveProjectPath(loaded.rootDir, loaded.config.storage.worldModelPath),
  );
  await worldStore.initialize();
  await worldStore.upsertEntity({
    type: "project",
    name: "JARVIS-OS",
    summary: "Local proactive personal AI operating layer.",
    tags: ["local", "assistant", "control-plane"],
    attributes: {
      rootDir: loaded.rootDir,
      endpoint: `http://${loaded.config.runtime.host}:${loaded.config.runtime.port}`,
    },
  });
  const reflectionStore = new ReflectionStore(
    resolveProjectPath(loaded.rootDir, loaded.config.storage.reflectionLogPath),
  );
  await reflectionStore.initialize();
  const conversationStore = new ConversationStore(
    resolveProjectPath(loaded.rootDir, loaded.config.storage.conversationDir),
  );
  await conversationStore.initialize();

  const modelRouter = new ModelRouter(loaded);
  const voice = new WindowsVoice(loaded.config.voice);
  const memoryStore = new VectorMemoryStore(
    resolveProjectPath(loaded.rootDir, loaded.config.storage.memoryLogPath),
    modelRouter,
    {
      vaultDir: resolveProjectPath(loaded.rootDir, loaded.config.storage.memoryVaultDir),
    },
  );
  await memoryStore.initialize();
  const safety = new SafetyKernel(loaded.config.safety);
  const subscribers = new Set<(event: JarvisEvent<unknown>) => void>();
  const emitEvent = async <TPayload>(
    event: Omit<JarvisEvent<TPayload>, "id" | "timestamp">,
  ): Promise<void> => {
    const written = await eventStore.append(event);
    const notification = await createNotificationForEvent(notificationStore, written);
    for (const subscriber of subscribers) {
      subscriber(written as JarvisEvent<unknown>);
    }
    if (notification) {
      for (const subscriber of subscribers) {
        subscriber({
          id: notification.id,
          type: "notification.created",
          source: notification.source,
          timestamp: notification.createdAt,
          importance: notification.level === "critical" ? 0.95 : 0.65,
          payload: notification,
        });
      }
    }
  };
  void voice
    .preloadAsr()
    .then(async () => {
      await emitEvent({
        type: "voice.asr.preloaded",
        source: "voice",
        importance: 0.15,
        payload: {
          provider: voice.status().asrProvider,
          model: voice.status().asrModel,
        },
      });
    })
    .catch(async (err) => {
      await emitEvent({
        type: "voice.asr.preload_failed",
        source: "voice",
        importance: 0.55,
        payload: {
          error: err instanceof Error ? err.message : String(err),
        },
      });
    });
  const toolRegistry = new ToolRegistry(safety, emitEvent, actionStore);
  const perceptionLoop = new PerceptionLoop({
    config: loaded.config.perception,
    emitEvent,
  });
  await perceptionLoop.tick();
  for (const tool of buildActionTools(actionStore)) {
    toolRegistry.register(tool);
  }
  for (const tool of buildNotificationTools(notificationStore)) {
    toolRegistry.register(tool);
  }
  for (const tool of buildReminderTools(reminderStore)) {
    toolRegistry.register(tool);
  }
  for (const tool of buildPerceptionTools(perceptionLoop)) {
    toolRegistry.register(tool);
  }
  for (const tool of buildSystemTools({ startedAt, modelRouter, eventStore })) {
    toolRegistry.register(tool);
  }
  for (const tool of buildMemoryTools(memoryStore)) {
    toolRegistry.register(tool);
  }
  for (const tool of buildLocalRuntimeTools({
    rootDir: loaded.rootDir,
    config: loaded.config.toolRuntime,
  })) {
    toolRegistry.register(tool);
  }
  for (const tool of buildWorldTools(worldStore)) {
    toolRegistry.register(tool);
  }
  for (const tool of buildReflectionTools(reflectionStore)) {
    toolRegistry.register(tool);
  }
  for (const tool of buildVoiceTools(voice)) {
    toolRegistry.register(tool);
  }
  for (const tool of buildMaintenanceTools({ memoryStore, worldStore, reflectionStore })) {
    toolRegistry.register(tool);
  }
  const activeLoop = new ActiveLoop({
    config: loaded.config,
    eventStore,
    memoryStore,
    emitEvent,
  });
  for (const tool of buildInitiativeTools(activeLoop)) {
    toolRegistry.register(tool);
  }
  activeLoop.start();
  const reminderLoop = new ReminderLoop({
    reminderStore,
    eventStore,
    emitEvent,
    intervalMs: 5000,
  });
  reminderLoop.start();
  const reflectionLoop = new ReflectionLoop({
    config: loaded.config.reflection,
    eventStore,
    reflectionStore,
    emitEvent,
  });
  await reflectionLoop.tick();
  reflectionLoop.start();
  const buildSelfReport = async () => {
    const sessions = await conversationStore.listSessions();
    const recentEvents = await eventStore.recent(80);
    return diagnoseSelf({
      uptimeMs: Date.now() - startedAt,
      tickMs: loaded.config.initiative.tickMs,
      activeLoop: activeLoop.status(),
      perceptionTickMs: loaded.config.perception.tickMs,
      perceptionLoop: perceptionLoop.status(),
      memoryRecords: memoryStore.count(),
      conversationSessions: sessions.length,
      pendingActions: actionStore.count("pending"),
      unreadNotifications: notificationStore.count("unread"),
      scheduledReminders: reminderStore.count("scheduled"),
      worldEntities: worldStore.countEntities(),
      worldRelations: worldStore.countRelations(),
      reflectionRecords: reflectionStore.count(),
      reflectionTickMs: loaded.config.reflection.tickMs,
      reflectionLoop: reflectionLoop.status(),
      voiceStatus: voice.status(),
      toolNames: toolRegistry.list().map((tool) => tool.name),
      modelStatus: modelRouter.status(),
      recentEvents,
    });
  };
  const buildBriefingReport = async () => {
    const selfReport = await buildSelfReport();
    const modelStatus = modelRouter.status();
    const routing = nestedRecordFrom(modelStatus, "routing");
    const chatLatency = nestedRecordFrom(routing, "chatLatency");
    return generateBriefing({
      selfSummary: selfReport.summary,
      selfOk: selfReport.ok,
      toolCount: toolRegistry.list().length,
      memoryRecords: selfReport.metrics.memoryRecords,
      worldEntities: selfReport.metrics.worldEntities,
      reflectionRecords: selfReport.metrics.reflectionRecords,
      unreadNotifications: selfReport.metrics.unreadNotifications,
      pendingActions: selfReport.metrics.pendingActions,
      scheduledReminders: selfReport.metrics.scheduledReminders,
      modelDefaultMode: stringFrom(routing?.defaultMode),
      chatLatencyLastMs:
        numberFrom(chatLatency?.lastMs) ?? selfReport.metrics.recentAssistantLatencyMs?.average,
      voiceAvailable: selfReport.metrics.voiceAvailable,
      perceptionRunning: perceptionLoop.status().running,
      recentFailures: selfReport.metrics.recentFailureEvents,
    });
  };
  const buildSelfModelReport = async () => {
    const diagnostic = await buildSelfReport();
    const preflight = await runSelfPreflight({
      rootDir: loaded.rootDir,
      diagnose: async () => diagnostic,
    });
    const repairPlan = buildSelfRepairPlan(preflight);
    return buildSelfAwarenessReport({
      diagnostic,
      preflight,
      repairPlan,
    });
  };
  for (const tool of buildSelfTools({ diagnose: buildSelfReport, model: buildSelfModelReport })) {
    toolRegistry.register(tool);
  }
  for (const tool of buildRepairTools({ rootDir: loaded.rootDir, diagnose: buildSelfReport })) {
    toolRegistry.register(tool);
  }
  for (const tool of buildBriefingTools({ generate: buildBriefingReport })) {
    toolRegistry.register(tool);
  }

  const health = (): HealthSnapshot => ({
    ok: true,
    ready: true,
    uptimeMs: Date.now() - startedAt,
    version: VERSION,
    components: {
      config: { ok: true, detail: "loaded" },
      actions: { ok: true, detail: `${actionStore.count("pending")} pending` },
      conversations: { ok: true, detail: loaded.config.storage.conversationDir },
      events: { ok: true, detail: loaded.config.storage.eventLogPath },
      notifications: { ok: true, detail: `${notificationStore.count("unread")} unread` },
      reminders: { ok: true, detail: `${reminderStore.count("scheduled")} scheduled` },
      memory: { ok: true, detail: `${memoryStore.count()} records` },
      world: {
        ok: true,
        detail: `${worldStore.countEntities()} entities, ${worldStore.countRelations()} relations`,
      },
      reflection: {
        ok: reflectionLoop.status().running,
        detail: `${reflectionStore.count()} records`,
      },
      voice: {
        ok: voice.status().available,
        detail: JSON.stringify(voice.status()),
      },
      initiative: {
        ok: activeLoop.status().running,
        detail: JSON.stringify(activeLoop.status()),
      },
      perception: {
        ok: perceptionLoop.status().running,
        detail: JSON.stringify(perceptionLoop.status()),
      },
      tools: { ok: true, detail: `${toolRegistry.list().length} registered` },
      models: {
        ok: true,
        detail: JSON.stringify(modelRouter.status()),
      },
    },
  });

  const buildEnterpriseReadiness = async () => {
    const selfReport = await buildSelfReport();
    const preflight = await runSelfPreflight({
      rootDir: loaded.rootDir,
      diagnose: async () => selfReport,
    });
    const selfModel = buildSelfAwarenessReport({
      diagnostic: selfReport,
      preflight,
      repairPlan: buildSelfRepairPlan(preflight),
    });
    return buildEnterpriseReadinessReport({
      health: health(),
      self: selfReport,
      selfModel,
      preflight,
      runtime: loaded.config.runtime,
      storage: loaded.config.storage,
      safety: loaded.config.safety,
      modelStatus: modelRouter.status(),
      voiceStatus: voice.status(),
      toolNames: toolRegistry.list().map((tool) => tool.name),
    });
  };

  for (const tool of buildEnterpriseTools({ readiness: buildEnterpriseReadiness })) {
    toolRegistry.register(tool);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      const cockpitDir = resolveProjectPath(loaded.rootDir, "ui/cockpit");
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/cockpit")) {
        if (await serveFile(res, cockpitDir, "index.html")) {
          return;
        }
      }
      if (req.method === "GET" && url.pathname.startsWith("/cockpit/")) {
        const relativePath = decodeURIComponent(url.pathname.slice("/cockpit/".length));
        if (await serveFile(res, cockpitDir, relativePath || "index.html")) {
          return;
        }
      }
      if (req.method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, health());
        return;
      }
      if (req.method === "GET" && url.pathname === "/readyz") {
        writeJson(res, 200, { ready: true, uptimeMs: Date.now() - startedAt });
        return;
      }
      if (req.method === "GET" && url.pathname === "/version") {
        writeJson(res, 200, { name: "JARVIS-OS", version: VERSION });
        return;
      }
      if (req.method === "GET" && url.pathname === "/models/status") {
        writeJson(res, 200, modelRouter.status());
        return;
      }
      if (req.method === "GET" && url.pathname === "/voice/status") {
        writeJson(res, 200, voice.status());
        return;
      }
      if (req.method === "GET" && url.pathname === "/voice/devices") {
        writeJson(res, 200, await voice.diagnoseDevices());
        return;
      }
      if (req.method === "POST" && url.pathname === "/voice/speak") {
        writeJson(res, 200, await toolRegistry.call("voice.speak", await readJsonBody(req)));
        return;
      }
      if (req.method === "POST" && url.pathname === "/voice/listen") {
        writeJson(res, 200, await toolRegistry.call("voice.listen_once", await readJsonBody(req)));
        return;
      }
      if (req.method === "POST" && url.pathname === "/voice/transcribe") {
        const audio = await readRawBody(req);
        const contentTypeHeader = req.headers["content-type"];
        writeJson(
          res,
          200,
          await voice.transcribeAudio({
            audio,
            contentType: Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader,
            language: url.searchParams.get("language") ?? undefined,
          }),
        );
        return;
      }
      if (req.method === "POST" && url.pathname === "/models/probe") {
        writeJson(res, 200, await modelRouter.probe());
        return;
      }
      if (req.method === "GET" && url.pathname === "/events/recent") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        writeJson(res, 200, { events: await eventStore.recent(limit) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/actions/pending") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        writeJson(res, 200, { actions: actionStore.list("pending", limit) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/notifications/unread") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        writeJson(res, 200, { notifications: notificationStore.list("unread", limit) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/reminders") {
        const status = url.searchParams.get("status");
        const limit = Number(url.searchParams.get("limit") ?? 50);
        writeJson(res, 200, {
          reminders: reminderStore.list(
            status === "scheduled" || status === "delivered" || status === "cancelled"
              ? status
              : undefined,
            limit,
          ),
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/reminders/create") {
        const result = await toolRegistry.call("reminders.create", await readJsonBody(req));
        writeJson(res, result.ok ? 200 : 400, result);
        return;
      }
      if (req.method === "POST" && url.pathname === "/reminders/cancel") {
        const body = await readJsonBody(req);
        if (typeof body.reminderId !== "string" || !body.reminderId.trim()) {
          writeJson(res, 400, {
            ok: false,
            error: "POST /reminders/cancel requires { reminderId: string }.",
          });
          return;
        }
        writeJson(res, 200, await toolRegistry.call("reminders.cancel", body));
        return;
      }
      if (req.method === "GET" && url.pathname === "/notifications") {
        const status = url.searchParams.get("status");
        const limit = Number(url.searchParams.get("limit") ?? 50);
        writeJson(res, 200, {
          notifications: notificationStore.list(
            status === "unread" || status === "read" || status === "dismissed"
              ? status
              : undefined,
            limit,
          ),
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/notifications/read") {
        const body = await readJsonBody(req);
        if (typeof body.notificationId !== "string" || !body.notificationId.trim()) {
          writeJson(res, 400, {
            ok: false,
            error: "POST /notifications/read requires { notificationId: string }.",
          });
          return;
        }
        writeJson(res, 200, { ok: true, notification: await notificationStore.markRead(body.notificationId) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/notifications/dismiss") {
        const body = await readJsonBody(req);
        if (typeof body.notificationId !== "string" || !body.notificationId.trim()) {
          writeJson(res, 400, {
            ok: false,
            error: "POST /notifications/dismiss requires { notificationId: string }.",
          });
          return;
        }
        writeJson(res, 200, { ok: true, notification: await notificationStore.dismiss(body.notificationId) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/actions") {
        const status = url.searchParams.get("status");
        const limit = Number(url.searchParams.get("limit") ?? 50);
        writeJson(res, 200, {
          actions: actionStore.list(
            status === "pending" ||
              status === "approved" ||
              status === "executed" ||
              status === "rejected" ||
              status === "failed"
              ? status
              : undefined,
            limit,
          ),
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/actions/approve") {
        const body = await readJsonBody(req);
        if (typeof body.actionId !== "string" || !body.actionId.trim()) {
          writeJson(res, 400, {
            ok: false,
            error: "POST /actions/approve requires { actionId: string }.",
          });
          return;
        }
        writeJson(res, 200, await toolRegistry.approveAndExecute(body.actionId));
        return;
      }
      if (req.method === "POST" && url.pathname === "/actions/reject") {
        const body = await readJsonBody(req);
        if (typeof body.actionId !== "string" || !body.actionId.trim()) {
          writeJson(res, 400, {
            ok: false,
            error: "POST /actions/reject requires { actionId: string }.",
          });
          return;
        }
        writeJson(
          res,
          200,
          await toolRegistry.rejectAction(
            body.actionId,
            typeof body.reason === "string" ? body.reason : undefined,
          ),
        );
        return;
      }
      if (req.method === "GET" && url.pathname === "/conversations") {
        writeJson(res, 200, { sessions: await conversationStore.listSessions() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/conversation/messages") {
        const sessionId = normalizeSessionId(url.searchParams.get("sessionId"));
        const limit = Number(url.searchParams.get("limit") ?? 50);
        writeJson(res, 200, {
          sessionId,
          messages: await conversationStore.recent(sessionId, limit),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/memory/recent") {
        const limit = Number(url.searchParams.get("limit") ?? 20);
        writeJson(res, 200, { memories: await memoryStore.recent(limit) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/world/snapshot") {
        writeJson(res, 200, worldStore.snapshot());
        return;
      }
      if (req.method === "GET" && url.pathname === "/world/find") {
        const query = url.searchParams.get("query") ?? "";
        const limit = Number(url.searchParams.get("limit") ?? 10);
        writeJson(res, 200, { entities: worldStore.findEntities(query, limit) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/world/upsert") {
        writeJson(res, 200, await toolRegistry.call("world.upsert_entity", await readJsonBody(req)));
        return;
      }
      if (req.method === "GET" && url.pathname === "/reflection/status") {
        writeJson(res, 200, reflectionLoop.status());
        return;
      }
      if (req.method === "POST" && url.pathname === "/reflection/tick") {
        writeJson(res, 200, { ok: true, recorded: await reflectionLoop.tick() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/reflection/list") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        writeJson(res, 200, { reflections: reflectionStore.list(limit) });
        return;
      }
      if (req.method === "GET" && url.pathname === "/initiative/status") {
        writeJson(res, 200, activeLoop.status());
        return;
      }
      if (req.method === "POST" && url.pathname === "/initiative/tick") {
        writeJson(res, 200, { ok: true, decision: await activeLoop.tick() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/perception/status") {
        writeJson(res, 200, perceptionLoop.status());
        return;
      }
      if (req.method === "GET" && url.pathname === "/self/diagnose") {
        writeJson(res, 200, await buildSelfReport());
        return;
      }
      if (req.method === "GET" && url.pathname === "/self/model") {
        writeJson(res, 200, await buildSelfModelReport());
        return;
      }
      if (req.method === "GET" && url.pathname === "/self/preflight") {
        writeJson(res, 200, await toolRegistry.call("self.preflight", {}));
        return;
      }
      if (req.method === "GET" && url.pathname === "/self/repair-plan") {
        writeJson(res, 200, await toolRegistry.call("self.repair_plan", {}));
        return;
      }
      if (req.method === "GET" && url.pathname === "/briefing") {
        writeJson(res, 200, await buildBriefingReport());
        return;
      }
      if (req.method === "GET" && url.pathname === "/enterprise/readiness") {
        writeJson(res, 200, await buildEnterpriseReadiness());
        return;
      }
      if (req.method === "GET" && url.pathname === "/tools/list") {
        writeJson(res, 200, { tools: toolRegistry.list() });
        return;
      }
      if (req.method === "POST" && url.pathname === "/tools/call") {
        const body = await readJsonBody(req);
        const name = typeof body.name === "string" ? body.name : "";
        const input = body.input;
        writeJson(res, 200, await toolRegistry.call(name, input));
        return;
      }
      if (req.method === "POST" && url.pathname === "/memory/store") {
        const body = await readJsonBody(req);
        if (typeof body.text !== "string" || !body.text.trim()) {
          writeJson(res, 400, {
            ok: false,
            error: "POST /memory/store requires { text: string }.",
          });
          return;
        }
        writeJson(res, 200, await toolRegistry.call("memory.store", body));
        return;
      }
      if (req.method === "POST" && url.pathname === "/memory/recall") {
        const body = await readJsonBody(req);
        if (typeof body.query !== "string" || !body.query.trim()) {
          writeJson(res, 400, {
            ok: false,
            error: "POST /memory/recall requires { query: string }.",
          });
          return;
        }
        writeJson(res, 200, await toolRegistry.call("memory.recall", body));
        return;
      }
      if (req.method === "POST" && url.pathname === "/chat") {
        const body = await readJsonBody(req);
        if (typeof body.message !== "string" || !body.message.trim()) {
          writeJson(res, 400, { ok: false, error: "POST /chat requires { message: string }." });
          return;
        }
        const sessionId = normalizeSessionId(body.sessionId);
        await emitEvent({
          type: "chat.user_message",
          source: "gateway",
          importance: 0.5,
          payload: { sessionId, message: body.message },
        });
        await conversationStore.append({
          sessionId,
          role: "user",
          content: body.message,
          metadata: { route: "/chat" },
        });
        let memoryContext = "No relevant long-term memory found.";
        let worldContext = "No relevant world model entities found.";
        let autoStoredMemories = 0;
        try {
          const candidates = extractMemoryCandidates(body.message, sessionId);
          for (const candidate of candidates) {
            const stored = await memoryStore.store(candidate);
            if (stored.created) {
              autoStoredMemories += 1;
            }
          }
          if (candidates.length > 0) {
            await emitEvent({
              type: "memory.auto_intake",
              source: "memory-intake",
              importance: 0.65,
              payload: {
                sessionId,
                candidates: candidates.length,
                created: autoStoredMemories,
                kinds: candidates.map((candidate) => candidate.kind),
              },
            });
          }
          const recalled = await memoryStore.recall({
            query: body.message,
            topK: 5,
            minScore: 0.48,
          });
          memoryContext =
            recalled.matches.length > 0
              ? recalled.matches
                  .map(
                    (match, index) =>
                      `${index + 1}. [${match.memory.kind}; score=${match.score.toFixed(3)}] ${match.memory.text}`,
                  )
                  .join("\n")
              : memoryContext;
          const worldMatches = worldStore.findEntities(body.message, 5);
          worldContext =
            worldMatches.length > 0
              ? worldMatches
                  .map(
                    (entity, index) =>
                      `${index + 1}. [${entity.type}] ${entity.name}: ${entity.summary || "no summary"}`,
                  )
                  .join("\n")
              : worldContext;
          const reflections = reflectionStore.find(body.message, 5);
          const reflectionContext =
            reflections.length > 0
              ? reflections
                  .map(
                    (reflection, index) =>
                      `${index + 1}. [${reflection.kind}] ${reflection.title}: ${reflection.summary}`,
                  )
                  .join("\n")
              : "No relevant reflections found.";
          worldContext = `${worldContext}\n\nRelevant reflections:\n${reflectionContext}`;
        } catch (memoryErr) {
          const message = memoryErr instanceof Error ? memoryErr.message : String(memoryErr);
          await emitEvent({
            type: "memory.chat_context_failed",
            source: "gateway",
            importance: 0.65,
            payload: { error: message },
          });
          memoryContext = "Long-term memory is temporarily unavailable.";
        }
        let briefingContext = "Current JARVIS briefing is temporarily unavailable.";
        try {
          briefingContext = briefingToPrompt(await buildBriefingReport());
        } catch (briefingErr) {
          await emitEvent({
            type: "briefing.chat_context_failed",
            source: "gateway",
            importance: 0.55,
            payload: {
              error: briefingErr instanceof Error ? briefingErr.message : String(briefingErr),
            },
          });
        }
        const history = await conversationStore.recent(sessionId, 16);
        const messages: ChatMessage[] = [
          {
            role: "system",
            content:
              "You are JARVIS-OS, a proactive personal AI operating layer. " +
              "Use relevant long-term memories and the current briefing when helpful, " +
              "but do not mention internal mechanics unless asked.\n\n" +
              `${briefingContext}\n\n` +
              `Relevant long-term memories:\n${memoryContext}\n\n` +
              `Relevant world model:\n${worldContext}`,
          },
          ...history
            .filter((message) => message.role === "user" || message.role === "assistant")
            .map((message) => ({
              role: message.role as "user" | "assistant",
              content: message.content,
            })),
        ];
        const reply = await modelRouter.chat({
          messages,
        });
        await conversationStore.append({
          sessionId,
          role: "assistant",
          content: reply.content,
          metadata: {
            provider: reply.provider,
            model: reply.model,
            mode: reply.mode,
            latencyMs: reply.latencyMs,
          },
        });
        await emitEvent({
          type: "chat.assistant_message",
          source: "model-router",
          importance: 0.5,
          payload: {
            sessionId,
            provider: reply.provider,
            model: reply.model,
            mode: reply.mode,
            content: reply.content,
            latencyMs: reply.latencyMs,
          },
        });
        writeJson(res, 200, { ok: true, sessionId, reply });
        return;
      }
      if (req.method === "POST" && url.pathname === "/embeddings") {
        const body = await readJsonBody(req);
        if (typeof body.text !== "string" || !body.text.trim()) {
          writeJson(res, 400, { ok: false, error: "POST /embeddings requires { text: string }." });
          return;
        }
        const embedding = await modelRouter.embed(body.text);
        writeJson(res, 200, {
          ok: true,
          provider: embedding.provider,
          model: embedding.model,
          dimensions: embedding.dimensions,
          preview: embedding.embedding.slice(0, 8),
        });
        return;
      }
      notFound(res);
    } catch (err) {
      if (err instanceof UpstreamHttpError) {
        try {
          await emitEvent({
            type: "model.upstream_failed",
            source: "gateway",
            importance: 0.8,
            payload: { statusCode: err.statusCode, error: err.summary },
          });
        } catch {
          // Preserve the original HTTP error response even if diagnostics logging fails.
        }
        writeJson(res, 502, {
          ok: false,
          error: `Upstream model request failed (${err.statusCode}): ${err.summary}`,
          upstreamStatus: err.statusCode,
        });
        return;
      }
      try {
        await emitEvent({
          type: "gateway.request_failed",
          source: "gateway",
          importance: 0.7,
          payload: { error: err instanceof Error ? err.message : String(err) },
        });
      } catch {
        // Preserve the original HTTP error response even if diagnostics logging fails.
      }
      writeJson(res, err instanceof SyntaxError ? 400 : 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const wss = new WebSocketServer({ server, path: "/events" });
  wss.on("connection", (socket) => {
    const subscriber = (event: JarvisEvent<unknown>) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "event", event }));
      }
    };
    subscribers.add(subscriber);
    socket.on("close", () => subscribers.delete(subscriber));
    socket.send(JSON.stringify({ type: "hello", service: "JARVIS-OS", version: VERSION }));
  });
  server.on("close", () => {
    activeLoop.stop();
    reminderLoop.stop();
    perceptionLoop.stop();
    reflectionLoop.stop();
  });

  await emitEvent({
    type: "gateway.started",
    source: "gateway",
    importance: 0.6,
    payload: { host: loaded.config.runtime.host, port: loaded.config.runtime.port },
  });
  perceptionLoop.start();

  return {
    server,
    actionStore,
    conversationStore,
    eventStore,
    notificationStore,
    reminderStore,
    reminderLoop,
    perceptionLoop,
    worldStore,
    reflectionStore,
    reflectionLoop,
    voice,
    memoryStore,
    activeLoop,
    toolRegistry,
    modelRouter,
    health,
  };
}

export async function listen(runtime: GatewayRuntime, loaded: LoadedConfig): Promise<AddressInfo> {
  const { host, port } = loaded.config.runtime;
  await new Promise<void>((resolve) => {
    runtime.server.listen(port, host, resolve);
  });
  return runtime.server.address() as AddressInfo;
}
