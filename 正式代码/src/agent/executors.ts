import type { InferToolInput } from 'ai';
import { BACKDROP_MODE_NAMES } from '@/config/backdrops';
import { INFO_FIELDS, type InfoKey } from '@/config/info';
import { imageModel } from '@/config/models';
import { isStepId, STEP_NAMES, type StepId } from '@/config/steps';
import { isBackdropKey, STYLE_LABELS } from '@/config/style';
import { ASSET_KINDS } from '@/config/upload';
import { isViewAngle, VIEW_NAMES } from '@/config/views';
import {
  approvalReminders,
  approvedPhase,
  backdropApprovalBlockers,
  backdropApprovalStatus,
  backdropPromptWriteBlocker,
  PROMPT_NAMES,
  sceneApprovalBlockers,
  sceneApprovalStatus,
  scenePromptWriteBlocker,
  type Blocker,
} from '@/domain/approval';
import { activeUploads, angleNames, angleUpload, anglesToGenerate, viewCheck } from '@/domain/assets';
import { agentPickProblem } from '@/domain/backdrops';
import { passed } from '@/domain/generation';
import { factsOf, handoffBlocker, nextStepOf, pageText } from '@/domain/handoff';
import { saidQuoteFound } from '@/domain/said';
import type { AskAction, AssetKind, Work } from '@/domain/types';
import {
  addFollowup,
  addStoryNote,
  advanceStep,
  clearBackdrop,
  dismissSuggestion,
  draftSummary,
  promptOf,
  renameWork,
  resolvePromptSync,
  reviseFrom,
  setImageModel,
  setNoStory,
  setRatio,
  setStyle,
  suggestInfo,
  writePrompt,
} from '@/domain/work';
import { getSceneApproval, logEvent, patchResult, removeAsset, setPhotoKind } from '@/data/repo';
import { openAskFor, proxyConfirm } from '@/client/asks';
import { chooseBackdropMode, deleteFromLibrary, pickBackdrop, renameBackdrop } from '@/client/backdrops';
import { retryProblem } from '@/client/generation';
import { loadContext, mutateWork, removeWork, resolveBackdrop, type WorkContext } from '@/client/work-store';
import type { ConfirmOptions } from '@/components/ui/dialog';
import type { AgentTools, AskItemInput, ToolName, ToolOutput } from './tools';

/* 小间工具的浏览器端执行器（技术写法第 6 节、13.7、14）。硬规则在这里检查：违反时不执行，把原因作为结果交还模型，
   让它向用户解释（AC-11.5）。四类做法（技术写法 14.2）：
   - 草稿、设置和画布切换直接做；
   - 要用户确认的事先问（ask_confirm），用户回复同意、代码核对过原话后代点（confirm_for_user），每样调用画布按钮的同一个函数；
   - 删除、停用、替换弹出和画布上同样的确认框（deps.confirm），用户点「确认」才执行；
   - 生成没有工具：批准和发起生成是同一下，只由用户滑动；补齐和三视图只放卡片，由用户点。 */

type Input<N extends ToolName> = InferToolInput<AgentTools[N]>;

// 确认框的内容和画布上同一个框（components/ui/dialog.tsx）；小间发起的，标题以「小间想」开头
type ConfirmRequest = ConfirmOptions;

export interface ExecDeps {
  showStep: (step: StepId) => void;
  userTexts: () => readonly string[]; // 用户在对话里发过的文字（不含系统代发的交接和通知），核对「你说的」用（BC-013）
  userTextsAfter: (callId: string) => readonly string[] | null; // 那次工具调用之后用户发过的文字（同样不含系统代发的），核对同意的原话用；卡片没放出来时为空值（技术写法 14.4）
  confirm: (r: ConfirmRequest) => Promise<boolean>; // 弹确认框，用户点完才返回；点「确认」为真
  leave: () => void; // 这件作品删掉了：回作品页，对话不再继续
}

const refuse = (message: string): ToolOutput => ({ ok: false, message });
const done = (message: string, changes?: string[]): ToolOutput => ({ ok: true, message, changes });

// 生成中锁定方案（技术写法 13.6）：合成生成中锁合成快照里的内容，背景生成中锁背景快照里的内容
export const LOCK_SCENE = '正在生成这一轮候选，方案锁定中；等生成结束后再改';
export const LOCK_BACKDROP = '背景正在生成中，背景方案锁定；等两张背景出来后再改';
export const LOCK_PHOTOS = '三视图正在生成，照片锁定；等生成结束后再改';
const BACKDROP_PICKED = '已经选定了背景图，背景五项以背景图记录的参数为准、不能改；想改就用 redesign_backdrop 放开选定的背景图（改完要重新生成），或者换一张模板';

// 工具里的「第几轮候选几」对应到结果
const findResult = (ctx: WorkContext, round: number, candidate: number) =>
  ctx.results.find((r) => r.round === round && r.slot === candidate - 1);

// 修改经 mutateWork 排队执行，读到的总是最新的作品；返回改完的作品
const change = (workId: string, fn: (ctx: WorkContext) => Work): Promise<Work> => mutateWork(workId, fn);

const listText = (bs: readonly Blocker[]) => bs.map((b) => b.text).join('；');
const labels = (keys: readonly InfoKey[]) => keys.map((k) => INFO_FIELDS[k].label).join('、');

// 写提示词前核心信息的建议要先处理完（UX-02）：同一轮里先写建议再写提示词，建议一被接受，提示词就过期
const infoWait = (name: string, b: Blocker) =>
  `没写${name}：${b.text}。先处理建议：用户在「信息」里接受或忽略，或你用 ask_confirm 问过、他同意后代点，也可以用 update_info 撤回；处理完再写，现在写的话，建议一接受提示词就过期了`;

// 「要我替你点吗」的一样：参数是摊平的，按种类取出要的几项；缺了就写明要填什么
function toAction(it: AskItemInput): AskAction | string {
  const need = (what: string) => `${it.type} 要填 ${what}`;
  switch (it.type) {
    case 'confirm_view':
      return it.angle ? { type: it.type, angle: it.angle } : need('angle');
    case 'accept_info':
    case 'mark_unknown':
      return it.field ? { type: it.type, field: it.field } : need('field');
    case 'confirm_summary':
    case 'switch_flow':
      return { type: it.type };
    case 'pick_backdrop':
      return it.round && it.candidate ? { type: it.type, round: it.round, candidate: it.candidate } : need('round 和 candidate');
    case 'save_backdrop':
      return it.name?.trim() ? { type: it.type, name: it.name.trim() } : need('name（沉淀进模板库时的名字）');
    case 'verdict':
      if (!it.round || !it.candidate) return need('round 和 candidate');
      return { type: it.type, round: it.round, candidate: it.candidate, ...(it.real ? { real: it.real } : {}), ...(it.style ? { style: it.style } : {}) };
  }
}

// 改照片类型会顶掉或移走某个角度的照片：按替换弹确认框（技术写法 14.5）
function photoKindConfirm(from: AssetKind, to: AssetKind, displaces: boolean): ConfirmRequest {
  const emptied = isViewAngle(from) ? VIEW_NAMES[from] : null;
  if (displaces && isViewAngle(to)) {
    return {
      title: `小间想替换${VIEW_NAMES[to]}照片？`,
      body: `这张${ASSET_KINDS[from]}照片会放进「${ASSET_KINDS[to]}」，原来那张退回「未分类」，记录保留；${VIEW_NAMES[to]}的三视图要重新生成${emptied ? `，${emptied}会空出来` : ''}，之后的方案需要重新确认。`,
      ok: '替换',
    };
  }
  return {
    title: `小间想把${emptied}照片改成「${ASSET_KINDS[to]}」？`,
    body: `${emptied}会空出来，它的三视图不再使用，之后的方案需要重新确认。`,
    ok: '改',
  };
}

export async function executeTool(workId: string, name: ToolName, rawInput: unknown, deps: ExecDeps, callId = ''): Promise<ToolOutput> {
  const ctx = await loadContext(workId);
  const { busy } = ctx;
  switch (name) {
    case 'update_info': {
      const { items = [], withdraw = [] } = rawInput as Input<'update_info'>;
      if (!items.length && !withdraw.length) return refuse('没写要建议或撤回的信息');
      const gone = withdraw.filter((k) => ctx.work.info[k].suggestion);
      // 先撤回再写新的：同一项既撤回又建议时，留下新写的
      await change(workId, (c) => {
        const cleared = withdraw.reduce((w, k) => (w.info[k].suggestion ? dismissSuggestion(w, k) : w), c.work);
        return items.reduce((w, it) => suggestInfo(w, it.field, it.value, it.note), cleared);
      });
      const list = items.map((it) => `${INFO_FIELDS[it.field].label}「${it.value}」`);
      const none = withdraw.filter((k) => !gone.includes(k));
      const parts = [
        list.length ? `已写成待确认建议：${list.join('、')}（用户接受或同意你代点后才生效）` : '',
        gone.length ? `已撤回建议：${labels(gone)}` : '',
        none.length ? `${labels(none)}没有待处理的建议` : '',
      ].filter(Boolean);
      return done(parts.join('；'), [...list, ...gone.map((k) => `撤回${INFO_FIELDS[k].label}建议`)]);
    }
    case 'rename_work': {
      const n = (rawInput as Input<'rename_work'>).name.trim();
      if (!n) return refuse('名字是空的，没改');
      if (n === ctx.work.name) return done(`作品本来就叫「${n}」`);
      await change(workId, (c) => renameWork(c.work, n));
      return done(`作品改名为「${n}」`, [`作品名「${n}」`]);
    }
    case 'set_photo_kind': {
      const { assetId, kind } = rawInput as Input<'set_photo_kind'>;
      const photo = activeUploads(ctx.assets, workId).find((a) => a.id === assetId);
      if (!photo) return refuse(`没有编号为 ${assetId} 的照片（停用的不算）`);
      // 和画布一样：三视图生成中锁照片；合成生成中三视图锁进了快照，照片也不能动
      if (busy.views) return refuse(LOCK_PHOTOS);
      if (busy.scene) return refuse(LOCK_SCENE);
      if (photo.kind === kind) return done(`这张本来就是${ASSET_KINDS[kind]}照片`);
      const displaced = isViewAngle(kind) ? angleUpload(ctx.assets, workId, kind) : undefined;
      const emptied = isViewAngle(photo.kind) ? photo.kind : null;
      if (displaced || emptied) {
        const ok = await deps.confirm(photoKindConfirm(photo.kind, kind, !!displaced));
        if (!ok) return refuse('用户取消了，照片类型没改');
      }
      await setPhotoKind(photo, kind);
      const notes = [displaced ? `原来的${ASSET_KINDS[kind]}照片退回「未分类」` : '', emptied ? `${VIEW_NAMES[emptied]}空出来了` : ''].filter(Boolean);
      return done(`这张${ASSET_KINDS[photo.kind]}照片改成「${ASSET_KINDS[kind]}」${notes.length ? `；${notes.join('；')}` : ''}`, [`照片改成「${ASSET_KINDS[kind]}」`]);
    }
    case 'propose_views': {
      const { angles } = rawInput as Input<'propose_views'>;
      const list = angles?.length ? [...new Set(angles)] : anglesToGenerate(ctx.assets, ctx.tasks, workId);
      const check = viewCheck(ctx.assets, ctx.tasks, workId, list, busy);
      if (!check.ok) return refuse(`不能生成三视图：${check.reason}`);
      return done(`「生成三视图」卡片已放出（${angleNames(list)}），用户点了才生成，每张要花一张图的钱；出来后请用户对照原图看`);
    }
    case 'record_story': {
      const { kind, text, noStory } = rawInput as Input<'record_story'>;
      let added = false;
      let flipped = false;
      await change(workId, (c) => {
        let w = addStoryNote(c.work, kind, text);
        added = w !== c.work;
        if (noStory !== undefined && w.story.noStory !== noStory) {
          w = setNoStory(w, noStory);
          flipped = true;
        }
        return w;
      });
      const mark = flipped ? (noStory ? '；勾上了「暂无明确故事」' : '；取消了「暂无明确故事」') : '';
      return done((added ? `已记下：${text}` : `这一条之前已经记下了，没有重复记录：${text}`) + mark);
    }
    case 'draft_summary': {
      // 共创总结在背景和合成两种快照里都有
      if (busy.scene) return refuse(LOCK_SCENE);
      if (busy.backdrop) return refuse(LOCK_BACKDROP);
      const sum = rawInput as Input<'draft_summary'>;
      let changed = false;
      let wasConfirmed = false;
      await change(workId, (c) => {
        wasConfirmed = c.work.story.summaryState === 'confirmed';
        const w = draftSummary(c.work, sum);
        changed = w !== c.work;
        return w;
      });
      if (!changed) return done(`总结和现在的一样，没有改动（仍是${wasConfirmed ? '确认过的' : '草稿'}）`);
      return done(
        `已起草共创总结${wasConfirmed ? '（原来确认过的总结回到草稿）' : ''}；确认后生效：用户在画布上点「确认总结」，或你用 ask_confirm 问过、他同意后代点`,
        ['共创总结（草稿）'],
      );
    }
    case 'set_style': {
      const { items } = rawInput as Input<'set_style'>;
      const touchesBackdrop = items.some((it) => isBackdropKey(it.field));
      const touchesScene = items.some((it) => !isBackdropKey(it.field));
      if (touchesScene && busy.scene) return refuse(LOCK_SCENE);
      if (touchesBackdrop && busy.backdrop) return refuse(LOCK_BACKDROP);
      if (touchesBackdrop && ctx.work.backdropId) return refuse(BACKDROP_PICKED);
      // 「你说的」要能在用户原话里找到小间附的片段，找不到就记为「小间推荐」（BC-013）
      const texts = deps.userTexts();
      const prompts = [ctx.work.prompt, ctx.work.backdropPrompt];
      const checked = items.map((it) => {
        const said = it.basis === 'said' && saidQuoteFound(it.quote, texts, prompts);
        return { ...it, said, downgraded: it.basis === 'said' && !said };
      });
      await change(workId, (c) =>
        checked.reduce((w, it) => setStyle(w, it.field, it.value, it.said ? 'said' : 'recommend', it.reason, it.said ? it.quote?.trim() : undefined), c.work),
      );
      const list = checked.map((it) => `${STYLE_LABELS[it.field]}「${it.value || '（清空）'}」${it.said ? '' : '（推荐，待确认）'}`);
      const down = checked.filter((it) => it.downgraded);
      const note = down.length
        ? `。其中${down.map((it) => `${STYLE_LABELS[it.field]}${it.quote?.trim() ? `（「${it.quote.trim()}」）` : '（没附原话）'}`).join('、')}在用户的原话里没找到，已记为「小间推荐」，是建议、不是用户说的`
        : '';
      return done(`风格卡已更新：${list.join('、')}${note}`, list);
    }
    case 'set_backdrop_mode': {
      const { mode } = rawInput as Input<'set_backdrop_mode'>;
      const name = BACKDROP_MODE_NAMES[mode];
      if (ctx.work.backdropMode === mode) return done(`背景做法本来就是「${name}」`);
      if (busy.scene) return refuse(LOCK_SCENE);
      if (busy.backdrop) return refuse(LOCK_BACKDROP);
      // 流程二改自己生成会切到流程一、改不回去：要先问用户（技术写法 14.3）
      if (ctx.work.flow === 'template' && mode === 'generate') {
        return refuse('套用模板的作品改成自己生成，会切到首页开始的流程、改不回去；先用 ask_confirm（switch_flow）问用户，他同意后代点');
      }
      const had = ctx.work.backdropId ? (ctx.backdrop?.name ?? '找不到的那张') : null;
      await chooseBackdropMode(workId, mode, 'agent');
      return done(`背景做法改成「${name}」${had ? `；原来选的背景图「${had}」清掉了，之后可以再选回来` : ''}`, [`背景做法「${name}」`]);
    }
    case 'use_backdrop': {
      // 能选什么见 agentPickProblem；选的过程（生成中锁定、做法跟着来源走、试用事件）和画布上点一张同一个函数
      const { backdropId } = rawInput as Input<'use_backdrop'>;
      const ref = await resolveBackdrop(backdropId);
      const problem = agentPickProblem(ref, backdropId, workId);
      if (problem) return refuse(problem);
      const b = ref!;
      if (ctx.work.backdropId === b.id) return done(`背景本来就是「${b.name}」`);
      const before = ctx.work.backdropMode;
      const r = await pickBackdrop(workId, b.id, 'agent');
      if (!r.ok) return refuse(r.reason);
      const w = (await loadContext(workId)).work;
      const from = b.builtin ? '内置模板，暂无参数' : '模板库里沉淀的';
      const mode = BACKDROP_MODE_NAMES[w.backdropMode!];
      const modeText = before === w.backdropMode ? `背景做法仍是「${mode}」` : `背景做法${before ? `从「${BACKDROP_MODE_NAMES[before]}」` : ''}换成了「${mode}」`;
      return done(`已选用背景图「${b.name}」（${from}）；${modeText}`, [`背景图「${b.name}」`]);
    }
    case 'redesign_backdrop': {
      // 和画布上的「重新设计背景」一样：自己生成背景、选定了背景图时才有；两种生成进行中都不能放开
      if (!ctx.work.backdropId) return refuse('还没选定背景图，不用重新设计');
      if (ctx.work.backdropMode !== 'generate') return refuse('用的是模板库里的背景：换一张模板用 use_backdrop；想自己生成用 set_backdrop_mode');
      if (busy.scene) return refuse(LOCK_SCENE);
      if (busy.backdrop) return refuse(LOCK_BACKDROP);
      const name = ctx.backdrop?.name;
      await change(workId, (c) => clearBackdrop(c.work));
      return done(`已放开选定的背景图${name ? `「${name}」` : ''}：背景五项又能改了，改好后重写背景提示词，请用户批准再生成一轮；原来那张还在，可以再选回来`, ['重新设计背景']);
    }
    case 'rename_backdrop': {
      const { backdropId, name: n } = rawInput as Input<'rename_backdrop'>;
      const ref = await resolveBackdrop(backdropId);
      if (!ref) return refuse(`没有编号为 ${backdropId} 的背景图`);
      if (ref.builtin) return refuse('内置模板不能改名');
      if (ref.deleted) return refuse('这张背景图已经从模板库删除了');
      if (!ref.saved) return refuse('这张背景图还没沉淀进模板库；沉淀时起名，用 ask_confirm（save_backdrop）问用户');
      if (ref.name === n.trim()) return done(`本来就叫「${ref.name}」`);
      const r = await renameBackdrop(backdropId, n);
      return r.ok ? done(`模板库里的「${ref.name}」改名为「${n.trim()}」`, [`背景图名「${n.trim()}」`]) : refuse(r.reason);
    }
    case 'draft_backdrop_prompt': {
      const { prompt } = rawInput as Input<'draft_backdrop_prompt'>;
      if (busy.backdrop) return refuse(LOCK_BACKDROP);
      const wait = backdropPromptWriteBlocker(ctx.work);
      if (wait) return refuse(wait.step === 'info' ? infoWait(PROMPT_NAMES.backdrop, wait) : `没写${PROMPT_NAMES.backdrop}：${wait.text}`);
      await mutateWork(workId, (c) => writePrompt(c.work, 'backdrop', prompt, c.backdropBasis));
      const left = backdropApprovalBlockers(await loadContext(workId)).filter((b) => !b.text.startsWith(PROMPT_NAMES.backdrop));
      return done(left.length ? `已写好背景提示词。批准前还缺：${listText(left)}` : '已写好背景提示词，可以请用户批准了', [PROMPT_NAMES.backdrop]);
    }
    case 'set_ratio': {
      const { ratio } = rawInput as Input<'set_ratio'>;
      if (busy.scene) return refuse(LOCK_SCENE);
      if (ratio === ctx.work.ratio) return done(`合成比例本来就是 ${ratio}`);
      await change(workId, (c) => setRatio(c.work, ratio));
      return done(`合成比例改为 ${ratio}`, [`比例 ${ratio}`]);
    }
    case 'draft_prompt': {
      const { prompt } = rawInput as Input<'draft_prompt'>;
      if (busy.scene) return refuse(LOCK_SCENE);
      const wait = scenePromptWriteBlocker(ctx);
      if (wait) return refuse(wait.step === 'info' ? infoWait(PROMPT_NAMES.scene, wait) : `没写${PROMPT_NAMES.scene}：${wait.text}`);
      await mutateWork(workId, (c) => writePrompt(c.work, 'scene', prompt, c.basis));
      const left = sceneApprovalBlockers(await loadContext(workId)).filter((b) => !b.text.startsWith(PROMPT_NAMES.scene));
      return done(left.length ? `已写好合成提示词。批准前还缺：${listText(left)}` : '已写好合成提示词，可以请用户批准了', [PROMPT_NAMES.scene]);
    }
    case 'resolve_prompt_sync': {
      const { which, conflicts } = rawInput as Input<'resolve_prompt_sync'>;
      if (which === 'scene' && busy.scene) return refuse(LOCK_SCENE);
      if (which === 'backdrop' && busy.backdrop) return refuse(LOCK_BACKDROP);
      const p = promptOf(ctx.work, which);
      if (!p?.edited || p.sync === 'ok') return refuse(`${PROMPT_NAMES[which]}没有待核对的手改`);
      await change(workId, (c) =>
        which === 'backdrop' ? resolvePromptSync(c.work, 'backdrop', conflicts, c.backdropBasis) : resolvePromptSync(c.work, 'scene', conflicts, c.basis),
      );
      return done(conflicts.length ? `已标出 ${conflicts.length} 处矛盾，需要用户决定` : `核对完成，${PROMPT_NAMES[which]}和方案一致`);
    }
    case 'request_approval': {
      const { kind } = rawInput as Input<'request_approval'>;
      const reminders = approvalReminders(ctx.work);
      const remind = reminders.length ? `。卡片上同时提醒（不挡批准）：${listText(reminders)}` : '';
      if (kind === 'backdrop') {
        if (ctx.work.backdropMode !== 'generate') return refuse('背景用的是模板库里的，不需要背景批准');
        // 小间回复的同时，用户可能已经在画布上批准并开始生成了（BC-009）
        const a = ctx.backdropApproval;
        const phase = approvedPhase(a, backdropApprovalStatus(ctx), busy.backdrop);
        if (phase === 'generating') return done(`用户已经批准了背景方案（第 ${a!.version} 版），第 ${a!.usedRound} 轮背景正在生成，不需要再批准；出来后请用户选一张`);
        if (phase === 'used') return done(`背景方案已经批准过（第 ${a!.version} 版）并生成了第 ${a!.usedRound} 轮；要再生成一轮，需要用户在「背景」里再滑一次「批准并生成」`);
        // 批准了却没发起（发起时被挡住了）：批准和生成是同一下，用户再滑一次就是新的一版批准（技术写法 14.6）
        if (phase === 'unused') return done(`背景方案第 ${a!.version} 版批准了、还没生成；请用户在卡片或「背景」里再滑一次「批准并生成」（会记成新的一版批准）`);
        const bs = backdropApprovalBlockers(ctx);
        return done((bs.length ? `背景批准卡片已放出，但还缺：${listText(bs)}` : '背景批准卡片已放出，等用户滑动「批准并生成」') + remind);
      }
      const a = ctx.approval;
      const phase = approvedPhase(a, sceneApprovalStatus(ctx), busy.scene);
      if (phase === 'generating') return done(`用户已经批准了当前方案（第 ${a!.version} 版），第 ${a!.usedRound} 轮正在生成，不需要再批准；等结果出来请用户验收`);
      if (phase === 'used') return done(`当前方案已经批准过（第 ${a!.version} 版）并生成了第 ${a!.usedRound} 轮；要按同一方案再生成一轮，需要用户在「摆放」里再滑一次「批准并生成」`);
      if (phase === 'unused') return done(`当前方案第 ${a!.version} 版批准了、还没生成；请用户在卡片或「摆放」里再滑一次「批准并生成」（会记成新的一版批准）`);
      const bs = sceneApprovalBlockers(ctx);
      return done((bs.length ? `批准卡片已放出，但还缺：${listText(bs)}` : '批准卡片已放出，等用户滑动「批准并生成」') + remind);
    }
    case 'propose_retry': {
      const { kind, round, candidate } = rawInput as Input<'propose_retry'>;
      const what = `第 ${round} 轮${kind === 'backdrop' ? '背景' : '候选'} ${candidate}`;
      const problem = await retryProblem(workId, kind, round, candidate - 1);
      return problem ? refuse(`不能补齐${what}：${problem}`) : done(`「补齐这一张」卡片已放出（${what}），用户点了才补，要花一张图的钱`);
    }
    case 'offer_picks': {
      const { options } = rawInput as Input<'offer_picks'>;
      return done(`已放出 ${options.length} 个方向卡片，等用户挑选`);
    }
    case 'set_image_model': {
      const { model } = rawInput as Input<'set_image_model'>;
      if (ctx.anyGenerating) return refuse('正在生成，等这一批结束后再换生图模型');
      const m = imageModel(model);
      if (!m) return refuse(`没有配置这个生图模型：${model}`);
      if (model === ctx.work.imageModel) return done(`生图模型本来就是 ${m.label}`);
      await change(workId, (c) => setImageModel(c.work, model));
      return done(`生图模型换成 ${m.label}；已确认的三视图和选定的背景图照常可用，方案需要重新批准`, [`生图模型 ${m.label}`]);
    }
    case 'note_feedback': {
      const { round, candidate, issues, note, revise } = rawInput as Input<'note_feedback'>;
      const res = findResult(ctx, round, candidate);
      if (!res) return refuse(`没有第 ${round} 轮候选 ${candidate} 的结果`);
      if (revise && busy.scene) return refuse('正在生成这一轮，等结束后再从这张修改');
      const approval = revise ? await getSceneApproval(res.approvalId) : undefined;
      if (revise && !approval) return refuse('找不到这张结果当时的方案，不能从它修改');
      await patchResult(res.id, (r) => {
        r.issues = [...new Set([...r.issues, ...issues])];
        if (note?.trim()) r.note = r.note ? `${r.note}；${note.trim()}` : note.trim();
      });
      if (revise && approval) {
        const fresh = { ...res, issues: [...new Set([...res.issues, ...issues])] };
        await change(workId, (c) => reviseFrom(c.work, fresh, approval, c.backdrops));
        void logEvent('revise', workId, { round, slot: candidate - 1, by: 'agent' });
      }
      const what = [issues.length ? `问题：${issues.join('、')}` : '', note?.trim() ? `说明：${note.trim()}` : ''].filter(Boolean).join('；');
      return done(
        `已记在第 ${round} 轮候选 ${candidate} 上${what ? `（${what}）` : ''}${revise ? '；方案已恢复成那一版，改好后请用户重新批准' : ''}。两项验收要用户判断：他在画布上点，或你问过、他同意后代点`,
      );
    }
    case 'offer_export': {
      const { round, candidate } = rawInput as Input<'offer_export'>;
      const res = findResult(ctx, round, candidate);
      if (!res) return refuse(`没有第 ${round} 轮候选 ${candidate} 的结果`);
      if (!passed(res)) return refuse('这张还没有两项都验收满意，不能导出；先请用户验收（他在画布上点，或你问过、他同意后代点）');
      return done('下载卡片已放出，由用户点击下载；卡片上提醒了发布时按平台要求声明是 AI 生成的图');
    }
    case 'note_followup': {
      const { text } = rawInput as Input<'note_followup'>;
      await change(workId, (c) => addFollowup(c.work, text));
      return done(`已记下这个需求：${text}（本期先不做）`);
    }
    case 'ask_confirm': {
      const { items } = rawInput as Input<'ask_confirm'>;
      const actions: AskAction[] = [];
      const bad: string[] = [];
      items.forEach((it, i) => {
        const a = toAction(it);
        if (typeof a === 'string') bad.push(`第 ${i + 1} 样：${a}`);
        else actions.push(a);
      });
      if (bad.length) return refuse(`没放卡片：${bad.join('；')}`);
      if (!callId) return refuse('没放卡片：缺这次调用的编号');
      const r = await openAskFor(workId, callId, actions);
      if (!r.ok) return refuse(`没放卡片，这几样现在点不了：${r.reasons.join('；')}`);
      return done(
        `「要我替你点吗」卡片已放出，等用户回复：${r.items.map((it, n) => `${n + 1}. ${it.text}`).join('；')}。用户回复同意后，用 confirm_for_user 照抄他的原话代点；只同意一部分时 only 填序号；他没同意之前不要代点`,
      );
    }
    case 'confirm_for_user': {
      const { quote, only } = rawInput as Input<'confirm_for_user'>;
      const r = await proxyConfirm(workId, quote, only, deps.userTextsAfter);
      if (!r.ok) return refuse(r.reason);
      const list = r.done.map((it) => it.text);
      const failed = r.failed.length ? `；没点成：${r.failed.map((f) => `${f.item.text}（${f.reason}）`).join('；')}` : '';
      return done(`替用户点了：${list.join('；')}（用户说「${quote.trim()}」）${failed}`, list);
    }
    case 'next_step': {
      const { step } = rawInput as Input<'next_step'>;
      const next = nextStepOf(ctx.work.flow, step);
      if (!next) return refuse('出图是最后一步，没有下一步');
      // 和画布上的「下一步」同一个条件（技术写法 14.7）
      const reason = handoffBlocker(ctx, step);
      if (reason) return refuse(`「${STEP_NAMES[step]}」还没做完：${reason}`);
      await mutateWork(workId, (c) => advanceStep(c.work, step, factsOf(c)));
      deps.showStep(next);
      return done(`已推进到「${STEP_NAMES[next]}」，画布切过去了。「${STEP_NAMES[step]}」这一页现在的内容：\n${pageText(ctx, step)}`, [`推进到「${STEP_NAMES[next]}」`]);
    }
    case 'show_step': {
      const { step } = rawInput as Input<'show_step'>;
      if (!isStepId(step)) return refuse(`没有这一步：${String(step)}`);
      deps.showStep(step);
      return done('画布已切换');
    }
    case 'request_delete': {
      const { target, id } = rawInput as Input<'request_delete'>;
      if (target === 'photo') {
        const photo = activeUploads(ctx.assets, workId).find((a) => a.id === id);
        if (!photo) return refuse(`没有编号为 ${id ?? '（没填）'} 的照片（停用过的不算）`);
        if (busy.views) return refuse(LOCK_PHOTOS);
        if (busy.scene) return refuse(LOCK_SCENE);
        const what = `${ASSET_KINDS[photo.kind]}照片`;
        const ok = await deps.confirm({ title: `小间想停用这张${what}？`, body: '原图记录会保留；用它生成的三视图和之后的方案需要重新确认。', ok: '不再使用' });
        if (!ok) return refuse(`用户取消了，这张${what}照常在用`);
        await removeAsset(photo);
        return done(`用户确认了，这张${what}不再使用（原图记录保留）`, [`停用${what}`]);
      }
      if (target === 'backdrop') {
        const ref = id ? await resolveBackdrop(id) : null;
        if (!ref) return refuse(`没有编号为 ${id ?? '（没填）'} 的背景图`);
        if (ref.builtin) return refuse('内置模板不能删除');
        if (ref.deleted) return done(`「${ref.name}」已经从模板库删除了`);
        if (!ref.saved) return refuse('这张背景图没沉淀进模板库，不用删除');
        const ok = await deps.confirm({
          title: `小间想从模板库删除「${ref.name}」？`,
          body: '删除后不能再被新作品选用；已经用了它的作品照常可以合成，历史结果里仍能看到。',
          ok: '删除',
          danger: true,
        });
        if (!ok) return refuse(`用户取消了，「${ref.name}」还在模板库里`);
        await deleteFromLibrary(ref.id);
        return done(`用户确认了，「${ref.name}」已从模板库删除；已经选了它的作品照常可用`, [`删除背景图「${ref.name}」`]);
      }
      // 删除这件作品：生成中不能删（和顶栏的删除按钮一样）；删掉后回作品页，对话跟着删掉
      if (ctx.anyGenerating) return refuse('正在生成，等结束后再删');
      const ok = await deps.confirm({ title: `小间想删除「${ctx.work.name}」？`, body: '照片、对话、方案和生成结果会一起删除，不能恢复。', ok: '删除', danger: true });
      if (!ok) return refuse('用户取消了，作品没删');
      await removeWork(ctx.work);
      deps.leave();
      return done('作品已删除');
    }
    default:
      return refuse(`没有这个工具：${String(name)}`);
  }
}
