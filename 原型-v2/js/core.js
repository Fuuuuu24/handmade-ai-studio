/* 一间 v2 原型 · core：工具、常量、数据、规则。生图与白底均为演示，未接入 AI。 */
'use strict';

/* ---------- 1. 工具函数 ---------- */
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const uid = prefix => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const now = () => Date.now();
const clone = value => JSON.parse(JSON.stringify(value));
const fmtTime = ts => {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const setPath = (obj, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
};

/* ---------- 2. 常量 ---------- */
const STEPS = [
  { id: 'asset', no: '01', name: '资产' },
  { id: 'info', no: '02', name: '信息' },
  { id: 'story', no: '03', name: '共创' },
  { id: 'plan', no: '04', name: '方案' },
  { id: 'output', no: '05', name: '出图' },
];

const ASSET_KINDS = { overall: '整体', back: '背面', detail: '细节' };

// O6 未定：以下为原型暂定值，正式值待结合生图服务确定
const UPLOAD = { types: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10 * 1024 * 1024, maxCount: 8, storeEdge: 1400, lowEdge: 600 };

const RATIOS = {
  '1:1': { w: 1000, h: 1000, note: '淘宝／天猫、微信小店主图必传比例' },
  '3:4': { w: 900, h: 1200, note: '淘宝／天猫、微信小店可选的 3:4 主图；小红书常见' },
  '9:16': { w: 720, h: 1280, note: '三个平台主图均不用 9:16，可用于其他展示场景' },
};

const CANDIDATE_COUNT = 2;

/* ---------- 3. 规则引导文案（O12：首版为规则引导＋卡片） ---------- */
const STORY_QUESTIONS = [
  {
    key: 'inspiration', label: '灵感来源',
    ask: '先聊聊这件作品的来处：它的灵感从哪里来？可以是一个场景、一段记忆，或者某种材料带给你的感觉。',
    allowNoStory: true,
    cards: [
      [
        { title: '自然的一角', text: '雨后、苔藓、林间光影这类自然片段', why: '饰品材质偏自然时，自然场景容易和它呼应' },
        { title: '日常的小物', text: '桌上的旧物、一杯茶、窗边的光', why: '让画面有生活感，顾客容易代入' },
        { title: '材料本身', text: '被某种材料的质感、颜色打动', why: '把重点放回材质，适合想突出做工的作品' },
      ],
      [
        { title: '一段旅行', text: '某个地方的颜色、海、山、街道', why: '画面可以借用那个地方的色调' },
        { title: '送给某个人', text: '为某个人或某个时刻而做', why: '画面可以偏温柔、私密' },
        { title: '纯粹好看', text: '没有特别的故事，就是觉得好看', why: '那就把画面交给造型和光线' },
      ],
    ],
  },
  {
    key: 'theme', label: '主题',
    ask: '如果给这件作品起一个主题，你会怎么说？一个词或一句话都可以。',
    cards: [
      [
        { title: '安静', text: '不张扬，慢慢看才发现细节', why: '适合留白多、光线柔的画面' },
        { title: '轻盈', text: '小巧、灵动、没有负担', why: '适合浅色背景、主体不压画面' },
        { title: '复古', text: '有年代感，像旧物里翻出来的', why: '适合暖调、带纹理的背景' },
      ],
      [
        { title: '日常', text: '每天都能戴的小确幸', why: '适合生活化的道具和自然光' },
        { title: '仪式感', text: '值得在特别的日子戴', why: '适合更讲究的布置和对比光' },
        { title: '野趣', text: '带一点自然和随性', why: '适合植物、石头等自然道具' },
      ],
    ],
  },
  {
    key: 'mood', label: '期望感受',
    ask: '你希望顾客第一眼看到这张主图时，是什么感觉？',
    cards: [
      [
        { title: '想靠近看', text: '被细节吸引，想放大看做工', why: '主体占比要大，光线要把细节照清楚' },
        { title: '很舒服', text: '看着放松，不刺眼', why: '低饱和色调、柔光' },
        { title: '有点特别', text: '和别家不一样，记得住', why: '可以在色调或摆放上做一点反差' },
      ],
      [
        { title: '温暖', text: '像被阳光照到', why: '暖光、米色系背景' },
        { title: '干净', text: '清爽、利落、可信', why: '浅色背景、少道具' },
        { title: '精致', text: '值得这个价格', why: '讲究的光影和质感背景' },
      ],
    ],
  },
  {
    key: 'avoid', label: '明确避免',
    ask: '最后一个问题：有没有你明确不想要的感觉或画面？比如太花、太亮、像廉价批发货。',
    cards: [
      [
        { title: '太花哨', text: '道具多、颜色杂', why: '会抢走饰品的注意力' },
        { title: '廉价感', text: '像批发图、影棚感太重', why: '手作的温度会被冲淡' },
        { title: '过度修饰', text: '颜色和材质被修得不像实物', why: '顾客收到货会有落差' },
      ],
      [
        { title: '太暗', text: '整体压抑、看不清', why: '电商主图需要第一眼看清商品' },
        { title: '太冷', text: '冷冰冰没有温度', why: '与手作的气质不符' },
        { title: '太满', text: '没有留白，很挤', why: '缩略图里会显得乱' },
      ],
    ],
  },
];

const STYLE_OPTIONS = {
  tone: [
    { id: 'moss', name: '雨后苔绿', desc: '低饱和绿，偏冷', colors: ['#dfe4d5', '#b9c4a6', '#7e8f6c'] },
    { id: 'cream', name: '奶油米白', desc: '暖白，柔和', colors: ['#f3ede2', '#e6dac6', '#c9b79a'] },
    { id: 'stone', name: '石灰浅灰', desc: '中性灰，干净', colors: ['#ecebe8', '#d5d3ce', '#a8a49d'] },
    { id: 'rose', name: '干燥玫瑰', desc: '灰调粉，温柔', colors: ['#efe3e1', '#ddc5c1', '#b8928c'] },
    { id: 'ink', name: '深墨对比', desc: '深色底，高对比', colors: ['#3a3a38', '#2a2a28', '#8d8a82'] },
  ],
  background: ['手工纸', '亚麻布', '原木', '石材', '纯色背景'],
  light: ['柔和自然光', '窗边侧光', '暖调午后光', '清冷晨光', '明暗对比光'],
  placement: ['平铺', '悬挂', '支架'],
  composition: ['主体居中，留白多', '主体偏一侧，留出呼吸感', '主体放大，突出细节'],
};

const ISSUES = {
  fidelity: ['颜色', '数量', '轮廓', '连接结构', '纹样', '材质'],
  style: ['背景', '光线', '道具', '构图'],
};

// B10：预设只作为推荐方向，不是用户保存的布景
const PRESET_DIRECTIONS = [
  { name: '雨后清晨', tone: 'moss', background: '手工纸', light: '清冷晨光', props: '一小片苔藓', composition: '主体偏一侧，留出呼吸感', why: '适合安静、自然、想让人靠近看的作品' },
  { name: '午后书桌', tone: 'cream', background: '亚麻布', light: '暖调午后光', props: '一本旧书的一角', composition: '主体居中，留白多', why: '适合温暖、日常、生活感的作品' },
  { name: '干净陈列', tone: 'stone', background: '石材', light: '柔和自然光', props: '', composition: '主体放大，突出细节', why: '适合想显得干净、精致、可信的作品' },
];

/* ---------- 4. 数据模型 ---------- */
const STORE_KEY = 'yijian.v2';
const emptyStyle = () => ({ tone: '', background: '', light: '', placement: '', props: '', propsBanned: '', composition: '' });

function newWork(name) {
  const d = new Date();
  return {
    id: uid('w'), createdAt: now(), updatedAt: now(),
    name: name || `未命名作品 · ${d.getMonth() + 1}-${d.getDate()}`,
    step: 'asset',
    assets: [],                       // { id, kind, name, dataUrl, w, h, low }
    whiteBg: null,                    // { sourceId, dataUrl, w, h, demo: true }
    assetsConfirmed: false,
    route: 'B',                       // A：白底资产 → 场景；B：原图直出（AC-02.6）
    info: { category: '', material: '', materialUnknown: false, size: '', sizeUnknown: false, keep: '', price: '', audience: '' },
    infoSuggest: [],                  // 对话中识别到、待确认的信息 { field, value }
    story: { answers: {}, sources: {}, q: 0, cardSet: {}, picking: null, noStory: false, summary: null, summarySrc: null, summaryConfirmed: false },
    style: emptyStyle(), styleSrc: {}, styleSuggest: [], sceneRef: null,
    ratio: '3:4',
    promptEdited: null,               // 用户手动改过的提示词全文
    plans: [],                        // 批准记录 { v, snapshot, prompt, approvedAt }
    approvedV: null,
    revision: null,                   // { fromResultId, reasons }
    tasks: [],                        // { id, planV, ratio, route, status, createdAt, resultIds }
    results: [],                      // { id, taskId, planV, ratio, slot, status, dataUrl, fidelity, style, issues, parentId, exportedAt }
    needs: [],                        // 本期不支持但记下来的需求（如真人佩戴）
    chat: [],
  };
}

function defaultState() {
  return {
    version: 1,
    view: 'works',
    currentId: null,
    works: [],
    longTerm: { style: emptyStyle(), log: [] },
    scenes: [],                        // { id, name, version, params, history: [{version, params, at}], createdAt, fromWorkId }
    seenIntro: false,
    demoFailNext: false,
  };
}

/* ---------- 5. 保存：只有真正写入成功才显示「已保存」 ---------- */
const Store = {
  state: null,
  status: 'saved',       // saved | dirty | saving | error
  error: '',
  timer: null,
  listeners: [],
  load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      this.state = raw ? { ...defaultState(), ...JSON.parse(raw) } : defaultState();
      this.status = raw ? 'saved' : 'dirty';
    } catch (error) {
      this.state = defaultState();
      this.status = 'error';
      this.error = `读取本地记录失败：${error.message}`;
    }
    return this.state;
  },
  touch(work) {
    if (work) work.updatedAt = now();
    this.status = 'dirty';
    this.emit();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 500);
  },
  flush() {
    clearTimeout(this.timer);
    this.status = 'saving';
    this.emit();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.state));
      this.status = 'saved';
      this.error = '';
    } catch (error) {
      this.status = 'error';
      this.error = error.name === 'QuotaExceededError' ? '浏览器存储已满，可删除不用的作品或图片后重试' : `写入失败：${error.message}`;
    }
    this.emit();
    return this.status === 'saved';
  },
  emit() { this.listeners.forEach(fn => fn(this.status)); },
};

/* ---------- 6. 规则：信息、总结、提示词、快照、状态 ---------- */
const STYLE_LABELS = { tone: '色调', background: '背景', light: '光线', placement: '摆放', props: '道具', propsBanned: '禁止出现', composition: '构图' };
const toneText = tone => {
  const option = STYLE_OPTIONS.tone.find(t => t.id === tone);
  return option ? `${option.name}（${option.desc}）` : tone;
};
const toneOption = tone => STYLE_OPTIONS.tone.find(t => t.id === tone || `${t.name}（${t.desc}）` === tone || t.name === tone);

function infoReady(work) {
  const i = work.info;
  return Boolean(i.category && (i.material || i.materialUnknown) && (i.size || i.sizeUnknown));
}

function draftSummary(work) {
  const a = work.story.answers;
  const parts = [a.theme, work.story.noStory ? '' : a.inspiration].filter(Boolean);
  return {
    express: parts.length ? parts.join('；') : '暂无明确故事，以造型和材质本身为主',
    feel: a.mood || '',
    avoid: a.avoid || '',
  };
}

// 提示词：每行带【标签】，风格行可改并同步回卡片，其余行来自前序步骤，只能回原步骤修改
const PROMPT_LOCKED = ['主体', '保真', '表达', '避免', '输出'];
const PROMPT_EDITABLE = { 色调: 'tone', 背景: 'background', 光线: 'light', 摆放: 'placement', 道具: 'props', 禁止出现: 'propsBanned', 构图: 'composition' };

function promptLines(work) {
  const i = work.info;
  const s = work.style;
  const sum = work.story.summary || draftSummary(work);
  const material = i.materialUnknown ? '材料未知（不要猜测材质）' : `材料：${i.material}`;
  const size = i.sizeUnknown ? '实际尺寸未知（不要推断比例）' : `实际尺寸：${i.size}`;
  return [
    ['主体', `一件手作${i.category || '饰品'}，${material}；${size}。参考图为${work.route === 'A' ? '白底商品资产' : '用户上传的原图'}。`],
    ['保真', `保持商品原样，不改变颜色、数量、轮廓、连接结构与纹样${i.keep ? `；特别注意：${i.keep}` : ''}。`],
    ['表达', `作品想表达：${sum.express}；希望顾客感受到：${sum.feel || '（未填写）'}。`],
    ['色调', s.tone ? toneText(s.tone) : '（未选择）'],
    ['背景', s.background || '（未选择）'],
    ['光线', s.light || '（未选择）'],
    ['摆放', s.placement || '（未选择）'],
    ['道具', s.props || '无道具'],
    ['禁止出现', s.propsBanned || '（无）'],
    ['构图', s.composition || '（未选择）'],
    ['避免', sum.avoid || '（未填写）'],
    ['输出', `无文字单品主图，比例 ${work.ratio}，${CANDIDATE_COUNT} 张候选。`],
  ];
}
const buildPrompt = work => promptLines(work).map(([k, v]) => `【${k}】${v}`).join('\n');
const currentPrompt = work => work.promptEdited ?? buildPrompt(work);

function parsePrompt(text, work) {
  const expected = Object.fromEntries(promptLines(work));
  const seen = {};
  const conflicts = [];
  text.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
    const m = line.match(/^【(.+?)】(.*)$/);
    if (!m) { conflicts.push(`无法识别的一行：「${line.slice(0, 30)}」，请保留【标签】格式`); return; }
    const [, label, value] = m;
    if (!(label in expected)) { conflicts.push(`未知标签【${label}】`); return; }
    seen[label] = value.trim();
  });
  Object.keys(expected).forEach(label => { if (!(label in seen)) conflicts.push(`缺少【${label}】这一行`); });
  const where = { 主体: '「信息」或「资产」', 保真: '「信息」', 表达: '「共创」', 避免: '「共创」', 输出: '比例选择' };
  PROMPT_LOCKED.forEach(label => {
    if (label in seen && seen[label] !== expected[label]) conflicts.push(`【${label}】来自${where[label]}，请回到那里修改`);
  });
  const updates = {};
  Object.entries(PROMPT_EDITABLE).forEach(([label, field]) => {
    if (!(label in seen) || seen[label] === expected[label]) return;
    let value = seen[label].replace(/^（(未选择|无)）$/, '');
    if (field === 'props' && value === '无道具') value = '';
    if (field === 'tone') value = toneOption(value)?.id || value;
    updates[field] = value;
  });
  return { conflicts, updates };
}

function snapshotOf(work) {
  return {
    assets: work.assets.map(a => `${a.id}:${a.kind}`).join('|'),
    route: work.route + (work.route === 'A' && work.whiteBg ? `:${work.whiteBg.sourceId}` : ''),
    info: JSON.stringify(work.info),
    summary: JSON.stringify(work.story.summary),
    ...Object.fromEntries(Object.keys(STYLE_LABELS).map(k => [`style.${k}`, work.style[k] || ''])),
    scene: work.sceneRef ? `${work.sceneRef.id}@${work.sceneRef.version}` : '',
    ratio: work.ratio,
    prompt: currentPrompt(work),
    count: String(CANDIDATE_COUNT),
  };
}
const SNAPSHOT_LABELS = { assets: '参考素材', route: '资产路线', info: '商品信息', summary: '共创总结', scene: '布景', ratio: '比例', prompt: '提示词', count: '候选数量', ...Object.fromEntries(Object.entries(STYLE_LABELS).map(([k, v]) => [`style.${k}`, v])) };
// 提示词由其他字段生成：其他字段变了就报那些字段；只有提示词本身被改时才报「提示词」
function diffSnapshot(a, b) {
  if (!a || !b) return [];
  const changed = Object.keys(SNAPSHOT_LABELS).filter(k => k !== 'prompt' && a[k] !== b[k]).map(k => SNAPSHOT_LABELS[k]);
  if (changed.length) return changed;
  return a.prompt !== b.prompt ? ['提示词'] : [];
}
const approvedPlan = work => work.plans.find(p => p.v === work.approvedV) || null;
const approvalValid = work => {
  const plan = approvedPlan(work);
  return Boolean(plan) && diffSnapshot(plan.snapshot, snapshotOf(work)).length === 0;
};
const isComplete = r => r.status === 'success' && r.fidelity === 'ok' && r.style === 'ok';
const runningTask = work => work.tasks.find(t => t.status === 'queued' || t.status === 'running');

function generateBlockers(work) {
  const reasons = [];
  if (!work.assetsConfirmed) reasons.push(['asset', '商品资产还没确认']);
  if (!infoReady(work)) reasons.push(['info', '品类、材料、尺寸还没填（可以填「未知」）']);
  if (!work.story.summaryConfirmed) reasons.push(['story', '共创总结还没确认']);
  if (!work.approvedV) reasons.push(['plan', '方案还没批准']);
  else if (!approvalValid(work)) reasons.push(['plan', `批准后改动了：${diffSnapshot(approvedPlan(work).snapshot, snapshotOf(work)).join('、')}，需要重新批准`]);
  if (runningTask(work)) reasons.push(['output', '已有任务在生成中']);
  return reasons;
}

function stepState(work, step) {
  switch (step) {
    case 'asset': return work.assetsConfirmed ? 'done' : 'todo';
    case 'info': return infoReady(work) ? 'done' : 'todo';
    case 'story': return work.story.summaryConfirmed ? 'done' : 'todo';
    case 'plan': return !work.approvedV ? 'todo' : approvalValid(work) ? 'done' : 'stale';
    case 'output': return work.results.some(isComplete) ? 'done' : 'todo';
    default: return 'todo';
  }
}
const STEP_STATE_TEXT = { done: '完成', stale: '已失效', todo: '待完成' };

// PRD 5.3 作品状态
function workStatus(work) {
  if (!work.assets.length) return { text: '草稿', tone: '' };
  if (!work.assetsConfirmed) return { text: '资产待确认', tone: 'warn' };
  if (!infoReady(work) || !work.story.summary) return { text: '共创中', tone: '' };
  if (!work.story.summaryConfirmed) return { text: '总结待确认', tone: 'warn' };
  if (runningTask(work)) return { text: '生成中', tone: '' };
  if (work.results.some(isComplete)) return { text: '已完成', tone: 'ok' };
  if (work.results.some(r => r.status === 'success' && (r.fidelity === 'none' || r.style === 'none'))) return { text: '待验收', tone: 'warn' };
  if (!approvalValid(work)) return { text: '方案待确认', tone: 'warn' };
  return { text: '可生成', tone: 'ok' };
}

/* ---------- 7. 图片：读取压缩、白底演示、候选演示合成（都在本地，不上传） ---------- */
const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('图片无法读取，可能文件已损坏'));
  img.src = src;
});
const readAsDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('读取文件失败'));
  reader.readAsDataURL(file);
});

function checkFile(file, existing) {
  if (!UPLOAD.types.includes(file.type)) return `「${file.name}」不是 JPG／PNG／WebP 图片`;
  if (file.size > UPLOAD.maxBytes) return `「${file.name}」超过 10MB`;
  if (existing >= UPLOAD.maxCount) return `最多 ${UPLOAD.maxCount} 张，「${file.name}」未添加`;
  return '';
}

async function compressImage(src) {
  const img = await loadImage(src);
  const scale = Math.min(1, UPLOAD.storeEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.86), w: img.naturalWidth, h: img.naturalHeight, low: Math.min(img.naturalWidth, img.naturalHeight) < UPLOAD.lowEdge };
}

function stampDemo(ctx, w, h, text) {
  const pad = Math.round(w * 0.025);
  ctx.font = `${Math.max(14, Math.round(w * 0.022))}px ${getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'}`;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillRect(pad, h - pad * 2.6, tw + pad, pad * 1.8);
  ctx.fillStyle = '#a3590d';
  ctx.fillText(text, pad * 1.5, h - pad * 1.25);
}

async function makeWhiteBgDemo(asset) {
  const img = await loadImage(asset.dataUrl);
  const size = 1000;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  const s = Math.min(size * 0.82 / img.width, size * 0.82 / img.height);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(img, (size - img.width * s) / 2, (size - img.height * s) / 2, img.width * s, img.height * s);
  ctx.globalCompositeOperation = 'source-over';
  stampDemo(ctx, size, size, '白底 · 演示 · 未抠图');
  return { sourceId: asset.id, dataUrl: canvas.toDataURL('image/jpeg', 0.88), w: size, h: size, demo: true };
}

const LIGHT_DIR = { 窗边侧光: [0, .3], 暖调午后光: [.15, 0], 清冷晨光: [.85, 0], 明暗对比光: [0, .1], 柔和自然光: [.5, 0] };
async function renderDemoCandidate(work, slot) {
  const { w, h } = RATIOS[work.ratio];
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const tone = toneOption(work.style.tone) || STYLE_OPTIONS.tone[2];
  const [c1, c2] = tone.colors;
  // 背景：色调渐变
  const bg = ctx.createLinearGradient(0, 0, w * (slot === 'A' ? .3 : .8), h);
  bg.addColorStop(0, c1); bg.addColorStop(1, c2);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  // 纹理：细颗粒
  const seed = slot === 'A' ? 7 : 13;
  for (let i = 0; i < (w * h) / 900; i++) {
    const x = (i * 97 * seed) % w, y = (i * 61 + seed * i * i) % h;
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.035)';
    ctx.fillRect(x, y, 2, 2);
  }
  // 光线：按方向打一层高光
  const [lx, ly] = LIGHT_DIR[work.style.light] || [.5, 0];
  const glow = ctx.createRadialGradient(w * lx, h * ly, 0, w * lx, h * ly, Math.max(w, h) * .9);
  glow.addColorStop(0, work.style.light === '明暗对比光' ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.35)');
  glow.addColorStop(1, work.style.light === '明暗对比光' ? 'rgba(0,0,0,.28)' : 'rgba(255,255,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  // 主体：按构图决定大小和位置
  // 演示中白底图只是原图放到白底上，直接用其来源原图渲染，避免把白底演示水印合成进候选
  const sourceId = work.route === 'A' && work.whiteBg ? work.whiteBg.sourceId : null;
  const source = work.assets.find(a => a.id === sourceId) || work.assets.find(a => a.kind === 'overall') || work.assets[0];
  const img = await loadImage(source.dataUrl);
  const comp = work.style.composition || '';
  const scale = comp.includes('放大') ? .9 : comp.includes('留白') ? .62 : .74;
  const offset = comp.includes('一侧') ? (slot === 'A' ? -.12 : .12) : (slot === 'A' ? -.03 : .03);
  const s = Math.min(w * scale / img.width, h * scale / img.height);
  const dw = img.width * s, dh = img.height * s;
  const dx = (w - dw) / 2 + w * offset, dy = (h - dh) / 2 + h * (slot === 'A' ? -.02 : .02);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.globalCompositeOperation = 'source-over';
  stampDemo(ctx, w, h, `演示 · 非 AI 生成 · ${slot}`);
  return canvas.toDataURL('image/jpeg', 0.88);
}

/* ---------- 8. 小间的对话规则（规则引导，不是大模型） ---------- */
const CATEGORY_WORDS = ['耳饰', '耳环', '耳钉', '耳夹', '项链', '吊坠', '手链', '手镯', '戒指', '胸针', '发夹', '发簪', '脚链'];
const MATERIAL_WORDS = ['925银', '纯银', '银', '黄铜', '铜', '金', '珍珠', '淡水珍珠', '树脂', '滴胶', '玻璃', '琉璃', '水晶', '陶瓷', '贝壳', '木', '布', '棉线', '皮革', '天然石', '玉'];
const INFO_LABELS = { category: '品类', material: '材料', size: '尺寸' };
const firstMatch = (text, words) => words.slice().sort((a, b) => b.length - a.length).filter(w => text.includes(w));

function interpretChat(work, text) {
  const out = { reply: '', infoSuggest: [], styleSuggest: [], answer: null, need: null };
  const t = text.trim();
  if (/佩戴|戴在|上身|模特|真人|上耳/.test(t)) {
    out.need = t;
    out.reply = '真人佩戴效果本期还不支持，我先把这个需求记在作品里。首版先做静物主图：平铺、悬挂或支架。';
    return out;
  }
  if (work.step === 'story' && work.story.q < STORY_QUESTIONS.length && !work.story.summaryConfirmed) {
    const q = STORY_QUESTIONS[work.story.q];
    out.answer = { key: q.key, value: t };
    const next = STORY_QUESTIONS[work.story.q + 1];
    out.reply = next && !work.story.answers[next.key] ? `记下了「${q.label}」。\n${next.ask}` : `记下了「${q.label}」。`;
    return out;
  }
  if (work.step === 'info') {
    const size = t.match(/(\d+(?:\.\d+)?)\s*(cm|mm|厘米|毫米|公分)/i);
    if (size) out.infoSuggest.push({ field: 'size', value: `${size[1]}${size[2]}` });
    const mats = firstMatch(t, MATERIAL_WORDS);
    if (mats.length) out.infoSuggest.push({ field: 'material', value: mats.filter((m, i) => !mats.slice(0, i).some(x => x.includes(m))).join('、') });
    const cat = firstMatch(t, CATEGORY_WORDS);
    if (cat.length) out.infoSuggest.push({ field: 'category', value: cat[0] });
    out.reply = out.infoSuggest.length
      ? `我从你的话里识别到：${out.infoSuggest.map(s => `${INFO_LABELS[s.field]}「${s.value}」`).join('，')}。在左边卡片里点「采纳」才会写进去。`
      : '没识别到具体的品类、材料或尺寸。你可以直接在左边填，不确定的勾「未知」就行，我不会替你猜。';
    return out;
  }
  if (work.step === 'plan') {
    const pick = (field, words) => { const hit = words.find(w => t.includes(w.replace(/光$/, '')) || t.includes(w)); if (hit) out.styleSuggest.push({ field, value: hit }); };
    pick('background', STYLE_OPTIONS.background);
    pick('light', STYLE_OPTIONS.light);
    pick('placement', STYLE_OPTIONS.placement);
    const tone = STYLE_OPTIONS.tone.find(o => t.includes(o.name) || t.includes(o.name.slice(-2)));
    if (tone) out.styleSuggest.push({ field: 'tone', value: tone.id });
    const ban = t.match(/不要(?:放|出现)?([^，。,.！!？?\s]{1,10})/);
    if (ban) out.styleSuggest.push({ field: 'propsBanned', value: ban[1] });
    const add = t.match(/(?:加|放|摆|配)(?:一个|一些|点|上)?([^，。,.！!？?\s]{1,10})/);
    if (add && !/^(光|背景)/.test(add[1])) out.styleSuggest.push({ field: 'props', value: add[1] });
    if (/无道具|不要道具|不放道具/.test(t)) out.styleSuggest.push({ field: 'props', value: '' });
    out.reply = out.styleSuggest.length
      ? `整理成了 ${out.styleSuggest.length} 条建议，标在左边对应的卡片上，点「采纳」才会改方案。`
      : '这句话我没能对应到具体的风格项。可以试试说「换成亚麻布背景」「要窗边侧光」「不要花」，或者直接在左边改。';
    return out;
  }
  out.reply = {
    asset: '先上传作品照片：至少一张整体图，有背面或细节图更好。上传后对照检查一下，确认没问题就可以往下走。',
    output: '对每张候选分别评价「还原度」和「风格」。两项都满意才算完成；不满意的，可以从那一版修改。',
  }[work.step] || '收到。';
  return out;
}
function styleConflicts(style) {
  const list = [];
  const banned = (style.propsBanned || '').split(/[、，,\s]+/).filter(Boolean);
  banned.forEach(word => { if (style.props && style.props.includes(word)) list.push(`道具里有「${word}」，但「禁止出现」也写了「${word}」`); });
  if (style.placement === '悬挂' && /托盘|盘子/.test(style.props || '')) list.push('摆放选了「悬挂」，道具里却有托盘，二者可能矛盾');
  return list;
}
