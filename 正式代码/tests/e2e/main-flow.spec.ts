import { expect, test, type Locator, type Page } from '@playwright/test';

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

// 小间写的信息建议逐条接受（品类、材料、尺寸）
async function acceptInfo(page: Page) {
  await say(page, '是 925 银的耳饰，长 3 厘米【测试：信息】');
  await step(page, '信息').click();
  for (let i = 0; i < 3; i++) await canvas(page).getByRole('button', { name: '接受' }).first().click();
  await expect(step(page, '信息')).toHaveAccessibleName(/完成/);
}

// 自己生成背景：共创、背景风格、背景提示词、批准，生成两张后选第 1 张
async function generateBackdrop(page: Page) {
  await step(page, '背景').click();
  await canvas(page).getByRole('button', { name: '自己生成' }).click();
  await say(page, '灵感是雨后的石阶【测试：记录】【测试：总结】');
  await step(page, '背景').click();
  await expect(canvas(page).getByText('草稿，待确认')).toBeVisible();
  await canvas(page).getByRole('button', { name: '确认总结' }).click();
  await say(page, '就按你推荐的来【测试：背景风格】【测试：背景提示词】【测试：批准背景】');
  // 对话里的背景批准卡片：批准只能由用户滑
  const card = chat(page).getByText('确认这版背景方案').locator('xpath=ancestor::div[contains(@class,"rounded-[14px]")]');
  await approveBy(card.getByRole('slider', { name: /滑动批准并生成两张背景/ }));
  await step(page, '背景').click();
  await expect(canvas(page).getByRole('heading', { name: '第 1 轮背景' })).toBeVisible();
  const pick = canvas(page).getByRole('button', { name: '用这张' }).first();
  await expect(pick).toBeVisible({ timeout: 60_000 });
  await expect(canvas(page).getByRole('button', { name: '用这张' })).toHaveCount(2, { timeout: 60_000 });
  await pick.click();
  await expect(canvas(page).getByRole('button', { name: '已选定' })).toBeVisible();
}

test.describe('背景与模板库（PRD FR-04、FR-06，技术写法 13.4）', () => {
  test('自己生成背景：共创 → 背景风格 → 批准 → 两张选一张 → 沉淀进模板库；模板库里改名、删除，删掉后已经用了它的作品照常可用', async ({ page }, info) => {
    await startHome(page);
    await acceptInfo(page);
    // 硬规则：背景没批准时小间不能生成（PRD 4.2 第 1 条）
    await step(page, '背景').click();
    await canvas(page).getByRole('button', { name: '自己生成' }).click();
    await say(page, '直接生成背景吧【测试：生成背景】');
    await expect(chat(page).getByText('不能生成背景：背景方案还没批准')).toBeVisible();

    await generateBackdrop(page);
    await expect(canvas(page).getByRole('heading', { name: '背景', level: 2 })).toBeVisible();
    await expect(step(page, '背景')).toHaveAccessibleName(/完成/);
    // 选定后背景风格只读，以背景图为准；可以重新设计
    await expect(canvas(page).getByText('以选定的背景图为准；想改就重新设计背景')).toBeVisible();
    await expect(canvas(page).getByRole('button', { name: '重新设计背景' })).toBeVisible();
    await canvas(page).getByRole('textbox', { name: '背景图的名字' }).fill('苔绿晨光');
    await canvas(page).getByRole('button', { name: '沉淀进模板库' }).click();
    await expect(canvas(page).getByText('已沉淀进模板库「苔绿晨光」')).toBeVisible();
    await page.screenshot({ path: info.outputPath('backdrop-picked.png') });
    const workUrl = page.url();

    // 模板库：沉淀的背景图带参数、来源，可以改名、删除（AC-06.1、AC-06.4）
    await page.goto('/templates');
    const name = page.getByRole('textbox', { name: '背景图的名字' });
    await expect(name).toHaveValue('苔绿晨光');
    await expect(page.getByText('出自「未命名作品」')).toBeVisible();
    await expect(page.getByText('清冷晨光')).toBeVisible();
    await name.fill('苔绿晨光 2');
    await name.press('Enter');
    await expect(name).toHaveValue('苔绿晨光 2');
    await page.screenshot({ path: info.outputPath('templates.png') });
    await page.getByRole('button', { name: '删除背景图「苔绿晨光 2」' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '删除' }).click();
    await expect(page.getByRole('heading', { name: '我沉淀的' })).toHaveCount(0);

    await page.goto(workUrl);
    await step(page, '背景').click();
    await expect(canvas(page).getByText('已从模板库删除')).toBeVisible();
    await expect(step(page, '背景')).toHaveAccessibleName(/完成/);
  });

  test('套用模板进来是流程二；改成自己生成背景时切到流程一，选的模板清掉', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '套用「雨后清晨」' }).click();
    await page.waitForURL(/\/works\/work_/);
    const order = page.getByRole('navigation', { name: '流程进度' }).getByRole('button');
    await expect(order.first()).toHaveAccessibleName(/^背景/);
    await expect(step(page, '背景')).toHaveAccessibleName(/完成/);
    await step(page, '背景').click();
    await canvas(page).getByRole('button', { name: '自己生成' }).click();
    const dialog = page.getByRole('dialog', { name: '改成自己生成背景？' });
    await dialog.getByRole('button', { name: '改成自己生成' }).click();
    await expect(order.first()).toHaveAccessibleName(/^商品/);
    await expect(step(page, '背景')).not.toHaveAccessibleName(/完成/);
    await expect(canvas(page).getByRole('heading', { name: '背景共创' })).toBeVisible();
  });

  test('小间只能选模板库里的背景图（use_backdrop）', async ({ page }) => {
    await startHome(page);
    await say(page, '用雨后那张背景吧【测试：用模板】');
    await expect(chat(page).getByText('已选用模板库里的背景图「雨后清晨」（内置模板，暂无参数）')).toBeVisible();
    await step(page, '背景').click();
    await expect(canvas(page).getByRole('button', { name: '用模板库里的' })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas(page).getByText('示意模板，无参数').first()).toBeVisible();
  });
});

// 流程一走到摆放：三视图都确认、信息接受、背景用内置模板
async function readyForPlacement(page: Page) {
  await startHome(page);
  await uploadAngles(page);
  await canvas(page).getByRole('button', { name: '生成三视图' }).click();
  for (const name of ANGLES) await confirmView(page, name);
  await acceptInfo(page);
  await say(page, '用雨后那张背景吧【测试：用模板】');
  await expect(step(page, '背景')).toHaveAccessibleName(/完成/);
}

const candidate = (page: Page, round: number, n: number) => canvas(page).getByRole('group', { name: `第 ${round} 轮候选 ${n}` });

test.describe('摆放与合成（PRD FR-07—FR-10，技术写法 13.5）', () => {
  test('流程一主线：摆放 → 批准 → 背景图＋三视图合成两张 → 验收 → 导出（提醒声明 AI 生成）→ 对照原图 → 两版对比 → 从这一版修改', async ({ page }, info) => {
    await readyForPlacement(page);
    // 硬规则：没有批准时小间不能生成（PRD 4.2 第 1 条）
    await say(page, '直接生成吧【测试：生成】');
    await expect(chat(page).getByText('不能生成：方案还没批准')).toBeVisible();

    await say(page, '平铺就好【测试：摆放】【测试：提示词】【测试：批准】');
    await step(page, '摆放').click();
    // 合成方案写明所用的背景图
    await expect(canvas(page).getByText('背景「雨后清晨」＋三视图')).toBeVisible();
    const card = chat(page).getByText('确认这版方案').locator('xpath=ancestor::div[contains(@class,"rounded-[14px]")]');
    await approveBy(card.getByRole('slider', { name: /滑动批准并生成两张/ }));

    await expect(canvas(page).getByRole('heading', { name: '第 1 轮' })).toBeVisible();
    await expect(canvas(page).getByText(/背景「雨后清晨」/).first()).toBeVisible();
    await expect(canvas(page).getByRole('img', { name: '候选 1' })).toBeVisible({ timeout: 60_000 });
    await expect(canvas(page).getByRole('img', { name: '候选 2' })).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: info.outputPath('result.png') });

    // 验收：候选 2 两项满意，候选 1 不像
    const c1 = candidate(page, 1, 1);
    const c2 = candidate(page, 1, 2);
    await c2.getByRole('button', { name: '像', exact: true }).click();
    await c2.getByRole('button', { name: '对', exact: true }).click();
    await expect(page.getByText('已完成')).toBeVisible();
    await expect(c2.getByText('这是 AI 生成的图，发布时请按平台要求声明')).toBeVisible();

    // 导出卡片（两项满意才能下载），卡片上也提醒（PRD AC-10.5）
    await say(page, '把第二张给我【测试：导出】');
    const download = page.waitForEvent('download');
    await chat(page).getByRole('button', { name: '下载' }).click();
    expect((await download).suggestedFilename()).toMatch(/第1轮-候选2\.(jpg|png)$/);
    await expect(chat(page).getByText('这是 AI 生成的图，发布时请按平台要求声明')).toBeVisible();

    // 对照原图（不是三视图），可以切换正面、侧面、背面（AC-09.1、AC-09.1a）
    await step(page, '出图').click();
    await c1.getByRole('button', { name: '不像' }).click();
    await c1.getByRole('button', { name: '对照原图' }).click();
    const cmp = page.getByRole('dialog', { name: '对照原图：第 1 轮候选 1' });
    await cmp.getByRole('button', { name: '侧面' }).click();
    await expect(cmp.getByText('原图：侧面')).toBeVisible();
    await page.keyboard.press('Escape');

    // 两版对比（AC-09.5）
    await c1.getByRole('button', { name: '加入对比' }).click();
    await c2.getByRole('button', { name: '加入对比' }).click();
    await expect(canvas(page).getByRole('heading', { name: '两版对比' })).toBeVisible();
    await expect(canvas(page).getByText('两张来自同一版方案')).toBeVisible();
    await canvas(page).getByRole('button', { name: '关闭对比' }).click();

    // 从这一版修改（AC-09.4）：回到摆放，原结果保留
    await c1.getByRole('button', { name: '从这一版修改' }).click();
    await expect(canvas(page).getByRole('heading', { name: '摆放', level: 2 })).toBeVisible();
    await expect(canvas(page).getByText(/正在修改第 1 轮候选 1/)).toBeVisible();
  });

  test('部分失败：成功的那张保留，失败的可以补齐（AC-08.5）', async ({ page }) => {
    await readyForPlacement(page);
    await say(page, '平铺就好【测试：摆放】【测试：提示词】');
    await step(page, '摆放').click();
    // 用户手改合成提示词（带上假网关的失败标记），自己核对后批准
    const prompt = canvas(page).getByRole('textbox', { name: '完整合成提示词' });
    await prompt.click();
    await prompt.press('End');
    await page.keyboard.type('【测试：失败一张】');
    await page.keyboard.press('Tab');
    await expect(canvas(page).getByText('已手动修改')).toBeVisible();
    await canvas(page).getByRole('button', { name: '我已核对，两者一致' }).click();
    await approveBy(canvas(page).getByRole('slider', { name: /滑动批准并生成两张/ }));

    await expect(canvas(page).getByText(/候选 \d 没有生成出来：/)).toBeVisible({ timeout: 60_000 });
    await expect(canvas(page).getByRole('img', { name: /^候选 \d$/ })).toHaveCount(1, { timeout: 60_000 });
    await canvas(page).getByRole('button', { name: '补齐这一张' }).click();
    await expect(canvas(page).getByRole('img', { name: /^候选 \d$/ })).toHaveCount(2, { timeout: 60_000 });
  });
});
