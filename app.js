const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const LOCAL_API = "http://127.0.0.1:4310";
let API_BASE = "";
const U = (path) => (API_BASE ? API_BASE + path : path);

const LAYOUT_MODES = { none: "纯文案", image: "动画+头像", video: "动画+数字人" };
const AVATAR_SHAPES = ["rounded", "circle", "ellipse", "square", "diamond", "hexagon"];
const AVATAR_CLIP = {
  diamond: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  hexagon: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
};
const DEFAULT_DIGITAL_HUMAN = {
  enabled: false,
  reference: "",
  variant: "closeup",
  maxSide: 1440,
  timeoutMin: 120,
  cropPct: "",
};

const DEFAULT_LAYOUT = {
  mode: "none",
  avatar: {
    src: "",
    width: 0.34,
    x: 0.5,
    y: 0.76,
    aspect: 0.75,
    shape: "rounded",
    fit: "contain",
    frame: true,
    motion: "float",
    borderWidth: 4,
    borderColor: "#e8a33d",
  },
  avoid: true,
  gap: 24,
};

const clampNumber = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

function shapeAspect(shape, naturalAspect = 0.75) {
  if (shape === "ellipse") return 1 / 1.22;
  if (shape === "hexagon") return 1 / 0.92;
  if (shape === "rounded") return clampNumber(naturalAspect, 0.2, 3, 0.75);
  return 1;
}

function normalizeDigitalHuman(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    ...DEFAULT_DIGITAL_HUMAN,
    ...value,
    enabled: value.enabled === true,
    reference: typeof value.reference === "string" ? value.reference.slice(0, 400) : "",
    variant: ["closeup", "fullbody", "auto"].includes(value.variant) ? value.variant : "closeup",
    maxSide: Math.round(clampNumber(value.maxSide, 480, 2160, 1440)),
    timeoutMin: Math.round(clampNumber(value.timeoutMin, 10, 360, 120)),
    cropPct: /^\d{1,3}:\d{1,3}:\d{1,3}:\d{1,3}$/.test(String(value.cropPct || "")) ? String(value.cropPct) : "",
  };
}

function normalizeLayout(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const a = src.avatar && typeof src.avatar === "object" ? src.avatar : {};
  const mode = LAYOUT_MODES[src.mode] ? src.mode : "none";
  return {
    mode,
    avatar: {
      src: typeof a.src === "string" ? a.src : "",
      width: clampNumber(a.width, 0.1, 1, 0.34),
      x: clampNumber(a.x, 0, 1, 0.5),
      y: clampNumber(a.y, 0, 1, 0.76),
      aspect: clampNumber(a.aspect, 0.2, 3, 0.75),
      shape: AVATAR_SHAPES.includes(a.shape) ? a.shape : "rounded",
      fit: a.fit === "cover" ? "cover" : "contain",
      frame: a.frame !== false,
      motion: ["none", "float", "breathe"].includes(a.motion) ? a.motion : "float",
      borderWidth: Math.round(clampNumber(a.borderWidth, 0, 32, 4)),
      borderColor: /^#[0-9a-fA-F]{6}$/.test(a.borderColor) ? a.borderColor : "#e8a33d",
    },
    avoid: src.avoid !== false,
    gap: clampNumber(src.gap, 0, 160, 24),
  };
}

/** 与 Remotion useSafeBox 保持一致的安全区计算（预览用） */
function computeSafeBox(layout, canvasW, canvasH) {
  const avatar = layout.avatar;
  const hasAvatar = layout.mode !== "none" && Boolean(avatar.src);
  const width = Math.max(0, Math.min(canvasW, avatar.width * canvasW));
  const height = width / shapeAspect(avatar.shape, avatar.aspect);
  const cx = Math.min(canvasW, Math.max(0, avatar.x * canvasW));
  const cy = Math.min(canvasH, Math.max(0, avatar.y * canvasH));
  const rect = { left: cx - width / 2, top: cy - height / 2, width, height };
  const box = { left: 66, right: 66, top: 0, bottom: 380 };
  if (hasAvatar && layout.avoid !== false) {
    const gap = layout.gap || 0;
    const offCenter = cx <= canvasW * 0.46 || cx >= canvasW * 0.54;
    const overlapsTextBand = rect.top < canvasH * 0.62 && rect.top + height > canvasH * 0.18;
    const sideBySide = width < canvasW * 0.56 && offCenter && overlapsTextBand;
    if (sideBySide) {
      if (cx <= canvasW * 0.46) box.left = Math.max(box.left, rect.left + width + gap);
      else box.right = Math.max(box.right, canvasW - rect.left + gap);
    } else {
      if (cy <= canvasH * 0.5) box.top = Math.max(box.top, rect.top + height + gap);
      else box.bottom = Math.max(box.bottom, canvasH - rect.top + gap);
    }
    const maxInset = canvasW * 0.42;
    box.left = Math.min(box.left, maxInset);
    box.right = Math.min(box.right, maxInset);
  }
  return { ...box, rect };
}

const avatarUrl = (src) => {
  if (!src) return "";
  if (/^https?:/i.test(src)) return src;
  if (src.startsWith("/")) return U(src);
  return U(`/${src.replace(/^\.?\//, "")}`);
};

const STAGES = [
  { id: 1, name: "生成分镜", sub: "解析文案结构" },
  { id: 2, name: "合成配音", sub: "逐句语音合成" },
  { id: 3, name: "生成数字人", sub: "Kaggle 对口型" },
  { id: 4, name: "时间轴与字幕", sub: "对齐与字幕" },
  { id: 5, name: "渲染画面", sub: "Remotion 合成" },
  { id: 6, name: "合成成片", sub: "封装 H.264" },
];

const STAGE_NAMES = Object.fromEntries(STAGES.map((s) => [s.id, s.name]));

const PROVIDERS = {
  kaggle: {
    label: "Kaggle 云 GPU",
    short: "Kaggle",
    badge: "",
    badgeText: "云",
    desc: "IndexTTS-2.5 跑在 Kaggle T4 上，需要排队和凭据。",
    note: "适合正式批量合成。任务会提交到 Kaggle Notebook 执行，等待时间取决于排队情况，超时和网络波动会影响成功率。",
    envKey: "kaggle",
    fields: (c) => [
      { t: "text", k: "modelRepo", label: "模型仓库", v: c.modelRepo || "IndexTeam/IndexTTS-2.5" },
      {
        t: "select",
        k: "accelerator",
        label: "加速器",
        v: c.accelerator || "NvidiaTeslaT4",
        options: [
          ["NvidiaTeslaT4", "Nvidia Tesla T4"],
          ["NvidiaTeslaP100", "Nvidia Tesla P100"],
          ["NvidiaTeslaV100", "Nvidia Tesla V100"],
        ],
      },
      { t: "range", k: "speakRate", label: "语速", v: c.speakRate ?? 1, min: 0.85, max: 1.15, step: 0.01, fmt: (v) => v.toFixed(2) + "×" },
      { t: "range", k: "durationFactor", label: "时长系数", v: c.durationFactor ?? 1, min: 0.9, max: 1.1, step: 0.01, fmt: (v) => v.toFixed(2) },
    ],
  },
  cosyvoice: {
    label: "CosyVoice2",
    short: "CosyVoice",
    badge: "local",
    badgeText: "本机",
    desc: "本机 4GB 显存可跑，音色克隆自然，无需排队。",
    note: "当前默认方案。cross_lingual 模式只用参考音频、不依赖参考文本；fp16 把显存压到 3.4GB 左右。合成约 15–30 秒一句。",
    envKey: "cosyvoice",
    fields: (c) => [
      {
        t: "select",
        k: "mode",
        label: "克隆模式",
        v: c.mode || "cross_lingual",
        options: [
          ["cross_lingual", "cross_lingual（仅参考音频）"],
          ["zero_shot", "zero_shot（参考音频 + 文本）"],
          ["sft", "sft（内置音色）"],
        ],
      },
      { t: "text", k: "speaker", label: "内置音色（sft 用）", v: c.speaker || "中文女", ph: "中文女" },
      { t: "range", k: "speed", label: "语速", v: c.speed ?? 1, min: 0.85, max: 1.15, step: 0.01, fmt: (v) => v.toFixed(2) + "×" },
      { t: "check", k: "fp16", label: "半精度（fp16）", desc: "显存占用约减半，质量基本无损", v: c.fp16 !== false },
      { t: "check", k: "textFrontend", label: "文本正则化", desc: "开启后对数字、符号做前端归一化", v: Boolean(c.textFrontend) },
    ],
  },
  voicestudio: {
    label: "VoiceStudio 本机",
    short: "VoiceStudio",
    badge: "local",
    badgeText: "本机",
    desc: "后台按需启动的 CosyVoice3 服务，逐段稳速，不用另开它的界面。",
    note: "任务开始时会自动在后台拉起本机 VoiceStudio 服务（无窗口），任务结束后自动关闭；如果服务本来就在运行则直接复用、不关别人的进程。默认整篇一次合成：按句切块、接缝 50ms 交叉淡化，翻页处按设定留出停顿；首次使用会自动用所选参考音频建立音色档案，同一段音频只建一次。",
    envKey: "voicestudio",
    fields: (c) => {
      const single = c.singlePass !== false;
      const fields = [
        { t: "text", k: "apiBase", label: "服务地址", v: c.apiBase || "http://127.0.0.1:3900", ph: "http://127.0.0.1:3900" },
        {
          t: "select",
          k: "model",
          label: "引擎",
          v: c.model || "cosyvoice",
          options: [
            ["cosyvoice", "CosyVoice 3"],
            ["omnivoice", "OmniVoice"],
          ],
        },
        { t: "text", k: "profileId", label: "音色档案 ID（留空自动创建）", v: c.profileId || "", ph: "留空则按参考音频自动创建" },
        { t: "range", k: "speed", label: "基准语速", v: c.speed ?? 1, min: 0.85, max: 1.35, step: 0.01, fmt: (v) => v.toFixed(2) + "×" },
        { t: "check", k: "singlePass", label: "整篇一次合成", desc: "按句切块后连贯成一条，接缝处做交叉淡化，翻页停顿单独控制（推荐）", v: single },
      ];
      if (single) {
        fields.push(
          { t: "range", k: "chunkChars", label: "切块字数", v: c.chunkChars ?? 150, min: 80, max: 200, step: 10, fmt: (v) => Math.round(v) + " 字" },
          { t: "range", k: "pagePauseSeconds", label: "翻页停顿", v: c.pagePauseSeconds ?? 0.45, min: 0, max: 1.2, step: 0.05, fmt: (v) => v.toFixed(2) + " 秒" },
        );
      } else {
        fields.push(
          { t: "check", k: "steady", label: "稳速", desc: "按目标语速逐段微调，整片速度更一致", v: c.steady !== false },
          { t: "range", k: "targetCps", label: "目标语速", v: c.targetCps ?? 4.2, min: 3.6, max: 5, step: 0.05, fmt: (v) => v.toFixed(2) + " 字/秒" },
          { t: "range", k: "maxChars", label: "每段最大字数", v: c.maxChars ?? 22, min: 12, max: 32, step: 1, fmt: (v) => Math.round(v) + " 字" },
        );
      }
      fields.push(
        {
          t: "select",
          k: "effectPreset",
          label: "效果链",
          v: c.effectPreset || "broadcast",
          options: [
            ["broadcast", "播报 · 均衡清晰"],
            ["podcast", "播客 · 近场压缩"],
            ["cinematic", "电影感 · 空间混响"],
            ["warm", "温润 · 低频暖"],
            ["bright", "明亮 · 高频通透"],
            ["raw", "不做处理"],
          ],
        },
        { t: "range", k: "masterGainDb", label: "母带增益", v: c.masterGainDb ?? 2.5, min: -6, max: 6, step: 0.5, fmt: (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB" },
        { t: "text", k: "seed", label: "固定种子", v: String(c.seed ?? 2026), ph: "2026" },
        {
          t: "select",
          k: "instructPreset",
          label: "风格预设",
          v: c.instructPreset || "",
          options: [
            ["", "不额外指定"],
            ["用平稳、均匀的语速朗读，语气平实自然，减少停顿。", "平稳播报 · 均匀少停顿"],
            ["你是一位新闻主播，用清晰、克制、匀速的语气播报。", "新闻播报 · 清晰克制"],
            ["用理性、沉稳的语气讲解，节奏均匀，不要夸张。", "财经解说 · 沉稳匀速"],
            ["像和朋友聊天一样自然地说，语气放松，不要念稿感。", "轻松口语 · 自然放松"],
            ["用稍快但清晰的语速朗读，保持字字清楚。", "稍快 · 清晰"],
            ["放慢语速，每个字都读清楚，句子之间稍作停顿。", "稍慢 · 字字清楚"],
          ],
        },
        { t: "text", k: "instruct", label: "自定义指令（优先于预设）", v: c.instruct || "", ph: "留空则使用上面的预设" },
      );
      return fields;
    },
  },
  local3: {
    label: "CosyVoice3 直连",
    short: "CosyVoice3",
    badge: "local",
    badgeText: "本机",
    desc: "直接在本机调用 CosyVoice3 权重，不开任何后台服务，音色与 VoiceStudio 一致。",
    note: "任务里直接加载 Fun-CosyVoice3-0.5B 权重，不启动 VoiceStudio 服务、不占 3900 端口；首次加载约 1–2 分钟，之后整片共用同一份模型。逐段稳速与收尾处理与 VoiceStudio 链路一致（高切 + 温和压缩 + 峰值归一到 -2 dBFS）。",
    envKey: "",
    fields: (c) => [
      { t: "text", k: "modelDir", label: "模型目录", v: c.modelDir || "", ph: "留空则使用私有配置里的模型目录" },
      { t: "range", k: "speed", label: "基准语速", v: c.speed ?? 1, min: 0.85, max: 1.35, step: 0.01, fmt: (v) => v.toFixed(2) + "×" },
      { t: "check", k: "steady", label: "稳速", desc: "按目标语速逐段微调，整片速度更一致", v: c.steady !== false },
      { t: "range", k: "targetCps", label: "目标语速", v: c.targetCps ?? 4.2, min: 3.6, max: 5, step: 0.05, fmt: (v) => v.toFixed(2) + " 字/秒" },
      { t: "range", k: "maxChars", label: "每段最大字数", v: c.maxChars ?? 22, min: 12, max: 32, step: 1, fmt: (v) => Math.round(v) + " 字" },
      { t: "text", k: "seed", label: "固定种子", v: String(c.seed ?? 2026), ph: "2026" },
      {
        t: "select",
        k: "instructPreset",
        label: "风格预设",
        v: c.instructPreset || "",
        options: [
          ["", "不额外指定"],
          ["用平稳、均匀的语速朗读，语气平实自然，减少停顿。", "平稳播报 · 均匀少停顿"],
          ["你是一位新闻主播，用清晰、克制、匀速的语气播报。", "新闻播报 · 清晰克制"],
          ["用理性、沉稳的语气讲解，节奏均匀，不要夸张。", "财经解说 · 沉稳匀速"],
          ["像和朋友聊天一样自然地说，语气放松，不要念稿感。", "轻松口语 · 自然放松"],
          ["用稍快但清晰的语速朗读，保持字字清楚。", "稍快 · 清晰"],
          ["放慢语速，每个字都读清楚，句子之间稍作停顿。", "稍慢 · 字字清楚"],
        ],
      },
      { t: "text", k: "instruct", label: "自定义指令（优先于预设）", v: c.instruct || "", ph: "留空则使用上面的预设" },
    ],
  },
  indextts: {
    label: "IndexTTS 本地",
    short: "IndexTTS",
    badge: "alt",
    badgeText: "本地",
    desc: "本机部署的 IndexTTS，独立环境，适合离线。",
    note: "使用私有配置里指定的 IndexTTS 部署与独立虚拟环境。适合已有完整权重、希望完全离线的场景。",
    envKey: "indextts",
    fields: (c) => [
      {
        t: "select",
        k: "lang",
        label: "语言",
        v: c.lang || "ZH",
        options: [
          ["ZH", "中文"],
          ["EN", "英文"],
        ],
      },
      { t: "check", k: "fp32", label: "fp32 精度", desc: "更稳但更慢，显存紧张时保持关闭", v: Boolean(c.fp32) },
      { t: "check", k: "useQwenEmo", label: "Qwen 情感控制", desc: "启用情感向量，速度会变慢", v: Boolean(c.useQwenEmo) },
    ],
  },
  edge: {
    label: "Edge 朗读",
    short: "Edge",
    badge: "alt",
    badgeText: "内置",
    desc: "系统在线音色，最快出片，但不像你的声音。",
    note: "微软 Edge 在线语音，零配置、速度快。适合先看整体节奏和画面，不适合最终交付的真人感口播。",
    envKey: "",
    fields: (c) => [
      { t: "text", k: "voice", label: "音色", v: c.voice || "zh-CN-XiaoxiaoNeural" },
      { t: "text", k: "rate", label: "语速", v: c.rate || "+0%", ph: "+0%" },
    ],
  },
};

const STYLES = {
  amber: {
    name: "暗金纪事",
    code: "AMBER",
    kicker: "CASE REVIEW",
    title: "终端运维自动化<br />到底能省多少成本",
    bg: "#0E1116",
    ink: "#F5F1EA",
    dim: "rgba(245, 241, 234, 0.62)",
    accent: "#E8A33D",
    font: "'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif",
  },
  tech: {
    name: "深蓝仪表",
    code: "TECH",
    kicker: "SYSTEM METRICS",
    title: "把重复请求<br />交给自动化跑",
    bg: "#06121B",
    ink: "#E9F7FF",
    dim: "rgba(233, 247, 255, 0.64)",
    accent: "#38D6E6",
    font: "'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif",
  },
  paper: {
    name: "纸本报告",
    code: "PAPER",
    kicker: "FIELD NOTES",
    title: "一份关于效率的<br />现场观察记录",
    bg: "#F2EDE3",
    ink: "#1C1916",
    dim: "rgba(28, 25, 22, 0.66)",
    accent: "#B8452F",
    font: "'Source Han Serif SC', 'Songti SC', 'STSong', 'SimSun', serif",
  },
  mono: {
    name: "黑白极简",
    code: "MONO",
    kicker: "PLAIN TEXT",
    title: "只留下事实<br />和一组数字",
    bg: "#050505",
    ink: "#FFFFFF",
    dim: "rgba(255, 255, 255, 0.64)",
    accent: "#FFFFFF",
    font: "'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif",
  },
};

const MOTION_NOTES = {
  light: "只保留淡入与轻微上移，克制、干净。",
  standard: "位移与弹性适中，适合大多数口播。",
  strong: "更长的位移、更明显的弹性，适合节奏快的短片。",
};

const STATUS_TEXT = {
  running: "运行中",
  queued: "排队中",
  done: "已完成",
  error: "失败",
  canceled: "已取消",
};

const DEFAULT_SCRIPT = [
  "今天用一组真实数据，复盘终端运维自动化到底能省下多少成本。",
  "一家600台电脑的办公网络，IT团队平均每天要处理300次重复请求。",
  "其中软件安装和补丁更新，占掉了60%以上的日常工作量。",
  "引入统一部署和自动化之后，全网软件分发成功率从82%升到99.5%。",
  "补丁和版本更新导致的蓝屏故障率，下降了70%。",
  "按工时折算，团队每周节省40个小时，相当于多出半个人力。",
  "自动化的核心不是裁人，而是把工程师从重复劳动里解放出来，去做更有价值的架构优化。",
  "这组数据说明，终端运维自动化的投入，通常能在半年内回本。",
].join("\n");

const state = {
  online: false,
  config: {
    provider: "cosyvoice",
    kaggle: {},
    cosyvoice: {},
    voicestudio: {},
    local3: {},
    indextts: {},
    edge: {},
    ui: {
      styleId: "amber",
      motion: "standard",
      layout: { ...DEFAULT_LAYOUT, avatar: { ...DEFAULT_LAYOUT.avatar } },
      digitalHuman: { ...DEFAULT_DIGITAL_HUMAN },
      gap: 0.26,
      leadIn: 0.25,
      tighten: true,
    },
    ai: { enabled: false, baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyEnv: "OPENAI_API_KEY", apiKey: "", temperature: 0.4 },
  },
  script: DEFAULT_SCRIPT,
  series: { title: "", tagline: "" },
  voices: [],
  avatars: [],
  materials: { items: [], chapters: [], hash: "" },
  layoutPresets: [],
  avatarBusy: false,
  materialBusy: false,
  prep: { state: "idle", stage: "", logs: [] },
  runPlan: null,
  savedScript: "",
  autoPrep: (() => {
    try {
      return localStorage.getItem("od-auto-prep") !== "off";
    } catch {
      return true;
    }
  })(),
  motion: { config: { recipes: {}, assignments: {} }, scenes: [], presets: [] },
  motionCandidates: [],
  motionCandidateMode: null,
  motionCandidateScene: null,
  motionBusy: false,
  motionScope: "scene",
  motionSceneIndex: 0,
  layoutSceneId: "",
  previewSceneId: (() => {
    try {
      return localStorage.getItem("od-preview-scene") || "";
    } catch {
      return "";
    }
  })(),
  previewDraft: null,
  env: [],
  job: null,
  render: null,
  logs: [],
  logsRunId: null,
  runActive: false,
  follow: true,
  dirty: false,
  logFilter: "all",
  logSearch: "",
  logSource: "entries",
  trim: null,
  vs: { ok: false, text: "未启动" },
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function api(path, opts = {}) {
  const init = { ...opts };
  if (init.body && typeof init.body === "string") {
    init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  }
  return fetch(U(path), init).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
    return data;
  });
}

function toast(message, kind = "") {
  const box = document.createElement("div");
  box.className = "toast" + (kind ? ` ${kind}` : "");
  box.textContent = message;
  $("#toasts").appendChild(box);
  setTimeout(() => box.remove(), 3600);
}

function setDirty(dirty) {
  state.dirty = dirty;
  const el = $("#saveState");
  el.textContent = dirty ? "未保存" : "已保存";
  el.classList.toggle("dirty", dirty);
}

function fmtDur(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "—";
  const s = Number(seconds);
  if (s >= 60) {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  }
  return `${s.toFixed(1)}s`;
}

function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fmtClock(ts) {
  if (!ts) return "--:--:--";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function basename(file) {
  return String(file || "").split(/[\\/]/).pop();
}

function providerLabel(id) {
  return PROVIDERS[id]?.label || id || "—";
}

function styleName(id) {
  return STYLES[id]?.name || id || "—";
}

function currentUi() {
  return state.config.ui;
}

function uiLayout() {
  if (!state.config.ui.layout || typeof state.config.ui.layout !== "object") {
    state.config.ui.layout = normalizeLayout(state.config.ui.layout);
  }
  return state.config.ui.layout;
}

function uiDigitalHuman() {
  state.config.ui.digitalHuman = normalizeDigitalHuman(state.config.ui.digitalHuman);
  return state.config.ui.digitalHuman;
}

function markDirty() {
  setDirty(true);
}

function switchTab(name) {
  const previous = document.querySelector(".panel.active")?.id?.replace(/^panel-/, "");
  $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${name}`));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.tab === name));
  if (name === "history") loadHistory();
  if (name === "run") renderRunMeta();
  if (name === "style") window.requestAnimationFrame(fitMaterialPreview);
  if (previous === "script" && name !== "script" && state.dirty && state.online && !state.runActive) {
    saveAll(true);
  }
}

function renderEnv() {
  const box = $("#envPills");
  if (!state.env.length) {
    box.innerHTML = `<span class="pill bad"><i></i>服务未连接</span>`;
    return;
  }
  box.innerHTML = state.env
    .map((item) => `<span class="pill ${item.ok ? "ok" : "bad"}" title="${esc(item.label)}"><i></i>${esc(item.label)} <b>${esc(item.text)}</b></span>`)
    .join("");
}

function providerVoiceFile(provider) {
  const c = state.config;
  if (provider === "cosyvoice") return basename(c.cosyvoice?.refWav);
  if (provider === "voicestudio") return basename(c.voicestudio?.refWav);
  if (provider === "local3") return basename(c.local3?.refWav);
  if (provider === "indextts") return basename(c.indextts?.promptWav);
  if (provider === "kaggle") return basename(c.kaggle?.promptWav);
  return "";
}

function renderProviders() {
  const provider = state.config.provider;
  const envMap = Object.fromEntries(state.env.map((item) => [item.key, item]));
  const grid = $("#providerGrid");
  grid.innerHTML = Object.entries(PROVIDERS)
    .map(([key, p]) => {
      const env = p.envKey ? envMap[p.envKey] : null;
      const ready = !env || env.ok;
      return `<button class="provider-card ${key === provider ? "active" : ""} ${ready ? "" : "offline"}" data-provider="${key}" type="button">
        <span class="badge ${p.badge}">${p.badgeText}</span>
        <h3>${esc(p.label)}</h3>
        <p>${esc(p.desc)}</p>
        <div class="provider-foot">
          <span>${env ? esc(env.text) : "系统内置"}</span>
          <span class="check">✓</span>
        </div>
      </button>`;
    })
    .join("");

  const p = PROVIDERS[provider];
  $("#providerHint").textContent = `${p.label} · ${p.short}`;
  $("#providerNote").textContent = p.note;

  const envRows = state.env.length
    ? state.env.map((item) => `<div><span>${esc(item.label)}</span><b class="${item.ok ? "good" : "bad"}">${esc(item.text)}</b></div>`).join("")
    : `<div><span>控制台服务</span><b class="bad">未连接</b></div>`;
  $("#providerEnv").innerHTML = envRows;
  if (provider === "voicestudio" && !state.vs?.ok) {
    const row = document.createElement("div");
    row.className = "vs-start";
    row.innerHTML = `<button class="btn small primary" id="vsStartBtn" type="button">现在启动（可选）</button><span class="vs-start-hint">不点也行：出片时会自动在后台启动</span>`;
    $("#providerEnv").appendChild(row);
    $("#vsStartBtn").addEventListener("click", startVoiceStudio);
  }

  renderAdvanced();
  renderVoiceOptions();
}

function renderAdvanced() {
  const provider = state.config.provider;
  const config = state.config[provider] || {};
  const fields = PROVIDERS[provider].fields(config);
  const wrap = $("#advancedFields");

  wrap.innerHTML = fields
    .map((f) => {
      if (f.t === "text") {
        return `<div class="field"><label>${esc(f.label)}</label><input type="text" data-k="${f.k}" data-t="text" value="${esc(f.v)}" placeholder="${esc(f.ph || "")}" /></div>`;
      }
      if (f.t === "select") {
        const opts = f.options.map(([val, text]) => `<option value="${esc(val)}" ${String(val) === String(f.v) ? "selected" : ""}>${esc(text)}</option>`).join("");
        return `<div class="field"><label>${esc(f.label)}</label><select data-k="${f.k}" data-t="select">${opts}</select></div>`;
      }
      if (f.t === "range") {
        return `<div class="range-field"><div class="range-head"><label>${esc(f.label)}</label><b data-out="${f.k}">${esc(f.fmt(Number(f.v)))}</b></div><input type="range" data-k="${f.k}" data-t="range" data-fmt="${f.fmt === undefined ? "" : "num"}" min="${f.min}" max="${f.max}" step="${f.step}" value="${Number(f.v)}" /></div>`;
      }
      return `<label class="switch-row"><input type="checkbox" data-k="${f.k}" data-t="check" ${f.v ? "checked" : ""} /><span class="switch"></span><span><b>${esc(f.label)}</b><small>${esc(f.desc || "")}</small></span></label>`;
    })
    .join("");

  if (!fields.length) wrap.innerHTML = `<div class="muted small">该方案没有额外参数。</div>`;
}

function updateVoiceMeta(name) {
  const meta = state.voices.find((v) => v.name === name);
  $("#voiceMeta").textContent = meta
    ? `${meta.name} · ${Math.max(1, Math.round(meta.size / 1024))} KB · 参考音色`
    : "参考音频位于 assets/voice-ref。";
}

function syncVoiceControls() {
  const edge = state.config.provider === "edge";
  $("#playVoice").disabled = edge || !$("#voiceSelect").value;
  $("#uploadVoice").disabled = edge || state.runActive;
  $("#trimPreview").disabled = state.runActive;
  $("#trimSave").disabled = state.runActive;
}

function renderVoiceOptions() {
  const provider = state.config.provider;
  const select = $("#voiceSelect");
  const current = providerVoiceFile(provider);
  const edge = provider === "edge";

  const names = state.voices.map((v) => v.name);
  if (current && !names.includes(current)) names.unshift(current);
  if (!names.length) {
    select.innerHTML = `<option value="">（未找到参考音频）</option>`;
    select.disabled = true;
  } else {
    select.disabled = false;
    select.innerHTML = names
      .map((name) => {
        const info = state.voices.find((v) => v.name === name);
        const size = info ? ` · ${Math.max(1, Math.round(info.size / 1024))} KB` : "";
        return `<option value="${esc(name)}" ${name === current ? "selected" : ""}>${esc(name)}${size}</option>`;
      })
      .join("");
  }

  $("#voiceModeTag").textContent = edge ? "内置" : "克隆";
  if (edge) {
    select.disabled = true;
    $("#voiceMeta").textContent = "使用 Edge 内置中文音色，无需参考音频。";
  } else {
    updateVoiceMeta(select.value);
  }
  syncVoiceControls();
  renderInputOverview();
}

async function refreshVoiceStudio() {
  try {
    state.vs = await api("/api/voicestudio/status");
  } catch {
    state.vs = { ok: false, text: "未启动" };
  }
  const idx = state.env.findIndex((item) => item.key === "voicestudio");
  const row = state.config.provider === "local3"
    ? { key: "voicestudio", label: "CosyVoice3", ok: true, text: "直连" }
    : { key: "voicestudio", label: "VoiceStudio", ok: Boolean(state.vs?.ok), text: state.vs?.text || "未启动" };
  if (idx >= 0) state.env[idx] = row;
  else state.env.push(row);
  renderEnv();
  renderProviders();
}

async function startVoiceStudio() {
  const btn = $("#vsStartBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "正在启动…";
  }
  toast("正在启动 VoiceStudio，首次加载模型需要一点时间…");
  try {
    state.vs = await api("/api/voicestudio/start", { method: "POST" });
    toast(state.vs.ok ? "VoiceStudio 已就绪" : "服务还没起来，稍后再试或查看终端日志", state.vs.ok ? "ok" : "error");
  } catch (err) {
    toast(err.message, "error");
  }
  renderProviders();
}

function fmtSeconds(seconds) {
  return `${(Number(seconds) || 0).toFixed(1)}s`;
}

function openTrim(name, total) {
  state.trim = { name, total, start: 0, length: Math.min(10, total) };
  const panel = $("#trimPanel");
  panel.classList.remove("hidden");
  $("#trimTotal").textContent = `${fmtSeconds(total)} 原始`;

  const maxLen = Math.max(0.4, Math.min(12, total));
  const minLen = total >= 3 ? 3 : Math.max(0.4, Math.min(0.5, maxLen));
  const lengthInput = $("#trimLength");
  lengthInput.min = minLen.toFixed(1);
  lengthInput.max = maxLen.toFixed(1);
  lengthInput.value = Math.min(10, maxLen).toFixed(1);

  const startInput = $("#trimStart");
  startInput.value = "0";
  startInput.max = Math.max(0, total - Number(lengthInput.value)).toFixed(1);

  $("#trimNote").textContent =
    total < 3
      ? `这段只有 ${fmtSeconds(total)}，克隆效果可能不稳定，建议换一段更长的录音。`
      : total > 12
        ? "已给出前 10 秒的建议片段，拖动起点和长度可以换一段。"
        : "建议 3–10 秒，选人声干净、没有背景音乐的一段。";
  updateTrimUI();
}

function updateTrimUI() {
  const trim = state.trim;
  if (!trim) return;
  const total = trim.total;
  const lengthInput = $("#trimLength");
  const startInput = $("#trimStart");
  const length = Math.min(Number(lengthInput.value) || 0.4, Math.min(12, total));
  const maxStart = Math.max(0, total - length);
  let start = Math.max(0, Math.min(Number(startInput.value) || 0, maxStart));
  startInput.max = maxStart.toFixed(1);
  startInput.value = start.toFixed(1);

  trim.start = start;
  trim.length = length;
  $("#trimStartValue").textContent = fmtSeconds(start);
  $("#trimLengthValue").textContent = fmtSeconds(length);
  $("#trimRange").style.left = `${(start / total) * 100}%`;
  $("#trimRange").style.width = `${(length / total) * 100}%`;
  syncVoiceControls();
}

function previewTrim() {
  const trim = state.trim;
  if (!trim) return;
  const audio = $("#voiceAudio");
  if (audio.dataset.mode === "trim" && !audio.paused) {
    audio.pause();
    return;
  }
  audio.dataset.mode = "trim";
  const src = U(`/media/voice/${encodeURIComponent(trim.name)}`);
  if (audio.getAttribute("src") !== src) audio.setAttribute("src", src);
  const start = () => {
    audio.currentTime = trim.start;
    audio.play().catch(() => toast("无法播放该音频", "error"));
  };
  if (audio.readyState >= 1) start();
  else audio.addEventListener("loadedmetadata", start, { once: true });
}

async function discardTrim(quiet = true) {
  const trim = state.trim;
  state.trim = null;
  $("#trimPanel").classList.add("hidden");
  const audio = $("#voiceAudio");
  audio.pause();
  audio.dataset.mode = "";
  if (trim?.name?.startsWith("_upload-")) {
    try {
      await fetch(U(`/api/voices/${encodeURIComponent(trim.name)}`), { method: "DELETE" });
    } catch {}
  }
  if (!quiet) toast("已取消上传");
}

async function uploadVoice(file) {
  if (!state.online) {
    toast("服务未连接，无法上传", "error");
    return;
  }
  if (state.runActive) {
    toast("任务运行中，暂不能替换音色", "error");
    return;
  }
  if (state.config.provider === "edge") {
    toast("Edge 方案使用内置音色，无需上传", "error");
    return;
  }
  if (!/\.(wav|mp3|m4a|flac)$/i.test(file.name)) {
    toast("仅支持 wav / mp3 / m4a / flac", "error");
    return;
  }
  if (file.size > 40 * 1024 * 1024) {
    toast("文件超过 40MB", "error");
    return;
  }
  const button = $("#uploadVoice");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "上传中…";
  try {
    const res = await fetch(U("/api/voices/upload"), {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `上传失败 (${res.status})`);
    if (state.trim) await discardTrim();
    openTrim(data.name, Number(data.duration) || 0);
    toast(`已上传 ${data.original || file.name} · ${fmtSeconds(data.duration)}`, "ok");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    button.textContent = label;
    syncVoiceControls();
  }
}

async function saveTrim() {
  const trim = state.trim;
  if (!trim) return;
  if (state.runActive) {
    toast("任务运行中，暂不能替换音色", "error");
    return;
  }
  const button = $("#trimSave");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    const data = await api("/api/voices/clip", {
      method: "POST",
      body: JSON.stringify({ name: trim.name, start: trim.start, duration: trim.length }),
    });
    state.trim = null;
    $("#trimPanel").classList.add("hidden");
    const audio = $("#voiceAudio");
    audio.pause();
    audio.dataset.mode = "";
    state.voices = state.voices.filter((voice) => voice.name !== data.name);
    state.voices.push({ name: data.name, size: data.size, mtime: Date.now() });
    state.voices.sort((a, b) => a.name.localeCompare(b.name));

    const provider = state.config.provider;
    const key = provider === "cosyvoice" ? "refWav" : provider === "kaggle" || provider === "indextts" ? "promptWav" : "";
    if (key) state.config[provider][key] = data.name;

    renderVoiceOptions();
    updateVoiceMeta(data.name);
    markDirty();
    toast(`已截取 ${fmtSeconds(data.duration)} 并选中`, "ok");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    button.textContent = label;
    syncVoiceControls();
  }
}

function setRangeLabels() {
  const ui = currentUi();
  $("#gapInput").value = ui.gap;
  $("#gapValue").textContent = `${Number(ui.gap).toFixed(2)}s`;
  $("#leadInput").value = ui.leadIn;
  $("#leadValue").textContent = `${Number(ui.leadIn).toFixed(2)}s`;
  $("#tightenInput").checked = ui.tighten !== false;
}

function renderLayoutPanel() {
  const layout = uiLayout();
  $("#layoutModeTag").textContent = LAYOUT_MODES[layout.mode] || "纯文案";
  $$("#modeSeg button").forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === layout.mode));
  $("#avatarFields").classList.toggle("hidden", layout.mode === "none");
  renderAvatarOptions();
  renderLayoutPresets();
  syncLayoutControls();
  renderDigitalHumanControls();
}

function renderDigitalHumanControls() {
  const dh = uiDigitalHuman();
  const layout = uiLayout();
  const reference = dh.reference || (layout.mode === "video" ? layout.avatar.src : "");
  const item = (state.avatars || []).find((avatar) => avatar.src === reference);
  const isVideo = /\.(mp4|webm|mov|mkv|m4v|avi)$/i.test(reference);
  $("#dhEnabled").checked = dh.enabled;
  $("#dhVariant").value = dh.variant;
  $("#dhTimeout").value = String(dh.timeoutMin);
  $("#dhFields").classList.toggle("disabled", !dh.enabled);
  const hint = $("#dhHint");
  if (!reference) {
    hint.textContent = "尚未选择参考素材。先在“创作输入”里选择数字人参考视频，再开启生成。";
  } else if (!isVideo) {
    hint.textContent = `当前参考 ${item?.name || reference.split("/").pop()} 是图片。Kaggle 对口型需要视频素材，请改用视频。`;
  } else {
    hint.textContent = `参考视频：${item?.name || reference.split("/").pop()}。首次运行需在 Kaggle 安装依赖，约 40–55 分钟；之后会复用数据集缓存。`;
  }
}

function renderAvatarOptions() {
  const layout = uiLayout();
  const list = state.avatars || [];
  $("#avatarSelect").innerHTML =
    `<option value="">${list.length ? "选择已有素材" : "暂无素材，请先上传"}</option>` +
    list
      .map((item) => `<option value="${esc(item.src)}" ${item.src === layout.avatar.src ? "selected" : ""}>${esc(item.name)}</option>`)
      .join("");
  renderInputOverview();
}

function renderLayoutPresets() {
  const current = currentUi().presetId || "";
  $("#presetSelect").innerHTML =
    `<option value="">选择预设</option>` +
    (state.layoutPresets || [])
      .map((item) => `<option value="${esc(item.id)}" ${item.id === current ? "selected" : ""}>${esc(item.name)}</option>`)
      .join("");
}

function syncLayoutControls() {
  const layout = uiLayout();
  const a = layout.avatar;
  const percent = (v) => `${Math.round(v * 100)}%`;
  $("#avatarWidth").value = String(Math.round(a.width * 100));
  $("#avatarWidthValue").textContent = percent(a.width);
  $("#avatarX").value = String(Math.round(a.x * 100));
  $("#avatarXValue").textContent = percent(a.x);
  $("#avatarY").value = String(Math.round(a.y * 100));
  $("#avatarYValue").textContent = percent(a.y);
  $("#avatarGap").value = String(layout.gap);
  $("#avatarGapValue").textContent = `${layout.gap}px`;
  $("#avatarShape").value = a.shape;
  $("#avatarMotion").value = a.motion;
  $("#borderWidth").value = String(a.borderWidth);
  $("#borderWidthValue").textContent = `${a.borderWidth}px`;
  $("#borderColor").value = a.borderColor;
  $("#borderColorValue").textContent = a.borderColor.toUpperCase();
  $("#frameInput").checked = a.frame !== false;
  $("#avoidInput").checked = layout.avoid !== false;
  $$("#anchorGrid button").forEach((btn) =>
    btn.classList.toggle(
      "active",
      Math.abs(Number(btn.dataset.x) - a.x) < 0.04 && Math.abs(Number(btn.dataset.y) - a.y) < 0.04,
    ),
  );
  renderPreviewAvatar();
}

function renderPreviewAvatar() {
  const layout = uiLayout();
  const phone = $("#stylePreview");
  const el = $("#previewAvatar");
  const safeEl = $("#previewSafe");
  const show = layout.mode !== "none";
  el.classList.toggle("hidden", !show);
  safeEl.classList.toggle("hidden", !show || layout.avoid === false);
  if (!show) return;

  const W = phone.clientWidth || 300;
  const H = phone.clientHeight || 620;
  const a = layout.avatar;
  const wPct = a.width * 100;
  const aspect = shapeAspect(a.shape, a.aspect);
  el.style.left = `${a.x * 100}%`;
  el.style.top = `${a.y * 100}%`;
  el.style.width = `${wPct}%`;
  el.style.height = "auto";
  el.style.aspectRatio = String(aspect);
  el.style.transform = "translate(-50%, -50%)";

  const clip = AVATAR_CLIP[a.shape] || "";
  const radius =
    a.shape === "circle" || a.shape === "ellipse"
      ? "50%"
      : a.shape === "rounded"
        ? `${Math.max(6, Math.min(20, wPct * 0.9))}px`
        : "0px";
  const borderPx = (Number(a.borderWidth) || 0) * (W / 1080);
  el.style.clipPath = clip || "none";
  el.style.borderRadius = clip ? "0" : radius;
  el.style.background = borderPx > 0 ? a.borderColor : "transparent";
  el.style.filter = a.frame ? "drop-shadow(0 8px 16px rgba(0,0,0,0.45))" : "none";

  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(a.src || "");
  const kind = a.src ? (isVideo ? "video" : "image") : "empty";
  if (el.dataset.kind !== kind || el.dataset.src !== a.src) {
    el.dataset.kind = kind;
    el.dataset.src = a.src || "";
    const media =
      kind === "video"
        ? `<video src="${esc(avatarUrl(a.src))}" muted loop autoplay playsinline></video>`
        : kind === "image"
          ? `<img src="${esc(avatarUrl(a.src))}" alt="" />`
          : `<span class="preview-avatar-empty">头像 / 数字人</span>`;
    el.innerHTML = `<div class="preview-avatar-inner">${media}</div>`;
  }

  const inner = el.firstElementChild;
  if (inner) {
    const inset = Math.max(0, Math.round(borderPx * 100) / 100);
    inner.style.inset = `${inset}px`;
    inner.style.clipPath = clip || "none";
    inner.style.borderRadius = clip ? "0" : radius;
    const mediaEl = inner.firstElementChild;
    if (mediaEl && mediaEl.tagName !== "SPAN") {
      mediaEl.style.objectFit = a.shape === "rounded" ? a.fit : "cover";
      mediaEl.style.objectPosition = "center 40%";
    }
  }

  const box = computeSafeBox(layout, W, H);
  const pct = (v, total) => `${(v / total) * 100}%`;
  safeEl.style.left = pct(box.left, W);
  safeEl.style.right = pct(box.right, W);
  safeEl.style.top = pct(box.top, H);
  safeEl.style.bottom = pct(box.bottom, H);
}

async function probeAvatarAspect(src) {
  if (!src) return;
  const url = avatarUrl(src);
  const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(src);
  await new Promise((resolve) => {
    if (isVideo) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        if (video.videoWidth && video.videoHeight) {
          uiLayout().avatar.aspect = Math.round((video.videoWidth / video.videoHeight) * 1000) / 1000;
        }
        resolve();
      };
      video.onerror = resolve;
      video.src = url;
    } else {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          uiLayout().avatar.aspect = Math.round((img.naturalWidth / img.naturalHeight) * 1000) / 1000;
        }
        resolve();
      };
      img.onerror = resolve;
      img.src = url;
    }
  });
}

async function uploadAvatar(file) {
  if (!file || state.avatarBusy) return;
  state.avatarBusy = true;
  try {
    const res = await fetch(U("/api/avatars/upload"), {
      method: "POST",
      headers: { "x-file-name": encodeURIComponent(file.name) },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "上传失败");
    state.avatars = data.avatars || [];
    const layout = uiLayout();
    layout.avatar.src = data.src;
    if (layout.mode === "none") {
      layout.mode = /\.(mp4|webm|mov)$/i.test(data.name) ? "video" : "image";
    }
    const dh = uiDigitalHuman();
    if (dh.enabled || !dh.reference) dh.reference = data.src;
    await probeAvatarAspect(data.src);
    markDirty();
    renderLayoutPanel();
    toast("素材已上传", "ok");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    state.avatarBusy = false;
    $("#avatarFile").value = "";
  }
}

async function saveLayoutPreset() {
  if (!state.online) {
    toast("服务未连接，无法保存预设", "error");
    return;
  }
  const name = window.prompt("预设名称", `布局 ${state.layoutPresets.length + 1}`);
  if (!name) return;
  try {
    const data = await api("/api/layout-presets", {
      method: "POST",
      body: JSON.stringify({ id: currentUi().presetId || "", name, config: normalizeLayout(uiLayout()) }),
    });
    state.layoutPresets = data.presets || [];
    currentUi().presetId = data.saved?.id || "";
    renderLayoutPresets();
    markDirty();
    toast("布局预设已保存", "ok");
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderStyleGrid() {
  const ui = currentUi();
  $("#styleGrid").innerHTML = Object.entries(STYLES)
    .map(([id, s]) => {
      const vars = `--s-bg:${s.bg};--s-ink:${s.ink};--s-dim:${s.dim};--s-accent:${s.accent};--s-font:${s.font}`;
      return `<button class="style-card ${ui.styleId === id ? "active" : ""}" data-style="${id}" type="button">
        <div class="style-thumb" style="${vars}">
          <div class="t-bar"></div>
          <div class="t-kicker">${esc(s.kicker)}</div>
          <div class="t-title">${s.title}</div>
          <div class="t-rule"></div>
          <div class="t-caption">一组真实数据，拆开看。</div>
        </div>
        <div class="style-meta"><b>${esc(s.name)}</b><span>${esc(s.code)}</span></div>
      </button>`;
    })
    .join("");

  $$("#motionSeg button").forEach((btn) => btn.classList.toggle("active", btn.dataset.motion === ui.motion));
  $("#motionNote").textContent = MOTION_NOTES[ui.motion] || MOTION_NOTES.standard;
  $("#previewStyleName").textContent = styleName(ui.styleId);
  renderPreview();
  renderLayoutPanel();
}

function renderPreview() {
  const ui = currentUi();
  const s = STYLES[ui.styleId] || STYLES.amber;
  const phone = $("#stylePreview");
  phone.style.setProperty("--p-bg", s.bg);
  phone.style.setProperty("--p-ink", s.ink);
  phone.style.setProperty("--p-dim", s.dim);
  phone.style.setProperty("--p-accent", s.accent);
  phone.style.setProperty("--p-font", s.font);
  $("#previewKicker").textContent = s.kicker;
  $("#previewTitle").innerHTML = s.title;
  phone.classList.remove("playing");
  ["m-rise", "m-wipe", "m-zoom", "m-blur", "m-slide", "m-fade", "m-accent-sweep"].forEach((name) =>
    phone.classList.remove(name),
  );
  const recipe = currentMotionRecipe();
  if (recipe) {
    phone.classList.add(`m-${recipe.enter || "fade"}`);
    if (recipe.accent === "sweep") phone.classList.add("m-accent-sweep");
  }
  void phone.offsetWidth;
  phone.classList.add("playing");
}

function motionConfig() {
  return state.motion?.config || { recipes: {}, assignments: {} };
}

function motionScenes() {
  return state.motion?.scenes || [];
}

function activeMotionScene() {
  const scenes = motionScenes();
  if (!scenes.length) return 0;
  return Math.min(scenes.length - 1, Math.max(0, Number(state.motionSceneIndex) || 0));
}

function currentMotionRecipe() {
  const cfg = motionConfig();
  const id =
    state.motionScope === "all"
      ? cfg.assignments?.default
      : cfg.assignments?.[String(activeMotionScene())] ?? cfg.assignments?.default;
  if (!id || id === "none") return null;
  return cfg.recipes?.[id] || null;
}

const MOTION_LABELS = {
  rise: "上浮",
  wipe: "擦除",
  zoom: "推近",
  blur: "模糊",
  slide: "横移",
  fade: "淡入",
  none: "无",
  kenburns: "缓推",
  pan: "平移",
  parallax: "视差",
  mask: "遮罩",
  typewriter: "打字机",
  pop: "弹入",
  stagger: "错峰",
  cascade: "瀑布",
  sweep: "光扫",
  bar: "进度线",
  pulse: "脉冲",
  calm: "舒缓",
  normal: "标准",
  fast: "快",
};

const MOTION_DIFF_LABELS = { enter: "换入场", photo: "换图片", title: "换标题", accent: "换强调" };

function renderMotionLab() {
  const host = $("#motionCandidates");
  if (!host) return;
  const scenes = motionScenes();
  const story = state.motion?.storyboard || {};
  const blocked = Boolean(story.stale);
  const planStale = Boolean(state.motion?.planStale);
  const frozen = blocked || planStale;
  const staleEl = $("#motionStale");
  if (staleEl) {
    let message = "";
    if (blocked) {
      const oldFirst = scenes[0]
        ? `${scenes[0].kicker || ""} ${scenes[0].barTitle || scenes[0].title || ""}`.trim()
        : "";
      message = story.empty
        ? "还没有分镜。先运行一次生成流程，再回来编排动效。"
        : `编辑区文案已经更新，但当前分镜还是旧的${
            oldFirst ? `（旧分镜第一幕：${oldFirst}）` : ""
          }。请先重新生成分镜，动效才会和当前文案对齐。`;
    } else if (planStale) {
      message = "分镜已经更新，当前动效方案基于旧文案。建议点「AI 自动编排全片」重新生成。";
    }
    staleEl.textContent = message;
    staleEl.classList.toggle("hidden", !message);
  }
  const sceneSel = $("#motionScene");
  sceneSel.innerHTML = scenes.length
    ? scenes
        .map(
          (scene) =>
            `<option value="${scene.index}">${esc(scene.kicker || String(scene.index + 1))} · ${esc(
              scene.barTitle || scene.title || scene.layout,
            )}${scene.motion ? ` · ${esc(scene.motion.name)}` : ""}${scene.locked ? " · 已锁" : ""}</option>`,
        )
        .join("")
    : `<option value="0">暂无分镜，先运行一次生成</option>`;
  sceneSel.value = String(activeMotionScene());
  sceneSel.disabled = scenes.length === 0;

  const regen = $("#motionRegenerate");
  if (regen) {
    const scene = scenes[activeMotionScene()];
    const locked = Boolean(scene?.locked);
    regen.disabled = !scenes.length || locked || frozen || state.motionBusy;
    regen.textContent = blocked ? "先更新分镜" : locked ? "本幕已锁定" : planStale ? "先重新编排" : "AI 重排本幕";
    regen.title = blocked
      ? "文案与分镜不一致，先重新生成分镜"
      : planStale
        ? "分镜已更新，先重新自动编排"
        : locked
          ? "先在逐幕清单里解锁本幕"
          : "只替换当前幕，其他幕保持不变";
  }
  const autoBtn = $("#motionAuto");
  if (autoBtn) autoBtn.disabled = blocked || state.motionBusy;
  const previewBtn = $("#motionPreview");
  if (previewBtn) previewBtn.disabled = !scenes.length || frozen || state.motionBusy;

  const auto = motionConfig().auto;
  const themeEl = $("#motionTheme");
  if (themeEl) {
    themeEl.textContent = auto?.theme
      ? `主题 · ${auto.theme}${auto.fallback ? " · 本地兜底" : ""}`
      : "AI 会先判断主题，再逐幕分配动效";
    themeEl.classList.toggle("on", Boolean(auto?.theme));
  }

  $$("#motionScope button").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.scope === state.motionScope),
  );

  const presets = state.motion?.presets || [];
  $("#motionChips").innerHTML = presets
    .map(
      (preset) =>
        `<button type="button" data-preset="${esc(preset.id)}" title="直接套用「${esc(
          preset.name,
        )}」"${blocked ? " disabled" : ""}>${esc(preset.name)}</button>`,
    )
    .join("");

  const recipe = currentMotionRecipe();
  const target =
    state.motionScope === "all" ? "全部幕" : `第 ${activeMotionScene() + 1} 幕`;
  $("#motionLabState").textContent = blocked
    ? "分镜待更新"
    : planStale
      ? "方案基于旧文案"
      : recipe
        ? `已应用 · ${recipe.name}`
        : auto?.theme
          ? `已编排 · ${auto.theme}`
          : "手动描述或选择预设";
  $("#motionCurrent").innerHTML = recipe
    ? `${esc(target)} · <b>${esc(recipe.name)}</b><br />进入 ${esc(
        MOTION_LABELS[recipe.enter] || recipe.enter,
      )} · 图片 ${esc(MOTION_LABELS[recipe.photo] || recipe.photo)} · 标题 ${esc(
        MOTION_LABELS[recipe.title] || recipe.title,
      )} · 强调 ${esc(MOTION_LABELS[recipe.accent] || recipe.accent)}`
    : `${esc(target)} · 当前未应用动效`;

  const candidates = state.motionCandidates || [];
  const cfg = motionConfig();
  const sceneBaseId = cfg.assignments?.[String(activeMotionScene())];
  const sceneBase = sceneBaseId ? cfg.recipes?.[sceneBaseId] : null;
  const note =
    candidates.length && state.motionCandidateMode === "scene" && state.motionCandidateScene !== null
      ? `<div class="motion-cand-note">本幕候选 · 应用只替换第 ${
          Number(state.motionCandidateScene) + 1
        } 幕，其他幕保持不变</div>`
      : "";
  host.innerHTML = note + (candidates.length
    ? candidates
        .map((item) => {
          const applied = recipe && recipe.id === item.id;
          const diffKeys = sceneBase
            ? ["enter", "photo", "title", "accent"].filter((key) => sceneBase[key] !== item[key])
            : [];
          const diffText =
            state.motionCandidateMode === "scene" && sceneBase
              ? diffKeys.length
                ? `较当前：${diffKeys.map((key) => MOTION_DIFF_LABELS[key]).join("、")}`
                : "与当前相近"
              : "";
          return `<button type="button" class="motion-cand${applied ? " applied" : ""}" data-recipe="${esc(
            item.id,
          )}"${frozen ? " disabled" : ""}>
            <b>${esc(item.name)}</b>
            <span class="motion-tags">
              <span>${esc(MOTION_LABELS[item.enter] || item.enter)}</span>
              <span>${esc(MOTION_LABELS[item.photo] || item.photo)}</span>
              <span>${esc(MOTION_LABELS[item.title] || item.title)}</span>
              <span>${esc(MOTION_LABELS[item.accent] || item.accent)}</span>
            </span>
            <small>力度 ${Number(item.intensity).toFixed(2)} · ${esc(
              MOTION_LABELS[item.pace] || item.pace,
            )}${item.source === "preset" ? " · 本地兜底" : ""}</small>
            ${diffText ? `<small class="motion-diff">${esc(diffText)}</small>` : ""}
          </button>`;
        })
        .join("")
    : `<div class="muted small">还没有候选。点「AI 重排本幕」只替换当前幕，或直接点上方预设。</div>`);

  renderMotionPlan();
}

function renderMotionPlan() {
  const host = $("#motionPlan");
  if (!host) return;
  const cfg = motionConfig();
  const auto = cfg.auto;
  const scenes = motionScenes();
  const frozen = Boolean(state.motion?.storyboard?.stale || state.motion?.planStale);
  if (!auto || !scenes.length) {
    host.innerHTML = "";
    host.classList.add("hidden");
    return;
  }
  const rows = scenes
    .map((scene) => {
      const recipe = scene.motion ? cfg.recipes?.[scene.motion.id] : null;
      const tags = recipe
        ? [MOTION_LABELS[recipe.enter], MOTION_LABELS[recipe.photo], MOTION_LABELS[recipe.accent]]
            .filter(Boolean)
            .join(" · ")
        : "未编排";
      return `<div class="motion-plan-row${scene.locked ? " locked" : ""}">
        <span class="motion-plan-kicker">${esc(scene.kicker || String(scene.index + 1))}</span>
        <span class="motion-plan-name">${esc(recipe ? recipe.name : "—")}</span>
        <span class="motion-plan-tags">${esc(tags)}</span>
        <button type="button" class="motion-lock" data-lock="${scene.index}" data-locked="${
          scene.locked ? 1 : 0
        }"${frozen ? " disabled" : ""}>${scene.locked ? "已锁定" : "锁定"}</button>
      </div>`;
    })
    .join("");
  host.innerHTML = `<div class="motion-plan-head"><b>${esc(auto.theme || "AI 编排")}</b><span>${esc(
    auto.summary || "已按文案逐幕分配动效。",
  )}${auto.fallback ? " · 本地规则兜底" : ""}</span></div><div class="motion-plan-list">${rows}</div>`;
  host.classList.remove("hidden");
}

async function regenerateScene() {
  if (state.motionBusy) return;
  const scenes = motionScenes();
  const index = activeMotionScene();
  const scene = scenes[index];
  if (!scene) {
    toast("还没有分镜，先运行一次生成流程", "error");
    return;
  }
  if (scene.locked) {
    toast("本幕已锁定，先在逐幕清单里解锁", "error");
    return;
  }
  state.motionBusy = true;
  const btn = $("#motionRegenerate");
  btn.disabled = true;
  btn.textContent = "重排中…";
  $("#motionHint").textContent = `正在为第 ${index + 1} 幕生成候选，其他幕不会被改动…`;
  try {
    const prompt = $("#motionPrompt").value.trim();
    const data = await api("/api/motion/scene", {
      method: "POST",
      body: JSON.stringify({ sceneIndex: index, prompt }),
    });
    state.motionCandidates = data.recipes || [];
    state.motionCandidateMode = "scene";
    state.motionCandidateScene = index;
    state.motionScope = "scene";
    state.motion = { ...state.motion, ...data };
    $("#motionHint").textContent = data.fallback
      ? `AI 不可用，已为第 ${index + 1} 幕生成 ${state.motionCandidates.length} 个本地候选。`
      : `已为第 ${index + 1} 幕生成 ${state.motionCandidates.length} 个候选，点一张只替换这一幕。`;
    renderMotionLab();
    renderPreview();
  } catch (err) {
    $("#motionHint").textContent = err?.message || "重排失败，可改用预设或稍后再试。";
    toast(err.message || "重排失败", "error");
  } finally {
    state.motionBusy = false;
    renderMotionLab();
  }
}

async function applyMotion(id, scope = state.motionScope) {
  try {
    const data = await api("/api/motion/apply", {
      method: "POST",
      body: JSON.stringify({ id, scope, sceneIndex: activeMotionScene() }),
    });
    state.motion = { ...state.motion, ...data };
    state.motionCandidates = [];
    state.motionCandidateMode = null;
    state.motionCandidateScene = null;
    $("#motionHint").textContent =
      scope === "scene"
        ? `已替换第 ${activeMotionScene() + 1} 幕，其他幕保持不变。`
        : "动效已应用到全部幕，生成成片时生效。";
    renderMotionLab();
    renderPreview();
    toast(scope === "scene" ? "只替换了当前幕，其他幕保持不变" : "动效已应用，生成成片时生效");
  } catch (err) {
    if (err?.message) $("#motionHint").textContent = err.message;
    toast(err.message || "应用失败", "error");
  }
}

async function resetMotion() {
  try {
    const data = await api("/api/motion/reset", {
      method: "POST",
      body: JSON.stringify({ scope: state.motionScope, sceneIndex: activeMotionScene() }),
    });
    state.motion = { ...state.motion, ...data };
    state.motionCandidates = [];
    state.motionCandidateMode = null;
    state.motionCandidateScene = null;
    renderMotionLab();
    renderPreview();
    toast("已撤销动效");
  } catch (err) {
    toast(err.message || "撤销失败", "error");
  }
}

async function autoMotionAll() {
  if (state.motionBusy) return;
  state.motionBusy = true;
  const btn = $("#motionAuto");
  btn.disabled = true;
  btn.textContent = "AI 编排中…";
  $("#motionHint").textContent = "AI 正在读文案、判断主题并逐幕分配动效…";
  try {
    const prompt = $("#motionPrompt").value.trim();
    const data = await api("/api/motion/auto", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    state.motion = { ...state.motion, ...data };
    state.motionCandidates = [];
    state.motionCandidateMode = null;
    state.motionCandidateScene = null;
    state.motionScope = "scene";
    $("#motionHint").textContent = data.fallback
      ? `AI 不可用，已按「${data.theme}」用本地规则逐幕编排。`
      : `已按「${data.theme}」编排全片，可逐幕预览或锁定。`;
    renderMotionLab();
    renderPreview();
    toast("全片动效已编排，生成成片时生效");
  } catch (err) {
    $("#motionHint").textContent = err?.message || "自动编排失败，可改用单幕方案或预设。";
    toast(err.message || "自动编排失败", "error");
  } finally {
    state.motionBusy = false;
    btn.textContent = "AI 自动编排全片";
    renderMotionLab();
  }
}

async function toggleMotionLock(index, locked) {
  try {
    const data = await api("/api/motion/lock", {
      method: "POST",
      body: JSON.stringify({ sceneIndex: index, locked }),
    });
    state.motion = { ...state.motion, ...data };
    renderMotionLab();
    toast(locked ? "已锁定，重新编排时保留这一幕" : "已解锁");
  } catch (err) {
    toast(err.message || "操作失败", "error");
  }
}

async function previewMotionFrames() {
  const btn = $("#motionPreview");
  if (state.motionBusy) return;
  state.motionBusy = true;
  btn.disabled = true;
  btn.textContent = "渲染 3 帧…";
  $("#motionFrames").classList.add("hidden");
  try {
    const data = await api("/api/motion/preview", {
      method: "POST",
      body: JSON.stringify({ sceneIndex: activeMotionScene() }),
    });
    const stamp = Date.now();
    const labels = ["入场", "中段", "收尾"];
    $("#motionFrames").innerHTML = (data.urls || [])
      .map(
        (url, i) =>
          `<figure><img src="${url}?t=${stamp}" alt="预览帧" /><figcaption>${labels[i] || i + 1} · 第 ${
            activeMotionScene() + 1
          } 幕</figcaption></figure>`,
      )
      .join("");
    $("#motionFrames").classList.remove("hidden");
  } catch (err) {
    toast(err.message || "预览渲染失败", "error");
  } finally {
    state.motionBusy = false;
    btn.disabled = Boolean(state.motion?.storyboard?.stale || state.motion?.planStale);
    btn.textContent = "渲染真实预览（3 帧）";
  }
}

function scriptStats() {
  const lines = state.script
    .split(/\r?\n/)
    .flatMap((line) => line.split(/(?<=[。！？!?；;])/))
    .map((line) => line.trim())
    .filter(Boolean);
  const chars = lines.join("").replace(/\s/g, "").length;
  const gap = Number(currentUi().gap) || 0;
  const seconds = chars / 4.7 + Math.max(0, lines.length - 1) * gap;
  return { lines, chars, seconds };
}

function renderScriptStats() {
  const { lines, chars, seconds } = scriptStats();
  $("#scriptCount").textContent = `${chars} 字`;
  $("#statSentences").textContent = String(lines.length);
  $("#statChars").textContent = String(chars);
  $("#statDuration").textContent = `约 ${Math.round(seconds)}s`;
  const render = state.render;
  $("#statRender").textContent = render
    ? `${render.scenes} 幕 · ${render.photos} 图 · ${render.seconds.toFixed(1)}s`
    : "—";
  $("#statProvider").textContent = PROVIDERS[state.config.provider]?.short || "—";
  $("#sentenceList").innerHTML = lines.length
    ? lines.map((line) => `<li>${esc(line)}</li>`).join("")
    : `<li class="empty">还没有文案。</li>`;
}

function renderInputOverview() {
  const layout = uiLayout();
  const avatarSelect = $("#inputAvatarSelect");
  if (avatarSelect) {
    avatarSelect.innerHTML =
      `<option value="">不使用数字人</option>` +
      (state.avatars || [])
        .map((item) => `<option value="${esc(item.src)}" ${item.src === layout.avatar.src ? "selected" : ""}>${esc(item.name)}</option>`)
        .join("");
  }
  const voiceSelect = $("#inputVoiceSelect");
  if (voiceSelect) {
    const current = providerVoiceFile(state.config.provider);
    const names = (state.voices || []).map((voice) => voice.name);
    if (current && !names.includes(current)) names.unshift(current);
    voiceSelect.innerHTML = names.length
      ? names.map((name) => `<option value="${esc(name)}" ${name === current ? "selected" : ""}>${esc(name)}</option>`).join("")
      : `<option value="">（未找到参考音频）</option>`;
  }
  const title = $("#seriesTitle");
  const tagline = $("#seriesTagline");
  if (title && document.activeElement !== title) title.value = state.series?.title || "";
  if (tagline && document.activeElement !== tagline) tagline.value = state.series?.tagline || "";
  const summary = $("#inputMaterialSummary");
  if (summary) {
    const items = state.materials?.items?.length || 0;
    const chapters = state.materials?.chapters?.length || 0;
    summary.textContent = `${items} 张 · ${chapters} 章`;
  }
}

async function refreshRenderSummary() {
  try {
    const data = await api("/api/bootstrap");
    if (data.render) {
      state.render = data.render;
      renderScriptStats();
      renderAiConfig();
    }
  } catch {
    /* 离线时忽略 */
  }
}

async function refreshMotionPanel() {
  try {
    const motion = await api("/api/motion");
    if (!motion) return;
    state.motion = motion;
    const max = Math.max(0, (motion.scenes?.length || 1) - 1);
    state.motionSceneIndex = Math.min(max, Number(state.motionSceneIndex) || 0);
    renderMotionLab();
    renderStoryboardStatus();
    renderMaterials();
  } catch {
    /* 离线时忽略 */
  }
}

function storyboardData() {
  return state.prep?.storyboard || state.motion?.storyboard || {};
}

function renderStoryboardStatus() {
  const status = storyboardData();
  const prep = state.prep || {};
  const running = prep.state === "running";
  const failed = prep.state === "error";
  const stale = Boolean(status.stale);
  const planStale = Boolean(status.planStale || state.motion?.planStale);
  const scenes = state.motion?.scenes?.length || 0;
  const dot = $("#storyboardDot");
  const label = $("#storyboardState");
  const detail = $("#storyboardDetail");
  const retry = $("#storyboardRetry");
  const refresh = $("#storyboardRefresh");
  const progress = $("#prepProgress");
  if (!dot || !label || !detail) return;

  let dotClass = "ok";
  let text = "分镜就绪";
  let note = scenes ? `${scenes} 幕 · 基于当前文案与素材` : "尚未生成分镜";
  if (running) {
    dotClass = "running";
    text = prep.stage?.includes("动效") ? "正在编排动效…" : "正在生成分镜…";
    note = prep.pending ? "有新改动已排队，当前完成后会自动继续" : "可以先看别的页面，完成后会自动刷新";
    if (prep.stage && !prep.stage.includes("动效")) note = `${prep.stage} · ${note}`;
  } else if (failed) {
    dotClass = "error";
    text = "编排失败";
    note = prep.error || "可以重试，已生成的成片不会受影响";
  } else if (stale) {
    dotClass = "warn";
    text = "分镜待更新";
    note =
      status.reason === "materials-changed"
        ? "素材或章节已变化，更新后才会套用到成片"
        : status.reason === "no-storyboard"
          ? "还没有分镜，先更新一次分镜"
          : "文案已改，当前分镜仍是旧的；保存后会自动预生成";
  } else if (planStale) {
    dotClass = "warn";
    text = "分镜已更新 · 动效待编排";
    note = prep.motionError ? `自动编排没完成：${prep.motionError}` : "分隔幕可单独重排，或直接生成时沿用现有方案";
  } else {
    dotClass = "ok";
    text = "分镜已同步";
    const plan = state.runPlan;
    note = scenes
      ? `${scenes} 幕 · ${plan?.voice ? "生成时会复用分镜和配音" : plan?.storyboard ? "生成时会复用分镜" : "生成时按当前方案执行"}`
      : "还没有分镜";
  }
  dot.className = `ss-dot ${dotClass}`;
  label.textContent = text;
  detail.textContent = note;
  if (refresh) {
    refresh.disabled = running || state.runActive;
    refresh.textContent = running ? "生成中…" : "更新分镜";
  }
  if (retry) retry.classList.toggle("hidden", !failed);
  if (progress) {
    progress.classList.toggle("hidden", !running);
    const stage = $("#prepStage");
    const hint = $("#prepHint");
    if (stage) stage.textContent = prep.stage ? `${prep.stage}…` : "正在生成分镜…";
    if (hint) hint.textContent = prep.pending ? "有新的改动排队中" : "完成后自动刷新";
    const log = $("#prepLog");
    if (log) {
      log.textContent = (prep.logs || [])
        .slice(-4)
        .map((entry) => (typeof entry === "string" ? entry : entry.line))
        .filter(Boolean)
        .join("\n");
    }
  }
  const runBtn = $("#runBtn");
  if (runBtn && !state.runActive) {
    runBtn.disabled = running;
    runBtn.innerHTML = running
      ? `<span class="btn-dot"></span>分镜编排中…`
      : `<span class="btn-dot"></span>${stale ? "生成（含分镜）" : "继续生成"}`;
  }
}

async function refreshStoryboardMeta() {
  try {
    const [data, motion] = await Promise.all([api("/api/storyboard"), api("/api/motion")]);
    state.prep = data.prep || state.prep;
    state.runPlan = data.runPlan || null;
    if (motion) {
      state.motion = motion;
    } else {
      state.motion = {
        ...state.motion,
        storyboard: data,
        scenes: Array.isArray(data.scenes) ? data.scenes : state.motion.scenes,
      };
    }
    if (data.materials) {
      state.materials = data.materials;
      renderMaterials();
    }
    renderStoryboardStatus();
    renderMotionLab();
  } catch {
    /* 离线时忽略 */
  }
}

async function requestStoryboardPrep({ force = true, reason = "", autoMotion = true } = {}) {
  if (!state.online) {
    toast("服务未连接，无法生成分镜", "error");
    return;
  }
  if (state.runActive) {
    toast("视频正在生成，等结束后再更新分镜", "error");
    return;
  }
  if (state.prep?.state === "running") {
    toast("分镜正在编排，新的改动会在完成后自动继续", "ok");
    return;
  }
  state.prep = { ...(state.prep || {}), state: "running", stage: "生成分镜", logs: [], pending: false, error: "" };
  renderStoryboardStatus();
  try {
    const data = await api("/api/storyboard/generate", {
      method: "POST",
      body: JSON.stringify({ force, autoMotion, reason }),
    });
    applyPrepState(data);
  } catch (err) {
    state.prep = { ...state.prep, state: "error", error: err.message };
    renderStoryboardStatus();
    toast(err.message || "分镜生成失败", "error");
  }
}

function applyPrepState(data) {
  if (!data) return;
  const wasRunning = state.prep?.state === "running";
  state.prep = { ...(state.prep || {}), ...data };
  if (data.storyboard) state.motion = { ...state.motion, storyboard: data.storyboard };
  renderStoryboardStatus();
  if (wasRunning && data.state === "done") {
    toast(data.motionError ? "分镜已更新，动效需要手动重排" : "分镜与动效已更新", data.motionError ? "" : "ok");
    refreshStoryboardMeta();
  }
  if (wasRunning && data.state === "error") {
    toast(data.error || "分镜生成失败", "error");
  }
}

function materialChapterNames() {
  const names = [];
  for (const name of state.materials?.chapterOptions || []) names.push(name);
  for (const scene of state.motion?.scenes || []) if (scene.chapter) names.push(scene.chapter);
  for (const chapter of state.materials?.chapters || []) names.push(chapter.name);
  return [...new Set(names.filter((name) => name && name !== "未分章"))];
}

function materialChapterOptions(selected) {
  const names = materialChapterNames();
  if (selected && selected !== "未分章" && !names.includes(selected)) names.push(selected);
  return [
    ...names.map((name) => `<option value="${esc(name)}"${name === selected ? " selected" : ""}>${esc(name)}</option>`),
    `<option value="未分章"${selected === "未分章" ? " selected" : ""}>未分章</option>`,
    `<option value="__new">＋ 新建章节…</option>`,
  ].join("");
}

const PREVIEW_W = 1080;
const PREVIEW_H = 1920;
const PREVIEW_SIDE = 66;
const PREVIEW_SAFE_BOTTOM = 380;
const PREVIEW_PALETTES = {
  amber: { bg: "#0E1116", bgSoft: "#161B23", ink: "#F5F1EA", inkDim: "rgba(245, 241, 234, 0.62)", accent: "#E8A33D" },
  tech: { bg: "#06121B", bgSoft: "#0B1D29", ink: "#E9F7FF", inkDim: "rgba(233, 247, 255, 0.64)", accent: "#38D6E6" },
  paper: { bg: "#F2EDE3", bgSoft: "#E9E1D4", ink: "#1C1916", inkDim: "rgba(28, 25, 22, 0.66)", accent: "#B8452F" },
  mono: { bg: "#050505", bgSoft: "#0D0D0D", ink: "#FFFFFF", inkDim: "rgba(255, 255, 255, 0.64)", accent: "#FFFFFF" },
};

function previewPalette() {
  return PREVIEW_PALETTES[currentUi().styleId] || PREVIEW_PALETTES.amber;
}

function previewNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function previewPhotoUrl(scene) {
  const name = basename(scene?.photo);
  return name ? `/media/photos/${encodeURIComponent(name)}` : "";
}

function previewAvatarUrl(src) {
  const name = basename(src);
  return name ? `/media/avatar/${encodeURIComponent(name)}` : "";
}

function previewShapeAspect(shape, aspect) {
  if (shape === "ellipse") return 1 / 1.22;
  if (shape === "hexagon") return 1 / 0.92;
  if (shape === "rounded") return previewNum(aspect, 0.2, 3, 0.75);
  return 1;
}

function previewSafeBox(layout) {
  const box = { left: PREVIEW_SIDE, right: PREVIEW_SIDE, top: 0, bottom: PREVIEW_SAFE_BOTTOM };
  const avatar = layout?.avatar;
  const hasAvatar = layout?.mode !== "none" && Boolean(avatar && avatar.src);
  if (!hasAvatar || layout.avoid === false) return { ...box, contentBottom: PREVIEW_SAFE_BOTTOM };
  const width = Math.max(0, Math.min(PREVIEW_W, (Number(avatar.width) || 0.34) * PREVIEW_W));
  const ratio = previewShapeAspect(avatar.shape || "rounded", Number(avatar.aspect) || 0.75);
  const height = width / ratio;
  const cx = Math.min(PREVIEW_W, Math.max(0, (Number(avatar.x) || 0.5) * PREVIEW_W));
  const cy = Math.min(PREVIEW_H, Math.max(0, (Number(avatar.y) || 0.76) * PREVIEW_H));
  const rect = { left: cx - width / 2, top: cy - height / 2, width, height };
  const offCenter = cx <= PREVIEW_W * 0.46 || cx >= PREVIEW_W * 0.54;
  const overlapsTextBand = rect.top < PREVIEW_H * 0.62 && rect.top + height > PREVIEW_H * 0.18;
  const sideBySide = width < PREVIEW_W * 0.56 && offCenter && overlapsTextBand;
  const gap = Math.max(0, Number(layout.gap) || 0);
  let contentBottom = PREVIEW_SAFE_BOTTOM;
  if (sideBySide) {
    if (cx <= PREVIEW_W * 0.46) box.left = Math.max(box.left, rect.left + width + gap);
    else box.right = Math.max(box.right, PREVIEW_W - rect.left + gap);
    contentBottom = Math.max(PREVIEW_SAFE_BOTTOM, Math.round(PREVIEW_H - rect.top + gap));
  } else if (cy <= PREVIEW_H * 0.5) {
    box.top = Math.max(box.top, rect.top + height + gap);
  } else {
    box.bottom = Math.max(box.bottom, PREVIEW_H - rect.top + gap);
  }
  const maxInset = PREVIEW_W * 0.42;
  box.left = Math.min(box.left, maxInset);
  box.right = Math.min(box.right, maxInset);
  contentBottom = Math.max(contentBottom, box.bottom);
  return { ...box, contentBottom };
}

function previewAvatar(layout) {
  const avatar = layout?.avatar;
  if (!layout || layout.mode === "none" || !avatar || !avatar.src) return "";
  const width = Math.max(0, Math.min(PREVIEW_W, (Number(avatar.width) || 0.34) * PREVIEW_W));
  const ratio = previewShapeAspect(avatar.shape || "rounded", Number(avatar.aspect) || 0.75);
  const height = width / ratio;
  const cx = Math.min(PREVIEW_W, Math.max(0, (Number(avatar.x) || 0.5) * PREVIEW_W));
  const cy = Math.min(PREVIEW_H, Math.max(0, (Number(avatar.y) || 0.76) * PREVIEW_H));
  const shape = avatar.shape || "rounded";
  const clip = shape === "diamond" ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" : shape === "hexagon" ? "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)" : "";
  const radius = shape === "circle" || shape === "ellipse" ? "50%" : shape === "rounded" ? Math.round(width * 0.07) + "px" : "0";
  const ring = Math.max(0, Math.min(32, Number(avatar.borderWidth) || 0));
  const shapeStyle = clip ? `clip-path:${clip};` : `border-radius:${radius};`;
  const innerRadius = radius === "50%" ? "50%" : Math.max(0, Number(parseInt(radius, 10)) - ring) + "px";
  const fit = shape === "rounded" && avatar.fit === "contain" ? "contain" : "cover";
  return '<div style="position:absolute;left:' + (cx - width / 2) + "px;top:" + (cy - height / 2) + "px;width:" + width + "px;height:" + height + "px;z-index:15;background:" + (ring > 0 ? esc(avatar.borderColor || "#E8A33D") : "transparent") + ";" + shapeStyle + "box-sizing:border-box;filter:drop-shadow(0 22px 46px rgba(14,17,22,0.8))" + '">' +
    '<div style="position:absolute;inset:' + ring + "px;background:#161B23;" + (clip ? `clip-path:${clip};` : `border-radius:${innerRadius};overflow:hidden;`) + '">' +
      '<img src="' + previewAvatarUrl(avatar.src) + '" style="width:100%;height:100%;object-fit:' + fit + ';object-position:center 40%;display:block" alt="" />' +
    '</div>' +
  '</div>';
}

function previewMasthead(pal) {
  const meta = state.motion?.meta || {};
  const title = String(meta.seriesTitle || "生活指南").trim() || "生活指南";
  const chars = Array.from(title);
  const splitAt = chars.length > 4 ? Math.ceil(chars.length / 2) : chars.length;
  const first = chars.slice(0, splitAt).join("");
  const rest = chars.slice(splitAt).join("");
  const tagline = String(meta.seriesTagline || "一条视频讲清楚").trim();
  return '<div style="position:absolute;left:' + PREVIEW_SIDE + "px;right:" + PREVIEW_SIDE + 'px;top:76px;z-index:60;pointer-events:none">' +
    '<div style="display:flex;gap:30px">' +
      '<div style="width:6px;height:300px;margin-top:8px;border-radius:3px;background:linear-gradient(180deg,' + pal.accent + "," + pal.accent + '66 78%,transparent);box-shadow:0 0 22px ' + pal.accent + '44"></div>' +
      '<div style="min-width:0">' +
        '<div style="font-size:19px;line-height:1.2;font-weight:600;letter-spacing:8px;color:' + pal.accent + '">生活指南</div>' +
        '<div style="margin-top:20px;font-size:140px;line-height:1.02;font-weight:800;letter-spacing:1px;color:' + pal.ink + ';white-space:nowrap;text-shadow:0 4px 26px rgba(0,0,0,0.55)">' + esc(first) + '</div>' +
        '<div style="font-size:140px;line-height:1.02;font-weight:800;letter-spacing:1px;color:' + pal.accent + ';white-space:nowrap;text-shadow:0 4px 26px rgba(0,0,0,0.5)">' + esc(rest) + '</div>' +
      '</div>' +
    '</div>' +
    '<div style="position:absolute;left:0;right:0;top:362px;font-size:28px;line-height:1.2;letter-spacing:4px;font-weight:500;color:' + pal.inkDim + '">' + esc(tagline) + '</div>' +
    '<div style="position:absolute;right:0;top:86px;width:10px;height:10px;transform:rotate(45deg);background:' + pal.accent + ';opacity:0.9"></div>' +
  '</div>';
}

function previewTitleBar(scene, pal) {
  return '<div style="position:absolute;left:0;top:0;width:' + PREVIEW_W + "px;height:640px;overflow:hidden;z-index:20;background:linear-gradient(180deg," + pal.bg + "F2 0%," + pal.bg + "DE 42%," + pal.bg + "A8 68%," + pal.bg + "52 86%," + pal.bg + '00 100%)">' +
    '<div style="position:absolute;left:' + PREVIEW_SIDE + 'px;top:520px;height:120px;display:flex;align-items:center;max-width:948px">' +
      '<div style="font-size:54px;line-height:1.22;letter-spacing:1.2px;font-weight:700;color:' + pal.ink + ';display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 3px 22px rgba(0,0,0,0.5)">' + esc(scene?.title || "") + '</div>' +
    '</div>' +
  '</div>';
}

function previewSceneHtml(scene, styleOverride) {
  const pal = previewPalette();
  const material = Boolean(scene && scene.photoSource === "material" && scene.layout !== "closing");
  const style = normalizeSceneLayoutClient(styleOverride || scene?.layoutStyle);
  const preset = material ? style.preset : "full";
  const layout = state.motion?.layout || { mode: "none" };
  const box = previewSafeBox(layout);
  const photoBox = preset === "top"
    ? { left: 0, top: 500, width: PREVIEW_W, height: 440 }
    : preset === "left"
      ? { left: 0, top: 500, width: 560, height: 860 }
      : { left: 0, top: 0, width: PREVIEW_W, height: PREVIEW_H };
  const contentBottomInset = Math.max(PREVIEW_SAFE_BOTTOM, box.bottom);
  const contentMinTop = material ? (preset === "full" ? 600 : preset === "top" ? 980 : 660) : 668;
  const contentMaxTop = Math.max(contentMinTop, PREVIEW_H - contentBottomInset - 200);
  const contentTop = contentMinTop + (style.contentY / 100) * (contentMaxTop - contentMinTop);
  const baseLeft = preset === "left" ? 620 : box.left;
  const baseWidth = preset === "left" ? PREVIEW_W - box.right - 620 : PREVIEW_W - box.left - box.right;
  const shift = Math.round((style.contentX / 100) * Math.min(180, baseWidth * 0.22));
  const contentLeft = baseLeft + shift;
  const contentWidth = Math.max(240, baseWidth - shift);
  const justify = style.contentAlign === "center" ? "center" : style.contentAlign === "right" ? "flex-end" : "flex-start";
  const photoUrl = previewPhotoUrl(scene);
  const photo = photoUrl
    ? '<div style="position:absolute;left:' + photoBox.left + "px;top:" + photoBox.top + "px;width:" + photoBox.width + "px;height:" + photoBox.height + 'px;overflow:hidden;background:' + pal.bgSoft + '">' +
        '<div style="position:absolute;inset:0;background-image:url(\'' + photoUrl + '\');background-size:cover;background-position:' + style.photoX + "% " + style.photoY + "%;transform:scale(" + style.photoScale + ");transform-origin:" + style.photoX + "% " + style.photoY + '%;filter:brightness(1.06) saturate(1.04)"></div>' +
      '</div>'
    : '<div style="position:absolute;inset:0;background:linear-gradient(155deg,' + pal.bgSoft + "," + pal.bg + ')"></div>';
  const topScrim = '<div style="position:absolute;inset:0;z-index:2;background:linear-gradient(180deg,' + pal.bg + 'E6 0%,' + pal.bg + 'A8 22%,' + pal.bg + '33 38%,' + pal.bg + '00 52%)"></div>';
  const bottomScrim = '<div style="position:absolute;inset:0;z-index:3;background:linear-gradient(180deg,' + pal.bg + '00 0%,' + pal.bg + '00 38%,' + pal.bg + '33 52%,' + pal.bg + 'AA 68%,' + pal.bg + 'E6 84%,' + pal.bg + 'F2 100%)"></div>';
  const contentScrim = '<div style="position:absolute;left:' + Math.max(0, contentLeft - 28) + "px;right:" + Math.max(0, PREVIEW_W - contentLeft - contentWidth - 28) + "px;top:" + Math.max(0, contentTop - 150) + 'px;height:430px;z-index:4;background:linear-gradient(180deg,' + pal.bg + '00 0%,' + pal.bg + '8C 24%,' + pal.bg + 'B8 62%,' + pal.bg + '00 100%);opacity:0.9"></div>';
  const kicker = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><div style="width:8px;height:8px;border-radius:4px;background:' + pal.accent + ";box-shadow:0 0 12px " + pal.accent + '66"></div><div style="font-size:22px;letter-spacing:5px;color:' + pal.accent + ';font-weight:600">' + esc(scene?.kicker || scene?.barTitle || "生活切片") + '</div></div>';
  const bullets = (scene?.bullets || []).slice(0, 3).map((text, i) =>
    '<div style="display:flex;gap:12px;align-items:flex-start;justify-content:' + justify + ';margin-top:8px">' +
      '<div style="margin-top:13px;width:7px;height:7px;border-radius:4px;flex:none;background:' + (i === 0 ? pal.accent : "rgba(255,255,255,0.35)") + '"></div>' +
      '<div style="font-size:' + (preset === "left" ? 27 : 31) + "px;line-height:1.5;font-weight:" + (i === 0 ? 700 : 500) + ";color:" + pal.ink + ";opacity:" + (i === 0 ? 1 : 0.86) + ';text-shadow:0 2px 18px rgba(0,0,0,0.7)">' + esc(text) + '</div>' +
    '</div>',
  ).join("");
  return '<div style="position:absolute;inset:0;background:' + pal.bg + '">' +
    photo + topScrim + bottomScrim + contentScrim +
    previewTitleBar(scene, pal) +
    previewMasthead(pal) +
    '<div style="position:absolute;left:' + contentLeft + "px;top:" + contentTop + "px;width:" + contentWidth + "px;z-index:10;display:flex;flex-direction:column;align-items:flex-start;text-align:" + style.contentAlign + '">' +
      kicker +
      '<div style="width:100%">' + bullets + '</div>' +
    '</div>' +
    previewAvatar(layout) +
  '</div>';
}

function previewScene() {
  const scenes = state.motion?.scenes || [];
  if (!scenes.length) return null;
  const found = scenes.find((scene) => scene.id === state.previewSceneId);
  if (found) return found;
  const fallback = scenes.find((scene) => scene.photoSource === "material" && scene.layout !== "closing") || scenes[0];
  state.previewSceneId = fallback.id;
  return fallback;
}

function previewSceneSource(scene) {
  if (!scene) return "";
  if (scene.layout === "closing") return "收尾";
  if (scene.photoSource === "material") {
    const chapter = scene.chapter && scene.chapter !== "未分章" ? scene.chapter : "";
    return chapter ? `素材 · ${chapter}` : "素材图";
  }
  return scene.photoKey ? `网络图 · ${scene.photoKey}` : "内置版式";
}

function previewCanvasMarkup(scene, styleOverride) {
  return `<div class="mp-canvas">${previewSceneHtml(scene, styleOverride)}</div>`;
}

function fitMaterialPreview() {
  document.querySelectorAll("#mpStage").forEach((stage) => {
    const canvas = stage.querySelector(".mp-canvas");
    if (!canvas) return;
    const width = stage.clientWidth;
    if (!width) return;
    canvas.style.transform = `scale(${width / PREVIEW_W})`;
  });
}

function refreshPreviewCanvas() {
  const stage = $("#mpStage");
  const scene = previewScene();
  if (!stage || !scene) return;
  const draft = state.previewDraft && state.previewDraft.sceneId === scene.id ? state.previewDraft.style : null;
  stage.innerHTML = previewCanvasMarkup(scene, draft);
  fitMaterialPreview();
}

function rememberPreviewScene(id) {
  state.previewSceneId = id;
  try {
    localStorage.setItem("od-preview-scene", id);
  } catch {}
}

function renderMaterials() {
  const host = $("#materialChapters");
  if (!host) return;
  const chapters = state.materials?.chapters || [];
  const items = state.materials?.items || [];
  const total = items.length;
  const matched = items.filter((item) => item.chapter && item.chapter !== "未分章").length;
  const summary = $("#materialSummary");
  if (summary) {
    summary.textContent = total
      ? `${total} 张 · ${chapters.filter((chapter) => chapter.name !== "未分章").length} 章${
          matched < total ? ` · ${total - matched} 张未分章` : ""
        }`
      : "还没有素材";
  }
  const byName = new Map(chapters.map((chapter) => [chapter.name, chapter]));
  const groups = materialChapterNames().map((name) => byName.get(name) || { name, count: 0, items: [] });
  for (const chapter of chapters) {
    if (chapter.name !== "未分章" && !groups.some((group) => group.name === chapter.name)) groups.push(chapter);
  }
  const unmatched = byName.get("未分章");
  if (unmatched?.count) groups.push(unmatched);
  if (!total) {
    host.innerHTML = `<div class="material-empty">把图片拖进来，或点「上传图片」。文件名里带章节名就会自动分到对应章节，也可以拖到下方章节里。</div>`;
  } else {
    const emptyChapters = groups.filter((chapter) => chapter.name !== "未分章" && !chapter.count);
    const filledChapters = groups.filter((chapter) => chapter.count);
    const shelf = emptyChapters.length
      ? `<div class="material-drop-shelf">
          <span class="material-drop-shelf-label">拖到章节</span>
          ${emptyChapters
            .map(
              (chapter) => `<div class="material-drop-chip" data-material-drop="${esc(chapter.name)}">
                <b>${esc(chapter.name)}</b><span>拖入</span>
              </div>`,
            )
            .join("")}
        </div>`
      : "";
    host.innerHTML =
      shelf +
      filledChapters
        .map(
          (chapter) => `<div class="material-group" data-material-drop="${esc(chapter.name)}">
          <div class="material-group-head">
            <b>${esc(chapter.name)}</b>
            <span>${chapter.count} 张</span>
            <span class="material-group-tag mini-tag">${
              chapter.name === "未分章" ? "未匹配章节 · 可拖入上方章节" : "拖入或拖出可调整"
            }</span>
          </div>
          <div class="material-grid">
            ${chapter.items
              .map(
                (item) => `<figure class="material-item" draggable="true" data-material-id="${esc(item.id)}" title="拖到其他章节即可移动">
                  <img src="${esc(item.src)}" alt="${esc(item.name)}" loading="lazy" />
                  <figcaption title="${esc(item.name)}">${esc(item.name)}</figcaption>
                  <div class="material-item-actions">
                    <select data-material-chapter="${esc(item.id)}" aria-label="所属章节">${materialChapterOptions(item.chapter)}</select>
                    <button type="button" data-material-delete="${esc(item.id)}">删除</button>
                  </div>
                </figure>`,
              )
              .join("")}
          </div>
        </div>`,
        )
        .join("");
  }
  const sceneHost = $("#materialSceneMap");
  if (sceneHost) {
    const scenes = state.motion?.scenes || [];
    const current = previewScene();
    if (!current) {
      sceneHost.innerHTML = `<div class="material-empty">还没有分镜，更新分镜后会显示每一幕的排版预览。</div>`;
    } else {
      const material = current.photoSource === "material" && current.layout !== "closing";
      const draft = state.previewDraft && state.previewDraft.sceneId === current.id ? state.previewDraft.style : null;
      const canNetwork = Boolean(current.canRestoreNetwork || current.materialName || current.photoSource === "material");
      const sourceDetail = current.materialName
        ? `${current.chapter && current.chapter !== "未分章" ? `${current.chapter} · ` : ""}${current.materialName}`
        : current.photoKey
          ? `网络图 · ${current.photoKey}`
          : "内置版式";
      const restore = canNetwork
        ? `<button type="button" class="scene-photo-restore" data-scene-photo="${esc(current.id)}" data-photo-source="network">换回网络图</button>`
        : current.canRestoreMaterial
          ? `<button type="button" class="scene-photo-restore" data-scene-photo="${esc(current.id)}" data-photo-source="material">用回素材图</button>`
          : "";
      const layoutButton = material
        ? `<button type="button" class="scene-layout-btn${state.layoutSceneId === current.id ? " active" : ""}" data-scene-layout="${esc(current.id)}">${state.layoutSceneId === current.id ? "收起布局" : "调整布局"}</button>`
        : "";
      const items = scenes
        .map((scene) => {
          const photo = basename(scene.photo);
          const thumb = photo
            ? `<img src="/media/photos/${encodeURIComponent(photo)}" alt="" loading="lazy" />`
            : `<div class="mp-noimg">${esc(scene.layout || "无图")}</div>`;
          const badge = scene.layout === "closing" ? "收尾" : scene.photoSource === "material" ? "素材" : "网络";
          return `<button type="button" class="mp-item${scene.id === current.id ? " active" : ""}" data-scene-select="${esc(scene.id)}">
            ${thumb}
            <span class="mp-item-copy"><b>${esc(scene.kicker || "")} ${esc(scene.barTitle || scene.title || "")}</b><span>${esc(previewSceneSource(scene))}</span></span>
            <span class="mp-item-tag${scene.photoSource === "material" ? " material" : ""}">${badge}</span>
          </button>`;
        })
        .join("");
      sceneHost.innerHTML = `<div class="mp-stage-wrap">
          <div class="mp-stage" id="mpStage">${previewCanvasMarkup(current, draft)}</div>
          <div class="mp-meta">
            <span class="mp-badge${material ? "" : " muted"}">${material ? "素材排版" : "成片内置版式 · 近似预览"}</span>
            <b>${esc(current.kicker || "")} ${esc(current.barTitle || current.title || "")}</b>
            <span title="${esc(sourceDetail)}">${esc(sourceDetail)}</span>
          </div>
          <div class="mp-actions">${restore}${layoutButton}</div>
        </div>
        <div class="mp-list" role="list">${items}</div>`;
      window.requestAnimationFrame(fitMaterialPreview);
    }
  }
  renderInputOverview();
  renderSceneLayoutEditor();
}

const SCENE_LAYOUT_DEFAULT_STYLE = {
  full: { photoScale: 1, photoX: 50, photoY: 42, contentX: 0, contentY: 75, contentAlign: "left" },
  top: { photoScale: 1, photoX: 50, photoY: 42, contentX: 0, contentY: 0, contentAlign: "left" },
  left: { photoScale: 1, photoX: 50, photoY: 42, contentX: 0, contentY: 0, contentAlign: "left" },
};

function normalizeSceneLayoutClient(raw, preset) {
  const p = raw?.preset === "top" || raw?.preset === "left" ? raw.preset : preset || "full";
  const base = SCENE_LAYOUT_DEFAULT_STYLE[p];
  const num = (value, min, max, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    preset: p,
    photoScale: Math.round(num(raw?.photoScale, 1, 1.8, base.photoScale) * 100) / 100,
    photoX: Math.round(num(raw?.photoX, 0, 100, base.photoX)),
    photoY: Math.round(num(raw?.photoY, 0, 100, base.photoY)),
    contentX: Math.round(num(raw?.contentX, 0, 100, base.contentX)),
    contentY: Math.round(num(raw?.contentY, 0, 100, base.contentY)),
    contentAlign: ["left", "center", "right"].includes(raw?.contentAlign) ? raw.contentAlign : base.contentAlign,
  };
}

function currentLayoutStyleFromEditor() {
  const host = $("#sceneLayoutEditor");
  if (!host) return normalizeSceneLayoutClient({});
  const preset = host.querySelector("[data-layout-preset].active")?.dataset.layoutPreset || "full";
  const value = (field) => Number(host.querySelector(`[data-layout-field="${field}"]`)?.value);
  const align = host.querySelector("[data-layout-align].active")?.dataset.layoutAlign || "left";
  return normalizeSceneLayoutClient(
    {
      preset,
      photoScale: value("photoScale") / 100,
      photoX: value("photoX"),
      photoY: value("photoY"),
      contentX: value("contentX"),
      contentY: value("contentY"),
      contentAlign: align,
    },
    preset,
  );
}

function sceneLayoutRange(field, label, min, max, value, suffix = "") {
  return `<label class="sle-field">
    <span>${label}<output data-layout-output="${field}">${value}${suffix}</output></span>
    <input type="range" min="${min}" max="${max}" step="1" value="${value}" data-layout-field="${field}" />
  </label>`;
}

function renderSceneLayoutEditor() {
  const host = $("#sceneLayoutEditor");
  if (!host) return;
  const scenes = state.motion?.scenes || [];
  const index = scenes.findIndex((scene) => scene.id === state.layoutSceneId);
  if (index < 0) {
    host.classList.add("hidden");
    host.innerHTML = "";
    return;
  }
  const scene = scenes[index];
  const style = normalizeSceneLayoutClient(scene.layoutStyle);
  const presets = [
    ["full", "满屏"],
    ["top", "上图下文"],
    ["left", "左图右文"],
  ];
  const alignments = [
    ["left", "左对齐"],
    ["center", "居中"],
    ["right", "右对齐"],
  ];
  const title =
    scene.chapter && scene.chapter !== "未分章"
      ? scene.chapter
      : scene.barTitle || scene.title || `第 ${index + 1} 幕`;
  host.classList.remove("hidden");
  host.innerHTML = `
    <div class="sle-head">
      <div>
        <b>调整布局 · ${esc(title)}</b>
        <span>${scene.chapter && scene.chapter !== "未分章" ? "本章分镜共用这套布局" : "当前这一幕单独保存"}</span>
      </div>
      <button type="button" class="btn tiny ghost" data-layout-close>收起</button>
    </div>
    <div class="sle-presets">
      ${presets
        .map(
          ([id, label]) =>
            `<button type="button" data-layout-preset="${id}" class="${style.preset === id ? "active" : ""}">${label}</button>`,
        )
        .join("")}
    </div>
    <div class="sle-fields">
      ${sceneLayoutRange("photoScale", "图片大小", 100, 180, Math.round(style.photoScale * 100), "%")}
      ${sceneLayoutRange("photoX", "图片左右", 0, 100, style.photoX)}
      ${sceneLayoutRange("photoY", "图片上下", 0, 100, style.photoY)}
      ${sceneLayoutRange("contentX", "内容左右", 0, 100, style.contentX)}
      ${sceneLayoutRange("contentY", "内容上下", 0, 100, style.contentY)}
    </div>
    <div class="sle-align">
      <span>内容对齐</span>
      ${alignments
        .map(
          ([id, label]) =>
            `<button type="button" data-layout-align="${id}" class="${style.contentAlign === id ? "active" : ""}">${label}</button>`,
        )
        .join("")}
    </div>
    <div class="sle-actions">
      <button type="button" class="btn tiny ghost" data-layout-reset>恢复默认</button>
      <button type="button" class="btn tiny" data-layout-preview>预览本章</button>
    </div>
    <div class="sle-preview" id="sceneLayoutPreview"></div>`;
}

async function saveSceneLayout(scene) {
  if (!scene) return;
  const style = currentLayoutStyleFromEditor();
  try {
    const data = await api("/api/scene/layout", {
      method: "POST",
      body: JSON.stringify({ sceneId: scene.id, layoutStyle: style }),
    });
    if (data.motion) state.motion = data.motion;
    scene.layoutStyle = data.layoutStyle || style;
    state.previewDraft = null;
    if (state.layoutSceneId === scene.id) rememberPreviewScene(scene.id);
    renderMaterials();
    const status = $("#sceneLayoutEditor .sle-status");
    if (status) status.textContent = "已保存";
    toast("布局已应用，预览和成片都会使用这套设置", "ok");
  } catch (err) {
    toast(err.message || "布局保存失败", "error");
  }
}

async function previewSceneLayout(scene) {
  const host = $("#sceneLayoutPreview");
  if (!host || !scene) return;
  const scenes = state.motion?.scenes || [];
  const index = scenes.findIndex((item) => item.id === scene.id);
  host.innerHTML = `<span class="muted small">正在渲染本章预览…</span>`;
  try {
    const data = await api("/api/motion/preview", {
      method: "POST",
      body: JSON.stringify({ sceneIndex: index }),
    });
    const stamp = Date.now();
    host.innerHTML = (data.urls || [])
      .map(
        (url, i) =>
          `<figure><img src="${url}?t=${stamp}" alt="布局预览" /><figcaption>${["开场", "中段", "收尾"][i] || i + 1}</figcaption></figure>`,
      )
      .join("");
  } catch (err) {
    host.innerHTML = `<span class="muted small">${esc(err.message || "预览失败")}</span>`;
  }
}

async function uploadMaterials(files) {
  if (!files?.length || state.materialBusy) return;
  state.materialBusy = true;
  let last = null;
  let uploaded = 0;
  const assigned = new Set();
  try {
    for (const file of files) {
      const res = await fetch(U("/api/materials/upload"), {
        method: "POST",
        headers: { "x-file-name": encodeURIComponent(file.name) },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${file.name} 上传失败`);
      last = data;
      uploaded += 1;
      if (data.item?.chapter && data.item.chapter !== "未分章") assigned.add(data.item.chapter);
    }
    if (last) state.materials = last;
    renderMaterials();
    const autoNote = assigned.size ? `，${assigned.size} 个章节已自动归类` : "";
    toast(`已上传 ${uploaded} 张素材${autoNote}${state.autoPrep ? "，正在重新分镜…" : ""}`, "ok");
    if (state.autoPrep) {
      await requestStoryboardPrep({ force: true, reason: "素材更新" });
    } else {
      await refreshStoryboardMeta();
    }
  } catch (err) {
    toast(err.message || "素材上传失败", "error");
  } finally {
    state.materialBusy = false;
    $("#materialFiles").value = "";
  }
}

async function updateMaterialChapter(id, chapter) {
  const current = state.materials?.items?.find((item) => item.id === id || item.key === id);
  if (current?.chapter === chapter) return;
  try {
    const data = await api("/api/materials/update", {
      method: "POST",
      body: JSON.stringify({ id, chapter }),
    });
    state.materials = data;
    renderMaterials();
    toast(`已移到「${chapter || "未分章"}」`, "ok");
    if (state.autoPrep) await requestStoryboardPrep({ force: true, reason: "素材章节调整" });
    else await refreshStoryboardMeta();
  } catch (err) {
    toast(err.message || "修改章节失败", "error");
    renderMaterials();
  }
}

function clearMaterialDropHighlight() {
  document.querySelectorAll("[data-material-drop].drop-target").forEach((group) => group.classList.remove("drop-target"));
}

function materialDragStart(event) {
  const item = event.target.closest(".material-item");
  if (!item || state.materialBusy) return;
  if (event.target.closest("select, button")) {
    event.preventDefault();
    return;
  }
  const id = item.dataset.materialId || "";
  if (!id || !event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", id);
  item.classList.add("dragging");
}

function materialDragOver(event) {
  const group = event.target.closest("[data-material-drop]");
  if (!group) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  if (!group.classList.contains("drop-target")) {
    clearMaterialDropHighlight();
    group.classList.add("drop-target");
  }
}

function materialDragLeave(event) {
  const group = event.target.closest("[data-material-drop]");
  if (!group || group.contains(event.relatedTarget)) return;
  group.classList.remove("drop-target");
}

function materialDrop(event) {
  const group = event.target.closest("[data-material-drop]");
  if (!group) return;
  event.preventDefault();
  const id = event.dataTransfer?.getData("text/plain") || "";
  const chapter = group.dataset.materialDrop || "未分章";
  clearMaterialDropHighlight();
  document.querySelectorAll(".material-item.dragging").forEach((item) => item.classList.remove("dragging"));
  if (!id) return;
  void updateMaterialChapter(id, chapter);
}

async function restoreSceneNetwork(sceneId, source = "network") {
  try {
    const data = await api("/api/scene/photo", {
      method: "POST",
      body: JSON.stringify({ sceneId, source }),
    });
    if (data.motion) state.motion = data.motion;
    renderMaterials();
    renderMotionLab();
    toast(source === "network" ? "已换回网络配图" : "已用回素材图", "ok");
    await refreshStoryboardMeta();
  } catch (err) {
    toast(err.message || "切换配图失败", "error");
  }
}

async function deleteMaterial(id) {
  if (!window.confirm("删除这张素材？已生成的成片不会受影响。")) return;
  try {
    const data = await api("/api/materials/delete", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
    state.materials = data;
    renderMaterials();
    if (state.autoPrep) await requestStoryboardPrep({ force: true, reason: "素材删除" });
    else await refreshStoryboardMeta();
    toast("已删除素材", "ok");
  } catch (err) {
    toast(err.message || "删除失败", "error");
  }
}

function renderAiConfig() {
  const ai = state.config.ai || {};
  $("#aiEnabled").checked = ai.enabled === true;
  $("#aiBaseUrl").value = ai.baseUrl || "https://api.openai.com/v1";
  $("#aiModel").value = ai.model || "gpt-4o-mini";
  $("#aiApiKey").value = ai.apiKey || "";
  $("#aiKeyEnv").value = ai.keyEnv || "OPENAI_API_KEY";
  const temp = Number(ai.temperature ?? 0.4);
  $("#aiTemperature").value = String(temp);
  $("#aiTemperatureValue").textContent = temp.toFixed(2);
  const planner = state.render?.planner || "";
  $("#aiState").textContent = ai.enabled
    ? `已启用 · ${ai.model || "默认模型"}`
    : planner.startsWith("ai:")
      ? `上次由 ${planner.slice(3)} 生成`
      : "未启用（走规则版）";
}

function renderAll() {
  $("#scriptInput").value = state.script;
  renderEnv();
  renderProviders();
  setRangeLabels();
  renderStyleGrid();
  renderAiConfig();
  renderScriptStats();
  renderInputOverview();
  renderMaterials();
  renderStoryboardStatus();
  renderMotionLab();
}

function payload() {
  const ui = {
    ...currentUi(),
    layout: normalizeLayout(uiLayout()),
    digitalHuman: normalizeDigitalHuman(uiDigitalHuman()),
  };
  const provider = state.config.provider;
  const voice = provider === "edge" ? "" : $("#voiceSelect").value;
  return {
    provider,
    voice,
    gapSeconds: Number(ui.gap),
    ui,
    ai: { ...(state.config.ai || {}) },
    kaggle: { ...state.config.kaggle },
    cosyvoice: { ...state.config.cosyvoice },
    voicestudio: { ...state.config.voicestudio },
    local3: { ...state.config.local3 },
    indextts: { ...state.config.indextts },
    edge: { ...state.config.edge },
  };
}

async function saveAll(quiet = false, autoPrepare = true) {
  if (!state.online) {
    toast("服务未连接，无法保存", "error");
    return false;
  }
  const previousScript = state.savedScript;
  try {
    const [saved] = await Promise.all([
      api("/api/config", { method: "POST", body: JSON.stringify(payload()) }),
      api("/api/script", { method: "POST", body: JSON.stringify({ script: state.script }) }),
      api("/api/series", {
        method: "POST",
        body: JSON.stringify({ title: state.series?.title || "", tagline: state.series?.tagline || "" }),
      }),
    ]);
    if (saved?.ui) state.config.ui = { ...state.config.ui, ...saved.ui };
    if (saved?.ai) state.config.ai = { ...state.config.ai, ...saved.ai };
    setDirty(false);
    if (!quiet) toast("配置与文案已保存", "ok");
    renderScriptStats();
    const scriptChanged = previousScript !== state.script;
    state.savedScript = state.script;
    if (scriptChanged && autoPrepare) {
      if (state.autoPrep && !state.runActive) {
        await requestStoryboardPrep({ force: true, reason: "文案更新" });
      } else {
        await refreshStoryboardMeta();
      }
    }
    return true;
  } catch (err) {
    toast(err.message, "error");
    return false;
  }
}

async function startRun(options = {}) {
  if (!state.online) {
    toast("服务未连接，先运行 node server.mjs", "error");
    return;
  }
  if (state.runActive) {
    toast("已有任务在运行", "error");
    return;
  }
  if (state.prep?.state === "running") {
    toast("分镜正在编排，完成后再开始生成", "error");
    return;
  }
  try {
    const body = {
      script: state.script,
      config: payload(),
      seriesTitle: state.series?.title || "",
      seriesTagline: state.series?.tagline || "",
    };
    if (options.fromScratch) {
      body.resume = false;
      body.forceStoryboard = true;
      body.forceAll = true;
    } else {
      body.resume = true;
      body.forceStoryboard = false;
    }
    const res = await api("/api/run", {
      method: "POST",
      body: JSON.stringify(body),
    });
    state.runActive = true;
    state.follow = true;
    state.savedScript = state.script;
    setDirty(false);
    state.logs = [];
    state.logsRunId = null;
    state.logSource = "entries";
    $("#logView").innerHTML = `<span class="log-empty">任务已创建，等待日志……</span>`;
    switchTab("run");
    const reused = Array.isArray(res.reusedStages) ? res.reusedStages : [];
    const labels = reused.map((id) => (id === 1 ? "分镜" : id === 2 ? "配音" : id === 3 ? "数字人" : `阶段${id}`));
    toast(
      labels.length ? `已开始：${res.id}，复用${labels.join("、")}` : `已开始：${res.id}`,
      "ok",
    );
    refreshStoryboardMeta();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function cancelRun() {
  if (!state.runActive) return;
  try {
    await api("/api/run/cancel", { method: "POST" });
    toast("已请求取消", "ok");
  } catch (err) {
    toast(err.message, "error");
  }
}

function stageStateText(stage, job) {
  if (stage.status === "done") return stage.reused ? "复用上次结果" : "完成";
  if (stage.status === "running") return job?.note || "执行中";
  if (stage.status === "error") return "中断";
  if (stage.status === "canceled") return "已取消";
  return "等待";
}

function buildStageGrid() {
  $("#stageGrid").innerHTML = STAGES.map(
    (s) => `<div class="stage" data-stage="${s.id}">
      <div class="stage-num">STAGE 0${s.id}</div>
      <div class="stage-name">${esc(s.name)}</div>
      <div class="stage-sub">${esc(s.sub)}</div>
    </div>`
  ).join("");
}

function renderStageGrid(job) {
  const list = job?.stages || [];
  for (const def of STAGES) {
    const el = $(`.stage[data-stage="${def.id}"]`);
    if (!el) continue;
    const found = list.find((s) => s.id === def.id);
    const stage = found || { status: "queued", progress: 0 };
    el.className = `stage ${stage.status || "queued"}`;
    el.querySelector(".stage-sub").textContent = found ? stageStateText(stage, job) : job ? "未启用" : "等待";
    const pct = stage.status === "done" ? 100 : Math.round((stage.progress || 0) * 100);
    el.style.setProperty("--p", `${pct}%`);
  }
}

function updateRunButtons() {
  $("#runBtn").disabled = state.runActive;
  $("#cancelBtn").classList.toggle("hidden", !state.runActive);
  syncVoiceControls();
  const dot = $("#railDot");
  const status = state.job?.status;
  dot.className = `status-dot ${state.runActive ? "running" : status === "done" ? "done" : status === "error" ? "error" : ""}`;
  $("#railStatus").textContent = state.runActive ? "运行中" : status ? STATUS_TEXT[status] || "空闲" : "空闲";
  const stage = state.job?.stages?.find((s) => s.status === "running");
  $("#railStage").textContent = state.runActive ? (stage ? stage.name : state.job?.note || "准备中") : status === "done" ? "成片已就绪" : status === "error" ? "任务失败" : "等待开始";
  renderStoryboardStatus();
}

function applyJob(job) {
  state.job = job;
  if (!job) {
    resetRunUI();
    updateRunButtons();
    return;
  }

  $("#runTitle").textContent = `运行 ${job.id}`;
  const note =
    job.status === "running"
      ? job.note || "执行中"
      : job.status === "done"
        ? "全部阶段完成，可在右侧播放成片。"
        : job.status === "error"
          ? `失败：${job.error || "未知错误"}`
          : job.status === "canceled"
            ? "任务已取消。"
            : "等待开始。";
  $("#runNote").textContent = note;
  $("#runStatus").textContent = STATUS_TEXT[job.status] || "空闲";

  const pct = Math.round((job.progress || 0) * 100);
  $("#runBar").style.width = `${pct}%`;
  $("#runBar").classList.toggle("running", job.status === "running");
  $("#runPct").textContent = `${pct}%`;
  $("#railBar").style.width = `${pct}%`;
  $("#railBar").classList.toggle("running", job.status === "running");

  renderStageGrid(job);
  renderRunMeta();

  const hasVideo = job.status === "done" && job.finalVideo;
  if (hasVideo && state.renderFor !== job.id) {
    state.renderFor = job.id;
    refreshRenderSummary();
    refreshMotionPanel();
  }
  const video = $("#resultVideo");
  if (hasVideo) {
    const src = U(`/media/run/${job.id}/final.mp4`);
    if (video.getAttribute("src") !== src) video.setAttribute("src", src);
    video.classList.remove("hidden");
    $("#resultEmpty").classList.add("hidden");
    $("#downloadVideo").classList.remove("hidden");
    $("#downloadVideo").setAttribute("href", `${src}?download=1`);
    $("#downloadVideo").setAttribute("download", `${job.id}.mp4`);
    $("#resultTag").textContent = fmtDur(job.duration);
    $("#resultMeta").textContent = `时长 ${fmtDur(job.duration)} · 大小 ${fmtSize(job.size)} · 1080×1920 · 30fps`;
  } else {
    if (!video.paused) video.pause();
    video.removeAttribute("src");
    video.load();
    video.classList.add("hidden");
    $("#resultEmpty").classList.remove("hidden");
    $("#downloadVideo").classList.add("hidden");
    $("#resultTag").textContent = job.status === "running" ? "渲染中" : "—";
    $("#resultMeta").textContent = job.status === "error" ? job.error || "" : "";
  }

  $("#logDownload").setAttribute("href", U(`/api/runs/${job.id}/log`));
  $("#logDownload").setAttribute("download", `${job.id}.log`);
  $("#openFolder").disabled = false;

  updateRunButtons();
}

function renderRunMeta() {
  const job = state.job;
  $("#runProvider").textContent = providerLabel(job?.provider);
  $("#runStyle").textContent = job?.styleId ? styleName(job.styleId) : "—";
  $("#runDuration").textContent = fmtDur(job?.duration);
  $("#runSize").textContent = fmtSize(job?.size);
}

function resetRunUI() {
  $("#runTitle").textContent = "尚未开始";
  $("#runNote").textContent = "在文案、配音、画面配置好后开始生成。";
  $("#runStatus").textContent = "空闲";
  $("#runBar").style.width = "0%";
  $("#runPct").textContent = "0%";
  $("#railBar").style.width = "0%";
  $("#railStatus").textContent = "空闲";
  $("#railStage").textContent = "等待开始";
  renderStageGrid(null);
  renderRunMeta();
  const video = $("#resultVideo");
  if (!video.paused) video.pause();
  video.removeAttribute("src");
  video.load();
  video.classList.add("hidden");
  $("#resultEmpty").classList.remove("hidden");
  $("#downloadVideo").classList.add("hidden");
  $("#resultTag").textContent = "—";
  $("#resultMeta").textContent = "";
  $("#logDownload").removeAttribute("href");
  $("#openFolder").disabled = true;
}

function levelOf(line) {
  if (/(error|错误|失败|traceback|exception|cannot|not found)/i.test(line)) return "error";
  if (/(warn|警告|deprecated|clipping)/i.test(line)) return "warn";
  return "info";
}

function logMatches(entry) {
  if (state.logFilter !== "all" && entry.level !== state.logFilter) return false;
  if (state.logSearch && !entry.line.toLowerCase().includes(state.logSearch)) return false;
  return true;
}

function logNode(entry) {
  const span = document.createElement("span");
  span.className = `ln ${entry.level}`;
  const ts = document.createElement("span");
  ts.className = "ts";
  ts.textContent = entry.time ?? fmtClock(entry.t);
  const st = document.createElement("span");
  st.className = "st";
  st.textContent = entry.stageName || "系统";
  span.appendChild(ts);
  span.appendChild(st);
  span.appendChild(document.createTextNode(entry.line));
  return span;
}

function renderLogs() {
  const view = $("#logView");
  if (state.logSource !== "entries") return;
  view.innerHTML = "";
  const list = state.logs.filter(logMatches);
  if (!list.length) {
    view.innerHTML = `<span class="log-empty">${state.logs.length ? "没有匹配的日志。" : "等待任务开始……"}</span>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const entry of list) frag.appendChild(logNode(entry));
  view.appendChild(frag);
  if ($("#autoScroll").checked) view.scrollTop = view.scrollHeight;
}

function appendLog(entry) {
  state.logs.push(entry);
  if (state.logs.length > 3000) state.logs.splice(0, state.logs.length - 3000);
  const simple = state.logFilter === "all" && !state.logSearch;
  const view = $("#logView");
  if (!simple) {
    renderLogs();
    return;
  }
  const empty = view.querySelector(".log-empty");
  if (empty) empty.remove();
  view.appendChild(logNode(entry));
  if ($("#autoScroll").checked) view.scrollTop = view.scrollHeight;
}

function appendLogs(entries) {
  for (const entry of entries) {
    state.logs.push(entry);
  }
  if (state.logs.length > 3000) state.logs.splice(0, state.logs.length - 3000);
  renderLogs();
}

function renderRawLog(text) {
  state.logSource = "raw";
  const view = $("#logView");
  view.innerHTML = "";
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) {
    view.innerHTML = `<span class="log-empty">该任务没有日志。</span>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const line of lines) {
    const span = document.createElement("span");
    span.className = `ln ${levelOf(line)}`;
    span.textContent = line;
    frag.appendChild(span);
  }
  view.appendChild(frag);
  view.scrollTop = view.scrollHeight;
}

function connectEvents() {
  const es = new EventSource(U("/api/events"));
  const live = $("#liveDot");

  es.addEventListener("open", () => live.classList.add("on"));
  es.addEventListener("error", () => live.classList.remove("on"));

  es.addEventListener("snapshot", (event) => {
    const data = JSON.parse(event.data);
    state.runActive = Boolean(data.running);
    if (data.prep) applyPrepState(data.prep);
    if (state.follow) {
      if (data.job) {
        state.logs = [];
        state.logsRunId = data.job.id;
        state.logSource = "entries";
        applyJob(data.job);
        appendLogs(data.logs || []);
      } else {
        state.job = null;
        resetRunUI();
      }
    } else {
      updateRunButtons();
    }
  });

  es.addEventListener("state", (event) => {
    const job = JSON.parse(event.data);
    state.runActive = job?.status === "running";
    if (state.follow && job) {
      if (state.logsRunId !== job.id) {
        state.logs = [];
        state.logsRunId = job.id;
        state.logSource = "entries";
        renderLogs();
      }
      applyJob(job);
    } else {
      updateRunButtons();
    }
  });

  es.addEventListener("log", (event) => {
    const entry = JSON.parse(event.data);
    entry.stageName = STAGE_NAMES[entry.stage] || "系统";
    if (!state.follow) return;
    if (state.logSource !== "entries") {
      state.logSource = "entries";
      state.logs = [];
    }
    appendLog(entry);
  });

  es.addEventListener("prep", (event) => {
    const data = JSON.parse(event.data);
    applyPrepState(data);
  });
}

async function loadHistory() {
  const box = $("#historyList");
  if (!state.online) {
    box.innerHTML = `<div class="history-empty">本地控制台服务未连接，历史记录不可用。</div>`;
    return;
  }
  box.innerHTML = `<div class="history-empty">加载中……</div>`;
  try {
    const { runs } = await api("/api/runs");
    if (!runs.length) {
      box.innerHTML = `<div class="history-empty">还没有运行记录。完成一次生成后会出现在这里。</div>`;
      return;
    }
    box.innerHTML = runs
      .map((run) => {
        const status = run.status || "done";
        const hasVideo = status === "done" && run.size;
        return `<div class="history-card ${status}" data-id="${esc(run.id)}">
          <span class="accent-bar"></span>
          <div class="history-main">
            <div class="history-title">
              <b>${esc(run.id)}</b>
              <span class="status ${status}">${esc(STATUS_TEXT[status] || status)}</span>
              <span class="mini-tag">${esc(providerLabel(run.provider))}</span>
              <span class="mini-tag">${esc(styleName(run.styleId))}</span>
            </div>
            <div class="history-sub">${esc(run.scriptPreview || run.error || "（无文案预览）")}</div>
            <div class="history-meta">
              <span>${fmtDate(run.startedAt)}</span>
              <span>${fmtDur(run.duration)}</span>
              <span>${fmtSize(run.size)}</span>
            </div>
          </div>
          <div class="history-actions">
            ${hasVideo ? `<button class="btn tiny" data-act="play" type="button">播放</button>` : ""}
            <button class="btn tiny ghost" data-act="apply" type="button">载入配置</button>
            <button class="btn tiny ghost" data-act="reveal" type="button">文件夹</button>
            ${hasVideo ? `<a class="btn tiny ghost" href="${U(`/media/run/${esc(run.id)}/final.mp4?download=1`)}" download="${esc(run.id)}.mp4">下载</a>` : ""}
            <button class="btn tiny danger" data-act="del" type="button">删除</button>
          </div>
        </div>`;
      })
      .join("");
  } catch (err) {
    box.innerHTML = `<div class="history-error">${esc(err.message)}</div>`;
  }
}

async function openRun(id) {
  try {
    const data = await api(`/api/runs/${id}`);
    state.follow = false;
    applyJob(data.job);
    switchTab("run");
    $("#logDownload").setAttribute("href", U(`/api/runs/${id}/log`));
    $("#logDownload").setAttribute("download", `${id}.log`);
    try {
      const res = await fetch(U(`/api/runs/${id}/log`));
      renderRawLog(res.ok ? await res.text() : "");
    } catch {
      renderRawLog("");
    }
  } catch (err) {
    toast(err.message, "error");
  }
}

async function applyRunConfig(id) {
  try {
    const data = await api(`/api/runs/${id}`);
    const tts = data.config?.tts || {};
    const ui = data.config?.ui || {};
    if (tts.provider) state.config.provider = tts.provider;
    for (const key of ["kaggle", "cosyvoice", "indextts", "edge"]) {
      if (tts[key]) state.config[key] = { ...state.config[key], ...tts[key] };
    }
    state.config.ui = { ...currentUi(), ...ui };
    if (typeof data.script === "string" && data.script.trim()) state.script = data.script.trimEnd();
    renderAll();
    markDirty();
    switchTab("script");
    toast("已载入该次运行的配置，记得保存", "ok");
  } catch (err) {
    toast(err.message, "error");
  }
}

async function deleteRun(id) {
  if (!window.confirm(`删除运行 ${id}？该目录下的成片与日志会被永久移除。`)) return;
  try {
    await api(`/api/runs/${id}`, { method: "DELETE" });
    if (state.job?.id === id) {
      state.job = null;
      resetRunUI();
      updateRunButtons();
    }
    toast("已删除", "ok");
    loadHistory();
  } catch (err) {
    toast(err.message, "error");
  }
}

const RANGE_FMT = {
  speed: (v) => v.toFixed(2) + "×",
  speakRate: (v) => v.toFixed(2) + "×",
  targetCps: (v) => v.toFixed(2) + " 字/秒",
  maxChars: (v) => Math.round(v) + " 字",
  chunkChars: (v) => Math.round(v) + " 字",
  pagePauseSeconds: (v) => v.toFixed(2) + " 秒",
  masterGainDb: (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB",
};

function bind() {
  $("#nav").addEventListener("click", (event) => {
    const btn = event.target.closest(".nav-item");
    if (btn) switchTab(btn.dataset.tab);
  });
  $$("[data-tab]").forEach((el) => {
    if (el.classList.contains("nav-item")) return;
    el.addEventListener("click", () => switchTab(el.dataset.tab));
  });

  $("#scriptInput").addEventListener("input", (event) => {
    state.script = event.target.value;
    renderScriptStats();
    markDirty();
  });

  $("#importScript").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.script = String(reader.result || "").trimEnd();
      $("#scriptInput").value = state.script;
      renderScriptStats();
      markDirty();
      toast(`已导入 ${file.name}`, "ok");
    };
    reader.readAsText(file, "utf-8");
    event.target.value = "";
  });

  $("#templateBtn").addEventListener("click", () => {
    state.script = DEFAULT_SCRIPT;
    $("#scriptInput").value = state.script;
    renderScriptStats();
    markDirty();
  });

  $("#scriptSaveBtn").addEventListener("click", () => saveAll());

  $("#seriesTitle").addEventListener("input", (event) => {
    state.series.title = event.target.value;
    markDirty();
  });
  $("#seriesTagline").addEventListener("input", (event) => {
    state.series.tagline = event.target.value;
    markDirty();
  });

  $("#inputAvatarSelect").addEventListener("change", async (event) => {
    const src = event.target.value;
    const layout = uiLayout();
    if (!src) {
      layout.mode = "none";
    } else {
      layout.avatar.src = src;
      layout.mode = /\.(mp4|webm|mov)$/i.test(src) ? "video" : "image";
      const dh = uiDigitalHuman();
      if (dh.enabled || !dh.reference) dh.reference = src;
      await probeAvatarAspect(src);
    }
    renderLayoutPanel();
    renderInputOverview();
    markDirty();
  });

  $("#inputVoiceSelect").addEventListener("change", (event) => {
    const name = event.target.value;
    const provider = state.config.provider;
    if (!name || provider === "edge") return;
    const key = provider === "kaggle" || provider === "indextts" ? "promptWav" : "refWav";
    state.config[provider] = { ...(state.config[provider] || {}), [key]: name };
    $("#voiceSelect").value = name;
    updateVoiceMeta(name);
    markDirty();
  });

  $("#saveBtn").addEventListener("click", () => saveAll());
  $("#runBtn").addEventListener("click", () => startRun());
  $("#cancelBtn").addEventListener("click", cancelRun);

  $("#providerGrid").addEventListener("click", (event) => {
    const card = event.target.closest(".provider-card");
    if (!card) return;
    state.config.provider = card.dataset.provider;
    if (state.config.provider === "edge" && state.trim) discardTrim();
    renderProviders();
    renderScriptStats();
    markDirty();
  });

  $("#advancedFields").addEventListener("input", (event) => {
    const el = event.target.closest("[data-k]");
    if (!el) return;
    const config = state.config[state.config.provider];
    const key = el.dataset.k;
    if (el.dataset.t === "check") config[key] = el.checked;
    else if (el.dataset.t === "range") {
      config[key] = Number(el.value);
      const out = el.closest(".range-field")?.querySelector("[data-out]");
      const fmt = RANGE_FMT[key] || ((v) => v.toFixed(2));
      if (out) out.textContent = fmt(Number(el.value));
    } else config[key] = el.value;
    markDirty();
  });

  $("#advancedFields").addEventListener("change", (event) => {
    const el = event.target.closest("[data-k]");
    if (!el) return;
    const config = state.config[state.config.provider];
    if (el.dataset.t === "select") config[el.dataset.k] = el.value;
    if (el.dataset.t === "check") config[el.dataset.k] = el.checked;
    if (el.dataset.k === "singlePass") renderAdvanced();
    markDirty();
  });

  $("#voiceSelect").addEventListener("change", (event) => {
    if (state.trim) discardTrim();
    updateVoiceMeta(event.target.value);
    syncVoiceControls();
    markDirty();
  });

  $("#playVoice").addEventListener("click", () => {
    const name = $("#voiceSelect").value;
    if (!name) return;
    const audio = $("#voiceAudio");
    audio.dataset.mode = "full";
    audio.src = U(`/media/voice/${encodeURIComponent(name)}`);
    audio.currentTime = 0;
    audio.play().catch(() => toast("无法播放该音频", "error"));
  });

  $("#uploadVoice").addEventListener("click", () => {
    if (state.runActive) {
      toast("任务运行中，暂不能替换音色", "error");
      return;
    }
    $("#voiceFile").click();
  });

  $("#voiceFile").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadVoice(file);
  });

  $("#trimStart").addEventListener("input", updateTrimUI);
  $("#trimLength").addEventListener("input", updateTrimUI);
  $("#trimPreview").addEventListener("click", previewTrim);
  $("#trimSave").addEventListener("click", saveTrim);
  $("#trimCancel").addEventListener("click", () => discardTrim(false));

  $("#voiceAudio").addEventListener("timeupdate", () => {
    const trim = state.trim;
    const audio = $("#voiceAudio");
    if (!trim || audio.dataset.mode !== "trim") return;
    if (audio.currentTime >= trim.start + trim.length - 0.03) {
      audio.pause();
      audio.dataset.mode = "";
    }
  });

  const gapInput = $("#gapInput");
  gapInput.addEventListener("input", () => {
    currentUi().gap = Number(gapInput.value);
    $("#gapValue").textContent = `${Number(gapInput.value).toFixed(2)}s`;
    renderScriptStats();
    markDirty();
  });

  const leadInput = $("#leadInput");
  leadInput.addEventListener("input", () => {
    currentUi().leadIn = Number(leadInput.value);
    $("#leadValue").textContent = `${Number(leadInput.value).toFixed(2)}s`;
    markDirty();
  });

  $("#tightenInput").addEventListener("change", (event) => {
    currentUi().tighten = event.target.checked;
    markDirty();
  });

  $("#styleGrid").addEventListener("click", (event) => {
    const card = event.target.closest(".style-card");
    if (!card) return;
    currentUi().styleId = card.dataset.style;
    renderStyleGrid();
    markDirty();
  });

  $("#motionSeg").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-motion]");
    if (!btn) return;
    currentUi().motion = btn.dataset.motion;
    renderStyleGrid();
    markDirty();
  });

  $("#modeSeg").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-mode]");
    if (!btn) return;
    const layout = uiLayout();
    layout.mode = btn.dataset.mode;
    const dh = uiDigitalHuman();
    if (layout.mode !== "video" && dh.enabled) {
      dh.enabled = false;
      toast("已关闭 Kaggle 数字人：数字人成片需要“动画+数字人”布局", "warn");
    }
    renderLayoutPanel();
    markDirty();
  });

  $("#dhEnabled").addEventListener("change", (event) => {
    const dh = uiDigitalHuman();
    const layout = uiLayout();
    dh.enabled = event.target.checked;
    if (dh.enabled) {
      if (layout.mode !== "video") layout.mode = "video";
      if (!dh.reference) dh.reference = layout.avatar.src;
      const ref = dh.reference || layout.avatar.src;
      if (!ref) toast("请先在“创作输入”里选择数字人参考视频", "error");
      else if (!/\.(mp4|webm|mov|mkv|m4v|avi)$/i.test(ref)) toast("参考素材是图片，Kaggle 对口型需要视频", "error");
    }
    renderLayoutPanel();
    markDirty();
  });
  $("#dhVariant").addEventListener("change", (event) => {
    uiDigitalHuman().variant = event.target.value;
    markDirty();
  });
  $("#dhTimeout").addEventListener("change", (event) => {
    uiDigitalHuman().timeoutMin = Math.round(clampNumber(event.target.value, 10, 360, 120));
    markDirty();
  });

  $("#motionAuto").addEventListener("click", autoMotionAll);
  $("#motionRegenerate").addEventListener("click", regenerateScene);
  $("#motionReset").addEventListener("click", resetMotion);
  $("#motionPreview").addEventListener("click", previewMotionFrames);
  $("#motionPlan").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-lock]");
    if (!btn) return;
    toggleMotionLock(Number(btn.dataset.lock) || 0, btn.dataset.locked !== "1");
  });
  $("#motionScope").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-scope]");
    if (!btn) return;
    state.motionScope = btn.dataset.scope;
    renderMotionLab();
    renderPreview();
  });
  $("#motionScene").addEventListener("change", (event) => {
    state.motionSceneIndex = Math.max(0, Number(event.target.value) || 0);
    state.motionCandidates = [];
    state.motionCandidateMode = null;
    state.motionCandidateScene = null;
    renderMotionLab();
    renderPreview();
  });
  $("#motionChips").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-preset]");
    if (!btn) return;
    applyMotion(btn.dataset.preset);
  });
  $("#motionCandidates").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-recipe]");
    if (!btn) return;
    applyMotion(btn.dataset.recipe, state.motionCandidateMode === "scene" ? "scene" : state.motionScope);
  });

  const setAvatarNumber = (key, value, scale = 100) => {
    uiLayout().avatar[key] = clampNumber(value / scale, 0, 1, uiLayout().avatar[key]);
    syncLayoutControls();
    markDirty();
  };

  $("#avatarWidth").addEventListener("input", (event) => setAvatarNumber("width", Number(event.target.value)));
  $("#avatarX").addEventListener("input", (event) => setAvatarNumber("x", Number(event.target.value)));
  $("#avatarY").addEventListener("input", (event) => setAvatarNumber("y", Number(event.target.value)));
  $("#avatarGap").addEventListener("input", (event) => {
    uiLayout().gap = clampNumber(event.target.value, 0, 160, 24);
    syncLayoutControls();
    markDirty();
  });
  $("#avatarShape").addEventListener("change", (event) => {
    uiLayout().avatar.shape = event.target.value;
    syncLayoutControls();
    markDirty();
  });
  $("#avatarMotion").addEventListener("change", (event) => {
    uiLayout().avatar.motion = event.target.value;
    markDirty();
  });
  $("#borderWidth").addEventListener("input", (event) => {
    uiLayout().avatar.borderWidth = Math.round(clampNumber(event.target.value, 0, 32, 4));
    syncLayoutControls();
    markDirty();
  });
  $("#borderColor").addEventListener("input", (event) => {
    uiLayout().avatar.borderColor = event.target.value;
    syncLayoutControls();
    markDirty();
  });
  $("#frameInput").addEventListener("change", (event) => {
    uiLayout().avatar.frame = event.target.checked;
    syncLayoutControls();
    markDirty();
  });
  $("#avoidInput").addEventListener("change", (event) => {
    uiLayout().avoid = event.target.checked;
    syncLayoutControls();
    markDirty();
  });

  $("#anchorGrid").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-x]");
    if (!btn) return;
    uiLayout().avatar.x = Number(btn.dataset.x);
    uiLayout().avatar.y = Number(btn.dataset.y);
    syncLayoutControls();
    markDirty();
  });

  $("#avatarSelect").addEventListener("change", async (event) => {
    const src = event.target.value;
    if (!src) return;
    const layout = uiLayout();
    layout.avatar.src = src;
    layout.mode = /\.(mp4|webm|mov)$/i.test(src) ? "video" : "image";
    const dh = uiDigitalHuman();
    if (dh.enabled || !dh.reference) dh.reference = src;
    await probeAvatarAspect(src);
    renderLayoutPanel();
    markDirty();
  });

  $("#avatarFile").addEventListener("change", (event) => uploadAvatar(event.target.files?.[0]));

  $("#autoPrep").addEventListener("change", (event) => {
    state.autoPrep = event.target.checked;
    try {
      localStorage.setItem("od-auto-prep", state.autoPrep ? "on" : "off");
    } catch {}
    renderStoryboardStatus();
  });

  $("#storyboardRefresh").addEventListener("click", async () => {
    if (state.prep?.state === "running") return;
    const ok = await saveAll(true, false);
    if (!ok) return;
    await requestStoryboardPrep({ force: true, reason: "手动更新" });
  });

  $("#storyboardRetry").addEventListener("click", async () => {
    const ok = await saveAll(true, false);
    if (!ok) return;
    await requestStoryboardPrep({ force: true, reason: "重试" });
  });

  $("#materialFiles").addEventListener("change", (event) => uploadMaterials(Array.from(event.target.files || [])));

  $("#materialRedetect").addEventListener("click", async () => {
    try {
      const data = await api("/api/materials/redetect", { method: "POST", body: JSON.stringify({}) });
      state.materials = data;
      renderMaterials();
      if (state.autoPrep) await requestStoryboardPrep({ force: true, reason: "重新分章" });
      else await refreshStoryboardMeta();
      toast("已按文件名重新分章", "ok");
    } catch (err) {
      toast(err.message || "重新分章失败", "error");
    }
  });

  $("#materialChapters").addEventListener("change", async (event) => {
    const select = event.target.closest("[data-material-chapter]");
    if (!select) return;
    let chapter = select.value;
    if (chapter === "__new") {
      const input = window.prompt("新章节名称，例如：冷气篇");
      chapter = String(input || "").trim();
      if (!chapter) {
        renderMaterials();
        return;
      }
    }
    await updateMaterialChapter(select.dataset.materialChapter, chapter);
  });

  $("#materialChapters").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-material-delete]");
    if (!btn) return;
    deleteMaterial(btn.dataset.materialDelete);
  });

  $("#materialSceneMap").addEventListener("click", (event) => {
    const selectBtn = event.target.closest("[data-scene-select]");
    if (selectBtn) {
      const nextId = selectBtn.dataset.sceneSelect;
      const editorOpen = Boolean(state.layoutSceneId);
      state.previewDraft = null;
      rememberPreviewScene(nextId);
      if (editorOpen) {
        const next = (state.motion?.scenes || []).find((scene) => scene.id === nextId);
        const canLayout = Boolean(next && next.photoSource === "material" && next.layout !== "closing");
        state.layoutSceneId = canLayout ? nextId : "";
      }
      renderMaterials();
      return;
    }
    const layoutBtn = event.target.closest("[data-scene-layout]");
    if (layoutBtn) {
      state.layoutSceneId = state.layoutSceneId === layoutBtn.dataset.sceneLayout ? "" : layoutBtn.dataset.sceneLayout;
      state.previewDraft = null;
      if (state.layoutSceneId) rememberPreviewScene(state.layoutSceneId);
      renderMaterials();
      if (state.layoutSceneId) {
        window.setTimeout(() => $("#sceneLayoutEditor")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 30);
      }
      return;
    }
    const btn = event.target.closest("[data-scene-photo]");
    if (!btn) return;
    restoreSceneNetwork(btn.dataset.scenePhoto, btn.dataset.photoSource || "network");
  });

  const layoutEditor = $("#sceneLayoutEditor");
  layoutEditor.addEventListener("input", (event) => {
    const input = event.target.closest("[data-layout-field]");
    if (!input) return;
    const out = layoutEditor.querySelector(`[data-layout-output="${input.dataset.layoutField}"]`);
    if (out) out.textContent = `${input.value}${input.dataset.layoutField === "photoScale" ? "%" : ""}`;
    const scene = (state.motion?.scenes || []).find((item) => item.id === state.layoutSceneId);
    if (scene) {
      state.previewDraft = { sceneId: scene.id, style: currentLayoutStyleFromEditor() };
      if (state.previewSceneId !== scene.id) rememberPreviewScene(scene.id);
      refreshPreviewCanvas();
    }
  });
  layoutEditor.addEventListener("change", (event) => {
    const input = event.target.closest("[data-layout-field]");
    if (!input) return;
    const scene = (state.motion?.scenes || []).find((item) => item.id === state.layoutSceneId);
    if (scene) void saveSceneLayout(scene);
  });
  layoutEditor.addEventListener("click", async (event) => {
    const scene = (state.motion?.scenes || []).find((item) => item.id === state.layoutSceneId);
    if (event.target.closest("[data-layout-close]")) {
      state.layoutSceneId = "";
      renderMaterials();
      return;
    }
    const presetBtn = event.target.closest("[data-layout-preset]");
    if (presetBtn && scene) {
      layoutEditor.querySelectorAll("[data-layout-preset]").forEach((btn) => {
        btn.classList.toggle("active", btn === presetBtn);
      });
      const preset = presetBtn.dataset.layoutPreset || "full";
      const nextY = SCENE_LAYOUT_DEFAULT_STYLE[preset]?.contentY ?? 0;
      const yInput = layoutEditor.querySelector('[data-layout-field="contentY"]');
      const yOut = layoutEditor.querySelector('[data-layout-output="contentY"]');
      if (yInput) yInput.value = String(nextY);
      if (yOut) yOut.textContent = String(nextY);
      await saveSceneLayout(scene);
      return;
    }
    const alignBtn = event.target.closest("[data-layout-align]");
    if (alignBtn && scene) {
      layoutEditor.querySelectorAll("[data-layout-align]").forEach((btn) => {
        btn.classList.toggle("active", btn === alignBtn);
      });
      await saveSceneLayout(scene);
      return;
    }
    if (event.target.closest("[data-layout-reset]") && scene) {
      scene.layoutStyle = null;
      renderSceneLayoutEditor();
      await saveSceneLayout(scene);
      return;
    }
    if (event.target.closest("[data-layout-preview]") && scene) {
      await previewSceneLayout(scene);
    }
  });

  $("#materialChapters").addEventListener("dragstart", materialDragStart);
  $("#materialChapters").addEventListener("dragend", () => {
    document.querySelectorAll(".material-item.dragging").forEach((item) => item.classList.remove("dragging"));
    clearMaterialDropHighlight();
  });
  $("#materialChapters").addEventListener("dragover", materialDragOver);
  $("#materialChapters").addEventListener("dragleave", materialDragLeave);
  $("#materialChapters").addEventListener("drop", materialDrop);

  $("#restartBtn").addEventListener("click", () => startRun({ fromScratch: true }));

  $("#presetSave").addEventListener("click", saveLayoutPreset);
  $("#presetApply").addEventListener("click", () => {
    const id = $("#presetSelect").value;
    const preset = (state.layoutPresets || []).find((item) => item.id === id);
    if (!preset) {
      toast("请先选择预设", "error");
      return;
    }
    state.config.ui.layout = normalizeLayout(preset.config);
    currentUi().presetId = preset.id;
    renderLayoutPanel();
    markDirty();
    toast(`已套用「${preset.name}」`, "ok");
  });
  $("#presetDelete").addEventListener("click", async () => {
    const id = $("#presetSelect").value;
    if (!id) {
      toast("请先选择预设", "error");
      return;
    }
    try {
      const data = await api(`/api/layout-presets/${encodeURIComponent(id)}`, { method: "DELETE" });
      state.layoutPresets = data.presets || [];
      if (currentUi().presetId === id) currentUi().presetId = "";
      renderLayoutPresets();
      markDirty();
      toast("预设已删除", "ok");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  const avatarEl = $("#previewAvatar");
  let drag = null;
  avatarEl.addEventListener("pointerdown", (event) => {
    if (uiLayout().mode === "none") return;
    drag = { rect: $("#stylePreview").getBoundingClientRect(), id: event.pointerId };
    avatarEl.setPointerCapture(event.pointerId);
    avatarEl.classList.add("dragging");
    event.preventDefault();
  });
  avatarEl.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const a = uiLayout().avatar;
    a.x = Math.round(clampNumber((event.clientX - drag.rect.left) / drag.rect.width, 0, 1, a.x) * 1000) / 1000;
    a.y = Math.round(clampNumber((event.clientY - drag.rect.top) / drag.rect.height, 0, 1, a.y) * 1000) / 1000;
    syncLayoutControls();
    markDirty();
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    avatarEl.classList.remove("dragging");
  };
  avatarEl.addEventListener("pointerup", endDrag);
  avatarEl.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", renderPreviewAvatar);
  window.addEventListener("resize", fitMaterialPreview);
  if (window.ResizeObserver) {
    let previewRaf = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(previewRaf);
      previewRaf = requestAnimationFrame(renderPreviewAvatar);
    }).observe($("#stylePreview"));
  }

  const setAi = (patch) => {
    state.config.ai = { ...(state.config.ai || {}), ...patch };
    renderAiConfig();
    markDirty();
  };
  $("#aiEnabled").addEventListener("change", (event) => setAi({ enabled: event.target.checked }));
  $("#aiBaseUrl").addEventListener("input", (event) => setAi({ baseUrl: event.target.value.trim() }));
  $("#aiModel").addEventListener("input", (event) => setAi({ model: event.target.value.trim() }));
  $("#aiApiKey").addEventListener("input", (event) => setAi({ apiKey: event.target.value.trim() }));
  $("#aiKeyEnv").addEventListener("input", (event) => setAi({ keyEnv: event.target.value.trim() }));
  $("#aiTemperature").addEventListener("input", (event) => setAi({ temperature: Number(event.target.value) }));

  $("#refreshHistory").addEventListener("click", loadHistory);

  $("#historyList").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-act]");
    const card = event.target.closest(".history-card");
    if (!card) return;
    const id = card.dataset.id;
    if (!btn) {
      if (card.querySelector(".history-actions").dataset.act === "play") openRun(id);
      return;
    }
    const act = btn.dataset.act;
    if (act === "play") openRun(id);
    else if (act === "apply") applyRunConfig(id);
    else if (act === "del") deleteRun(id);
    else if (act === "reveal") {
      api(`/api/runs/${id}/reveal`, { method: "POST" }).catch((err) => toast(err.message, "error"));
    }
  });

  $("#openFolder").addEventListener("click", () => {
    const id = state.job?.id;
    if (!id) return;
    api(`/api/runs/${id}/reveal`, { method: "POST" }).catch((err) => toast(err.message, "error"));
  });

  $("#logFilter").addEventListener("change", (event) => {
    state.logFilter = event.target.value;
    renderLogs();
  });

  $("#logSearch").addEventListener("input", (event) => {
    state.logSearch = event.target.value.trim().toLowerCase();
    renderLogs();
  });

  $("#clearLog").addEventListener("click", () => {
    if (state.logSource === "raw") {
      $("#logView").innerHTML = `<span class="log-empty">已清屏。</span>`;
      return;
    }
    state.logs = [];
    renderLogs();
  });

  $("#autoScroll").addEventListener("change", () => {
    const view = $("#logView");
    if ($("#autoScroll").checked) view.scrollTop = view.scrollHeight;
  });
}

async function init() {
  buildStageGrid();
  bind();
  resetRunUI();
  setDirty(false);

  try {
    let data;
    try {
      data = await api("/api/bootstrap");
    } catch (err) {
      API_BASE = LOCAL_API;
      data = await api("/api/bootstrap");
    }
    state.online = true;
    state.env = data.env || [];
    state.voices = data.voices || [];
    state.avatars = data.avatars || [];
    state.materials = data.materials || state.materials;
    state.prep = data.prep || state.prep;
    state.runPlan = data.runPlan || null;
    state.layoutPresets = data.layoutPresets || [];
    state.motion = data.motion || state.motion;
    state.render = data.render || null;
    state.script = data.script || DEFAULT_SCRIPT;
    state.series = data.series || { title: "", tagline: "" };
    state.savedScript = state.script;
    $("#autoPrep").checked = state.autoPrep;
    if (data.config) {
      const { ui, ...tts } = data.config;
      state.config = {
        ...state.config,
        ...tts,
        kaggle: { ...state.config.kaggle, ...(tts.kaggle || {}) },
        cosyvoice: { ...state.config.cosyvoice, ...(tts.cosyvoice || {}) },
        voicestudio: { ...state.config.voicestudio, ...(tts.voicestudio || {}) },
        local3: { ...state.config.local3, ...(tts.local3 || {}) },
        indextts: { ...state.config.indextts, ...(tts.indextts || {}) },
        edge: { ...state.config.edge, ...(tts.edge || {}) },
        ui: {
          ...state.config.ui,
          ...(ui || {}),
          layout: normalizeLayout(ui?.layout ?? state.config.ui.layout),
          digitalHuman: normalizeDigitalHuman(ui?.digitalHuman ?? state.config.ui.digitalHuman),
        },
      };
    }
    $("#offlineBanner").classList.add("hidden");
    renderAll();
    refreshVoiceStudio();
    setDirty(false);
    const startupTab = new URLSearchParams(location.search).get("tab");
    if (startupTab && $(`#panel-${startupTab}`)) switchTab(startupTab);

    const latest = data.active || data.latest;
    state.runActive = Boolean(data.active?.running);
    if (latest) {
      applyJob(latest);
      if (latest.status === "done" && latest.finalVideo) $("#resultTag").textContent = fmtDur(latest.duration);
      if (latest.logs?.length) {
        state.logs = latest.logs.map((entry) => ({ ...entry, stageName: STAGE_NAMES[entry.stage] || "系统" }));
        state.logsRunId = latest.id;
        state.logSource = "entries";
        renderLogs();
      }
    } else {
      resetRunUI();
    }
    updateRunButtons();
    if (!new URLSearchParams(location.search).has("noevents")) connectEvents();
  } catch (err) {
    state.online = false;
    $("#offlineBanner").classList.remove("hidden");
    renderAll();
    resetRunUI();
    updateRunButtons();
    console.warn(err);
  }
}

init();
