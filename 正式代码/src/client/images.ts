import { UPLOAD } from '@/config/upload';
import type { ImageInput } from '@/data/repo';

/* 浏览器里的图片处理：原图原样保存（PRD 4.2 第 5 条），另做缩略图给小间看、压缩图发给生图模型。 */

export function checkFile(file: File, existing: number): string | null {
  if (!(UPLOAD.types as readonly string[]).includes(file.type)) return `「${file.name}」不是 JPG、PNG 或 WebP 图片（手机里的 HEIC 需要先转成 JPG）`;
  if (file.size > UPLOAD.maxBytes) return `「${file.name}」超过 ${UPLOAD.maxBytes / 1024 / 1024}MB`;
  if (existing >= UPLOAD.maxCount) return `一件作品最多 ${UPLOAD.maxCount} 张照片`;
  return null;
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob); // 按照片自带的方向信息摆正
  } catch {
    throw new Error('这张图片读不出来，可能已损坏或格式不受支持');
  }
}

async function encode(bitmap: ImageBitmap, maxEdge: number, type: 'image/jpeg' | 'image/png', quality = 0.88): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持图片处理');
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'; // 透明背景转 JPG 时补白底，避免变黑
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type, quality });
}

export interface PreparedUpload extends ImageInput {
  warnings: string[];
}

export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const bitmap = await decode(file);
  try {
    const thumb = await encode(bitmap, UPLOAD.thumbEdge, 'image/jpeg', 0.85);
    const warnings =
      Math.max(bitmap.width, bitmap.height) < UPLOAD.lowEdge ? ['这张照片尺寸偏小，细节可能不够清楚，有条件的话补拍一张更清楚的'] : [];
    return { blob: file, thumb, width: bitmap.width, height: bitmap.height, warnings };
  } finally {
    bitmap.close();
  }
}

// 生成结果、白底图这类派生图片也做一张缩略图
export async function prepareDerived(blob: Blob): Promise<ImageInput> {
  const bitmap = await decode(blob);
  try {
    return { blob, thumb: await encode(bitmap, UPLOAD.thumbEdge, 'image/jpeg', 0.85), width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

export const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });

// 发给生图模型的参考图：长边压到 UPLOAD.refEdge，减少从大陆到香港服务器的上传量。
// 一律重新编码：按照片自带的方向信息摆正后再发，模型不会看到横着的图
export async function referenceDataUrl(blob: Blob): Promise<string> {
  const bitmap = await decode(blob);
  try {
    return blobToDataUrl(await encode(bitmap, UPLOAD.refEdge, 'image/jpeg', 0.9));
  } finally {
    bitmap.close();
  }
}

export async function imageSize(blob: Blob) {
  const bitmap = await decode(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}
