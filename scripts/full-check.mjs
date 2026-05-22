import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "http://127.0.0.1:31888";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const results = [];
const mojibakePattern =
  /[\uFFFD]|\u935e|\u93ba|\u9477|\u93c8|\u7039|\u5a0c|\u9429|\u95c0|\u93c3|\u93cd|\u9359|\u7487|\u5a34|\u7ee0/;

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark} ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) {
    throw new Error(`${name} failed${detail ? `: ${detail}` : ""}`);
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    headers: options.body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
    ...options,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  return data;
}

async function post(path, body) {
  return await api(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function removeReturnedBackup(relativePath) {
  if (typeof relativePath !== "string") {
    return;
  }
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized.startsWith("data/backups/")) {
    return;
  }
  await rm(path.resolve(root, relativePath), { force: true });
}

async function removeReturnedAudio(audioFilePath) {
  if (typeof audioFilePath !== "string") {
    return;
  }
  const resolved = path.resolve(audioFilePath);
  const audioRoot = path.resolve(root, "data", "audio-cache");
  if (!resolved.startsWith(`${audioRoot}${path.sep}`)) {
    return;
  }
  await rm(path.dirname(resolved), { recursive: true, force: true });
}

async function isReady() {
  try {
    const ready = await api("/readyz");
    return Boolean(ready.ready);
  } catch {
    return false;
  }
}

async function waitReady(timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isReady()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return false;
}

async function main() {
  if (!(await isReady())) {
    if (await waitReady(15_000)) {
      record("service.ready", true, "gateway became ready after wait");
    } else {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(root, "scripts", "start-gateway.ps1"),
        ],
        { cwd: root, stdio: "inherit" },
      );
      record("service.start", await waitReady(), "gateway reached ready state");
    }
  } else {
    record("service.ready", true, "gateway already ready");
  }

  const cockpit = await fetch(`${base}/`);
  const cockpitText = await cockpit.text();
  record(
    "cockpit.html",
    cockpit.ok &&
      cockpitText.includes("JARVIS-OS 控制台") &&
      cockpitText.includes("主动唤醒") &&
      cockpitText.includes("开启实时语音对话") &&
      cockpitText.includes("朗读上一条回复") &&
      cockpitText.includes("企业就绪") &&
      cockpitText.includes("事件流"),
    `status=${cockpit.status}`,
  );
  const cockpitScript = await fetch(`${base}/cockpit/app.js`);
  const cockpitScriptText = await cockpitScript.text();
  record(
    "cockpit.script",
      cockpitScript.ok &&
      cockpitScriptText.includes("企业级就绪") &&
      cockpitScriptText.includes("语音输入") &&
      cockpitScriptText.includes("实时语音") &&
      !mojibakePattern.test(cockpitScriptText),
    `status=${cockpitScript.status}`,
  );

  const [health, self, selfModel, tools, perception, briefing] = await Promise.all([
    api("/health"),
    api("/self/diagnose"),
    api("/self/model"),
    api("/tools/list"),
    api("/perception/status"),
    api("/briefing"),
  ]);
  record("health", health.ok && health.ready, health.components.tools.detail);
  record("self.diagnose", self.ok, self.summary);
  record(
    "self.model",
    ["ready", "watch", "repair_needed"].includes(selfModel.posture) &&
      typeof selfModel.stabilityScore === "number" &&
      Array.isArray(selfModel.capabilities),
    `${selfModel.posture} score=${selfModel.stabilityScore}`,
  );
  const selfModelTool = await post("/tools/call", {
    name: "self.model",
    input: {},
  });
  record(
    "self.model.tool",
    selfModelTool.ok && typeof selfModelTool.output.stabilityScore === "number",
    selfModelTool.output?.posture ?? "",
  );
  record("tools.registered", tools.tools.length >= 48, `${tools.tools.length} tools`);
  record(
    "briefing.endpoint",
    typeof briefing.headline === "string" &&
      ["ok", "watch", "action"].includes(briefing.severity) &&
      Array.isArray(briefing.sections),
    briefing.severity,
  );
  const briefingTool = await post("/tools/call", {
    name: "briefing.generate",
    input: {},
  });
  record(
    "briefing.tool",
    briefingTool.ok && typeof briefingTool.output.headline === "string",
    briefingTool.output?.severity ?? "",
  );
  const initiativeStatus = await api("/initiative/status");
  record(
    "initiative.status",
    initiativeStatus.running &&
      typeof initiativeStatus.tickCount === "number" &&
      typeof initiativeStatus.executedPlanCount === "number",
    `${initiativeStatus.tickCount} ticks`,
  );
  const initiativeStatusTool = await post("/tools/call", {
    name: "initiative.status",
    input: {},
  });
  record(
    "initiative.status.tool",
    initiativeStatusTool.ok && initiativeStatusTool.output.running,
    `${initiativeStatusTool.output.tickCount} ticks`,
  );
  const maintenanceBefore = await post("/tools/call", {
    name: "maintenance.status",
    input: {},
  });
  record(
    "maintenance.status",
    maintenanceBefore.ok && typeof maintenanceBefore.output.memoryRecords === "number",
  );
  const voiceStatus = await api("/voice/status");
  record(
    "voice.status",
    voiceStatus.available &&
      voiceStatus.ttsProvider === "msedge-tts" &&
      voiceStatus.asrProvider === "faster-whisper",
    `asr=${voiceStatus.asrProvider}/${voiceStatus.asrModel}; tts=${voiceStatus.ttsProvider}/${voiceStatus.ttsVoice}/${voiceStatus.platform}`,
  );
  const voiceDevices = await api("/voice/devices");
  record(
    "voice.devices",
    voiceDevices.ok && voiceDevices.microphones.length >= 1 && voiceDevices.defaultInputUsable,
    `${voiceDevices.summary} microphones=${voiceDevices.microphones.length}`,
  );
  const voiceDryRun = await post("/tools/call", {
    name: "voice.speak",
    input: { text: "JARVIS voice dry run", dryRun: true },
  });
  record("voice.speak.dry_run", voiceDryRun.ok && voiceDryRun.output.dryRun);
  const ttsProbe = await post("/tools/call", {
    name: "voice.tts_probe",
    input: { text: "JARVIS TTS probe." },
  });
  record(
    "voice.tts_probe",
    ttsProbe.ok && ttsProbe.output.provider === "msedge-tts" && ttsProbe.output.audioBytes > 1000,
    `${ttsProbe.output?.voice ?? "unknown"} ${ttsProbe.output?.audioBytes ?? 0} bytes`,
  );
  await removeReturnedAudio(ttsProbe.output?.audioFile);
  const asrDryRun = await post("/tools/call", {
    name: "voice.transcribe_audio",
    input: {
      dryRun: true,
      audioBase64: Buffer.from("dry-run").toString("base64"),
      contentType: "audio/wav",
    },
  });
  record(
    "voice.transcribe_audio.dry_run",
    asrDryRun.ok && asrDryRun.output.provider === "faster-whisper" && asrDryRun.output.model === "large-v3-turbo",
    `${asrDryRun.output?.provider ?? "unknown"}/${asrDryRun.output?.model ?? "unknown"}`,
  );
  const voiceListenDryRun = await post("/tools/call", {
    name: "voice.listen_once",
    input: { dryRun: true, timeoutMs: 1000 },
  });
  record("voice.listen.dry_run", voiceListenDryRun.ok && voiceListenDryRun.output.dryRun);
  const modelStatus = await api("/models/status");
  record(
    "model.status",
    modelStatus.routing?.defaultMode === "fast" && modelStatus.chat?.hasKey && modelStatus.embedding?.hasKey,
    modelStatus.routing?.defaultMode ?? "unknown",
  );
  const modelProbe = await post("/tools/call", {
    name: "model.probe",
    input: {},
  });
  record(
    "model.probe",
    modelProbe.ok && modelProbe.output.ok && modelProbe.output.chat?.ok && modelProbe.output.embedding?.ok,
    `chat=${modelProbe.output.chat?.latencyMs ?? "unknown"}ms`,
  );
  record(
    "perception.loop",
    perception.running && perception.tickCount >= 1 && Boolean(perception.lastSample),
    `${perception.tickCount} ticks`,
  );
  const perceptionTool = await post("/tools/call", {
    name: "perception.status",
    input: {},
  });
  record(
    "perception.tool",
    perceptionTool.ok && perceptionTool.output.running && perceptionTool.output.tickCount >= 1,
    `${perceptionTool.output.tickCount} ticks`,
  );

  const embedding = await api("/embeddings", {
    method: "POST",
    body: JSON.stringify({ text: `JARVIS full check embedding ${runId}` }),
  });
  record("embedding.live", embedding.ok && embedding.dimensions >= 1024, `${embedding.dimensions} dims`);

  const trivialExtract = await post("/tools/call", {
    name: "memory.extract",
    input: { sessionId: "full-check", message: "你好" },
  });
  record("memory.extract.trivial", trivialExtract.ok && trivialExtract.output.length === 0);

  const explicitExtract = await post("/tools/call", {
    name: "memory.extract",
    input: { sessionId: "full-check", message: `Remember: full check memory ${runId}.` },
  });
  record("memory.extract.explicit", explicitExtract.ok && explicitExtract.output.length === 1);

  const memoryStore = await post("/memory/store", {
    text: `Full check durable memory ${runId}`,
    kind: "fact",
    scope: "full-check",
    tags: ["full-check"],
    importance: 0.7,
    confidence: 0.9,
    source: "full-check",
  });
  record("memory.store", memoryStore.ok, memoryStore.output?.memory?.id ?? "");

  const memoryRecall = await post("/memory/recall", {
    query: `durable memory ${runId}`,
    scope: "full-check",
    topK: 3,
    minScore: 0.1,
  });
  record("memory.recall", memoryRecall.ok && memoryRecall.output.matches.length > 0);

  const redactedMemory = await post("/memory/store", {
    text: `Full check secret redaction token=sk-${runId.replace(/[^a-zA-Z0-9]/g, "")}abcdefghijklmnopqrstuvwxyz`,
    kind: "system",
    scope: "full-check",
    tags: ["full-check", "redaction"],
    importance: 0.7,
    confidence: 0.9,
    source: "full-check",
  });
  record(
    "memory.redaction",
    redactedMemory.ok && redactedMemory.output.memory.text.includes("[REDACTED:assignment_secret]"),
  );
  const vaultStatus = await post("/tools/call", {
    name: "memory.vault_status",
    input: {},
  });
  record("memory.vault", vaultStatus.ok && vaultStatus.output.enabled && vaultStatus.output.records > 0);

  const fileSearch = await post("/tools/call", {
    name: "files.search",
    input: { query: "README", limit: 10 },
  });
  record(
    "files.search",
    fileSearch.ok && fileSearch.output.some((item) => item.path === "README.md"),
  );

  const fileRead = await post("/tools/call", {
    name: "files.read",
    input: { path: "README.md", maxBytes: 10000 },
  });
  record(
    "files.read",
    fileRead.ok && fileRead.output?.content?.includes("JARVIS-OS"),
    fileRead.ok ? `${fileRead.output.bytes} bytes` : fileRead.error,
  );

  const fileBackup = await post("/tools/call", {
    name: "files.backup",
    input: { path: "README.md" },
  });
  record("files.backup", fileBackup.ok && fileBackup.output.backup.includes("data"));

  const powershellProposal = await post("/tools/call", {
    name: "powershell.run",
    input: { command: "Write-Output 'JARVIS approval proof'", timeoutMs: 3000 },
  });
  record(
    "powershell.confirmation",
    !powershellProposal.ok &&
      powershellProposal.status === "needs_confirmation" &&
      Boolean(powershellProposal.actionId),
    powershellProposal.actionId ?? "",
  );
  let powershellNotification;
  if (powershellProposal.actionId) {
    const unreadAfterPowershell = await api("/notifications/unread?limit=50");
    powershellNotification = unreadAfterPowershell.notifications.find(
      (notification) => notification.actionId === powershellProposal.actionId,
    );
    record("notifications.from_powershell_confirmation", Boolean(powershellNotification));
    await post("/actions/reject", {
      actionId: powershellProposal.actionId,
      reason: "full check does not execute shell commands",
    });
    if (powershellNotification) {
      await post("/notifications/read", { notificationId: powershellNotification.id });
    }
  }

  const worldProject = await post("/tools/call", {
    name: "world.upsert_entity",
    input: {
      type: "project",
      name: `Full Check Project ${runId}`,
      summary: "Runtime verification world model entity.",
      tags: ["full-check"],
      attributes: { runId },
    },
  });
  record("world.upsert.project", worldProject.ok && Boolean(worldProject.output.id), worldProject.output?.id ?? "");

  const worldService = await post("/tools/call", {
    name: "world.upsert_entity",
    input: {
      type: "service",
      name: `Full Check Service ${runId}`,
      summary: "Runtime verification service entity.",
      tags: ["full-check"],
      attributes: { runId },
    },
  });
  record("world.upsert.service", worldService.ok && Boolean(worldService.output.id), worldService.output?.id ?? "");

  const worldLink = await post("/tools/call", {
    name: "world.link",
    input: {
      fromId: worldProject.output.id,
      toId: worldService.output.id,
      type: "verifies",
      metadata: { runId },
    },
  });
  record("world.link", worldLink.ok && Boolean(worldLink.output.id), worldLink.output?.id ?? "");

  const worldFind = await post("/tools/call", {
    name: "world.find",
    input: { query: runId, limit: 5 },
  });
  record("world.find", worldFind.ok && worldFind.output.length >= 2, `${worldFind.output.length} matches`);

  const worldSnapshot = await api("/world/snapshot");
  record(
    "world.snapshot",
    worldSnapshot.entities.length >= 1 && worldSnapshot.relations.length >= 1,
    `${worldSnapshot.entities.length} entities`,
  );

  const reflection = await post("/tools/call", {
    name: "reflection.record",
    input: {
      kind: "lesson",
      title: `Full Check Reflection ${runId}`,
      summary: "Runtime verification reflection record.",
      tags: ["full-check"],
      metadata: { runId },
    },
  });
  record(
    "reflection.record",
    reflection.ok && reflection.output.created && Boolean(reflection.output.reflection.id),
    reflection.output?.reflection?.id ?? "",
  );

  const reflectionFind = await post("/tools/call", {
    name: "reflection.find",
    input: { query: runId, limit: 5 },
  });
  record("reflection.find", reflectionFind.ok && reflectionFind.output.length >= 1);

  const reflectionStatus = await api("/reflection/status");
  record(
    "reflection.status",
    reflectionStatus.running && reflectionStatus.tickCount >= 1,
    `${reflectionStatus.tickCount} ticks`,
  );

  const preflight = await api("/self/preflight");
  record("self.preflight", preflight.ok && preflight.output.ok, `${preflight.output.checks.length} checks`);
  const repairPlan = await api("/self/repair-plan");
  record(
    "self.repair_plan",
    repairPlan.ok && repairPlan.output.summary === "ready",
    repairPlan.output.summary,
  );

  const sessionId = `full-check-${runId}`;
  const chat = await post("/chat", {
    sessionId,
    message: "Reply exactly OK.",
  });
  record(
    "chat.kimi",
    chat.ok && typeof chat.reply?.content === "string" && chat.reply.content.length > 0,
    `latency=${chat.reply?.latencyMs ?? "unknown"}ms`,
  );

  const conversation = await api(`/conversation/messages?sessionId=${encodeURIComponent(sessionId)}&limit=10`);
  record("conversation.persist", conversation.messages.length >= 2, `${conversation.messages.length} messages`);

  const proposal = await post("/tools/call", {
    name: "actions.propose",
    input: {
      toolName: "demo.full-check.action",
      input: { runId },
      riskLevel: "L2",
      reason: "Full check approval notification.",
    },
  });
  const actionId = proposal.output?.id;
  record("actions.propose", proposal.ok && Boolean(actionId), actionId ?? "");

  const pending = await api("/actions/pending?limit=20");
  record(
    "actions.pending",
    pending.actions.some((action) => action.id === actionId),
    `${pending.actions.length} pending`,
  );

  const unreadAfterAction = await api("/notifications/unread?limit=50");
  const actionNotification = unreadAfterAction.notifications.find(
    (notification) => notification.actionId === actionId,
  );
  record("notifications.from_action", Boolean(actionNotification), actionNotification?.id ?? "");

  const rejected = await post("/actions/reject", { actionId, reason: "full check cleanup" });
  record("actions.reject", rejected.ok && rejected.output?.status === "rejected");
  if (actionNotification) {
    await post("/notifications/read", { notificationId: actionNotification.id });
  }

  const reminder = await post("/reminders/create", {
    title: `Full check reminder ${runId}`,
    message: "Reminder loop proof.",
    dueAt: Date.now() + 1000,
    metadata: { runId },
  });
  const reminderId = reminder.output?.id;
  record("reminders.create", reminder.ok && Boolean(reminderId), reminderId ?? "");

  await new Promise((resolve) => setTimeout(resolve, 6500));
  const reminders = await api("/reminders?limit=30");
  const delivered = reminders.reminders.find((item) => item.id === reminderId);
  record("reminders.deliver", delivered?.status === "delivered", delivered?.status ?? "missing");

  const unreadAfterReminder = await api("/notifications/unread?limit=50");
  const reminderNotification = unreadAfterReminder.notifications.find(
    (notification) => notification.metadata?.id === reminderId || notification.title === reminder.output?.title,
  );
  record("notifications.from_reminder", Boolean(reminderNotification), reminderNotification?.id ?? "");
  if (reminderNotification) {
    await post("/notifications/read", { notificationId: reminderNotification.id });
  }

  const finalSelf = await api("/self/diagnose");
  record("self.final", finalSelf.ok, finalSelf.summary);

  const pruned = await post("/tools/call", {
    name: "maintenance.prune_full_check",
    input: {},
  });
  record(
    "maintenance.prune_full_check",
    pruned.ok &&
      pruned.output.memoryDeleted >= 1 &&
      pruned.output.worldEntitiesDeleted >= 2 &&
      pruned.output.reflectionsDeleted >= 1,
    JSON.stringify(pruned.output),
  );
  await removeReturnedBackup(fileBackup.output.backup);

  console.log(JSON.stringify({ ok: true, checks: results.length, runId }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  console.log(JSON.stringify({ ok: false, checks: results }, null, 2));
  process.exit(1);
});
