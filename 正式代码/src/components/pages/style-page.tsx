'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { use } from 'react';
import { browser } from 'react-dom';
import { STYLE_KEYS, STYLE_LABELS } from '@/config/style';
import { getShopStyle } from '@/data/repo';
import { fmtTime } from '@/components/ui/format';
import { EmptyState, PageFrame, PageLoading } from './page-frame';

// 我的风格（PRD FR-06、AC-06.4）：店铺长期偏好；只有用户明确同意才写入，每次变更留记录
export function StylePage() {
  use(browser('我的风格存在浏览器的本地数据库里'));
  const shop = useLiveQuery(() => getShopStyle(), []);
  if (!shop) return <PageLoading />;
  const keys = STYLE_KEYS.filter((k) => shop.prefs[k]?.trim());

  return (
    <PageFrame title="我的风格" intro="店铺长期的视觉偏好，新作品可以直接套用；单件作品里的调整不会改到这里。">
      {keys.length === 0 ? (
        <EmptyState title="还没有长期风格">在作品的方案里点「更新为我的风格」并确认后，会保存在这里。</EmptyState>
      ) : (
        <div className="flex max-w-[640px] flex-col gap-8">
          <dl className="rounded-lg bg-white px-5 py-2 shadow-[0_0_0_1px_var(--color-line)]">
            {keys.map((k) => (
              <div key={k} className="grid grid-cols-[72px_1fr] gap-3 border-b border-line py-2 text-body last:border-b-0">
                <dt className="text-aux leading-[1.9] text-muted">{STYLE_LABELS[k]}</dt>
                <dd>{shop.prefs[k]}</dd>
              </div>
            ))}
          </dl>
          <section className="flex flex-col gap-2">
            <h2 className="text-block font-semibold">修改记录</h2>
            {shop.history.length ? (
              <ul className="flex flex-col gap-1 text-aux text-ink-2">
                {[...shop.history].reverse().map((h) => {
                  const changed = STYLE_KEYS.filter((k) => (h.before[k] ?? '') !== (h.after[k] ?? '')).map((k) => STYLE_LABELS[k]);
                  return (
                    <li key={h.at}>
                      <span className="tabular-nums text-muted">{fmtTime(h.at)}</span> · 改了：{changed.join('、') || '无'}
                      {h.reason ? ` · ${h.reason}` : ''}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-aux text-muted">暂无修改记录。</p>
            )}
          </section>
        </div>
      )}
    </PageFrame>
  );
}
