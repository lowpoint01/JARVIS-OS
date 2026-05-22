import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "http://127.0.0.1:31888";
const wsBase = "ws://127.0.0.1:31888";
const startedAt = Date.now();
const results = [];
const mojibakePattern =
  /[\uFFFD]|\u935e|\u93ba|\u9477|\u93c8|\u7039|\u5a0c|\u9429|\u95c0|\u93c3|\u93cd|\u9359|\u7487|\u5a34|\u7ee0/;

function result(name, ok, detail = "", extra = undefined) {
  const item = {
    name,
    ok,
    detail,
    ...(extra === undefined ? {} : { extra }),
  };
  results.push(item);
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark} ${name}${detail ? ` - ${detail}` : ""}`);
  return item;
}

async function step(name, fn) {
  try {
    const detail = await fn();
    result(name, true, typeof detail === "string" ? detail : "", typeof detail === "object" ? detail : undefined);
  } catch (err) {
    result(name, false, err instanceof Error ? err.message : String(err));
  }
}

async function api(route, options = {}) {
  const response = await fetch(`${base}${route}`, {
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
    throw new Error(`${route} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  return data;
}

async function post(route, body) {
  return await api(route, {
    method: "POST",
    body: JSON.stringify(body),
  });
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

async function ensureGateway() {
  if (await isReady()) {
    result("service.ready", true, "gateway already ready");
    return;
  }
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
  const ready = await waitReady();
  result("service.start", ready, ready ? "gateway reached ready state" : "gateway did not become ready");
  if (!ready) {
    throw new Error("Gateway did not become ready.");
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readEventSocketHello() {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsBase}/events`);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for WebSocket hello."));
    }, 5000);
    socket.once("message", (data) => {
      clearTimeout(timer);
      socket.close();
      try {
        resolve(JSON.parse(Buffer.from(data).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function writeReport() {
  const report = {
    ok: results.every((item) => item.ok),
    generatedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    checks: results,
  };
  const logsDir = path.join(root, "data", "logs");
  await mkdir(logsDir, { recursive: true });
  const reportPath = path.join(logsDir, `backend-audit-${report.generatedAt}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ ok: report.ok, checks: results.length, reportPath }, null, 2));
  return report;
}

async function main() {
  await ensureGateway();

  await step("http.readyz", async () => {
    const ready = await api("/readyz");
    assert(ready.ready === true, "readyz did not return ready=true.");
    return `${ready.uptimeMs}ms uptime`;
  });

  await step("http.health", async () => {
    const health = await api("/health");
    assert(health.ok === true && health.ready === true, "health is not ready.");
    assert(health.components?.tools?.ok === true, "tool component is not healthy.");
    return health.components.tools.detail;
  });

  await step("http.version", async () => {
    const version = await api("/version");
    assert(version.name === "JARVIS-OS", "unexpected service name.");
    return version.version;
  });

  await step("cockpit.static", async () => {
    const [page, script] = await Promise.all([
      fetch(`${base}/`).then(async (response) => ({
        ok: response.ok,
        status: response.status,
        text: await response.text(),
      })),
      fetch(`${base}/cockpit/app.js`).then(async (response) => ({
        ok: response.ok,
        status: response.status,
        text: await response.text(),
      })),
    ]);
    assert(page.ok, `cockpit page returned ${page.status}`);
    assert(script.ok, `cockpit script returned ${script.status}`);
    assert(page.text.includes("JARVIS-OS 控制台"), "cockpit page title is missing.");
    assert(page.text.includes("企业就绪"), "cockpit enterprise section is missing.");
    assert(page.text.includes("开启实时语音对话"), "cockpit realtime voice button is missing.");
    assert(script.text.includes("企业级就绪"), "cockpit readiness translation is missing.");
    assert(script.text.includes("实时语音"), "cockpit realtime voice logic is missing.");
    assert(!mojibakePattern.test(script.text), "cockpit script contains mojibake.");
    return "中文控制台静态资源正常";
  });

  await step("http.models.status", async () => {
    const status = await api("/models/status");
    assert(status.chat?.hasKey === true, "chat model key is not configured.");
    assert(status.embedding?.hasKey === true, "embedding model key is not configured.");
    assert(status.routing?.defaultMode, "routing default mode is missing.");
    return `${status.chat.model}/${status.embedding.model}`;
  });

  await step("http.voice.status", async () => {
    const status = await api("/voice/status");
    assert(typeof status.available === "boolean", "voice availability flag missing.");
    assert(status.asrProvider === "faster-whisper", `unexpected ASR provider: ${status.asrProvider}`);
    assert(status.asrModel === "large-v3-turbo", `unexpected ASR model: ${status.asrModel}`);
    assert(status.ttsProvider === "msedge-tts", `unexpected TTS provider: ${status.ttsProvider}`);
    return `asr=${status.asrProvider}/${status.asrModel}; tts=${status.ttsProvider}/${status.ttsVoice}; available=${status.available}`;
  });

  await step("http.voice.devices", async () => {
    const devices = await api("/voice/devices");
    assert(devices.ok === true, devices.summary ?? "voice device diagnostics failed.");
    assert(devices.microphones?.length >= 1, "no microphone endpoint detected.");
    assert(devices.defaultInputUsable === true, "default microphone input is not usable.");
    return `${devices.summary} microphones=${devices.microphones.length}`;
  });

  await step("http.self.diagnose", async () => {
    const report = await api("/self/diagnose");
    assert(report.ok === true, report.summary ?? "self diagnostics not ok.");
    return `${report.summary}; tools=${report.metrics.toolCount}`;
  });

  await step("http.self.model", async () => {
    const report = await api("/self/model");
    assert(["ready", "watch", "repair_needed"].includes(report.posture), "invalid self posture.");
    assert(typeof report.stabilityScore === "number", "stability score missing.");
    return `${report.posture}; score=${report.stabilityScore}`;
  });

  await step("http.self.preflight", async () => {
    const result = await api("/self/preflight");
    assert(result.ok === true && result.output?.ok === true, "preflight failed.");
    return `${result.output.checks.length} checks`;
  });

  await step("http.briefing", async () => {
    const briefing = await api("/briefing");
    assert(typeof briefing.headline === "string", "briefing headline missing.");
    assert(Array.isArray(briefing.sections), "briefing sections missing.");
    return briefing.severity;
  });

  await step("http.enterprise.readiness", async () => {
    const report = await api("/enterprise/readiness");
    assert(report.ok === true, report.summary ?? "enterprise readiness failed.");
    assert(report.score >= 80, `enterprise score too low: ${report.score}`);
    return `${report.maturity}; score=${report.score}; checks=${report.checks.length}`;
  });

  await step("http.tools.list", async () => {
    const tools = await api("/tools/list");
    assert(Array.isArray(tools.tools), "tool list missing.");
    assert(tools.tools.length >= 50, `expected at least 50 tools, got ${tools.tools.length}.`);
    assert(tools.tools.some((tool) => tool.name === "enterprise.readiness"), "enterprise.readiness missing.");
    assert(tools.tools.some((tool) => tool.name === "voice.transcribe_audio"), "voice.transcribe_audio missing.");
    return `${tools.tools.length} tools`;
  });

  await step("tool.enterprise.readiness", async () => {
    const result = await post("/tools/call", { name: "enterprise.readiness", input: {} });
    assert(result.ok === true, result.error ?? "enterprise tool failed.");
    assert(result.output?.ok === true, result.output?.summary ?? "enterprise output not ok.");
    return `${result.output.maturity}; score=${result.output.score}`;
  });

  await step("tool.memory.vault_status", async () => {
    const result = await post("/tools/call", { name: "memory.vault_status", input: {} });
    assert(result.ok === true, result.error ?? "memory vault status failed.");
    assert(result.output?.enabled === true, "memory vault is not enabled.");
    return `${result.output.records} records`;
  });

  await step("tool.voice.tts_probe", async () => {
    const result = await post("/tools/call", {
      name: "voice.tts_probe",
      input: { text: "JARVIS TTS probe." },
    });
    assert(result.ok === true, result.error ?? "TTS probe tool failed.");
    assert(result.output?.provider === "msedge-tts", `unexpected TTS provider: ${result.output?.provider}`);
    assert(result.output?.audioBytes > 1000, `TTS audio output too small: ${result.output?.audioBytes}`);
    return `${result.output.voice}; ${result.output.audioBytes} bytes`;
  });

  await step("tool.voice.transcribe_audio.dry_run", async () => {
    const result = await post("/tools/call", {
      name: "voice.transcribe_audio",
      input: {
        dryRun: true,
        audioBase64: Buffer.from("dry-run").toString("base64"),
        contentType: "audio/wav",
      },
    });
    assert(result.ok === true, result.error ?? "ASR dry-run tool failed.");
    assert(result.output?.provider === "faster-whisper", `unexpected ASR provider: ${result.output?.provider}`);
    assert(result.output?.model === "large-v3-turbo", `unexpected ASR model: ${result.output?.model}`);
    return `${result.output.provider}/${result.output.model}`;
  });

  await step("tool.memory.extract", async () => {
    const result = await post("/tools/call", {
      name: "memory.extract",
      input: { sessionId: "backend-audit", message: "Remember: backend audit active memory path." },
    });
    assert(result.ok === true, result.error ?? "memory extract failed.");
    assert(Array.isArray(result.output), "memory extract output is not an array.");
    return `${result.output.length} candidates`;
  });

  await step("tool.initiative.status", async () => {
    const result = await post("/tools/call", { name: "initiative.status", input: {} });
    assert(result.ok === true && result.output?.running === true, "initiative loop is not running.");
    return `${result.output.tickCount} ticks`;
  });

  await step("tool.perception.status", async () => {
    const result = await post("/tools/call", { name: "perception.status", input: {} });
    assert(result.ok === true && result.output?.running === true, "perception loop is not running.");
    return `${result.output.tickCount} ticks`;
  });

  await step("tool.reflection.list", async () => {
    const result = await post("/tools/call", { name: "reflection.list", input: { limit: 5 } });
    assert(result.ok === true && Array.isArray(result.output), "reflection list failed.");
    return `${result.output.length} reflections`;
  });

  await step("tool.world.snapshot", async () => {
    const result = await post("/tools/call", { name: "world.snapshot", input: {} });
    assert(result.ok === true, result.error ?? "world snapshot failed.");
    assert(Array.isArray(result.output?.entities), "world entities missing.");
    return `${result.output.entities.length} entities`;
  });

  await step("tool.maintenance.status", async () => {
    const result = await post("/tools/call", { name: "maintenance.status", input: {} });
    assert(result.ok === true, result.error ?? "maintenance status failed.");
    assert(typeof result.output?.memoryRecords === "number", "maintenance memory count missing.");
    return `${result.output.memoryRecords} memories`;
  });

  await step("ws.events", async () => {
    const hello = await readEventSocketHello();
    assert(hello.type === "hello", "WebSocket did not send hello.");
    assert(hello.service === "JARVIS-OS", "unexpected WebSocket service.");
    return hello.version;
  });

  const report = await writeReport();
  if (!report.ok) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  result("backend.audit", false, err instanceof Error ? err.message : String(err));
  await writeReport();
  process.exit(1);
});
