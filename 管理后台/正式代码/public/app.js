const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => structuredClone(v);
const icons = {
  prompt: '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
  models:
    '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8M1 12h3M20 12h3"/>',
  sync: '<path d="M20 7a9 9 0 0 0-15-2L2 8m0-5v5h5M4 17a9 9 0 0 0 15 2l3-3m0 5v-5h-5"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 5v6h6M12 7v5l3 2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-16-2 20"/>',
  back: '<path d="m12 5-7 7 7 7M5 12h15"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.info}</svg>`;
const date = (v) =>
  v
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Singapore",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(v))
    : "尚未保存";
const money = (n) =>
  "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 6 });
let state,
  page = "prompts",
  selected = "xiaojian",
  promptTab = "source",
  query = "",
  modelKind = "all",
  modelStatus = "all",
  editingModel = null,
  modelDraft = null,
  syncPreview = null,
  dirty = false,
  draftText = null,
  variableValue = "",
  inFlight = false,
  pageError = "";
let toastTimer;
const proto = window.PROTOTYPE === true;
const storeKey = "yijian-admin-prototype-v1";
const sourcePrompt = (id) => state.source.prompts.find((p) => p.id === id);
const archivedPrompt = (id) =>
  state.removedSource?.prompts.find((p) => p.id === id);
const currentPrompt = () => state.prompts.find((p) => p.id === selected);
const labelFor = (id) =>
  sourcePrompt(id)?.label || archivedPrompt(id)?.label || id;
const changedPrompt = (p) => p.content !== sourcePrompt(p.id)?.content;
const modelOrigin = (m) => {
  const s = state.source.models.find((x) => x.id === m.id);
  return !s
    ? state.removedSource?.models.includes(m.id)
      ? "来源已移除"
      : "后台新增"
    : equal(m, s)
      ? "与来源一致"
      : "后台已修改";
};
const pill = (text, type = "") =>
  `<span class="pill ${type}">${esc(text)}</span>`;
const btn = (action, text, type = "", more = "") =>
  `<button type="button" class="btn ${type}" data-action="${action}" ${more}>${text}</button>`;
function notify(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4200);
}
function assertModel(model, existingId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(model.id))
    throw Error("API ID 只能包含字母、数字、点、横线、下划线、冒号或斜杠");
  if (!model.label.trim() || !model.provider.trim())
    throw Error("请填写显示名称和厂商");
  if (state.models.some((m) => m.id === model.id && m.id !== existingId))
    throw Error("这个 API ID 已存在");
  const nums =
    model.kind === "chat"
      ? [model.pricing.inputPerMTok, model.pricing.outputPerMTok]
      : [model.perImageUSD, model.perRefUSD];
  if (nums.some((n) => !Number.isFinite(n) || n < 0))
    throw Error("价格必须是大于或等于 0 的数字");
  if (
    model.kind === "image" &&
    (!Number.isInteger(model.maxRefs) ||
      model.maxRefs < 1 ||
      model.maxRefs > 20)
  )
    throw Error("参考图上限必须是 1—20 的整数");
  if (
    model.kind === "image" &&
    model.sizing.kind === "size" &&
    Object.values(model.sizing.sizes).some((v) => !/^\d{2,5}x\d{2,5}$/.test(v))
  )
    throw Error("每种比例都要填写像素尺寸，例如 1024x1024");
  if (
    model.extra &&
    (Array.isArray(model.extra) || typeof model.extra !== "object")
  )
    throw Error("额外参数必须是 JSON 对象");
}
function syncChanges(source) {
  const out = [];
  for (const kind of ["prompts", "models"]) {
    const old = state.source[kind],
      latest = source[kind];
    for (const item of latest) {
      const prev = old.find((x) => x.id === item.id);
      if (!prev || !equal(prev, item))
        out.push({
          text: item.label,
          type: prev ? "来源有更新" : "来源新增",
          conflict:
            !!prev &&
            (kind === "prompts"
              ? state.prompts.find((x) => x.id === item.id)?.content !==
                prev.content
              : !equal(
                  state.models.find((x) => x.id === item.id),
                  prev,
                )),
        });
    }
    for (const item of old)
      if (!latest.some((x) => x.id === item.id))
        out.push({ text: item.label, type: "来源已移除", conflict: true });
  }
  if (!equal(state.source.defaults, source.defaults))
    out.push({
      text: "默认模型",
      type: "来源有更新",
      conflict: !equal(state.defaults, state.source.defaults),
    });
  return out;
}
function applyPrototype(action) {
  let message = "";
  if (action.type === "prompt.save") {
    const p = state.prompts.find((p) => p.id === action.id);
    if (!action.content.trim()) throw Error("提示词不能为空");
    p.versions.push({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      content: p.content,
      note: "保存前版本",
    });
    p.content = action.content;
    p.savedAt = new Date().toISOString();
    message = `保存「${labelFor(action.id)}」草稿`;
  } else if (action.type === "prompt.restore") {
    const p = state.prompts.find((p) => p.id === action.id),
      v = p.versions.find((v) => v.id === action.versionId);
    if (!v) throw Error("找不到这个版本");
    p.versions.push({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      content: p.content,
      note: "恢复前版本",
    });
    p.content = v.content;
    p.savedAt = new Date().toISOString();
    message = "历史版本已恢复为新草稿";
  } else if (action.type === "model.save") {
    assertModel(action.model, action.existingId);
    const index = state.models.findIndex((m) => m.id === action.existingId);
    if (index >= 0) state.models[index] = action.model;
    else state.models.push(action.model);
    message = `${index >= 0 ? "编辑" : "新增"}模型「${action.model.label}」`;
  } else if (action.type === "model.toggle") {
    const m = state.models.find((m) => m.id === action.id);
    if (state.defaults[m.kind] === m.id && m.enabled)
      throw Error("请先设置其他默认模型，再停用这个模型");
    m.enabled = !m.enabled;
    message = `${m.enabled ? "启用" : "停用"}模型「${m.label}」`;
  } else if (action.type === "model.default") {
    const m = state.models.find((m) => m.id === action.id);
    if (!m.enabled) throw Error("停用的模型不能设为默认");
    state.defaults[m.kind] = m.id;
    message = `将「${m.label}」设为后台默认`;
  } else if (action.type === "source.sync") {
    message = "已演示同步流程，原型使用固定快照";
  } else throw Error("不支持的操作");
  state.revision++;
  state.activity.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    message,
  });
  localStorage.setItem(storeKey, JSON.stringify(state));
  return state;
}
async function api(url, options) {
  const r = await fetch(url, options);
  let body;
  try {
    body = await r.json();
  } catch {
    throw Error(`服务器响应不是有效 JSON（${r.status}）`);
  }
  if (!r.ok) throw Error(body.error || `请求失败（${r.status}）`);
  return body;
}
async function act(action) {
  if (inFlight) return false;
  inFlight = true;
  const frozen = [
    ...document.querySelectorAll(
      "#app button,#app input,#app textarea,#app select",
    ),
  ].map((node) => ({ node, disabled: node.disabled }));
  frozen.forEach(({ node }) => (node.disabled = true));
  try {
    state = proto
      ? applyPrototype(action)
      : await api("/api/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...action, revision: state.revision }),
        });
    dirty = false;
    pageError = "";
    notify(proto ? "已保存在原型浏览器中" : "已保存在独立后台，主产品不受影响");
    return true;
  } catch (e) {
    pageError = e.message;
    notify(e.message);
    const field = $("#form-error");
    if (field) {
      field.textContent = e.message;
      field.setAttribute("role", "alert");
    } else shell();
    return false;
  } finally {
    inFlight = false;
    frozen.forEach(({ node, disabled }) => {
      if (node.isConnected) node.disabled = disabled;
    });
  }
}
function shell() {
  const name = {
    prompts: "系统提示词",
    models: "模型管理",
    sync: "来源同步",
    history: "修改记录",
  }[page];
  $("#app").innerHTML =
    `<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">间</div><div><strong>一间 · 管理后台</strong><small>手作影像工作台</small></div></div><nav aria-label="管理后台导航"><div class="nav-group"><div class="nav-label">AI 配置</div>${nav("prompts", "系统提示词", "prompt", state.prompts.length)}${nav("models", "模型管理", "models", state.models.length)}</div><div class="nav-group"><div class="nav-label">数据管理</div>${nav("sync", "来源同步", "sync")}${nav("history", "修改记录", "history")}</div></nav><div class="sidebar-footer"><div class="avatar">E</div><div>本地工作空间<br><span class="small">仅在此电脑运行</span></div></div></aside><div><header class="topbar"><div class="crumb">一间工作台 ${icon("arrow")} <b>${name}</b></div><div class="top-meta"><span class="small muted">${proto ? "交互原型" : "独立管理版"}</span>${pill("单向同步 · 不写回")}</div></header><main id="main" class="content">${pageError ? `<div class="error-banner" role="alert">${esc(pageError)} ${btn("reload", "重新载入")}</div>` : ""}${page === "prompts" ? promptsPage() : page === "models" ? modelsPage() : page === "sync" ? syncPage() : historyPage()}</main></div></div>`;
  bindForms();
}
const nav = (id, text, i, count) =>
  `<button class="nav-btn ${page === id ? "active" : ""}" data-action="navigate" data-page="${id}" ${page === id ? 'aria-current="page"' : ""}>${icon(i)}${text}${count == null ? "" : `<span class="nav-count">${count}</span>`}</button>`;
const boundary = () =>
  `<div class="notice">${icon("info")}<span>${proto ? "<strong>交互原型</strong> · 使用源码静态快照，修改仅保存在当前浏览器。" : "<strong>独立后台配置</strong> · 可以从主产品同步，所有编辑仅保存在此后台。"} 主产品当前配置不会被修改。</span></div>`;
function promptBody(content) {
  const parts = content.split(/(?=^## )/m);
  const headings = parts
    .map((s, i) =>
      s.startsWith("## ") ? { i, title: s.split("\n")[0].slice(3) } : null,
    )
    .filter(Boolean);
  return `${headings.length ? `<nav class="section-nav" aria-label="提示词章节">${headings.map((h) => `<a href="#section-${h.i}">${esc(h.title)}</a>`).join("")}</nav>` : ""}<div class="prompt-text">${parts
    .map((part, i) => {
      const [first, ...rest] = part.split("\n");
      return part.startsWith("## ")
        ? `<section class="prompt-block" id="section-${i}"><h3>${esc(first.slice(3))}</h3><p>${esc(rest.join("\n").trim())}</p></section>`
        : `<p>${esc(part.trim())}</p>`;
    })
    .join("")}</div>`;
}
function diffHTML(before, after) {
  if (before === after)
    return '<div class="empty">后台配置与来源一致，暂无差异。</div>';
  const a = before.split("\n"),
    b = after.split("\n");
  // 大文本不建无界矩阵；退化为前后内容对照，仍完整展示。
  if (a.length * b.length > 250000)
    return `<h3>来源内容</h3><pre class="prompt-text">${esc(before)}</pre><hr><h3>后台内容</h3><pre class="prompt-text">${esc(after)}</pre>`;
  const dp = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0,
    j = 0,
    out = "";
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out += `<div class="diff-line">  ${esc(a[i])}</div>`;
      i++;
      j++;
    } else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j]))
      out += `<div class="diff-line add">+ ${esc(b[j++])}</div>`;
    else out += `<div class="diff-line remove">− ${esc(a[i++])}</div>`;
  }
  return out;
}
function promptsPage() {
  const p = currentPrompt() || state.prompts[0];
  selected = p.id;
  const src = sourcePrompt(p.id),
    text = draftText ?? p.content;
  const list = state.prompts.filter((p) =>
    `${labelFor(p.id)} ${p.content}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return `<div class="heading"><div><h1>系统提示词</h1><p>查看小间的工作规则，整理每一次提示词修改。</p></div>${btn("export", `${icon("download")}导出配置`)}</div>${boundary()}<div class="prompt-layout"><aside class="panel collection"><div class="collection-head"><span class="muted small">固定提示词</span><span class="count">${state.prompts.length}</span></div><div class="search" style="padding:0 10px 12px">${icon("search")}<input id="prompt-search" aria-label="搜索提示词" value="${esc(query)}" placeholder="搜索提示词" style="width:140px"></div>${list.length ? list.map((item) => `<button class="collection-item ${item.id === selected ? "active" : ""}" data-action="select-prompt" data-id="${esc(item.id)}" ${item.id === selected ? 'aria-current="true"' : ""}><span class="collection-title">${icon("prompt")}${esc(labelFor(item.id))}</span><p>${esc(sourcePrompt(item.id)?.description || "来源已移除")}</p>${pill(changedPrompt(item) ? "后台有修改" : "与来源一致", changedPrompt(item) ? "yellow" : "green")}</button>`).join("") : '<p class="empty small">没有匹配项</p>'}<div class="collection-note">单件作品的场景提示词由小间动态撰写，不属于这里的固定配置。</div></aside><section class="panel"><header class="editor-head"><div><h2>${esc(labelFor(p.id))}</h2><div class="meta">${pill(changedPrompt(p) ? "后台有修改" : "与来源一致", changedPrompt(p) ? "yellow" : "green")}<span>${p.versions.length} 次保存</span><span title="主产品原文是上次同步的快照">来源快照 ${date(state.source.readAt)}</span></div></div><div class="actions">${promptTab === "draft" ? btn("save-prompt", `${icon("check")}保存草稿`, "primary") : btn("edit-prompt", "编辑后台草稿")}</div></header><div class="editor-tabs" role="tablist" aria-label="提示词视图">${[
    ["source", "主产品原文"],
    ["draft", "后台草稿"],
    ["diff", "差异对比"],
    ["preview", "拼装预览"],
    ["versions", "历史版本"],
  ]
    .map(
      ([id, label]) =>
        `<button class="tab ${promptTab === id ? "active" : ""}" role="tab" aria-selected="${promptTab === id}" data-action="prompt-tab" data-tab="${id}">${label}</button>`,
    )
    .join(
      "",
    )}</div><div class="editor-body">${promptTab === "draft" ? `<label class="small muted" for="prompt-editor">编辑仅保存到后台草稿</label><textarea id="prompt-editor" class="prompt-textarea" spellcheck="false">${esc(text)}</textarea>` : promptTab === "diff" ? `<p class="small muted" style="margin-bottom:16px">绿色为后台新增，红色为来源中被替换的内容。</p>${diffHTML(src?.content ?? "", text)}` : promptTab === "preview" ? `<label class="field preview-field">${p.id === "white" ? "保真要求 keep（预览变量）" : "作品状态 state（预览变量）"}<textarea id="preview-variable" placeholder="手动填写预览内容，不会调用模型">${esc(variableValue)}</textarea></label><p class="small muted" style="margin-bottom:16px">使用当前后台草稿（包含未保存编辑）。以下是拼装预览，不是真实模型输出。</p>${promptBody(p.id === "white" ? text.replace("特别注意不能改：{{keep}}。", variableValue ? `特别注意不能改：${variableValue}。` : "").replaceAll("{{keep}}", variableValue) : text + "\n\n## 当前作品状态\n" + (variableValue || "{{state}}"))}` : promptTab === "versions" ? versionsHTML(p) : promptBody(src?.content ?? "来源已移除此提示词，后台草稿仍保留。")}</div><footer class="editor-footer"><span class="source-path">${esc(src?.path || "来源已移除")}</span><span class="tabular">${(promptTab === "source" ? (src?.content ?? "") : text).length.toLocaleString()} 字符</span></footer></section></div><p class="editor-sub">${icon("code")}<span>主产品请求 = 固定系统规则 + 当前作品状态 + 工具定义。批准、预算、重试等硬规则同时由代码执行，修改提示词不能替代这些规则。</span></p>`;
}
function versionsHTML(p) {
  return p.versions.length
    ? [...p.versions]
        .reverse()
        .map(
          (v, i) =>
            `<details class="history-item"><summary><span>版本 ${p.versions.length - i} · ${esc(v.note)}</span><span class="muted small">${date(v.at)}</span></summary><pre>${esc(v.content)}</pre><div class="actions">${btn("restore-prompt", "恢复为新草稿", "", 'data-version="' + esc(v.id) + '"')}</div></details>`,
        )
        .join("")
    : '<div class="empty"><h2>还没有历史版本</h2><p>保存后台草稿时，会保留修改前的内容。</p></div>';
}
function modelsPage() {
  if (editingModel !== null) return modelForm();
  const filtered = state.models.filter(
    (m) =>
      (modelKind === "all" || m.kind === modelKind) &&
      (modelStatus === "all" || String(m.enabled) === modelStatus) &&
      `${m.label} ${m.id} ${m.provider}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return `<div class="heading"><div><h1>模型管理</h1><p>管理小间的对话与生图模型，参数和价格集中整理。</p></div>${btn("new-model", `${icon("plus")}新增模型`, "primary")}</div>${boundary()}<div class="tabs" role="tablist" aria-label="模型用途">${[
    ["all", "全部模型"],
    ["chat", "对话模型"],
    ["image", "生图模型"],
  ]
    .map(
      ([id, label]) =>
        `<button class="tab ${modelKind === id ? "active" : ""}" role="tab" aria-selected="${modelKind === id}" data-action="model-kind" data-kind="${id}">${label}<span class="count">${state.models.filter((m) => id === "all" || m.kind === id).length}</span></button>`,
    )
    .join(
      "",
    )}</div><section class="panel"><div class="toolbar"><label class="search">${icon("search")}<input id="model-search" type="search" aria-label="搜索模型" placeholder="搜索名称、API ID 或厂商" value="${esc(query)}"></label><div class="actions"><label class="small muted" for="model-status">后台状态</label><select class="filter-select" id="model-status"><option value="all">全部状态</option><option value="true" ${modelStatus === "true" ? "selected" : ""}>已启用</option><option value="false" ${modelStatus === "false" ? "selected" : ""}>已停用</option></select>${btn("export", `${icon("download")}导出`)}</div></div><div class="table-wrap"><table><thead><tr><th>模型 / API ID</th><th>用途与能力</th><th>参考价格 · 美元</th><th>后台状态</th><th>配置来源</th><th>操作</th></tr></thead><tbody>${filtered.map((m) => `<tr><td><div class="model-name"><span class="provider-mark ${m.kind === "image" ? "image" : ""}">${esc(m.provider === "通义千问" ? "QW" : m.provider === "火山引擎" ? "SD" : m.provider.slice(0, 2).toUpperCase())}</span><div><strong>${esc(m.label)}</strong>${state.defaults[m.kind] === m.id ? '<span class="default-badge">后台默认</span>' : ""}<code>${esc(m.id)}</code></div></div></td><td><span>${m.kind === "chat" ? "对话" : "生图"}</span><div class="muted small">${m.kind === "chat" ? (m.vision ? "支持看图" : "纯文本") : `最多 ${m.maxRefs} 张参考图`}</div></td><td class="tabular">${m.kind === "chat" ? `${money(m.pricing.inputPerMTok)} / ${money(m.pricing.outputPerMTok)}<div class="muted small">输入 / 输出，每百万 token</div>` : `${money(m.perImageUSD)} / 张<div class="muted small">参考图 ${money(m.perRefUSD)} / 张</div>`}</td><td>${pill(m.enabled ? "已启用" : "已停用", m.enabled ? "green" : "")}</td><td class="small muted">${esc(modelOrigin(m))}</td><td><div class="row-actions"><button class="link-btn" data-action="edit-model" data-id="${esc(m.id)}">编辑</button><button class="link-btn" data-action="toggle-model" data-id="${esc(m.id)}" ${state.defaults[m.kind] === m.id ? 'disabled title="请先切换默认模型"' : ""}>${m.enabled ? "停用" : "启用"}</button>${state.defaults[m.kind] !== m.id ? `<button class="link-btn" data-action="default-model" data-id="${esc(m.id)}" ${!m.enabled ? "disabled" : ""}>设为默认</button>` : ""}</div></td></tr>`).join("")}</tbody></table>${!filtered.length ? '<div class="empty"><h2>没有匹配的模型</h2><p>试试其他关键词，或清除状态筛选。</p></div>' : ""}</div><footer class="table-footer"><span>共 ${filtered.length} 个模型${filtered.length !== state.models.length ? " · 已筛选" : ""}</span><span>价格为源码估价，实际费用以网关为准</span></footer></section><p class="editor-sub">${icon("info")}<span>“启用”和“默认”仅属于此后台。模型连通性与商品还原效果需在主产品中另行验证。</span></p>`;
}
const input = (name, label, value, options = "") =>
  `<label class="field">${label}<input name="${name}" value="${esc(value)}" ${options}></label>`;
const options = (arr, value) =>
  arr
    .map(
      ([id, label]) =>
        `<option value="${id}" ${id === value ? "selected" : ""}>${label}</option>`,
    )
    .join("");
function modelForm() {
  const m = modelDraft;
  return `<div class="heading"><div><button class="btn ghost" data-action="cancel-model" style="padding-left:0;margin-bottom:9px">${icon("back")}返回模型列表</button><h1>${editingModel === "new" ? "新增模型" : esc(m.label)}</h1><p>保存后只更新独立后台配置。</p></div></div><form id="model-form" class="panel form-panel"><div id="form-error" class="form-error"></div><section class="form-section"><h2>基本信息</h2><div class="form-grid"><label class="field">模型用途<select name="kind" id="edit-kind" ${editingModel !== "new" ? "disabled" : ""}>${options(
    [
      ["chat", "对话模型"],
      ["image", "生图模型"],
    ],
    m.kind,
  )}</select></label>${input("provider", "厂商", m.provider, 'required maxlength="60"')}${input("label", "显示名称", m.label, 'required maxlength="100"')}${input("id", "API ID", m.id, `required maxlength="120" ${editingModel !== "new" ? "readonly" : ""}`)}</div></section><section class="form-section"><h2>${m.kind === "chat" ? "能力与价格" : "生图参数与价格"}</h2><div class="form-grid">${
    m.kind === "chat"
      ? `<label class="field">看图能力<select name="vision">${options(
          [
            ["true", "支持图片输入"],
            ["false", "仅文本输入"],
          ],
          String(m.vision),
        )}</select></label><label class="field">推理强度<select name="reasoning">${options(
          [
            ["none", "无"],
            ["low", "低"],
            ["medium", "中"],
            ["high", "高"],
          ],
          m.reasoning,
        )}</select></label>${input("inputPrice", "输入价格 · 美元 / 百万 token", m.pricing.inputPerMTok, 'type="number" min="0" step="any" required')}${input("outputPrice", "输出价格 · 美元 / 百万 token", m.pricing.outputPerMTok, 'type="number" min="0" step="any" required')}`
      : `${input("perImageUSD", "单张价格 · 美元", m.perImageUSD, 'type="number" min="0" step="any" required')}${input("perRefUSD", "每张参考图价格 · 美元", m.perRefUSD, 'type="number" min="0" step="any" required')}${input("maxRefs", "参考图上限", m.maxRefs, 'type="number" min="1" max="20" step="1" required')}<label class="field">输出格式<select name="outputFormat">${options(
          [
            ["", "沿用模型默认"],
            ["jpeg", "JPEG"],
            ["png", "PNG"],
          ],
          m.outputFormat || "",
        )}</select></label><label class="field">尺寸策略<select name="sizingKind" id="sizing-kind">${options(
          [
            ["aspect_ratio", "按比例"],
            ["size", "按像素尺寸"],
          ],
          m.sizing.kind,
        )}</select></label><label class="field" ${m.sizing.kind === "size" ? "hidden" : ""}>分辨率<select name="resolution">${options(
          [
            ["", "沿用模型默认"],
            ["1K", "1K"],
            ["2K", "2K"],
          ],
          m.sizing.resolution || "",
        )}</select></label>${m.sizing.kind === "size" ? ["1:1", "3:4", "9:16"].map((r) => input(`size_${r}`, `${r} 像素尺寸`, m.sizing.sizes?.[r] || "", 'required placeholder="例如 1024x1024"')).join("") : ""}<label class="field wide">额外参数 · JSON 对象<textarea name="extra" spellcheck="false">${esc(JSON.stringify(m.extra || {}, null, 2))}</textarea><small>例如 quality、prompt_extend；不会发送到网关。</small></label>`
  }</div></section><footer class="form-footer">${btn("cancel-model", "取消")}<button class="btn primary" type="submit">${icon("check")}保存模型配置</button></footer></form>`;
}
function syncPage() {
  const changes = syncPreview ? syncChanges(syncPreview) : [];
  return `<div class="heading"><div><h1>来源同步</h1><p>从手作工作台读取最新配置，后台草稿保留。</p></div>${btn("preview-sync", `${icon("sync")}${proto ? "演示同步预览" : "检查来源更新"}`, "primary")}</div>${boundary()}<div class="sync-grid"><section class="panel sync-content"><div style="display:flex;justify-content:space-between;gap:12px"><h2>主产品配置来源</h2>${pill("仅允许读取", "purple")}</div><p class="muted small" style="margin:8px 0 14px">${proto ? "静态快照时间" : "最近同步"}：${date(state.source.readAt)} · <span class="mono">${state.source.hash.slice(0, 12)}</span></p>${state.source.files.map((f) => `<div class="file-row">${icon("code")}<div><span class="source-path">${esc(f.path)}</span><span class="small muted">SHA-256 · ${f.hash.slice(0, 16)}</span></div></div>`).join("")}${syncPreview ? `<div class="sync-result"><h2>同步预览</h2><p class="small muted" style="margin-top:6px">${proto ? "原型演示使用同一份快照，不会真实读取主产品。" : `发现 ${changes.length} 项来源变化；后台已改动的内容会保留。`}</p>${changes.map((c) => `<div class="change-row">${pill(c.type, c.type === "来源新增" ? "green" : "yellow")}<span>${esc(c.text)}</span>${c.conflict ? '<span class="muted small">保留后台配置</span>' : ""}</div>`).join("")}${!changes.length ? '<p class="small muted" style="padding:20px 0">来源与上次同步一致，后台草稿不会被覆盖。</p>' : ""}<div class="actions" style="justify-content:flex-end;margin-top:20px">${btn("cancel-sync", "取消")}${btn("apply-sync", proto ? "完成同步演示" : "确认同步到后台", "primary")}</div></div>` : ""}</section><aside class="panel sync-help"><h2>同步会发生什么</h2><p>未编辑的内容跟随来源更新。</p><p>后台修改过的内容继续保留，可在“差异对比”中核对。</p><p>主产品移除的条目保留在后台，标记来源已移除。</p><p>此后台没有写回、发布或调用模型的接口。</p></aside></div>`;
}
function historyPage() {
  return `<div class="heading"><div><h1>修改记录</h1><p>后台操作的时间与内容，独立留存。</p></div>${btn("export", `${icon("download")}导出完整配置`)}</div>${boundary()}<section class="panel"><div class="toolbar"><h2>后台记录</h2><span class="muted small">${state.activity.length} 条记录 · 配置修订 ${state.revision}</span></div>${state.activity.length ? `<div class="table-wrap"><table><thead><tr><th>时间</th><th>操作内容</th><th>作用范围</th></tr></thead><tbody>${state.activity.map((a) => `<tr><td class="tabular muted small">${date(a.at)}</td><td>${esc(a.message)}</td><td>${pill("仅独立后台")}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty"><h2>还没有修改记录</h2><p>保存提示词、调整模型或同步来源后，操作会出现在这里。</p></div>'}</section>`;
}
function confirmLeave() {
  return !dirty || confirm("还有未保存的修改。离开后这些修改将丢失，继续吗？");
}
async function load() {
  state = proto
    ? JSON.parse(localStorage.getItem(storeKey) || "null") ||
      (await api("./seed.json"))
    : await api("/api/state");
}
function rerenderPreservingInput() {
  const active = document.activeElement,
    id = active?.id,
    start = active?.selectionStart;
  shell();
  if (id) {
    const input = document.getElementById(id);
    input?.focus();
    if (typeof start === "number" && input.setSelectionRange)
      input.setSelectionRange(start, start);
  }
}
function bindForms() {
  $("#model-search")?.addEventListener("input", (e) => {
    query = e.target.value;
    rerenderPreservingInput();
  });
  $("#prompt-search")?.addEventListener("input", (e) => {
    query = e.target.value;
    rerenderPreservingInput();
  });
  $("#model-status")?.addEventListener("change", (e) => {
    modelStatus = e.target.value;
    shell();
  });
  $("#prompt-editor")?.addEventListener("input", (e) => {
    draftText = e.target.value;
    dirty = draftText !== currentPrompt().content;
  });
  $("#preview-variable")?.addEventListener("change", (e) => {
    variableValue = e.target.value;
    shell();
  });
  $("#edit-kind")?.addEventListener("change", (e) => {
    try {
      captureModelForm();
    } catch (error) {
      e.target.value = modelDraft.kind;
      $("#form-error").textContent = error.message;
      $("#form-error").setAttribute("role", "alert");
      return;
    }
    const base = {
      id: modelDraft.id,
      label: modelDraft.label,
      provider: modelDraft.provider,
      kind: e.target.value,
      enabled: true,
    };
    modelDraft =
      base.kind === "chat"
        ? {
            ...base,
            vision: true,
            reasoning: "low",
            pricing: { inputPerMTok: 0, outputPerMTok: 0 },
          }
        : {
            ...base,
            perImageUSD: 0,
            perRefUSD: 0,
            maxRefs: 4,
            sizing: { kind: "aspect_ratio" },
            extra: {},
          };
    dirty = true;
    shell();
  });
  $("#sizing-kind")?.addEventListener("change", (e) => {
    try {
      captureModelForm();
    } catch (error) {
      e.target.value = modelDraft.sizing.kind;
      $("#form-error").textContent = error.message;
      $("#form-error").setAttribute("role", "alert");
      return;
    }
    modelDraft.sizing = {
      kind: e.target.value,
      ...(e.target.value === "size"
        ? {
            sizes: {
              "1:1": "1024x1024",
              "3:4": "1152x1536",
              "9:16": "1008x1792",
            },
          }
        : {}),
    };
    dirty = true;
    shell();
  });
  $("#model-form")?.addEventListener("input", () => (dirty = true));
  $("#model-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const m = captureModelForm();
      assertModel(m, editingModel === "new" ? null : editingModel);
      if (
        await act({
          type: "model.save",
          existingId: editingModel === "new" ? null : editingModel,
          model: m,
        })
      ) {
        editingModel = null;
        modelDraft = null;
        shell();
      }
    } catch (error) {
      $("#form-error").textContent = error.message;
      $("#form-error").setAttribute("role", "alert");
    }
  });
}
function captureModelForm() {
  const data = new FormData($("#model-form")),
    m = {
      ...modelDraft,
      id: String(data.get("id")).trim(),
      label: String(data.get("label")).trim(),
      provider: String(data.get("provider")).trim(),
    };
  if (m.kind === "chat") {
    m.vision = data.get("vision") === "true";
    m.reasoning = data.get("reasoning");
    m.pricing = {
      inputPerMTok: Number(data.get("inputPrice")),
      outputPerMTok: Number(data.get("outputPrice")),
    };
  } else {
    m.perImageUSD = Number(data.get("perImageUSD"));
    m.perRefUSD = Number(data.get("perRefUSD"));
    m.maxRefs = Number(data.get("maxRefs"));
    m.sizing =
      data.get("sizingKind") === "size"
        ? {
            kind: "size",
            sizes: Object.fromEntries(
              ["1:1", "3:4", "9:16"].map((r) => [
                r,
                String(data.get(`size_${r}`) || ""),
              ]),
            ),
          }
        : {
            kind: "aspect_ratio",
            ...(data.get("resolution")
              ? { resolution: data.get("resolution") }
              : {}),
          };
    if (data.get("outputFormat")) m.outputFormat = data.get("outputFormat");
    else delete m.outputFormat;
    try {
      m.extra = JSON.parse(data.get("extra") || "{}");
    } catch {
      throw Error("额外参数不是有效 JSON，请检查逗号和双引号");
    }
  }
  modelDraft = m;
  return m;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b || b.disabled || inFlight) return;
  const a = b.dataset.action;
  try {
    if (a === "navigate") {
      if (!confirmLeave()) return;
      page = b.dataset.page;
      query = "";
      editingModel = null;
      modelDraft = null;
      dirty = false;
      draftText = null;
      pageError = "";
      shell();
    } else if (a === "select-prompt") {
      if (!confirmLeave()) return;
      selected = b.dataset.id;
      draftText = null;
      dirty = false;
      variableValue = "";
      shell();
    } else if (a === "prompt-tab" || a === "edit-prompt") {
      const next = a === "edit-prompt" ? "draft" : b.dataset.tab;
      promptTab = next;
      shell();
    } else if (a === "save-prompt") {
      if (
        await act({
          type: "prompt.save",
          id: selected,
          content: draftText ?? currentPrompt().content,
        })
      ) {
        draftText = null;
        shell();
      }
    } else if (a === "restore-prompt") {
      if (
        !confirm(
          dirty
            ? "还有未保存的编辑。恢复历史版本会丢弃这些编辑；仅已保存的内容会留在历史里。继续恢复吗？"
            : "恢复此版本为新的后台草稿？已保存的当前内容会保留在历史里。",
        )
      )
        return;
      if (
        await act({
          type: "prompt.restore",
          id: selected,
          versionId: b.dataset.version,
        })
      ) {
        promptTab = "draft";
        draftText = null;
        shell();
      }
    } else if (a === "model-kind") {
      modelKind = b.dataset.kind;
      shell();
    } else if (a === "new-model") {
      editingModel = "new";
      modelDraft = {
        kind: modelKind === "image" ? "image" : "chat",
        id: "",
        label: "",
        provider: "自定义",
        enabled: true,
        vision: true,
        reasoning: "low",
        pricing: { inputPerMTok: 0, outputPerMTok: 0 },
      };
      if (modelDraft.kind === "image")
        modelDraft = {
          kind: "image",
          id: "",
          label: "",
          provider: "自定义",
          enabled: true,
          perImageUSD: 0,
          perRefUSD: 0,
          maxRefs: 4,
          sizing: { kind: "aspect_ratio" },
        };
      shell();
    } else if (a === "edit-model") {
      editingModel = b.dataset.id;
      modelDraft = clone(state.models.find((m) => m.id === editingModel));
      shell();
    } else if (a === "cancel-model") {
      if (!confirmLeave()) return;
      editingModel = null;
      modelDraft = null;
      dirty = false;
      shell();
    } else if (a === "toggle-model" || a === "default-model") {
      if (
        await act({
          type: a === "toggle-model" ? "model.toggle" : "model.default",
          id: b.dataset.id,
        })
      )
        shell();
    } else if (a === "preview-sync") {
      b.disabled = true;
      b.textContent = "正在读取…";
      syncPreview = proto ? clone(state.source) : await api("/api/source");
      shell();
      notify(
        proto ? "这是同步演示，使用静态快照" : "来源已读取，请核对同步预览",
      );
    } else if (a === "apply-sync") {
      if (await act({ type: "source.sync", hash: syncPreview.hash })) {
        syncPreview = null;
        shell();
      }
    } else if (a === "cancel-sync") {
      syncPreview = null;
      shell();
    } else if (a === "reload") {
      if (!confirmLeave()) return;
      await load();
      pageError = "";
      dirty = false;
      draftText = null;
      shell();
    } else if (a === "export") {
      const blob = new Blob([JSON.stringify(state, null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `yijian-admin-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("配置已导出，包含后台草稿和历史版本");
    }
  } catch (error) {
    pageError = error.message;
    shell();
    notify(error.message);
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
try {
  await load();
  shell();
} catch (e) {
  $("#app").innerHTML =
    `<main class="content"><h1>后台配置读取失败</h1><p class="error-banner" role="alert">${esc(e.message)}</p><p>检查本地服务及数据文件，再刷新重试。现有数据没有被替换。</p></main>`;
}
