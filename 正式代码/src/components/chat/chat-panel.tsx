'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { executeTool, type ExecDeps } from '@/agent/executors';
import type { AgentUIMessage, ToolName } from '@/agent/tools';
import { BUDGET } from '@/config/budget';
import type { StepId } from '@/config/steps';
import { errorText } from '@/client/api';
import { hasHeld, queueDue, sendQueued, setFirstPhotos, takeFirstPhotos, type QueuedMessage } from '@/client/agent-queue';
import { chatErrorMessage, chatRequestBody } from '@/client/chat-body';
import { closeDanglingCalls, pendingToolCall, turnProblem, userTextsAfterCall, userTextsOf, withoutLastStep, type TurnProblem } from '@/client/chat-turn';
import { takeFirstMessage } from '@/client/first-message';
import { addPhotos } from '@/client/uploads';
import { loadMessages, saveMessages } from '@/data/repo';
import { mutateWork } from '@/client/work-store';
import { addCost } from '@/domain/work';
import { useConfirm } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
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

// 每次挂载都从本地数据库读最新的对话，再交给对话会话；不用上层缓存的旧记录，避免把旧记录写回去覆盖新内容。
// 中途停下留下的没结果的工具调用补上结果，不然下一次请求会出错（技术写法 14.5）
export function ChatPanel(props: Props) {
  const { workId } = useWorkspace();
  const [loaded, setLoaded] = useState<{ workId: string; messages: AgentUIMessage[] } | { workId: string; error: string } | null>(null);
  useEffect(() => {
    let live = true;
    loadMessages(workId).then(
      (messages) => live && setLoaded({ workId, messages: closeDanglingCalls(messages as AgentUIMessage[]) }),
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
  const { workId, ctx } = useWorkspace();
  const savedRef = useRef(JSON.stringify(initialMessages));
  const autoSteps = useRef(0);
  const [capHit, setCapHit] = useState(false);
  const [retries, setRetries] = useState(0);
  const [userStopped, setUserStopped] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  // 用户发过的文字，执行器核对「你说的」用（BC-013）；工具在回复中途执行，这时对话还没存进数据库。
  // 整段对话也留一份：代点时核对同意的原话，只认问过之后用户说的（技术写法 14.4）
  const userTextsRef = useRef<string[]>([]);
  const messagesRef = useRef<AgentUIMessage[]>(initialMessages);
  // 小间发起的「删除这件作品」用户确认了：回作品页，这段对话不再保存、不再继续（技术写法 14.5）
  const leavingRef = useRef(false);
  const stoppedRef = useRef(false);
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();

  // 生成通知附的结果图排在附图最前面（技术写法 13.9）：发通知前放进 agent-queue，请求时取走
  const transport = useMemo(
    () => new DefaultChatTransport<AgentUIMessage>({ api: '/api/chat', body: () => chatRequestBody(workId, takeFirstPhotos(workId)) }),
    [workId],
  );

  const { messages, setMessages, sendMessage, status, error, addToolOutput, regenerate, stop, clearError } = useChat<AgentUIMessage>({
    id: workId,
    messages: initialMessages,
    transport,
    // 工具结果齐了自动继续；单轮连续操作有上限（技术写法第 6 节，config/budget.ts）
    sendAutomaticallyWhen: ({ messages: list }) => {
      // 用户点了停止：等确认框的工具之后才出结果，也不自己续一轮（代码评审 2026-11-23）
      if (stoppedRef.current) return false;
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
      // 作品已经删了：这一轮的花费记不进作品了（服务端账本照常记）
      if (isAbort || isError || !cost || leavingRef.current) return;
      void mutateWork(workId, (c) => addCost(c.work, cost)).catch((e) => console.error('对话花费没记上', e));
    },
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic) return;
      const name = toolCall.toolName as ToolName;
      const deps: ExecDeps = {
        showStep: onShowStep,
        userTexts: () => userTextsRef.current,
        userTextsAfter: (callId) => userTextsAfterCall(messagesRef.current, callId),
        // 删除、停用、替换：弹出和画布上同一个确认框，用户点完才往下走（工具执行期间对话一直是「回复中」）
        confirm,
        leave: () => {
          leavingRef.current = true;
          toast(`已删除「${ctx.work.name}」`);
          router.push('/works');
        },
      };
      try {
        const output = await executeTool(workId, name, toolCall.input, deps, toolCall.toolCallId);
        if (leavingRef.current) return;
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

  useEffect(() => {
    userTextsRef.current = userTextsOf(messages);
    messagesRef.current = messages;
  }, [messages]);

  // 小间跟上画布（技术写法 13.12）：空闲时把排队的「下一步」交接、生成通知、验收通知合成一条代用户发出。
  // 空闲和自动续步用同一个条件；上一轮出错、撞上单轮上限、有工具调用还没结果（技术写法 14.5）或用户正在打字时先不发。
  // 用户点了停止：不会再自动续步，工具结果齐了也算空闲，不然交接和通知要等用户再打字才发（代码评审 2026-11-23）
  const [draftEmpty, setDraftEmpty] = useState(true);
  const [queueTick, setQueueTick] = useState(0);
  const waitingAutoStep = lastAssistantMessageIsCompleteWithToolCalls({ messages }) && !userStopped;
  const idle = status === 'ready' && !waitingAutoStep && !pendingToolCall(messages) && !error && !capHit && !problem && draftEmpty;
  // 取到消息那一刻对话还空不空闲（评审第 4 条）：提交时就记下，卸载时记为不空闲；不空闲时取到的消息先留着
  const idleRef = useRef(false);
  useLayoutEffect(() => {
    idleRef.current = idle;
    return () => {
      idleRef.current = false;
    };
  }, [idle]);
  useEffect(() => {
    if (!idle) return;
    // 先用现成的数据看有没有要发的，没有就不去读库认领（评审第 12 条）；验收通知还要等的，到点再看一次
    const due = queueDue(ctx, Date.now());
    if (!due.ready && !hasHeld(workId)) {
      if (due.waitMs == null) return;
      const wait = setTimeout(() => setQueueTick((t) => t + 1), due.waitMs + 50);
      return () => clearTimeout(wait);
    }
    let live = true;
    let again: ReturnType<typeof setTimeout> | undefined;
    const send = (m: QueuedMessage) => {
      setFirstPhotos(workId, m.photos);
      autoSteps.current = 0; // 系统消息各自算新的一轮：之前点过的停止不再管这一轮
      stoppedRef.current = false;
      setUserStopped(false);
      void sendMessage({ parts: [{ type: 'text', text: m.text }], metadata: { system: m.system } });
    };
    // 推迟到下一轮：开发模式的严格模式会先演练一次卸载；认领在事务里，重复取也只发一次
    const timer = setTimeout(() => {
      sendQueued(workId, () => idleRef.current, send)
        .then(({ sent, retryInMs, recheck }) => {
          if (sent) return;
          // 跑的时候又有数据变化：再看一次。清理之后（live 为假）新一轮副作用会自己算等多久，不再建定时器
          if (recheck) setQueueTick((t) => t + 1);
          else if (retryInMs != null && live) again = setTimeout(() => setQueueTick((t) => t + 1), retryInMs + 50);
        })
        .catch((e: unknown) => console.error('给小间的交接或通知没发出去', e));
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
      if (again) clearTimeout(again);
    };
  }, [idle, ctx, queueTick, workId, sendMessage]);

  // 一轮结束（或出错）时保存对话，含工具调用记录（AC-11.4）；和读出来时一样就不写
  useEffect(() => {
    if (status !== 'ready' && status !== 'error') return;
    if (leavingRef.current) return; // 作品已删除，对话跟着删了，不再写回
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
      stoppedRef.current = false;
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
    stoppedRef.current = false;
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

  // 首页、模板库「套用」带过来的第一条消息只发一次。推迟到下一轮再取：开发模式的严格模式会先演练一次卸载，
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
          onDraftChange={setDraftEmpty}
          onSend={(text) => send(text)}
          onFiles={onFiles}
          onStop={() => {
            setUserStopped(true);
            stoppedRef.current = true;
            // 停在半路的工具调用（参数还没收全）补上结果，不然交接发不出去、下一条消息也会因为缺结果出错
            void stop().then(() => setMessages((list) => closeDanglingCalls(list)));
          }}
        />
      </div>
    </section>
  );
}
