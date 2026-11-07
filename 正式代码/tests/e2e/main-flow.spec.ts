import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* 全流程（技术写法第 9 节）：假对话模型按「【测试：xxx】」标记调用工具，假生图网关出测试图，不调用模型、不花钱。
   覆盖：首页 → 上传 → 信息建议 → 共创总结 → 布景与提示词 → 批准卡片 → 生成两张 → 验收 → 意见与从这张修改
   → 导出 → 存布景、我的风格提议 → 方向卡片 → 后续需求 → 两版对比 → 试用记录导出；以及硬规则：没有批准时小间不能生成。 */

// 在浏览器里画一张测试图（不用第三方照片）。在空白页上画并缓存：开发服务器首次编译时会刷新页面，打断正在执行的脚本
let photo: Buffer | null = null;
async function testPhoto(page: Page): Promise<Buffer> {
  if (photo) return photo;
  const blank = await page.context().newPage();
  const dataUrl = await blank.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const g = c.getContext('2d')!;
    g.fillStyle = '#e8e4dc';
    g.fillRect(0, 0, 1200, 900);
    g.strokeStyle = '#8a8a8a';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(450, 450, 160, 0, Math.PI * 2);
    g.arc(750, 450, 160, 0, Math.PI * 2);
    g.stroke();
    return c.toDataURL('image/jpeg', 0.9);
  });
  await blank.close();
  photo = Buffer.from(dataUrl.split(',')[1], 'base64');
  return photo;
}

const chat = (page: Page) => page.getByRole('region', { name: '和小间对话' });
const canvas = (page: Page) => page.getByRole('region', { name: '画布' });
const step = (page: Page, name: string) => page.getByRole('navigation', { name: '流程进度' }).getByRole('button', { name: new RegExp(`^${name}`) });
// 对话里当前那张批准卡片（过去的卡片收成一行，不含这行字）
const approvalCard = (page: Page) => chat(page).getByText('确认这版方案').locator('xpath=ancestor::div[contains(@class,"rounded-[14px]")]');

// 批准是滑动确认（Slide Commit），只认真实指针；测试走键盘：聚焦后按 End
async function approveBy(slider: Locator) {
  await expect(slider).not.toHaveAttribute('aria-disabled', 'true');
  await slider.focus();
  await slider.press('End');
}

async function say(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '和小间说' });
  await box.fill(text);
  await box.press('Enter');
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 });
}

async function startWork(page: Page, text: string) {
  const buffer = await testPhoto(page);
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({ name: 'test.jpg', mimeType: 'image/jpeg', buffer });
  await page.getByRole('textbox', { name: '说说你的作品' }).fill(text);
  await page.getByRole('button', { name: '开始' }).click();
  await page.waitForURL(/\/works\/work_/);
  await expect(page.getByText('测试模式 · 对话和图片都不是 AI')).toBeVisible();
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 });
}

test('主流程：从上传到导出，小间的工具和卡片都能用', async ({ page }, info) => {
  const shot = (name: string) => page.screenshot({ path: info.outputPath(`${name}.png`) });
  await startWork(page, '这是我做的耳坠【测试：信息】');
  await expect(chat(page).getByText('已写成待确认建议')).toBeVisible();

  // 资产 → 信息：小间写的是建议，接受后才生效
  await canvas(page).getByRole('button', { name: '确认资产' }).click();
  await step(page, '信息').click();
  for (let i = 0; i < 3; i++) await canvas(page).getByRole('button', { name: '接受' }).first().click();
  await expect(step(page, '信息')).toHaveAccessibleName(/完成/); // 填好后画布跟到下一步

  // 共创：总结是草稿，由用户确认
  await say(page, '灵感是雨后的石阶【测试：记录】【测试：总结】');
  await step(page, '共创').click();
  await expect(canvas(page).getByText('草稿，待确认')).toBeVisible();
  await canvas(page).getByRole('button', { name: '确认总结' }).click();

  // 方向卡片（AC-04.2）：点一张，选择发回给小间
  await say(page, '我不知道【测试：选卡】');
  await shot('1-picks');
  await chat(page).getByRole('button', { name: /安静的复古/ }).click();
  await expect(chat(page).getByText('我选「安静的复古」')).toBeVisible();
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 });

  // 硬规则：没有批准时小间不能生成（PRD 4.2 第 1 条）
  await say(page, '直接生成吧【测试：生成】');
  await expect(chat(page).getByText('不能生成：方案还没批准')).toBeVisible();

  // 方案：布景、提示词、批准卡片；批准只能由用户点
  await say(page, '就用雨后那套【测试：布景】【测试：提示词】【测试：批准】');
  const card = approvalCard(page);
  await approveBy(card.getByRole('slider', { name: /滑动批准并生成两张/ }));

  // 出图：两张都出来（假网关几秒完成）
  await expect(canvas(page).getByRole('heading', { name: '第 1 轮' })).toBeVisible();
  await expect(canvas(page).getByRole('img', { name: '候选 1' })).toBeVisible({ timeout: 60_000 });
  await expect(canvas(page).getByRole('img', { name: '候选 2' })).toBeVisible({ timeout: 60_000 });
  await expect(canvas(page).getByText('验收只代表你满意')).toBeVisible();

  // 验收：候选 2 两项满意；候选 1 不像
  const cands = canvas(page).locator('div.flex.min-w-0.flex-col.gap-2\\.5');
  const c1 = cands.nth(0);
  const c2 = cands.nth(1);
  await c2.getByRole('button', { name: '像', exact: true }).click();
  await c2.getByRole('button', { name: '对', exact: true }).click();
  await c1.getByRole('button', { name: '不像' }).click();
  await expect(page.getByText('已完成')).toBeVisible();

  // 导出卡片（两项满意才能下载），导出后可以标记已发布
  await say(page, '把第二张给我【测试：导出】');
  const download = page.waitForEvent('download');
  await chat(page).getByRole('button', { name: '下载' }).click();
  expect((await download).suggestedFilename()).toMatch(/第1轮-候选2\.(jpg|png)$/);
  await step(page, '出图').click();
  await c2.getByLabel('已经拿去发布了').click();
  await expect(c2.getByLabel('已经拿去发布了')).toBeChecked(); // 写进本地数据库后才显示勾选

  // 两版对比（AC-09.5）
  await c1.getByRole('button', { name: '加入对比' }).click();
  await c2.getByRole('button', { name: '加入对比' }).click();
  await expect(canvas(page).getByRole('heading', { name: '两版对比' })).toBeVisible();
  await expect(canvas(page).getByText('两张来自同一版方案')).toBeVisible();
  await shot('2-compare');
  await canvas(page).getByRole('button', { name: '关闭对比' }).click();

  // 存布景、我的风格：小间只能提议，用户在卡片上确认才写入（PRD 4.2 第 2 条）
  await say(page, '这套光线我很喜欢【测试：存布景】');
  await shot('3-scene-card');
  await chat(page).getByRole('button', { name: '存为布景' }).click();
  await expect(chat(page).getByText('已存为布景「测试布景」')).toBeVisible();
  await say(page, '以后都要这种光【测试：我的风格】');
  await shot('4-shop-card');
  await chat(page).getByRole('button', { name: /同意，更新 2 项/ }).click();
  await expect(chat(page).getByText('已更新我的风格')).toBeVisible();

  // 本期不支持的需求记下来，不进共创记录（AC-02.5）
  await say(page, '能做真人佩戴吗【测试：后续】');
  await step(page, '信息').click();
  await expect(canvas(page).getByText('真人佩戴图')).toBeVisible();

  // 意见与从这张修改（AC-09.4）：方案恢复成那一版，原结果保留
  await say(page, '第一张链子变长了【测试：意见】');
  await expect(chat(page).getByText(/已记在第 1 轮候选 1 上/)).toBeVisible();
  await step(page, '方案').click();
  await expect(canvas(page).getByText(/正在修改第 1 轮候选 1/)).toBeVisible();
  await expect(canvas(page).getByRole('heading', { name: '可读方案' })).toBeVisible();
  await shot('5-plan');

  // 布景页、我的风格页能看到写入的内容
  await page.getByRole('link', { name: '摄影布景' }).click();
  await expect(page.getByRole('heading', { name: '测试布景' })).toBeVisible();
  await page.getByRole('link', { name: '我的风格' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '我的风格' })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: '清冷晨光' })).toBeVisible();
  await expect(page.getByText(/改了：色调、光线/)).toBeVisible();

  // 试用记录导出（PRD 6.2）
  await page.getByRole('button', { name: '使用说明' }).click();
  const trial = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出试用记录' }).click();
  const file = await trial;
  const csv = readFileSync((await file.path())!, 'utf8');
  expect(csv.startsWith('﻿匿名编号,作品序号,饰品类型')).toBe(true);
  expect(csv).toContain('是（1 次）');
  expect(csv).toContain('1 张');
  expect(csv).not.toContain('这是我做的耳坠');
});

test('部分失败与补齐：一张失败可以补，次数受上限约束', async ({ page }) => {
  await startWork(page, '【测试：信息】');
  await canvas(page).getByRole('button', { name: '确认资产' }).click();
  await step(page, '信息').click();
  for (let i = 0; i < 3; i++) await canvas(page).getByRole('button', { name: '接受' }).first().click();
  await say(page, '【测试：总结】');
  await step(page, '共创').click();
  await canvas(page).getByRole('button', { name: '确认总结' }).click();
  await say(page, '【测试：布景】');
  await step(page, '方案').click();
  // 自己写提示词并核对（不靠小间也能走完，AC-11.6）
  const prompt = canvas(page).getByLabel('完整提示词');
  await prompt.fill('一对手作银耳坠，完整入框留边距，画面没有文字【测试：失败一张】');
  await prompt.blur();
  await canvas(page).getByRole('button', { name: '我已核对，两者一致' }).click();
  await approveBy(canvas(page).getByRole('slider', { name: /滑动批准并生成两张/ }));
  await expect(canvas(page).getByText(/候选 \d 没有生成出来/)).toBeVisible({ timeout: 60_000 });
  await expect(canvas(page).getByRole('img', { name: /^候选 \d$/ })).toHaveCount(1, { timeout: 60_000 });
  await canvas(page).getByRole('button', { name: '补齐这一张' }).click();
  await expect(canvas(page).getByRole('img', { name: /^候选 \d$/ })).toHaveCount(2, { timeout: 60_000 });
});

test('白底路线：操作员切到 A，做白底图、对照后选用，才能确认资产', async ({ page }) => {
  await startWork(page, '你好');
  await canvas(page).getByRole('button', { name: 'A 白底' }).click();
  await expect(canvas(page).getByRole('button', { name: '确认资产' })).toBeDisabled();
  // 小间也能做白底（make_white_asset），做好后不会替用户选
  await say(page, '帮我做个白底【测试：白底】');
  await expect(chat(page).getByText(/已开始做白底图/)).toBeVisible();
  await expect(canvas(page).getByRole('button', { name: '用这张', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(canvas(page).getByRole('button', { name: '确认资产' })).toBeDisabled();
  await canvas(page).getByRole('button', { name: '对照原图查看白底图' }).click();
  await expect(page.getByRole('dialog', { name: '对照白底图' })).toBeVisible();
  await page.keyboard.press('Escape');
  await canvas(page).getByRole('button', { name: '用这张', exact: true }).click();
  await canvas(page).getByRole('button', { name: '确认资产' }).click();
  await expect(step(page, '资产')).toHaveAccessibleName(/完成/);
});

test('替换原图：确认后换上新照片，原图记录保留，资产要重新确认', async ({ page }) => {
  await startWork(page, '你好');
  await canvas(page).getByRole('button', { name: '确认资产' }).click();
  await step(page, '资产').click();
  const chooser = page.waitForEvent('filechooser');
  await canvas(page).getByRole('button', { name: '替换这张照片' }).click();
  await (await chooser).setFiles({ name: 'new.jpg', mimeType: 'image/jpeg', buffer: await testPhoto(page) });
  await page.getByRole('dialog', { name: '替换这张照片？' }).getByRole('button', { name: '替换' }).click();
  await expect(step(page, '资产')).toHaveAccessibleName(/当前/);
  const stored = await page.evaluate(async () => {
    const req = indexedDB.open('yijian');
    const db = await new Promise<IDBDatabase>((r) => (req.onsuccess = () => r(req.result)));
    const all = await new Promise<{ removed: boolean; replacedBy?: string; origin: string }[]>((r) => {
      const q = db.transaction('assets').objectStore('assets').getAll();
      q.onsuccess = () => r(q.result);
    });
    db.close();
    return all.map((a) => ({ removed: a.removed, replaced: !!a.replacedBy }));
  });
  expect(stored).toEqual(expect.arrayContaining([{ removed: true, replaced: true }, { removed: false, replaced: false }]));
  await expect(canvas(page).getByRole('img', { name: '整体照片' })).toHaveCount(1);
});

/* 2026-11-03 浏览器实测 badcase 的回归（badcase/修复记录/2026-11-03-修复状态.md） */

test('回归 BC-010：开始一件后点「新建作品」，首页是空白的，能接着开始下一件', async ({ page }) => {
  await startWork(page, '第一件');
  const first = page.url();
  await page.getByRole('link', { name: '新建作品' }).click();
  await expect(page.getByRole('heading', { name: '今天想给哪件作品拍主图？' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '说说你的作品' })).toHaveValue('');
  await expect(page.getByRole('img', { name: '待上传的作品照片' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^雨后清晨/ })).toBeEnabled();
  await page.getByRole('textbox', { name: '说说你的作品' }).fill('第二件');
  await page.getByRole('button', { name: '开始' }).click();
  await page.waitForURL((u) => /\/works\/work_/.test(u.pathname) && u.href !== first);
  await expect(chat(page).getByText('第二件')).toBeVisible();
});

test('回归 UX-01：布景页「用这套开始」后返回，按钮能接着点，再开始下一件（2026-11-06）', async ({ page }) => {
  await page.goto('/scenes');
  const starts = page.getByRole('button', { name: '用这套开始' });
  await starts.first().click();
  await page.waitForURL(/\/works\/work_/);
  const first = page.url();
  await page.getByRole('link', { name: '摄影布景' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '摄影布景' })).toBeVisible();
  for (const b of await starts.all()) await expect(b).toBeEnabled();
  await starts.first().click();
  await page.waitForURL((u) => /\/works\/work_/.test(u.pathname) && u.href !== first);
});

test('回归 BC-002：逐条接受建议时画布停在信息，核心建议没处理完不算完成', async ({ page }) => {
  await startWork(page, '【测试：完整信息】');
  await canvas(page).getByRole('button', { name: '确认资产' }).click(); // 画布跟着当前该做的一步，到信息
  // 先接受品类、材料、尺寸：必填齐了，画布仍在信息（看得到接受后的尺寸），「不能改的细节」还是建议
  for (let i = 0; i < 3; i++) await canvas(page).getByRole('button', { name: '接受' }).first().click();
  await expect(canvas(page).locator('#info-size')).toHaveValue('长 3cm');
  await expect(canvas(page).getByText('有建议待确认')).toBeVisible();
  await expect(step(page, '信息')).not.toHaveAccessibleName(/完成/);
  // 接受保真细节：这一步完成，但售价的建议还在，画布不跳走
  await canvas(page).getByRole('button', { name: '接受' }).first().click();
  await expect(canvas(page).locator('#info-keep')).toHaveValue('蝴蝶结的两个圈不能变形');
  await expect(step(page, '信息')).toHaveAccessibleName(/完成/);
  // 最后一条处理完，跟到当前该做的一步
  await canvas(page).getByRole('button', { name: '忽略' }).click();
  await expect(canvas(page).getByRole('heading', { name: '共创', exact: true })).toBeVisible();
});

test('回归 BC-012：矮窗口里对照原图也能看到整张图，不裁下沿', async ({ page }) => {
  await page.setViewportSize({ width: 1250, height: 579 });
  await startWork(page, '【测试：信息】');
  await canvas(page).getByRole('button', { name: '确认资产' }).click();
  await step(page, '信息').click();
  for (let i = 0; i < 3; i++) await canvas(page).getByRole('button', { name: '接受' }).first().click();
  await say(page, '【测试：总结】');
  await step(page, '共创').click();
  await canvas(page).getByRole('button', { name: '确认总结' }).click();
  await say(page, '【测试：布景】【测试：比例】【测试：提示词】'); // 3:4 的竖图最容易被裁
  await step(page, '方案').click();
  await approveBy(canvas(page).getByRole('slider', { name: /滑动批准并生成两张/ }));
  await expect(canvas(page).getByRole('img', { name: '候选 2' })).toBeVisible({ timeout: 60_000 });
  const fits = async (img: Locator, name: string) => {
    await expect(img).toBeVisible();
    const box = (await img.boundingBox())!;
    const frame = (await img.locator('..').boundingBox())!;
    expect(box.height, name).toBeLessThanOrEqual(frame.height + 1);
    expect(box.width, name).toBeLessThanOrEqual(frame.width + 1);
  };
  await canvas(page).getByRole('button', { name: '对照原图' }).first().click();
  const dialog = page.getByRole('dialog', { name: /对照原图/ });
  for (const name of ['原图', '候选 1']) await fits(dialog.getByRole('img', { name, exact: true }), name);
  await page.keyboard.press('Escape');
  // 两版对比：框有 420px 的高度上限，竖图同样不能被裁
  for (let i = 0; i < 2; i++) await canvas(page).getByRole('button', { name: '加入对比' }).first().click(); // 点过的变成「取消对比」
  const compare = canvas(page).getByRole('heading', { name: '两版对比' }).locator('xpath=ancestor::section[1]');
  await fits(compare.getByRole('img', { name: '第 1 轮候选 1' }), '两版对比');
});

test('回归 BC-001：回复只有思考、没写完时如实提示，可以重试，重试有上限', async ({ page }) => {
  await startWork(page, '你好');
  await say(page, '继续【测试：只想不说】');
  const alert = chat(page).getByRole('alert');
  await expect(alert).toContainText('小间这次的回复超出了单次长度上限，没说完。');
  await chat(page).getByRole('button', { name: '重试' }).click();
  await chat(page).getByRole('button', { name: '重试' }).click();
  await expect(alert).toContainText('已经重试 2 次');
  await say(page, '你好');
  await expect(alert).toHaveCount(0);
});

// 准备到方案这一步：确认资产（之前可以先做 beforeAssets，比如再加照片）、接受三条信息建议、确认总结
async function readyForPlan(page: Page, first: string, beforeAssets?: () => Promise<void>) {
  await startWork(page, first);
  await beforeAssets?.();
  await canvas(page).getByRole('button', { name: '确认资产' }).click();
  await step(page, '信息').click();
  for (let i = 0; i < 3; i++) await canvas(page).getByRole('button', { name: '接受' }).first().click();
  await say(page, '灵感是雨后的石阶【测试：总结】');
  await step(page, '共创').click();
  await canvas(page).getByRole('button', { name: '确认总结' }).click();
}

// 再套布景、写提示词、放出批准卡片
async function readyToApprove(page: Page, first: string, beforeAssets?: () => Promise<void>) {
  await readyForPlan(page, first, beforeAssets);
  await say(page, '就用雨后那套【测试：布景】【测试：提示词】【测试：批准】');
  return approvalCard(page);
}

test('回归 BC-006：从一张结果修改时，生成带上那张结果作房间参考', async ({ page }, info) => {
  const shot = (name: string) => page.screenshot({ path: info.outputPath(`${name}.png`) });
  const sent: number[] = []; // 每次提交生图时带了几张参考图
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/images') sent.push(JSON.parse(r.postData()!).images.length);
  });
  const card = await readyToApprove(page, '这是我做的耳坠【测试：信息】');
  await approveBy(card.getByRole('slider', { name: /滑动批准并生成两张/ }));
  await expect.poll(() => sent, { timeout: 60_000 }).toEqual([1, 1]);
  await expect(canvas(page).getByRole('img', { name: /^候选 2$/ })).toBeVisible({ timeout: 60_000 });

  // 从候选 1 修改：方案和批准卡片都写明沿用它的房间（文字没对上也接着走，看第 2 轮实际带了几张图）
  await say(page, '第一张链子变长了【测试：意见】');
  await step(page, '方案').click();
  await expect.soft(canvas(page).getByText(/生成时会带上这张图，沿用它的房间和机位/)).toBeVisible();
  await expect.soft(canvas(page).getByText('沿用第 1 轮候选 1 的房间')).toBeVisible();
  await canvas(page).getByRole('heading', { name: '可读方案' }).scrollIntoViewIfNeeded();
  await shot('after-BC-006-revise-plan');
  await say(page, '换成竖图【测试：比例】【测试：提示词】【测试：批准】'); // 改了方案，批准卡片才会重新放出
  const again = approvalCard(page);
  await expect.soft(again.getByText('沿用第 1 轮候选 1 的房间')).toBeVisible();
  await again.getByRole('slider', { name: /滑动批准并生成两张/ }).scrollIntoViewIfNeeded();
  await shot('after-BC-006-approval-card');
  await approveBy(again.getByRole('slider', { name: /滑动批准并生成两张/ }));
  await expect(canvas(page).getByRole('heading', { name: '第 2 轮' })).toBeVisible();
  await expect.poll(() => sent, { timeout: 60_000 }).toEqual([1, 1, 2, 2]); // 第 2 轮：商品照片＋被修改的那张结果
});

test('回归 BC-013：小间标「你说的」要有用户原话，找不到原话的记为小间推荐', async ({ page }, info) => {
  await startWork(page, '想要安静一点的感觉【测试：误标你说的】');
  await say(page, '耳饰平铺在石台上【测试：说过平铺】');
  await step(page, '方案').click();
  const row = (key: string) => canvas(page).locator('div.grid', { has: page.locator(`label[for="style-${key}"]`) });
  await expect(row('tone').getByText('小间推荐')).toBeVisible(); // 用户没说过「冷灰」
  await expect(row('tone').getByText('你说的')).toHaveCount(0);
  await expect(row('placement').getByText('你说的')).toBeVisible();
  await expect(row('placement').getByText('原话：「平铺」')).toBeVisible();
  await row('tone').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('after-BC-013-style-source.png') });
});

test('批准前提醒：提示词写好后小间又提了核心信息建议，提醒但不挡批准（2026-11-06）', async ({ page }, info) => {
  await readyToApprove(page, '这是我做的耳坠【测试：信息】');
  // 提示词写好以后用户又补了一处细节：小间写成建议，没接受的不会用于生成（建议没处理时写不了提示词，见回归 UX-02）
  await say(page, '蝴蝶结的两个圈不能变形【测试：纠正细节】【测试：批准】');
  const card = approvalCard(page);
  const reminder = '提醒：还有 1 条信息建议没处理：不能改的细节；没接受的不会用于生成';
  await expect(card.getByText(reminder)).toBeVisible();
  // 画布停在信息（还有建议没处理，BC-002），切到方案：提醒带「去信息」
  await step(page, '方案').click();
  await expect(canvas(page).getByText(reminder)).toBeVisible();
  await expect(canvas(page).getByRole('button', { name: '去信息' })).toBeVisible();
  // 已有的提示词还有效，但小间要等建议处理完才能改它（UX-02）
  await expect(canvas(page).getByText('还有 1 条信息建议没处理：不能改的细节，处理完小间才能改提示词。')).toBeVisible();
  await page.screenshot({ path: info.outputPath('after-approval-reminder.png') });
  await approveBy(card.getByRole('slider', { name: /滑动批准并生成两张/ }));
  await expect(canvas(page).getByRole('heading', { name: '第 1 轮' })).toBeVisible();
});

test('回归 UX-02：小间同一轮先写信息建议、再写提示词时不写；用户接受后再写，提示词不会过期（2026-11-06）', async ({ page }, info) => {
  await readyForPlan(page, '这是我做的耳坠【测试：信息】');
  // 用户纠正一处细节，小间同一轮写建议、接着写提示词（T03 的顺序）：提示词被挡下，说明原因
  await say(page, '两个圈不能变形【测试：布景】【测试：纠正细节】【测试：提示词】');
  await expect(chat(page).getByText('没写提示词：还有 1 条信息建议没处理：不能改的细节。请用户先在「信息」里接受或忽略', { exact: false })).toBeVisible();
  await step(page, '方案').click();
  await expect(canvas(page).getByText('还有 1 条信息建议没处理：不能改的细节，处理完小间才能写提示词。')).toBeVisible();
  await expect(canvas(page).getByRole('button', { name: '让小间写' })).toBeDisabled();
  await canvas(page).getByText('处理完小间才能写提示词').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('after-UX-02-wait-for-info.png') });
  // 接受之后再写：提示词有效，不用再点「我核对过，仍然适用」
  await step(page, '信息').click();
  await canvas(page).getByRole('button', { name: '接受' }).first().click();
  await step(page, '方案').click();
  await expect(canvas(page).getByRole('button', { name: '让小间写' })).toBeEnabled();
  await say(page, '处理好了【测试：提示词】');
  await expect(canvas(page).locator('.chip-ok', { hasText: '有效' })).toBeVisible();
  await expect(canvas(page).getByRole('button', { name: '我核对过，仍然适用' })).toHaveCount(0);
});

test('回归 UX-05：对照原图能切换整体、细节照，两边都能在新标签页打开原尺寸（2026-11-06）', async ({ page }, info) => {
  const addPhoto = async (name: string) =>
    canvas(page).locator('input[type="file"][multiple]').setInputFiles({ name, mimeType: 'image/jpeg', buffer: await testPhoto(page) });
  const card = await readyToApprove(page, '这是我做的耳坠【测试：信息】', async () => {
    await addPhoto('detail.jpg'); // 已有整体照时，再加的记为细节
    await expect(canvas(page).getByRole('img', { name: '细节照片' })).toBeVisible();
  });
  await approveBy(card.getByRole('slider', { name: /滑动批准并生成两张/ }));
  await expect(canvas(page).getByRole('img', { name: /^候选 1$/ })).toBeVisible({ timeout: 60_000 });
  // 生成之后又加一张细节：对照时也能看，标明这一轮没用
  await step(page, '资产').click();
  await addPhoto('detail-2.jpg');
  await expect(canvas(page).getByRole('img', { name: '细节照片' })).toHaveCount(2);
  await step(page, '出图').click();

  await canvas(page).getByRole('button', { name: '对照原图' }).first().click();
  const dialog = page.getByRole('dialog', { name: '对照原图：第 1 轮候选 1' });
  const photos = dialog.getByRole('group', { name: '对照哪张商品照片' });
  await expect(photos.getByRole('button')).toHaveText(['整体', '细节 1', '细节 2']);
  await expect(photos.getByRole('button', { name: '整体' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText('生成时用的参考图：整体')).toBeVisible();
  const original = dialog.getByRole('img', { name: '原图', exact: true });
  const first = await original.getAttribute('src');
  await photos.getByRole('button', { name: '细节 1' }).click();
  await expect(dialog.getByText('生成时用的参考图：细节 1')).toBeVisible();
  await expect(original).not.toHaveAttribute('src', first!);
  await photos.getByRole('button', { name: '细节 2' }).click();
  await expect(dialog.getByText('原图，这一轮没用：细节 2')).toBeVisible();

  // 原尺寸：两边各一个链接，在新标签页打开图片本身
  const refLink = dialog.getByRole('link', { name: /^看原尺寸：原图细节 2，\d+×\d+$/ });
  const candLink = dialog.getByRole('link', { name: /^看原尺寸：候选 1，\d+×\d+$/ });
  await expect(refLink).toBeVisible();
  await expect.poll(() => original.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true); // 本地图片异步读出，等它显示出来再截图
  await expect(photos.getByRole('button', { name: '细节 2' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('after-UX-05-compare-switch.png'), animations: 'disabled' }); // 描边有过渡动画，截图时让它先走完
  for (const link of [refLink, candLink]) {
    await expect(link).toHaveAttribute('target', '_blank');
    const popup = page.waitForEvent('popup');
    await link.click();
    const tab = await popup;
    await tab.waitForLoadState();
    expect(tab.url()).toMatch(/^blob:/);
    await tab.close();
  }
});

test('回归：鼠标停在已选中的选项胶囊上，选中的黑描边不被悬停样式盖掉（2026-11-06）', async ({ page }, info) => {
  await startWork(page, '这是我做的耳坠');
  await step(page, '方案').click();
  const flat = canvas(page).getByRole('button', { name: '平铺', exact: true });
  await flat.click(); // 点完鼠标还停在上面，原来这时看起来像没选中
  await expect(flat).toHaveAttribute('aria-pressed', 'true');
  await flat.hover();
  const row = canvas(page).locator('div.grid', { has: page.locator('label[for="style-placement"]') });
  await row.screenshot({ path: info.outputPath('after-choice-hover.png'), animations: 'disabled' });
  await expect(flat).toHaveCSS('box-shadow', /1\.5px inset/);
  // 没选中的项悬停照常有反馈
  const hang = canvas(page).getByRole('button', { name: '悬挂', exact: true });
  await hang.hover();
  await expect(hang).toHaveCSS('box-shadow', /rgba\(0, 0, 0, 0\.22\) 0px 0px 0px 1px inset/);
});
