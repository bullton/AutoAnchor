import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRIVATE_FILE, privateAi } from "./private.mjs";
import { applyPromptRules } from "./prompts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const LAYOUTS = ["hero", "band", "number", "bars", "compare", "list", "abstract", "closing"];

const DEFAULTS = {
  enabled: false,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  keyEnv: "OPENAI_API_KEY",
  apiKey: "",
  temperature: 0.4,
  maxTokens: 2400,
  timeoutMs: 90000,
  extraPrompt: "",
};

export function aiConfigPath() {
  return process.env.OD_AI_CONFIG || (privateAi() ? PRIVATE_FILE : path.join(HERE, "ai.json"));
}

const ENV_NAME = /^[A-Z][A-Z0-9_]{2,}$/;

export function loadAiConfig() {
  let raw = {};
  try {
    const privateConfig = privateAi();
    raw = privateConfig || JSON.parse(fs.readFileSync(aiConfigPath(), "utf8").replace(/^\uFEFF/, ""));
  } catch {
    raw = {};
  }
  const base = String(raw.baseUrl || DEFAULTS.baseUrl).trim().replace(/\/+$/, "");
  let keyEnv = String(raw.keyEnv || DEFAULTS.keyEnv).trim() || DEFAULTS.keyEnv;
  let apiKey = String(raw.apiKey || "").trim();
  // 容错：把误填进"环境变量名"的密钥迁移到 apiKey
  if (!apiKey && keyEnv && !ENV_NAME.test(keyEnv)) {
    apiKey = keyEnv;
    keyEnv = DEFAULTS.keyEnv;
  }
  return {
    ...DEFAULTS,
    ...raw,
    enabled: raw.enabled === true,
    baseUrl: /^https?:\/\//i.test(base) ? base : DEFAULTS.baseUrl,
    model: String(raw.model || DEFAULTS.model).trim() || DEFAULTS.model,
    keyEnv,
    apiKey,
    temperature: Math.min(2, Math.max(0, Number(raw.temperature ?? DEFAULTS.temperature) || 0)),
    maxTokens: Math.min(8000, Math.max(400, Number(raw.maxTokens) || DEFAULTS.maxTokens)),
    timeoutMs: Math.min(300000, Math.max(5000, Number(raw.timeoutMs) || DEFAULTS.timeoutMs)),
    extraPrompt: String(raw.extraPrompt || "").slice(0, 800),
  };
}

export function resolveApiKey(cfg) {
  if (cfg.apiKey) return cfg.apiKey;
  if (ENV_NAME.test(cfg.keyEnv || "")) return process.env[cfg.keyEnv] || "";
  return "";
}

export const PLAN_SYSTEM = `你是竖屏口播短视频的分镜导演。把整篇文案切成 5-8 幕（信息块），并为每一幕选择版式、写标题与要点、指定配图意图。
硬性要求：
1) 必须覆盖全部句子，按原文顺序，不重不漏；每幕 1-4 句。
2) layout 只能从给定枚举里选。
3) 第一幕用 hero，最后一幕用 closing。
4) title 是这一幕的看点短句，12-20 个汉字，不要复述整句，不要书名号。
5) bullets 是该幕 2-3 个短要点，每条 6-22 个汉字，不要以"这/那/不管/如果"开头。
6) barTitle 是 2-5 个汉字的小标签（如 开场/政策沿革/跨境税务）。
7) photoKey 用小写英文连字符，同主题复用同一 key（如 hong-kong-skyline、probate-documents、hk-banknotes）。
8) photoQuery 是英文图库检索词，8 个词以内，写具体主体+场景；如果这一幕有明确指名的人物/公司/产品/事件，必须直接用其真实姓名或名称（如 Jensen Huang speaking on stage、Nvidia headquarters），不要泛化成 Chinese businessman 之类；只有泛指人群时才以 Chinese 开头并优先中国人/华人。
9) wikiTitle 是最贴近该幕主题的英文维基百科条目名；有指名人物时用其本人条目（如 Jensen Huang、Sundar Pichai），有指名公司/产品时用其官方条目（如 Nvidia、GeForce），泛指主题时才用概念条目（如 Press conference、Handshake、Smartphone），拿不准就留空字符串。
10) 版式节奏要有变化，相邻两幕避免同一 layout（hero/closing 除外）。
只输出 JSON，不要解释。`;

export function buildPlanUserPrompt(sentences, extra = "") {
  const list = sentences.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `文案共 ${sentences.length} 句：
${list}

可用版式（layout）：${LAYOUTS.join(" / ")}
- hero：开场定调，大标题+氛围图
- band：照片带 + 标题 + 2-3 条要点
- number：一个关键数字撑场
- bars：2-4 条横向数据条对比
- compare：左右/上下对照两组概念
- list：编号清单，逐条推进
- abstract：无图，纹理底 + 短句
- closing：收束+行动建议

输出 JSON：{"scenes":[{"sentences":[序号...],"layout":"band","barTitle":"跨境税务","title":"...","bullets":["..."],"number":"40","unit":"%","photoKey":"hk-banknotes","photoQuery":"Hong Kong dollar banknotes","wikiTitle":"Hong Kong dollar","mood":"steady"}]}
number/unit 只在适合大数字版式时填，否则给空字符串。${extra ? `\n补充要求：${extra}` : ""}`;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const cut = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function validatePlan(data, sentenceCount) {
  const scenes = Array.isArray(data?.scenes) ? data.scenes : Array.isArray(data) ? data : null;
  if (!scenes || scenes.length < 4 || scenes.length > 9) return null;

  const normalized = [];
  let expect = 1;
  for (const item of scenes) {
    const ids = Array.isArray(item?.sentences) ? item.sentences.map((n) => Number(n)).filter((n) => Number.isInteger(n)) : [];
    if (!ids.length) return null;
    for (const n of ids) {
      if (n !== expect) return null;
      expect += 1;
    }
    const layout = LAYOUTS.includes(item.layout) ? item.layout : "band";
    const bullets = (Array.isArray(item.bullets) ? item.bullets : [])
      .map((b) => cut(b, 24))
      .filter((b) => b.length >= 2)
      .slice(0, 3);
    const title = cut(item.title, 26);
    if (!title) return null;
    normalized.push({
      sentences: ids,
      layout,
      title,
      barTitle: cut(item.barTitle, 10) || "专题",
      bullets,
      number: cut(item.number, 10),
      unit: cut(item.unit, 6),
      photoKey: /^[a-z0-9][a-z0-9-]{1,39}$/.test(String(item.photoKey || "")) ? item.photoKey : slug(item.photoQuery) || "topic",
      photoQuery: cut(item.photoQuery, 120),
      wikiTitle: cut(item.wikiTitle, 60),
      mood: cut(item.mood, 16) || "steady",
    });
  }
  if (expect !== sentenceCount + 1) return null;
  if (normalized[0].layout !== "hero") normalized[0].layout = "hero";
  normalized[normalized.length - 1].layout = "closing";
  return normalized;
}

async function requestPlan(cfg, key, sentences, opts, attempt) {
  const retryNote = attempt > 1 ? "上一次输出结构不合格，请严格按字段与句子顺序输出合法 JSON。" : "";
  const body = {
    model: cfg.model,
    temperature: Math.min(1.2, (cfg.temperature || 0.4) + (attempt - 1) * 0.2),
    max_tokens: cfg.maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: applyPromptRules(PLAN_SYSTEM, "storyboard") },
      {
        role: "user",
        content: buildPlanUserPrompt(sentences, [cfg.extraPrompt, opts.extra, retryNote].filter(Boolean).join("；")),
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const startedAt = Date.now();
  let payload;
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, reason: `http-${res.status}: ${text.slice(0, 300)}`, elapsedMs: Date.now() - startedAt };
    }
    payload = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      reason: err?.name === "AbortError" ? "timeout" : String(err?.message || err),
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
  const elapsedMs = Date.now() - startedAt;
  const usage = payload?.usage || null;

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) return { ok: false, reason: "empty-response", elapsedMs, usage };
  let data;
  try {
    data = JSON.parse(String(content).replace(/^```json\s*/i, "").replace(/```$/, "").trim());
  } catch {
    return { ok: false, reason: "invalid-json", elapsedMs, usage, preview: String(content).slice(0, 200) };
  }
  const scenes = validatePlan(data, sentences.length);
  if (!scenes) return { ok: false, reason: "invalid-structure", elapsedMs, usage };
  return { ok: true, scenes, model: cfg.model, elapsedMs, usage };
}

export async function planScenes(sentences, opts = {}) {
  const cfg = loadAiConfig();
  if (!cfg.enabled) return { ok: false, reason: "disabled" };
  const key = resolveApiKey(cfg);
  if (!key) return { ok: false, reason: `missing-key(${cfg.keyEnv})` };

  const attempts = Math.max(1, Math.min(3, Number(opts.attempts) || 2));
  let last = null;
  let totalMs = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await requestPlan(cfg, key, sentences, opts, attempt);
    totalMs += result.elapsedMs || 0;
    if (result.ok) return { ...result, elapsedMs: totalMs, attempts: attempt };
    last = result;
    if (/^missing-key/.test(result.reason || "")) break;
  }
  return { ...(last || { ok: false, reason: "unknown" }), elapsedMs: totalMs, attempts };
}
