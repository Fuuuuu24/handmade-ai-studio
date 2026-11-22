import { builtinBackdrop } from '@/config/backdrops';
import { backdropBasisOf, basisOfBackdropSnapshot, diffBackdropBasis } from './snapshot';
import type { Approval, Backdrop, BackdropRef, Id, Work, WorkState } from './types';

/* 背景图与模板库（PRD FR-06，技术写法 13.4）。内置模板只写在配置里；生成的背景图存在 backdrops 表，
   用户沉淀进模板库后别的作品才能套用。沉淀、改名、删除只有界面按钮（PRD 4.2 第 2 条）。 */

export function refOfBackdrop(b: Backdrop): BackdropRef {
  return {
    id: b.id,
    name: b.name,
    builtin: false,
    placeholder: false,
    params: b.params,
    workId: b.workId,
    saved: b.savedAt != null,
    deleted: b.deletedAt != null,
    blobId: b.blobId,
    thumbId: b.thumbId,
    image: null,
    colors: null,
  };
}

// 内置模板参数先留空（2026-11-22 发起人定）
export function refOfBuiltin(id: Id): BackdropRef | null {
  const b = builtinBackdrop(id);
  if (!b) return null;
  return {
    id: b.id,
    name: b.name,
    builtin: true,
    placeholder: !b.image,
    params: null,
    workId: null,
    saved: true,
    deleted: false,
    blobId: null,
    thumbId: null,
    image: b.image,
    colors: b.colors,
  };
}

// 这件作品某一轮的背景候选，按张排
export const backdropCandidates = (backdrops: readonly Backdrop[], workId: Id, round: number) =>
  backdrops.filter((b) => b.workId === workId && b.round === round).sort((a, b) => a.slot - b.slot);

// 背景这一步完成：选定了背景图；选的是这件作品自己生成的，还要共创总结已确认（技术写法 13.2）
export const backdropDone = (work: Work, ref: BackdropRef | null) =>
  !!ref && (ref.workId !== work.id || work.story.summaryState === 'confirmed');

// 小间的 use_backdrop 能选什么：内置模板、已沉淀且没删除的；这件作品的背景候选只能用户点「用这张」（技术写法 13.7）
export function agentPickProblem(ref: BackdropRef | null, id: Id): string | null {
  if (!ref) return `没有编号为 ${id} 的背景图`;
  if (ref.deleted) return '这张背景图已经从模板库删除，不能再选';
  if (!ref.builtin && !ref.saved) return '这是背景候选，还没沉淀进模板库；选哪张要由用户在画布上点「用这张」';
  return null;
}

// 用户在画布上能选什么：模板库里的（没删除），或这件作品的背景候选
export function userPickProblem(ref: BackdropRef | null, work: Work): string | null {
  if (!ref) return '找不到这张背景图';
  if (ref.deleted && ref.id !== work.backdropId) return '这张背景图已经从模板库删除，不能再选';
  if (!ref.builtin && !ref.saved && ref.workId !== work.id) return '这张背景图还没沉淀进模板库';
  return null;
}

export const backdropNameProblem = (name: string) => (name.trim() ? null : '背景图要起个名字');

// 被几件作品用过（AC-06.1）：现在选着它的，加上合成批准里用过它的
export function usedBy(id: Id, works: readonly Work[], approvals: readonly Approval[]): number {
  const set = new Set(works.filter((w) => w.backdropId === id).map((w) => w.id));
  for (const a of approvals) if (a.kind === 'scene' && a.snapshot.backdropId === id) set.add(a.workId);
  return set.size;
}

// 选定的是这件作品生成的背景图，生成之后共创总结、背景风格或品类尺寸又改过：背景图不作废，画布提示
// 「背景是按旧的内容生成的」（技术写法 13.4）。换生图模型不算（AC-06.7）
export function backdropLag(s: WorkState): string[] {
  const ref = s.backdrop;
  if (!ref || ref.builtin || ref.workId !== s.work.id) return [];
  const b = s.backdrops.find((x) => x.id === ref.id);
  const a = s.backdropApproval;
  if (!b || !a || a.usedRound !== b.round) return [];
  return diffBackdropBasis(basisOfBackdropSnapshot(a.snapshot), backdropBasisOf(s.work)).filter((x) => x !== '生图模型');
}
