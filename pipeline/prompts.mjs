import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROMPTS_FILE = path.join(HERE, "prompts.json");

const LIMITS = { global: 2400, storyboard: 1600, motion: 1600 };
const LABELS = { global: "公共规则", storyboard: "分镜规则", motion: "动效规则" };
export const RULE_FIELDS = Object.keys(LABELS);

const clean = (value, max) =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .slice(0, max)
    .trim();

export function normalizePromptRules(raw = {}) {
  return {
    global: clean(raw.global, LIMITS.global),
    storyboard: clean(raw.storyboard, LIMITS.storyboard),
    motion: clean(raw.motion, LIMITS.motion),
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

export function readPromptRules() {
  try {
    const raw = JSON.parse(fs.readFileSync(PROMPTS_FILE, "utf8").replace(/^\uFEFF/, ""));
    return normalizePromptRules(raw);
  } catch {
    return normalizePromptRules({});
  }
}

export function writePromptRules(raw = {}) {
  const current = readPromptRules();
  const next = normalizePromptRules({
    global: raw.global ?? current.global,
    storyboard: raw.storyboard ?? current.storyboard,
    motion: raw.motion ?? current.motion,
    updatedAt: Date.now(),
  });
  fs.mkdirSync(path.dirname(PROMPTS_FILE), { recursive: true });
  fs.writeFileSync(PROMPTS_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function ruleBlock(rules = readPromptRules()) {
  return RULE_FIELDS.map((key) => {
    const text = clean(rules[key], LIMITS[key]);
    return text ? `【${LABELS[key]}】\n${text}` : "";
  })
    .filter(Boolean)
    .join("\n\n");
}

export function applyPromptRules(base, section, rules = readPromptRules()) {
  const shared = clean(rules.global, LIMITS.global);
  const own = section ? clean(rules[section], LIMITS[section]) : "";
  const parts = [];
  if (shared) parts.push(`【公共规则】\n${shared}`);
  if (own) parts.push(`【${LABELS[section] || "补充"}规则】\n${own}`);
  if (!parts.length) return String(base || "");
  return `${String(base || "").trimEnd()}\n\n${parts.join("\n\n")}`;
}
