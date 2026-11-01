import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* 全流程（技术写法第 9 节）：假对话模型按「【测试：xxx】」标记调用工具，假生图网关出测试图，不调用模型、不花钱。
   覆盖：首页 → 上传 → 信息建议 → 共创总结 → 布景与提示词 → 批准卡片 → 生成两张 → 验收 → 意见与从这张修改
   → 导出 → 存布景、我的风格提议 → 方向卡片 → 后续需求 → 两版对比 → 试用记录导出；以及硬规则：没有批准时小间不能生成。 */

// 在浏览器里画一张测试图（不用第三方照片）
async function testPhoto(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
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
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

const chat = (page: Page) => page.getByRole('region', { name: '和小间对话' });
const canvas = (page: Page) => page.getByRole('region', { name: '画布' });
const step = (page: Page, name: string) => page.getByRole('navigation', { name: '流程进度' }).getByRole('button', { name: new RegExp(`^${name}`) });

async function say(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '和小间说' });
  await box.fill(text);
  await box.press('Enter');
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 });
}

async function startWork(page: Page, text: string) {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({ name: 'test.jpg', mimeType: 'image/jpeg', buffer: await testPhoto(page) });
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
  const card = chat(page).getByText('确认这版方案').locator('xpath=ancestor::div[contains(@class,"rounded-[14px]")]');
  await card.getByRole('button', { name: '批准并生成两张' }).click();

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
  await canvas(page).getByRole('button', { name: '批准并生成两张' }).click();
  await expect(canvas(page).getByText(/没有生成出来/)).toBeVisible({ timeout: 60_000 });
  await expect(canvas(page).getByRole('img', { name: /候选/ })).toHaveCount(1, { timeout: 60_000 });
  await canvas(page).getByRole('button', { name: '补齐这一张' }).click();
  await expect(canvas(page).getByRole('img', { name: /候选/ })).toHaveCount(2, { timeout: 60_000 });
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
