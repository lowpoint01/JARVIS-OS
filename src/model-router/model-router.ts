import type { LoadedConfig } from "../config/config.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatResponse = {
  provider: string;
  model: string;
  mode: ChatMode;
  content: string;
  latencyMs: number;
  raw?: unknown;
};

type EmbeddingResponse = {
  provider: string;
  model: string;
  dimensions: number;
  embedding: number[];
  latencyMs: number;
};

export type ChatMode = "fast" | "standard" | "deep";

type LatencySummary = {
  count: number;
  averageMs?: number;
  maxMs?: number;
  lastMs?: number;
};

type ModelProbeResult = {
  ok: boolean;
  checkedAt: number;
  chat?: {
    ok: boolean;
    latencyMs?: number;
    mode?: ChatMode;
    error?: string;
  };
  embedding?: {
    ok: boolean;
    latencyMs?: number;
    dimensions?: number;
    error?: string;
  };
};

function summarizeUpstreamBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
    return parsed.error?.message ?? parsed.message ?? body.slice(0, 500);
  } catch {
    return body.slice(0, 500);
  }
}

export class UpstreamHttpError extends Error {
  readonly summary: string;

  constructor(
    readonly statusCode: number,
    body: string,
  ) {
    const summary = summarizeUpstreamBody(body);
    super(`Upstream HTTP ${statusCode}: ${summary}`);
    this.name = "UpstreamHttpError";
    this.summary = summary;
  }
}

async function fetchJsonWithTimeout<T>(
  url: string,
  options: RequestInit & { timeoutMs: number },
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new UpstreamHttpError(response.status, text);
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeEmbedding(value: unknown): number[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return value;
  }
  if (Array.isArray(value) && value.length === 1) {
    return normalizeEmbedding(value[0]);
  }
  throw new Error("Embedding response did not include a numeric vector.");
}

function isKimiK2Series(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized === "kimi-k2.6" || normalized === "kimi-k2.5";
}

function buildChatRequestBody(config: LoadedConfig["config"], mode: ChatMode): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.models.chat.model,
    max_tokens: config.models.chat.maxTokens ?? 2048,
  };
  if (isKimiK2Series(config.models.chat.model)) {
    const thinking =
      mode === "fast" ? "disabled" : mode === "deep" ? "enabled" : config.models.chat.thinking;
    if (thinking === "enabled" || thinking === "disabled") {
      body.thinking = { type: thinking };
    }
    return body;
  }
  body.temperature = 0.3;
  return body;
}

export class ModelRouter {
  private chatLatencies: number[] = [];
  private embeddingLatencies: number[] = [];
  private lastProbe: ModelProbeResult | undefined;

  constructor(private readonly loaded: LoadedConfig) {}

  status(): Record<string, unknown> {
    const { config, secrets } = this.loaded;
    return {
      chat: {
        provider: config.models.chat.provider,
        model: config.models.chat.model,
        baseUrl: config.models.chat.baseUrl,
        hasKey: Boolean(secrets.moonshotApiKey),
      },
      embedding: {
        provider: config.models.embedding.provider,
        model: config.models.embedding.model,
        baseUrl: config.models.embedding.baseUrl,
        dimensions: config.models.embedding.dimensions,
        hasKey: Boolean(secrets.volcengineApiKey),
      },
      routing: {
        defaultMode: this.defaultMode(),
        chatLatency: this.latencySummary(this.chatLatencies),
        embeddingLatency: this.latencySummary(this.embeddingLatencies),
        fastLatencyTargetMs: config.modelRouting.fastLatencyTargetMs,
        slowLatencyWarningMs: config.modelRouting.slowLatencyWarningMs,
        lastProbe: this.lastProbe,
      },
    };
  }

  async chat(params: {
    message?: string;
    messages?: ChatMessage[];
    system?: string;
    mode?: ChatMode;
  }): Promise<ChatResponse> {
    const startedAt = Date.now();
    const { config, secrets } = this.loaded;
    if (!secrets.moonshotApiKey) {
      throw new Error(
        `Missing chat API key. Set ${config.models.chat.envKey} or enable OpenClaw secret import.`,
      );
    }
    const messages: ChatMessage[] =
      params.messages ??
      [
        {
          role: "system",
          content:
            params.system ??
            "You are JARVIS-OS, a proactive personal AI operating layer. Be concise, capable, and safety-aware.",
        },
        { role: "user", content: params.message ?? "" },
      ];
    if (!messages.some((message) => message.role === "user" && message.content.trim())) {
      throw new Error("Chat requires at least one non-empty user message.");
    }
    type OpenAiChatResponse = {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const mode = this.resolveMode(params.mode);
    const raw = await fetchJsonWithTimeout<OpenAiChatResponse>(
      `${config.models.chat.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        timeoutMs: config.models.chat.timeoutMs,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secrets.moonshotApiKey}`,
        },
        body: JSON.stringify({
          ...buildChatRequestBody(config, mode),
          messages,
        }),
      },
    );
    const content = raw.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Chat response did not include assistant content.");
    }
    const latencyMs = Date.now() - startedAt;
    this.recordLatency(this.chatLatencies, latencyMs);
    return {
      provider: config.models.chat.provider,
      model: config.models.chat.model,
      mode,
      content,
      latencyMs,
      raw,
    };
  }

  async embed(text: string): Promise<EmbeddingResponse> {
    const startedAt = Date.now();
    const { config, secrets } = this.loaded;
    if (!secrets.volcengineApiKey) {
      throw new Error(
        `Missing embedding API key. Set ${config.models.embedding.envKey} or enable OpenClaw secret import.`,
      );
    }
    type VolcengineEmbeddingResponse = {
      data?: Array<{ embedding?: unknown }> | { embedding?: unknown };
      embedding?: unknown;
    };
    const raw = await fetchJsonWithTimeout<VolcengineEmbeddingResponse>(
      `${config.models.embedding.baseUrl.replace(/\/$/, "")}/embeddings/multimodal`,
      {
        method: "POST",
        timeoutMs: config.models.embedding.timeoutMs,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secrets.volcengineApiKey}`,
        },
        body: JSON.stringify({
          model: config.models.embedding.model,
          input: [{ type: "text", text }],
        }),
      },
    );
    const embeddingValue =
      (Array.isArray(raw.data) ? raw.data[0]?.embedding : raw.data?.embedding) ?? raw.embedding;
    const embedding = normalizeEmbedding(embeddingValue);
    const latencyMs = Date.now() - startedAt;
    this.recordLatency(this.embeddingLatencies, latencyMs);
    return {
      provider: config.models.embedding.provider,
      model: config.models.embedding.model,
      dimensions: embedding.length,
      embedding,
      latencyMs,
    };
  }

  async probe(): Promise<ModelProbeResult> {
    const result: ModelProbeResult = {
      ok: false,
      checkedAt: Date.now(),
    };
    try {
      const chat = await this.chat({
        system: "You are a health probe. Reply with OK only.",
        message: "Reply exactly OK.",
        mode: "fast",
      });
      result.chat = {
        ok: true,
        latencyMs: chat.latencyMs,
        mode: chat.mode,
      };
    } catch (err) {
      result.chat = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    try {
      const embedding = await this.embed("JARVIS model routing probe");
      result.embedding = {
        ok: true,
        latencyMs: embedding.latencyMs,
        dimensions: embedding.dimensions,
      };
    } catch (err) {
      result.embedding = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    result.ok = Boolean(result.chat?.ok && result.embedding?.ok);
    this.lastProbe = result;
    return result;
  }

  private defaultMode(): ChatMode {
    const average = this.latencySummary(this.chatLatencies).averageMs;
    if (average && average > this.loaded.config.modelRouting.fastLatencyTargetMs) {
      return "fast";
    }
    return this.loaded.config.models.chat.thinking === "enabled" ? "standard" : "fast";
  }

  private resolveMode(requested?: ChatMode): ChatMode {
    if (requested) {
      return requested;
    }
    return this.defaultMode();
  }

  private recordLatency(target: number[], latencyMs: number): void {
    target.push(latencyMs);
    const max = Math.max(1, this.loaded.config.modelRouting.sampleWindow);
    while (target.length > max) {
      target.shift();
    }
  }

  private latencySummary(values: number[]): LatencySummary {
    if (values.length === 0) {
      return { count: 0 };
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
      count: values.length,
      averageMs: Math.round(total / values.length),
      maxMs: Math.max(...values),
      lastMs: values.at(-1),
    };
  }
}
