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

function pick(pages, query) {
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
    if (!relevant(query, page.title || "", `${description} ${stripHtml(meta.ObjectName?.value || "")}`)) continue;
    return {
      url: info.thumburl,
      title: page.title || "",
      license,
      author: stripHtml(meta.Artist?.value || "").slice(0, 80),
      source: info.descriptionurl || "",
    };
  }
  return null;
}

/** 用维基百科条目首图，通常比全文检索更贴合主题、画质也更好 */
async function pageImage(title) {
  if (!title) return null;
  const url = `${WIKI}?${encode({
    action: "query",
    format: "json",
    titles: title,
    prop: "pageimages",
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
  return fileInfo(`File:${page.pageimage}`);
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
  fs.mkdirSync(photoDir, { recursive: true });

  for (const { key, query, wikiTitle } of requests) {
    if (!key || has(key)) continue;
    const q = String(query || key.replace(/-/g, " ")).trim();
    log(`[03] 补图 ${key} ← "${q}"${wikiTitle ? `（条目 ${wikiTitle}）` : ""}`);
    try {
      let hit = null;
      if (wikiTitle) {
        hit = await pageImage(wikiTitle);
        if (hit && !relevant(q, hit.title, "")) {
          log(`[03] 条目首图不相关（${hit.title}），改用检索`);
          hit = null;
        } else if (hit) {
          log(`[03] 采用条目首图：${hit.title}`);
        }
      }
      if (!hit) {
        const words = tokens(q);
        const tries = words.length ? [3, 2, 1].map((n) => words.slice(0, n).join(" ")) : [q];
        for (const lookup of [...new Set(tries)]) {
          if (!lookup) continue;
          if (lookup !== q) log(`[03] 检索式 "${lookup}"`);
          hit = pick(await search(lookup), q);
          if (hit) break;
          await sleep(800);
        }
      }
      if (!hit) {
        failed.push(key);
        log(`[03] 补图失败 ${key}：没有匹配的 CC0/CC BY 图片`);
        continue;
      }
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
