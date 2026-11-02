import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AppError } from "./store.mjs";

/* 供应商与凭据（PRD v1.1、技术方案「凭据」）：后台唯一会写的主产品相关文件是服务器上的凭据文件（CREDENTIALS_PATH）。
   格式与加解密用主产品的 src/server/credential-file.ts（两边一份实现），用到时才加载：读不到只让凭据页报错，不影响其他页面。
   key 只写不读回：任何响应、日志、导出和 state.json 都不含原文或密文；团队口令只在生成那一次的响应里返回原文。 */

const project = fileURLToPath(new URL("../../", import.meta.url));
const PROVIDER = "aihubmix";
const META = { id: PROVIDER, label: "AIHubMix", type: "API 网关", host: "aihubmix.com" };
const LOG_LIMIT = 200;

let sharedModules;
const loadShared = () =>
  (sharedModules ??= Promise.all([
    import(pathToFileURL(path.join(project, "正式代码/src/server/credential-file.ts")).href),
    import(pathToFileURL(path.join(project, "正式代码/src/config/credentials.ts")).href),
  ]).then(([file, config]) => ({ ...file, graceMs: config.CREDENTIALS.previousKeyGraceHours * 3600e3 })));

// 主产品当前用哪份凭据：读它的 /api/config（只有来源、是否可用和文件版本，没有尾号和密钥）
export async function fetchProductStatus() {
  const base = (process.env.PRODUCT_INTERNAL_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { reachable: false, error: `主产品返回 ${res.status}` };
    return body?.credential ? { reachable: true, ...body.credential } : { reachable: true };
  } catch (e) {
    return { reachable: false, error: e?.name === "TimeoutError" ? "3 秒内没有响应" : `连不上 ${base}` };
  }
}

const blankProvider = (status, extra = {}) => ({ ...META, status, last4: "", savedAt: null, previous: null, ...extra });

export function createCredentialStore({
  file = process.env.CREDENTIALS_PATH,
  masterKey = process.env.CREDENTIALS_MASTER_KEY,
  productStatus = fetchProductStatus,
} = {}) {
  const filePath = file?.trim() || "";
  let tail = Promise.resolve();
  const serial = (fn) => {
    const result = tail.then(fn);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  // 服务器没配好时页面显示「未设置」，写入接口拒绝
  async function setup() {
    if (!filePath) return { problem: "服务器还没设置 CREDENTIALS_PATH 和 CREDENTIALS_MASTER_KEY" };
    if (!path.isAbsolute(filePath)) return { problem: "CREDENTIALS_PATH 要写绝对路径" };
    let m;
    try {
      m = await loadShared();
    } catch (e) {
      return { problem: `读不到主产品的凭据模块：${e.message}` };
    }
    try {
      return { m, master: m.parseMasterKey(masterKey) };
    } catch (e) {
      return { problem: e.message };
    }
  }

  // 没有文件当作还没配置；文件坏了只报错，不当成空文件，也不覆盖
  async function readCredentials(m) {
    let text;
    try {
      text = await readFile(filePath, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return { data: m.emptyCredentialFile(), fileError: null };
      return { data: null, fileError: e.message };
    }
    try {
      return { data: m.parseCredentialFile(text), fileError: null };
    } catch (e) {
      return { data: null, fileError: e.message };
    }
  }

  function view(m, master, data, fileError) {
    if (fileError)
      return {
        ready: true,
        revision: 0,
        fileError,
        providers: [blankProvider("error", { error: "读不出凭据文件" })],
        relay: { status: "error" },
        log: [],
      };
    const entry = data.providers[PROVIDER];
    let provider = blankProvider("missing");
    if (entry) {
      let error = null;
      try {
        m.unseal(master, PROVIDER, entry.key); // 只为发现主密钥不对；明文不离开这里
      } catch (e) {
        error = e.message;
      }
      const prev = entry.previous;
      const expiresAt = prev ? new Date(Date.parse(prev.replacedAt) + m.graceMs).toISOString() : null;
      provider = {
        ...META,
        status: error ? "error" : entry.status,
        last4: entry.key.last4,
        savedAt: entry.key.savedAt,
        previous: !error && prev && Date.parse(expiresAt) > Date.now() ? { last4: prev.last4, replacedAt: prev.replacedAt, expiresAt } : null,
        ...(error ? { error } : {}),
      };
    }
    return {
      ready: true,
      revision: data.revision,
      fileError: null,
      providers: [provider],
      relay: data.relay ? { status: data.relay.status, last4: data.relay.last4, createdAt: data.relay.createdAt } : { status: "missing" },
      log: data.log,
    };
  }

  async function persist(next) {
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.credentials-${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(tmp, filePath); // 先写临时文件再改名：主产品读到的要么是旧的，要么是新的，不会是半个
  }

  async function status() {
    const product = await productStatus();
    const s = await setup();
    if (s.problem)
      return { ready: false, setupError: s.problem, revision: 0, providers: [blankProvider("missing")], relay: { status: "missing" }, log: [], product };
    const { data, fileError } = await readCredentials(s.m);
    return { ...view(s.m, s.master, data, fileError), product };
  }

  function apply(m, master, data, body, now) {
    const next = structuredClone(data);
    const entry = next.providers[PROVIDER];
    let token = null;
    let message;
    if (body.type === "key.set") {
      if (body.provider !== PROVIDER) throw new AppError("不认识的供应商");
      let key;
      try {
        key = m.normalizeKey(body.key);
      } catch (e) {
        throw new AppError(e.message);
      }
      let readable = true;
      if (entry)
        try {
          m.unseal(master, PROVIDER, entry.key);
        } catch {
          readable = false; // 旧记录解不开（换过主密钥）：重新录入覆盖它，不留作上一把
        }
      const last4 = m.lastFour(key);
      message = `${!entry ? "配置" : readable ? "替换" : "重新录入"} AIHubMix key（尾号 ${last4}）`;
      next.providers[PROVIDER] = {
        status: "active",
        key: { ...m.seal(master, PROVIDER, key), last4, savedAt: now },
        previous: entry && readable ? { iv: entry.key.iv, tag: entry.key.tag, data: entry.key.data, last4: entry.key.last4, replacedAt: now } : null,
      };
    } else if (body.type === "key.disable" || body.type === "key.enable") {
      if (!entry) throw new AppError("还没有配置 AIHubMix key");
      entry.status = body.type === "key.disable" ? "disabled" : "active";
      message = `${body.type === "key.disable" ? "停用" : "启用"} AIHubMix key（尾号 ${entry.key.last4}）`;
    } else if (body.type === "relay.create" || body.type === "relay.rotate") {
      if (body.type === "relay.create" && next.relay) throw new AppError("已经有团队口令了，要换请用「更换」");
      if (body.type === "relay.rotate" && !next.relay) throw new AppError("还没有团队口令");
      token = m.newRelayToken();
      next.relay = { status: "active", sha256: m.hashToken(token), last4: m.lastFour(token), createdAt: now };
      message = `${body.type === "relay.create" ? "生成" : "更换"}团队口令（尾号 ${next.relay.last4}）`;
    } else if (body.type === "relay.disable" || body.type === "relay.enable") {
      if (!next.relay) throw new AppError("还没有团队口令");
      next.relay.status = body.type === "relay.disable" ? "disabled" : "active";
      message = `${body.type === "relay.disable" ? "停用" : "启用"}团队口令（尾号 ${next.relay.last4}）`;
    } else throw new AppError("不支持的操作");
    next.revision = data.revision + 1;
    next.updatedAt = now;
    next.log = [{ id: randomUUID(), at: now, action: body.type, message }, ...data.log].slice(0, LOG_LIMIT);
    return { next, token };
  }

  return {
    status,
    action: (body) =>
      serial(async () => {
        if (!body || typeof body !== "object") throw new AppError("请求内容不正确");
        const s = await setup();
        if (s.problem) throw new AppError(`${s.problem}，暂时不能保存`, 503);
        const { data, fileError } = await readCredentials(s.m);
        if (fileError) throw new AppError(`凭据文件读不出来（${fileError}），后台不会覆盖它；核对文件后刷新`, 500);
        if (body.revision !== data.revision) throw new AppError("凭据已在其他页面更新，请刷新后再操作；未覆盖任何数据", 409);
        const { next, token } = apply(s.m, s.master, data, body, new Date().toISOString());
        await persist(next);
        const creds = { ...view(s.m, s.master, next, null), product: await productStatus() };
        return token ? { creds, token } : { creds };
      }),
  };
}
