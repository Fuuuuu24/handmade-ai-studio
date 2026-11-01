'use client';

import { useRef, useState } from 'react';
import { UPLOAD } from '@/config/upload';
import { mutateWork } from '@/client/work-store';
import { logEvent } from '@/data/repo';
import { setChatModel, setImageModel, setNoStory } from '@/domain/work';
import PromptBar from '@/components/bits/PromptBar/PromptBar';
import { useWorkspace } from '@/components/workspace/context';

interface Props {
  busy: boolean;
  onSend: (text: string) => void;
  onFiles: (files: File[], text: string) => Promise<void>;
  onStop: () => void;
}

// 对话输入框（React Bits Prompt Bar）：文字、「＋」上传照片、「/」命令、切换对话模型和生图模型（AC-08.7、AC-11.8）
export function Composer({ busy, onSend, onFiles, onStop }: Props) {
  const { ctx, config, configError, workId } = useWorkspace();
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { work } = ctx;
  const showDontKnow = work.story.summaryState !== 'confirmed' && work.assetsConfirmed;
  const chatModels = config?.chatModels ?? [];
  const imageModels = config?.imageModels ?? [];
  const uploadLocked = busy || uploading || ctx.isGenerating;

  const send = (message: string) => {
    if (busy || !message.trim()) return;
    onSend(message);
    setText('');
  };
  const dontKnow = () => {
    void logEvent('dont_know', workId);
    send('我不知道，给我推荐');
  };

  return (
    <>
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
      <PromptBar
        value={text}
        onChange={setText}
        inputId="chat-input"
        inputName="message"
        inputLabel="和小间说"
        placeholder="说说你的作品，或者想怎么改…（输入 / 看快捷命令）"
        busy={busy}
        onSend={send}
        onStop={onStop}
        sourcesLabel="添加"
        sourcesDisabled={uploadLocked}
        sourcesTitle={ctx.isGenerating ? '正在生成，等这一轮结束再加照片' : '上传作品照片'}
        sources={[{ key: 'photo', name: '上传作品照片', description: 'JPG、PNG、WebP', icon: 'image', onPick: () => fileRef.current?.click() }]}
        commands={
          busy
            ? []
            : [
                { key: 'recommend', name: '/推荐', description: '我不知道，给我推荐几个方向', run: dontKnow },
                {
                  key: 'no-story',
                  name: '/暂无故事',
                  description: '没有特别的故事，按造型和材质来',
                  run: () => {
                    void mutateWork(workId, (c) => setNoStory(c.work, true));
                    send('这件作品暂无明确故事，按造型和材质来');
                  },
                },
              ]
        }
        pickers={
          configError
            ? []
            : [
                {
                  key: 'chat',
                  label: '对话模型',
                  prefix: '对话',
                  value: work.chatModel,
                  disabled: busy || !chatModels.length,
                  options: chatModels.map((m) => ({ key: m.id, name: m.label, tag: m.vision ? undefined : '看不到照片' })),
                  onChange: (id) => void mutateWork(workId, (c) => setChatModel(c.work, id)),
                },
                {
                  key: 'image',
                  label: '生图模型',
                  prefix: '生图',
                  value: work.imageModel,
                  disabled: busy || ctx.isGenerating || !imageModels.length,
                  title: ctx.isGenerating ? '正在生成，等这一轮结束再换' : '换生图模型后需要重新批准',
                  options: imageModels.map((m) => ({ key: m.id, name: m.label })),
                  onChange: (id) => void mutateWork(workId, (c) => setImageModel(c.work, id)),
                },
              ]
        }
        top={
          showDontKnow ? (
            <div className="flex">
              <button type="button" className="mini-btn" disabled={busy} onClick={dontKnow}>
                我不知道，给我推荐
              </button>
            </div>
          ) : undefined
        }
        status={
          configError ? (
            <span className="mr-1 text-label text-bad">模型清单读取失败：{configError}</span>
          ) : uploading ? (
            <span className="mr-1 text-label text-muted">照片处理中…</span>
          ) : undefined
        }
      />
    </>
  );
}
