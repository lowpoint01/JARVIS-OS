export type BriefingSeverity = "ok" | "watch" | "action";

export type BriefingSection = {
  title: string;
  items: string[];
};

export type BriefingReport = {
  generatedAt: number;
  headline: string;
  severity: BriefingSeverity;
  sections: BriefingSection[];
  suggestedActions: string[];
};

export type GenerateBriefingInput = {
  now?: number;
  selfSummary: string;
  selfOk: boolean;
  toolCount: number;
  memoryRecords: number;
  worldEntities: number;
  reflectionRecords: number;
  unreadNotifications: number;
  pendingActions: number;
  scheduledReminders: number;
  modelDefaultMode?: string;
  chatLatencyLastMs?: number;
  voiceAvailable: boolean;
  perceptionRunning: boolean;
  recentFailures: number;
};

function chooseSeverity(input: GenerateBriefingInput): BriefingSeverity {
  if (!input.selfOk || input.pendingActions > 0 || input.recentFailures > 0) {
    return "action";
  }
  if (
    input.unreadNotifications > 0 ||
    !input.voiceAvailable ||
    !input.perceptionRunning ||
    (input.chatLatencyLastMs !== undefined && input.chatLatencyLastMs > 2000)
  ) {
    return "watch";
  }
  return "ok";
}

function headlineFor(severity: BriefingSeverity, input: GenerateBriefingInput): string {
  if (severity === "action") {
    if (!input.selfOk) {
      return "JARVIS 在继续自主运行前需要处理自检问题。";
    }
    if (input.pendingActions > 0) {
      return `JARVIS 运行正常，但有 ${input.pendingActions} 个动作等待审批。`;
    }
    return `JARVIS 最近检测到 ${input.recentFailures} 个失败信号。`;
  }
  if (severity === "watch") {
    return "JARVIS 正常运行中，但有观察项需要留意。";
  }
  return "JARVIS 正常运行，已准备好进行主动协助。";
}

function pushAction(actions: string[], condition: boolean, action: string): void {
  if (condition) {
    actions.push(action);
  }
}

export function generateBriefing(input: GenerateBriefingInput): BriefingReport {
  const severity = chooseSeverity(input);
  const suggestedActions: string[] = [];

  pushAction(
    suggestedActions,
    !input.selfOk,
    "先运行 self.repair_plan，并处理失败的自检项，再进行长时间自主任务。",
  );
  pushAction(
    suggestedActions,
    input.pendingActions > 0,
    "检查待审批动作，让安全的排队任务可以继续执行。",
  );
  pushAction(
    suggestedActions,
    input.recentFailures > 0,
    "查看最近事件，确认是否存在模型、记忆、网关或工具的重复失败。",
  );
  pushAction(
    suggestedActions,
    input.unreadNotifications > 0,
    "处理未读通知，并清理过期或无用提醒。",
  );
  pushAction(
    suggestedActions,
    !input.voiceAvailable,
    "本地 Windows 语音服务可用前，将语音能力视为可选备用通道。",
  );
  pushAction(
    suggestedActions,
    input.chatLatencyLastMs !== undefined && input.chatLatencyLastMs > 2000,
    "日常回复优先使用快速模式，把深度思考留给明确复杂任务。",
  );

  if (suggestedActions.length === 0) {
    suggestedActions.push("继续保持正常主动监控。");
  }

  return {
    generatedAt: input.now ?? Date.now(),
    headline: headlineFor(severity, input),
    severity,
    sections: [
      {
        title: "系统",
        items: [
          `自检：${input.selfSummary}`,
          `工具：已注册 ${input.toolCount} 个`,
          `感知：${input.perceptionRunning ? "运行中" : "已停止"}`,
        ],
      },
      {
        title: "注意事项",
        items: [
          `待审批动作：${input.pendingActions}`,
          `未读通知：${input.unreadNotifications}`,
          `已安排提醒：${input.scheduledReminders}`,
          `最近失败信号：${input.recentFailures}`,
        ],
      },
      {
        title: "智能能力",
        items: [
          `长期记忆：${input.memoryRecords}`,
          `世界实体：${input.worldEntities}`,
          `反思记录：${input.reflectionRecords}`,
          `模型模式：${input.modelDefaultMode ?? "未知"}`,
          `最近对话延迟：${input.chatLatencyLastMs ?? "未知"}ms`,
        ],
      },
      {
        title: "语音",
        items: [`本地语音：${input.voiceAvailable ? "可用" : "不可用"}`],
      },
    ],
    suggestedActions,
  };
}

export function briefingToPrompt(report: BriefingReport): string {
  const sectionLines = report.sections.flatMap((section) => [
    `${section.title}:`,
    ...section.items.map((item) => `- ${item}`),
  ]);
  return [
    `当前 JARVIS 简报：${report.headline}`,
    `严重级别：${report.severity}`,
    ...sectionLines,
    "建议动作：",
    ...report.suggestedActions.map((action) => `- ${action}`),
  ].join("\n");
}
