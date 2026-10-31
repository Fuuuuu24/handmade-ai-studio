import { CANDIDATES_PER_ROUND } from '@/config/budget';
import { STYLE_KEYS, STYLE_LABELS, type StyleKey } from '@/config/style';
import { coreInfoOf } from './info';
import type { Asset, Basis, Id, Snapshot, Work } from './types';
import { same } from './util';

const KIND_ORDER = { overall: 0, back: 1, detail: 2 } as const;

export const activeUploads = (assets: readonly Asset[], workId: Id) =>
  assets
    .filter((a) => a.workId === workId && a.origin === 'upload' && !a.removed)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.createdAt - b.createdAt);

// 参考图：A 路线用选定的白底图加细节图，B 路线用全部原图；超过模型上限时按整体、背面、细节的顺序截断
export function referencesOf(work: Work, assets: readonly Asset[], maxRefs: number): Id[] {
  const uploads = activeUploads(assets, work.id);
  let refs: Id[];
  if (work.route === 'A') {
    const white = assets.find((a) => a.id === work.whiteChoice && !a.removed);
    refs = [...(white ? [white.id] : []), ...uploads.filter((a) => a.kind === 'detail').map((a) => a.id)];
  } else {
    refs = uploads.map((a) => a.id);
  }
  return refs.slice(0, Math.max(1, maxRefs));
}

export const styleValuesOf = (work: Work) =>
  Object.fromEntries(STYLE_KEYS.map((k) => [k, work.style[k].value.trim()])) as Record<StyleKey, string>;

export function basisOf(work: Work, assets: readonly Asset[], maxRefs: number): Basis {
  return {
    references: referencesOf(work, assets, maxRefs),
    route: work.route,
    info: coreInfoOf(work.info),
    summary: work.story.summaryState === 'confirmed' ? work.story.summary : null,
    style: styleValuesOf(work),
    sceneId: work.sceneId,
    ratio: work.ratio,
    imageModel: work.imageModel,
  };
}

export const snapshotOf = (work: Work, assets: readonly Asset[], maxRefs: number): Snapshot => ({
  ...basisOf(work, assets, maxRefs),
  prompt: work.prompt?.text ?? '',
  count: CANDIDATES_PER_ROUND,
});

const BASIS_PARTS: [keyof Basis, string][] = [
  ['references', '参考图'],
  ['route', '资产路线'],
  ['info', '商品信息'],
  ['summary', '共创总结'],
  ['sceneId', '布景'],
  ['ratio', '比例'],
  ['imageModel', '生图模型'],
];

// 依据里哪些内容变了，返回给用户看的名称
export function diffBasis(a: Basis, b: Basis): string[] {
  const changed: string[] = [];
  for (const [key, label] of BASIS_PARTS) {
    if (key === 'sceneId') continue;
    if (!same(a[key], b[key])) changed.push(label);
  }
  for (const k of STYLE_KEYS) if (a.style[k] !== b.style[k]) changed.push(STYLE_LABELS[k]);
  // 只换了布景、风格值没变时才报「布景」，避免和具体风格项重复
  if (!changed.length && a.sceneId !== b.sceneId) changed.push('布景');
  return changed;
}

// 提示词由其他内容决定：其他内容变了就报那些；只有提示词本身被改时才报「提示词」
export function diffSnapshot(a: Snapshot, b: Snapshot): string[] {
  const changed = diffBasis(a, b);
  if (a.count !== b.count) changed.push('候选数量');
  if (!changed.length && a.prompt !== b.prompt) changed.push('提示词');
  return changed;
}
