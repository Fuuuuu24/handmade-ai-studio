import type { ChatPricing } from '@/domain/cost';
import type { Ratio } from './ratios';

/* 可选模型（PRD AC-08.7、AC-11.8、O7、O13）。网关为 AIHubMix，换模型只改这里。
   价格为估价，来源：AIHubMix 公开模型目录与模型页（2026-10-31 查询）；按 token 计费的生图模型按官方每张 token 数折算。
   「试用可用」与「大陆正式版可用」两档结论在产品内测试后补记，这里不预设。 */

export const GATEWAY = {
  chatBaseURL: 'https://aihubmix.com/v1',
  imageBaseURL: 'https://aihubmix.com',
};

export interface ChatModel {
  id: string;
  label: string;
  vision: boolean; // 能否看商品照片；不能看时不发送照片，并在界面上说明
  reasoning: 'none' | 'low' | 'medium' | 'high';
  pricing: ChatPricing;
}

// 2026-10-31 实测：两者都能看图并正确调用工具。deepseek-v4-flash 带图调用返回 404（没有支持图片输入的通道），所以用看图实验版。
export const CHAT_MODELS: readonly ChatModel[] = [
  { id: 'qwen3.8-flash', label: 'Qwen 3.8 Flash', vision: true, reasoning: 'low', pricing: { inputPerMTok: 0.1126, outputPerMTok: 0.380025 } },
  {
    id: 'deepseek-v4-flash-vision-exp',
    label: 'DeepSeek V4 Flash（看图实验版）',
    vision: true,
    reasoning: 'low',
    pricing: { inputPerMTok: 0.155, outputPerMTok: 0.62 },
  },
];

export const DEFAULT_CHAT_MODEL = 'qwen3.8-flash';

export type ImageSizing =
  | { kind: 'aspect_ratio'; resolution?: '1K' | '2K' }
  | { kind: 'size'; sizes: Record<Ratio, string> };

export interface ImageModel {
  id: string;
  label: string;
  perImageUSD: number; // 每张估价，记账和单张上限用
  perRefUSD: number; // 每张参考图的额外估价
  maxRefs: number; // 一次最多带几张参考图
  sizing: ImageSizing;
  outputFormat?: 'jpeg' | 'png';
  extra?: Record<string, unknown>; // 模型专属参数
}

export const IMAGE_MODELS: readonly ImageModel[] = [
  // 默认：四个候选里最便宜，初测中国内模型最有希望（交接文档第 8 节），可在对话框里切换
  { id: 'doubao-seedream-5.0-lite', label: 'Seedream 5.0 Lite', perImageUSD: 0.034, perRefUSD: 0, maxRefs: 4, sizing: { kind: 'aspect_ratio' }, outputFormat: 'jpeg' },
  // 输出图片 60 美元／百万 token，1K 约 1290 token
  { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash 图像', perImageUSD: 0.08, perRefUSD: 0.001, maxRefs: 4, sizing: { kind: 'aspect_ratio', resolution: '1K' } },
  // 输出图片 30 美元／百万 token，medium 质量约 1600 token；参考图输入 8 美元／百万 token
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    perImageUSD: 0.07,
    perRefUSD: 0.01,
    maxRefs: 4,
    sizing: { kind: 'size', sizes: { '1:1': '1024x1024', '3:4': '1152x1536', '9:16': '1008x1792' } },
    outputFormat: 'jpeg',
    extra: { quality: 'medium' },
  },
  // 关闭提示词改写，保证生成按小间写的提示词来
  {
    id: 'qwen-image-3.0',
    label: 'Qwen Image 3.0',
    perImageUSD: 0.02535,
    perRefUSD: 0.00286,
    maxRefs: 4,
    sizing: { kind: 'size', sizes: { '1:1': '1328x1328', '3:4': '1104x1472', '9:16': '928x1664' } },
    extra: { prompt_extend: false },
  },
];

export const DEFAULT_IMAGE_MODEL = 'doubao-seedream-5.0-lite';

export const chatModel = (id: string) => CHAT_MODELS.find((m) => m.id === id) ?? null;
export const imageModel = (id: string) => IMAGE_MODELS.find((m) => m.id === id) ?? null;

export const imageEstimate = (m: ImageModel, refs: number) => m.perImageUSD + m.perRefUSD * refs;

// 模型被移出配置后，旧作品按默认模型算参考图上限
export const maxRefsOf = (id: string) => imageModel(id)?.maxRefs ?? imageModel(DEFAULT_IMAGE_MODEL)!.maxRefs;
