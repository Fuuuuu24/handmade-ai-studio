'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { executeTool } from '@/agent/executors';
import type { AgentUIMessage, ToolName } from '@/agent/tools';
import { BUDGET } from '@/config/budget';
import type { StepId } from '@/config/steps';
import { errorText } from '@/client/api';
import { chatErrorMessage, chatRequestBody } from '@/client/chat-body';
import { turnProblem, withoutLastStep, type TurnProblem } from '@/client/chat-turn';
import { takeFirstMessage } from '@/client/first-message';
import { addPhotos } from '@/client/uploads';
import { loadMessages, saveMessages } from '@/data/repo';
import { mutateWork } from '@/client/work-store';
import { addCost } from '@/domain/work';
import { useWorkspace } from '@/components/workspace/context';
import { Composer } from './composer';
import { MessageView } from './message-view';

// 回复停在半路时给用户看的原因（BC-001）：思考过程不能代替答复
const PROBLEM_TEXT: Record<TurnProblem, string> = {
  timeout: '小间这次太久没答完，已经停下。',
  aborted: '小间这次的回复被中断了。',
  length: '小间这次的回复超出了单次长度上限，没说完。',
  empty: '小间这次只想了、没有给出答复。',
};

interface Props {
  registerSend: (fn: (text: string) => void) => void;
  onBusyChange: (busy: boolean) => void;
  onShowStep: (step: StepId) => void;
  onUserSend: () => void; // 用户发了消息：画布跟回当前步骤
}

// 每次挂载都从本地数据库读最新的对话，再交给对话会话；不用上层缓存的旧记录，避免把旧记录写回去覆盖新内容
export function ChatPanel(props: Props) {
  const { workId } = useWorkspace();
  const [loaded, setLoaded] = useState<{ workId: string; messages: AgentUIMessage[] } | { workId: string; error: string } | null>(null);
  useEffect(() => {
    let live = true;
    loadMessages(workId).then(
      (messages) => live && setLoaded({ workId, messages: messages as AgentUIMessage[] }),
      (e: unknown) => live && setLoaded({ workId, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [workId]);
  if (!loaded || loaded.workId !== workId) {
    return <section aria-label="和小间对话" className="grid place-items-center text-aux text-muted shadow-[1px_0_0_var(--color-line)]">正在读取对话…</section>;
  }
  if ('error' in loaded) {
    return (
      <section aria-label="和小间对话" role="alert" className="grid place-items-center px-6 text-center text-aux text-bad shadow-[1px_0_0_var(--color-line)]">
        对话记录读取失败：{loaded.error}。右侧画布仍可直接编辑。
      </section>
    );
  }
  return <ChatSession key={workId} initialMessages={loaded.messages} {...props} />;
}

function ChatSession({ initialMessages, registerSend, onBusyChange, onShowStep, onUserSend }: Props & { initialMessages: AgentUIMessage[] }) {
  const { workId } = useWorkspace();
  const savedRef = useRef(JSON.stringify(initialMessages));
  const autoSteps = useRef(0);
  const [capHit, setCapHit] = useState(false);
  const [retries, setRetries] = useState(0);
  const [userStopped, setUserStopped] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () => new DefaultChatTransport<AgentUIMessage>({ api: '/api/chat', body: () => chatRequestBody(workId) }),
    [workId],
  );

  const { messages, setMessages, sendMessage, status, error, addToolOutput, regenerate, stop, clearError } = useChat<AgentUIMessage>({
    id: workId,
    messages: initialMessages,
    transport,
    // 工具结果齐了自动继续；单轮连续操作有上限（技术写法第 6 节，config/budget.ts）
    sendAutomaticallyWhen: ({ messages: list }) => {
      if (!lastAssistantMessageIsCompleteWithToolCalls({ messages: list })) return false;
      if (autoSteps.current >= BUDGET.chat.maxSteps) {
        setCapHit(true);
        return false;
      }
      autoSteps.current += 1;
      return true;
    },
    // 对话花费累加进作品（试用记录的累计成本）；中止或出错的请求没有结束信息，服务端账本仍按估价记全
    onFinish({ message, isAbort, isError }) {
      const cost = message.metadata?.costUSD;
      if (isAbort || isError || !cost) return;
      void mutateWork(workId, (c) => addCost(c.work, cost)).catch((e) => console.error('对话花费没记上', e));
    },
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic) return;
      const name = toolCall.toolName as ToolName;
      try {
        const output = await executeTool(workId, name, toolCall.input, { showStep: onShowStep });
        void addToolOutput({ tool: name, toolCallId: toolCall.toolCallId, output });
      } catch (e) {
        void addToolOutput({ tool: name, toolCallId: toolCall.toolCallId, state: 'output-error', errorText: errorText(e) });
      }
    },
  });

  const busy = status === 'submitted' || status === 'streaming';
  // 模型首字可能要等十几秒：正文开始出来之前，一直显示「正在思考」，不让界面看起来卡住
  const lastPart = messages.at(-1)?.parts.at(-1);
  const writing = status === 'streaming' && lastPart?.type === 'text' && lastPart.text.length > 0;
  const thinking = busy && !writing;
  // 回复停在半路（超时、撞上长度上限、只想没说）时如实说明并可重试（BC-001）；用户自己点停止的不算
  const problem = status === 'ready' && !userStopped ? turnProblem(messages.at(-1)) : null;
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  // 一轮结束（或出错）时保存对话，含工具调用记录（AC-11.4）；和读出来时一样就不写
  useEffect(() => {
    if (status !== 'ready' && status !== 'error') return;
    const json = JSON.stringify(messages);
    if (json === savedRef.current) return;
    savedRef.current = json;
    // 写入失败由 tracked() 记入保存状态，顶栏显示原因和重试按钮
    void saveMessages(workId, messages).catch((e) => console.error('对话保存失败', e));
  }, [messages, status, workId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, status]);

  // 发出用户消息（不改界面状态，首条消息的副作用里也能用）
  const post = useCallback(
    (text: string, assetIds: string[] = []) => {
      const t = text.trim();
      if (!t && !assetIds.length) return;
      autoSteps.current = 0;
      void sendMessage({
        parts: [
          ...(assetIds.length ? [{ type: 'data-photos' as const, data: { assetIds } }] : []),
          { type: 'text' as const, text: t || `（上传了 ${assetIds.length} 张照片）` },
        ],
      });
    },
    [sendMessage],
  );

  const send = useCallback(
    (text: string, assetIds: string[] = []) => {
      setCapHit(false);
      setRetries(0);
      setUserStopped(false);
      onUserSend();
      post(text, assetIds);
    },
    [post, onUserSend],
  );

  // 重试只重做没完成的最后一步：前面几步调用过的工具已经改了作品，整条重来会再做一遍（比如重复记共创记录）
  const retry = () => {
    setRetries((r) => r + 1);
    setCapHit(false);
    setUserStopped(false);
    clearError();
    autoSteps.current = 0;
    const last = messages.at(-1);
    const kept = last?.role === 'assistant' ? withoutLastStep(last) : null;
    if (!kept) return void regenerate();
    setMessages([...messages.slice(0, -1), kept]);
    void sendMessage();
  };

  // 用花括号包住：注册函数的返回值不能被 React 当成清理函数
  useEffect(() => {
    registerSend((text) => send(text));
  }, [registerSend, send]);

  // 首页、布景页带过来的第一条消息只发一次。推迟到下一轮再取：开发模式的严格模式会先演练一次卸载，
  // 卸载时 useChat 会中止进行中的请求；推迟后演练卸载会取消定时器，消息留到真正挂载后再发
  useEffect(() => {
    const timer = setTimeout(() => {
      const first = takeFirstMessage(workId);
      if (first) post(first.text, first.assetIds);
    }, 0);
    return () => clearTimeout(timer);
  }, [workId, post]);

  const onFiles = async (files: File[], text: string) => {
    const { assetIds, notes: n } = await addPhotos(workId, files);
    setNotes(n);
    if (assetIds.length) send(text, assetIds);
  };

  return (
    <section aria-label="和小间对话" className="flex min-h-0 flex-col shadow-[1px_0_0_var(--color-line)]">
      <div className="flex items-center gap-2 px-5 pb-1.5 pt-3.5">
        <strong className="text-body">小间</strong>
        <span className="text-label text-muted">AI 助手</span>
      </div>
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 pt-3.5 [scrollbar-width:thin]">
        {!messages.length && (
          <p className="mt-6 text-aux text-muted">和小间说说你的作品，或者先上传一张作品的整体照片。小间会带你一步步做完商品主图。</p>
        )}
        {messages.map((m, i) => (
          <MessageView key={m.id} message={m} latest={i === messages.length - 1} />
        ))}
        {thinking && (
          <p className="flex items-center gap-2 text-aux text-muted" role="status">
            <span className="spinner !size-3" aria-hidden="true" />
            小间正在思考…
          </p>
        )}
        {capHit && (
          <p className="text-aux text-muted">小间这一轮已经连续操作 {BUDGET.chat.maxSteps} 次，先停下来等你说下一步。</p>
        )}
        {(error || problem) && (
          <div role="alert" className="rounded-lg bg-bad-bg px-3 py-2 text-aux text-bad">
            <p>{error ? `小间这次没有回复：${chatErrorMessage(error)}` : PROBLEM_TEXT[problem!]}</p>
            <div className="mt-1.5 flex items-center gap-2">
              {retries < BUDGET.chat.retries ? (
                <button type="button" className="mini-btn" onClick={retry}>
                  重试
                </button>
              ) : (
                <span>已经重试 {BUDGET.chat.retries} 次，稍后再试。</span>
              )}
              <span className="text-muted">右侧画布仍然可以直接编辑和确认。</span>
            </div>
          </div>
        )}
      </div>
      <div className="px-3.5 pb-3.5">
        {notes.length > 0 && (
          <ul className="mb-2 space-y-0.5 text-aux text-warn" aria-live="polite">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        <Composer
          busy={busy}
          onSend={(text) => send(text)}
          onFiles={onFiles}
          onStop={() => {
            setUserStopped(true);
            void stop();
          }}
        />
      </div>
    </section>
  );
}
