import { DEFAULT_CHAT_MODEL, DEFAULT_IMAGE_MODEL } from '@/config/models';
import { DEFAULT_ROUTE } from '@/config/route';
import { builtinScene } from '@/config/scenes';
import { logEvent, saveWork } from '@/data/repo';
import { newWork } from '@/domain/work';

// 新建作品：可以预设一套布景（首页模版卡片，PRD 5.1）
export async function createWork(sceneId?: string) {
  const scene = sceneId ? builtinScene(sceneId) : null;
  const work = newWork({
    imageModel: DEFAULT_IMAGE_MODEL,
    chatModel: DEFAULT_CHAT_MODEL,
    route: DEFAULT_ROUTE,
    scene: scene ? { id: scene.id, params: scene.params } : null,
  });
  await saveWork(work);
  void logEvent('create_work', work.id, { scene: scene?.id ?? null });
  return work;
}
