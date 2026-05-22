import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { JarvisConfig } from "../shared/types.js";

export type VoiceStatus = {
  enabled: boolean;
  provider: JarvisConfig["voice"]["provider"];
  asrProvider: NonNullable<JarvisConfig["voice"]["asrProvider"]>;
  asrModel: string;
  asrModelAvailable: boolean;
  fallbackToWindowsAsr: boolean;
  ttsProvider: NonNullable<JarvisConfig["voice"]["ttsProvider"]>;
  ttsVoice: string;
  ttsModelAvailable: boolean;
  sapiAvailable: boolean;
  fallbackToSapi: boolean;
  language: string;
  platform: NodeJS.Platform;
  ttsAvailable: boolean;
  asrAvailable: boolean;
  available: boolean;
  rate: number;
  volume: number;
  maxChars: number;
  listenTimeoutMs: number;
};

export type SpeakInput = {
  text: string;
  dryRun?: boolean;
  playback?: boolean;
  rate?: number;
  volume?: number;
};

export type ListenInput = {
  dryRun?: boolean;
  timeoutMs?: number;
};

export type TranscribeAudioInput = {
  audio: Buffer;
  contentType?: string;
  language?: string;
  dryRun?: boolean;
  timeoutMs?: number;
};

export type SpeakResult = {
  ok: boolean;
  dryRun: boolean;
  provider: string;
  voice?: string;
  fallbackUsed?: boolean;
  characters: number;
  audioFile?: string;
  audioBytes?: number;
  playback?: boolean;
};

export type ListenResult = {
  ok: boolean;
  dryRun: boolean;
  provider: JarvisConfig["voice"]["provider"];
  transcript: string;
  confidence?: number;
  culture?: string;
  timeoutMs: number;
};

export type TranscribeAudioResult = {
  ok: boolean;
  dryRun: boolean;
  provider: string;
  model?: string;
  device?: string;
  computeType?: string;
  transcript: string;
  language?: string;
  languageProbability?: number;
  duration?: number;
  processingMs?: number;
  timeoutMs: number;
  audioFile?: string;
  audioBytes?: number;
  fallbackUsed?: boolean;
  error?: string;
};

export type VoiceEndpointDevice = {
  name: string;
  status: string;
  direction: "input" | "output" | "unknown";
  instanceId: string;
};

export type SpeechRecognizerInfo = {
  name: string;
  culture: string;
  description: string;
};

export type MicrophonePrivacyInfo = {
  scope: "current-user" | "local-machine";
  value: string;
};

export type VoiceDeviceDiagnostics = {
  ok: boolean;
  checkedAt: number;
  platform: NodeJS.Platform;
  microphones: VoiceEndpointDevice[];
  speakers: VoiceEndpointDevice[];
  otherEndpoints: VoiceEndpointDevice[];
  recognizers: SpeechRecognizerInfo[];
  privacy: MicrophonePrivacyInfo[];
  defaultInputUsable: boolean;
  defaultInputError?: string;
  summary: string;
};

const DEFAULT_SPEECH_LANGUAGE = "zh-CN";

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeSpeechLanguage(language: string | undefined): string {
  const value = language?.trim() || DEFAULT_SPEECH_LANGUAGE;
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value) ? value : DEFAULT_SPEECH_LANGUAGE;
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replaceAll("'", "''");
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function base64Utf8(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function ttsProviderFrom(config: JarvisConfig["voice"]): NonNullable<JarvisConfig["voice"]["ttsProvider"]> {
  return config.ttsProvider ?? "windows-sapi";
}

function ttsVoiceFrom(config: JarvisConfig["voice"]): string {
  return config.ttsVoice?.trim() || "zh-CN-XiaoxiaoNeural";
}

function ttsCacheDirFrom(config: JarvisConfig["voice"]): string {
  return path.resolve(process.cwd(), config.audioCacheDir?.trim() || "data/audio-cache");
}

function asrProviderFrom(config: JarvisConfig["voice"]): NonNullable<JarvisConfig["voice"]["asrProvider"]> {
  return config.asrProvider ?? "windows-sapi";
}

function asrModelFrom(config: JarvisConfig["voice"]): string {
  return config.asrModel?.trim() || "large-v3-turbo";
}

function asrDeviceFrom(config: JarvisConfig["voice"]): NonNullable<JarvisConfig["voice"]["asrDevice"]> {
  return config.asrDevice ?? "auto";
}

function asrComputeTypeFrom(config: JarvisConfig["voice"]): string {
  return config.asrComputeType?.trim() || "default";
}

function asrCacheDirFrom(config: JarvisConfig["voice"]): string {
  return path.resolve(process.cwd(), config.asrCacheDir?.trim() || "data/asr-model-cache");
}

function asrPathEnv(config: JarvisConfig["voice"]): string {
  const existing = process.env.PATH ?? "";
  const dirs = (config.asrCudaDllDirs ?? [])
    .map((dir) => dir.trim())
    .filter(Boolean)
    .map((dir) => path.resolve(process.cwd(), dir))
    .filter((dir) => {
      try {
        return fsSync.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
  return dirs.length ? `${dirs.join(path.delimiter)}${path.delimiter}${existing}` : existing;
}

function asrAudioDirFrom(config: JarvisConfig["voice"]): string {
  return path.join(ttsCacheDirFrom(config), "asr-input");
}

function audioExtensionFrom(contentType: string | undefined): string {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("wav")) {
    return ".wav";
  }
  if (normalized.includes("mpeg") || normalized.includes("mp3")) {
    return ".mp3";
  }
  if (normalized.includes("mp4") || normalized.includes("m4a")) {
    return ".m4a";
  }
  if (normalized.includes("ogg")) {
    return ".ogg";
  }
  if (normalized.includes("webm")) {
    return ".webm";
  }
  return ".audio";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function speakWithWindowsSapi(text: string, rate: number, volume: number, language: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const safeLanguage = escapePowerShellSingleQuoted(normalizeSpeechLanguage(language));
    const encodedText = base64Utf8(text);
    const safeRate = clamp(rate, -10, 10, 0);
    const safeVolume = clamp(volume, 0, 100, 85);
    const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$cultureName = '${safeLanguage}'
$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedText}'))
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $speaker.Rate = ${safeRate}
  $speaker.Volume = ${safeVolume}
  $voice = $speaker.GetInstalledVoices() |
    Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq $cultureName } |
    Select-Object -First 1
  if ($null -ne $voice) {
    $speaker.SelectVoice($voice.VoiceInfo.Name)
  }
  $speaker.SetOutputToDefaultAudioDevice()
  $speaker.Speak($text)
} finally {
  if ($null -ne $speaker) {
    $speaker.Dispose()
  }
}
`;
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShell(script),
      ],
      {
        windowsHide: true,
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Windows SAPI exited with code ${exitCode}`));
    });
  });
}

async function synthesizeWithMsEdgeTts(
  text: string,
  config: JarvisConfig["voice"],
): Promise<{ audioFile: string; audioBytes: number; voice: string }> {
  const voice = ttsVoiceFrom(config);
  const outputRoot = ttsCacheDirFrom(config);
  const outputDir = path.join(outputRoot, `tts-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await fs.mkdir(outputDir, { recursive: true });
  const client = new MsEdgeTTS();
  const timeoutMs = Math.max(3000, config.ttsTimeoutMs ?? 20000);
  try {
    await withTimeout(
      client.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
        voiceLocale: normalizeSpeechLanguage(config.language),
      }),
      timeoutMs,
      "msedge-tts metadata setup",
    );
    const result = await withTimeout(
      client.toFile(outputDir, xmlEscape(text), {
        rate: config.ttsRate ?? "default",
        volume: config.ttsVolume ?? "default",
        pitch: config.ttsPitch ?? "default",
      }),
      timeoutMs,
      "msedge-tts synthesis",
    );
    const stat = await fs.stat(result.audioFilePath);
    return {
      audioFile: result.audioFilePath,
      audioBytes: stat.size,
      voice,
    };
  } finally {
    client.close();
  }
}

function playAudioFileWithDefaultDevice(audioFile: string, volume: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const safeVolume = clamp(volume, 0, 100, 85) / 100;
    const encodedPath = base64Utf8(path.resolve(audioFile));
    const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName PresentationCore
$path = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedPath}'))
$player = New-Object System.Windows.Media.MediaPlayer
try {
  $player.Open([Uri]::new($path))
  $player.Volume = ${safeVolume}
  $player.Play()
  $wait = [Diagnostics.Stopwatch]::StartNew()
  while (-not $player.NaturalDuration.HasTimeSpan -and $wait.ElapsedMilliseconds -lt 5000) {
    Start-Sleep -Milliseconds 50
  }
  if ($player.NaturalDuration.HasTimeSpan) {
    Start-Sleep -Milliseconds ([Math]::Min(120000, [Math]::Ceiling($player.NaturalDuration.TimeSpan.TotalMilliseconds) + 300))
  } else {
    Start-Sleep -Milliseconds 3000
  }
} finally {
  if ($null -ne $player) {
    $player.Stop()
    $player.Close()
  }
}
`;
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShell(script),
      ],
      {
        windowsHide: true,
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Audio playback exited with code ${exitCode}`));
    });
  });
}

function listenWithWindowsSpeech(
  timeoutMs: number,
  language: string,
): Promise<{ transcript: string; confidence?: number; culture?: string }> {
  return new Promise((resolve, reject) => {
    const safeTimeoutMs = clamp(timeoutMs, 1000, 30000, 7000);
    const safeLanguage = escapePowerShellSingleQuoted(normalizeSpeechLanguage(language));
    const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$cultureName = '${safeLanguage}'
$recognizerInfo = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() |
  Where-Object { $_.Culture.Name -eq $cultureName } |
  Select-Object -First 1
if ($null -ne $recognizerInfo) {
  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine -ArgumentList $recognizerInfo
} else {
  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
}
try {
  $grammar = New-Object System.Speech.Recognition.DictationGrammar
  $recognizer.LoadGrammar($grammar) | Out-Null
  $recognizer.SetInputToDefaultAudioDevice()
  $result = $recognizer.Recognize([TimeSpan]::FromMilliseconds(${safeTimeoutMs}))
  if ($null -ne $result) {
    [pscustomobject]@{
      transcript = $result.Text
      confidence = [double]$result.Confidence
      culture = $recognizer.RecognizerInfo.Culture.Name
    } | ConvertTo-Json -Compress
  } else {
    [pscustomobject]@{
      transcript = ''
      culture = $recognizer.RecognizerInfo.Culture.Name
    } | ConvertTo-Json -Compress
  }
} finally {
  if ($null -ne $recognizer) {
    $recognizer.Dispose()
  }
}
`;
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShell(script),
      ],
      {
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += Buffer.from(chunk).toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(stderr.trim() || `Windows speech recognition exited with code ${exitCode}`));
        return;
      }
      const rawOutput = stdout.trim();
      try {
        const parsed = rawOutput ? (JSON.parse(rawOutput) as Record<string, unknown>) : {};
        const confidence = Number(parsed.confidence);
        resolve({
          transcript: typeof parsed.transcript === "string" ? parsed.transcript.trim() : "",
          confidence: Number.isFinite(confidence) ? confidence : undefined,
          culture: typeof parsed.culture === "string" ? parsed.culture : undefined,
        });
      } catch {
        reject(new Error(`Windows speech recognition returned invalid output: ${rawOutput.slice(0, 200)}`));
      }
    });
  });
}

type FasterWhisperOutput = {
  ok?: boolean;
  type?: string;
  provider?: string;
  model?: string;
  device?: string;
  computeType?: string;
  transcript?: string;
  language?: string;
  languageProbability?: number;
  duration?: number;
  processingMs?: number;
  fallbackUsed?: boolean;
  error?: string;
};

class FasterWhisperWorker {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readyPromise: Promise<FasterWhisperOutput> | undefined;
  private readyResolve: ((value: FasterWhisperOutput) => void) | undefined;
  private readyReject: ((reason: Error) => void) | undefined;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private pending = new Map<
    string,
    {
      resolve: (value: FasterWhisperOutput) => void;
      reject: (reason: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(private readonly config: JarvisConfig["voice"]) {}

  async ready(timeoutMs: number): Promise<FasterWhisperOutput> {
    return await this.ensureReady(timeoutMs);
  }

  async transcribe(audioFile: string, language: string, timeoutMs: number): Promise<FasterWhisperOutput> {
    await this.ensureReady(timeoutMs);
    if (!this.child || this.child.killed || !this.child.stdin.writable) {
      throw new Error("faster-whisper worker is not writable.");
    }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = JSON.stringify({
      id,
      audio: path.resolve(audioFile),
      language: normalizeSpeechLanguage(language),
      beamSize: 3,
    });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`faster-whisper worker transcription timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child?.stdin.write(`${payload}\n`, "utf8", (err) => {
        if (!err) {
          return;
        }
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  private async ensureReady(timeoutMs: number): Promise<FasterWhisperOutput> {
    if (this.readyPromise && this.child && !this.child.killed) {
      return await this.readyPromise;
    }
    this.start(timeoutMs);
    return await this.readyPromise!;
  }

  private start(timeoutMs: number): void {
    const scriptPath = path.resolve(process.cwd(), "scripts/faster-whisper-worker.py");
    const args = [
      scriptPath,
      "--model",
      asrModelFrom(this.config),
      "--device",
      asrDeviceFrom(this.config),
      "--compute-type",
      asrComputeTypeFrom(this.config),
      "--cache-dir",
      asrCacheDirFrom(this.config),
    ];
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    const startupTimer = setTimeout(() => {
      this.readyReject?.(new Error(`faster-whisper worker startup timed out after ${timeoutMs}ms.`));
      this.child?.kill();
    }, timeoutMs);
    this.readyPromise.finally(() => clearTimeout(startupTimer)).catch(() => undefined);
    this.child = spawn("python", args, {
      windowsHide: true,
      env: {
        ...process.env,
        PATH: asrPathEnv(this.config),
        Path: asrPathEnv(this.config),
        PYTHONIOENCODING: "utf-8",
      },
    });
    this.child.stdout.on("data", (chunk) => {
      this.handleStdout(Buffer.from(chunk).toString("utf8"));
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderrBuffer += Buffer.from(chunk).toString("utf8");
      this.stderrBuffer = this.stderrBuffer.slice(-4000);
    });
    this.child.on("error", (err) => {
      this.failAll(err instanceof Error ? err : new Error(String(err)));
    });
    this.child.on("close", (exitCode) => {
      const error = new Error(
        this.stderrBuffer.trim() || `faster-whisper worker exited with code ${exitCode}`,
      );
      this.child = undefined;
      this.readyPromise = undefined;
      this.failAll(error);
    });
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    for (;;) {
      const lineEnd = this.stdoutBuffer.indexOf("\n");
      if (lineEnd < 0) {
        break;
      }
      const line = this.stdoutBuffer.slice(0, lineEnd).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(lineEnd + 1);
      if (line) {
        this.handleLine(line);
      }
    }
  }

  private handleLine(line: string): void {
    let parsed: FasterWhisperOutput & { id?: string };
    try {
      parsed = JSON.parse(line) as FasterWhisperOutput & { id?: string };
    } catch {
      this.stderrBuffer += `\nInvalid worker JSON: ${line.slice(0, 300)}`;
      return;
    }
    if (parsed.type === "ready") {
      if (parsed.ok === false) {
        this.readyReject?.(new Error(parsed.error ?? "faster-whisper worker failed to start."));
        return;
      }
      this.readyResolve?.(parsed);
      return;
    }
    const id = parsed.id;
    if (!id) {
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (parsed.ok === false) {
      pending.reject(new Error(parsed.error ?? "faster-whisper worker transcription failed."));
      return;
    }
    pending.resolve(parsed);
  }

  private failAll(error: Error): void {
    this.readyReject?.(error);
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function transcribeWithFasterWhisper(
  audioFile: string,
  config: JarvisConfig["voice"],
  language: string,
  timeoutMs: number,
): Promise<FasterWhisperOutput> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(process.cwd(), "scripts/faster-whisper-transcribe.py");
    const args = [
      scriptPath,
      "--audio",
      path.resolve(audioFile),
      "--model",
      asrModelFrom(config),
      "--language",
      normalizeSpeechLanguage(language),
      "--device",
      asrDeviceFrom(config),
      "--compute-type",
      asrComputeTypeFrom(config),
      "--cache-dir",
      asrCacheDirFrom(config),
    ];
    const child = spawn("python", args, {
      windowsHide: true,
      env: {
        ...process.env,
        PATH: asrPathEnv(config),
        Path: asrPathEnv(config),
        PYTHONIOENCODING: "utf-8",
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`faster-whisper transcription timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += Buffer.from(chunk).toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const rawOutput = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
      try {
        const parsed = rawOutput ? (JSON.parse(rawOutput) as FasterWhisperOutput) : {};
        if (exitCode !== 0 || parsed.ok === false) {
          reject(new Error(parsed.error ?? stderr.trim() ?? `faster-whisper exited with code ${exitCode}`));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new Error(`faster-whisper returned invalid output: ${rawOutput.slice(0, 300)}`));
      }
    });
  });
}

function runPowerShellJson<T>(script: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShell(script),
      ],
      {
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += Buffer.from(chunk).toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(stderr.trim() || `PowerShell exited with code ${exitCode}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as T);
      } catch {
        reject(new Error(`PowerShell returned invalid JSON: ${stdout.slice(0, 300)}`));
      }
    });
  });
}

async function diagnoseWindowsVoiceDevices(): Promise<VoiceDeviceDiagnostics> {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$endpoints = @(Get-PnpDevice -Class AudioEndpoint -ErrorAction SilentlyContinue | ForEach-Object {
  $direction = 'unknown'
  if ($_.InstanceId -like '*{0.0.1.*') { $direction = 'input' }
  elseif ($_.InstanceId -like '*{0.0.0.*') { $direction = 'output' }
  [pscustomobject]@{
    name = $_.FriendlyName
    status = $_.Status
    direction = $direction
    instanceId = $_.InstanceId
  }
})
$recognizers = @()
$defaultInputUsable = $false
$defaultInputError = $null
try {
  Add-Type -AssemblyName System.Speech
  $recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object {
    [pscustomobject]@{
      name = $_.Name
      culture = $_.Culture.Name
      description = $_.Description
    }
  })
  $recognizerInfo = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() |
    Where-Object { $_.Culture.Name -eq '${escapePowerShellSingleQuoted(DEFAULT_SPEECH_LANGUAGE)}' } |
    Select-Object -First 1
  if ($null -ne $recognizerInfo) {
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine -ArgumentList $recognizerInfo
  } else {
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  }
  try {
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $recognizer.LoadGrammar($grammar) | Out-Null
    $recognizer.SetInputToDefaultAudioDevice()
    $defaultInputUsable = $true
  } finally {
    if ($null -ne $recognizer) { $recognizer.Dispose() }
  }
} catch {
  $defaultInputError = $_.Exception.Message
}
$privacy = @()
foreach($p in @(
  @{scope='current-user'; path='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'},
  @{scope='local-machine'; path='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'}
)) {
  if (Test-Path $p.path) {
    $props = Get-ItemProperty $p.path
    $privacy += [pscustomobject]@{
      scope = $p.scope
      value = [string]$props.Value
    }
  }
}
$microphones = @($endpoints | Where-Object { $_.direction -eq 'input' })
$speakers = @($endpoints | Where-Object { $_.direction -eq 'output' })
$otherEndpoints = @($endpoints | Where-Object { $_.direction -eq 'unknown' })
$ok = $microphones.Count -gt 0 -and $defaultInputUsable -and ($privacy | Where-Object { $_.value -eq 'Deny' }).Count -eq 0
[pscustomobject]@{
  ok = $ok
  checkedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  platform = '${process.platform}'
  microphones = $microphones
  speakers = $speakers
  otherEndpoints = $otherEndpoints
  recognizers = $recognizers
  privacy = $privacy
  defaultInputUsable = $defaultInputUsable
  defaultInputError = $defaultInputError
  summary = if ($ok) { '麦克风已连接，默认输入设备可用。' } elseif ($microphones.Count -eq 0) { '未检测到麦克风输入端点。' } elseif (-not $defaultInputUsable) { '检测到麦克风，但默认输入无法被语音识别器打开。' } else { '麦克风权限或设备状态需要检查。' }
} | ConvertTo-Json -Depth 8 -Compress
`;
  return await runPowerShellJson<VoiceDeviceDiagnostics>(script);
}

export class WindowsVoice {
  private asrWorker: FasterWhisperWorker | undefined;

  constructor(private readonly config: JarvisConfig["voice"]) {}

  async preloadAsr(): Promise<void> {
    const status = this.status();
    if (!this.config.enabled || status.asrProvider !== "faster-whisper") {
      return;
    }
    const timeoutMs = clamp(this.config.asrTimeoutMs ?? 300000, 3000, 300000, 300000);
    this.asrWorker ??= new FasterWhisperWorker(this.config);
    await this.asrWorker.ready(timeoutMs);
  }

  status(): VoiceStatus {
    const sapiAvailable =
      this.config.enabled && this.config.provider === "windows-sapi" && process.platform === "win32";
    const ttsProvider = ttsProviderFrom(this.config);
    const asrProvider = asrProviderFrom(this.config);
    const asrModel = asrModelFrom(this.config);
    const asrModelAvailable = this.config.enabled && asrProvider === "faster-whisper";
    const ttsModelAvailable = this.config.enabled && ttsProvider === "msedge-tts";
    const ttsAvailable = ttsProvider === "msedge-tts" ? ttsModelAvailable || sapiAvailable : sapiAvailable;
    const asrAvailable = asrProvider === "faster-whisper" ? asrModelAvailable || sapiAvailable : sapiAvailable;
    return {
      enabled: this.config.enabled,
      provider: this.config.provider,
      asrProvider,
      asrModel,
      asrModelAvailable,
      fallbackToWindowsAsr: this.config.fallbackToWindowsAsr ?? true,
      ttsProvider,
      ttsVoice: ttsProvider === "msedge-tts" ? ttsVoiceFrom(this.config) : "Windows SAPI",
      ttsModelAvailable,
      sapiAvailable,
      fallbackToSapi: this.config.fallbackToSapi ?? true,
      language: normalizeSpeechLanguage(this.config.language),
      platform: process.platform,
      ttsAvailable,
      asrAvailable,
      available: ttsAvailable || asrAvailable,
      rate: this.config.rate,
      volume: this.config.volume,
      maxChars: this.config.maxChars,
      listenTimeoutMs: this.config.listenTimeoutMs,
    };
  }

  async speak(input: SpeakInput): Promise<SpeakResult> {
    const text = input.text.trim();
    if (!text) {
      throw new Error("voice.speak requires non-empty text.");
    }
    if (text.length > this.config.maxChars) {
      throw new Error(`voice.speak text is too long (${text.length} > ${this.config.maxChars}).`);
    }
    const status = this.status();
    if (!status.ttsAvailable) {
      throw new Error("Voice output is not available on this system.");
    }
    const rate = clamp(input.rate ?? this.config.rate, -10, 10, this.config.rate);
    const volume = clamp(input.volume ?? this.config.volume, 0, 100, this.config.volume);
    const playback = input.playback !== false;
    if (input.dryRun) {
      return {
        ok: true,
        dryRun: true,
        provider: status.ttsProvider,
        voice: status.ttsVoice,
        characters: text.length,
        playback,
      };
    }

    if (status.ttsProvider === "msedge-tts") {
      try {
        const audio = await synthesizeWithMsEdgeTts(text, this.config);
        if (playback) {
          await playAudioFileWithDefaultDevice(audio.audioFile, volume);
        }
        return {
          ok: true,
          dryRun: false,
          provider: "msedge-tts",
          voice: audio.voice,
          characters: text.length,
          audioFile: audio.audioFile,
          audioBytes: audio.audioBytes,
          playback,
        };
      } catch (err) {
        if (!(this.config.fallbackToSapi ?? true) || !status.sapiAvailable) {
          throw err;
        }
        await speakWithWindowsSapi(text, rate, volume, this.config.language);
        return {
          ok: true,
          dryRun: false,
          provider: "windows-sapi",
          voice: "Windows SAPI",
          fallbackUsed: true,
          characters: text.length,
          playback: true,
        };
      }
    }

    if (playback) {
      await speakWithWindowsSapi(text, rate, volume, this.config.language);
    }
    return {
      ok: true,
      dryRun: false,
      provider: "windows-sapi",
      voice: "Windows SAPI",
      characters: text.length,
      playback,
    };
  }

  async diagnoseDevices(): Promise<VoiceDeviceDiagnostics> {
    if (process.platform !== "win32") {
      return {
        ok: false,
        checkedAt: Date.now(),
        platform: process.platform,
        microphones: [],
        speakers: [],
        otherEndpoints: [],
        recognizers: [],
        privacy: [],
        defaultInputUsable: false,
        defaultInputError: "Windows voice device diagnostics are only available on Windows.",
        summary: "当前平台不是 Windows，无法使用本地 Windows 语音设备诊断。",
      };
    }
    return await diagnoseWindowsVoiceDevices();
  }

  async transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
    const status = this.status();
    const provider = status.asrProvider;
    const timeoutMs = clamp(input.timeoutMs ?? this.config.asrTimeoutMs ?? 180000, 3000, 300000, 180000);
    if (input.dryRun) {
      return {
        ok: true,
        dryRun: true,
        provider,
        model: provider === "faster-whisper" ? status.asrModel : undefined,
        transcript: "",
        language: normalizeSpeechLanguage(input.language ?? this.config.language),
        timeoutMs,
      };
    }
    if (!this.config.enabled || !status.asrAvailable) {
      throw new Error("Voice transcription is not available on this system.");
    }
    if (!input.audio.length) {
      throw new Error("voice.transcribe requires non-empty audio.");
    }
    if (provider !== "faster-whisper") {
      throw new Error("Audio-file transcription requires voice.asrProvider=faster-whisper.");
    }

    const inputDir = asrAudioDirFrom(this.config);
    await fs.mkdir(inputDir, { recursive: true });
    const audioFile = path.join(
      inputDir,
      `asr-${Date.now()}-${Math.random().toString(16).slice(2)}${audioExtensionFrom(input.contentType)}`,
    );
    await fs.writeFile(audioFile, input.audio);
    this.asrWorker ??= new FasterWhisperWorker(this.config);
    let result: FasterWhisperOutput;
    try {
      result = await this.asrWorker.transcribe(audioFile, input.language ?? this.config.language, timeoutMs);
    } catch {
      result = await transcribeWithFasterWhisper(
        audioFile,
        this.config,
        input.language ?? this.config.language,
        timeoutMs,
      );
    }
    return {
      ok: true,
      dryRun: false,
      provider: "faster-whisper",
      model: result.model ?? status.asrModel,
      device: result.device,
      computeType: result.computeType,
      transcript: result.transcript?.trim() ?? "",
      language: result.language,
      languageProbability: result.languageProbability,
      duration: result.duration,
      processingMs: result.processingMs,
      timeoutMs,
      audioFile,
      audioBytes: input.audio.length,
      fallbackUsed: result.fallbackUsed,
    };
  }

  async listenOnce(input: ListenInput = {}): Promise<ListenResult> {
    const status = this.status();
    if (!status.sapiAvailable) {
      throw new Error("Windows speech recognition is not available on this system.");
    }
    const timeoutMs = clamp(input.timeoutMs ?? this.config.listenTimeoutMs, 1000, 30000, this.config.listenTimeoutMs);
    if (input.dryRun) {
      return {
        ok: true,
        dryRun: true,
        provider: this.config.provider,
        transcript: "",
        culture: normalizeSpeechLanguage(this.config.language),
        timeoutMs,
      };
    }
    const result = await listenWithWindowsSpeech(timeoutMs, this.config.language);
    return {
      ok: true,
      dryRun: false,
      provider: this.config.provider,
      transcript: result.transcript,
      confidence: result.confidence,
      culture: result.culture,
      timeoutMs,
    };
  }
}
