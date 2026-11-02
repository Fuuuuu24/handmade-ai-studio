import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

/* 经 SSH 隧道打开服务器上的后台（技术方案「部署」）。后台在服务器上只监听 127.0.0.1，不对外开放；
   隧道两端端口必须相同，因为后台只接受 Host 为 127.0.0.1:<监听端口> 的请求。
   服务器地址不进仓库：用环境变量 ADMIN_SSH_HOST，或写进本目录的 .ssh-host（已被 .gitignore 忽略）。 */

const port = Number(process.env.ADMIN_PORT || 4177);
let host = process.env.ADMIN_SSH_HOST?.trim();
if (!host) {
  try {
    host = readFileSync(new URL(".ssh-host", import.meta.url), "utf8").trim();
  } catch {
    host = "";
  }
}
if (!host) {
  console.error(
    "没有服务器地址：设置 ADMIN_SSH_HOST=用户名@服务器地址，或把它写进 管理后台/正式代码/.ssh-host（不入库）",
  );
  process.exit(1);
}
// 只认「用户名@主机」这类写法，防止把 -o 之类的参数当成地址传给 ssh
if (!/^[A-Za-z0-9._-]+(@[A-Za-z0-9._-]+)?$/.test(host) || host.startsWith("-")) {
  console.error(`服务器地址格式不对：${host}`);
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`ADMIN_PORT 不对：${process.env.ADMIN_PORT}`);
  process.exit(1);
}
const args = ["-N", "-o", "ExitOnForwardFailure=yes", "-L", `${port}:127.0.0.1:${port}`, host];
if (process.argv.includes("--dry-run")) {
  console.log(["ssh", ...args].join(" "));
  process.exit(0);
}
console.log(`正在连接 ${host}。连上后打开 http://127.0.0.1:${port}，按 Ctrl+C 断开。`);
const child = spawn("ssh", args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
