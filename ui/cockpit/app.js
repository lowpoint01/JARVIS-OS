const state = {
  sessionId: "main",
  events: [],
  lastAssistantText: "",
  eventSocket: undefined,
  realtimeVoice: {
    active: false,
    busy: false,
    stream: undefined,
    audioContext: undefined,
    analyser: undefined,
    source: undefined,
    rafId: undefined,
    recorder: undefined,
    chunks: [],
    startedAt: 0,
    lastVoiceAt: 0,
    noiseSamples: [],
    threshold: 0.018,
    turnCount: 0,
  },
};

const MODEL_DICTATION_RECORD_MS = 4500;
const REALTIME_CALIBRATION_MS = 900;
const REALTIME_MIN_RECORD_MS = 650;
const REALTIME_END_SILENCE_MS = 850;
const REALTIME_MAX_RECORD_MS = 12_000;

const elements = {
  connectionState: document.querySelector("#connectionState"),
  selfStatus: document.querySelector("#selfStatus"),
  enterpriseScore: document.querySelector("#enterpriseScore"),
  enterpriseStatus: document.querySelector("#enterpriseStatus"),
  toolCount: document.querySelector("#toolCount"),
  memoryCount: document.querySelector("#memoryCount"),
  queueCount: document.querySelector("#queueCount"),
  uptimeValue: document.querySelector("#uptimeValue"),
  messages: document.querySelector("#messages"),
  chatForm: document.querySelector("#chatForm"),
  messageInput: document.querySelector("#messageInput"),
  wakeButton: document.querySelector("#wakeButton"),
  dictateButton: document.querySelector("#dictateButton"),
  realtimeVoiceButton: document.querySelector("#realtimeVoiceButton"),
  realtimeVoiceStatus: document.querySelector("#realtimeVoiceStatus"),
  speakButton: document.querySelector("#speakButton"),
  refreshButton: document.querySelector("#refreshButton"),
  briefingButton: document.querySelector("#briefingButton"),
  briefing: document.querySelector("#briefing"),
  readinessChecks: document.querySelector("#readinessChecks"),
  componentGrid: document.querySelector("#componentGrid"),
  modelStatus: document.querySelector("#modelStatus"),
  voiceStatus: document.querySelector("#voiceStatus"),
  loopStatus: document.querySelector("#loopStatus"),
  notifications: document.querySelector("#notifications"),
  notificationCount: document.querySelector("#notificationCount"),
  actions: document.querySelector("#actions"),
  reminderForm: document.querySelector("#reminderForm"),
  reminderTitle: document.querySelector("#reminderTitle"),
  reminderMinutes: document.querySelector("#reminderMinutes"),
  reminderMessage: document.querySelector("#reminderMessage"),
  reminderCount: document.querySelector("#reminderCount"),
  reminders: document.querySelector("#reminders"),
  memories: document.querySelector("#memories"),
  worldStatus: document.querySelector("#worldStatus"),
  reflectionStatus: document.querySelector("#reflectionStatus"),
  toolCatalog: document.querySelector("#toolCatalog"),
  events: document.querySelector("#events"),
};

async function api(route, options = {}) {
  const response = await fetch(route, {
    headers: options.body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
    ...options,
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(data.error ?? `接口返回 HTTP ${response.status}`);
  }
  return data;
}

function clear(node) {
  node.replaceChildren();
}

function setText(node, value) {
  if (node) {
    node.textContent = value;
  }
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "无";
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) {
    return "-";
  }
  if (ms < 1000) {
    return `${Math.round(ms)} 毫秒`;
  }
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)} 秒`;
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)} 分钟`;
  }
  return `${Math.round(ms / 3_600_000)} 小时`;
}

const encodingDamagePattern =
  /[\uFFFD]|\u935e|\u93ba|\u9477|\u93c8|\u7039|\u5a0c|\u9429|\u95c0|\u93c3|\u93cd|\u9359|\u7487|\u5a34|\u7ee0|\u59e3|\u7ec9|\u6942|\u95c4|\u7ead|\u7459|\u6fb6|\u8fab|\u89e6/;

function hasEncodingDamage(text) {
  return encodingDamagePattern.test(text);
}

function displayText(value, fallback = "-") {
  const text = value === undefined || value === null ? fallback : String(value);
  if (hasEncodingDamage(text)) {
    return "历史内容存在编码异常，已在控制台隐藏原文。";
  }
  return text;
}

function statusLabel(value) {
  return value ? "正常" : "异常";
}

function riskLabel(level) {
  const labels = {
    L0: "只读",
    L1: "低风险",
    L2: "需确认",
    L3: "高风险确认",
    L4: "已阻断",
  };
  return labels[level] ?? level ?? "未知";
}

function readinessLabel(level) {
  const labels = {
    pass: "通过",
    watch: "观察",
    fail: "失败",
  };
  return labels[level] ?? level;
}

function maturityLabel(value) {
  const labels = {
    "enterprise-ready": "企业级就绪",
    "enterprise-watch": "企业级观察",
    "not-ready": "未就绪",
  };
  return labels[value] ?? value ?? "未知";
}

function categoryLabel(value) {
  const labels = {
    service: "服务",
    security: "安全",
    data: "数据",
    observability: "观测",
    intelligence: "智能",
    automation: "自动化",
    operations: "运维",
  };
  return labels[value] ?? value ?? "未知";
}

function checkLabel(value) {
  const labels = {
    "service.health": "服务健康",
    "service.local_binding": "本地绑定",
    "self.posture": "自我状态",
    preflight: "启动前检查",
    "models.chat": "对话模型",
    "models.embedding": "向量模型",
    "models.latency": "模型延迟",
    "tool.registry": "工具注册表",
    "safety.policy": "安全策略",
    "data.storage": "数据存储",
    "data.memory": "长期记忆",
    "observability.events": "事件观测",
    "loops.runtime": "运行循环",
    "voice.local": "本地语音",
    "operations.queues": "运维队列",
  };
  return labels[value] ?? value ?? "未知检查";
}

function empty(label) {
  const node = document.createElement("div");
  node.className = "empty";
  node.textContent = label;
  return node;
}

function pill(text, tone = "neutral") {
  const node = document.createElement("span");
  node.className = `pill ${tone}`;
  node.textContent = text;
  return node;
}

function detailRow(label, value) {
  const row = document.createElement("div");
  row.className = "detail-row";
  const key = document.createElement("span");
  key.textContent = displayText(label);
  const val = document.createElement("strong");
  val.textContent = displayText(value);
  row.append(key, val);
  return row;
}

function item(title, message, meta, tone = "") {
  const node = document.createElement("article");
  node.className = tone ? `item ${tone}` : "item";
  const h3 = document.createElement("h3");
  h3.textContent = displayText(title);
  const p = document.createElement("p");
  p.textContent = displayText(message);
  node.append(h3, p);
  if (meta) {
    const small = document.createElement("span");
    small.className = "meta";
    small.textContent = displayText(meta);
    node.append(small);
  }
  return node;
}

function metric(label, value, detail, tone = "") {
  const node = document.createElement("article");
  node.className = tone ? `metric ${tone}` : "metric";
  const title = document.createElement("span");
  title.textContent = displayText(label);
  const strong = document.createElement("strong");
  strong.textContent = displayText(value);
  const small = document.createElement("em");
  small.textContent = displayText(detail ?? "");
  node.append(title, strong, small);
  return node;
}

function messageNode(role, content) {
  const node = document.createElement("div");
  node.className = `message ${role}`;
  node.textContent = displayText(content);
  return node;
}

function smallList(items) {
  const list = document.createElement("div");
  list.className = "small-list";
  for (const text of items.length ? items : ["暂无"]) {
    const row = document.createElement("span");
    row.textContent = displayText(text);
    list.append(row);
  }
  return list;
}

function latestAssistantText() {
  const assistantMessages = Array.from(elements.messages.querySelectorAll(".message.assistant"));
  return assistantMessages.at(-1)?.textContent?.trim() ?? state.lastAssistantText;
}

function renderError(target, title, err) {
  clear(target);
  target.append(item(title, err instanceof Error ? err.message : String(err), "请确认网关已启动", "danger-card"));
}

function addEventLine(text) {
  state.events.unshift(displayText(text));
  state.events = state.events.slice(0, 80);
  clear(elements.events);
  for (const event of state.events) {
    const line = document.createElement("div");
    line.className = "event-line";
    line.textContent = event;
    elements.events.append(line);
  }
}

function setRealtimeVoiceStatus(text, mode = "idle") {
  if (!elements.realtimeVoiceStatus) {
    return;
  }
  elements.realtimeVoiceStatus.textContent = text;
  elements.realtimeVoiceStatus.dataset.mode = mode;
}

function renderBriefing(report) {
  clear(elements.briefing);
  const severityText = report.severity === "action" ? "需要行动" : report.severity === "watch" ? "观察" : "正常";
  const node = item(severityText, report.headline, `生成时间：${formatTime(report.generatedAt)}`, `severity-${report.severity}`);
  for (const section of report.sections ?? []) {
    const block = document.createElement("div");
    block.className = "briefing-section";
    const title = document.createElement("strong");
    title.textContent = section.title;
    block.append(title, smallList(section.items ?? []));
    node.append(block);
  }
  const actions = document.createElement("div");
  actions.className = "briefing-section";
  const actionTitle = document.createElement("strong");
  actionTitle.textContent = "建议动作";
  actions.append(actionTitle, smallList(report.suggestedActions ?? []));
  node.append(actions);
  elements.briefing.append(node);
}

function renderReadiness(report) {
  setText(elements.enterpriseScore, `${report.score}/100`);
  setText(elements.enterpriseStatus, `${maturityLabel(report.maturity)} · ${report.summary}`);
  elements.enterpriseStatus.className = `pill ${report.ok ? "ok" : "danger"}`;
  clear(elements.readinessChecks);
  const checks = [...(report.checks ?? [])].sort((a, b) => {
    const weight = { fail: 0, watch: 1, pass: 2 };
    return weight[a.level] - weight[b.level];
  });
  for (const check of checks) {
    const tone = check.level === "fail" ? "danger-card" : check.level === "watch" ? "watch-card" : "ok-card";
    const node = item(
      `${readinessLabel(check.level)} · ${checkLabel(check.name)}`,
      check.detail,
      check.level !== "pass" && check.recommendation
        ? `建议：${check.recommendation}`
        : `类别：${categoryLabel(check.category)} · 标识：${check.name}`,
      tone,
    );
    elements.readinessChecks.append(node);
  }
}

function renderComponents(health) {
  clear(elements.componentGrid);
  setText(elements.uptimeValue, `已运行 ${formatDuration(health.uptimeMs)}`);
  const components = Object.entries(health.components ?? {});
  for (const [name, component] of components) {
    elements.componentGrid.append(
      metric(name, statusLabel(component.ok), component.detail ?? "无详情", component.ok ? "ok-card" : "danger-card"),
    );
  }
}

function renderModelStatus(status) {
  clear(elements.modelStatus);
  const chat = status.chat ?? {};
  const embedding = status.embedding ?? {};
  const routing = status.routing ?? {};
  const chatLatency = routing.chatLatency ?? {};
  const embeddingLatency = routing.embeddingLatency ?? {};
  elements.modelStatus.append(
    item("对话模型", `${chat.provider ?? "未知"} / ${chat.model ?? "未知"}`, `密钥：${chat.hasKey ? "已配置" : "未配置"} · baseUrl：${chat.baseUrl ?? "-"}`, chat.hasKey ? "ok-card" : "danger-card"),
    item("向量模型", `${embedding.provider ?? "未知"} / ${embedding.model ?? "未知"}`, `维度：${embedding.dimensions ?? "-"} · 密钥：${embedding.hasKey ? "已配置" : "未配置"}`, embedding.hasKey ? "ok-card" : "danger-card"),
    item(
      "路由与延迟",
      `默认模式：${routing.defaultMode ?? "-"}`,
      `对话最近：${formatDuration(chatLatency.lastMs)} · 对话最大：${formatDuration(chatLatency.maxMs)} · 向量最近：${formatDuration(embeddingLatency.lastMs)}`,
      "neutral-card",
    ),
  );
}

function renderVoiceStatus(status, devices) {
  clear(elements.voiceStatus);
  const microphones = devices?.microphones ?? [];
  const speakers = devices?.speakers ?? [];
  const recognizers = devices?.recognizers ?? [];
  elements.voiceStatus.append(
    item(
      "语音总状态",
      status.available ? "可用" : "不可用",
      `启用：${status.enabled ? "是" : "否"} · 平台：${status.platform} · 设备诊断：${devices?.summary ?? "未检查"}`,
      status.available && devices?.ok !== false ? "ok-card" : "watch-card",
    ),
    detailRow("ASR 识别模型通道", status.asrProvider),
    detailRow("ASR 识别模型", status.asrModel),
    detailRow("ASR 模型可用", status.asrModelAvailable ? "已配置" : "未配置"),
    detailRow("Windows 识别兜底", status.sapiAvailable && status.fallbackToWindowsAsr ? "可用" : "不可用"),
    detailRow("TTS 模型通道", status.ttsProvider),
    detailRow("TTS 音色", status.ttsVoice),
    detailRow("TTS 模型可用", status.ttsModelAvailable ? "已配置" : "未配置"),
    detailRow("SAPI 兜底", status.sapiAvailable && status.fallbackToSapi ? "可用" : "不可用"),
    detailRow("语音供应器", status.provider),
    detailRow("识别语言", status.language),
    detailRow("扬声器输出", status.ttsAvailable ? "可用" : "不可用"),
    detailRow("麦克风识别", status.asrAvailable ? "可用" : "不可用"),
    detailRow("默认麦克风输入", devices?.defaultInputUsable ? "可打开" : devices?.defaultInputError ?? "未知"),
    detailRow("检测到麦克风", `${microphones.length} 个`),
    detailRow("检测到扬声器", `${speakers.length} 个`),
    detailRow("识别器", `${recognizers.length} 个`),
    detailRow("朗读速度", String(status.rate)),
    detailRow("音量", `${status.volume}`),
    detailRow("单次朗读上限", `${status.maxChars} 字符`),
    detailRow("听写超时", formatDuration(status.listenTimeoutMs)),
  );
  for (const microphone of microphones.slice(0, 4)) {
    elements.voiceStatus.append(
      item("麦克风设备", microphone.name, `状态：${microphone.status} · ${microphone.instanceId}`),
    );
  }
  for (const speaker of speakers.slice(0, 4)) {
    elements.voiceStatus.append(
      item("扬声器设备", speaker.name, `状态：${speaker.status} · ${speaker.instanceId}`),
    );
  }
}

function renderLoops({ initiative, perception, reflection }) {
  clear(elements.loopStatus);
  elements.loopStatus.append(
    item("主动循环", initiative.running ? "运行中" : "已停止", `tick=${initiative.tickCount ?? 0} · 最近：${formatTime(initiative.lastTickAt)} · 已执行计划：${initiative.executedPlanCount ?? 0}`, initiative.running ? "ok-card" : "danger-card"),
    item("感知循环", perception.running ? "运行中" : "已停止", `tick=${perception.tickCount ?? 0} · 最近：${formatTime(perception.lastTickAt)}`, perception.running ? "ok-card" : "danger-card"),
    item("反思循环", reflection.running ? "运行中" : "已停止", `tick=${reflection.tickCount ?? 0} · 最近：${formatTime(reflection.lastTickAt)}`, reflection.running ? "ok-card" : "danger-card"),
  );
}

function renderNotifications(data) {
  clear(elements.notifications);
  setText(elements.notificationCount, `${data.notifications.length} 条`);
  if (!data.notifications.length) {
    elements.notifications.append(empty("没有未读通知。"));
    return;
  }
  for (const notification of data.notifications) {
    const node = item(
      notification.title,
      notification.message,
      `级别：${notification.level} · 来源：${notification.source} · 时间：${formatTime(notification.createdAt)}`,
      notification.level === "critical" ? "danger-card" : "watch-card",
    );
    const row = document.createElement("div");
    row.className = "actions-row";
    const read = document.createElement("button");
    read.type = "button";
    read.textContent = "标为已读";
    read.addEventListener("click", async () => {
      await api("/notifications/read", {
        method: "POST",
        body: JSON.stringify({ notificationId: notification.id }),
      });
      await refreshAll();
    });
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "danger";
    dismiss.textContent = "忽略";
    dismiss.addEventListener("click", async () => {
      await api("/notifications/dismiss", {
        method: "POST",
        body: JSON.stringify({ notificationId: notification.id }),
      });
      await refreshAll();
    });
    row.append(read, dismiss);
    node.append(row);
    elements.notifications.append(node);
  }
}

function renderActions(data) {
  clear(elements.actions);
  if (!data.actions.length) {
    elements.actions.append(empty("没有待审批动作。"));
    return;
  }
  for (const action of data.actions) {
    const node = item(
      action.toolName,
      action.reason,
      `${riskLabel(action.riskLevel)} · ${action.id} · 创建时间：${formatTime(action.createdAt)}`,
      "watch-card",
    );
    const row = document.createElement("div");
    row.className = "actions-row";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.textContent = "批准执行";
    approve.addEventListener("click", async () => {
      await api("/actions/approve", {
        method: "POST",
        body: JSON.stringify({ actionId: action.id }),
      });
      await refreshAll();
    });
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "danger";
    reject.textContent = "拒绝";
    reject.addEventListener("click", async () => {
      await api("/actions/reject", {
        method: "POST",
        body: JSON.stringify({ actionId: action.id, reason: "从中文控制台拒绝" }),
      });
      await refreshAll();
    });
    row.append(approve, reject);
    node.append(row);
    elements.actions.append(node);
  }
}

function renderReminders(data) {
  clear(elements.reminders);
  setText(elements.reminderCount, `${data.reminders.length} 个`);
  if (!data.reminders.length) {
    elements.reminders.append(empty("没有已安排提醒。"));
    return;
  }
  for (const reminder of data.reminders) {
    const node = item(reminder.title, reminder.message, `到期：${formatTime(reminder.dueAt)} · 状态：${reminder.status}`, "neutral-card");
    const row = document.createElement("div");
    row.className = "actions-row";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "danger";
    cancel.textContent = "取消提醒";
    cancel.addEventListener("click", async () => {
      await api("/reminders/cancel", {
        method: "POST",
        body: JSON.stringify({ reminderId: reminder.id }),
      });
      await refreshAll();
    });
    row.append(cancel);
    node.append(row);
    elements.reminders.append(node);
  }
}

function renderMemories(data) {
  clear(elements.memories);
  if (!data.memories.length) {
    elements.memories.append(empty("还没有长期记忆。"));
    return;
  }
  for (const memory of data.memories) {
    const tags = Array.isArray(memory.tags) && memory.tags.length ? memory.tags.join(" · ") : "无标签";
    elements.memories.append(
      item(
        `${memory.kind ?? "记忆"} · 重要度 ${memory.importance ?? "-"}`,
        memory.text,
        `${tags} · 来源：${memory.source ?? "未知"} · 更新时间：${formatTime(memory.updatedAt ?? memory.createdAt)}`,
      ),
    );
  }
}

function renderWorld(snapshot) {
  clear(elements.worldStatus);
  const entities = snapshot.entities ?? [];
  const relations = snapshot.relations ?? [];
  elements.worldStatus.append(
    item("世界模型概览", `${entities.length} 个实体，${relations.length} 条关系`, "用于让 JARVIS 理解项目、设备、服务与人之间的联系", "neutral-card"),
  );
  for (const entity of entities.slice(0, 8)) {
    const tags = Array.isArray(entity.tags) && entity.tags.length ? entity.tags.join(" · ") : "无标签";
    elements.worldStatus.append(item(`${entity.type} · ${entity.name}`, entity.summary || "暂无摘要", tags));
  }
}

function renderReflection(reflectionStatus, reflections = []) {
  clear(elements.reflectionStatus);
  elements.reflectionStatus.append(
    item(
      "反思循环",
      reflectionStatus.running ? "运行中" : "已停止",
      `tick=${reflectionStatus.tickCount ?? 0} · 最近：${formatTime(reflectionStatus.lastTickAt)}`,
      reflectionStatus.running ? "ok-card" : "danger-card",
    ),
  );
  for (const reflection of reflections.slice(0, 6)) {
    elements.reflectionStatus.append(
      item(`${reflection.kind ?? "经验"} · ${reflection.title}`, reflection.summary, `标签：${(reflection.tags ?? []).join(" · ") || "无"}`),
    );
  }
}

function renderTools(data) {
  clear(elements.toolCatalog);
  const groups = new Map();
  for (const tool of data.tools ?? []) {
    const prefix = tool.name.includes(".") ? tool.name.split(".")[0] : "其他";
    groups.set(prefix, [...(groups.get(prefix) ?? []), tool]);
  }
  for (const [group, tools] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const block = document.createElement("details");
    block.className = "tool-group";
    if (["enterprise", "memory", "model", "self"].includes(group)) {
      block.open = true;
    }
    const summary = document.createElement("summary");
    summary.textContent = `${group} · ${tools.length} 个工具`;
    block.append(summary);
    for (const tool of tools) {
      block.append(
        item(
          tool.name,
          tool.description,
          `${riskLabel(tool.riskLevel)} · ${tool.requiresConfirmation ? "调用前需要确认" : "可直接调用"} · ${tool.canRollback ? "支持回滚" : "不支持回滚"}`,
          tool.requiresConfirmation ? "watch-card" : "neutral-card",
        ),
      );
    }
    elements.toolCatalog.append(block);
  }
}

function renderRecentEvents(data) {
  const recent = data.events ?? [];
  for (const event of recent.reverse()) {
    const line = `${formatTime(event.timestamp)} · ${event.type} · ${event.source} · 重要度 ${event.importance}`;
    if (!state.events.includes(line)) {
      addEventLine(line);
    }
  }
}

async function refreshConversation() {
  const data = await api(`/conversation/messages?sessionId=${encodeURIComponent(state.sessionId)}&limit=32`);
  clear(elements.messages);
  if (!data.messages.length) {
    elements.messages.append(empty("还没有消息。可以先说“你好贾维斯”。"));
    return;
  }
  for (const message of data.messages) {
    if (message.role === "user" || message.role === "assistant") {
      elements.messages.append(messageNode(message.role, message.content));
      if (message.role === "assistant") {
        state.lastAssistantText = message.content;
      }
    }
  }
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

async function refreshAll() {
  setText(elements.connectionState, "刷新中");
  try {
    const [
      health,
      self,
      enterprise,
      tools,
      models,
      voice,
      voiceDevices,
      initiative,
      perception,
      reflection,
      briefing,
      notifications,
      actions,
      reminders,
      memories,
      world,
      reflections,
      events,
    ] = await Promise.all([
      api("/health"),
      api("/self/diagnose"),
      api("/enterprise/readiness"),
      api("/tools/list"),
      api("/models/status"),
      api("/voice/status"),
      api("/voice/devices"),
      api("/initiative/status"),
      api("/perception/status"),
      api("/reflection/status"),
      api("/briefing"),
      api("/notifications/unread?limit=10"),
      api("/actions/pending?limit=10"),
      api("/reminders?status=scheduled&limit=10"),
      api("/memory/recent?limit=10"),
      api("/world/snapshot"),
      api("/reflection/list?limit=8"),
      api("/events/recent?limit=30"),
    ]);

    setText(elements.connectionState, "已连接");
    setText(elements.selfStatus, self.summary);
    setText(elements.toolCount, String(tools.tools.length));
    setText(elements.memoryCount, String(self.metrics.memoryRecords));
    setText(elements.queueCount, String(self.metrics.pendingActions));

    renderReadiness(enterprise);
    renderComponents(health);
    renderModelStatus(models);
    renderVoiceStatus(voice, voiceDevices);
    renderLoops({ initiative, perception, reflection });
    renderBriefing(briefing);
    renderNotifications(notifications);
    renderActions(actions);
    renderReminders(reminders);
    renderMemories(memories);
    renderWorld(world);
    renderReflection(reflection, reflections.reflections ?? []);
    renderTools(tools);
    renderRecentEvents(events);
    await refreshConversation();
  } catch (err) {
    setText(elements.connectionState, "未连接");
    renderError(elements.briefing, "控制台无法连接 JARVIS-OS 网关", err);
    addEventLine(`连接失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

async function sendChatMessage(message, options = {}) {
  if (!message) {
    return;
  }
  elements.messages.append(messageNode("user", message));
  const pending = messageNode("assistant", "正在思考...");
  elements.messages.append(pending);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  try {
    const result = await api("/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId: state.sessionId, message }),
    });
    state.lastAssistantText = result.reply?.content ?? "";
    pending.textContent = displayText(state.lastAssistantText || "我收到了，但这次没有生成文本回复。");
    if (options.speakReply && state.lastAssistantText.trim()) {
      setRealtimeVoiceStatus("实时语音：JARVIS 正在朗读回复，麦克风暂时避让。", "speaking");
      try {
        await api("/voice/speak", {
          method: "POST",
          body: JSON.stringify({ text: state.lastAssistantText }),
        });
      } catch (err) {
        addEventLine(`实时语音朗读失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    pending.textContent = err instanceof Error ? err.message : String(err);
  }
  await refreshAll();
}

elements.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = elements.messageInput.value.trim();
  if (!message) {
    return;
  }
  elements.messageInput.value = "";
  await sendChatMessage(message);
});

elements.refreshButton.addEventListener("click", () => {
  void refreshAll();
});

elements.briefingButton.addEventListener("click", async () => {
  try {
    renderBriefing(await api("/briefing"));
  } catch (err) {
    renderError(elements.briefing, "生成简报失败", err);
  }
});

elements.wakeButton.addEventListener("click", async () => {
  elements.wakeButton.disabled = true;
  elements.wakeButton.textContent = "正在唤醒...";
  try {
    const result = await api("/initiative/tick", { method: "POST" });
    const score = result.decision?.score;
    addEventLine(
      `${new Date().toLocaleTimeString("zh-CN")} · 手动唤醒主动层${typeof score === "number" ? ` · 评分 ${score.toFixed(3)}` : ""}`,
    );
    await refreshAll();
  } catch (err) {
    addEventLine(`主动唤醒失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    elements.wakeButton.disabled = false;
    elements.wakeButton.textContent = "主动唤醒";
  }
});

elements.speakButton.addEventListener("click", async () => {
  const text = latestAssistantText();
  if (!text || text === "正在思考...") {
    addEventLine("语音朗读跳过：没有可朗读的助手回复。");
    return;
  }
  elements.speakButton.disabled = true;
  elements.speakButton.textContent = "正在朗读...";
  try {
    await api("/voice/speak", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    addEventLine(`${new Date().toLocaleTimeString("zh-CN")} · 已朗读上一条助手回复`);
  } catch (err) {
    addEventLine(`语音朗读失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    elements.speakButton.disabled = false;
    elements.speakButton.textContent = "朗读上一条回复";
  }
});

function browserDictationFallback() {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Recognition) {
    addEventLine("当前浏览器不支持备用语音输入。");
    return;
  }
  const recognition = new Recognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  elements.dictateButton.disabled = true;
  elements.dictateButton.textContent = "浏览器听写中...";
  recognition.addEventListener("result", (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript;
    if (transcript) {
      elements.messageInput.value = transcript;
      elements.messageInput.focus();
      addEventLine(`${new Date().toLocaleTimeString("zh-CN")} · 浏览器语音已识别`);
    }
  });
  recognition.addEventListener("error", (event) => {
    addEventLine(`浏览器语音失败：${event.error}`);
  });
  recognition.addEventListener("end", () => {
    elements.dictateButton.disabled = false;
    elements.dictateButton.textContent = "语音输入";
  });
  recognition.start();
}

function supportedAudioMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  return candidates.find((candidate) => window.MediaRecorder?.isTypeSupported(candidate)) ?? "";
}

function stopTracks(stream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

async function transcribeAudioBlob(blob) {
  return await api("/voice/transcribe?language=zh-CN", {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
    },
    body: blob,
  });
}

async function transcribeWithLocalModel() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    addEventLine("浏览器不支持录音上传，切换备用语音识别。");
    browserDictationFallback();
    return;
  }

  elements.dictateButton.disabled = true;
  elements.dictateButton.textContent = "请求麦克风...";
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const mimeType = supportedAudioMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    const stopped = new Promise((resolve, reject) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      });
      recorder.addEventListener("error", () => reject(new Error("浏览器录音失败。")));
      recorder.addEventListener("stop", resolve, { once: true });
    });

    recorder.start(250);
    elements.dictateButton.textContent = "本地模型识别中...";
    addEventLine(`${new Date().toLocaleTimeString("zh-CN")} · 已开始录音，4.5 秒后自动识别`);
    await new Promise((resolve) => setTimeout(resolve, MODEL_DICTATION_RECORD_MS));
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    await stopped;

    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "application/octet-stream" });
    if (!blob.size) {
      addEventLine("没有采集到音频，切换备用语音识别。");
      browserDictationFallback();
      return;
    }
    const result = await transcribeAudioBlob(blob);
    const transcript = result.transcript?.trim();
    if (transcript) {
      elements.messageInput.value = transcript;
      elements.messageInput.focus();
      addEventLine(
        `${new Date().toLocaleTimeString("zh-CN")} · 本地 ASR 已识别：${result.model ?? result.provider}`,
      );
      return;
    }
    addEventLine("本地 ASR 没有识别到文字，切换备用语音识别。");
    browserDictationFallback();
  } catch (err) {
    addEventLine(`本地 ASR 不可用：${err instanceof Error ? err.message : String(err)}`);
    browserDictationFallback();
  } finally {
    if (stream) {
      stopTracks(stream);
    }
    if (elements.dictateButton.textContent !== "浏览器听写中...") {
      elements.dictateButton.disabled = false;
      elements.dictateButton.textContent = "语音输入";
    }
  }
}

elements.dictateButton.addEventListener("click", () => {
  void transcribeWithLocalModel();
});

function realtimeRms(analyser) {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const value of data) {
    const centered = (value - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / data.length);
}

function updateRealtimeThreshold(rms) {
  const voice = state.realtimeVoice;
  if (performance.now() - voice.startedAt > REALTIME_CALIBRATION_MS) {
    return;
  }
  voice.noiseSamples.push(rms);
  const average = voice.noiseSamples.reduce((sum, sample) => sum + sample, 0) / voice.noiseSamples.length;
  voice.threshold = Math.max(0.016, Math.min(0.12, average * 3.2 + 0.008));
}

function startRealtimeUtterance() {
  const voice = state.realtimeVoice;
  if (!voice.active || voice.busy || voice.recorder) {
    return;
  }
  const mimeType = supportedAudioMimeType();
  const recorder = new MediaRecorder(voice.stream, mimeType ? { mimeType } : undefined);
  recorder.startedAt = performance.now();
  voice.chunks = [];
  voice.recorder = recorder;
  voice.lastVoiceAt = performance.now();
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      voice.chunks.push(event.data);
    }
  });
  recorder.addEventListener("stop", () => {
    void handleRealtimeUtteranceStopped(recorder.mimeType || mimeType || "application/octet-stream");
  }, { once: true });
  recorder.start(180);
  setRealtimeVoiceStatus("实时语音：正在听你说话...", "listening");
}

function stopRealtimeUtterance() {
  const recorder = state.realtimeVoice.recorder;
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }
}

async function handleRealtimeUtteranceStopped(mimeType) {
  const voice = state.realtimeVoice;
  const chunks = voice.chunks;
  voice.recorder = undefined;
  voice.chunks = [];
  if (!voice.active || voice.busy || !chunks.length) {
    return;
  }
  voice.busy = true;
  try {
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size < 1200) {
      setRealtimeVoiceStatus("实时语音：音频太短，继续监听。", "idle");
      return;
    }
    setRealtimeVoiceStatus("实时语音：正在转写你的声音...", "thinking");
    const result = await transcribeAudioBlob(blob);
    const transcript = result.transcript?.trim();
    if (!transcript) {
      setRealtimeVoiceStatus("实时语音：没有识别到有效文字，继续监听。", "idle");
      return;
    }
    voice.turnCount += 1;
    setRealtimeVoiceStatus(`实时语音：已识别「${transcript}」，正在思考回复。`, "thinking");
    addEventLine(
      `${new Date().toLocaleTimeString("zh-CN")} · 实时语音识别：${transcript} · ${result.device ?? result.provider ?? "ASR"}`,
    );
    await sendChatMessage(transcript, { speakReply: true });
    setRealtimeVoiceStatus(`实时语音：继续监听中 · 已完成 ${voice.turnCount} 轮。`, "active");
  } catch (err) {
    addEventLine(`实时语音处理失败：${err instanceof Error ? err.message : String(err)}`);
    setRealtimeVoiceStatus("实时语音：处理失败，已继续监听。", "idle");
  } finally {
    voice.busy = false;
  }
}

function realtimeVadLoop() {
  const voice = state.realtimeVoice;
  if (!voice.active || !voice.analyser) {
    return;
  }
  const now = performance.now();
  const rms = realtimeRms(voice.analyser);
  updateRealtimeThreshold(rms);
  const isVoice = rms >= voice.threshold;

  if (!voice.busy && !voice.recorder && isVoice && now - voice.startedAt > REALTIME_CALIBRATION_MS) {
    startRealtimeUtterance();
  }
  if (voice.recorder) {
    if (isVoice || rms >= voice.threshold * 0.72) {
      voice.lastVoiceAt = now;
    }
    const recordedMs = now - voice.lastVoiceAt;
    const utteranceMs = now - voice.recorder.startedAt;
    if (
      (recordedMs >= REALTIME_END_SILENCE_MS && utteranceMs >= REALTIME_MIN_RECORD_MS) ||
      utteranceMs >= REALTIME_MAX_RECORD_MS
    ) {
      stopRealtimeUtterance();
    }
  }
  voice.rafId = requestAnimationFrame(realtimeVadLoop);
}

async function startRealtimeVoice() {
  if (state.realtimeVoice.active) {
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setRealtimeVoiceStatus("实时语音：当前浏览器不支持麦克风录音。", "error");
    return;
  }
  if (!(window.AudioContext ?? window.webkitAudioContext)) {
    setRealtimeVoiceStatus("实时语音：当前浏览器不支持实时音量检测。", "error");
    return;
  }
  elements.realtimeVoiceButton.disabled = true;
  elements.realtimeVoiceButton.textContent = "正在开启...";
  setRealtimeVoiceStatus("实时语音：正在请求麦克风权限并校准环境噪声。", "thinking");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    const audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.16;
    source.connect(analyser);

    state.realtimeVoice = {
      active: true,
      busy: false,
      stream,
      audioContext,
      analyser,
      source,
      rafId: undefined,
      recorder: undefined,
      chunks: [],
      startedAt: performance.now(),
      lastVoiceAt: 0,
      noiseSamples: [],
      threshold: 0.018,
      turnCount: 0,
    };
    elements.realtimeVoiceButton.textContent = "关闭实时语音对话";
    elements.realtimeVoiceButton.classList.add("live");
    elements.dictateButton.disabled = true;
    setRealtimeVoiceStatus("实时语音：校准中，请稍等一秒后直接说话。", "active");
    addEventLine(`${new Date().toLocaleTimeString("zh-CN")} · 实时语音对话已开启`);
    realtimeVadLoop();
  } catch (err) {
    setRealtimeVoiceStatus(`实时语音：开启失败：${err instanceof Error ? err.message : String(err)}`, "error");
  } finally {
    elements.realtimeVoiceButton.disabled = false;
  }
}

async function stopRealtimeVoice() {
  const voice = state.realtimeVoice;
  voice.active = false;
  if (voice.rafId) {
    cancelAnimationFrame(voice.rafId);
  }
  if (voice.recorder && voice.recorder.state !== "inactive") {
    voice.recorder.stop();
  }
  if (voice.stream) {
    stopTracks(voice.stream);
  }
  if (voice.audioContext) {
    await voice.audioContext.close().catch(() => undefined);
  }
  state.realtimeVoice = {
    active: false,
    busy: false,
    stream: undefined,
    audioContext: undefined,
    analyser: undefined,
    source: undefined,
    rafId: undefined,
    recorder: undefined,
    chunks: [],
    startedAt: 0,
    lastVoiceAt: 0,
    noiseSamples: [],
    threshold: 0.018,
    turnCount: voice.turnCount,
  };
  elements.realtimeVoiceButton.textContent = "开启实时语音对话";
  elements.realtimeVoiceButton.classList.remove("live");
  elements.dictateButton.disabled = false;
  setRealtimeVoiceStatus("实时语音：已关闭。", "idle");
  addEventLine(`${new Date().toLocaleTimeString("zh-CN")} · 实时语音对话已关闭`);
}

elements.realtimeVoiceButton.addEventListener("click", () => {
  if (state.realtimeVoice.active) {
    void stopRealtimeVoice();
    return;
  }
  void startRealtimeVoice();
});

elements.reminderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = elements.reminderTitle.value.trim() || "提醒";
  const minutes = Math.max(1, Number(elements.reminderMinutes.value || 5));
  const message = elements.reminderMessage.value.trim() || title;
  await api("/reminders/create", {
    method: "POST",
    body: JSON.stringify({
      title,
      message,
      dueAt: Date.now() + minutes * 60_000,
    }),
  });
  elements.reminderTitle.value = "";
  elements.reminderMessage.value = "";
  await refreshAll();
});

function connectEvents() {
  if (state.eventSocket) {
    state.eventSocket.close();
  }
  const socket = new WebSocket(`ws://${location.host}/events`);
  state.eventSocket = socket;
  socket.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      const payload = data.event ?? data;
      addEventLine(`${new Date().toLocaleTimeString("zh-CN")} · ${payload.type ?? data.type} · ${payload.source ?? "gateway"}`);
      if (
        payload.type === "notification.created" ||
        payload.type === "action.confirmation_required" ||
        payload.type === "reminder.due" ||
        payload.type === "chat.assistant_message"
      ) {
        void refreshAll();
      }
    } catch {
      addEventLine(event.data);
    }
  });
  socket.addEventListener("open", () => {
    setText(elements.connectionState, "已连接");
    addEventLine("事件流已连接。");
  });
  socket.addEventListener("close", () => {
    setText(elements.connectionState, "事件流断开");
    addEventLine("事件流已断开，正在重连...");
    setTimeout(connectEvents, 1600);
  });
}

void refreshAll();
connectEvents();
