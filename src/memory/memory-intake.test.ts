import { describe, expect, it } from "vitest";
import { extractMemoryCandidates } from "./memory-intake.js";

describe("extractMemoryCandidates", () => {
  it("extracts explicit memory requests", () => {
    const candidates = extractMemoryCandidates("记住：我的测试代号是蓝鲸。", "main");

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.text).toContain("蓝鲸");
    expect(candidates[0]?.importance).toBeGreaterThan(0.85);
    expect(candidates[0]?.tags).toContain("explicit");
  });

  it("cleans English explicit memory commands", () => {
    const candidates = extractMemoryCandidates(
      "Remember: my autonomous memory smoke code is orange-lantern.",
      "main",
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.text).toBe("my autonomous memory smoke code is orange-lantern.");
  });

  it("extracts durable preferences", () => {
    const candidates = extractMemoryCandidates(
      "以后每次回答都要先主动回忆相关长期记忆。",
      "main",
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.kind).toBe("system");
  });

  it("does not pollute long-term memory with trivial chat", () => {
    expect(extractMemoryCandidates("你好", "main")).toEqual([]);
    expect(extractMemoryCandidates("这个是什么？", "main")).toEqual([]);
  });
});
