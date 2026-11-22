import { NO_PROPS } from '@/config/style';
import type { BackdropParams, SceneParams } from './types';

const words = (text: string) => text.split(/[、，,；;\s]+/).map((w) => w.trim()).filter(Boolean);

const hasProps = (props: string) => props.trim() !== '' && props.trim() !== NO_PROPS && props.trim() !== '无';

// 风格卡里互相矛盾的写法（AC-05.3）：只指出，由用户决定改哪边。v0.6 起装饰道具归背景、展示用具归摆放，
// 两边各查各的（技术写法 13.9）：装饰道具对背景禁止项，摆放（含支架、托盘）对合成禁止项

export function backdropConflicts(style: BackdropParams): string[] {
  const list: string[] = [];
  const props = style.props.trim();
  for (const word of words(style.bannedBackdrop)) {
    if (hasProps(props) && props.includes(word)) list.push(`道具里有「${word}」，但背景的「禁止出现」也写了「${word}」`);
  }
  return list;
}

export function sceneConflicts(style: SceneParams): string[] {
  const list: string[] = [];
  const placement = style.placement.trim();
  for (const word of words(style.bannedScene)) {
    if (placement.includes(word)) list.push(`摆放里有「${word}」，但合成的「禁止出现」也写了「${word}」`);
  }
  if (placement.includes('悬挂') && /托盘|盘子/.test(placement)) {
    list.push('摆放写了「悬挂」，又要放进托盘，二者可能矛盾');
  }
  return list;
}
