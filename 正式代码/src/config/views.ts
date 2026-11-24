import type { Ratio } from './ratios';

// 三视图（PRD 4.3、AC-02.3，技术写法 13.3）：正面、侧面、背面各生成一张白底图，用户点按钮才生成、逐张确认；
// 合成只用这三张，原图不进合成。比例由系统固定（2026-11-22 代理自定，可再调）
export const VIEW_ANGLES = ['front', 'side', 'back'] as const;
export type ViewAngle = (typeof VIEW_ANGLES)[number];

export const VIEW_NAMES: Record<ViewAngle, string> = { front: '正面', side: '侧面', back: '背面' };

export const isViewAngle = (v: unknown): v is ViewAngle => typeof v === 'string' && (VIEW_ANGLES as readonly string[]).includes(v);

// 生图会重画像素，初测常常没有完整入框、改了结构（交接文档第 12 节），所以提示词先写清每张参考图的用途和「不改结构」
export const VIEWS = {
  ratio: '1:1' as Ratio,
  // 每张原图最多生成几次（含失败），防止反复花钱；换一张原图重新计数。重做到上限发起人判断不会出现，不另做处理
  perAngle: 3,
  prompt: (angle: ViewAngle, keep: string, withFront: boolean) =>
    [
      `第 1 张参考图是这件手作饰品的${VIEW_NAMES[angle]}照片，要生成的就是这个角度`,
      withFront ? '；第 2 张是它的正面照片，只用来理解整体结构，不要照它的角度画' : '',
      '。',
      `按第 1 张的角度，把这件饰品单独放到纯白背景上，做成一张${VIEW_NAMES[angle]}白底商品图。`,
      '严格按照片还原颜色、数量、轮廓、连接结构、纹样和材质；只保留照片里看得到的结构，不添加扣头，不延长链条，不补出照片里看不到的部分，闭合的环保持闭合。',
      keep ? `特别注意不能改：${keep}。` : '',
      '整件饰品完整入框，居中，四周留出足够边距，不被裁切。',
      '背景纯白（#ffffff），只有柔和的自然投影；没有道具、文字、水印或边框。',
    ]
      .filter(Boolean)
      .join(''),
};
