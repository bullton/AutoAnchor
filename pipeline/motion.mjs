import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAiConfig, resolveApiKey } from "./ai.mjs";
import { applyPromptRules } from "./prompts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MOTION_FILE = path.join(HERE, "motion.json");

export const ENTERS = ["rise", "wipe", "zoom", "blur", "slide", "fade"];
export const EXITS = ["fade", "wipe", "none"];
export const PHOTO_MOTIONS = ["kenburns", "pan", "parallax", "none"];
export const TITLE_MOTIONS = ["rise", "mask", "typewriter", "pop", "none"];
export const BODY_MOTIONS = ["stagger", "cascade", "fade", "none"];
export const ACCENTS = ["sweep", "bar", "pulse", "none"];
export const PACES = ["calm", "normal", "fast"];

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const pick = (list, value, fallback) => (list.includes(value) ? value : fallback);

export function parseLooseJson(text) {
  const cleaned = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const body = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(body.replace(/,\s*([}\]])/g, "$1"));
}

export function normalizeRecipe(raw = {}) {
  const id = String(raw.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  return {
    id: id || `m-${Date.now().toString(36)}`,
    name: String(raw.name || "未命名动效").slice(0, 20),
    enter: pick(ENTERS, raw.enter, "rise"),
    exit: pick(EXITS, raw.exit, "fade"),
    photo: pick(PHOTO_MOTIONS, raw.photo, "kenburns"),
    title: pick(TITLE_MOTIONS, raw.title, "rise"),
    body: pick(BODY_MOTIONS, raw.body, "stagger"),
    accent: pick(ACCENTS, raw.accent, "bar"),
    intensity: Math.round(clamp(raw.intensity, 0.5, 1.5, 1) * 100) / 100,
    pace: pick(PACES, raw.pace, "normal"),
    source: ["ai", "preset", "manual"].includes(raw.source) ? raw.source : "manual",
    prompt: typeof raw.prompt === "string" ? raw.prompt.slice(0, 400) : "",
  };
}

export function normalizeMotionConfig(raw = {}) {
  const recipesIn = raw.recipes && typeof raw.recipes === "object" ? raw.recipes : {};
  const recipes = {};
  for (const [key, value] of Object.entries(recipesIn)) {
    const recipe = normalizeRecipe({ ...value, id: value?.id || key });
    recipes[recipe.id] = recipe;
  }
  const assignmentsIn = raw.assignments && typeof raw.assignments === "object" ? raw.assignments : {};
  const assignments = {};
  for (const [key, value] of Object.entries(assignmentsIn)) {
    if (typeof value !== "string") continue;
    if (value === "" || recipes[value] || value === "none") assignments[key] = value;
  }
  const locksIn = raw.locks && typeof raw.locks === "object" ? raw.locks : {};
  const locks = {};
  for (const [key, value] of Object.entries(locksIn)) {
    if (value === true) locks[String(Math.max(0, Math.round(Number(key) || 0)))] = true;
  }
  const autoIn = raw.auto && typeof raw.auto === "object" ? raw.auto : null;
  const auto = autoIn
    ? {
        theme: String(autoIn.theme || "").slice(0, 24),
        summary: String(autoIn.summary || "").slice(0, 160),
        hint: String(autoIn.hint || "").slice(0, 200),
        model: autoIn.model ? String(autoIn.model).slice(0, 60) : null,
        fallback: Boolean(autoIn.fallback),
        at: Number(autoIn.at) || 0,
      }
    : null;
  const sourceIn = raw.source && typeof raw.source === "object" ? raw.source : null;
  const source = sourceIn
    ? {
        scriptHash: String(sourceIn.scriptHash || "").slice(0, 32),
        sceneIds: Array.isArray(sourceIn.sceneIds) ? sourceIn.sceneIds.map((id) => String(id || "")).slice(0, 40) : [],
        at: Number(sourceIn.at) || 0,
      }
    : null;
  return { version: 1, recipes, assignments, locks, auto, source };
}

export function readMotion() {
  try {
    const raw = JSON.parse(fs.readFileSync(MOTION_FILE, "utf8").replace(/^\uFEFF/, ""));
    return normalizeMotionConfig(raw);
  } catch {
    return normalizeMotionConfig({});
  }
}

export function pruneMotion(config) {
  const next = normalizeMotionConfig(config);
  const used = new Set(Object.values(next.assignments).filter(Boolean));
  for (const id of Object.keys(next.recipes)) {
    if (!used.has(id)) delete next.recipes[id];
  }
  return next;
}

export function writeMotion(config) {
  const next = normalizeMotionConfig(config);
  fs.mkdirSync(path.dirname(MOTION_FILE), { recursive: true });
  fs.writeFileSync(MOTION_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function resolveMotionForScene(config, index) {
  const id = config.assignments[String(index)] ?? config.assignments.default ?? "";
  if (!id || id === "none") return null;
  return config.recipes[id] || null;
}

export const PRESET_RECIPES = [
  {
    id: "preset-flash",
    name: "快讯冲击",
    enter: "wipe",
    exit: "wipe",
    photo: "pan",
    title: "mask",
    body: "stagger",
    accent: "sweep",
    intensity: 1.15,
    pace: "fast",
    source: "preset",
  },
  {
    id: "preset-deep",
    name: "深度解读",
    enter: "rise",
    exit: "fade",
    photo: "kenburns",
    title: "rise",
    body: "cascade",
    accent: "bar",
    intensity: 0.9,
    pace: "calm",
    source: "preset",
  },
  {
    id: "preset-live",
    name: "人物连线",
    enter: "zoom",
    exit: "fade",
    photo: "kenburns",
    title: "pop",
    body: "stagger",
    accent: "pulse",
    intensity: 1,
    pace: "normal",
    source: "preset",
  },
  {
    id: "preset-data",
    name: "数据聚焦",
    enter: "slide",
    exit: "fade",
    photo: "parallax",
    title: "pop",
    body: "stagger",
    accent: "sweep",
    intensity: 1.05,
    pace: "normal",
    source: "preset",
  },
  {
    id: "preset-calm",
    name: "平稳叙述",
    enter: "blur",
    exit: "fade",
    photo: "none",
    title: "rise",
    body: "fade",
    accent: "bar",
    intensity: 0.75,
    pace: "calm",
    source: "preset",
  },
];

const KEYWORDS = [
  { test: /快|突发|紧急|倒计时|冲击|爆/, ids: ["preset-flash", "preset-data", "preset-live"] },
  { test: /数据|图表|增长|对比|数字|比例/, ids: ["preset-data", "preset-deep", "preset-flash"] },
  { test: /人物|连线|记者|采访|现场|主播/, ids: ["preset-live", "preset-deep", "preset-flash"] },
  { test: /解读|深度|分析|观察|评论|背景/, ids: ["preset-deep", "preset-calm", "preset-live"] },
];

export function fallbackRecipes(prompt, count = 3) {
  const text = String(prompt || "");
  const ordered = KEYWORDS.find((item) => item.test.test(text))?.ids || [
    "preset-flash",
    "preset-deep",
    "preset-live",
  ];
  const byId = Object.fromEntries(PRESET_RECIPES.map((item) => [item.id, item]));
  const base = ordered.map((id) => byId[id]).filter(Boolean);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const seed = base[i % base.length];
    out.push(
      normalizeRecipe({
        ...seed,
        id: `${seed.id}-${Date.now().toString(36)}-${i}`,
        name: i === 0 ? seed.name : `${seed.name} ${i + 1}`,
        source: "preset",
        prompt: text.slice(0, 200),
      }),
    );
  }
  return out;
}

export const MOTION_SYSTEM = `你是竖屏口播视频的动效导演。根据用户描述，产出 3 套可执行的动效配方，只输出 JSON，不要解释。
硬性要求：
1) 每套配方只能从下列枚举取值，不得自创：
   enter: rise | wipe | zoom | blur | slide | fade
   exit: fade | wipe | none
   photo: kenburns | pan | parallax | none
   title: rise | mask | typewriter | pop | none
   body: stagger | cascade | fade | none
   accent: sweep | bar | pulse | none
   pace: calm | normal | fast
2) intensity 是 0.5-1.5 的小数，控制位移、模糊与速度强度。
3) name 是 2-6 个汉字，例如“快讯冲击”“冷静解读”。
4) 3 套方案要有明显差异：一套偏快节奏、一套偏稳重、一套偏人物/图形聚焦。
5) 输出结构：{"recipes":[{"name":"","enter":"","exit":"","photo":"","title":"","body":"","accent":"","intensity":1,"pace":"normal"}]}`;

export function buildMotionUserPrompt({ prompt = "", sceneTitle = "", layout = "" } = {}) {
  return `用户描述：${String(prompt || "").trim()}\n当前幕标题：${sceneTitle || "（未提供）"}\n当前版式：${layout || "（未提供）"}\n输出 3 套差异明显的配方。`;
}

export async function generateMotionRecipes({ prompt, sceneTitle = "", layout = "", count = 3 }) {
  const text = String(prompt || "").trim();
  if (!text) return { ok: false, reason: "empty-prompt" };
  const cfg = loadAiConfig();
  const key = cfg.enabled ? resolveApiKey(cfg) : "";
  if (!cfg.enabled || !key) {
    return { ok: true, recipes: fallbackRecipes(text, count), model: null, fallback: true };
  }
  const body = {
    model: cfg.model,
    temperature: Math.min(0.9, Math.max(0.2, cfg.temperature ?? 0.55)),
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: applyPromptRules(MOTION_SYSTEM, "motion") },
      {
        role: "user",
        content: buildMotionUserPrompt({ prompt: text, sceneTitle, layout }),
      },
    ],
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(60000, cfg.timeoutMs || 60000));
  let payload;
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      return { ok: true, recipes: fallbackRecipes(text, count), model: cfg.model, fallback: true, reason: `http-${res.status}` };
    }
    payload = JSON.parse(raw);
  } catch (err) {
    return {
      ok: true,
      recipes: fallbackRecipes(text, count),
      model: cfg.model,
      fallback: true,
      reason: err?.name === "AbortError" ? "timeout" : String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    return { ok: true, recipes: fallbackRecipes(text, count), model: cfg.model, fallback: true, reason: "empty" };
  }
  let data;
  try {
    data = JSON.parse(String(content).replace(/^```json\s*/i, "").replace(/```$/, "").trim());
  } catch {
    return { ok: true, recipes: fallbackRecipes(text, count), model: cfg.model, fallback: true, reason: "invalid-json" };
  }
  const list = Array.isArray(data?.recipes) ? data.recipes : [];
  const recipes = list.slice(0, count).map((item, i) =>
    normalizeRecipe({
      ...item,
      id: `m-${Date.now().toString(36)}-${i}`,
      source: "ai",
      prompt: text.slice(0, 200),
    }),
  );
  if (recipes.length < count) {
    const extra = fallbackRecipes(text, count - recipes.length);
    recipes.push(...extra);
  }
  return { ok: true, recipes, model: cfg.model, fallback: false };
}

const AUTO_THEMES = [
  { id: "news", label: "时政快讯", test: /快讯|突发|紧急|宣布|通报|抵达|访问|会议|记者|今日|最新消息|全球瞩目|关注/, base: "fast" },
  { id: "city", label: "城市指南", test: /香港|澳门|台北|东京|纽约|城市|地铁|交通|出行|八达通|商场|街头|本地人|攻略|打卡|生活小常识/, base: "normal" },
  { id: "food", label: "美食探店", test: /美食|餐厅|小吃|好吃|咖啡|茶餐厅|菜品|味道|探店|夜市/, base: "normal" },
  { id: "lifestyle", label: "生活技巧", test: /技巧|常识|生活|必备|记得|省钱|避坑|清单|干货|注意|一定要|别踩/, base: "calm" },
  { id: "data", label: "数据解读", test: /数据|增长|同比|环比|亿元|万亿|比例|排名|指数|规模|领域/, base: "normal" },
  { id: "interview", label: "人物访谈", test: /表示|认为|指出|坦言|采访|对话|连线|他说|她说|回应|记者问/, base: "normal" },
  { id: "story", label: "人物故事", test: /故事|回忆|曾经|那年|母亲|父亲|孩子|温暖|情感|命运|告别/, base: "calm" },
  { id: "workplace", label: "职场观察", test: /职场|工作|同事|老板|面试|简历|加班|升职|跳槽/, base: "normal" },
  { id: "emotion", label: "情感故事", test: /恋爱|分手|婚姻|家庭|情感|喜欢|遗憾|错过|陪伴/, base: "calm" },
  { id: "science", label: "科普解读", test: /原理|科学|研究|技术|如何|为什么|机制|实验|创新|科技|智能/, base: "calm" },
];

function detectTheme(scenes) {
  const text = scenes
    .map((scene) => `${scene.title || ""} ${scene.barTitle || ""} ${scene.speech || ""} ${(scene.bullets || []).join(" ")}`)
    .join(" ");
  return AUTO_THEMES.find((item) => item.test.test(text)) || { id: "general", label: "综合叙述", base: "normal" };
}

const ROLE_POOL = {
  hook: { name: "开场定调", enter: "wipe", exit: "fade", photo: "pan", title: "mask", body: "stagger", accent: "sweep", intensity: 1.25 },
  key: { name: "重点抬升", enter: "zoom", exit: "fade", photo: "parallax", title: "pop", body: "stagger", accent: "pulse", intensity: 1.15 },
  data: { name: "数据聚焦", enter: "slide", exit: "fade", photo: "parallax", title: "pop", body: "stagger", accent: "bar", intensity: 1.05 },
  quote: { name: "引语停顿", enter: "blur", exit: "fade", photo: "kenburns", title: "typewriter", body: "fade", accent: "none", intensity: 0.85 },
  list: { name: "清单展开", enter: "slide", exit: "fade", photo: "pan", title: "typewriter", body: "stagger", accent: "bar", intensity: 0.95 },
  tip: { name: "避坑提示", enter: "rise", exit: "fade", photo: "kenburns", title: "pop", body: "stagger", accent: "pulse", intensity: 1.0 },
  body: { name: "信息铺陈", enter: "rise", exit: "fade", photo: "kenburns", title: "rise", body: "cascade", accent: "bar", intensity: 0.95 },
  outro: { name: "收尾收束", enter: "fade", exit: "fade", photo: "none", title: "rise", body: "cascade", accent: "bar", intensity: 0.7 },
};

function sceneRole(scene, index, total) {
  if (index === 0) return "hook";
  if (index === total - 1) return "outro";
  const speech = String(scene.speech || "");
  if (String(scene.number || "").trim()) return "data";
  if (/[「」]|表示|认为|指出|称|坦言|回应|说[:：]/.test(speech)) return "quote";
  if (/第[一二三四五六七八九十]|首先|其次|另外|再者/.test(speech)) return "list";
  if (/别|避免|注意|小心|收费|坑|记得|一定要|不然|禁忌|必备/.test(speech)) return "tip";
  if (scene.layout === "bars" || scene.mood === "analytical") return "data";
  if (/urgent|impact|energetic/.test(String(scene.mood || "")) || scene.layout === "hero" || scene.layout === "compare") {
    return "key";
  }
  if (/数据|图表|对比|比例|增长/.test(`${scene.layout || ""} ${speech}`)) return "data";
  return "body";
}

function rolePace(role, themeId) {
  if (role === "hook" || role === "key") {
    if (themeId === "story" || themeId === "science") return "normal";
    return themeId === "news" ? "fast" : "normal";
  }
  if (role === "outro" || role === "quote") return "calm";
  if (role === "body") return themeId === "news" ? "fast" : themeId === "story" || themeId === "science" ? "calm" : "normal";
  return "normal";
}

function comboDiff(a, b) {
  return ["enter", "photo", "title", "accent"].filter((key) => a[key] !== b[key]).length;
}

function diversifyRecipes(recipes) {
  const list = recipes;
  for (let i = 1; i < list.length; i += 1) {
    const prev = list[i - 1];
    const cur = list[i];
    if (comboDiff(prev, cur) >= 2) continue;
    cur.enter = ENTERS[(ENTERS.indexOf(cur.enter) + 1) % ENTERS.length];
    if (cur.enter === prev.enter) cur.enter = ENTERS[(ENTERS.indexOf(cur.enter) + 1) % ENTERS.length];
    if (comboDiff(prev, cur) < 2) {
      cur.accent = ACCENTS[(ACCENTS.indexOf(cur.accent) + 1) % ACCENTS.length];
      if (cur.accent === prev.accent) cur.accent = ACCENTS[(ACCENTS.indexOf(cur.accent) + 1) % ACCENTS.length];
    }
  }
  const signature = (recipe) => [recipe.enter, recipe.photo, recipe.title].join("|");
  const target = Math.min(4, list.length);
  for (let i = 1; i < list.length && new Set(list.map(signature)).size < target; i += 1) {
    const cur = list[i];
    const prev = list[i - 1];
    const next = TITLE_MOTIONS[(TITLE_MOTIONS.indexOf(cur.title) + 1) % TITLE_MOTIONS.length];
    if (next !== prev.title) cur.title = next;
  }
  return list;
}

export function fallbackAutoMotion(scenes = [], hint = "") {
  const list = Array.isArray(scenes) ? scenes.slice(0, 12) : [];
  const theme = detectTheme(list);
  const stamp = Date.now().toString(36);
  const used = new Map();
  const recipes = list.map((scene, index) => {
    const role = sceneRole(scene, index, list.length);
    const base = ROLE_POOL[role] || ROLE_POOL.body;
    const pace = rolePace(role, theme.id);
    const bump =
      theme.id === "news"
        ? 0.08
        : theme.id === "story" || theme.id === "science" || theme.id === "lifestyle" || theme.id === "emotion"
          ? -0.08
          : 0;
    const seen = (used.get(base.name) || 0) + 1;
    used.set(base.name, seen);
    return normalizeRecipe({
      ...base,
      id: `auto-${stamp}-${index}`,
      name: seen > 1 ? `${base.name}·${index + 1}` : base.name,
      body: base.body,
      pace,
      intensity: Math.round(Math.min(1.5, Math.max(0.5, base.intensity + bump)) * 100) / 100,
      source: "preset",
      prompt: `本地规则 · ${theme.label}${hint ? ` · ${hint}` : ""}`.slice(0, 200),
    });
  });
  diversifyRecipes(recipes);
  return {
    ok: true,
    theme: theme.label,
    summary: `按「${theme.label}」基调逐幕编排，开场抓住注意力，中段随内容收放，结尾收束。`,
    recipes,
    model: null,
    fallback: true,
    reason: "local-rules",
  };
}

export const AUTO_SYSTEM = `你是竖屏口播短视频的动效总导演。你会收到整篇文案的逐幕摘要，请先判断全片主题，再为每一幕单独设计动效，只输出 JSON，不要解释。
硬性要求：
1) 每幕配方只能从下列枚举取值，不得自创：
   enter: rise | wipe | zoom | blur | slide | fade
   exit: fade | wipe | none
   photo: kenburns | pan | parallax | none
   title: rise | mask | typewriter | pop | none
   body: stagger | cascade | fade | none
   accent: sweep | bar | pulse | none
   pace: calm | normal | fast
2) intensity 是 0.5-1.5 的小数，控制位移、模糊与速度强度。
3) 每一幕都要给出一条，index 与输入编号一致，不许漏幕；相邻幕至少在 enter/photo/title/accent 中有 2 个字段不同，全片至少 4 种组合。
4) 主题决定整体节奏：快讯/突发偏 fast、intensity 1.05-1.4；解读/科普/故事偏 calm；人物/访谈偏 normal。逐幕要有起伏：开场抓人、信息段收敛、重点段抬升、引语放慢、结尾收束。
5) name 是 2-6 个汉字，体现这一幕的作用与手法，全片不要反复用同一个名字。
6) 版式含义：hero=开场大标题，band=常规信息条，bars=列表与数据，abstract=概念画面，compare=双栏对比，closing=结尾互动。
7) 输出结构：{"theme":"6字内主题","summary":"一句话编排思路","scenes":[{"index":0,"name":"","enter":"","exit":"","photo":"","title":"","body":"","accent":"","intensity":1,"pace":"normal"}]}`;

export function buildAutoDigest(list = []) {
  return (Array.isArray(list) ? list : [])
    .map((scene, index) => {
      const speech = String(scene.speech || "").replace(/\s+/g, " ").slice(0, 400);
      const number = scene.number ? `｜数字 ${scene.number}${scene.unit || ""}` : "";
      const bullets = (scene.bullets || []).slice(0, 3).join("；");
      const material = scene.materialName ? `｜素材：${scene.materialName}` : "";
      return `${index + 1}. index=${index}｜标题：${scene.title || scene.barTitle || "未命名"}｜版式：${
        scene.layout || "band"
      }｜情绪：${scene.mood || "steady"}${number}${material}｜台词：${speech}${bullets ? `｜要点：${bullets}` : ""}`;
    })
    .join("\n");
}

export function buildAutoUserPrompt(list = [], hint = "") {
  const digest = buildAutoDigest(list);
  return `全片共 ${list.length} 幕。${hint ? `用户补充：${hint}\n` : "用户没有额外要求，请完全按文案判断。\n"}${digest}`;
}

export async function autoMotion({ scenes = [], hint = "" } = {}) {
  const list = Array.isArray(scenes) ? scenes.slice(0, 12) : [];
  if (!list.length) return { ok: false, reason: "no-scenes" };
  const local = fallbackAutoMotion(list, hint);
  const cfg = loadAiConfig();
  const key = cfg.enabled ? resolveApiKey(cfg) : "";
  if (!cfg.enabled || !key) return local;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(60000, cfg.timeoutMs || 60000));
  let payload;
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: Math.min(0.85, Math.max(0.3, cfg.temperature ?? 0.55)),
        max_tokens: 2200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: applyPromptRules(AUTO_SYSTEM, "motion") },
          {
            role: "user",
            content: buildAutoUserPrompt(list, hint),
          },
        ],
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      return { ...local, reason: `http-${res.status}` };
    }
    payload = JSON.parse(raw);
  } catch (err) {
    return { ...local, reason: err?.name === "AbortError" ? "timeout" : String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) return { ...local, reason: "empty" };
  let data;
  try {
    data = JSON.parse(String(content).replace(/^```json\s*/i, "").replace(/```$/, "").trim());
  } catch {
    try {
      data = parseLooseJson(content);
    } catch {
      return { ...local, reason: "invalid-json" };
    }
  }
  const byIndex = new Map();
  for (const item of Array.isArray(data?.scenes) ? data.scenes : []) {
    const index = Math.round(Number(item?.index));
    if (Number.isFinite(index) && index >= 0 && index < list.length) byIndex.set(index, item);
  }
  if (!byIndex.size) return { ...local, reason: "no-scenes" };

  const stamp = Date.now().toString(36);
  const recipes = list.map((scene, index) => {
    const base = local.recipes[index] || normalizeRecipe({});
    const item = byIndex.get(index);
    if (!item) return base;
    return normalizeRecipe({
      ...base,
      ...item,
      id: `auto-${stamp}-${index}`,
      source: "ai",
      name: String(item.name || base.name).slice(0, 20),
      prompt: (hint || `AI 自动编排 · ${data?.theme || local.theme}`).slice(0, 200),
    });
  });
  diversifyRecipes(recipes);
  return {
    ok: true,
    theme: String(data?.theme || local.theme).slice(0, 24),
    summary: String(data?.summary || local.summary).slice(0, 160),
    recipes,
    model: cfg.model,
    fallback: false,
  };
}

const SCENE_FIELDS = ["enter", "photo", "title", "accent"];
const sceneDiff = (a, b) => SCENE_FIELDS.filter((key) => a[key] !== b[key]).length;

function refineSceneCandidates(candidates, refs) {
  const seen = refs.filter(Boolean);
  return candidates.map((recipe) => {
    let guard = 0;
    while (seen.some((ref) => sceneDiff(recipe, ref) < 2) && guard < 10) {
      recipe.enter = ENTERS[(ENTERS.indexOf(recipe.enter) + 1) % ENTERS.length];
      if (guard % 2 === 1) recipe.accent = ACCENTS[(ACCENTS.indexOf(recipe.accent) + 1) % ACCENTS.length];
      if (guard % 3 === 2) recipe.photo = PHOTO_MOTIONS[(PHOTO_MOTIONS.indexOf(recipe.photo) + 1) % PHOTO_MOTIONS.length];
      guard += 1;
    }
    seen.push(recipe);
    return recipe;
  });
}

export function fallbackSceneRecipes({
  scene = {},
  sceneIndex = 0,
  total = 1,
  theme = "",
  current = null,
  prev = null,
  next = null,
  count = 2,
} = {}) {
  const themeMeta = AUTO_THEMES.find((item) => item.label === theme) || detectTheme([scene]);
  const role = sceneRole(scene, sceneIndex, total);
  const base = ROLE_POOL[role] || ROLE_POOL.body;
  const stamp = Date.now().toString(36);
  const suffixes = ["轻", "稳", "冲"];
  const list = [];
  for (let i = 0; i < count; i += 1) {
    list.push(
      normalizeRecipe({
        ...base,
        id: `sc-${stamp}-${i}`,
        name: `${base.name}·${suffixes[i % suffixes.length]}`,
        enter: ENTERS[(ENTERS.indexOf(base.enter) + i + 1) % ENTERS.length],
        accent: ACCENTS[(ACCENTS.indexOf(base.accent) + i) % ACCENTS.length],
        title: TITLE_MOTIONS[(TITLE_MOTIONS.indexOf(base.title) + i) % TITLE_MOTIONS.length],
        pace: rolePace(role, themeMeta.id),
        intensity: base.intensity + (i === 0 ? -0.1 : 0.1),
        source: "preset",
        prompt: `本地规则 · 单幕重排${theme ? ` · ${theme}` : ""}`.slice(0, 200),
      }),
    );
  }
  return refineSceneCandidates(list, [current, prev, next]);
}

export const SCENE_SYSTEM = `你是竖屏口播视频的动效导演。现在只重排其中一幕，不要改动其他幕的编排。只输出 JSON，不要解释。
硬性要求：
1) 配方只能从下列枚举取值，不得自创：
   enter: rise | wipe | zoom | blur | slide | fade
   exit: fade | wipe | none
   photo: kenburns | pan | parallax | none
   title: rise | mask | typewriter | pop | none
   body: stagger | cascade | fade | none
   accent: sweep | bar | pulse | none
   pace: calm | normal | fast
2) intensity 是 0.5-1.5 的小数。
3) 输出 2 套候选，每套都必须与“当前幕”以及“前一幕/后一幕”在 enter/photo/title/accent 中至少 2 个字段不同；两套候选之间也要有明显差异。
4) 保持全片主题基调，但这一幕可以有自己的作用：开场抓人、信息收敛、重点抬升、引语放慢、结尾收束。
5) name 是 2-6 个汉字，两套名字不要相同。
6) 输出结构：{"recipes":[{"name":"","enter":"","exit":"","photo":"","title":"","body":"","accent":"","intensity":1,"pace":"normal"}]}`;

export function buildSceneUserPrompt({
  scene = {},
  sceneIndex = 0,
  total = 1,
  theme = "",
  current = null,
  prev = null,
  next = null,
  hint = "",
} = {}) {
  const sig = (recipe) => (recipe ? `${recipe.enter}/${recipe.photo}/${recipe.title}/${recipe.accent}` : "（无）");
  const speech = String(scene.speech || "").replace(/\s+/g, " ").slice(0, 400);
  return `全片主题：${theme || "自动判断"}
这是第 ${sceneIndex + 1}/${total} 幕，标题：${scene.title || scene.barTitle || "未命名"}，版式：${scene.layout || "band"}，情绪：${scene.mood || "steady"}
当前幕配方：${sig(current)}
前一幕配方：${sig(prev)}
后一幕配方：${sig(next)}
台词：${speech}
${hint ? `用户补充：${hint}\n` : ""}输出 2 套只替换这一幕的候选。`;
}

export async function generateSceneMotion({
  scene = {},
  sceneIndex = 0,
  total = 1,
  theme = "",
  current = null,
  prev = null,
  next = null,
  hint = "",
  count = 2,
} = {}) {
  const fallback = fallbackSceneRecipes({ scene, sceneIndex, total, theme, current, prev, next, count });
  const cfg = loadAiConfig();
  const key = cfg.enabled ? resolveApiKey(cfg) : "";
  if (!cfg.enabled || !key) return { ok: true, recipes: fallback, model: null, fallback: true, reason: "no-ai" };

  const user = buildSceneUserPrompt({ scene, sceneIndex, total, theme, current, prev, next, hint });

  let data = null;
  let reason = "empty";
  for (let attempt = 0; attempt < 2 && !data; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(45000, cfg.timeoutMs || 45000));
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: cfg.model,
          temperature: Math.min(0.85, Math.max(0.3, attempt === 1 ? 0.35 : cfg.temperature ?? 0.55)),
          max_tokens: 1800,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: applyPromptRules(SCENE_SYSTEM, "motion") },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        reason = `http-${res.status}`;
        if (res.status === 429 || res.status >= 500) continue;
        break;
      }
      const payload = JSON.parse(raw);
      const content = payload?.choices?.[0]?.message?.content;
      if (!content) {
        reason = "empty";
        continue;
      }
      data = parseLooseJson(content);
    } catch (err) {
      reason = err?.name === "AbortError" ? "timeout" : String(err?.message || err);
    } finally {
      clearTimeout(timer);
    }
  }
  if (!data) return { ok: true, recipes: fallback, model: cfg.model, fallback: true, reason };

  const stamp = Date.now().toString(36);
  const list = (Array.isArray(data?.recipes) ? data.recipes : []).slice(0, count).map((item, i) =>
    normalizeRecipe({
      ...fallback[i % fallback.length],
      ...item,
      id: `a-${stamp}-${i}`,
      source: "ai",
      name: String(item?.name || fallback[i % fallback.length]?.name || "单幕方案").slice(0, 20),
      prompt: (hint || `AI 单幕重排 · ${theme || "自动判断"}`).slice(0, 200),
    }),
  );
  if (!list.length) return { ok: true, recipes: fallback, model: cfg.model, fallback: true, reason: "no-recipes" };
  while (list.length < count) {
    const extra = { ...fallback[list.length % fallback.length], id: `a-${stamp}-${list.length}` };
    list.push(extra);
  }
  return {
    ok: true,
    recipes: refineSceneCandidates(list, [current, prev, next]),
    model: cfg.model,
    fallback: false,
  };
}
