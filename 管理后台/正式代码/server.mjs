import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createStore, AppError } from "./store.mjs";
import { readSource } from "./source.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const assets = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};
const MAX_BODY = 512 * 1024;
export function createApp({
  dataDir = path.join(here, "data"),
  sourceReader = readSource,
} = {}) {
  const store = createStore({ dataDir, readSource: sourceReader });
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
    );
    try {
      const host = req.headers.host,
        allowedHost = `127.0.0.1:${server.address().port}`;
      if (host !== allowedHost)
        throw new AppError("此后台只接受本机地址访问", 403);
      const url = new URL(req.url, `http://${host}`);
      if (req.method === "GET" && url.pathname === "/api/state")
        return json(res, 200, await store.get());
      if (req.method === "GET" && url.pathname === "/api/source")
        return json(res, 200, await sourceReader());
      if (req.method === "GET" && url.pathname === "/api/export") {
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="yijian-admin.json"',
        );
        return json(res, 200, await store.get());
      }
      if (req.method === "POST" && url.pathname === "/api/action") {
        if (
          req.headers.origin &&
          req.headers.origin !== `http://${allowedHost}`
        )
          throw new AppError("不接受跨来源修改请求", 403);
        if (!req.headers["content-type"]?.startsWith("application/json"))
          throw new AppError("修改请求必须使用 JSON", 415);
        let body = "",
          bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > MAX_BODY)
            throw new AppError("请求过大，最多 512 KB", 413);
          body += chunk;
        }
        let action;
        try {
          action = JSON.parse(body);
        } catch {
          throw new AppError("请求不是有效 JSON");
        }
        return json(res, 200, await store.action(action));
      }
      if (req.method === "GET" && assets[url.pathname]) {
        const [file, type] = assets[url.pathname];
        res.setHeader("Content-Type", type);
        return res.end(await readFile(path.join(here, "public", file)));
      }
      if (req.method !== "GET" && req.method !== "POST")
        throw new AppError("不支持这个请求方法", 405);
      throw new AppError("没有这个页面或接口", 404);
    } catch (e) {
      console.error(`[后台] ${e.message}`);
      if (!res.headersSent) json(res, e.status || 500, { error: e.message });
      else res.end();
    }
  });
  return server;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.ADMIN_PORT || 4177);
  const server = createApp();
  server.on("error", (e) => {
    console.error(`后台启动失败：${e.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `一间独立管理后台 http://127.0.0.1:${port}\n只读同步主产品；后台修改独立保存于 data/state.json`,
    ),
  );
}
