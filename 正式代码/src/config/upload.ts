// 上传限制（PRD O6 未定）：暂沿用原型的值，结合生图服务实测再定；前后端共用这一份。
export const UPLOAD = {
  types: ['image/jpeg', 'image/png', 'image/webp'] as const,
  maxBytes: 10 * 1024 * 1024,
  maxCount: 8,
  lowEdge: 600, // 长边低于这个值提示可能不够清楚
  thumbEdge: 768, // 给小间看的缩略图长边
  refEdge: 2048, // 发给生图模型的参考图长边（压缩后再上传，减少大陆到香港的上传量）
};

export const ASSET_KINDS = { overall: '整体', back: '背面', detail: '细节' } as const;
