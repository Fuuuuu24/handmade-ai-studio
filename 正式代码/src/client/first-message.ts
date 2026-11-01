// 首页、布景页带过去的第一句话和照片：新建作品后在工作区里自动发出一次
const key = (workId: string) => `yijian:first:${workId}`;

export function setFirstMessage(workId: string, text: string, assetIds: string[]) {
  sessionStorage.setItem(key(workId), JSON.stringify({ text, assetIds }));
}

export function takeFirstMessage(workId: string): { text: string; assetIds: string[] } | null {
  const raw = sessionStorage.getItem(key(workId));
  if (!raw) return null;
  sessionStorage.removeItem(key(workId));
  try {
    return JSON.parse(raw) as { text: string; assetIds: string[] };
  } catch {
    return null;
  }
}
