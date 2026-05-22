import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.JARVIS_URL ?? "http://127.0.0.1:31888";
const sessionId = process.env.JARVIS_VOICE_SESSION ?? "voice-main";
const runDir = path.join(root, "data", "run");
const stopFile = path.join(runDir, "voice-conversation.stop");
const pidFile = path.join(runDir, "voice-conversation.pid");
let listenTimeoutMs = Number(process.env.JARVIS_VOICE_LISTEN_TIMEOUT_MS ?? 0);
const idleDelayMs = Number(process.env.JARVIS_VOICE_IDLE_DELAY_MS ?? 250);
const afterSpeakDelayMs = Number(process.env.JARVIS_VOICE_AFTER_SPEAK_DELAY_MS ?? 900);
const minConfidence = Number(process.env.JARVIS_VOICE_MIN_CONFIDENCE ?? 0.08);
const modelRecordMs = Number(process.env.JARVIS_VOICE_MODEL_RECORD_MS ?? 4500);
const voiceLoopAudioDir = path.join(root, "data", "audio-cache", "voice-loop");
let emptyListenCount = 0;

const stopPhrases = [
  "停止语音对话",
  "退出语音对话",
  "关闭语音对话",
  "停止监听",
  "退出",
  "stop voice",
  "stop listening",
  "quit voice",
];
const wakePhrases = ["贾维斯", "你好", "jarvis"];

function log(message, data) {
  const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
  console.log(`[${new Date().toISOString()}] ${message}${suffix}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function api(route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    headers: options.body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error ?? `${route} returned HTTP ${response.status}`);
  }
  return data;
}

async function post(route, body) {
  return await api(route, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function postAudio(route, audioFile, contentType) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: await fs.readFile(audioFile),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error ?? `${route} returned HTTP ${response.status}`);
  }
  return data;
}

async function waitReady(timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const ready = await api("/readyz");
      if (ready.ready) {
        return true;
      }
    } catch {
      // The gateway may still be warming up.
    }
    await sleep(600);
  }
  return false;
}

function normalizeTranscript(value) {
  return value.trim().replace(/\s+/g, " ");
}

function resolveListenTimeoutMs(voiceStatus) {
  if (Number.isFinite(listenTimeoutMs) && listenTimeoutMs >= 1000) {
    return listenTimeoutMs;
  }
  const configured = Number(voiceStatus.listenTimeoutMs);
  return Number.isFinite(configured) && configured >= 1000 ? configured : 7000;
}

function resolveModelRecordMs() {
  if (Number.isFinite(modelRecordMs) && modelRecordMs >= 1200) {
    return Math.min(15000, Math.round(modelRecordMs));
  }
  return 4500;
}

async function resolveMicrophoneName() {
  const configured = process.env.JARVIS_VOICE_INPUT_DEVICE?.trim();
  if (configured) {
    return configured;
  }
  const devices = await api("/voice/devices");
  const microphones = Array.isArray(devices.microphones) ? devices.microphones : [];
  const firstUsable = microphones.find((device) => device?.status === "OK" && device?.name);
  if (!firstUsable) {
    throw new Error(devices.summary ?? "No usable microphone endpoint detected.");
  }
  return firstUsable.name;
}

async function recordWithFfmpeg(deviceName, durationMs) {
  await fs.mkdir(voiceLoopAudioDir, { recursive: true });
  const audioFile = path.join(
    voiceLoopAudioDir,
    `listen-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`,
  );
  const seconds = Math.max(1.2, durationMs / 1000);
  await new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "dshow",
        "-i",
        `audio=${deviceName}`,
        "-t",
        String(seconds),
        "-ac",
        "1",
        "-ar",
        "16000",
        audioFile,
      ],
      { windowsHide: true },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${exitCode}`));
        return;
      }
      resolve();
    });
  });
  const stat = await fs.stat(audioFile);
  if (stat.size < 1000) {
    throw new Error(`Recorded audio is too small: ${stat.size} bytes.`);
  }
  return audioFile;
}

function isBogusTranscript(transcript) {
  return transcript === String(Math.round(listenTimeoutMs));
}

function shouldStop(transcript) {
  const normalized = transcript.toLowerCase();
  return stopPhrases.some((phrase) => normalized.includes(phrase.toLowerCase()));
}

function isWakeLike(transcript) {
  const normalized = transcript.toLowerCase();
  return wakePhrases.some((phrase) => normalized.includes(phrase.toLowerCase()));
}

function confidenceAccepted(transcript, confidence) {
  return (
    isWakeLike(transcript) ||
    confidence === undefined ||
    !Number.isFinite(confidence) ||
    confidence >= minConfidence
  );
}

function splitForSpeech(text, maxChars) {
  const normalized = normalizeTranscript(text);
  if (normalized.length <= maxChars) {
    return [normalized];
  }
  const chunks = [];
  let remaining = normalized;
  while (remaining.length > 0) {
    let cut = Math.min(maxChars, remaining.length);
    const punctuation = Math.max(
      remaining.lastIndexOf("。", cut),
      remaining.lastIndexOf("！", cut),
      remaining.lastIndexOf("？", cut),
      remaining.lastIndexOf(".", cut),
      remaining.lastIndexOf("!", cut),
      remaining.lastIndexOf("?", cut),
    );
    if (punctuation > 80) {
      cut = punctuation + 1;
    }
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  return chunks.filter(Boolean);
}

async function speak(text, voiceStatus) {
  const maxChars = Math.max(80, Number(voiceStatus.maxChars ?? 900));
  for (const chunk of splitForSpeech(text, maxChars)) {
    await post("/voice/speak", { text: chunk });
  }
}

async function listenWithWindowsSapi() {
  const result = await post("/voice/listen", { timeoutMs: listenTimeoutMs });
  if (!result.ok) {
    throw new Error(result.error ?? "voice.listen failed");
  }
  const output = result.output;
  return {
    transcript: normalizeTranscript(output?.transcript ?? ""),
    confidence: typeof output?.confidence === "number" ? output.confidence : undefined,
    culture: typeof output?.culture === "string" ? output.culture : undefined,
  };
}

async function listenWithLocalModel(microphoneName) {
  const audioFile = await recordWithFfmpeg(microphoneName, resolveModelRecordMs());
  const result = await postAudio("/voice/transcribe?language=zh-CN", audioFile, "audio/wav");
  return {
    transcript: normalizeTranscript(result?.transcript ?? ""),
    confidence: typeof result?.languageProbability === "number" ? result.languageProbability : undefined,
    culture: typeof result?.language === "string" ? result.language : undefined,
    provider: result?.provider,
    model: result?.model,
    device: result?.device,
    processingMs: result?.processingMs,
  };
}

async function listenOnce(voiceStatus, microphoneName) {
  if (voiceStatus.asrProvider === "faster-whisper" && microphoneName) {
    try {
      return await listenWithLocalModel(microphoneName);
    } catch (err) {
      log("model ASR failed; falling back to Windows SAPI", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return await listenWithWindowsSapi();
}

async function chat(message) {
  const result = await post("/chat", { sessionId, message });
  if (!result.ok) {
    throw new Error(result.error ?? "chat failed");
  }
  return result.reply?.content ?? "";
}

async function main() {
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(pidFile, String(process.pid), "ascii");
  process.on("SIGINT", () => {
    void fs.writeFile(stopFile, "SIGINT", "utf8");
  });
  process.on("SIGTERM", () => {
    void fs.writeFile(stopFile, "SIGTERM", "utf8");
  });

  if (!(await waitReady())) {
    throw new Error(`JARVIS gateway is not ready at ${base}.`);
  }

  const voiceStatus = await api("/voice/status");
  if (!voiceStatus.available) {
    throw new Error("Local Windows voice input/output is not available.");
  }
  listenTimeoutMs = resolveListenTimeoutMs(voiceStatus);
  const microphoneName =
    voiceStatus.asrProvider === "faster-whisper" ? await resolveMicrophoneName() : undefined;

  log("voice conversation started", {
    sessionId,
    base,
    microphone: microphoneName ?? "Windows default audio input device",
    speaker: "Windows default audio output device",
    listenTimeoutMs,
    modelRecordMs: resolveModelRecordMs(),
    asrProvider: voiceStatus.asrProvider,
    asrModel: voiceStatus.asrModel,
    language: voiceStatus.language,
  });
  await speak("语音对话已开启。你可以直接说话；说停止语音对话即可关闭。", voiceStatus);
  await sleep(afterSpeakDelayMs);

  while (!(await exists(stopFile))) {
    try {
      const heard = await listenOnce(voiceStatus, microphoneName);
      if (!heard.transcript) {
        emptyListenCount += 1;
        if (emptyListenCount % 10 === 0) {
          log("listening timeout", { count: emptyListenCount, culture: heard.culture });
        }
        await sleep(idleDelayMs);
        continue;
      }
      emptyListenCount = 0;
      if (isBogusTranscript(heard.transcript)) {
        log("ignored bogus timeout transcript", heard);
        continue;
      }
      if (!confidenceAccepted(heard.transcript, heard.confidence)) {
        log("ignored low-confidence transcript", heard);
        continue;
      }
      log("heard", heard);
      if (shouldStop(heard.transcript)) {
        await speak("语音对话已停止。", voiceStatus);
        break;
      }
      const reply = await chat(heard.transcript);
      log("reply", { characters: reply.length });
      if (reply.trim()) {
        await speak(reply, voiceStatus);
      }
      await sleep(afterSpeakDelayMs);
    } catch (err) {
      log("voice loop error", { error: err instanceof Error ? err.message : String(err) });
      await sleep(1800);
    }
  }

  await fs.rm(stopFile, { force: true });
  await fs.rm(pidFile, { force: true });
  log("voice conversation stopped");
}

main().catch(async (err) => {
  log("voice conversation failed", { error: err instanceof Error ? err.message : String(err) });
  await fs.rm(pidFile, { force: true }).catch(() => {});
  process.exit(1);
});
