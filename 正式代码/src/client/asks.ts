import { confirmView, getAsset, getResult, logEvent } from '@/data/repo';
import { changedItems, checkActions, consentFound, waitingAsk } from '@/domain/asks';
import type { AskAction, AskItem, Id } from '@/domain/types';
import { acceptSuggestion, closeAsk, confirmSummary, markUnknown, openAsk } from '@/domain/work';
import { chooseBackdropMode, pickBackdrop, saveToLibrary } from './backdrops';
import { setVerdict } from './results';
import { loadContext, mutateWork } from './work-store';

/* 小间问过再代点（PRD 4.2 第 2 条，技术写法 14.4）的浏览器一侧：记下请求、核对后代点。
   规则（能不能点、问时的样子、原话核对）在 domain/asks.ts；代点每一样都调用画布按钮用的同一个函数。 */

export type AskOutcome = { ok: true; items: AskItem[] } | { ok: false; reasons: string[] };

// 小间问「要我替你点吗」（ask_confirm）：每样都能点才记下请求，之前在等回复的那条作废
export async function openAskFor(workId: Id, id: Id, actions: readonly AskAction[]): Promise<AskOutcome> {
  let out: AskOutcome = { ok: false, reasons: [] };
  await mutateWork(workId, (c) => {
    out = checkActions(c, actions);
    return out.ok ? openAsk(c.work, id, out.items) : c.work;
  });
  return out;
}

// 代点一样：和画布上的按钮调用同一个函数；做不成时返回原因
async function perform(workId: Id, item: AskItem): Promise<string | null> {
  const a = item.action;
  switch (a.type) {
    case 'confirm_view': {
      const v = item.target ? await getAsset(item.target) : undefined;
      if (!v) return '找不到这张三视图';
      await confirmView(v);
      return null;
    }
    case 'accept_info':
      await mutateWork(workId, (c) => acceptSuggestion(c.work, a.field));
      return null;
    case 'mark_unknown':
      await mutateWork(workId, (c) => markUnknown(c.work, a.field, true));
      return null;
    case 'confirm_summary':
      await mutateWork(workId, (c) => confirmSummary(c.work));
      return null;
    case 'pick_backdrop': {
      const r = await pickBackdrop(workId, item.target!, 'agent');
      return r.ok ? null : r.reason;
    }
    case 'save_backdrop': {
      // 和画布一样，只有选定的那张能沉淀；同一条请求里先选定的，到这里已经选上了
      if ((await loadContext(workId)).work.backdropId !== item.target) return '要先选定这张背景图才能沉淀';
      const r = await saveToLibrary(item.target!, a.name, 'agent');
      return r.ok ? null : r.reason;
    }
    case 'verdict': {
      const r = item.target ? await getResult(item.target) : undefined;
      if (!r) return '找不到这张候选';
      await setVerdict(r, { real: a.real, style: a.style }, 'agent');
      return null;
    }
    case 'switch_flow':
      await chooseBackdropMode(workId, 'generate', 'agent');
      return null;
  }
}

export type ProxyOutcome = { ok: true; done: AskItem[]; failed: { item: AskItem; reason: string }[] } | { ok: false; reason: string };

/* 小间代点（confirm_for_user）。三条都对上才执行（技术写法 14.4）：
   1. 有一条请求在等回复；
   2. 请求之后用户发过消息（浏览器代发的交接和通知不算，textsAfter 已排除），原话能在里面逐字找到；
   3. 要点的每样东西和问的时候一样；变了整条请求作废，请小间重新问。
   only 是用户只同意的那几样（卡片上的序号，从 1 开始），不填就是全部。 */
export async function proxyConfirm(workId: Id, quote: string, only: readonly number[] | undefined, textsAfter: (askId: Id) => readonly string[]): Promise<ProxyOutcome> {
  const no = (reason: string): ProxyOutcome => ({ ok: false, reason });
  const ctx = await loadContext(workId);
  const ask = waitingAsk(ctx.work);
  if (!ask) return no('没有在等用户回复的请求；要替用户点，先用 ask_confirm 问');
  const after = textsAfter(ask.id);
  if (!after.length) return no('问过之后用户还没回复，等他回复了再说');
  if (!consentFound(quote, after)) return no(`问过之后用户发的消息里找不到「${quote.trim()}」，没有代点；请逐字照抄用户表示同意的那句话`);

  const picked = only?.length ? [...new Set(only)].sort((a, b) => a - b) : ask.items.map((_, i) => i + 1);
  const outside = picked.filter((n) => !Number.isInteger(n) || n < 1 || n > ask.items.length);
  if (outside.length) return no(`卡片上没有第 ${outside.join('、')} 样（一共 ${ask.items.length} 样）`);
  const items = picked.map((n) => ask.items[n - 1]);

  const changed = changedItems(ctx, items);
  if (changed.length) {
    const reason = `问过之后这些变了：${changed.map((it) => it.text).join('；')}`;
    await mutateWork(workId, (c) => closeAsk(c.work, ask.id, { state: 'expired', reason }));
    return no(`${reason}。这条请求作废了，没有代点；请按现在的情况重新问`);
  }
  // 东西没变，但可能正在生成、暂时锁定：先不代点，请求留着
  const check = checkActions(ctx, items.map((it) => it.action));
  if (!check.ok) return no(`现在点不了：${check.reasons.join('；')}`);

  const done: number[] = [];
  const failed: { item: AskItem; reason: string }[] = [];
  for (const [k, item] of items.entries()) {
    const reason = await perform(workId, item);
    if (reason) {
      failed.push({ item, reason });
    } else {
      done.push(picked[k] - 1);
      void logEvent('proxy', workId, { action: item.action.type, by: 'agent' });
    }
  }
  if (!done.length) return no(`一样都没点成：${failed.map((f) => `${f.item.text}（${f.reason}）`).join('；')}`);
  await mutateWork(workId, (c) => closeAsk(c.work, ask.id, { state: 'done', quote: quote.trim(), done }));
  return { ok: true, done: done.map((i) => ask.items[i]), failed };
}
