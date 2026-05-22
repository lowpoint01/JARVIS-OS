export type RiskLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type JarvisConfig = {
  runtime: {
    name: string;
    host: string;
    port: number;
  };
  secrets: {
    importFromOpenClaw: boolean;
  };
  models: {
    chat: ModelEndpointConfig;
    embedding: EmbeddingEndpointConfig;
  };
  initiative: {
    tickMs: number;
    defaultMode: "quiet" | "active" | "tactical";
    notifyThreshold: number;
    executeThreshold: number;
  };
  perception: {
    tickMs: number;
    memoryWarningFreeRatio: number;
    eventImportance: number;
  };
  reflection: {
    tickMs: number;
    chatLatencyWarningMs: number;
  };
  modelRouting: {
    fastLatencyTargetMs: number;
    slowLatencyWarningMs: number;
    sampleWindow: number;
  };
  voice: {
    enabled: boolean;
    provider: "windows-sapi";
    asrProvider?: "windows-sapi" | "faster-whisper";
    asrModel?: string;
    asrDevice?: "auto" | "cpu" | "cuda";
    asrComputeType?: string;
    asrTimeoutMs?: number;
    asrCacheDir?: string;
    asrCudaDllDirs?: string[];
    fallbackToWindowsAsr?: boolean;
    ttsProvider?: "windows-sapi" | "msedge-tts";
    ttsVoice?: string;
    ttsRate?: string;
    ttsVolume?: string;
    ttsPitch?: string;
    ttsTimeoutMs?: number;
    audioCacheDir?: string;
    fallbackToSapi?: boolean;
    language: string;
    rate: number;
    volume: number;
    maxChars: number;
    listenTimeoutMs: number;
  };
  safety: {
    autoAllowLevels: RiskLevel[];
    confirmLevels: RiskLevel[];
    blockLevels: RiskLevel[];
  };
  toolRuntime: {
    allowedRoots: string[];
    excludedSegments: string[];
    maxReadBytes: number;
    searchLimit: number;
    commandTimeoutMs: number;
  };
  storage: {
    eventLogPath: string;
    auditLogPath: string;
    memoryLogPath: string;
    memoryVaultDir: string;
    conversationDir: string;
    actionLogPath: string;
    notificationLogPath: string;
    reminderLogPath: string;
    worldModelPath: string;
    reflectionLogPath: string;
  };
};

export type ModelEndpointConfig = {
  provider: string;
  model: string;
  baseUrl: string;
  envKey: string;
  timeoutMs: number;
  maxTokens?: number;
  thinking?: "default" | "enabled" | "disabled";
};

export type EmbeddingEndpointConfig = ModelEndpointConfig & {
  dimensions: number;
};

export type JarvisEvent<TPayload = unknown> = {
  id: string;
  type: string;
  source: string;
  timestamp: number;
  importance: number;
  payload: TPayload;
};

export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  canRollback: boolean;
  inputSchema?: unknown;
  handler: (input: TInput, context: ToolContext) => Promise<TOutput>;
};

export type ToolContext = {
  requestId: string;
  emitEvent: <TPayload>(event: Omit<JarvisEvent<TPayload>, "id" | "timestamp">) => Promise<void>;
};

export type ToolCallResult =
  | {
      ok: true;
      status: "executed";
      riskLevel: RiskLevel;
      output: unknown;
    }
  | {
      ok: false;
      status: "needs_confirmation" | "blocked" | "not_found" | "failed";
      riskLevel?: RiskLevel;
      actionId?: string;
      error: string;
    };

export type HealthSnapshot = {
  ok: boolean;
  ready: boolean;
  uptimeMs: number;
  version: string;
  components: Record<string, ComponentHealth>;
};

export type ComponentHealth = {
  ok: boolean;
  detail?: string;
};
