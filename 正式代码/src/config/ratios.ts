// 主图比例（PRD AC-08.1）：用户每次任选一种；平台说明只作参考，不限制选择。
export const RATIOS = ['1:1', '3:4', '9:16'] as const;
export type Ratio = (typeof RATIOS)[number];

export const RATIO_NOTES: Record<Ratio, string> = {
  '1:1': '淘宝／天猫、微信小店主图必传比例',
  '3:4': '淘宝／天猫、微信小店可选；小红书常见',
  '9:16': '三个平台主图都不用，可用于其他展示',
};

export const isRatio = (v: unknown): v is Ratio => typeof v === 'string' && (RATIOS as readonly string[]).includes(v);
