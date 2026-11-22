import { expect, test, type Page } from '@playwright/test';

/* 全流程（技术写法第 9 节、13.11）：假对话模型按「【测试：xxx】」标记调用工具，假生图网关按任务类型出测试图
   （TEST VIEW／TEST BACKDROP／TEST IMAGE），不调用模型、不花钱。v0.6 两套流程：
   首页开始＝商品 → 信息 → 背景 → 摆放 → 出图；套用模板＝背景 → 商品 → 信息 → 摆放 → 出图。 */

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
const ANGLES = ['正面', '侧面', '背面'] as const;
const angle = (page: Page, name: string) => canvas(page).getByRole('group', { name });

async function say(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '和小间说' });
  await box.fill(text);
  await box.press('Enter');
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 });
}

// 从首页开始（流程一）：只说一句话
async function startHome(page: Page, text = '这是我做的耳坠') {
  await page.goto('/');
  await page.getByRole('textbox', { name: '说说你的作品' }).fill(text);
  await page.getByRole('button', { name: '开始' }).click();
  await page.waitForURL(/\/works\/work_/);
  await expect(page.getByText('测试模式 · 对话和图片都不是 AI')).toBeVisible();
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 });
}

// 在「商品」里把正面、侧面、背面三张照片传进各自的位置（点上传位，用文件选择框传）
async function uploadAngles(page: Page) {
  const buffer = await testPhoto(page);
  await step(page, '商品').click();
  for (const name of ANGLES) {
    const chooser = page.waitForEvent('filechooser');
    await angle(page, name).getByRole('button', { name: `上传${name}照片` }).click();
    await (await chooser).setFiles({ name: `${name}.jpg`, mimeType: 'image/jpeg', buffer });
    await expect(angle(page, name).getByRole('img', { name: `${name}照片` })).toBeVisible();
  }
}

// 对照确认一个角度的三视图（假网关几秒出图，查询间隔 6 秒）
async function confirmView(page: Page, name: string) {
  const open = angle(page, name).getByRole('button', { name: `对照${name}三视图` });
  await expect(open).toBeEnabled({ timeout: 60_000 });
  await open.click();
  const dialog = page.getByRole('dialog', { name: `对照${name}三视图` });
  await expect(dialog.getByRole('img', { name: `${name}原图` })).toBeVisible();
  await dialog.getByRole('button', { name: '可以用' }).click();
  await expect(dialog).toBeHidden();
  // 三张都确认后商品这一步完成，画布可能跟到当前该做的一步；回到「商品」再看
  if (!(await angle(page, name).isVisible())) await step(page, '商品').click();
  await expect(angle(page, name).getByText('已确认')).toBeVisible();
}

test.describe('商品：正面、侧面、背面和三视图（PRD FR-02、4.3）', () => {
  test('三张照片放进三个角度，生成三视图，逐张对照确认；不像的单独重做那一张', async ({ page }, info) => {
    await startHome(page);
    // 流程一：商品是第一步
    await expect(step(page, '商品')).toHaveAccessibleName(/当前/);
    // 缺照片时「生成三视图」不能点，写明缺哪张（AC-02.1）
    await expect(canvas(page).getByRole('button', { name: '生成三视图' })).toBeDisabled();
    await expect(canvas(page).getByText('还缺正面、侧面、背面照片，三张都有才能生成三视图')).toBeVisible();

    await uploadAngles(page);
    await expect(canvas(page).getByText('生成 3 张白底图（正面、侧面、背面），出来后逐张对照确认')).toBeVisible();
    await canvas(page).getByRole('button', { name: '生成三视图' }).click();
    for (const name of ANGLES) await confirmView(page, name);
    await expect(canvas(page).getByText('三视图 3/3 已确认')).toBeVisible();
    await expect(step(page, '商品')).toHaveAccessibleName(/完成/);
    await page.screenshot({ path: info.outputPath('product-confirmed.png') });

    // 不像的单独重做：新出的一张要重新确认，商品这一步回到没完成（AC-02.3）
    await angle(page, '侧面').getByRole('button', { name: '重做' }).click();
    await expect(angle(page, '侧面').getByText('重做中…')).toBeVisible();
    await expect(angle(page, '侧面').getByText('待确认')).toBeVisible({ timeout: 60_000 });
    await expect(canvas(page).getByText('三视图 2/3 已确认')).toBeVisible();
    await confirmView(page, '侧面');
    await expect(canvas(page).getByText('三视图 3/3 已确认')).toBeVisible();
  });

  test('小间只能提议生成三视图：缺照片时拒绝；卡片上点了才生成（PRD 4.2 第 1 条）', async ({ page }) => {
    await startHome(page);
    await say(page, '帮我生成三视图【测试：三视图】');
    await expect(chat(page).getByText('不能生成三视图：还缺正面、侧面、背面照片，三张都有才能生成三视图')).toBeVisible();

    await uploadAngles(page);
    await say(page, '照片都传好了【测试：三视图】');
    const card = chat(page).getByText('生成三视图？').locator('xpath=ancestor::div[contains(@class,"rounded-[14px]")]');
    await expect(card).toBeVisible();
    // 卡片放出来时还没有生成
    await expect(canvas(page).getByText('生成中')).toHaveCount(0);
    await card.getByRole('button', { name: '生成 3 张' }).click();
    await expect(chat(page).getByText('已开始生成三视图，出来后到「商品」里逐张对照确认')).toBeVisible();
    for (const name of ANGLES) await confirmView(page, name);
  });

  test('首页带过去的照片先放「未分类」，选了类型才进对应的角度；换进已有照片的角度，原来那张退回未分类', async ({ page }) => {
    const buffer = await testPhoto(page);
    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles({ name: 'test.jpg', mimeType: 'image/jpeg', buffer });
    await page.getByRole('textbox', { name: '说说你的作品' }).fill('这是我做的耳坠');
    await page.getByRole('button', { name: '开始' }).click();
    await page.waitForURL(/\/works\/work_/);
    await step(page, '商品').click();
    await expect(canvas(page).getByRole('img', { name: '未分类照片' })).toBeVisible();
    await canvas(page).getByRole('combobox', { name: '照片类型' }).click();
    await page.getByRole('option', { name: '正面' }).click();
    await expect(angle(page, '正面').getByRole('img', { name: '正面照片' })).toBeVisible();
    await expect(canvas(page).getByRole('img', { name: '未分类照片' })).toHaveCount(0);

    // 再传一张细节照，改成正面：原来的正面退回未分类
    const chooser = page.waitForEvent('filechooser');
    await canvas(page).getByRole('button', { name: '加细节照' }).click();
    await (await chooser).setFiles({ name: 'detail.jpg', mimeType: 'image/jpeg', buffer });
    await expect(canvas(page).getByRole('img', { name: '细节照片' })).toBeVisible();
    await canvas(page).getByRole('combobox', { name: '照片类型' }).click();
    await page.getByRole('option', { name: '正面' }).click();
    await expect(canvas(page).getByRole('img', { name: '未分类照片' })).toBeVisible();
    await expect(angle(page, '正面').getByRole('img', { name: '正面照片' })).toBeVisible();
  });
});
