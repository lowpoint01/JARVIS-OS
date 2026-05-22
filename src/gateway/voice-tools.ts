import type { ToolDefinition } from "../shared/types.js";
import type { WindowsVoice } from "../voice/windows-voice.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function buildVoiceTools(voice: WindowsVoice): ToolDefinition[] {
  return [
    {
      name: "voice.status",
      description: "Read local voice output capability, TTS provider, and configuration.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => voice.status(),
    },
    {
      name: "voice.devices",
      description: "Diagnose local microphone, speaker, speech recognizer, and microphone privacy state.",
      riskLevel: "L0",
      requiresConfirmation: false,
      canRollback: false,
      handler: async () => await voice.diagnoseDevices(),
    },
    {
      name: "voice.transcribe_audio",
      description: "Transcribe an audio payload through the configured local ASR model.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.audioBase64 !== "string") {
          throw new Error("voice.transcribe_audio requires { audioBase64: string }.");
        }
        return await voice.transcribeAudio({
          audio: Buffer.from(body.audioBase64, "base64"),
          contentType: typeof body.contentType === "string" ? body.contentType : undefined,
          language: typeof body.language === "string" ? body.language : undefined,
          dryRun: typeof body.dryRun === "boolean" ? body.dryRun : undefined,
          timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
        });
      },
    },
    {
      name: "voice.speak",
      description: "Speak text through the configured TTS model, falling back to Windows SAPI when enabled.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        if (typeof body?.text !== "string") {
          throw new Error("voice.speak requires { text: string }.");
        }
        return await voice.speak({
          text: body.text,
          dryRun: typeof body.dryRun === "boolean" ? body.dryRun : undefined,
          playback: typeof body.playback === "boolean" ? body.playback : undefined,
          rate: typeof body.rate === "number" ? body.rate : undefined,
          volume: typeof body.volume === "number" ? body.volume : undefined,
        });
      },
    },
    {
      name: "voice.tts_probe",
      description: "Synthesize a short phrase with the configured TTS model without playing it.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        return await voice.speak({
          text:
            typeof body?.text === "string" && body.text.trim()
              ? body.text
              : "JARVIS TTS model probe.",
          playback: false,
        });
      },
    },
    {
      name: "voice.listen_once",
      description: "Listen once through the local Windows speech recognition engine.",
      riskLevel: "L1",
      requiresConfirmation: false,
      canRollback: false,
      handler: async (input) => {
        const body = asRecord(input);
        return await voice.listenOnce({
          dryRun: typeof body?.dryRun === "boolean" ? body.dryRun : undefined,
          timeoutMs: typeof body?.timeoutMs === "number" ? body.timeoutMs : undefined,
        });
      },
    },
  ];
}
