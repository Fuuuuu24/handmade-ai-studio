import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const project = fileURLToPath(new URL("../../", import.meta.url));
export async function readSource(root = project) {
  const paths = [
    "src/agent/instructions.ts",
    "src/config/white.ts",
    "src/config/models.ts",
  ];
  const files = await Promise.all(
    paths.map(async (p) => {
      const absolute = path.join(root, "正式代码", p);
      const text = await readFile(absolute, "utf8");
      return {
        path: `正式代码/${p}`,
        absolute,
        hash: createHash("sha256").update(text).digest("hex"),
      };
    }),
  );
  const modules = await Promise.all(
    files.map((f) => import(`${pathToFileURL(f.absolute).href}?sha=${f.hash}`)),
  );
  const [instructions, white, models] = modules;
  if (
    typeof instructions.SYSTEM_RULES !== "string" ||
    typeof white.WHITE?.prompt !== "function" ||
    !Array.isArray(models.CHAT_MODELS) ||
    !Array.isArray(models.IMAGE_MODELS)
  )
    throw new Error("来源配置结构不符合预期，无法同步");
  const provider = (id) =>
    id.startsWith("qwen")
      ? "通义千问"
      : id.startsWith("deepseek")
        ? "DeepSeek"
        : id.startsWith("doubao")
          ? "火山引擎"
          : id.startsWith("gemini")
            ? "Google"
            : id.startsWith("gpt")
              ? "OpenAI"
              : "自定义";
  return {
    readAt: new Date().toISOString(),
    hash: createHash("sha256")
      .update(files.map((f) => f.hash).join(":"))
      .digest("hex"),
    files: files.map(({ absolute, ...f }) => f),
    prompts: [
      {
        id: "xiaojian",
        label: "小间 · 系统规则",
        description: "助手身份、共创流程、工具边界与提示词写法",
        path: files[0].path,
        variables: ["state"],
        content: instructions.SYSTEM_RULES,
      },
      {
        id: "white",
        label: "白底商品图",
        description: "依据原图生成白底资产，保真要求按作品追加",
        path: files[1].path,
        variables: ["keep"],
        content: white.WHITE.prompt("{{keep}}"),
      },
    ],
    models: [
      ...models.CHAT_MODELS.map((m) => ({
        ...m,
        kind: "chat",
        provider: provider(m.id),
        enabled: true,
      })),
      ...models.IMAGE_MODELS.map((m) => ({
        ...m,
        kind: "image",
        provider: provider(m.id),
        enabled: true,
      })),
    ],
    defaults: {
      chat: models.DEFAULT_CHAT_MODEL,
      image: models.DEFAULT_IMAGE_MODEL,
    },
  };
}
