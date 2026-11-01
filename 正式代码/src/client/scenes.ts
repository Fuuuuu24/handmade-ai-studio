import { builtinScene } from '@/config/scenes';
import { getScene } from '@/data/repo';
import type { Id, SceneParams } from '@/domain/types';

export interface SceneRef {
  id: Id;
  name: string;
  params: SceneParams;
}

// 布景可以是内置模版，也可以是用户存的布景（PRD FR-06）
export async function findScene(id: Id): Promise<SceneRef | null> {
  const b = builtinScene(id);
  if (b) return { id: b.id, name: b.name, params: b.params };
  const saved = await getScene(id);
  return saved ? { id: saved.id, name: saved.name, params: saved.params } : null;
}
