import { builtinBackdrop, listedBuiltins } from '@/config/backdrops';
import { BACKDROP_KEYS, NO_PROPS, STYLE_LABELS } from '@/config/style';
import { backdropBasisOf, basisOfBackdropSnapshot, diffBackdropBasis } from './snapshot';
import type { Busy } from './generation';
import type { Approval, Backdrop, BackdropMode, BackdropParams, BackdropRef, Id, Work, WorkState } from './types';

/* 背景图与模板库（PRD FR-06，技术写法 13.4）。内置模板只写在配置里；生成的背景图存在 backdrops 表，
   沉淀进模板库后别的作品才能套用。谁能沉淀、改名、删除见 client/backdrops.ts（技术写法 14.3）。 */

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

// 模板库列表（PRD FR-06）：沉淀的在前（新沉淀的在前），内置模板在后；从模板库删除的不列。
// 画布的「用模板库里的」、首页、给小间的作品状态都按这个顺序（评审第 13 条）
export function libraryList(saved: readonly Backdrop[]): BackdropRef[] {
  const listed = saved.filter((b) => b.savedAt != null && b.deletedAt == null).sort((a, b) => b.savedAt! - a.savedAt!);
  return [...listed.map(refOfBackdrop), ...listedBuiltins().map((b) => refOfBuiltin(b.id)!)];
}

// 这件作品某一轮的背景候选，按张排
export const backdropCandidates = (backdrops: readonly Backdrop[], workId: Id, round: number) =>
  backdrops.filter((b) => b.workId === workId && b.round === round).sort((a, b) => a.slot - b.slot);

// 这件作品自己生成的背景图（沉淀没沉淀、删没删都算）
export const ownBackdrop = (work: Pick<Work, 'id'>, ref: Pick<BackdropRef, 'builtin' | 'workId'>) => !ref.builtin && ref.workId === work.id;

// 背景做法跟着背景图的来源走（技术写法 13.4）：这件作品自己生成的是「自己生成」（共创和总结都属于这张图），
// 内置模板和别的作品沉淀的是「用模板库里的」。选背景图的入口都按它定做法（domain/work.ts 的 chooseBackdrop）
export const backdropModeOf = (work: Pick<Work, 'id'>, ref: Pick<BackdropRef, 'builtin' | 'workId'>): BackdropMode =>
  ownBackdrop(work, ref) ? 'generate' : 'library';

// 背景这一步完成：选定了背景图；选的是这件作品自己生成的，还要共创总结已确认（技术写法 13.2）
export const backdropDone = (work: Work, ref: BackdropRef | null) =>
  !!ref && (!ownBackdrop(work, ref) || work.story.summaryState === 'confirmed');

// 两种生成进行中都不能换背景图：合成时背景图锁进了快照；背景生成时两张出来要在候选里选（技术写法 13.6）。
// 画布按钮、小间的 use_backdrop、问过后代点都查它
export function pickLockProblem(busy: Busy): string | null {
  if (busy.scene) return '正在合成这一轮候选，等结束后再换背景';
  if (busy.backdrop) return '背景正在生成中，等两张背景出来后再换';
  return null;
}

// 小间的 use_backdrop 能选什么：内置模板、别的作品沉淀且没删除的。这件作品自己生成的背景图（沉淀没沉淀都算）
// 是选定背景候选，要先问用户（ask_confirm），用户同意后代点，图里有没有饰品要用户把关（技术写法 14.4）
export function agentPickProblem(ref: BackdropRef | null, id: Id, workId: Id): string | null {
  if (!ref) return `没有编号为 ${id} 的背景图`;
  if (!ref.builtin && ref.workId === workId) {
    return '这是这件作品自己生成的背景图，不用 use_backdrop 选：用 ask_confirm（pick_backdrop）问用户，用户同意后代点；图里不能有饰品，要用户把关';
  }
  if (ref.deleted) return '这张背景图已经从模板库删除，不能再选';
  if (!ref.builtin && !ref.saved) return '这张背景图还没沉淀进模板库，不能选';
  return null;
}

// 用户在画布上能选什么：这件作品自己生成的背景图（沉淀后又从模板库删除的也能重选，删除只挡别的作品套用），
// 或模板库里的（没删除；正在用的那张照常可以再点）
export function userPickProblem(ref: BackdropRef | null, work: Work): string | null {
  if (!ref) return '找不到这张背景图';
  if (ownBackdrop(work, ref)) return null;
  if (ref.deleted && ref.id !== work.backdropId) return '这张背景图已经从模板库删除，不能再选';
  if (!ref.builtin && !ref.saved) return '这张背景图还没沉淀进模板库';
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
  if (!ref || !ownBackdrop(s.work, ref)) return [];
  const b = s.backdrops.find((x) => x.id === ref.id);
  const a = s.backdropApproval;
  if (!b || !a || a.usedRound !== b.round) return [];
  return diffBackdropBasis(basisOfBackdropSnapshot(a.snapshot), backdropBasisOf(s.work)).filter((x) => x !== '生图模型');
}

// 背景图的参数写成一行（给小间看）：内置模板参数为空时按看到的图描述
export const paramsText = (p: BackdropParams | null) =>
  p
    ? BACKDROP_KEYS.map((k) => `${STYLE_LABELS[k]}「${p[k] || (k === 'props' ? NO_PROPS : '未写')}」`).join('、')
    : '示意模板，无参数（描述时按你看到的背景图）';
