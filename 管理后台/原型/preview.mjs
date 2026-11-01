import http from "node:http";
import { readFile } from "node:fs/promises";
const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css"],
  "/app.js": ["app.js", "text/javascript"],
  "/seed.json": ["seed.json", "application/json"],
};
http
  .createServer(async (req, res) => {
    try {
      const f = files[new URL(req.url, "http://localhost").pathname];
      if (!f) {
        res.writeHead(404).end();
        return;
      }
      res.setHeader("Content-Type", f[1]);
      res.end(await readFile(new URL(f[0], import.meta.url)));
    } catch (e) {
      res.writeHead(500).end(e.message);
    }
  })
  .listen(4176, "127.0.0.1", () => console.log("原型 http://127.0.0.1:4176"));
