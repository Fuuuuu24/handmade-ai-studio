import 'server-only';

/* 脱敏（技术写法第 12.6 节）：错误文字返回浏览器或写进日志之前，去掉密钥和团队口令的原文。
   用过的密钥记在内存里（最多 8 个），整串换成尾号；再把形如 sk-xxx、Bearer xxx 的长串换掉。 */

const seen = ((globalThis as { __yijianSecrets?: Set<string> }).__yijianSecrets ??= new Set<string>());

export function rememberSecret(secret: string): string {
  seen.add(secret);
  if (seen.size > 8) seen.delete(seen.values().next().value as string);
  return secret;
}

export function redact(text: string): string {
  let out = text;
  for (const secret of seen) if (secret.length >= 8) out = out.split(secret).join(`（尾号 ${secret.slice(-4)}）`);
  return out.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-…').replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer …');
}
