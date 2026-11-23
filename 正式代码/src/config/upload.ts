// 上传限制（PRD O6 未定）：暂沿用原型的值，结合生图服务实测再定；前后端共用这一份。
export const UPLOAD = {
  types: ['image/jpeg', 'image/png', 'image/webp'] as const,
  maxBytes: 10 * 1024 * 1024,
  maxCount: 8,
  lowEdge: 600, // 长边低于这个值提示可能不够清楚
  thumbEdge: 768, // 给小间看的缩略图长边
  refEdge: 2048, // 发给生图模型的参考图长边（压缩后再上传，减少大陆到香港的上传量）
};

// 照片类型（PRD AC-02.1）：正面、侧面、背面三张必须有，细节照可另传。首页和对话里上传的先进「未分类」，
// 用户在商品画布里选类型，小间也能选（set_photo_kind；会顶掉或移走某个角度的照片时弹确认框，技术写法 14.5）
export const ASSET_KINDS = { front: '正面', side: '侧面', back: '背面', detail: '细节', unsorted: '未分类' } as const;
