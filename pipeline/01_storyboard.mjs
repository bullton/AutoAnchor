import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { files, paths, video } from "./config.mjs";
import { planScenes, loadAiConfig, resolveApiKey } from "./ai.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const scriptPath = path.resolve(arg("script", files.script));
const outPath = path.resolve(arg("out", files.slides));
const seriesTitleArg = String(arg("series-title", "") || "").trim();
const seriesTaglineArg = String(arg("series-tagline", "") || "").trim();

if (!fs.existsSync(scriptPath)) {
  console.error(`找不到文案文件：${scriptPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(scriptPath, "utf8").replace(/\r/g, "");
const scriptHash = crypto
  .createHash("sha1")
  .update(raw.replace(/^\uFEFF/, "").replace(/\s+/g, ""))
  .digest("hex")
  .slice(0, 16);
const photoOverrideFile = path.join(paths.root, "pipeline", "photo-overrides.json");

const DISCOURSE =
  /^(数据显示|更关键的是|值得注意的是|更重要的是|简单来说|总的来说|首先|其次|最后|此外|同时|因此|所以|但是|不过|其实|换句话说|我们发现|我认为|我们的)[，,：:]?\s*/;

const ORDINAL = /^(第[一二三四五六七八九十]+|其一|其二|其三)[，,、：:\s]+/;

function cleanClause(input) {
  let t = input.trim().replace(/\*\*/g, "");
  for (let i = 0; i < 2; i += 1) t = t.replace(DISCOURSE, "").trim();
  t = t.replace(ORDINAL, "").trim();
  return t.replace(/[。！？!?；;，,、\s”"']+$/g, "").trim();
}

function splitSentences(paragraph) {
  return paragraph
    .split(/(?<=[。！？!?；;])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitClauses(sentence) {
  return sentence
    .split(/[，,、；;：:]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function numberTokens(sentence) {
  const tokens = [];
  const re = /(\d+(?:\.\d+)?)\s*(%|％|倍|台|个|小时|分钟|秒|天|周|页|条|招|人|次|万|亿|GB|TB|核|步|年|个月)?/g;
  let m;
  while ((m = re.exec(sentence)) !== null) {
    const value = parseFloat(m[1]);
    const unit = (m[2] ?? "").replace("％", "%");
    tokens.push({ value, raw: m[1], unit });
  }
  return tokens;
}

function pickHeroNumber(sentence) {
  const tokens = numberTokens(sentence);
  if (tokens.length === 0) return null;

  const pcts = tokens.filter((t) => t.unit === "%");
  const hasChange = /跃升|下降|提升|增长|减少|降低|上升|节省|缩短|升到|升至|提高到|降至|降到/.test(sentence);
  if (pcts.length >= 2 && hasChange) {
    const last = pcts[pcts.length - 1];
    return { number: last.raw, unit: "%", value: last.value };
  }

  const years = tokens.filter((t) => t.unit === "年" && t.value >= 1900 && t.value <= 2100);
  if (years.length) return { number: years[0].raw, unit: "年", value: years[0].value };

  const strong = tokens.find(
    (t) => t.unit === "%" || t.unit === "倍" || t.value >= 100,
  );
  if (strong) return { number: strong.raw, unit: strong.unit, value: strong.value };
  return null;
}

function simplifyUnit(unit) {
  const map = { 个小时: "小时", 个分钟: "分钟", 个台: "台" };
  return map[unit] ?? unit;
}

function buildSlide(sentence, i, total) {
  const display = sentence.replace(/[。！？!?；;]+$/g, "").trim();
  const kicker = String(i + 1).padStart(2, "0") + " / " + String(total).padStart(2, "0");
  const id = `s${String(i + 1).padStart(2, "0")}`;
  const base = { id, index: i, total, kicker, speech: sentence };

  if (i === 0) {
    const clauses = splitClauses(display).map(cleanClause).filter(Boolean);
    const shortLead = clauses.length > 1 && clauses[0].length <= 12;
    return {
      ...base,
      type: "title",
      kicker: "口播视频",
      title: shortLead ? clauses[0] : display,
      caption: shortLead ? clauses.slice(1).join(" · ") : "",
    };
  }

  if (i === total - 1) {
    const clauses = splitClauses(display).map(cleanClause).filter(Boolean);
    return {
      ...base,
      type: "closing",
      title: display,
      caption: clauses.length >= 2 ? clauses.slice(1).join(" · ") : "END",
    };
  }

  const clauses = splitClauses(display).map(cleanClause).filter((s) => s.length > 0);

  if (/[？?]/.test(sentence) || clauses.length === 0) {
    return { ...base, type: "quote", title: display, caption: "" };
  }

  const withNumbers = clauses.filter((c) => /\d/.test(c));
  const others = clauses.filter((c) => !/\d/.test(c));

  let title = clauses[0];
  let body = clauses.slice(1);

  if (withNumbers.length >= 2) {
    const firstOther = others.find((c) => c.length >= 4);
    title = firstOther ?? withNumbers[0];
    body = clauses.filter((c) => c !== title);
  }

  if (body.length === 0) {
    return { ...base, type: "quote", title: display, caption: "" };
  }

  return { ...base, type: "bullets", title, body: body.slice(0, 3) };
}

const paragraphs = raw
  .split(/\n\s*\n/)
  .map((p) => p.trim())
  .filter(Boolean);

const sentences = [];
paragraphs.forEach((para) => {
  for (const s of splitSentences(para)) {
    if (s.replace(/[\s。！？!?；;，,、]/g, "").length < 1) continue;
    sentences.push(s);
  }
});

if (sentences.length === 0) {
  console.error("文案为空或无法切分，请检查 input/script.txt");
  process.exit(1);
}

const slides = sentences.map((s, i) => buildSlide(s, i, sentences.length));

// ---------- 幕规划（6–8 幕，参考技能包的信息块切分） ----------

const CITY_PHOTOS = [
  [/深圳|罗湖|福田|南山|宝安|龙岗|盐田/, "shenzhen-skyline"],
  [/香港|维港|中环|港岛|九龙|新界/, "hong-kong-skyline"],
  [/上海|外滩|浦东|陆家嘴/, "mainland-skyline"],
  [/北京|朝阳|海淀|国贸/, "mainland-skyline"],
];

const TOPIC_PHOTOS = [
  [/潮汕|牛肉火锅|吊龙|匙柄|沙茶/, { key: "chaoshan-beef-hotpot", query: "Chaoshan beef hot pot", wikiTitle: "Chaoshan cuisine" }],
  [/生蚝|牡蛎|蒜蓉.*蚝/, { key: "grilled-oysters", query: "grilled oysters", wikiTitle: "Oyster" }],
  [/椰子鸡|椰青|文昌鸡|沙姜/, { key: "coconut-chicken-soup", query: "coconut chicken soup" }],
  [/乳鸽|烧鸽|鸽子/, { key: "roast-pigeon", query: "roast pigeon", wikiTitle: "Squab" }],
  [/美食|餐厅|火锅|小吃|探店|茶餐厅|烧味/, { key: "food-table", query: "Chinese food table dishes", wikiTitle: "Chinese cuisine" }],
];

function cityPhotoKey(text) {
  for (const [re, key] of CITY_PHOTOS) if (re.test(text)) return key;
  return "";
}

function photoForScene(barTitle, text) {
  if (barTitle === "开场" || barTitle === "行动建议") {
    const city = cityPhotoKey(text);
    if (city) return { key: city };
  }
  for (const [re, photo] of TOPIC_PHOTOS) if (re.test(text)) return photo;
  const city = cityPhotoKey(text);
  return city ? { key: city } : { key: "topic" };
}

function joinSentences(list) {
  return list.join(" ");
}

/** 按字数做 DP 分组，幕数取 5–8，尽量均匀且单幕不超过约 90 字 */
function planGroups(list) {
  const lens = list.map((s) => s.length);
  const totalChars = lens.reduce((a, b) => a + b, 0);
  const minK = Math.min(5, list.length);
  const maxK = Math.min(8, list.length);

  const solve = (K) => {
    const avg = totalChars / K;
    const INF = Number.POSITIVE_INFINITY;
    const dp = Array.from({ length: K + 1 }, () => Array(list.length + 1).fill(INF));
    const back = Array.from({ length: K + 1 }, () => Array(list.length + 1).fill(-1));
    dp[0][0] = 0;

    for (let k = 1; k <= K; k += 1) {
      for (let i = k; i <= list.length; i += 1) {
        let chars = 0;
        for (let j = i - 1; j >= k - 1; j -= 1) {
          chars += lens[j];
          const count = i - j;
          if (count > 4) break;
          if (k === 1 && count > 3) continue;
          let cost = ((chars - avg) ** 2) / 100;
          if (chars > 92 && count > 1) cost += 240;
          if (chars > 120) cost += 900;
          if (count === 1 && chars < 20) cost += 60;
          const candidate = dp[k - 1][j] + cost;
          if (candidate < dp[k][i]) {
            dp[k][i] = candidate;
            back[k][i] = j;
          }
        }
      }
    }
    if (!Number.isFinite(dp[K][list.length])) return null;

    const groups = [];
    let i = list.length;
    for (let k = K; k >= 1; k -= 1) {
      const j = back[k][i];
      groups.unshift([j, i]);
      i = j;
    }
    return { groups, cost: dp[K][list.length] };
  };

  let best = null;
  for (let K = minK; K <= maxK; K += 1) {
    const res = solve(K);
    if (!res) continue;
    if (!best || res.cost < best.cost) best = { ...res, K };
  }
  if (!best) return [list.map((_, i) => i)];
  return best.groups;
}

const groups = planGroups(sentences);

function pickTitle(clauses, fallback) {
  const scored = clauses
    .map((c) => {
      let score = 0;
      if (/\d/.test(c)) score += 3;
      if (/(遗产|税|信托|保险|继承|冻结|账户|房产|美股|英国|香港|内地)/.test(c)) score += 2;
      if (c.length >= 6 && c.length <= 20) score += 2;
      if (c.length > 26) score -= 2;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = (scored[0]?.c || fallback).replace(/[“”"]/g, "").replace(/^[（(【\s]+/, "").trim();
  return best.length > 26 ? best.slice(0, 25) + "…" : best;
}

function sceneLayout(idx, total, words, clauses, hero, numericClauses) {
  if (idx === 0) return "hero";
  if (idx === total - 1) return "closing";
  if (numericClauses.length >= 2) return "bars";
  if (hero && numericClauses.length >= 1 && words.length <= 90) return "number";
  if (/(第一|第二|其一|其二|首先|其次)/.test(words) && clauses.length >= 2) return "list";
  if (/(相比|对比|而|却|高于|低于|相反)/.test(words) && clauses.length >= 2) return "compare";
  if (clauses.length >= 2) return "band";
  return "abstract";
}

let scenes = groups.map(([from, to], idx) => {
  const lines = sentences.slice(from, to);
  const words = lines.join("");
  const clauses = lines
    .flatMap((s) => splitClauses(s))
    .map(cleanClause)
    .filter((c) => c.length >= 2);

  const heroCandidates = lines.map(pickHeroNumber).filter(Boolean);
  const hero = heroCandidates.sort((a, b) => (b.unit === "%" ? 1 : 0) - (a.unit === "%" ? 1 : 0))[0] || null;

  const numericClauses = clauses.filter((c) => /\d/.test(c));
  const title = pickTitle(clauses, clauses[0] || "…");
  const layout = sceneLayout(idx, groups.length, words, clauses, hero, numericClauses);

  const stripMarks = (c) => c.replace(/[“”"]/g, "");
  const DROP_LEAD = /^(这|那|为什么|为何|如何|怎样|怎么|是否|不管|不论|无论|如果|假如|即使|哪怕)/;
  const CUT_LEAD = /^(但是|但|而是|所以|因此|因为|不过|另外|同时|而且|并且|以及|包括|其中)/;
  const bullets = clauses
    .map(stripMarks)
    .filter((c) => c !== title && c.length >= 3 && !DROP_LEAD.test(c))
    .map((c) => c.replace(CUT_LEAD, "").trim())
    .filter((c) => c.length >= 3)
    .map((c) => (c.length > 22 ? c.slice(0, 22) : c))
    .slice(0, 3);

  const emphasis = [];
  for (const line of lines) {
    for (const m of line.matchAll(/(\d+(?:\.\d+)?\s*(?:%|倍|亿|万|年|个月)?)/g)) {
      const t = m[1].trim();
      if (t && !emphasis.includes(t)) emphasis.push(t);
    }
  }

  const lineIds = slides.slice(from, to).map((s) => s.id);
  let barTitle = "专题";
  if (idx === 0) barTitle = "开场";
  else if (idx === groups.length - 1) barTitle = "行动建议";
  else if (/遗产承办|冻结|承办程序/.test(words)) barTitle = "遗产承办";
  else if (/跨国|英国|美国|40%/.test(words)) barTitle = "跨境税务";
  else if (/内地/.test(words)) barTitle = "内地税制";
  else if (/2006|废除/.test(words)) barTitle = "政策沿革";
  else if (/信托|保险|家族/.test(words)) barTitle = "传承工具";
  else if (/高净值|大本营/.test(words)) barTitle = "财富枢纽";

  const photo = photoForScene(barTitle, words);

  return {
    id: `sc${String(idx + 1).padStart(2, "0")}`,
    index: idx,
    total: groups.length,
    kicker: `${String(idx + 1).padStart(2, "0")} / ${String(groups.length).padStart(2, "0")}`,
    barTitle,
    tag: barTitle,
    layout,
    title,
    bullets,
    number: hero ? hero.number : "",
    unit: hero ? simplifyUnit(hero.unit) : "",
    emphasis,
    lines,
    lineIds,
    speech: joinSentences(lines),
    photoKey: photo.key,
    photoQuery: photo.query,
    wikiTitle: photo.wikiTitle,
    mood: layout === "hero" || layout === "closing" ? "dramatic" : "steady",
  };
});

// 避免连续两幕同一版式造成节奏单一
for (let i = 1; i < scenes.length - 1; i += 1) {
  const cur = scenes[i];
  const prev = scenes[i - 1];
  if (cur.layout === prev.layout && (cur.layout === "abstract" || cur.layout === "band")) {
    const next = scenes[i + 1];
    cur.layout = cur.layout === "band" ? "abstract" : next?.layout === "band" ? "list" : "band";
  }
}

let planSource = "heuristic";

function emphasisOf(lines) {
  const list = [];
  for (const line of lines) {
    for (const m of line.matchAll(/(\d+(?:\.\d+)?\s*(?:%|倍|亿|万|年|个月)?)/g)) {
      const token = m[1].trim();
      if (token && !list.includes(token)) list.push(token);
    }
  }
  return list;
}

try {
  const totalChars = sentences.join("").replace(/\s/g, "").length;
  console.log(`[01] 文案解析：${sentences.length} 句 / ${totalChars} 字`);
  const cfg = loadAiConfig();
  if (cfg.enabled) {
    const hasKey = Boolean(resolveApiKey(cfg));
    console.log(`[01] AI 分镜：${cfg.model} @ ${cfg.baseUrl}（key ${hasKey ? "已配置" : `缺失：${cfg.keyEnv}`}，temperature ${cfg.temperature}）`);
    if (hasKey) console.log("[01] 正在请求模型，等待结构化分镜…");
  }

  const planned = await planScenes(sentences);
  if (planned.ok && planned.scenes.length >= 4) {
    const usage = planned.usage
      ? `tokens ${planned.usage.prompt_tokens ?? "?"}+${planned.usage.completion_tokens ?? "?"}`
      : "tokens 未返回";
    console.log(`[01] AI 返回正常：${(planned.elapsedMs / 1000).toFixed(1)}s，${usage}，${planned.scenes.length} 幕`);
    scenes = planned.scenes.map((item, idx) => {
      const lines = item.sentences.map((n) => sentences[n - 1]).filter(Boolean);
      const lineIds = item.sentences.map((n) => slides[n - 1]?.id).filter(Boolean);
      return {
        id: `sc${String(idx + 1).padStart(2, "0")}`,
        index: idx,
        total: planned.scenes.length,
        kicker: `${String(idx + 1).padStart(2, "0")} / ${String(planned.scenes.length).padStart(2, "0")}`,
        barTitle: item.barTitle,
        tag: item.barTitle,
        layout: item.layout,
        title: item.title,
        bullets: item.bullets,
        number: item.number,
        unit: item.unit,
        emphasis: emphasisOf(lines),
        lines,
        lineIds,
        speech: joinSentences(lines),
        photoKey: item.photoKey,
        photoQuery: item.photoQuery,
        wikiTitle: item.wikiTitle,
        mood: item.mood,
      };
    });
    planSource = `ai:${planned.model}`;
    fs.writeFileSync(
      path.join(path.dirname(outPath), "plan.ai.json"),
      JSON.stringify({ model: planned.model, createdAt: new Date().toISOString(), scenes: planned.scenes }, null, 2),
      "utf8",
    );
    console.log(`分镜来源：AI（${planned.model}）`);
    for (const s of scenes) {
      console.log(
        `[01] ${s.id} [${s.layout}] 「${s.title}」 · ${s.lines.length} 句 / ${s.bullets.length} 要点 · 图 ${s.photoKey}` +
          (s.photoQuery ? ` ← "${s.photoQuery}"` : ""),
      );
    }
  } else if (planned.reason && planned.reason !== "disabled") {
    console.warn(`[01] AI 分镜不可用：${planned.reason}；已回退规则版`);
    if (planned.preview) console.warn(`[01] 模型原始输出片段：${planned.preview}`);
    if (planned.elapsedMs) console.warn(`[01] 本次请求耗时 ${(planned.elapsedMs / 1000).toFixed(1)}s`);
  } else {
    console.log("[01] 分镜来源：规则版（AI 未启用）");
  }
} catch (err) {
  console.warn(`[01] AI 分镜异常：${err?.message || err}；已回退规则版`);
}

const FOOD_RE = /吃|美食|餐厅|火锅|生蚝|乳鸽|椰子鸡|探店|小吃|茶餐厅|烧味|手信/;

function cleanSeriesText(input) {
  return String(input || "")
    .replace(/\*\*/g, "")
    .replace(/^[#>\-\s"'“”‘’]+/u, "")
    .replace(/["'“”‘’]/g, "")
    .replace(/[。！？!?；;，,、\s]+$/u, "")
    .trim();
}

function fitSeriesTitle(input, max = 12) {
  const chars = Array.from(cleanSeriesText(input));
  if (!chars.length) return "";
  return chars
    .slice(0, max)
    .join("")
    .replace(/[的了吗呢吧啊和与及或在把被让给为是]+$/u, "")
    .trim();
}

function keywordSeriesTitle(corpus) {
  const suffix = corpus.match(/小技巧|技巧|指南|攻略|清单|方法|常识|知识|教程|秘籍|秘笈|避坑|测评/u);
  if (!suffix) return "";
  const before = Array.from(corpus.slice(Math.max(0, suffix.index - 4), suffix.index).replace(/[^\u4e00-\u9fa5]/gu, ""))
    .slice(-2)
    .join("");
  return `${before}${suffix[0]}`;
}

function deriveSeries(text, sentenceList, slideList = []) {
  const corpus = `${text} ${sentenceList.join("")}`;
  const cities = [
    ["深圳", /深圳|罗湖|福田|南山|宝安|龙岗|盐田/],
    ["香港", /香港|维港|中环|港岛|九龙|新界/],
    ["上海", /上海|外滩|浦东|陆家嘴/],
    ["北京", /北京|朝阳|海淀|国贸/],
  ];
  const city = cities.find(([, re]) => re.test(corpus))?.[0] || "";
  const food = FOOD_RE.test(corpus);

  const firstSentence = sentenceList[0] || text;
  const clauses = splitClauses(firstSentence).map(cleanSeriesText).filter(Boolean);
  const headline = cleanSeriesText(slideList[0]?.title) || clauses[0] || cleanSeriesText(firstSentence);
  const headlineLength = Array.from(headline).length;

  let title = headlineLength >= 4 && headlineLength <= 12 ? headline : "";
  if (!title) {
    const hint = keywordSeriesTitle(corpus);
    if (hint) title = city && !hint.includes(city) ? `${city}${hint}` : hint;
  }
  if (!title && city && food) title = `${city}美食攻略`;
  if (!title) title = fitSeriesTitle(headline);
  if (Array.from(title).length < 4) {
    if (city) title = `${city}生活指南`;
    else if (food) title = "美食探店清单";
    else title = "生活实用指南";
  }

  const taglineCandidates = [
    ...clauses.slice(1),
    ...splitClauses(sentenceList[1] || "").map(cleanSeriesText),
  ].filter((item) => item.length >= 6 && item !== title);
  const tagline = fitSeriesTitle(taglineCandidates[0] || "", 22) || "一条视频讲清楚";
  return { title, tagline };
}

const CITY_KEY = cityPhotoKey(`${raw} ${sentences.join("")}`);
for (let i = 0; i < scenes.length; i += 1) {
  const scene = scenes[i];
  let key = scene.photoKey || "topic";
  let query = scene.photoQuery;
  let wikiTitle = scene.wikiTitle;
  if (/^coconut.*(chicken|pot)/.test(key)) {
    key = "coconut-chicken-soup";
    query = "";
    wikiTitle = "";
  }
  if (
    CITY_KEY &&
    (i === 0 || i === scenes.length - 1) &&
    /(food|street|market|friends|people|gathering|dinner|table)/.test(key)
  ) {
    key = CITY_KEY;
    query = "";
    wikiTitle = "";
  }
  scene.photoKey = key;
  scene.photoQuery = query;
  scene.wikiTitle = wikiTitle;
}

for (const scene of scenes) {
  scene.photoSource = "network";
  scene.networkPhotoKey = scene.photoKey || "topic";
  scene.networkPhotoQuery = scene.photoQuery || "";
  scene.networkWikiTitle = scene.wikiTitle || "";
}

let photoOverrides = {};
try {
  const saved = JSON.parse(fs.readFileSync(photoOverrideFile, "utf8").replace(/^\uFEFF/, ""));
  if (saved?.scriptHash === scriptHash && saved.scenes && typeof saved.scenes === "object") {
    photoOverrides = saved.scenes;
  }
} catch {
  photoOverrides = {};
}

const materialManifestFile = path.join(paths.root, "assets", "materials", "manifest.json");
let materialItems = [];
let materialsHash = "";
try {
  const rawManifest = fs.readFileSync(materialManifestFile, "utf8");
  materialsHash = crypto.createHash("sha1").update(rawManifest).digest("hex").slice(0, 16);
  const parsed = JSON.parse(rawManifest.replace(/^\uFEFF/, ""));
  materialItems = Array.isArray(parsed?.items)
    ? parsed.items.filter((item) => item && item.key && item.chapter)
    : [];
} catch {
  materialItems = [];
}

const materialPools = new Map();
for (const item of materialItems) {
  const chapter = String(item.chapter || "未分章").trim() || "未分章";
  if (!materialPools.has(chapter)) materialPools.set(chapter, []);
  materialPools.get(chapter).push(item);
}

const materialChapterNames = [...materialPools.keys()]
  .filter((name) => name !== "未分章")
  .sort((a, b) => b.length - a.length);

function chapterAliases(name) {
  const clean = String(name).trim();
  const base = clean.replace(/[篇章节]$/u, "");
  return [...new Set([clean, base].filter((item) => item.length >= 2))].sort((a, b) => b.length - a.length);
}

function matchMaterialChapter(scene) {
  const corpus = `${scene.barTitle || ""} ${scene.title || ""} ${scene.speech || ""}`;
  for (const chapter of materialChapterNames) {
    if (chapterAliases(chapter).some((alias) => corpus.includes(alias))) return chapter;
  }
  return "";
}

const materialUsage = new Map();
function takeMaterial(chapter) {
  const pool = materialPools.get(chapter);
  if (!pool?.length) return null;
  const used = materialUsage.get(chapter) || 0;
  materialUsage.set(chapter, used + 1);
  return pool[used % pool.length];
}

let customSceneCount = 0;
for (const scene of scenes) {
  const chapter = matchMaterialChapter(scene);
  const fallback = chapter ? "" : "未分章";
  const item = takeMaterial(chapter || fallback);
  if (!item) continue;
  scene.chapter = chapter || "未分章";
  scene.photoKey = item.key;
  scene.photoQuery = "";
  scene.wikiTitle = "";
  scene.materialName = item.name || "";
  scene.photoSource = "material";
  customSceneCount += 1;
}
if (customSceneCount) {
  console.log(`[01] 自定义素材：${materialItems.length} 张 / ${materialPools.size} 章，已匹配 ${customSceneCount} 幕`);
  for (const scene of scenes) {
    if (scene.materialName) console.log(`[01] ${scene.id} 使用素材「${scene.materialName}」（${scene.chapter}）`);
  }
}

for (const scene of scenes) {
  const override = photoOverrides[scene.id];
  if (override?.source === "network") {
    scene.photoKey = scene.networkPhotoKey || "topic";
    scene.photoQuery = scene.networkPhotoQuery || "";
    scene.wikiTitle = scene.networkWikiTitle || "";
    scene.chapter = "";
    scene.materialName = "";
    scene.photoSource = "network";
  } else if (override?.source === "material" && override.previous?.photoKey) {
    scene.photoKey = override.previous.photoKey;
    scene.photoQuery = override.previous.photoQuery || "";
    scene.wikiTitle = override.previous.wikiTitle || "";
    scene.chapter = override.previous.chapter || "";
    scene.materialName = override.previous.materialName || "";
    scene.photoSource = "material";
  }
}

const series = deriveSeries(raw, sentences, slides);
if (seriesTitleArg) series.title = fitSeriesTitle(cleanSeriesText(seriesTitleArg), 18);
if (seriesTaglineArg) series.tagline = fitSeriesTitle(cleanSeriesText(seriesTaglineArg), 28);

const payload = {
  meta: {
    title: path.basename(scriptPath),
    source: path.basename(scriptPath),
    width: video.width,
    height: video.height,
    fps: video.fps,
    createdAt: new Date().toISOString(),
    version: 2,
    planner: planSource,
    seriesTitle: series.title,
    seriesTagline: series.tagline,
    scriptHash,
    materialsHash,
  },
  slides,
  scenes,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");

console.log(`分镜完成：${slides.length} 句 / ${scenes.length} 幕 -> ${outPath}`);
for (const s of scenes) {
  console.log(
    `  ${s.id} [${s.layout}] ${s.title}` +
      (s.number ? ` | ${s.number}${s.unit}` : "") +
      ` | ${s.lineIds.length} 句` +
      (s.photoKey ? ` | 图 ${s.photoKey}` : ""),
  );
}
