import { SAID_QUOTE_MIN } from '@/config/style';
import type { PromptState } from './types';

/* 风格卡上的「你说的」要有用户原话为证（BC-013；2026-11-06 用户选定由代码核对）。
   小间标 said 时附上原话片段，这里逐字核对：去掉空格和标点后，片段要出现在用户发过的消息里，
   或者出现在用户手改提示词时新写的内容里（小间自己写过的不算）；背景提示词和合成提示词都算（技术写法 13.12）。
   只核对片段在不在，不判断片段和这一项是否相关；相关不相关由卡片上显示的原话交给用户看。
   系统代发的交接和通知消息不算用户原话，由对话面板在传进来之前排除。 */

const plain = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();

const inEdit = (q: string, p: PromptState<unknown> | null | undefined) =>
  !!p?.edited && plain(p.text).includes(q) && !plain(p.original?.text ?? '').includes(q);

export function saidQuoteFound(
  quote: string | undefined,
  userTexts: readonly string[],
  prompts: readonly (PromptState<unknown> | null | undefined)[] = [],
): boolean {
  const q = plain(quote ?? '');
  if (q.length < SAID_QUOTE_MIN) return false;
  if (userTexts.some((t) => plain(t).includes(q))) return true;
  return prompts.some((p) => inEdit(q, p));
}
