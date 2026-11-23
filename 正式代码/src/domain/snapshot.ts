import { BACKDROP } from '@/config/backdrops';
import { CANDIDATES_PER_ROUND } from '@/config/budget';
import { BACKDROP_KEYS, SCENE_KEYS, STYLE_LABELS, type StyleKey } from '@/config/style';
import { viewRefs } from './assets';
import { backdropInfoOf, coreInfoOf } from './info';
import type { Asset, BackdropBasis, BackdropParams, BackdropSnapshot, SceneBasis, SceneParams, SceneSnapshot, StorySummary, Work } from './types';
import { same } from './util';

/* 两种批准的依据和快照（PRD AC-07.3，技术写法 13.4、13.5）。提示词由这些内容决定：依据变了提示词就可能过期，
   快照变了批准就失效。背景比例固定，不进快照；合成快照不含背景五项，只记用的是哪张背景图。 */

export const backdropStyleOf = (work: Work): BackdropParams =>
  Object.fromEntries(BACKDROP_KEYS.map((k) => [k, work.style[k].value.trim()])) as BackdropParams;

export const sceneStyleOf = (work: Work): SceneParams =>
  Object.fromEntries(SCENE_KEYS.map((k) => [k, work.style[k].value.trim()])) as SceneParams;

// 只有确认过的总结进依据；草稿不算
const confirmedSummary = (work: Work): StorySummary | null => (work.story.summaryState === 'confirmed' ? work.story.summary : null);

export const backdropBasisOf = (work: Work): BackdropBasis => ({
  style: backdropStyleOf(work),
  summary: confirmedSummary(work),
  info: backdropInfoOf(work.info),
  imageModel: work.imageModel,
});

export const backdropSnapshotOf = (work: Work): BackdropSnapshot => ({
  ...backdropBasisOf(work),
  prompt: work.backdropPrompt?.text ?? '',
  count: BACKDROP.count,
});

export const sceneBasisOf = (work: Work, assets: readonly Asset[]): SceneBasis => ({
  references: viewRefs(assets, work.id),
  info: coreInfoOf(work.info),
  summary: confirmedSummary(work),
  backdropId: work.backdropId,
  style: sceneStyleOf(work),
  ratio: work.ratio,
  imageModel: work.imageModel,
});

export const sceneSnapshotOf = (work: Work, assets: readonly Asset[]): SceneSnapshot => ({
  ...sceneBasisOf(work, assets),
  prompt: work.prompt?.text ?? '',
  count: CANDIDATES_PER_ROUND,
});

// 快照里属于提示词依据的部分（去掉提示词原文和张数）
export function basisOfBackdropSnapshot(s: BackdropSnapshot): BackdropBasis {
  const { style, summary, info, imageModel } = s;
  return { style, summary, info, imageModel };
}

export function basisOfSceneSnapshot(s: SceneSnapshot): SceneBasis {
  const { references, info, summary, backdropId, style, ratio, imageModel } = s;
  return { references, info, summary, backdropId, style, ratio, imageModel };
}

/* ---------- 改了什么：返回给用户看的名称 ---------- */

const BACKDROP_PARTS: [keyof BackdropBasis, string][] = [
  ['info', '品类和尺寸'],
  ['summary', '共创总结'],
  ['imageModel', '生图模型'],
];

const SCENE_PARTS: [keyof SceneBasis, string][] = [
  ['references', '三视图'],
  ['info', '商品信息'],
  ['summary', '共创总结'],
  ['backdropId', '背景图'],
  ['ratio', '比例'],
  ['imageModel', '生图模型'],
];

function diffParts<B extends { style: Record<string, string> }>(a: B, b: B, parts: [keyof B, string][], keys: readonly StyleKey[]): string[] {
  const changed = parts.filter(([key]) => !same(a[key], b[key])).map(([, label]) => label);
  for (const k of keys) if ((a.style[k] ?? '') !== (b.style[k] ?? '')) changed.push(STYLE_LABELS[k]);
  return changed;
}

export const diffBackdropBasis = (a: BackdropBasis, b: BackdropBasis) => diffParts(a, b, BACKDROP_PARTS, BACKDROP_KEYS);

export const diffSceneBasis = (a: SceneBasis, b: SceneBasis) => diffParts(a, b, SCENE_PARTS, SCENE_KEYS);

// 提示词由其他内容决定：其他内容变了就报那些；只有提示词本身被改时才报「提示词」
function withPrompt(changed: string[], a: { prompt: string; count: number }, b: { prompt: string; count: number }, countLabel: string) {
  if (a.count !== b.count) changed.push(countLabel);
  if (!changed.length && a.prompt !== b.prompt) changed.push('提示词');
  return changed;
}

export const diffBackdropSnapshot = (a: BackdropSnapshot, b: BackdropSnapshot) => withPrompt(diffBackdropBasis(a, b), a, b, '背景张数');

export const diffSceneSnapshot = (a: SceneSnapshot, b: SceneSnapshot) => withPrompt(diffSceneBasis(a, b), a, b, '候选数量');
