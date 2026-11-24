const $ = (sel) => document.querySelector(sel);

const RULE_FIELDS = [
  ["ruleGlobal", "global", "countGlobal"],
  ["ruleStoryboard", "storyboard", "countStoryboard"],
  ["ruleMotion", "motion", "countMotion"],
];

let dirty = false;

function toast(message, kind = "") {
  const box = document.createElement("div");
  box.className = "toast" + (kind ? ` ${kind}` : "");
  box.textContent = message;
  $("#toasts").appendChild(box);
  setTimeout(() => box.remove(), 3400);
}

function setDirty(value) {
  dirty = value;
  const el = $("#saveState");
  el.textContent = value ? "未保存" : "已保存";
  el.classList.toggle("dirty", value);
}

async function api(path, opts = {}) {
  const init = { ...opts };
  if (init.body && typeof init.body === "string") {
    init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

function syncCounts() {
  for (const [id, , countId] of RULE_FIELDS) {
    $(countId).textContent = `${String($(id).value || "").length} 字`;
  }
}

async function loadRules() {
  const data = await api("/api/prompts/rules");
  for (const [id, key] of RULE_FIELDS) $(id).value = data[key] || "";
  syncCounts();
  setDirty(false);
}

async function loadAi() {
  const data = await api("/api/ai");
  $("#aiEnabled").checked = data.enabled === true;
  $("#aiBaseUrl").value = data.baseUrl || "";
  $("#aiModel").value = data.model || "";
  $("#aiKeyEnv").value = data.keyEnv || "";
  $("#aiTemperature").value = data.temperature ?? 0.4;
  $("#aiMaxTokens").value = data.maxTokens ?? 2400;
  $("#aiApiKey").value = "";
  $("#aiTag").textContent = data.enabled
    ? data.hasApiKey
      ? `已启用 · ${data.model}`
      : "已启用 · 缺 Key"
    : "未启用";
}

async function loadPreview() {
  $("#previewStoryboard").textContent = "读取中…";
  $("#previewMotion").textContent = "读取中…";
  try {
    const data = await api("/api/prompts?scene=0");
    const storyboard = data.storyboard?.system || "";
    const motion = data.motion?.system || "";
    $("#previewStoryboard").textContent = storyboard || "（暂无）";
    $("#previewMotion").textContent = motion || "（暂无）";
    $("#previewStoryboardCount").textContent = storyboard ? `${storyboard.length} 字` : "";
    $("#previewMotionCount").textContent = motion ? `${motion.length} 字` : "";
  } catch (err) {
    $("#previewStoryboard").textContent = `读取失败：${err.message || err}`;
    $("#previewMotion").textContent = "";
  }
}

async function saveRules() {
  const payload = {};
  for (const [id, key] of RULE_FIELDS) payload[key] = $(id).value;
  $("#saveBtn").disabled = true;
  try {
    await api("/api/prompts/rules", { method: "POST", body: JSON.stringify(payload) });
    setDirty(false);
    toast("规则已保存，已立即生效", "ok");
    await loadPreview();
  } catch (err) {
    toast(err.message || "保存失败", "error");
  } finally {
    $("#saveBtn").disabled = false;
  }
}

async function saveAi() {
  const payload = {
    enabled: $("#aiEnabled").checked,
    baseUrl: $("#aiBaseUrl").value.trim(),
    model: $("#aiModel").value.trim(),
    keyEnv: $("#aiKeyEnv").value.trim(),
    temperature: Number($("#aiTemperature").value),
    maxTokens: Number($("#aiMaxTokens").value),
  };
  const key = $("#aiApiKey").value.trim();
  if (key) payload.apiKey = key;
  $("#saveAiBtn").disabled = true;
  try {
    await api("/api/ai", { method: "POST", body: JSON.stringify(payload) });
    $("#aiApiKey").value = "";
    toast("AI 连接设置已保存", "ok");
    await loadAi();
    await loadPreview();
  } catch (err) {
    toast(err.message || "保存失败", "error");
  } finally {
    $("#saveAiBtn").disabled = false;
  }
}

function bind() {
  $("#saveBtn").addEventListener("click", saveRules);
  $("#saveAiBtn").addEventListener("click", saveAi);
  $("#previewBtn").addEventListener("click", loadPreview);
  for (const [id] of RULE_FIELDS) {
    $(id).addEventListener("input", () => {
      syncCounts();
      setDirty(true);
    });
  }
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveRules();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function init() {
  bind();
  try {
    await Promise.all([loadRules(), loadAi()]);
  } catch (err) {
    toast(err.message || "读取配置失败", "error");
  }
  await loadPreview();
}

init();
