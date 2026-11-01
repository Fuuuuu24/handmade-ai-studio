import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const requireValue = (ok, message) => {
  if (!ok) throw new AppError(message);
};
const text = (v, max) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;
const price = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function initialState(source) {
  return {
    schemaVersion: 1,
    revision: 0,
    source,
    prompts: source.prompts.map((p) => ({
      id: p.id,
      content: p.content,
      versions: [],
    })),
    models: structuredClone(source.models),
    defaults: { ...source.defaults },
    removedSource: { prompts: [], models: [] },
    activity: [],
  };
}

export function validateModel(m) {
  requireValue(m && typeof m === "object", "缺少模型配置");
  requireValue(
    typeof m.id === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(m.id),
    "API ID 格式不正确",
  );
  requireValue(
    text(m.label, 100) && text(m.provider, 60),
    "请填写显示名称和厂商",
  );
  requireValue(["chat", "image"].includes(m.kind), "模型用途必须是对话或生图");
  requireValue(typeof m.enabled === "boolean", "缺少后台启用状态");
  if (m.kind === "chat") {
    requireValue(typeof m.vision === "boolean", "看图能力必须是布尔值");
    requireValue(
      ["none", "low", "medium", "high"].includes(m.reasoning),
      "推理强度不正确",
    );
    requireValue(
      price(m.pricing?.inputPerMTok) && price(m.pricing?.outputPerMTok),
      "输入和输出价格必须是非负数字",
    );
  } else {
    requireValue(
      price(m.perImageUSD) && price(m.perRefUSD),
      "生图及参考图价格必须是非负数字",
    );
    requireValue(
      Number.isInteger(m.maxRefs) && m.maxRefs >= 1 && m.maxRefs <= 20,
      "参考图上限必须是 1—20 的整数",
    );
    requireValue(
      ["aspect_ratio", "size"].includes(m.sizing?.kind),
      "尺寸策略不正确",
    );
    if (m.sizing.kind === "size")
      requireValue(
        ["1:1", "3:4", "9:16"].every(
          (r) =>
            typeof m.sizing.sizes?.[r] === "string" &&
            /^\d{2,5}x\d{2,5}$/.test(m.sizing.sizes[r]),
        ),
        "请填写所有比例的像素尺寸，例如 1024x1024",
      );
    if (m.sizing.resolution !== undefined)
      requireValue(
        ["1K", "2K"].includes(m.sizing.resolution),
        "分辨率仅支持 1K 或 2K",
      );
    if (m.outputFormat !== undefined)
      requireValue(
        ["jpeg", "png"].includes(m.outputFormat),
        "输出格式只支持 jpeg 或 png",
      );
    if (m.extra !== undefined)
      requireValue(
        m.extra !== null &&
          typeof m.extra === "object" &&
          !Array.isArray(m.extra),
        "额外参数必须是 JSON 对象",
      );
  }
}
function validateState(s) {
  requireValue(
    s?.schemaVersion === 1 &&
      Number.isInteger(s.revision) &&
      Array.isArray(s.prompts) &&
      Array.isArray(s.models) &&
      Array.isArray(s.activity) &&
      s.source?.hash,
    "后台数据结构不正确；请保留原文件并检查，系统不会重置数据",
  );
  const ids = new Set();
  for (const m of s.models) {
    validateModel(m);
    requireValue(!ids.has(m.id), "模型 ID 重复");
    ids.add(m.id);
  }
  for (const kind of ["chat", "image"])
    requireValue(
      s.models.some(
        (m) => m.id === s.defaults?.[kind] && m.kind === kind && m.enabled,
      ),
      `${kind === "chat" ? "对话" : "生图"}默认模型必须存在且启用`,
    );
  for (const p of s.prompts)
    requireValue(
      typeof p.id === "string" &&
        text(p.content, 50000) &&
        Array.isArray(p.versions),
      "提示词数据不正确",
    );
}
function version(p, note) {
  p.versions.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    content: p.content,
    note,
  });
  p.savedAt = new Date().toISOString();
}
function lookupModel(s, id) {
  const m = s.models.find((x) => x.id === id);
  requireValue(m, "找不到这个模型");
  return m;
}

export function mergeSource(state, source) {
  const old = state.source;
  state.removedSource ??= { prompts: [], models: [] };
  for (const p of source.prompts) {
    const current = state.prompts.find((x) => x.id === p.id),
      previous = old.prompts.find((x) => x.id === p.id);
    if (!current)
      state.prompts.push({ id: p.id, content: p.content, versions: [] });
    else if (
      previous &&
      current.content === previous.content &&
      current.content !== p.content
    ) {
      version(current, "来源同步前版本");
      current.content = p.content;
    }
    state.removedSource.prompts = state.removedSource.prompts.filter(
      (x) => x.id !== p.id,
    );
  }
  for (const p of old.prompts)
    if (
      !source.prompts.some((x) => x.id === p.id) &&
      !state.removedSource.prompts.some((x) => x.id === p.id)
    )
      state.removedSource.prompts.push(p);
  for (const m of source.models) {
    const idx = state.models.findIndex((x) => x.id === m.id),
      previous = old.models.find((x) => x.id === m.id);
    if (idx < 0) state.models.push(structuredClone(m));
    else if (previous) {
      // 后台独有的 enabled 保留，其余字段未编辑才跟随来源。
      const { enabled: ce, ...currentFields } = state.models[idx],
        { enabled: pe, ...previousFields } = previous;
      if (same(currentFields, previousFields))
        state.models[idx] = { ...structuredClone(m), enabled: ce };
    }
    state.removedSource.models = state.removedSource.models.filter(
      (id) => id !== m.id,
    );
  }
  for (const m of old.models)
    if (
      !source.models.some((x) => x.id === m.id) &&
      !state.removedSource.models.includes(m.id)
    )
      state.removedSource.models.push(m.id);
  for (const kind of ["chat", "image"])
    if (state.defaults[kind] === old.defaults[kind]) {
      const next = state.models.find(
        (m) => m.id === source.defaults[kind] && m.kind === kind && m.enabled,
      );
      if (next) state.defaults[kind] = next.id;
    }
  state.source = source;
}

export function createStore({ dataDir, readSource }) {
  let tail = Promise.resolve();
  const file = path.join(dataDir, "state.json");
  const serial = (fn) => {
    const result = tail.then(fn);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  async function persist(state) {
    await mkdir(dataDir, { recursive: true });
    const tmp = path.join(dataDir, `state-${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(tmp, file);
  }
  async function read() {
    let raw;
    try {
      raw = await readFile(file, "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      const s = initialState(await readSource());
      validateState(s);
      await persist(s);
      return s;
    }
    let s;
    try {
      s = JSON.parse(raw);
    } catch {
      throw new AppError(
        "后台数据文件不是有效 JSON；原文件已保留，请检查后重试",
        500,
      );
    }
    validateState(s);
    return s;
  }
  return {
    get: () => serial(read),
    action: (a) =>
      serial(async () => {
        const s = await read();
        requireValue(a && typeof a === "object", "请求内容不正确");
        if (a.revision !== s.revision)
          throw new AppError(
            "配置已在其他页面更新，请重新载入后再保存；未覆盖任何数据",
            409,
          );
        let message;
        if (a.type === "prompt.save" || a.type === "prompt.restore") {
          const p = s.prompts.find((x) => x.id === a.id);
          requireValue(p, "找不到这个提示词");
          let content = a.content;
          if (a.type === "prompt.restore") {
            const v = p.versions.find((x) => x.id === a.versionId);
            requireValue(v, "找不到这个历史版本");
            content = v.content;
          }
          requireValue(
            text(content, 50000),
            "提示词不能为空，最多 50,000 字符",
          );
          version(p, a.type === "prompt.restore" ? "恢复前版本" : "保存前版本");
          p.content = content;
          message = `${a.type === "prompt.restore" ? "恢复" : "保存"}提示词「${s.source.prompts.find((x) => x.id === p.id)?.label || p.id}」后台草稿`;
        } else if (a.type === "model.save") {
          validateModel(a.model);
          const m = structuredClone(a.model),
            idx = s.models.findIndex((x) => x.id === a.existingId);
          if (a.existingId) {
            requireValue(idx >= 0, "找不到待编辑的模型");
            requireValue(
              m.id === a.existingId,
              "已有模型的 API ID 不可修改；请新增模型",
            );
            requireValue(
              m.kind === s.models[idx].kind,
              "已有模型的用途不可修改",
            );
          } else
            requireValue(
              !s.models.some((x) => x.id === m.id),
              "这个 API ID 已存在",
            );
          if (idx >= 0) s.models[idx] = m;
          else s.models.push(m);
          message = `${idx >= 0 ? "编辑" : "新增"}模型「${m.label}」`;
        } else if (a.type === "model.toggle") {
          const m = lookupModel(s, a.id);
          requireValue(
            !(m.enabled && s.defaults[m.kind] === m.id),
            "请先设置其他默认模型，再停用这个模型",
          );
          m.enabled = !m.enabled;
          message = `${m.enabled ? "启用" : "停用"}模型「${m.label}」`;
        } else if (a.type === "model.default") {
          const m = lookupModel(s, a.id);
          requireValue(m.enabled, "停用的模型不能设为默认");
          s.defaults[m.kind] = m.id;
          message = `将「${m.label}」设为后台${m.kind === "chat" ? "对话" : "生图"}默认模型`;
        } else if (a.type === "source.sync") {
          const next = await readSource();
          if (next.hash !== a.hash)
            throw new AppError(
              "来源在预览后又发生变化，请重新检查来源更新",
              409,
            );
          mergeSource(s, next);
          message = "从主产品单向同步配置，保留后台已修改内容";
        } else throw new AppError("不支持的后台操作");
        s.revision++;
        s.activity.unshift({
          id: randomUUID(),
          at: new Date().toISOString(),
          message,
        });
        validateState(s);
        await persist(s);
        return s;
      }),
  };
}
