'use client';

import { useRef, useState } from 'react';
import { UPLOAD } from '@/config/upload';
import { mutateWork } from '@/client/work-store';
import { setChatModel, setImageModel } from '@/domain/work';
import { Icon } from '@/components/ui/icon';
import { useWorkspace } from '@/components/workspace/context';

interface Props {
  busy: boolean;
  onSend: (text: string) => void;
  onFiles: (files: File[], text: string) => Promise<void>;
  onStop: () => void;
}

// 对话输入框：文字、上传照片、切换对话模型和生图模型（AC-08.7、AC-11.8）
export function Composer({ busy, onSend, onFiles, onStop }: Props) {
  const { ctx, config, configError, workId } = useWorkspace();
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { work } = ctx;
  const showDontKnow = work.story.summaryState !== 'confirmed' && work.assetsConfirmed;
  const chatModels = config?.chatModels ?? [];
  const imageModels = config?.imageModels ?? [];
  const currentChat = chatModels.find((m) => m.id === work.chatModel);

  const submit = () => {
    if (busy || !text.trim()) return;
    onSend(text);
    setText('');
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white px-3.5 pb-2.5 pt-3 shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--color-line-hover),var(--shadow-md)]">
      {showDontKnow && (
        <div className="flex">
          <button type="button" className="mini-btn" disabled={busy} onClick={() => onSend('我不知道，给我推荐')}>
            我不知道，给我推荐
          </button>
        </div>
      )}
      <label className="sr-only" htmlFor="chat-input">
        和小间说
      </label>
      <textarea
        id="chat-input"
        name="message"
        rows={1}
        className="block max-h-40 min-h-[22px] w-full resize-none bg-transparent text-body outline-none [field-sizing:content]"
        placeholder="说说你的作品，或者想怎么改…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // 输入法选字时的回车不发送（Safari 用 keyCode 229 表示）
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={UPLOAD.types.join(',')}
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (!files.length) return;
            setUploading(true);
            try {
              await onFiles(files, text);
              setText('');
            } finally {
              setUploading(false);
            }
          }}
        />
        <button
          type="button"
          className="grid size-[30px] place-items-center rounded-full text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-ink hover:shadow-[inset_0_0_0_1px_var(--color-line-hover)]"
          aria-label="上传作品照片"
          title={ctx.isGenerating ? '正在生成，等这一轮结束再加照片' : '上传作品照片'}
          disabled={busy || uploading || ctx.isGenerating}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="plus" className="size-4" />
        </button>
        {configError ? (
          <span className="text-label text-bad">模型清单读取失败：{configError}</span>
        ) : (
          <>
            <label className="sr-only" htmlFor="chat-model">
              对话模型
            </label>
            <select
              id="chat-model"
              className="h-7 max-w-36 truncate rounded-full bg-soft px-2.5 text-label text-ink-2 hover:bg-soft-2"
              value={work.chatModel}
              disabled={busy || !chatModels.length}
              onChange={(e) => void mutateWork(workId, (c) => setChatModel(c.work, e.target.value))}
            >
              {!currentChat && <option value={work.chatModel}>{work.chatModel}（未配置）</option>}
              {chatModels.map((m) => (
                <option key={m.id} value={m.id}>
                  对话：{m.label}
                  {m.vision ? '' : '（看不到照片）'}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="image-model">
              生图模型
            </label>
            <select
              id="image-model"
              className="h-7 max-w-36 truncate rounded-full bg-soft px-2.5 text-label text-ink-2 hover:bg-soft-2"
              value={work.imageModel}
              disabled={busy || ctx.isGenerating || !imageModels.length}
              onChange={(e) => void mutateWork(workId, (c) => setImageModel(c.work, e.target.value))}
            >
              {!imageModels.some((m) => m.id === work.imageModel) && <option value={work.imageModel}>{work.imageModel}（未配置）</option>}
              {imageModels.map((m) => (
                <option key={m.id} value={m.id}>
                  生图：{m.label}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="ml-auto" />
        {uploading && <span className="text-label text-muted">照片处理中…</span>}
        {busy ? (
          <button type="button" className="grid size-[30px] place-items-center rounded-full bg-black text-white hover:bg-[#333]" aria-label="停止回复" onClick={onStop}>
            <Icon name="stop" className="size-[15px]" />
          </button>
        ) : (
          <button
            type="button"
            className="grid size-[30px] place-items-center rounded-full bg-black text-white hover:bg-[#333]"
            aria-label="发送"
            disabled={!text.trim()}
            onClick={submit}
          >
            <Icon name="send" className="size-[15px] [stroke-width:1.9]" />
          </button>
        )}
      </div>
    </div>
  );
}
