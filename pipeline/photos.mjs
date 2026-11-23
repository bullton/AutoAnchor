import fs from "node:fs";
import path from "node:path";

const API = "https://commons.wikimedia.org/w/api.php";
const WIKI = "https://en.wikipedia.org/w/api.php";
const UA = "OralVideoPipeline/1.0 (local project)";
const LICENSE_OK = ["cc0", "public domain", "cc by", "cc-by"];
const STOP = new Set([
  "the","a","an","of","in","on","at","and","or","for","with","from","to","city","view","day","night",
  "building","buildings","people","person","photo","image","stock","modern","skyline",
]);

/** 出现这些词时，画面里大概率有人物，优先选中国人/华人素材 */
const PEOPLE = /\b(people|person|persons|man|men|woman|women|boy|boys|girl|girls|child|children|kid|kids|player|players|coach|coaches|team|teams|student|students|teacher|teachers|worker|workers|farmer|farmers|fisherman|fishermen|chef|chefs|cook|cooks|crowd|crowds|fan|fans|athlete|athletes|footballer|footballers|resident|residents|passenger|passengers|customer|customers|family|families|dancer|dancers|soldier|soldiers|officer|officers|doctor|doctors|nurse|nurses|businessman|businessmen|businesswoman|businesswomen|volunteer|volunteers|reporter|reporters|anchor|anchors|crew|journalist|journalists|presenter|presenters|host|hosts|guest|guests|speaker|speakers|official|officials|minister|ministers|president|ceo|founder|investor|investors|tourist|tourists|traveler|travelers|commuter|commuters|shopper|shoppers|vendor|vendors|seller|sellers|buyer|buyers|patient|patients|conference|interview|meeting|handshake|ceremony|audience|speech)\b/i;

const CHINA_LATIN = /\b(china|chinese|prc|beijing|shanghai|shenzhen|guangzhou|hangzhou|chengdu|wuhan|chongqing|nanjing|tianjin|suzhou|xiamen|qingdao|kunming|harbin|urumqi|lhasa|xi'?an|hong ?kong|macau|macao|taiwan|taipei|asian|asia)\b/i;
const CHINA_CJK = /(中国|中华|北京|上海|广州|深圳|杭州|成都|武汉|重庆|南京|天津|苏州|厦门|青岛|昆明|哈尔滨|乌鲁木齐|拉萨|香港|澳门|台湾|台北)/;

// 维基条目描述里出现这些词，说明是"人物条目"，应优先使用其本人照片
const PERSON_DESC = /\b(born|businessman|businesswoman|business magnate|entrepreneur|executive|chief executive|ceo|founder|co-founder|engineer|scientist|physicist|chemist|economist|politician|statesman|diplomat|actor|actress|singer|musician|rapper|athlete|footballer|soccer player|basketball player|tennis player|baseball player|player|coach|manager|journalist|reporter|news anchor|anchor|presenter|writer|author|novelist|poet|artist|painter|sculptor|director|filmmaker|producer|investor|philanthropist|royal|president|prime minister|minister|governor|mayor|general|admiral|lawyer|attorney|judge|professor|scholar|model|designer|architect|chef|monk|priest|emperor|king|queen|prince|princess|duke|activist)\b/i;

const ACTION = new Set(["playing", "play", "instructing", "instruction", "training", "train", "small", "sided", "game", "games"]);
const PEOPLE_CJK = /(小学|中学|大学|学生|孩子|儿童|少年|青年|球员|队员|教练|老师|市民|人群|家庭|游客|顾客|工人|农民|医生|护士|记者|主持|观众|足球员|运动员)/;
const SCENE = /(训练|比赛|联赛|赛场|球场|踢球|运动|冠军|合影|学生|队员|球队|school|training|match|league|game|playing|team|players)/i;
const PROMO_TITLE = /(冠军赛|荣获冠军|总冠军|奖杯|发布会|启动仪式|开幕式|闭幕式|合影|trophy|champion|ceremony|award|press)/i;
const SUBJECT_CN = {
  football: ["足球"],
  soccer: ["足球"],
  basketball: ["篮球"],
  tennis: ["网球"],
  volleyball: ["排球"],
  swimming: ["游泳"],
  running: ["跑步", "马拉松"],
  training: ["训练", "集训", "练习"],
  coach: ["教练", "主帅", "指导"],
  instructing: ["指导", "教练"],
  youth: ["青训", "青少年", "少年", "青年"],
  children: ["孩子", "儿童", "小学", "小学生"],
  kids: ["孩子", "儿童", "小学", "小学生"],
  grass: ["草皮", "草地", "草坪"],
  field: ["球场", "场地"],
  playing: ["踢球", "比赛"],
  match: ["比赛", "联赛", "赛场"],
  food: ["美食", "菜"],
  dish: ["菜"],
  restaurant: ["餐厅", "餐馆"],
  city: ["城市"],
  building: ["建筑"],
  school: ["学校"],
  hospital: ["医院"],
  street: ["街道", "街"],
  park: ["公园"],
  mountain: ["山"],
  beach: ["海滩", "沙滩"],
  train: ["火车"],
  bus: ["公交"],
  car: ["汽车"],
  computer: ["电脑"],
  phone: ["手机"],
  money: ["钱", "货币"],
  bank: ["银行"],
  house: ["房子", "住宅"],
  snow: ["雪"],
  rain: ["雨"],
  pitch: ["球场"],
  stadium: ["体育场", "球场"],
};

const mentionsPeople = (text) => PEOPLE.test(String(text || "")) || PEOPLE_CJK.test(String(text || ""));
const chinaRelated = (text) => {
  const value = String(text || "")
    .replace(/china lake/gi, " ")
    .replace(/chinese six/gi, " ");
  return CHINA_LATIN.test(value) || CHINA_CJK.test(value);
};
/** 取图时的强证据：描述里的中国地名常是无关提及，只认标题与中文内容 */
const chinaStrong = (title, description = "") =>
  CHINA_CJK.test(`${title} ${description}`) || CHINA_LATIN.test(String(title || ""));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, attempt = 0) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 429) {
    if (attempt >= 3) throw new Error("HTTP 429（限流）");
    await sleep(8000 + attempt * 7000);
    return fetchJson(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function encode(params) {
  return new URLSearchParams(params).toString();
}

async function search(query) {
  const url = `${API}?${encode({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "10",
    prop: "imageinfo",
    iiprop: "url|extmetadata|size",
    iiurlwidth: "1600",
  })}`;
  const data = await fetchJson(url);
  return Object.values(data?.query?.pages || {});
}

/** 只接受照片类位图，SVG/GIF/图标一类直接排除 */
function photoLike(title) {
  return !/\.(svg|gif|tif|tiff|webp)$/i.test(String(title || ""));
}

const stripHtml = (value) =>
  String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function tokens(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/** 关键词重合度：标题/描述至少有 1 个非通用词命中，避免抓回完全无关的图 */
function relevant(query, title, description) {
  const want = tokens(query);
  if (!want.length) return true;
  const hay = new Set([...tokens(title), ...tokens(description)]);
  return want.some((t) => hay.has(t));
}

function pick(pages, query, { chinese = false, strict = false, exclude = new Set() } = {}) {
  const pool = [];
  for (const page of pages) {
    const info = page?.imageinfo?.[0];
    if (!info?.thumburl) continue;
    if (!photoLike(page.title)) continue;
    const meta = info.extmetadata || {};
    const license = String(meta.LicenseShortName?.value || "");
    if (license && !LICENSE_OK.some((k) => license.toLowerCase().includes(k))) continue;
    const width = Number(info.width) || 0;
    const height = Number(info.height) || 0;
    if (width < 1100 || height < 700) continue;
    const description = stripHtml(meta.ImageDescription?.value || "");
    const searchable = `${page.title || ""} ${description} ${info.descriptionurl || ""}`;
    const hasCjk = /[\u4e00-\u9fff]/.test(searchable);
    if (!(chinese && hasCjk) && !relevant(query, page.title || "", description)) continue;
    const hayTokens = new Set(tokens(`${page.title || ""} ${description}`));
    const subject = tokens(query).filter((word) => !PEOPLE.test(word) && !CHINA_LATIN.test(word));
    const hits = subject.filter((word) =>
      hasCjk ? (SUBJECT_CN[word] || []).some((cn) => searchable.includes(cn)) : hayTokens.has(word),
    );
    if (chinese && subject.length && !hits.length) continue;
    pool.push({
      url: info.thumburl,
      title: page.title || "",
      license,
      author: stripHtml(meta.Artist?.value || "").slice(0, 80),
      source: info.descriptionurl || "",
      china: chinaStrong(page.title || "", description),
      people: mentionsPeople(searchable),
      scene: SCENE.test(searchable),
      promo: PROMO_TITLE.test(page.title || ""),
      score: hits.length,
    });
  }
  const available = pool.filter((item) => !exclude.has(item.title));
  const base = available.length ? available : pool;
  if (!chinese) return base[0] || null;
  const chinesePool = base.filter((item) => item.china);
  const ordered = [...chinesePool].sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.promo) - Number(b.promo) ||
      Number(b.people && b.scene) - Number(a.people && a.scene) ||
      Number(b.people) - Number(a.people) ||
      Number(b.scene) - Number(a.scene),
  );
  if (strict && !ordered.length) return null;
  return ordered[0] || base[0] || null;
}

/** 用维基百科条目首图，通常比全文检索更贴合主题、画质也更好 */
async function pageImage(title) {
  if (!title) return null;
  const url = `${WIKI}?${encode({
    action: "query",
    format: "json",
    titles: title,
    prop: "pageimages|description",
    piprop: "name|thumbnail",
    pithumbsize: "1600",
    redirects: "1",
  })}`;
  let data;
  try {
    data = await fetchJson(url);
  } catch {
    return null;
  }
  const page = Object.values(data?.query?.pages || {})[0];
  if (!page?.pageimage || !photoLike(page.pageimage)) return null;
  const hit = await fileInfo(`File:${page.pageimage}`);
  if (hit) {
    const description = String(page.description || "");
    hit.china = chinaStrong(hit.title);
    hit.description = description;
    hit.person = PERSON_DESC.test(description);
  }
  return hit;
}

async function fileInfo(fileTitle) {
  const url = `${API}?${encode({
    action: "query",
    format: "json",
    titles: fileTitle,
    prop: "imageinfo",
    iiprop: "url|extmetadata|size",
    iiurlwidth: "1600",
  })}`;
  let data;
  try {
    data = await fetchJson(url);
  } catch {
    return null;
  }
  const page = Object.values(data?.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info?.thumburl) return null;
  if (!photoLike(fileTitle)) return null;
  const meta = info.extmetadata || {};
  const license = String(meta.LicenseShortName?.value || "");
  if (license && !LICENSE_OK.some((k) => license.toLowerCase().includes(k))) return null;
  if ((Number(info.width) || 0) < 1100) return null;
  return {
    url: info.thumburl,
    title: page.title || fileTitle,
    license,
    author: stripHtml(meta.Artist?.value || "").slice(0, 80),
    source: info.descriptionurl || "",
  };
}

/** 统一走 Special:FilePath 取缩略图，避免直连原图被 upload.wikimedia.org 限流 */
function thumbUrl(fileTitle, width = 1200) {
  const name = String(fileTitle || "").replace(/^File:/, "");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;
}

async function download(url, attempt = 0) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/*" } });
  if (res.status === 429 || res.status === 503) {
    if (attempt >= 3) throw new Error(`HTTP ${res.status}（图片下载限流）`);
    const wait = Number(res.headers.get("retry-after")) * 1000 || 6000 + attempt * 9000;
    await sleep(Math.min(wait, 45000));
    return download(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = String(res.headers.get("content-type") || "");
  if (type && !/^image\//i.test(type)) throw new Error(`非图片内容：${type}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 为缺失的 photoKey 抓图。返回 { fetched:[], failed:[] }
 */
export async function fetchMissingPhotos(root, requests, log = console.log) {
  const photoDir = path.join(root, "assets", "photos");
  const manifestFile = path.join(photoDir, "manifest.json");
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    manifest = {};
  }

  const exts = [".jpg", ".jpeg", ".png", ".webp"];
  const has = (key) => exts.some((ext) => fs.existsSync(path.join(photoDir, `${key}${ext}`)));

  const fetched = [];
  const failed = [];
  const usedTitles = new Set();
  fs.mkdirSync(photoDir, { recursive: true });

  for (const { key, query, wikiTitle } of requests) {
    if (!key || has(key)) continue;
    const q = String(query || key.replace(/-/g, " ")).trim();
    const wantsPeople = mentionsPeople(q) || mentionsPeople(wikiTitle || "");
    const wikiHit = wikiTitle ? await pageImage(wikiTitle) : null;
    const namedPerson = Boolean(wikiHit?.person);
    const label = namedPerson ? `指名人物 ${wikiTitle}` : wantsPeople ? "优先中国人物" : "";
    log(`[03] 补图 ${key} ← "${q}"${wikiTitle ? `（条目 ${wikiTitle}）` : ""}${label ? `（${label}）` : ""}`);
    try {
      let hit = null;
      if (namedPerson) {
        hit = wikiHit;
        log(`[03] 指名人物采用本人照片：${wikiHit.title}`);
      } else if (wantsPeople) {
        for (const fileTitle of curatedTitles(q)) {
          if (usedTitles.has(fileTitle)) continue;
          const info = await commonsFile(fileTitle);
          if (!info) continue;
          hit = { ...info, china: true, people: true };
          log(`[03] 采用中国人物精选图：${info.title}`);
          break;
        }
      }
      if (!hit && !namedPerson && wikiHit) {
        if (!relevant(q, wikiHit.title, wikiHit.description || "")) {
          log(`[03] 条目首图不相关（${wikiHit.title}），改用检索`);
        } else if (wantsPeople && !wikiHit.china) {
          log(`[03] 条目首图非中国人物（${wikiHit.title}），改用检索`);
        } else {
          hit = wikiHit;
          log(`[03] 采用条目首图：${wikiHit.title}${wikiHit.china ? "（中国相关）" : ""}`);
        }
      }
      if (!hit) {
        const words = tokens(q);
        const tries = words.length ? [3, 2, 1].map((n) => words.slice(0, n).join(" ")) : [];
        const keywords = words.filter((word) => !ACTION.has(word));
        const generic = keywords.length ? keywords.join(" ") : q;
        const head = keywords.slice(0, 2).join(" ");
        const tail = keywords.slice(-2).join(" ");
        const youthFootball = /\bfootball\b/i.test(q) && /\b(youth|kids?|children|junior|school|academy)\b/i.test(q);
        const coachLike = /\b(coach|instructing|instruction|training|practice)\b/i.test(q);
        const coachWord = /\b(coach|instructing|instruction)\b/i.test(q);
        const cnSpecific = youthFootball
          ? [
              coachWord ? "教练 足球 训练" : "",
              /\b(coach|training|instructing|practice)\b/i.test(q) ? "China youth football training" : "",
              /\b(children|kids?|small|sided|game|match)\b/i.test(q) ? "Chinese children playing football" : "",
              /\b(grass|field|grassroots|community)\b/i.test(q) ? "China grassroots football" : "",
              "China youth football",
            ].filter(Boolean)
          : coachLike
            ? ["教练 足球 训练"]
            : [];
        const cnTries = wantsPeople
          ? chinaRelated(q)
            ? [q, ...tries]
            : [
                ...cnSpecific,
                `Chinese ${q}`,
                `China ${q}`,
                `Chinese ${generic}`,
                `China ${generic}`,
                head ? `Chinese ${head}` : "",
                tail ? `Chinese ${tail}` : "",
                ...tries.map((item) => `Chinese ${item}`),
              ].filter(Boolean)
          : [];
        const lookups = [...new Set([...cnTries, q, ...tries])];
        let fallback = null;
        for (const lookup of lookups) {
          if (!lookup) continue;
          const preferChinese = wantsPeople && chinaRelated(lookup);
          if (lookup !== q) log(`[03] 检索式 "${lookup}"`);
          const candidate = pick(await search(lookup), q, {
            chinese: wantsPeople,
            strict: preferChinese,
            exclude: usedTitles,
          });
          if (candidate) {
            if (wantsPeople && !candidate.people) {
              if (!fallback) fallback = candidate;
              log(`[03] 暂不采用无人物素材：${candidate.title}`);
              await sleep(500);
              continue;
            }
            hit = candidate;
            break;
          }
          await sleep(800);
        }
        if (!hit && fallback) hit = fallback;
        if (hit && wantsPeople && !hit.china) log(`[03] 未找到中国人物素材，暂用通用图：${hit.title}`);
      }
      if (!hit) {
        failed.push(key);
        log(`[03] 补图失败 ${key}：没有匹配的 CC0/CC BY 图片`);
        continue;
      }
      usedTitles.add(hit.title);
      const buffer = await download(thumbUrl(hit.title));
      fs.writeFileSync(path.join(photoDir, `${key}.jpg`), buffer);
      manifest[key] = { author: hit.author, license: hit.license, source: hit.source, title: hit.title };
      fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
      fetched.push(key);
      log(`[03] 补图完成 ${key}：${Math.round(buffer.length / 1024)} KB · ${hit.license} · ${hit.author}`);
      await sleep(3000);
    } catch (err) {
      failed.push(key);
      log(`[03] 补图失败 ${key}：${err?.message || err}`);
    }
  }
  return { fetched, failed };
}

/** 已验证的中国人物足球素材，优先于全文检索，避免关键词误配到无关图片 */
const CURATED_PEOPLE = {
  football: {
    coach: ["File:Shao Jiayi 2026.jpg", "File:Lü Zhuoyi 2026.jpg", "File:Zhang Yuning 2026.jpg"],
    action: ["File:旧宫一小--孙晨.jpg"],
    team: ["File:孙晨--旧宫一小.jpg", "File:北京市小学生足球“小球”联赛获冠军.jpg"],
    trophy: ["File:孙晨.jpg"],
  },
};

function curatedTitles(q) {
  if (!/\b(football|soccer)\b/i.test(q)) return [];
  const youth = /\b(youth|kids?|children|junior|school|academy)\b/i.test(q);
  const grass = /\b(grass|field|grassroots|community)\b/i.test(q);
  const coach = /\b(coach|instructing|instruction|training|practice)\b/i.test(q);
  const coachWord = /\b(coach|instructing|instruction)\b/i.test(q);
  const groups = CURATED_PEOPLE.football;
  const order = [];
  if (coachWord) order.push(groups.coach);
  else if (grass) order.push(groups.action, groups.team, groups.trophy);
  else if (youth) order.push(groups.team, groups.action, groups.trophy);
  else order.push(groups.action, groups.team, groups.trophy);
  if (coach && !coachWord) order.push(groups.coach);
  return [...new Set(order.flat())];
}

async function commonsFile(fileTitle) {
  const url = `${API}?${encode({
    action: "query",
    format: "json",
    titles: fileTitle,
    prop: "imageinfo",
    iiprop: "url|extmetadata|size",
    iiurlwidth: "1600",
  })}`;
  const data = await fetchJson(url);
  const page = Object.values(data?.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  if (!info?.thumburl) return null;
  const meta = info.extmetadata || {};
  return {
    title: page.title || fileTitle,
    fileTitle: page.title || fileTitle,
    thumb: thumbUrl(page.title || fileTitle, 480),
    license: String(meta.LicenseShortName?.value || ""),
    author: stripHtml(meta.Artist?.value || "").slice(0, 80),
    source: info.descriptionurl || "",
  };
}

function candidateFromPage(page) {
  const info = page?.imageinfo?.[0];
  if (!info?.thumburl) return null;
  if (!photoLike(page.title)) return null;
  const meta = info.extmetadata || {};
  const license = String(meta.LicenseShortName?.value || "");
  if (license && !LICENSE_OK.some((k) => license.toLowerCase().includes(k))) return null;
  const width = Number(info.width) || 0;
  const height = Number(info.height) || 0;
  if (width < 900 || height < 500) return null;
  return {
    title: page.title || "",
    fileTitle: page.title || "",
    thumb: thumbUrl(page.title, 480),
    width,
    height,
    license,
    author: stripHtml(meta.Artist?.value || "").slice(0, 80),
    source: info.descriptionurl || "",
  };
}

/** 搜索可替换的网络配图，返回可直接预览的候选列表；涉及人物时优先中国人物 */
export async function searchPhotoCandidates(query, limit = 12) {
  const clean = String(query || "").trim();
  if (!clean) return [];
  const wantsPeople = mentionsPeople(clean) && !chinaRelated(clean);
  const queries = wantsPeople ? [`Chinese ${clean}`, clean] : [clean];
  const seen = new Set();
  const pages = [];
  for (const item of queries) {
    for (const page of await search(item)) {
      const title = String(page?.title || "");
      if (seen.has(title)) continue;
      seen.add(title);
      pages.push(page);
    }
    if (wantsPeople) await sleep(600);
  }
  const candidates = pages.map(candidateFromPage).filter(Boolean);
  if (wantsPeople) {
    const score = (item) => (chinaRelated(`${item.title} ${item.author} ${item.source}`) ? 1 : 0);
    candidates.sort((a, b) => score(b) - score(a));
  }
  return candidates.slice(0, Math.max(1, limit));
}

/** 把选中的网络候选图下载到 assets/photos，并登记来源信息 */
export async function savePhotoCandidate(root, key, candidate) {
  const fileTitle = String(candidate?.fileTitle || candidate?.title || "").trim();
  if (!fileTitle) throw new Error("候选图片缺少文件名");
  const photoDir = path.join(root, "assets", "photos");
  fs.mkdirSync(photoDir, { recursive: true });
  const buffer = await download(thumbUrl(fileTitle, 1600));
  if (!buffer?.length) throw new Error("图片下载为空");
  fs.writeFileSync(path.join(photoDir, `${key}.jpg`), buffer);
  const manifestFile = path.join(photoDir, "manifest.json");
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    manifest = {};
  }
  manifest[key] = {
    author: String(candidate?.author || "").slice(0, 120),
    license: String(candidate?.license || ""),
    source: String(candidate?.source || ""),
    title: fileTitle,
  };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  return { file: path.join(photoDir, `${key}.jpg`), bytes: buffer.length };
}
