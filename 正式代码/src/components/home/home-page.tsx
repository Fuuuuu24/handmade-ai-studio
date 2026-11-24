'use client';

import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { use, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { browser } from 'react-dom';
import { UPLOAD } from '@/config/upload';
import { createWork } from '@/client/create-work';
import { setFirstMessage } from '@/client/first-message';
import { checkFile } from '@/client/images';
import { addPhotos } from '@/client/uploads';
import { deleteWork, listSavedBackdrops } from '@/data/repo';
import { libraryList } from '@/domain/backdrops';
import { BackdropThumb } from '@/components/ui/backdrop-thumb';
import { Icon } from '@/components/ui/icon';

// 首页：输入框居中（上传照片、说一句话即开始，流程一），下面是模板库的背景图，点「套用」直接开始（流程二，PRD 5.1、5.2）
export function HomePage() {
  use(browser('作品数据存在浏览器的本地数据库里'));
  const router = useRouter();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);
  // 预览地址在选图时生成；换图、移除或离开首页时释放（挂载时还没有预览，开发模式的重复挂载不受影响）
  const showPreview = (f: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = f ? URL.createObjectURL(f) : null;
    setPreview(previewRef.current);
  };
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );
  // 离开的页面会被 Activity 保留（next.config 开了 cacheComponents）：开始了一件作品再回到首页，
  // 要是空白的新首页，不留上一件的照片、文字和「开始中」；没开始就离开的草稿照常保留
  const startedRef = useRef(false);
  useLayoutEffect(
    () => () => {
      if (!startedRef.current) return;
      startedRef.current = false;
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
      setPreview(null);
      setText('');
      setFile(null);
      setStarting(false);
    },
    [],
  );

  // 模板库：自己沉淀的在前，内置模板在后
  const saved = useLiveQuery(() => listSavedBackdrops(), []);
  const templates = libraryList(saved ?? []).slice(0, 8);

  const start = async (backdropId?: string) => {
    if (starting) return;
    setStarting(true);
    setProblem(null);
    try {
      const { work, backdrop } = await createWork(backdropId);
      let assetIds: string[] = [];
      if (file) {
        const r = await addPhotos(work.id, [file]);
        assetIds = r.assetIds;
        if (!assetIds.length) {
          await deleteWork(work.id); // 照片没加上：刚建的空作品一并删掉，不留在作品页里
          setProblem(r.notes.join('；'));
          setStarting(false);
          return;
        }
      }
      const first = text.trim() || (backdrop ? `我想套用「${backdrop.name}」这张背景` : '');
      if (first || assetIds.length) setFirstMessage(work.id, first, assetIds);
      startedRef.current = true;
      router.push(`/works/${work.id}`);
    } catch (e) {
      setProblem(`没能新建作品：${e instanceof Error ? e.message : String(e)}`);
      setStarting(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-8 pb-14 pt-[15vh]">
        <h1 className="mb-[22px] text-center text-page font-normal tracking-[0.01em]">今天想给哪件作品拍主图？</h1>
        <div className="mx-auto flex max-w-[700px] flex-col gap-2 rounded-[20px] bg-white px-[18px] pb-3 pt-4 shadow-[inset_0_0_0_1px_var(--color-line-strong),var(--shadow-md)] focus-within:shadow-[inset_0_0_0_1px_var(--color-line-hover),var(--shadow-md)]">
          {preview && (
            <div className="relative size-14">
              {/* eslint-disable-next-line @next/next/no-img-element -- 用户刚选的本地照片 */}
              <img src={preview} alt="待上传的作品照片" className="size-full rounded-lg object-cover shadow-[0_0_0_1px_var(--color-line)]" />
              <button type="button" aria-label="移除这张照片" className="absolute -right-1.5 -top-1.5 grid size-[18px] place-items-center rounded-full bg-black text-white" onClick={() => {
                  setFile(null);
                  showPreview(null);
                }}>
                <Icon name="close" className="size-[11px] [stroke-width:2]" />
              </button>
            </div>
          )}
          <label htmlFor="home-input" className="sr-only">
            说说你的作品
          </label>
          <textarea
            id="home-input"
            name="message"
            rows={2}
            className="block max-h-40 min-h-[52px] w-full resize-none bg-transparent text-block outline-none [field-sizing:content]"
            placeholder="上传作品照片，说说它是什么、想要什么感觉…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                if (text.trim() || file) void start();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <input
              ref={fileRef}
              type="file"
              accept={UPLOAD.types.join(',')}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const err = checkFile(f, 0);
                setProblem(err);
                if (err) return;
                setFile(f);
                showPreview(f);
              }}
            />
            <button
              type="button"
              className="inline-flex h-[30px] items-center gap-1.5 rounded-full px-3 text-aux text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-ink hover:shadow-[inset_0_0_0_1px_var(--color-line-hover)]"
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="upload" className="size-4" />
              上传照片
            </button>
            <button
              type="button"
              className="grid size-[30px] place-items-center rounded-full bg-black text-white hover:bg-[#333]"
              aria-label="开始"
              disabled={starting || (!text.trim() && !file)}
              onClick={() => void start()}
            >
              <Icon name="send" className="size-[15px] [stroke-width:1.9]" />
            </button>
          </div>
        </div>
        {problem && (
          <p role="alert" className="mt-3 text-center text-aux text-bad">
            {problem}
          </p>
        )}

        <section className="mt-[72px]">
          <div className="mb-3.5 flex items-baseline gap-2.5">
            <h2 className="text-block font-semibold">从模板库开始</h2>
            <span className="text-aux text-muted">套用一张背景，新作品放进同一个取景；之后在「背景」里还能换</span>
          </div>
          <div className="grid grid-cols-4 gap-3.5 max-[1180px]:grid-cols-2">
            {templates.map((t) => (
              <button key={t.id} type="button" className="group flex min-w-0 flex-col gap-1.5 text-left" disabled={starting} onClick={() => void start(t.id)} aria-label={`套用「${t.name}」`}>
                <span className="block rounded-lg transition-shadow group-hover:shadow-[0_0_0_1px_var(--color-line-strong),var(--shadow-md)]">
                  <BackdropThumb backdrop={t} className="!aspect-[4/3]" />
                </span>
                <span className="truncate text-body font-medium">{t.name}</span>
                <span className="text-aux text-muted">{t.builtin ? '内置模板' : '我沉淀的'}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
