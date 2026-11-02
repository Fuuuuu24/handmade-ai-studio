import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";
import { createCredentialStore } from "../credentials.mjs";
import { createApp } from "../server.mjs";
import { readSource } from "../source.mjs";

const project = fileURLToPath(new URL("../../../", import.meta.url));
const shared = await import(pathToFileURL(path.join(project, "正式代码/src/server/credential-file.ts")).href);
const KEY_A = "sk-test-aaaaaaaaaaaaaaaaAAA1";
const KEY_B = "sk-test-bbbbbbbbbbbbbbbbBBB2";
const product = async () => ({ reachable: true, source: "file", ready: true, revision: 1 });

async function setup(t, { masterKey = randomBytes(32).toString("base64") } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "yijian-admin-cred-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "secrets", "credentials.json");
  const store = createCredentialStore({ file, masterKey, productStatus: product });
  return { dir, file, masterKey, store };
}
const act = async (store, type, fields = {}) =>
  store.action({ type, revision: (await store.status()).revision, ...fields });

test("没设置凭据文件位置或主密钥时只读不写", async (t) => {
  const store = createCredentialStore({ file: "", masterKey: "", productStatus: product });
  const s = await store.status();
  assert.equal(s.ready, false);
  assert.match(s.setupError, /CREDENTIALS_PATH/);
  await assert.rejects(store.action({ type: "key.set", provider: "aihubmix", key: KEY_A, revision: 0 }), { status: 503 });
  const { dir } = await setup(t);
  const relative = createCredentialStore({ file: "relative.json", masterKey: randomBytes(32).toString("base64"), productStatus: product });
  assert.match((await relative.status()).setupError, /绝对路径/);
  const badMaster = createCredentialStore({ file: path.join(dir, "c.json"), masterKey: "short", productStatus: product });
  assert.match((await badMaster.status()).setupError, /主密钥/);
});

test("配置与替换：文件只有密文和尾号、权限 600，主产品的共用模块解得开；换下的 key 留作上一把", async (t) => {
  const { file, masterKey, store } = await setup(t);
  let s = await store.status();
  assert.equal(s.providers[0].status, "missing");
  assert.equal(s.revision, 0);
  const configured = await act(store, "key.set", { provider: "aihubmix", key: `  ${KEY_A}\n` });
  assert.equal(configured.token, undefined);
  assert.equal(configured.creds.providers[0].status, "active");
  assert.equal(configured.creds.providers[0].last4, "AAA1");
  assert.equal(JSON.stringify(configured).includes(KEY_A), false);
  const raw = await readFile(file, "utf8");
  assert.equal(raw.includes(KEY_A), false);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const master = shared.parseMasterKey(masterKey);
  assert.equal(shared.unseal(master, "aihubmix", shared.parseCredentialFile(raw).providers.aihubmix.key), KEY_A);

  const replaced = await act(store, "key.set", { provider: "aihubmix", key: KEY_B });
  const p = replaced.creds.providers[0];
  assert.equal(p.last4, "BBB2");
  assert.equal(p.previous.last4, "AAA1");
  const hours = (Date.parse(p.previous.expiresAt) - Date.parse(p.previous.replacedAt)) / 3600e3;
  assert.equal(hours, 24);
  const data = shared.parseCredentialFile(await readFile(file, "utf8"));
  assert.equal(shared.unseal(master, "aihubmix", data.providers.aihubmix.key), KEY_B);
  assert.equal(shared.unseal(master, "aihubmix", data.providers.aihubmix.previous), KEY_A);
  s = await store.status();
  assert.deepEqual(
    s.log.map((l) => l.message),
    ["替换 AIHubMix key（尾号 BBB2）", "配置 AIHubMix key（尾号 AAA1）"],
  );
  assert.equal(JSON.stringify(s).includes(KEY_B), false);
});

test("版本冲突、录入不合格都不写文件", async (t) => {
  const { file, store } = await setup(t);
  await act(store, "key.set", { provider: "aihubmix", key: KEY_A });
  const before = await readFile(file, "utf8");
  await assert.rejects(store.action({ type: "key.set", provider: "aihubmix", key: KEY_B, revision: 0 }), { status: 409 });
  await assert.rejects(act(store, "key.set", { provider: "aihubmix", key: "sk-short" }), /16—256/);
  await assert.rejects(act(store, "key.set", { provider: "other", key: KEY_B }), /不认识的供应商/);
  await assert.rejects(act(store, "publish"), /不支持的操作/);
  assert.equal(await readFile(file, "utf8"), before);
});

test("停用与启用；没有 key 时不能停用", async (t) => {
  const { store } = await setup(t);
  await assert.rejects(act(store, "key.disable"), /还没有配置/);
  await act(store, "key.set", { provider: "aihubmix", key: KEY_A });
  assert.equal((await act(store, "key.disable")).creds.providers[0].status, "disabled");
  assert.equal((await act(store, "key.enable")).creds.providers[0].status, "active");
});

test("团队口令：原文只在生成那一次返回，文件只存散列；更换后旧口令失效", async (t) => {
  const { file, store } = await setup(t);
  const created = await act(store, "relay.create");
  assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(created.creds.relay.status, "active");
  assert.equal(created.creds.relay.last4, created.token.slice(-4));
  const raw = await readFile(file, "utf8");
  assert.equal(raw.includes(created.token), false);
  assert.equal(shared.tokenMatches(created.token, JSON.parse(raw).relay.sha256), true);
  assert.equal(JSON.stringify(await store.status()).includes(created.token), false);
  await assert.rejects(act(store, "relay.create"), /已经有团队口令/);
  const rotated = await act(store, "relay.rotate");
  assert.notEqual(rotated.token, created.token);
  const sha = JSON.parse(await readFile(file, "utf8")).relay.sha256;
  assert.equal(shared.tokenMatches(created.token, sha), false);
  assert.equal(shared.tokenMatches(rotated.token, sha), true);
  assert.equal((await act(store, "relay.disable")).creds.relay.status, "disabled");
});

test("凭据文件坏了：只报错，不覆盖", async (t) => {
  const { file, store } = await setup(t);
  await act(store, "key.set", { provider: "aihubmix", key: KEY_A });
  await writeFile(file, "{坏了");
  const s = await store.status();
  assert.match(s.fileError, /不是有效的 JSON/);
  assert.equal(s.providers[0].status, "error");
  await assert.rejects(store.action({ type: "key.set", provider: "aihubmix", key: KEY_B, revision: 0 }), { status: 500 });
  assert.equal(await readFile(file, "utf8"), "{坏了");
});

test("换了主密钥后旧记录解不开：显示出错，重新录入覆盖它，不留作上一把", async (t) => {
  const { file, store } = await setup(t);
  await act(store, "key.set", { provider: "aihubmix", key: KEY_A });
  const other = createCredentialStore({ file, masterKey: randomBytes(32).toString("base64"), productStatus: product });
  const s = await other.status();
  assert.equal(s.providers[0].status, "error");
  assert.match(s.providers[0].error, /解密失败/);
  const reentered = await act(other, "key.set", { provider: "aihubmix", key: KEY_B });
  assert.equal(reentered.creds.providers[0].status, "active");
  assert.equal(reentered.creds.providers[0].previous, null);
  assert.equal(reentered.creds.log[0].message, "重新录入 AIHubMix key（尾号 BBB2）");
});

test("HTTP：凭据接口只收同源 JSON、限 8 KB，任何接口和导出都取不回 key", async (t) => {
  const { store } = await setup(t);
  const dataDir = await mkdtemp(path.join(tmpdir(), "yijian-admin-http-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const source = await readSource();
  const server = createApp({ dataDir, sourceReader: async () => structuredClone(source), credentials: store });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) =>
    fetch(origin + "/api/credentials", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({}, { Origin: "http://evil.example" })).status, 403);
  assert.equal((await post({ type: "key.set", provider: "aihubmix", key: "x".repeat(9000), revision: 0 })).status, 413);
  const bad = await fetch(origin + "/api/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: `{"key":"${KEY_A}"` });
  assert.equal(bad.status, 400);
  assert.equal((await bad.text()).includes(KEY_A), false);
  const saved = await post({ type: "key.set", provider: "aihubmix", key: KEY_A, revision: 0 });
  assert.equal(saved.status, 200);
  assert.equal((await saved.text()).includes(KEY_A), false);
  const status = await (await fetch(origin + "/api/credentials")).text();
  assert.equal(status.includes(KEY_A), false);
  assert.ok(status.includes('"last4":"AAA1"'));
  const exported = await (await fetch(origin + "/api/export")).text();
  assert.equal(exported.includes(KEY_A), false);
  assert.equal(exported.includes("AAA1"), false);
});
