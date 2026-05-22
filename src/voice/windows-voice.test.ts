import { describe, expect, it } from "vitest";
import { WindowsVoice } from "./windows-voice.js";

const voice = new WindowsVoice({
  enabled: true,
  provider: "windows-sapi",
  language: "zh-CN",
  rate: 0,
  volume: 80,
  maxChars: 20,
  listenTimeoutMs: 3000,
});

describe("WindowsVoice", () => {
  it("reports local voice status", () => {
    const status = voice.status();

    expect(status.provider).toBe("windows-sapi");
    expect(status.language).toBe("zh-CN");
    expect(status.maxChars).toBe(20);
    expect(status.listenTimeoutMs).toBe(3000);
  });

  it("supports dry-run speech without audio output", async () => {
    const result = await voice.speak({ text: "Hello", dryRun: true });

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      characters: 5,
    });
  });

  it("rejects overlong speech", async () => {
    await expect(voice.speak({ text: "This sentence is too long.", dryRun: true })).rejects.toThrow(
      /too long/,
    );
  });

  it("supports dry-run listening without microphone access", async () => {
    const result = await voice.listenOnce({ dryRun: true, timeoutMs: 1500 });

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      transcript: "",
      timeoutMs: 1500,
    });
  });
});
