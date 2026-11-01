import { Fragment, type ReactNode } from 'react';

// 模型回复里常见的轻量格式（段落、列表、加粗）转成 React 元素；全部按文本渲染，不用 innerHTML，避免注入
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
    seg.startsWith('**') && seg.endsWith('**') && seg.length > 4 ? <strong key={i}>{seg.slice(2, -2)}</strong> : <Fragment key={i}>{seg}</Fragment>,
  );
}

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={blocks.length} className={`${list.ordered ? 'list-decimal' : 'list-disc'} space-y-0.5 pl-5`}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.、)]\s+(.*)$/);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flush();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((bullet ?? ordered)![1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ''))}</p>);
  }
  flush();
  return <div className="space-y-1.5">{blocks}</div>;
}
