import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 浏览器里的图片处理在 Node 里没有：校验照常，读图换成固定值
vi.mock('./images', () => ({
  checkFile: (file: File, existing: number) => (existing >= 8 ? '一件作品最多 8 张照片' : file.type.startsWith('image/') ? null : `「${file.name}」不是图片`),
  prepareUpload: vi.fn(async (file: File) => ({ blob: file, thumb: file, width: 1600, height: 1200, warnings: [] })),
}));

import { useTestDb } from '@/data/db';
import { listAssets, saveWork } from '@/data/repo';
import { activeUploads } from '@/domain/assets';
import { newId } from '@/domain/util';
import { newWork } from '@/domain/work';
import { addPhotos, replacePhoto } from './uploads';

const file = (name: string) => new File([new Uint8Array(10)], name, { type: 'image/jpeg' });

async function seed() {
  const w = newWork({ imageModel: 'img-a', chatModel: 'chat-a' });
  await saveWork(w);
  return w.id;
}

beforeEach(() => {
  useTestDb(newId('test'));
});

describe('上传照片（技术写法 13.3）', () => {
  it('没指定类型的先进「未分类」；细节照可以一次传好几张', async () => {
    const id = await seed();
    await addPhotos(id, [file('a.jpg')]);
    await addPhotos(id, [file('b.jpg'), file('c.jpg')], 'detail');
    expect(activeUploads(await listAssets(id), id).map((a) => a.kind)).toEqual(['detail', 'detail', 'unsorted']);
  });

  it('角度只放一张：一次传几张时第一张进这个角度，其余进「未分类」；再传一张会顶替，原来的退回未分类', async () => {
    const id = await seed();
    const first = await addPhotos(id, [file('a.jpg'), file('b.jpg')], 'side');
    const kinds = async () => Object.fromEntries((await listAssets(id)).map((a) => [a.id, a.kind]));
    expect(Object.values(await kinds()).sort()).toEqual(['side', 'unsorted']);
    expect((await kinds())[first.assetIds[0]]).toBe('side');
    const second = await addPhotos(id, [file('c.jpg')], 'side');
    expect((await kinds())[second.assetIds[0]]).toBe('side');
    expect((await kinds())[first.assetIds[0]]).toBe('unsorted');
  });

  it('不是图片的跳过并说明原因；替换原图沿用同一个角度，旧的标为被替换、原图保留', async () => {
    const id = await seed();
    const r = await addPhotos(id, [new File(['x'], 'note.txt', { type: 'text/plain' }), file('a.jpg')], 'front');
    expect(r.notes).toEqual(['「note.txt」不是图片']);
    const [front] = await listAssets(id);
    expect(front.kind).toBe('front');
    expect(await replacePhoto(front, file('b.jpg'))).toEqual({ ok: true, notes: [] });
    const all = await listAssets(id);
    expect(all.find((a) => a.id === front.id)).toMatchObject({ removed: true, kind: 'front' });
    expect(activeUploads(all, id).map((a) => a.kind)).toEqual(['front']);
  });
});
