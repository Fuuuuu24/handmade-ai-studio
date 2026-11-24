import { DEFAULT_CHAT_MODEL, DEFAULT_IMAGE_MODEL } from '@/config/models';
import { logEvent, saveWork } from '@/data/repo';
import type { BackdropRef } from '@/domain/types';
import { newWork } from '@/domain/work';
import { resolveBackdrop } from './work-store';

// 新建作品（PRD 5.2）：首页开始是流程一；从模板库「套用」一张背景图进来是流程二，背景一进来就选好
export async function createWork(backdropId?: string): Promise<{ work: ReturnType<typeof newWork>; backdrop: BackdropRef | null }> {
  const backdrop = backdropId ? await resolveBackdrop(backdropId) : null;
  if (backdropId && (!backdrop || backdrop.deleted)) throw new Error('这张背景图不存在或已从模板库删除');
  const work = newWork({ imageModel: DEFAULT_IMAGE_MODEL, chatModel: DEFAULT_CHAT_MODEL, backdropId: backdrop?.id ?? null });
  await saveWork(work);
  void logEvent('create_work', work.id, { flow: work.flow, builtin: backdrop ? backdrop.builtin : null });
  return { work, backdrop };
}
