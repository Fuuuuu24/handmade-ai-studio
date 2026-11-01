import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createStore, initialState, mergeSource, AppError } from "../store.mjs";
import { readSource } from "../source.mjs";
import { createApp } from "../server.mjs";

const dir = fileURLToPath(new URL("../", import.meta.url));
async function setup(t) {
  const dataDir = await mkdtemp(path.join(dir, ".test-data-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let source = await readSource();
  const store = createStore({
    dataDir,
    readSource: async () => structuredClone(source),
  });
  return {
    dataDir,
    store,
    getSource: () => structuredClone(source),
    setSource: (s) => {
      source = structuredClone(s);
    },
  };
}
const action = async (store, type, fields = {}) =>
  store.action({ type, revision: (await store.get()).revision, ...fields });

test("实际来源读取固定提示词、变量模板和默认模型，不包含凭据", async () => {
  const s = await readSource();
  assert.equal(s.prompts.length, 2);
  assert.equal(s.models.length, 6);
  assert.ok(s.prompts[0].content.includes("你是「小间」"));
  assert.ok(s.prompts[1].content.includes("{{keep}}"));
  assert.ok(s.models.some((m) => m.id === s.defaults.chat));
  assert.ok(s.models.some((m) => m.id === s.defaults.image));
  assert.equal(s.files.length, 3);
  assert.ok(s.files.every((f) => /^[a-f0-9]{64}$/.test(f.hash)));
  assert.equal(JSON.stringify(s).includes("AIHUBMIX_API_KEY"), false);
});
test("提示词保存、恢复和服务重建后的持久化", async (t) => {
  const { store, dataDir, getSource } = await setup(t),
    original = (await store.get()).prompts[0].content;
  let s = await action(store, "prompt.save", {
    id: "xiaojian",
    content: original + "\n测试草稿",
  });
  assert.equal(s.prompts[0].versions[0].content, original);
  assert.equal(s.revision, 1);
  s = await action(store, "prompt.restore", {
    id: "xiaojian",
    versionId: s.prompts[0].versions[0].id,
  });
  assert.equal(s.prompts[0].content, original);
  assert.equal(s.prompts[0].versions.length, 2);
  assert.ok(s.prompts[0].versions[1].content.endsWith("测试草稿"));
  const reopened = createStore({ dataDir, readSource: getSource });
  assert.deepEqual(await reopened.get(), s);
  assert.equal(s.activity.length, 2);
});
test("过期 revision 和并发写请求不覆盖新配置", async (t) => {
  const { store } = await setup(t);
  await store.get();
  const results = await Promise.allSettled([
    store.action({
      type: "prompt.save",
      revision: 0,
      id: "white",
      content: "版本 A",
    }),
    store.action({
      type: "prompt.save",
      revision: 0,
      id: "white",
      content: "版本 B",
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const error = results.find((r) => r.status === "rejected").reason;
  assert.ok(error instanceof AppError);
  assert.equal(error.status, 409);
  assert.equal((await store.get()).prompts[1].content, "版本 A");
});
test("模型新增编辑、默认与启停约束，错误不产生记录", async (t) => {
  const { store } = await setup(t);
  const m = {
    ...(await store.get()).models[0],
    id: "local-test",
    label: "测试对话模型",
  };
  await action(store, "model.save", { model: m });
  await action(store, "model.default", { id: m.id });
  await assert.rejects(
    action(store, "model.toggle", { id: m.id }),
    /先设置其他默认模型/,
  );
  await action(store, "model.default", { id: "qwen3.8-flash" });
  await action(store, "model.toggle", { id: m.id });
  await assert.rejects(action(store, "model.default", { id: m.id }), /停用/);
  await assert.rejects(action(store, "model.save", { model: m }), /已存在/);
  await assert.rejects(
    action(store, "model.save", {
      existingId: m.id,
      model: { ...m, id: "changed" },
    }),
    /不可修改/,
  );
  assert.equal(
    (await store.get()).models.find((x) => x.id === m.id).enabled,
    false,
  );
  assert.equal((await store.get()).revision, 4);
});
test("拒绝负价、错误尺寸、错误 JSON 形态和空提示词", async (t) => {
  const { store } = await setup(t),
    s = await store.get(),
    chat = s.models[0],
    image = s.models.find((m) => m.kind === "image");
  await assert.rejects(
    action(store, "model.save", {
      existingId: chat.id,
      model: { ...chat, pricing: { inputPerMTok: -1, outputPerMTok: 0 } },
    }),
    /非负/,
  );
  await assert.rejects(
    action(store, "model.save", {
      existingId: image.id,
      model: { ...image, sizing: { kind: "size", sizes: { "1:1": "oops" } } },
    }),
    /像素尺寸/,
  );
  await assert.rejects(
    action(store, "model.save", {
      existingId: image.id,
      model: { ...image, extra: [] },
    }),
    /JSON 对象/,
  );
  await assert.rejects(
    action(store, "prompt.save", { id: "white", content: "  " }),
    /不能为空/,
  );
  assert.equal((await store.get()).revision, 0);
});
test("单向同步更新未编辑项、保留冲突草稿和后台启停状态", async (t) => {
  const { store, getSource, setSource } = await setup(t);
  await store.get();
  await action(store, "prompt.save", {
    id: "xiaojian",
    content: "后台独立草稿",
  });
  await action(store, "model.toggle", { id: "gemini-3.1-flash-image" });
  const next = getSource();
  next.hash = "new-hash";
  next.prompts[0].content = "来源系统规则更新";
  next.prompts[1].content = "来源白底更新";
  next.models.find((m) => m.id === "gemini-3.1-flash-image").perImageUSD = 0.1;
  setSource(next);
  const s = await action(store, "source.sync", { hash: next.hash });
  assert.equal(s.prompts[0].content, "后台独立草稿");
  assert.equal(s.source.prompts[0].content, "来源系统规则更新");
  assert.equal(s.prompts[1].content, "来源白底更新");
  assert.equal(s.prompts[1].versions.length, 1);
  const m = s.models.find((m) => m.id === "gemini-3.1-flash-image");
  assert.equal(m.perImageUSD, 0.1);
  assert.equal(m.enabled, false);
});
test("同步保留模型修改，记录来源删除并加入新模型", async () => {
  const source = await readSource(),
    s = initialState(source),
    next = structuredClone(source);
  s.models[0].label = "后台自定义名称";
  next.models[0].label = "来源更新名称";
  const removed = next.models.splice(1, 1)[0];
  next.models.push({
    ...next.models[0],
    id: "new-source-model",
    label: "来源新增",
  });
  mergeSource(s, next);
  assert.equal(s.models[0].label, "后台自定义名称");
  assert.ok(s.removedSource.models.includes(removed.id));
  assert.ok(s.models.some((m) => m.id === removed.id));
  assert.ok(s.models.some((m) => m.id === "new-source-model"));
});
test("来源在预览后变化时拒绝同步，读取错误不清空后台", async (t) => {
  const { store, getSource, setSource } = await setup(t);
  const before = await store.get(),
    next = getSource();
  next.hash = "changed";
  setSource(next);
  await assert.rejects(
    action(store, "source.sync", { hash: before.source.hash }),
    (e) => e.status === 409,
  );
  assert.deepEqual(await store.get(), before);
});
test("损坏的数据文件明确报错且原文件不变", async (t) => {
  const { store, dataDir } = await setup(t);
  await store.get();
  const file = path.join(dataDir, "state.json");
  await writeFile(file, "{invalid");
  await assert.rejects(store.get(), /不是有效 JSON/);
  assert.equal(await readFile(file, "utf8"), "{invalid");
});

test("来源读取失败时同步报错且后台原文件保持不变", async (t) => {
  const { store, dataDir } = await setup(t);
  const before = await store.get();
  const failing = createStore({
    dataDir,
    readSource: async () => {
      throw new Error("来源不可读取");
    },
  });
  await assert.rejects(
    failing.action({
      type: "source.sync",
      revision: before.revision,
      hash: before.source.hash,
    }),
    /来源不可读取/,
  );
  assert.deepEqual(await store.get(), before);
});
test("HTTP 接口拒绝跨来源、任意路径与非法请求，并能保存导出", async (t) => {
  const { dataDir, getSource } = await setup(t),
    server = createApp({ dataDir, sourceReader: async () => getSource() });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = await fetch(origin + "/api/state");
  assert.equal(get.status, 200);
  let s = await get.json();
  const send = (body, headers = {}) =>
    fetch(origin + "/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  assert.equal((await send({}, { Origin: "http://evil.example" })).status, 403);
  assert.equal((await fetch(origin + "/source.mjs")).status, 404);
  assert.equal((await fetch(origin + "/data/state.json")).status, 404);
  const save = await send({
    type: "prompt.save",
    revision: s.revision,
    id: "white",
    content: "HTTP 保存验证",
  });
  assert.equal(save.status, 200);
  s = await save.json();
  assert.equal(s.prompts[1].content, "HTTP 保存验证");
  const exportResponse = await fetch(origin + "/api/export");
  assert.equal(exportResponse.status, 200);
  assert.equal((await exportResponse.json()).revision, 1);
  assert.match(exportResponse.headers.get("content-disposition"), /attachment/);
  assert.equal((await send({ type: "publish", revision: 1 })).status, 400);
});
