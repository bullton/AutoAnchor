const $ = (selector) => document.querySelector(selector);
const state = { setup: null, workbuddy: null, imported: false };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function toast(message, kind = "") {
  const box = document.createElement("div");
  box.className = `toast ${kind}`.trim();
  box.textContent = message;
  $("#toasts").appendChild(box);
  setTimeout(() => box.remove(), 4200);
}

async function api(path, options = {}) {
  const init = { ...options };
  if (init.body && typeof init.body === "string") {
    init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function fill(id, value) {
  const el = $(id);
  if (el && value !== undefined && value !== null) el.value = value;
}

function renderChecks(checks) {
  $("#introChecks").innerHTML = checks
    .map((item) => `<span class="check-pill ${item.ok ? "ok" : ""}"><i></i>${esc(item.label)}</span>`)
    .join("");
  $("#runtimeChecks").innerHTML = checks
    .map((item) => `<div class="check-row ${item.ok ? "ok" : ""}"><span>${esc(item.label)}</span><b>${esc(item.text)}</b></div>`)
    .join("");
}

function applySetup(data, recommended) {
  state.setup = data;
  $("#setupState").textContent = data.completed ? "已完成配置 · 可随时回来修改" : "首次配置 · 只保存在本机";
  if (data.checks) renderChecks(data.checks);
  const paths = data.paths || {};
  fill("#pathPython", paths.python);
  fill("#pathFfmpeg", paths.ffmpeg);
  fill("#pathFfprobe", paths.ffprobe);
  fill("#pathChrome", paths.chrome);
  fill("#pathModels", paths.modelsRoot);
  fill("#pathVendor", paths.vendorRoot);
  fill("#pathVoiceStudio", paths.voiceStudioRoot);
  fill("#pathIndextts", paths.indexttsRepo);
  fill("#pathKagglePython", paths.kagglePython);
  fill("#pathKaggleBin", paths.kaggleBin);
  fill("#pathVoiceRef", paths.voiceRef);
  const tts = data.tts || {};
  if (tts.provider) fill("#ttsProvider", tts.provider);
  fill("#vsApiBase", tts.voicestudio?.apiBase || "http://127.0.0.1:3900");
  fill("#ttsRefWav", tts.voicestudio?.refWav || tts.local3?.refWav || tts.cosyvoice?.refWav || tts.indextts?.promptWav || tts.kaggle?.promptWav || "");
  fill("#ttsRefText", tts.voicestudio?.refText || tts.local3?.refText || tts.cosyvoice?.refText || "");
  const kaggle = data.kaggle || {};
  fill("#kaggleUser", kaggle.username || "");
  fill("#kaggleDataset", kaggle.dataset || "");
  fill("#kaggleKernel", kaggle.kernel || "latentsync-dual");
  fill("#kaggleAccelerator", kaggle.accelerator || "NvidiaTeslaT4");
  fill("#kaggleTimeout", kaggle.timeoutMin || 120);
  fill("#kaggleCli", kaggle.cli || "");
  if (kaggle.hasKey || kaggle.hasToken) $("#kaggleKeyHint").textContent = "已保存凭据；留空不会覆盖。";
  const ai = data.ai || {};
  $("#aiEnabled").checked = ai.enabled === true;
  fill("#aiBaseUrl", ai.baseUrl || "https://api.openai.com/v1");
  fill("#aiModel", ai.model || "gpt-4o-mini");
  fill("#aiKeyEnv", ai.keyEnv || "OPENAI_API_KEY");
  if (ai.hasApiKey) $("#aiKeyHint").textContent = "已保存密钥；留空不会覆盖。";
  if (!data.completed && recommended) fill("#ttsProvider", recommended);
}

function renderWorkbuddy(data) {
  state.workbuddy = data;
  const box = $("#workbuddyList");
  const stateEl = $("#workbuddyState");
  if (!data?.found) {
    stateEl.textContent = "未检测到";
    box.innerHTML = `<span class="workbuddy-empty">没有找到本机 WorkBuddy 模型配置，可直接在下面手动填写。</span>`;
    return;
  }
  if (!data.models?.length) {
    stateEl.textContent = "无可用模型";
    box.innerHTML = `<span class="workbuddy-empty">已找到 ${esc(data.file)}，但没有解析到可用模型。</span>`;
    return;
  }
  stateEl.textContent = `${data.models.length} 个可用`;
  box.innerHTML = data.models
    .map(
      (model) => `<div class="workbuddy-item">
        <div><b>${esc(model.name)}</b><br /><span>${esc(model.model)} · ${esc(model.baseUrl)}</span></div>
        <button class="btn tiny" type="button" data-wb="${esc(model.id)}">使用</button>
      </div>`,
    )
    .join("");
  box.querySelectorAll("[data-wb]").forEach((button) => {
    button.addEventListener("click", () => importWorkbuddy(button.dataset.wb, button));
  });
}

async function importWorkbuddy(id, button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "导入中…";
  try {
    const data = await api("/api/setup/workbuddy/import", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
    state.imported = true;
    const ai = data.ai || {};
    $("#aiEnabled").checked = true;
    fill("#aiBaseUrl", ai.baseUrl);
    fill("#aiModel", ai.model);
    $("#aiKeyHint").textContent = "已从 WorkBuddy 导入密钥；留空不会覆盖。";
    toast("已导入 WorkBuddy 模型", "ok");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function uploadRefSample(file) {
  if (!/\.(wav|mp3|m4a|flac)$/i.test(file?.name || "")) {
    toast("仅支持 wav / mp3 / m4a / flac", "error");
    return;
  }
  if (file.size > 40 * 1024 * 1024) {
    toast("文件超过 40MB", "error");
    return;
  }
  const button = $("#ttsUploadBtn");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "上传中…";
  try {
    const res = await fetch("/api/voices/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `上传失败 (${res.status})`);
    const total = Number(data.duration) || 0;
    const clip = await api("/api/voices/clip", {
      method: "POST",
      body: JSON.stringify({ name: data.name, start: 0, duration: Math.min(12, Math.max(0.4, total)) }),
    });
    fill("#ttsRefWav", clip.path || clip.name);
    fill("#ttsRefText", "");
    toast(`样本已就绪：${clip.name} · ${Number(clip.duration || total).toFixed(1)}s`, "ok");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function collect() {
  const provider = $("#ttsProvider").value;
  const refWav = $("#ttsRefWav").value.trim();
  const refText = $("#ttsRefText").value.trim();
  return {
    source: state.imported ? "workbuddy" : "manual",
    paths: {
      python: $("#pathPython").value.trim(),
      ffmpeg: $("#pathFfmpeg").value.trim() || "ffmpeg",
      ffprobe: $("#pathFfprobe").value.trim() || "ffprobe",
      chrome: $("#pathChrome").value.trim(),
      modelsRoot: $("#pathModels").value.trim(),
      vendorRoot: $("#pathVendor").value.trim(),
      voiceStudioRoot: $("#pathVoiceStudio").value.trim(),
      indexttsRepo: $("#pathIndextts").value.trim(),
      kagglePython: $("#pathKagglePython").value.trim(),
      kaggleBin: $("#pathKaggleBin").value.trim(),
      voiceRef: $("#pathVoiceRef").value.trim() || "assets/voice-ref",
    },
    tts: {
      provider,
      voicestudio: {
        apiBase: $("#vsApiBase").value.trim() || "http://127.0.0.1:3900",
        ...(refWav ? { refWav, refText } : {}),
      },
      ...(refWav ? {
        cosyvoice: { refWav, refText },
        local3: { refWav, refText },
        indextts: { promptWav: refWav },
        kaggle: { promptWav: refWav },
      } : {}),
    },
    kaggle: {
      username: $("#kaggleUser").value.trim(),
      key: $("#kaggleKey").value.trim(),
      dataset: $("#kaggleDataset").value.trim(),
      kernel: $("#kaggleKernel").value.trim() || "latentsync-dual",
      accelerator: $("#kaggleAccelerator").value || "NvidiaTeslaT4",
      timeoutMin: Number($("#kaggleTimeout").value) || 120,
      cli: $("#kaggleCli").value.trim(),
    },
    ai: {
      enabled: $("#aiEnabled").checked,
      baseUrl: $("#aiBaseUrl").value.trim(),
      model: $("#aiModel").value.trim(),
      keyEnv: $("#aiKeyEnv").value.trim() || "OPENAI_API_KEY",
      apiKey: $("#aiApiKey").value.trim(),
    },
  };
}

async function save({ pathsOnly = false } = {}) {
  const button = $("#saveBtn");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "保存中…";
  try {
    const body = collect();
    if (pathsOnly) {
      delete body.tts;
      body.ai = { ...body.ai, enabled: false };
    }
    if (!pathsOnly) {
      const provider = body.tts.provider;
      const cfg = body.tts[provider] || {};
      const voice = cfg.refWav || cfg.promptWav;
      if (provider !== "edge" && !voice) {
        throw new Error(`${provider} 需要样本声音，请先上传或选择你自己的录音`);
      }
    }
    const result = await api("/api/setup", { method: "POST", body: JSON.stringify(body) });
    applySetup(result.setup);
    renderWorkbuddy(result.workbuddy);
    $("#saveNote").textContent = "配置已保存。正在进入工作台…";
    toast(pathsOnly ? "已保存运行环境，AI 配置可稍后补" : "配置已保存", "ok");
    setTimeout(() => location.assign("/"), 500);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function detect() {
  const button = $("#detectBtn");
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "检测中…";
  try {
    const data = await api("/api/setup/detect", { method: "POST" });
    const paths = data.paths || {};
    for (const [id, value] of Object.entries({
      "#pathPython": paths.python,
      "#pathFfmpeg": paths.ffmpeg,
      "#pathFfprobe": paths.ffprobe,
      "#pathChrome": paths.chrome,
      "#pathModels": paths.modelsRoot,
      "#pathVendor": paths.vendorRoot,
      "#pathVoiceStudio": paths.voiceStudioRoot,
      "#pathIndextts": paths.indexttsRepo,
      "#pathKagglePython": paths.kagglePython,
      "#pathKaggleBin": paths.kaggleBin,
    })) {
      if (value && !$(id).value.trim()) fill(id, value);
    }
    if (data.env) {
      $("#runtimeChecks").innerHTML = data.env
        .map((item) => `<div class="check-row ${item.ok ? "ok" : ""}"><span>${esc(item.label)}</span><b>${esc(item.text)}</b></div>`)
        .join("");
    }
    if (data.recommendedProvider && !state.setup?.completed) fill("#ttsProvider", data.recommendedProvider);
    renderWorkbuddy(data.workbuddy);
    toast("检测完成，已填入可用路径", "ok");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function init() {
  try {
    const data = await api("/api/setup/detect", { method: "POST" });
    applySetup(data.setup, data.recommendedProvider);
    renderWorkbuddy(data.workbuddy);
    if (data.env) {
      $("#runtimeChecks").innerHTML = data.env
        .map((item) => `<div class="check-row ${item.ok ? "ok" : ""}"><span>${esc(item.label)}</span><b>${esc(item.text)}</b></div>`)
        .join("");
    }
  } catch (err) {
    toast(err.message, "error");
    $("#setupState").textContent = "控制台服务未连接";
  }
  $("#detectBtn").addEventListener("click", detect);
  $("#ttsUploadBtn").addEventListener("click", () => $("#ttsRefFile").click());
  $("#ttsRefFile").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) uploadRefSample(file);
  });
  $("#saveBtn").addEventListener("click", () => save());
  $("#skipLink").addEventListener("click", (event) => {
    event.preventDefault();
    save({ pathsOnly: true });
  });
}

init();
