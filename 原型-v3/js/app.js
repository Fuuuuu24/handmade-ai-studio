/* 一间 v3 原型：AI 对话为主、流程退到次要位置的布局原型。
   小间的回复是固定演示剧本，未接大模型；对话里的卡片可以点，点了推进剧本。图片为本地演示图。数据不保存，刷新即清空。
   用户内容统一经 esc() 转义。 */
'use strict';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 1. 常量：步骤、布景模版、剧本内容 ---------- */
const STEPS = [
  { id: 'asset', name: '资产' },
  { id: 'info', name: '信息' },
  { id: 'story', name: '共创' },
  { id: 'plan', name: '方案' },
  { id: 'output', name: '出图' },
];

// 摄影布景模版：首页卡片和方案卡片共用
const SCENES = [
  { id: 'moss', name: '雨后清晨', desc: '苔绿手工纸，清冷晨光', colors: ['#dfe4d5', '#b9c4a6', '#7e8f6c'], tone: '雨后苔绿', background: '手工纸', light: '清冷晨光', placement: '平铺', props: '一小片苔藓', composition: '主体偏一侧，留出呼吸感' },
  { id: 'cream', name: '午后书桌', desc: '米白亚麻，暖调午后光', colors: ['#f3ede2', '#e6dac6', '#c9b79a'], tone: '奶油米白', background: '亚麻布', light: '暖调午后光', placement: '平铺', props: '一本旧书的一角', composition: '主体居中，留白多' },
  { id: 'stone', name: '干净陈列', desc: '浅灰石材，柔和自然光', colors: ['#ecebe8', '#d5d3ce', '#a8a49d'], tone: '石灰浅灰', background: '石材', light: '柔和自然光', placement: '支架', props: '无', composition: '主体放大，突出细节' },
  { id: 'rose', name: '温柔礼物', desc: '灰粉手工纸，柔光', colors: ['#efe3e1', '#ddc5c1', '#b8928c'], tone: '干燥玫瑰', background: '手工纸', light: '柔和自然光', placement: '悬挂', props: '一段丝带', composition: '主体居中，留白多' },
];
const sceneOf = id => SCENES.find(s => s.id === id) || SCENES[0];
const PLAN_ROWS = [['tone', '色调'], ['background', '背景'], ['light', '光线'], ['placement', '摆放'], ['props', '道具'], ['composition', '构图']];

const RATIOS = { '1:1': [1000, 1000], '3:4': [900, 1200], '9:16': [720, 1280] };

const INFO_FIELDS = [
  { id: 'category', name: '品类' },
  { id: 'material', name: '材料' },
  { id: 'size', name: '尺寸', placeholder: '比如 长 4.5cm、宽 2cm' },
  { id: 'keep', name: '不能改的细节' },
];

// 共创：快捷回答、「我不知道」时的推荐方向、三句话总结（都是写死的示例）；每条总结配一套布景，确认总结时按它推荐
const STORY_QUICK = '雨后散步，看到石阶上的青苔';
const STORY_PICKS = [
  { title: '自然里的小发现', text: '灵感来自散步时看到的植物和光', sum: 0 },
  { title: '送给自己的温柔', text: '想让戴的人觉得被好好对待', sum: 1 },
  { title: '干净利落的日常', text: '每天都能戴，不挑衣服', sum: 2 },
];
const STORY_SUMS = [
  { express: '雨后石阶上的一小片青苔，安静、湿润的绿', feel: '安静、自然，想凑近看细节', avoid: '太亮太花，道具抢了耳环', scene: 'moss' },
  { express: '一件温柔的小礼物，给自己或重要的人', feel: '被好好对待，柔软不张扬', avoid: '冷冰冰的影棚感', scene: 'rose' },
  { express: '每天都能戴的小东西，干净利落', feel: '清爽、可信，做工看得清', avoid: '杂乱的背景和过度修饰', scene: 'stone' },
];
// 示例耳饰的商品信息：只在用示例图时预填并标「示例」；真实上传的照片演示版读不出信息，全部留给用户填
const SAMPLE_INFO = { category: '耳饰', material: '黄铜镀金、淡水珍珠、树脂', size: '', keep: '叶片上的叶脉纹；珍珠和叶片的连接方式' };

// 验收不过时的快捷说法，和把用户的话转成方案修改的关键词规则（演示用模版；接入大模型后由 AI 理解，规则外的说法如实说读不懂）
const FIX_QUICK = {
  real: ['颜色和实物不一样', '形状走样了', '细节看不清'],
  style: ['背景太暗了', '想要暖一点', '道具抢了耳环', '换个布景'],
};
const FIX_RULES = [
  { field: 'scene', re: /换(个|一套)?布景|换个背景|换一套/, say: '换一套布景', apply: w => { w.scene = SCENES[(SCENES.findIndex(s => s.id === w.scene) + 1) % SCENES.length].id; w.tweaks = {}; } },
  { field: 'light', re: /太暗|暗了|亮一点|明亮|提亮/, say: '光线调亮', apply: w => { w.tweaks.light = '明亮柔光'; w.tweaks.colors = ['#f7f6f2', '#ecebe6', '#cfcac0']; } },
  { field: 'light', re: /太亮|过曝|暗一点/, say: '光线压暗一些', apply: w => { w.tweaks.light = '柔和偏暗的侧光'; } },
  { field: 'tone', re: /暖|温馨/, say: '色调调暖', apply: w => { w.tweaks.tone = '暖调'; w.tweaks.colors = ['#f4e9da', '#e3cba8', '#c39a6b']; } },
  { field: 'tone', re: /冷|清爽/, say: '色调调冷', apply: w => { w.tweaks.tone = '冷调'; w.tweaks.colors = ['#e3e9ec', '#c4d0d6', '#8fa3ad']; } },
  { field: 'props', re: /道具|抢|太花|太乱|杂/, say: '去掉道具', apply: w => { w.tweaks.props = '无'; } },
  { field: 'composition', re: /看不清|细节|太小|大一点|放大/, say: '主体放大、突出细节', apply: w => { w.tweaks.composition = '主体放大，突出细节'; } },
  { field: 'composition', re: /太大|留白|小一点|挤/, say: '主体缩小、多留白', apply: w => { w.tweaks.composition = '主体居中，留白多'; } },
  { field: 'keep-color', re: /颜色|色差|偏色|发黄|发灰/, say: '在「不能改的细节」里加上「颜色以实物为准」', apply: w => addKeep(w, '颜色以实物为准，不要偏色') },
  { field: 'keep-shape', re: /形状|走样|变形|比例/, say: '在「不能改的细节」里加上「形状和比例与原图一致」', apply: w => addKeep(w, '形状和比例与原图一致') },
];
function addKeep(work, text) {
  if (work.info.keep.includes(text)) return;
  work.info.keep = work.info.keep ? `${work.info.keep}；${text}` : text;
  work.guessed.keep = false;
}

const SAMPLE_NAME = '雨后青苔 · 耳饰';
const SAMPLE_SRC = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SAMPLE_SVG)}`;
const UPLOAD = { types: ['image/jpeg', 'image/png', 'image/webp'], maxMB: 10 };

/* ---------- 2. 图标（沿用 v2 的线条图标） ---------- */
const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  home: '<path d="M4.5 10.5 12 4.5l7.5 6V19a1 1 0 0 1-1 1h-4v-5.5h-5V20h-4a1 1 0 0 1-1-1z"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.4a2.4 2.4 0 0 1 4.6.9c0 1.6-2.3 2-2.3 3.4"/><circle cx="12" cy="16.7" r=".9" fill="currentColor" stroke="none"/>',
  close: '<path d="M7 7l10 10M17 7 7 17"/>',
  send: '<path d="M12 18.5v-13M6.5 11 12 5.5l5.5 5.5"/>',
  check: '<path d="M5.5 12.5 10 17l8.5-9.5"/>',
  upload: '<path d="M12 15.5V5M7.5 9.5 12 5l4.5 4.5"/><path d="M5 14.5v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4.5V15M7.5 10.5 12 15l4.5-4.5"/><path d="M5 15.5v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5 16 11l-8.5 8"/>',
  works: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  style: '<path d="M12 3.5c-4.9 0-8.5 3.6-8.5 8.3 0 4.6 3.6 8.2 8.2 8.2 1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8h2c2.7 0 4.5-1.9 4.5-4.5 0-3.4-3.8-6-8.8-6z"/><circle cx="7.8" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.8" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="8.3" r="1" fill="currentColor" stroke="none"/>',
  history: '<path d="M3.5 12A8.5 8.5 0 1 0 6 6L3.5 8.5"/><path d="M3.5 4v4.5H8"/><path d="M12 7.5V12l3 2"/>',
  trash: '<path d="M5 7h14M10 4.5h4M7 7l.7 11a2 2 0 0 0 2 1.9h4.6a2 2 0 0 0 2-1.9L17 7"/>',
  back: '<path d="M14.5 6.5 9 12l5.5 5.5"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

/* ---------- 3. 状态 ---------- */
const state = { view: 'home', works: [], currentId: null, draftImage: null, focusNext: false };
const cur = () => state.works.find(w => w.id === state.currentId);

function createWork(sceneId) {
  const work = {
    id: uid(), name: '未命名作品', createdAt: Date.now(),
    stage: -1,            // -1 等照片；0–4 对应 STEPS
    view: null,           // 画布正在看的步骤；null 跟随当前步骤
    msgs: [], typing: false, generating: false,
    image: null, white: null,
    info: { category: '', material: '', size: '', keep: '' },
    guessed: {},          // 预填的示例值，标「示例」
    storyAnswered: false, storySum: 0,
    scene: sceneId || 'moss', fromTemplate: !!sceneId, templateScene: sceneId,
    tweaks: {},           // 按用户的话在布景上做的微调；换布景时清空
    ratio: '1:1', approved: false, openPrompt: false,
    round: 0,             // 第几次生成；每次生成两张，旧的保留
    results: [],          // { id, round, slot, ratio, scene, tweaks, src, at, v: { real, style } }
  };
  state.works.unshift(work);
  return work;
}
// 方案 = 布景模版 + 微调
const planOf = (sceneId, tweaks) => ({ ...sceneOf(sceneId), ...tweaks });
const planVal = (k, v) => (k === 'props' && v === '无' ? '不放道具' : v);
const TWEAK_NAMES = { tone: '色调', light: '光线', props: '道具', composition: '构图' };

/* ---------- 4. 图片：白底演示图、候选演示图（本地合成，不是 AI） ---------- */
const loadImage = src => new Promise((ok, fail) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => fail(new Error('图片载入失败'));
  img.src = src;
});

function stamp(ctx, w, h, text) {
  ctx.font = `${Math.round(w / 38)}px "SF Mono", Menlo, monospace`;
  ctx.fillStyle = 'rgba(0,0,0,.38)';
  ctx.textAlign = 'right';
  ctx.fillText(text, w - w / 30, h - w / 30);
}

function drawContain(ctx, img, w, h, scale, dx = 0, dy = 0) {
  const s = Math.min(w * scale / img.width, h * scale / img.height);
  const iw = img.width * s, ih = img.height * s;
  ctx.drawImage(img, (w - iw) / 2 + w * dx, (h - ih) / 2 + h * dy, iw, ih);
}

async function makeWhite(src) {
  const img = await loadImage(src);
  const canvas = Object.assign(document.createElement('canvas'), { width: 1000, height: 1000 });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1000, 1000);
  drawContain(ctx, img, 1000, 1000, .8);
  stamp(ctx, 1000, 1000, '演示 · 仅贴到白底，未抠图');
  return canvas.toDataURL('image/jpeg', .88);
}

// 按这张候选生成时锁定的方案合成，生成途中改方案不会影响它
async function makeCandidate(image, r) {
  const { slot } = r;
  const [w, h] = RATIOS[r.ratio];
  const scene = planOf(r.scene, r.tweaks);
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, w * (slot === 'A' ? .3 : .8), h);
  bg.addColorStop(0, scene.colors[0]); bg.addColorStop(1, scene.colors[1]);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * .2, 0, 0, w * .2, 0, Math.max(w, h));
  glow.addColorStop(0, 'rgba(255,255,255,.4)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  const img = await loadImage(image);
  const big = scene.composition.includes('放大'), side = scene.composition.includes('一侧');
  ctx.globalCompositeOperation = 'multiply';
  drawContain(ctx, img, w, h, big ? .9 : side ? .7 : .62, side ? (slot === 'A' ? -.12 : .12) : (slot === 'A' ? -.03 : .03), slot === 'A' ? -.02 : .02);
  ctx.globalCompositeOperation = 'source-over';
  stamp(ctx, w, h, `演示 · 非 AI 生成 · ${slot}`);
  return canvas.toDataURL('image/jpeg', .88);
}

function readFile(file) {
  if (!UPLOAD.types.includes(file.type)) return Promise.reject(new Error('只支持 JPG、PNG、WebP 图片'));
  if (file.size > UPLOAD.maxMB * 1024 * 1024) return Promise.reject(new Error(`图片不能超过 ${UPLOAD.maxMB}MB`));
  return new Promise((ok, fail) => {
    const reader = new FileReader();
    reader.onload = () => ok(reader.result);
    reader.onerror = () => fail(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

/* ---------- 5. 剧本：小间说话、各步推进 ---------- */
// 小间推进到新的一步时，画布跟着回到当前步骤
function setStage(work, n) { work.stage = n; work.view = null; renderTopbar(); }

function userSay(work, text, img) { work.msgs.push({ id: uid(), role: 'user', text, img }); }

async function botSay(work, text, card, data) {
  work.typing = true; renderWork(true);
  await wait(520);
  work.typing = false;
  const msg = { id: uid(), role: 'bot', text, card, data };
  work.msgs.push(msg);
  renderWork(true);
  announce(text);
  if (state.focusNext && cur() === work) {
    state.focusNext = false;
    ($(`[data-mid="${msg.id}"] button:not(:disabled)`) || $('#chat-text'))?.focus({ preventScroll: true });
  }
}
const idle = async work => { while (work.typing) await wait(80); };

async function startWork(text, image, sceneId) {
  const work = createWork(sceneId);
  if (text || image) userSay(work, text, image);
  state.view = 'work'; state.currentId = work.id; state.draftImage = null;
  renderAll();
  if (image) return gotPhoto(work, image);
  const lead = sceneId ? `好，用「${sceneOf(sceneId).name}」这套布景。` : '';
  await botSay(work, `${lead}先给我一张作品的整体照片吧，背景乱一点也没关系。`, 'need-photo');
}

async function gotPhoto(work, image) {
  let white;
  try { white = await makeWhite(image); } catch (error) {
    toast(`照片处理失败：${error.message}`);
    await botSay(work, `这张照片我没能读出来（${error.message}），换一张试试？`, work.image ? null : 'need-photo');
    return;
  }
  work.image = image; work.white = white;
  if (image === SAMPLE_SRC) {
    if (work.name === '未命名作品') work.name = SAMPLE_NAME;
    INFO_FIELDS.forEach(({ id }) => { if (!work.info[id] && SAMPLE_INFO[id]) { work.info[id] = SAMPLE_INFO[id]; work.guessed[id] = true; } });
  } else {
    // 换成真实照片：清掉还没被用户改过的示例值
    INFO_FIELDS.forEach(({ id }) => { if (work.guessed[id]) { work.info[id] = ''; work.guessed[id] = false; } });
  }
  setStage(work, 0);
  await botSay(work, '收到。我把它放到白底上做成商品图（演示：只是贴到白底上，没有抠图）。你看看颜色、形状有没有走样？', 'asset', { image, white });
}

// 已有照片时换图要先确认：之后的步骤要重新确认，已生成的候选保留
async function replacePhoto(work, src) {
  if (work.image) {
    const n = work.results.length;
    const ok = await askConfirm('换成这张照片？', `<p>商品图会换成新照片，信息、共创和方案要重新确认。${n ? `已生成的 ${n} 张候选会保留，在「出图」和历史结果里还能看到。` : ''}</p>`, '换照片');
    if (!ok || busy()) return;
  }
  userSay(work, '', src);
  work.approved = false; work.storyAnswered = false; work.fixing = null;
  await gotPhoto(work, src);
}

async function answerStory(work, text) {
  userSay(work, text);
  if (/不知道|说不(清|上来)|没想过|给我推荐|帮我推荐|你来推荐/.test(text)) {
    await botSay(work, '没关系，我先给你三个方向，挑一个最接近的，挑完我们再细调。', 'story-pick');
    return;
  }
  work.storyAnswered = true; work.storySum = 0;
  await botSay(work, '我把你说的整理成三句话，看看对不对：', 'story-sum', { sum: 0 });
}

async function showPlan(work, lead) {
  work.approved = false; setStage(work, 3);
  const s = sceneOf(work.scene);
  await botSay(work, lead || `按你的故事，我配了「${s.name}」这套布景，理由写在下面。不合适就换一套，或者在右边画布里直接改。`, 'plan', { scene: work.scene, tweaks: { ...work.tweaks } });
}

// 批准之后再改商品信息、布景或比例：批准失效，退回方案步骤重新确认（已生成的候选保留）
async function invalidate(work, reason) {
  await idle(work);
  if (!work.approved) { renderWork(); return; }
  await showPlan(work, `${reason}，刚才批准的方案已经失效。我按新的内容更新了方案，再确认一次；之前生成的候选会保留：`);
}

async function generate(work) {
  const plan = { ratio: work.ratio, scene: work.scene, tweaks: { ...work.tweaks } };
  work.approved = true; work.generating = true; work.fixing = null; work.round += 1;
  const round = work.round;
  const fresh = ['A', 'B'].map(slot => ({ id: uid(), round, slot, src: null, at: Date.now(), v: {}, ...plan }));
  work.results.push(...fresh);
  setStage(work, 4);
  try {
    await botSay(work, `好，按这版方案生成两张 ${plan.ratio} 候选。（演示：本地合成，不是 AI 生成）`, 'gen', { round });
    for (const r of fresh) { r.src = await makeCandidate(work.image, r); renderWork(); await wait(300); }
  } catch (error) {
    work.results = work.results.filter(r => r.round !== round); work.round -= 1;
    work.generating = false;
    toast(`候选图生成失败：${error.message}`);
    await showPlan(work, `生成失败了（${error.message}）。方案没变，再批准一次就会重试：`);
    return;
  }
  work.generating = false;
  await botSay(work, '两张都好了。每张看两件事：像不像实物、风格对不对，两项都过才算完成。哪项不过，点「不像」或「不对」，告诉我哪里不对。');
}

// 验收不过：小间问哪里不对；用户的话用关键词规则转成方案修改（演示），改完重新批准
async function askFix(work, r, kind) {
  work.fixing = { kind };
  await botSay(work, kind === 'real' ? `候选 ${r.slot} 哪里不像实物？说说看，我按你说的改方案。` : `候选 ${r.slot} 的风格哪里不对？说说看，我按你说的改方案。`, 'fix', { kind });
}

function applyFix(work, text) {
  const hits = FIX_RULES.filter(rule => rule.re.test(text));
  const done = new Set(), said = [];
  for (const rule of hits) {
    if (done.has(rule.field)) continue;
    done.add(rule.field); rule.apply(work); said.push(rule.say);
  }
  return said;
}

async function fixFromText(work, text) {
  userSay(work, text);
  const said = applyFix(work, text);
  if (!said.length) {
    await botSay(work, '这句演示版没读懂。现在只认得几类常见说法：明暗、冷暖、道具、构图、换布景、颜色或形状不像；可以换个说法再说一次。接入大模型后，小间才能理解任意说法。');
    return;
  }
  work.fixing = null;
  await showPlan(work, `我理解成：${said.join('、')}。（演示：用关键词规则理解，接入大模型后由 AI 理解）方案改好了，确认后重新生成两张，上一版保留：`);
}

const promptText = work => {
  const s = planOf(work.scene, work.tweaks), i = work.info;
  return `电商商品主图，${work.ratio}，单件饰品静物，画面无文字。\n商品：${i.category || '未知'}；材料：${i.material || '未知'}；尺寸：${i.size || '未知'}。\n不能改的细节：${i.keep || '未知'}。\n画面：${s.tone}色调，${s.background}背景，${s.light}，${s.placement}，道具：${s.props}，${s.composition}。`;
};

/* ---------- 6. 渲染：图标栏、顶栏（沿用 v2） ---------- */
const NAV = [
  { view: 'home', icon: 'home', name: '首页' },
  { view: 'works', icon: 'works', name: '作品' },
  { view: 'style', icon: 'style', name: '我的风格' },
  { view: 'scenes', icon: 'image', name: '摄影布景' },
  { view: 'history', icon: 'history', name: '历史结果' },
];
const activeNav = () => (state.view === 'work' ? 'works' : state.view);

function renderNav() {
  $('#side-nav').innerHTML = NAV.map(n => {
    const on = activeNav() === n.view;
    return `<button class="rail-item ${on ? 'active' : ''}" data-action="go" data-view="${n.view}" ${on ? 'aria-current="page"' : ''}>
      <span class="rail-icon">${icon(n.icon)}</span><span class="rail-label">${n.name}</span></button>`;
  }).join('');
}

// 作品状态：由剧本进度推算
function workStatus(work) {
  if (work.stage < 0) return { text: '等照片' };
  if (work.stage < 4) return { text: ['资产待确认', '信息待确认', work.storyAnswered ? '总结待确认' : '共创中', '方案待确认'][work.stage] };
  if (work.generating) return { text: '生成中' };
  return isDone(work) ? { text: '已完成', tone: 'ok' } : { text: '待验收', tone: 'warn' };
}
const passed = r => r.v.real === 'ok' && r.v.style === 'ok';
const roundOf = (work, n) => work.results.filter(r => r.round === n);
const isDone = work => roundOf(work, work.round).some(passed);
const statusChip = work => { const st = workStatus(work); return `<span class="chip ${st.tone ? `chip-${st.tone}` : ''}">${st.text}</span>`; };
const fmtTime = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const coverOf = work => { const done = work.results.filter(r => r.src); return (done.findLast(passed) || done.at(-1) || {}).src || work.image; };

// 「出图」在退回方案后仍可点开，查看之前生成的候选（old）
function stepState(work, i) {
  if (i < work.stage) return 'done';
  if (i === work.stage) return 'current';
  if (i === 4 && work.results.length) return 'old';
  return 'todo';
}
const viewingStep = work => work.view ?? STEPS[Math.max(work.stage, 0)].id;

function renderProgress() {
  const work = cur(), el = $('#progress');
  if (!work || !el) return;
  const viewing = viewingStep(work);
  $('#work-status').innerHTML = statusChip(work);
  el.innerHTML = STEPS.map((s, i) => {
    const st = stepState(work, i);
    return `<button class="pg ${st} ${viewing === s.id ? 'viewing' : ''}" data-action="view-step" data-step="${s.id}" ${st === 'todo' ? 'disabled' : ''}
      aria-label="${s.name}，${{ done: '已完成', current: '进行中', old: '有之前生成的候选', todo: '还没到' }[st]}${viewing === s.id ? '，画布正在显示' : ''}"><i aria-hidden="true"></i>${s.name}</button>`;
  }).join('');
}

// 作品名改了：同步浏览器标题和工作区的（读屏用）一级标题
function syncName(work) {
  document.title = `${work.name} · 一间`;
  const h = $('.ws > h1');
  if (h) h.textContent = work.name;
}

function renderTopbar() {
  const work = cur();
  const demo = '<span class="chip chip-demo" title="小间的回复是写好的演示剧本，还没接大模型">演示剧本 · 未接大模型</span>';
  if (state.view !== 'work' || !work) { $('#topbar').innerHTML = `<span class="grow"></span>${demo}`; return; }
  // 作品头部在顶栏里（同 v2）：作品 / 作品名（可直接改）· 状态，加流程进度和删除
  if (!$('#work-name') || $('#work-name').dataset.id !== work.id) {
    $('#topbar').innerHTML = `<nav class="crumbs" aria-label="当前位置"><button data-action="go" data-view="works">作品</button><span class="crumb-sep" aria-hidden="true">/</span></nav>
      <label class="sr-only" for="work-name">作品名称</label>
      <input id="work-name" class="work-name" data-id="${work.id}" value="${esc(work.name)}" maxlength="40" autocomplete="off">
      <span id="work-status"></span>
      <nav class="progress" id="progress" aria-label="流程进度：点一步在画布里查看和修改"></nav>
      <span class="grow"></span>${demo}
      <button class="icon-btn" data-action="delete-work" aria-label="删除作品" title="删除作品">${icon('trash')}</button>`;
  }
  const name = $('#work-name');
  if (document.activeElement !== name) name.value = work.name;   // 剧本改了名（如载入示例）时同步；用户正在打字时不动
  syncName(work);
  keepFocus(renderProgress);
}

/* ---------- 7. 渲染：首页 ---------- */
function viewComposer({ id, placeholder, attach, image, big }) {
  return `<form class="composer ${big ? 'composer-big' : ''}" data-form="${id}">
    ${image ? `<div class="composer-att"><img src="${image}" alt="已选的照片"><button type="button" class="att-x" data-action="drop-draft" aria-label="移除照片">${icon('close')}</button></div>` : ''}
    <label class="sr-only" for="${id}-text">${placeholder}</label>
    <textarea id="${id}-text" rows="${big ? 2 : 1}" placeholder="${placeholder}" maxlength="500"></textarea>
    <div class="composer-row">
      ${attach ? `<button type="button" class="round-btn" data-action="${attach}" aria-label="上传作品照片" title="上传作品照片">${icon('plus')}</button>` : '<span></span>'}
      <button type="submit" class="send-btn" aria-label="发送">${icon('send')}</button>
    </div></form>`;
}

function viewHome() {
  const cards = SCENES.map(s => `<button class="tpl" data-action="use-template" data-scene="${s.id}">
      <span class="tpl-img" style="background: linear-gradient(150deg, ${s.colors[0]}, ${s.colors[1]})"><img src="${SAMPLE_SRC}" alt=""></span>
      <span class="tpl-name">${s.name}</span><span class="tpl-desc">${s.desc}</span></button>`).join('');
  return `<div class="home">
    <h1>今天想拍哪件作品？</h1>
    ${viewComposer({ id: 'home', placeholder: '上传作品照片，说说它是什么、想拍成什么样', attach: 'pick-home-photo', image: state.draftImage, big: true })}
    <p class="home-hint">没有照片？<button class="link-btn" data-action="try-sample">用示例耳饰试一试</button></p>
    <section class="tpl-sec" aria-labelledby="tpl-title">
      <div class="sec-head"><h2 id="tpl-title">摄影布景模版</h2><span class="muted small">示意图，选一套直接开始</span></div>
      <div class="tpl-grid">${cards}</div>
    </section></div>`;
}

/* ---------- 7b. 作品、我的风格、摄影布景、历史结果（沿用 v2 的页面样式，数据为 v3 的演示数据） ---------- */
function viewWorks() {
  const hero = '<section class="hero"><h1>作品</h1></section>';
  if (!state.works.length) {
    return `${hero}<div class="empty"><h2>还没有作品</h2><p>在首页上传一件作品的照片、说一句话就能开始；也可以先用示例耳饰走一遍。</p>
      <div class="choices"><button class="btn btn-primary" data-action="go" data-view="home">新建作品</button><button class="btn btn-outline" data-action="try-sample">用示例耳饰试一试</button></div></div>`;
  }
  const cards = state.works.map(w => {
    const cover = coverOf(w);
    return `<button class="work-card" data-action="open-work" data-id="${w.id}">
      <div class="work-cover stage">${cover ? `<img src="${cover}" alt="">` : '<span class="placeholder">间</span>'}</div>
      <div class="work-meta"><h2>${esc(w.name)}</h2><div class="row">${statusChip(w)}<span class="time">${fmtTime(w.createdAt)}</span></div></div></button>`;
  }).join('');
  return `${hero}<div class="work-grid">${cards}
    <button class="work-card new" data-action="go" data-view="home"><span class="plus">${icon('plus')}</span>新建作品</button></div>`;
}

function viewStylePage() {
  return `<section class="hero"><h1>我的风格</h1><p>店铺长期的视觉偏好，新作品可一键套用；单件作品里的调整不会改到这里。</p></section>
    <div class="empty"><h2>还没有长期风格</h2><p>v3 原型还没有「更新为我的长期风格」的入口，这一页只做了样子。完整流程见 原型-v2。</p></div>`;
}

function viewScenesPage() {
  const cards = SCENES.map(sc => {
    const used = state.works.filter(w => w.scene === sc.id && w.stage >= 3).length;
    return `<article class="scene-card">
      <div class="palette-strip">${sc.colors.map(c => `<span style="background:${c}"></span>`).join('')}</div>
      <div class="body">
        <div class="title-row"><h2>${sc.name}</h2></div>
        <dl>${PLAN_ROWS.map(([k, name]) => `<dt>${name}</dt><dd>${esc(planVal(k, sc[k]))}</dd>`).join('')}</dl>
        <div class="title-row"><p class="muted grow">${used ? `${used} 件作品正在使用` : '暂未被使用'}</p>
          <button class="btn btn-outline btn-sm" data-action="use-template" data-scene="${sc.id}">用这套开始</button></div>
      </div></article>`;
  }).join('');
  return `<section class="hero"><h1>摄影布景</h1><p>背景、色调、光线、道具和构图的固定组合，换一件作品也能直接套用。</p></section>
    <div class="scene-grid">${cards}</div>`;
}

function viewHistory() {
  const items = state.works.flatMap(w => w.results.filter(r => r.src).map(r => ({ w, r }))).sort((a, b) => b.r.at - a.r.at);
  const list = items.map(({ w, r }) => {
    const old = r.round !== w.round || w.stage < 4;
    return `<button class="result-card" data-action="open-result" data-work="${w.id}" title="打开作品">
      <span class="result-img stage" style="aspect-ratio:${r.ratio.replace(':', '/')}"><img src="${r.src}" alt="候选 ${r.slot}（演示图）">
        <span class="media-tag"><span class="chip chip-demo">演示</span>${passed(r) ? '<span class="chip chip-ok">两项通过</span>' : ''}</span></span>
      <span class="result-meta"><span class="result-title"><strong>${esc(w.name)}</strong><span class="tnum">${fmtTime(r.at)}</span></span>
        <span class="tnum">第 ${r.round} 次 · 候选 ${r.slot} · ${sceneOf(r.scene).name} · ${r.ratio}${old ? ' · 旧方案' : ''}</span>
        <span class="verdicts">${verdictText(r)}</span></span></button>`;
  }).join('');
  return `<section class="hero"><h1>历史结果</h1></section>
    ${list ? `<div class="result-grid">${list}</div>` : '<div class="empty"><h2>还没有结果</h2><p>在作品里批准方案、生成候选后，会出现在这里。</p></div>'}`;
}

/* ---------- 8. 渲染：对话里的卡片（只放摘要和确认按钮；完整内容和编辑在画布） ---------- */
const tick = text => `<span class="done-tag">${icon('check')}${text}</span>`;
const verdictText = r => `像实物 ${{ ok: '像', bad: '不像' }[r.v.real] || '未验收'} · 风格 ${{ ok: '对', bad: '不对' }[r.v.style] || '未验收'}`;
const infoSummary = work => INFO_FIELDS.map(f => `${f.name} ${work.info[f.id] || '未填'}`).join(' · ');

function infoInputs(work) {
  const lock = work.generating ? 'readonly' : '';
  return INFO_FIELDS.map(f => {
    const v = work.info[f.id], guess = work.guessed[f.id];
    return `<label class="kv">
      <span class="k">${f.name}${guess ? '<em class="tag-guess">示例</em>' : ''}<em class="tag-miss" ${v ? 'hidden' : ''}>需要你补</em></span>
      <input class="kv-input" name="${f.id}" data-field="${f.id}" value="${esc(v)}" placeholder="${f.placeholder || '不清楚可以空着，会标为未知'}" autocomplete="off" ${lock}></label>`;
  }).join('');
}

function planRows(plan) {
  return PLAN_ROWS.map(([k, name]) => `<div class="plan-row"><span>${name}</span>${esc(planVal(k, plan[k]))}</div>`).join('');
}
const tweakNote = tweaks => { const names = Object.keys(tweaks).filter(k => TWEAK_NAMES[k]).map(k => TWEAK_NAMES[k]); return names.length ? `按你说的调了${names.join('、')}` : ''; };

function ratioSeg(work) {
  return `<div class="segmented" role="group" aria-label="主图比例">${Object.keys(RATIOS).map(r =>
    `<button type="button" aria-pressed="${work.ratio === r}" data-action="ratio" data-ratio="${r}">${r}</button>`).join('')}</div>`;
}

function candThumbs(list, big) {
  return list.map(r => {
    const frame = `<div class="cand-frame" style="aspect-ratio: ${r.ratio.replace(':', ' / ')}">
      ${r.src ? `<button class="zoom" data-action="zoom" data-id="${r.id}" aria-label="放大候选 ${r.slot}"><img src="${r.src}" alt="候选 ${r.slot}，演示图"></button>`
        : '<div class="pending"><span class="spinner"></span>生成中</div>'}</div>`;
    if (!big) return `<div class="cand">${frame}</div>`;
    const btn = (kind, val, text) => `<button class="mini-btn ${val}" aria-pressed="${r.v[kind] === val}" data-action="verdict" data-id="${r.id}" data-kind="${kind}" data-val="${val}" ${r.src ? '' : 'disabled'}>${text}</button>`;
    return `<div class="cand">${frame}
      <div class="verdict"><span>候选 ${r.slot}${passed(r) ? ' · <b class="ok-text">两项通过</b>' : ''}</span>
        <div class="verdict-row"><strong>像实物</strong>${btn('real', 'ok', '像')}${btn('real', 'bad', '不像')}</div>
        <div class="verdict-row"><strong>风格</strong>${btn('style', 'ok', '对')}${btn('style', 'bad', '不对')}</div>
        <button class="btn btn-outline btn-sm" data-action="export" data-id="${r.id}" ${r.src ? '' : 'disabled'}>${icon('download')}导出</button></div></div>`;
  }).join('');
}

function viewCard(work, msg, active) {
  const d = msg.data || {};
  switch (msg.card) {
    case 'need-photo':
      return active ? `<div class="card-actions"><button class="btn btn-primary btn-sm" data-action="pick-work-photo">${icon('upload')}上传照片</button><button class="btn btn-ghost btn-sm" data-action="use-sample">用示例耳饰</button></div>` : '';
    case 'asset':   // 显示当时那张图，换图后旧卡片不跟着变
      return `<div class="card ${active ? '' : 'past'}">
        <div class="pair"><img src="${d.image}" alt="原图"><img src="${d.white}" alt="白底演示图"></div>
        ${active ? `<div class="card-actions"><button class="btn btn-primary btn-sm" data-action="asset-ok">没问题，用这张</button><button class="btn btn-ghost btn-sm" data-action="pick-work-photo">换一张</button></div>` : (work.image === d.image && work.stage > 0 ? tick('商品图已确认') : '')}</div>`;
    case 'info':
      if (!active) return `<div class="card past"><span class="grow">${esc([work.info.category, work.info.material, work.info.size || '尺寸未知'].filter(Boolean).join(' · '))}</span>${work.stage > 1 ? tick('已确认') : ''}</div>`;
      return `<div class="card"><p class="plan-line" data-info-summary>${esc(infoSummary(work))}</p>
        <p class="fine">在右边画布里改，改完点这里确认。</p>
        <div class="card-actions"><button class="btn btn-primary btn-sm" data-action="info-ok">信息没问题</button></div></div>`;
    case 'story-ask':
      return active ? `<div class="quick"><button class="choice" data-action="story-quick" data-text="${esc(STORY_QUICK)}">${esc(STORY_QUICK)}</button><button class="choice" data-action="story-quick" data-text="我不知道，给我推荐">我不知道，给我推荐</button></div>` : '';
    case 'story-pick':
      if (!active) return '';
      return `<div class="picks">${STORY_PICKS.map((p, i) => `<button class="pick" data-action="story-pick" data-i="${i}"><strong>${p.title}</strong><span>${p.text}</span></button>`).join('')}</div>`;
    case 'story-sum': {
      const sum = STORY_SUMS[d.sum ?? 0];
      // 只有最后确认的那条打勾；被换掉的不打
      if (!active) return `<div class="card past"><span class="grow">${esc(sum.express)}</span>${work.stage > 2 && msg === lastCardMsg(work, 'story-sum') ? tick('已确认') : ''}</div>`;
      return `<div class="card"><div class="kv-list">
          <div class="kv"><span class="k">想表达</span>${esc(sum.express)}</div>
          <div class="kv"><span class="k">希望顾客感到</span>${esc(sum.feel)}</div>
          <div class="kv"><span class="k">明确避免</span>${esc(sum.avoid)}</div></div>
        <div class="card-actions"><button class="btn btn-primary btn-sm" data-action="story-ok">就是这个意思</button><button class="btn btn-ghost btn-sm" data-action="story-redo">换个方向</button></div></div>`;
    }
    case 'plan': {
      const s = active ? planOf(work.scene, work.tweaks) : planOf(d.scene || work.scene, d.tweaks || {});
      if (!active) return `<div class="card past"><span class="swatch-dot" style="background:${s.colors[1]}"></span><span class="grow">${s.name}${d.ratio ? ` · ${d.ratio}` : ''}</span>${work.approved && msg === lastCardMsg(work, 'plan') ? tick('已批准') : ''}</div>`;
      const note = tweakNote(work.tweaks);
      return `<div class="card">
        <div class="plan-head"><span class="palette">${s.colors.map(c => `<i style="background:${c}"></i>`).join('')}</span><strong>${s.name}</strong>
          <span class="muted small">${sceneReason(work)}${note ? `；${note}` : ''}</span></div>
        <p class="plan-line">${PLAN_ROWS.map(([k]) => esc(planVal(k, s[k]))).join(' · ')} · 比例 ${work.ratio}</p>
        <div class="card-actions"><button class="btn btn-primary btn-sm" data-action="approve">批准，生成两张</button><button class="btn btn-ghost btn-sm" data-action="next-scene">换一套</button>
          <button class="link-btn small push" data-action="show-prompt">完整方案和提示词</button></div>
        <p class="fine">比例和布景可以在右边画布里改。批准后锁定这一版；之后再改要重新批准。</p></div>`;
    }
    case 'gen':
      return `<div class="card ${active ? '' : 'past'}"><div class="cands-mini">${candThumbs(roundOf(work, d.round), false)}</div>${active ? '<p class="fine">右边画布里可以放大、验收和导出。</p>' : ''}</div>`;
    case 'fix':
      if (!active) return '';
      return `<div class="quick">${FIX_QUICK[d.kind].map(t => `<button class="choice" data-action="fix-quick" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <p class="fine">也可以直接在下面打字。（演示：用关键词规则理解，接入大模型后由 AI 理解）</p>`;
    case 'done':
      if (!active) return '';
      return `<div class="card-actions"><button class="btn btn-primary btn-sm" data-action="export" data-id="${d.id}">${icon('download')}导出这张</button><button class="btn btn-ghost btn-sm" data-action="go" data-view="home">拍下一件</button></div>`;
    default: return '';
  }
}
// 布景从哪来：故事推荐的写理由；模版或手动换的如实说明
function sceneReason(work) {
  if (work.fromTemplate && work.scene === work.templateScene) return '你选的模版';
  const sum = STORY_SUMS[work.storySum];
  if (work.fromTemplate) return '你换的布景';
  return work.scene === sum.scene ? `因为你想要「${esc(sum.feel)}」` : `你换的布景（按故事推荐的是「${sceneOf(sum.scene).name}」）`;
}
const lastCardMsg = (work, type) => [...work.msgs].reverse().find(m => m.card === type);

function viewMsg(work, m, active, fresh) {
  const cls = `msg ${m.role}${fresh ? ' fresh' : ''}`;
  if (m.role === 'user') return `<div class="${cls}" data-mid="${m.id}">${m.img ? `<img class="msg-img" src="${m.img}" alt="发出的照片">` : ''}${m.text ? `<p>${esc(m.text)}</p>` : ''}</div>`;
  return `<div class="${cls}" data-mid="${m.id}"><p>${esc(m.text)}</p>${m.card ? viewCard(work, m, active) : ''}</div>`;
}

// 对话只增量更新：新消息追加，内容变了的消息替换，其余不动（不重解码图片、不丢焦点）
const rendered = new Map();
function renderChat(work, scroll) {
  const list = $('#chat-list');
  if (!list) return;
  const first = list.dataset.work !== work.id;
  if (first) { list.innerHTML = ''; list.dataset.work = work.id; rendered.clear(); }
  const lastCard = work.msgs.reduce((idx, m, i) => (m.card ? i : idx), -1);
  $('.typing', list)?.remove();
  work.msgs.forEach((m, i) => {
    const html = viewMsg(work, m, i === lastCard && !work.typing, false);
    if (rendered.get(m.id) === html) return;
    const el = $(`[data-mid="${m.id}"]`, list);
    if (el) el.outerHTML = html;
    else list.insertAdjacentHTML('beforeend', first ? html : viewMsg(work, m, i === lastCard && !work.typing, true));
    rendered.set(m.id, html);
  });
  if (work.typing) list.insertAdjacentHTML('beforeend', '<div class="msg bot typing fresh" aria-hidden="true"><span></span><span></span><span></span></div>');
  if (scroll) list.scrollTop = list.scrollHeight;
}
const announce = text => { const el = $('#chat-live'); if (el) el.textContent = `小间：${text}`; };

/* ---------- 9. 渲染：右侧画布（流程可视化，可查看和修改任意已到达的步骤） ---------- */
function viewCanvas(work) {
  const step = viewingStep(work);
  const curStep = STEPS[Math.max(work.stage, 0)];
  const name = STEPS.find(s => s.id === step).name;
  const back = step !== curStep.id ? `<button class="btn btn-quiet btn-sm" data-action="view-current">${icon('back')}回到当前：${curStep.name}</button>` : '';
  const body = { asset: cvAsset, info: cvInfo, story: cvStory, plan: cvPlan, output: cvOutput }[step](work);
  return `<div class="cv-head"><h2>${name}</h2>${back}</div>${body}`;
}
const cvEmpty = (title, text) => `<div class="cv-empty">${icon('image')}<strong>${title}</strong><span>${text}</span></div>`;

function cvAsset(work) {
  if (!work.image) return cvEmpty('还没有照片', '在左边对话里上传，或用示例耳饰');
  return `<div class="cv-pair">
    <figure><button class="cv-frame" data-action="zoom" data-src="image" aria-label="放大原图"><img src="${work.image}" alt="原图"></button><figcaption>原图</figcaption></figure>
    <figure><button class="cv-frame white" data-action="zoom" data-src="white" aria-label="放大白底图"><img src="${work.white}" alt="白底演示图"></button><figcaption>白底商品图 <span class="chip chip-demo">演示</span></figcaption></figure></div>`;
}
function cvInfo(work) {
  const note = work.generating ? '正在生成，先别改；生成完可以改。'
    : work.approved ? '现在修改会让已批准的方案失效，已生成的候选会保留。'
    : work.stage === 1 ? '改完在左边点「信息没问题」。' : '改完小间会跟着更新。';
  return `<div class="sheet"><div class="kv-list">${infoInputs(work)}</div><p class="fine">${note}</p></div>`;
}
function cvStory(work) {
  const sum = work.storyAnswered ? STORY_SUMS[work.storySum] : null;
  const row = (k, name) => `<div><span class="k">${name}</span><p ${sum ? '' : 'class="muted"'}>${sum ? esc(sum[k]) : '等你说'}</p></div>`;
  return `<div class="sheet story-sheet">${row('express', '想表达')}${row('feel', '希望顾客感到')}${row('avoid', '明确避免')}
    <p class="fine">${sum ? '要改的话，在左边跟小间说「换个方向」。（演示：总结是写好的示例）' : '在左边回答小间的问题，聊完会整理成这三句话。'}</p></div>`;
}
function cvPlan(work) {
  const s = planOf(work.scene, work.tweaks);
  const scenes = SCENES.map(x => `<button class="choice" aria-pressed="${x.id === work.scene}" data-action="set-scene" data-scene="${x.id}">${x.name}</button>`).join('');
  const canApprove = work.stage === 3 && !work.approved;
  return `<div class="plan-canvas">
    <div class="preview" style="aspect-ratio: ${work.ratio.replace(':', ' / ')}; background: linear-gradient(150deg, ${s.colors[0]}, ${s.colors[1]})">
      ${work.image ? `<img src="${work.image}" alt="">` : ''}<span class="chip chip-demo">构图示意</span></div>
    <div class="sheet">
      <div class="field"><span class="k">布景</span><div class="choices">${scenes}</div></div>
      <div class="field"><span class="k">比例</span>${ratioSeg(work)}</div>
      <div class="plan-table">${planRows(s)}</div>
      ${tweakNote(work.tweaks) ? `<p class="fine">${tweakNote(work.tweaks)}；换布景会清掉这些调整。</p>` : ''}
      <details class="more" ${work.openPrompt ? 'open' : ''}><summary>完整提示词</summary><pre class="prompt">${esc(promptText(work))}</pre></details>
      ${work.approved ? '<p class="fine">这一版已批准。改布景或比例会让批准失效。</p>'
        : canApprove ? `<div class="sheet-foot"><button class="btn btn-primary btn-sm" data-action="approve">批准，生成两张</button><span class="fine">批准后锁定这一版</span></div>` : ''}</div></div>`;
}
function cvOutput(work) {
  if (!work.results.length) return cvEmpty('还没有出图', '方案批准后在这里生成');
  const shown = roundOf(work, work.round);
  const older = work.results.filter(r => r.round < work.round && r.src).reverse();
  const stale = work.stage < 4 ? '<p class="fine cv-note">这两张基于上一版方案。新方案批准后会再生成两张，这些会保留。</p>' : '';
  const olderHtml = older.length ? `<details class="more older"><summary>更早的 ${older.length} 张</summary><div class="older-grid">${older.map(r => `<figure>
      <button class="cand-frame zoom" data-action="zoom" data-id="${r.id}" aria-label="放大第 ${r.round} 次候选 ${r.slot}" style="aspect-ratio: ${r.ratio.replace(':', ' / ')}"><img src="${r.src}" alt="第 ${r.round} 次候选 ${r.slot}，演示图"></button>
      <figcaption>第 ${r.round} 次 · ${r.slot} · ${verdictText(r)}</figcaption></figure>`).join('')}</div></details>` : '';
  return `${stale}<div class="cands-big">${candThumbs(shown, true)}</div>${olderHtml}`;
}

/* ---------- 10. 渲染：整体 ---------- */
function viewWorkspace(work) {
  return `<div class="ws"><h1 class="sr-only">${esc(work.name)}</h1>
    <section class="chat" aria-label="和小间对话">
      <div class="chat-head"><span class="brand-mark sm" aria-hidden="true">间</span><strong>小间</strong><span class="muted small">带你把这件作品拍出来</span></div>
      <div class="chat-list" id="chat-list"></div>
      <div class="sr-only" id="chat-live" aria-live="polite"></div>
      <div class="chat-foot">${viewComposer({ id: 'chat', placeholder: '和小间说说…', attach: 'pick-work-photo' })}</div>
    </section>
    <section class="canvas" id="canvas" aria-label="作品画布"></section></div>`;
}

// 重建画布、进度时保住键盘焦点：按同样的按钮或输入框找回；对话里的按钮消失了（卡片收起），等小间下一张卡片出来再把焦点放过去
const FOCUS_KEYS = ['action', 'field', 'id', 'step', 'scene', 'ratio', 'kind', 'val', 'i', 'text'];
function keepFocus(fn) {
  const el = document.activeElement;
  const box = el?.closest('#chat-list, #canvas, #progress');
  const key = box && FOCUS_KEYS.filter(k => el.dataset[k] != null).map(k => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('');
  const sel = el && 'selectionStart' in el ? [el.selectionStart, el.selectionEnd] : null;
  fn();
  if (!key || document.activeElement === el) return;
  const again = $(`#${box.id} ${key}`);
  if (again && !again.disabled) {
    again.focus({ preventScroll: true });
    if (sel && 'setSelectionRange' in again) again.setSelectionRange(...sel);
  } else if (box.id === 'chat-list') state.focusNext = true;
}

function renderWork(scroll) {
  const work = cur();
  if (state.view !== 'work' || !work) return;
  keepFocus(() => {
    renderChat(work, scroll);
    const canvas = $('#canvas');
    if (canvas) canvas.innerHTML = viewCanvas(work);
    renderProgress();
  });
}

function renderAll() {
  if (state.view === 'work' && !cur()) state.view = 'works';
  renderNav();
  renderTopbar();
  const work = cur();
  document.body.dataset.view = state.view;
  const views = { home: viewHome, works: viewWorks, style: viewStylePage, scenes: viewScenesPage, history: viewHistory };
  const page = views[state.view] || viewHome;
  $('#view').innerHTML = state.view === 'work' ? viewWorkspace(work) : page === viewHome ? viewHome() : `<div class="page">${page()}</div>`;
  $('#view').scrollTop = 0;
  markScrolled();
  if (state.view !== 'work') document.title = '一间 · 手作影像工作台';
  hydrateIcons();
  if (work && state.view === 'work') syncName(work);
  renderWork(true);
}

// 顶栏滚动后才显示底部发丝线（同 v2；工作区的顶栏始终有线）
const markScrolled = () => $('#topbar').classList.toggle('scrolled', $('#view').scrollTop > 2);
$('#view').addEventListener('scroll', markScrolled, { passive: true });

// 确认弹窗（同 v2）
let confirmResolve = null;
function askConfirm(title, bodyHtml, okText) {
  $('#confirm-title').textContent = title;
  $('#confirm-body').innerHTML = bodyHtml;
  $('#confirm-ok').textContent = okText;
  $('#confirm-dialog').showModal();
  return new Promise(resolve => { confirmResolve = resolve; });
}
function closeConfirm(result) {
  $('#confirm-dialog').close();
  if (confirmResolve) confirmResolve(result);
  confirmResolve = null;
}
$('#confirm-dialog').addEventListener('cancel', () => closeConfirm(false));

function hydrateIcons() { $$('[data-icon]').forEach(el => { if (!el.innerHTML) el.innerHTML = icon(el.dataset.icon); }); }

function toast(text) {
  const el = $('#toast');
  el.textContent = text; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- 11. 事件 ---------- */
let filePurpose = null;
function pickFile(purpose) { filePurpose = purpose; $('#file-input').value = ''; $('#file-input').click(); }

// 小间在说话或在生成时，推进剧本和改方案的操作都不响应
const busy = () => { const w = cur(); return !!(w && (w.typing || w.generating)); };
const actions = {
  go: el => { state.view = el.dataset.view; renderAll(); $('#view').focus({ preventScroll: true }); },
  'open-work': el => { state.view = 'work'; state.currentId = el.dataset.id; renderAll(); },
  'open-result': el => { state.view = 'work'; state.currentId = el.dataset.work; cur().view = cur().stage === 4 ? null : 'output'; renderAll(); },
  'confirm-ok': () => closeConfirm(true),
  'confirm-cancel': () => closeConfirm(false),
  'delete-work': async () => {
    const w = cur();
    const ok = await askConfirm(`删除「${w.name}」？`, `<p>作品的照片、对话、方案和 ${w.results.length} 张候选都会删除，<strong>删除后无法找回</strong>。</p>`, '删除作品');
    if (!ok) return;
    state.works = state.works.filter(x => x.id !== w.id);
    state.currentId = null; state.view = 'works';
    renderAll(); toast('作品已删除');
  },
  'open-intro': () => $('#intro-dialog').showModal(),
  'close-dialog': el => el.closest('dialog').close(),
  'pick-home-photo': () => pickFile('home'),
  'pick-work-photo': () => pickFile('work'),
  'drop-draft': () => { state.draftImage = null; renderAll(); },
  'try-sample': () => startWork('用示例耳饰试一试', SAMPLE_SRC),
  'use-template': el => startWork('', state.draftImage, el.dataset.scene),
  'use-sample': () => replacePhoto(cur(), SAMPLE_SRC),
  'asset-ok': async () => {
    const w = cur(); userSay(w, '没问题，就用这张'); setStage(w, 1);
    const sample = INFO_FIELDS.some(f => w.guessed[f.id]);
    await botSay(w, sample
      ? '（演示）我按示例耳饰先填了一组信息，标「示例」的不对就在右边直接改。尺寸需要你量一下；不清楚可以空着，我会标成未知，不会自己编。'
      : '演示版还读不出照片里的信息，请在右边填一下品类、材料、尺寸和不能改的细节。不清楚可以空着，我会标成未知，不会自己编。', 'info');
  },
  'info-ok': async () => {
    const w = cur(); userSay(w, '信息没问题'); setStage(w, 2);
    await botSay(w, '接下来聊聊这件作品。做它的时候你想到了什么？想让买的人有什么感觉？随便说，说不清也没关系。', 'story-ask');
  },
  'story-quick': el => answerStory(cur(), el.dataset.text),
  'story-pick': async el => {
    const w = cur(), p = STORY_PICKS[+el.dataset.i];
    userSay(w, `选「${p.title}」`);
    w.storyAnswered = true; w.storySum = p.sum;
    await botSay(w, '好，按这个方向，我整理成三句话：', 'story-sum', { sum: p.sum });
  },
  'story-redo': async () => {
    const w = cur(); userSay(w, '换个方向');
    w.storySum = (w.storySum + 1) % STORY_SUMS.length;
    await botSay(w, '换个方向试试：', 'story-sum', { sum: w.storySum });
  },
  'story-ok': async () => {
    const w = cur(); userSay(w, '就是这个意思');
    if (!w.fromTemplate) { w.scene = STORY_SUMS[w.storySum].scene; w.tweaks = {}; }   // 从模版开始的作品保留用户选的布景
    await showPlan(w);
  },
  'next-scene': async () => {
    const w = cur(), i = SCENES.findIndex(s => s.id === w.scene);
    w.scene = SCENES[(i + 1) % SCENES.length].id; w.tweaks = {};
    userSay(w, '换一套');
    await showPlan(w, `换成「${sceneOf(w.scene).name}」：`);
  },
  'set-scene': el => {
    const w = cur();
    if (w.scene === el.dataset.scene) return;
    w.scene = el.dataset.scene; w.tweaks = {};
    if (w.approved) invalidate(w, `你把布景换成了「${sceneOf(w.scene).name}」`); else renderWork();
  },
  ratio: el => {
    const w = cur();
    if (w.ratio === el.dataset.ratio) return;
    w.ratio = el.dataset.ratio;
    if (w.approved) invalidate(w, `换成 ${w.ratio} 要重新构图`); else renderWork();
  },
  approve: () => {
    const w = cur();
    if (w.stage !== 3 || w.approved) return;
    const card = lastCardMsg(w, 'plan');
    if (card) Object.assign(card.data, { ratio: w.ratio, scene: w.scene, tweaks: { ...w.tweaks } });
    userSay(w, '批准，生成两张'); generate(w);
  },
  'show-prompt': () => { const w = cur(); w.openPrompt = true; w.view = w.stage === 3 ? null : 'plan'; renderWork(); $('#canvas details.more summary')?.focus({ preventScroll: true }); },
  verdict: el => {
    const w = cur(), r = w.results.find(x => x.id === el.dataset.id), { kind, val } = el.dataset;
    const wasPassed = passed(r);
    r.v[kind] = r.v[kind] === val ? undefined : val;
    renderWork();
    if (r.round !== w.round || w.stage !== 4) return;   // 旧方案的候选只记验收，不推进对话
    if (r.v[kind] === 'bad') askFix(w, r, kind);
    else if (passed(r) && !wasPassed) botSay(w, `候选 ${r.slot} 两项都过了，这件作品完成。可以导出这张；想接着拍下一件，就新建一个作品。`, 'done', { id: r.id });
  },
  'fix-quick': el => fixFromText(cur(), el.dataset.text),
  export: el => {
    const r = cur().results.find(x => x.id === el.dataset.id);
    const a = Object.assign(document.createElement('a'), { href: r.src, download: `${cur().name}-第${r.round}次-候选${r.slot}-演示.jpg` });
    a.click();
  },
  zoom: el => {
    const w = cur();
    const src = el.dataset.id ? w.results.find(r => r.id === el.dataset.id).src : w[el.dataset.src];
    $('#lightbox-body').innerHTML = `<img src="${src}" alt="大图">`;
    $('#lightbox').showModal();
  },
  'view-step': el => { const w = cur(); w.view = el.dataset.step === STEPS[Math.max(w.stage, 0)].id ? null : el.dataset.step; renderWork(); },
  'view-current': () => { cur().view = null; renderWork(); },
};
// 推进剧本、改方案的动作在小间说话或生成时不响应，避免连点出两条回复、或生成途中方案被改
const SCRIPTED = new Set(['use-sample', 'asset-ok', 'info-ok', 'story-quick', 'story-pick', 'story-redo', 'story-ok', 'next-scene', 'approve', 'set-scene', 'ratio', 'verdict', 'fix-quick', 'pick-work-photo']);

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const name = el.dataset.action;
  if (SCRIPTED.has(name) && busy()) { if (cur()?.generating) toast('正在生成，等两张都好了再操作'); return; }
  actions[name]?.(el);
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target, box = $('textarea', form), text = box.value.trim();
  if (form.dataset.form === 'home') {
    if (!text && !state.draftImage) { toast('先上传一张照片，或者说一句话'); return; }
    startWork(text, state.draftImage);
    return;
  }
  const w = cur();
  if (!text || busy()) return;
  box.value = '';
  if (w.stage === 2 && !w.storyAnswered) { answerStory(w, text); return; }
  // 方案和出图阶段：把用户的话转成方案修改（演示规则）
  if (w.stage >= 3) { fixFromText(w, text); return; }
  userSay(w, text);
  botSay(w, '记下了。这一步演示版还读不懂自由输入；请先用上面卡片里的按钮继续，或者在右边画布里直接改。');
});

// 回车发送，Shift+回车换行；输入法选词时不发送（Safari 选词时 isComposing 为 false，要再看 keyCode 229）
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && e.target.matches('.composer textarea')) {
    e.preventDefault(); e.target.form.requestSubmit();
  }
});

// 商品信息只在画布里编辑；对话卡片的摘要跟着更新；批准后修改会让批准失效
document.addEventListener('input', e => {
  const w = cur();
  if (e.target.id === 'work-name') { w.name = e.target.value.trim() || '未命名作品'; syncName(w); return; }
  const f = e.target.dataset.field;
  if (!f || !w || e.target.readOnly) return;
  w.info[f] = e.target.value.trim();
  w.guessed[f] = false;
  const k = e.target.closest('.kv').querySelector('.k');
  k.querySelector('.tag-guess')?.remove();
  k.querySelector('.tag-miss').toggleAttribute('hidden', !!w.info[f]);
  const summary = $('[data-info-summary]');
  if (summary) summary.textContent = infoSummary(w);
});
document.addEventListener('change', e => {
  const w = cur();
  if (e.target.dataset.field && w?.approved) invalidate(w, '你改了商品信息');
});

$('#file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  let src;
  try { src = await readFile(file); } catch (error) { toast(error.message); return; }
  if (filePurpose === 'home') { state.draftImage = src; renderAll(); $('#home-text')?.focus(); return; }
  const w = cur();
  if (!w || busy()) return;
  replacePhoto(w, src);
});

/* ---------- 12. 启动 ---------- */
renderAll();
// 存储被禁用时照样每次显示说明
let seenIntro = false;
try { seenIntro = !!localStorage.getItem('yijian-v3-intro'); localStorage.setItem('yijian-v3-intro', '1'); } catch { /* 无痕模式等：不记，下次照样显示 */ }
if (!seenIntro) $('#intro-dialog').showModal();
