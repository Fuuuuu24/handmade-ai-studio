// 商品信息字段（PRD FR-03）。核心字段会写进提示词并锁进批准快照；选填字段改了不让批准失效（沿用 v2 的做法）。
export const INFO_KEYS = ['category', 'material', 'size', 'keep', 'price', 'audience'] as const;
export type InfoKey = (typeof INFO_KEYS)[number];

export const INFO_CORE = ['category', 'material', 'size', 'keep'] as const satisfies readonly InfoKey[];
export type CoreInfoKey = (typeof INFO_CORE)[number];

// 必须有值或标「未知」才能批准；「不能改的细节」允许留空，用户可随时补充
export const INFO_REQUIRED = ['category', 'material', 'size'] as const satisfies readonly CoreInfoKey[];

export const INFO_FIELDS: Record<InfoKey, { label: string; placeholder: string }> = {
  category: { label: '品类', placeholder: '比如 耳饰、项链、手链' },
  material: { label: '材料', placeholder: '比如 黄铜镀金、淡水珍珠' },
  size: { label: '尺寸', placeholder: '比如 长 4.5cm、宽 2cm' },
  keep: { label: '不能改的细节', placeholder: '数量、结构、连接方式、纹样、颜色' },
  price: { label: '售价', placeholder: '选填，比如 128 元' },
  audience: { label: '目标顾客', placeholder: '选填，比如 送礼的年轻人' },
};
