import type { Tone } from '@/domain/status';

const TONE_CLASS: Record<Tone, string> = { '': 'chip', warn: 'chip chip-warn', ok: 'chip chip-ok' };

// 作品状态标签：顶栏、作品页共用
export function StatusChip({ text, tone, className = '' }: { text: string; tone: Tone; className?: string }) {
  return <span className={`${TONE_CLASS[tone]} ${className}`}>{text}</span>;
}
