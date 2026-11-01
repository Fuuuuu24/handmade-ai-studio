import { NO_PROPS, type StyleKey } from '@/config/style';

const words = (text: string) => text.split(/[、，,；;\s]+/).map((w) => w.trim()).filter(Boolean);

const hasProps = (props: string) => props.trim() !== '' && props.trim() !== NO_PROPS && props.trim() !== '无';

// 风格卡里互相矛盾的写法（AC-05.3）：只指出，由用户决定改哪边
export function styleConflicts(style: Record<StyleKey, string>): string[] {
  const list: string[] = [];
  const props = style.props.trim();
  for (const word of words(style.banned)) {
    if (hasProps(props) && props.includes(word)) list.push(`道具里有「${word}」，但「禁止出现」也写了「${word}」`);
  }
  if (style.placement.includes('悬挂') && /托盘|盘子/.test(props)) {
    list.push('摆放选了「悬挂」，道具里却有托盘，二者可能矛盾');
  }
  return list;
}
