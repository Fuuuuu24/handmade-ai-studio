import { DEFAULT_CHAT_MODEL, DEFAULT_IMAGE_MODEL } from '@/config/models';
import { DEFAULT_ROUTE } from '@/config/route';
import { logEvent, saveWork } from '@/data/repo';
import { newWork } from '@/domain/work';
import { findScene, type SceneRef } from './scenes';

// 新建作品：可以预设一套布景（首页模版卡片、布景页「用这套开始」，PRD 5.1）
export async function createWork(sceneId?: string): Promise<{ work: ReturnType<typeof newWork>; scene: SceneRef | null }> {
  const scene = sceneId ? await findScene(sceneId) : null;
  if (sceneId && !scene) throw new Error('这套布景不存在或已删除');
  const work = newWork({
    imageModel: DEFAULT_IMAGE_MODEL,
    chatModel: DEFAULT_CHAT_MODEL,
    route: DEFAULT_ROUTE,
    scene: scene ? { id: scene.id, params: scene.params } : null,
  });
  await saveWork(work);
  void logEvent('create_work', work.id, { scene: scene?.id ?? null });
  return { work, scene };
}
