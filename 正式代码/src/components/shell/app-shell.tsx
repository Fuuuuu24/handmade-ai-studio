'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ConfirmProvider, Modal } from '@/components/ui/dialog';
import { Icon, type IconName } from '@/components/ui/icon';

const NAV: { href: string; icon: IconName; name: string; match: (p: string) => boolean }[] = [
  { href: '/', icon: 'home', name: '首页', match: (p) => p === '/' },
  { href: '/works', icon: 'works', name: '作品', match: (p) => p.startsWith('/works') },
  { href: '/style', icon: 'style', name: '我的风格', match: (p) => p.startsWith('/style') },
  { href: '/scenes', icon: 'image', name: '摄影布景', match: (p) => p.startsWith('/scenes') },
  { href: '/history', icon: 'history', name: '历史结果', match: (p) => p.startsWith('/history') },
];

const item =
  'flex h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-sm px-[9px] text-left text-ink-2 transition-colors hover:bg-black/[0.04] hover:text-ink';
const label = 'text-body opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 group-hover/rail:delay-200 group-has-[:focus-visible]/rail:opacity-100';

// 图标栏（沿用 v2／v3）：收起 60px 只显示图标，悬停或键盘聚焦时展开到 196px、盖在内容上
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [help, setHelp] = useState(false);
  return (
    <ConfirmProvider>
      <div className="h-full">
        <aside
          aria-label="侧边栏"
          className="group/rail fixed inset-y-0 left-0 z-30 flex w-[60px] flex-col gap-0.5 overflow-hidden bg-rail p-3 shadow-[inset_-1px_0_0_var(--color-line)] transition-[width,box-shadow] duration-200 ease-soft hover:w-[196px] hover:shadow-[inset_-1px_0_0_var(--color-line),var(--shadow-pop)] hover:delay-100 has-[:focus-visible]:w-[196px]"
        >
          <Link href="/" aria-label="一间，回到首页" className="mb-3 flex h-9 items-center gap-2.5 whitespace-nowrap rounded-sm px-1">
            <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-sm bg-black text-body font-semibold text-white">
              间
            </span>
            <span aria-hidden="true" className={`${label} text-block font-semibold tracking-[0.04em] text-ink`}>
              一间
            </span>
          </Link>
          <Link href="/" className={`${item} mb-3 bg-white text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong),var(--shadow-sm)] hover:bg-white`}>
            <Icon name="plus" />
            <span className={label}>新建作品</span>
          </Link>
          <nav aria-label="主导航" className="flex flex-col gap-0.5">
            {NAV.map((n) => {
              const on = n.match(pathname);
              return (
                <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} className={`${item} ${on ? 'bg-black/[0.07] text-ink' : ''}`}>
                  <Icon name={n.icon} />
                  <span className={label}>{n.name}</span>
                </Link>
              );
            })}
          </nav>
          <button type="button" className={`${item} mt-auto`} onClick={() => setHelp(true)}>
            <Icon name="help" />
            <span className={label}>使用说明</span>
          </button>
        </aside>
        <div className="ml-[60px] flex h-full min-w-0 flex-col">{children}</div>
      </div>
      <Modal open={help} onClose={() => setHelp(false)} title="使用说明" sub="一间 · 手作影像工作台">
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-body leading-relaxed text-ink-2">
          <li>
            <strong className="text-ink">和小间说话就能往下走。</strong>上传作品照片，说说它是什么、想要什么感觉；小间会整理商品信息、陪你聊作品故事、配风格、写提示词。右边画布显示同一份内容，可以直接改。
          </li>
          <li>
            <strong className="text-ink">小间写的都是建议。</strong>商品信息、共创总结要你接受或确认才生效；生成之前一定要你点「批准并生成两张」，小间不能代你批准。
          </li>
          <li>
            <strong className="text-ink">每张图分别看两件事：</strong>像不像实物、风格对不对，两项都满意才算完成，才能导出。
          </li>
          <li>
            <strong className="text-ink">数据只存在这台电脑的这个浏览器里。</strong>换电脑或换浏览器看不到；清除浏览器数据会丢失作品。照片和对话会发给模型服务（经 AIHubMix）用于生成。
          </li>
        </ul>
        <div className="mt-5 flex justify-end">
          <button type="button" className="btn btn-primary" onClick={() => setHelp(false)} autoFocus>
            知道了
          </button>
        </div>
      </Modal>
    </ConfirmProvider>
  );
}
