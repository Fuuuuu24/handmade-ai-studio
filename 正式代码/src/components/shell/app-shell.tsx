'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { resumeActiveTasks } from '@/client/generation';
import { exportTrialRecord } from '@/client/trial';
import { clearedPending, dbNotice, dismissCleared, subscribeDbNotice, type DbNotice } from '@/data/db';
import { ConfirmProvider, Modal } from '@/components/ui/dialog';
import { Icon, type IconName } from '@/components/ui/icon';
import { WarmTooltipGroup } from '@/components/bits/WarmTooltip/WarmTooltip';
import { ToastProvider } from '@/components/ui/toast';

const NAV: { href: string; icon: IconName; name: string; match: (p: string) => boolean }[] = [
  { href: '/', icon: 'home', name: '首页', match: (p) => p === '/' },
  { href: '/works', icon: 'works', name: '作品', match: (p) => p.startsWith('/works') },
  { href: '/templates', icon: 'image', name: '模板库', match: (p) => p.startsWith('/templates') },
  { href: '/history', icon: 'history', name: '历史结果', match: (p) => p.startsWith('/history') },
];

const item =
  'flex h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-sm px-[9px] text-left text-ink-2 transition-colors hover:bg-black/[0.04] hover:text-ink';
const label = 'text-body opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100 group-hover/rail:delay-200 group-has-[:focus-visible]/rail:opacity-100';

function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="主导航" className="flex flex-col gap-0.5">
      {NAV.map((n) => {
        const on = pathname != null && n.match(pathname);
        return (
          <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} className={`${item} ${on ? 'bg-black/[0.07] text-ink' : ''}`}>
            <Icon name={n.icon} />
            <span className={label}>{n.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// 读当前路径的部分单独成组件：动态路由（/works/[id]）上 usePathname 会挂起，挂起时先显示不带高亮的导航
function CurrentNav() {
  return <NavLinks pathname={usePathname()} />;
}

const NOTICE_TEXT: Record<DbNotice, string> = {
  blocked: '「一间」升级了，但别的标签页还开着旧版：请关掉其他「一间」页面后刷新这里',
  outdated: '「一间」在别的页面更新了，这个页面的内容不能再保存：请刷新这个页面',
  cleared: '产品已更新，旧的测试作品已清除',
};

// 数据库提示（技术写法 13.6）：升级被别的页面挡住、这个页面过时了、升级清空了旧数据（只提示一次）
function DbNoticeBar() {
  const live = useSyncExternalStore(subscribeDbNotice, dbNotice, () => null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    // 上次打开时升级过、还没看到提示：读 localStorage 要等挂载后
    const t = setTimeout(() => setPending(clearedPending()), 0);
    return () => clearTimeout(t);
  }, []);
  const notice = live ?? (pending ? 'cleared' : null);
  if (!notice) return null;
  const info = notice === 'cleared';
  return (
    <div role={info ? 'status' : 'alert'} className={`flex items-center gap-3 px-5 py-2 text-aux ${info ? 'bg-accent-soft text-ink-2' : 'bg-bad-bg text-bad'}`}>
      <span className="min-w-0 flex-1">{NOTICE_TEXT[notice]}</span>
      {info ? (
        <button
          type="button"
          className="mini-btn"
          onClick={() => {
            dismissCleared();
            setPending(false);
          }}
        >
          知道了
        </button>
      ) : (
        <button type="button" className="mini-btn" onClick={() => location.reload()}>
          刷新
        </button>
      )}
    </div>
  );
}

// 图标栏（沿用 v2／v3）：收起 60px 只显示图标，悬停或键盘聚焦时展开到 196px、盖在内容上（宽度见 globals.css 的 --spacing-rail*）。
// 作品、模板库、历史结果的内容区左边留够了展开后的宽度，不会被盖住（page-frame.tsx）；工作区左边是对话，展开时会盖住一点
export function AppShell({ children }: { children: ReactNode }) {
  const [help, setHelp] = useState(false);
  const [resumeProblem, setResumeProblem] = useState<string | null>(null);
  // 打开任何页面都接着查询没结束的生成任务（网关结果只保留 1 小时），不只在工作区里（PRD 7.3）
  useEffect(() => {
    resumeActiveTasks().catch((e: unknown) => setResumeProblem(`没能接着查询上次的生成任务：${e instanceof Error ? e.message : String(e)}`));
  }, []);
  return (
    <ConfirmProvider>
      <ToastProvider>
        {/* 悬停提示成组：移到相邻图标时提示直接滑过去，不用再等（React Bits Warm Tooltip） */}
        <WarmTooltipGroup>
          <div className="h-full">
            <aside
              aria-label="侧边栏"
              className="group/rail fixed inset-y-0 left-0 z-30 flex w-rail flex-col gap-0.5 overflow-hidden bg-rail p-3 shadow-[inset_-1px_0_0_var(--color-line)] transition-[width,box-shadow] duration-200 ease-soft hover:w-rail-open hover:shadow-[inset_-1px_0_0_var(--color-line),var(--shadow-pop)] hover:delay-100 has-[:focus-visible]:w-rail-open"
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
              <Suspense fallback={<NavLinks pathname={null} />}>
                <CurrentNav />
              </Suspense>
              <button type="button" className={`${item} mt-auto`} onClick={() => setHelp(true)}>
                <Icon name="help" />
                <span className={label}>使用说明</span>
              </button>
            </aside>
            <main className="ml-rail flex h-full min-w-0 flex-col">
              <DbNoticeBar />
              {resumeProblem && (
                <p role="alert" className="bg-bad-bg px-5 py-2 text-aux text-bad">
                  {resumeProblem}（刷新页面再试）
                </p>
              )}
              {children}
            </main>
          </div>
          <Modal open={help} onClose={() => setHelp(false)} title="使用说明" sub="一间 · 手作影像工作台">
            <ul className="flex list-disc flex-col gap-1.5 pl-4 text-body leading-relaxed text-ink-2">
              <li>
                <strong className="text-ink">和小间说话就能往下走。</strong>上传作品的正面、侧面、背面照片，说说它是什么、想要什么感觉；小间会整理商品信息、陪你聊背景、写提示词。右边画布显示同一份内容，可以直接改。
              </li>
              <li>
                <strong className="text-ink">先有背景，再放进饰品。</strong>三张照片各生成一张白底三视图，逐张对照确认；背景用模板库里的，或者自己生成两张选一张；最后用背景图和三视图合成两张主图。满意的背景可以沉淀进模板库，下一件作品直接套用。
              </li>
              <li>
                <strong className="text-ink">要你拍板的事，小间会先问你。</strong>商品信息、共创总结、三视图、选哪张背景和验收，都要你确认：自己在画布上点，或者在对话里回「同意」让小间替你点。三视图、背景图、主图只能你自己点按钮或滑动批准才生成；删除也要你在确认框里点。
              </li>
              <li>
                <strong className="text-ink">每张图分别看两件事：</strong>像不像实物、风格对不对，两项都满意才算完成，才能导出。
              </li>
              <li>
                <strong className="text-ink">数据只存在这台电脑的这个浏览器里。</strong>换电脑或换浏览器看不到；清除浏览器数据会丢失作品。照片和对话会发给模型服务（经 AIHubMix）用于生成。
              </li>
            </ul>
            <TrialExport />
            <div className="mt-5 flex justify-end">
              <button type="button" className="btn btn-primary" onClick={() => setHelp(false)} data-autofocus>
                知道了
              </button>
            </div>
          </Modal>
        </WarmTooltipGroup>
      </ToastProvider>
    </ConfirmProvider>
  );
}

// 试用记录（PRD 6.2）：商家点一下下载 CSV，发给发起人；只含匿名编号和统计，不含作品名、照片和聊天原文
function TrialExport() {
  const [state, setState] = useState<string | null>(null);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-aux text-muted">
      <span>试用中：</span>
      <button
        type="button"
        className="text-ink-2 underline decoration-line-hover underline-offset-2 hover:text-ink"
        onClick={async () => {
          try {
            const r = await exportTrialRecord();
            setState(`已导出 ${r.works} 件作品的记录${r.missedEvents ? `；本次打开后有 ${r.missedEvents} 条事件没记上` : ''}，请把文件发给发起人`);
          } catch (e) {
            setState(`没有导出：${e instanceof Error ? e.message : String(e)}`);
          }
        }}
      >
        导出试用记录
      </button>
      <span>（只有统计和匿名编号，不含照片和聊天内容）</span>
      {state && <p className="w-full text-ink-2" role="status">{state}</p>}
    </div>
  );
}
