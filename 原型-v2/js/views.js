/* 一间 v2 原型 · views：只负责把状态渲染成 HTML。所有用户内容都经 esc() 转义。 */
'use strict';

// 线条图标（自绘，24×24，描边跟随文字颜色）
const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  works: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  style: '<path d="M12 3.5c-4.9 0-8.5 3.6-8.5 8.3 0 4.6 3.6 8.2 8.2 8.2 1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8h2c2.7 0 4.5-1.9 4.5-4.5 0-3.4-3.8-6-8.8-6z"/><circle cx="7.8" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.8" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="8.3" r="1" fill="currentColor" stroke="none"/>',
  scenes: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5 16 11l-8.5 8"/>',
  history: '<path d="M3.5 12A8.5 8.5 0 1 0 6 6L3.5 8.5"/><path d="M3.5 4v4.5H8"/><path d="M12 7.5V12l3 2"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.4a2.4 2.4 0 0 1 4.6.9c0 1.6-2.3 2-2.3 3.4"/><circle cx="12" cy="16.7" r=".9" fill="currentColor" stroke="none"/>',
  close: '<path d="M7 7l10 10M17 7 7 17"/>',
  send: '<path d="M12 18.5v-13M6.5 11 12 5.5l5.5 5.5"/>',
  check: '<path d="M5.5 12.5 10 17l8.5-9.5"/>',
  alert: '<path d="M12 6.5v7"/><circle cx="12" cy="17.3" r="1" fill="currentColor" stroke="none"/>',
  back: '<path d="M14.5 6.5 9 12l5.5 5.5"/>',
  next: '<path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5"/>',
  down: '<path d="M6.5 9.5 12 15l5.5-5.5"/>',
  upload: '<path d="M12 15.5V5M7.5 9.5 12 5l4.5 4.5"/><path d="M5 14.5v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
  trash: '<path d="M5 7h14M10 4.5h4M7 7l.7 11a2 2 0 0 0 2 1.9h4.6a2 2 0 0 0 2-1.9L17 7"/>',
  download: '<path d="M12 4.5V15M7.5 10.5 12 15l4.5-4.5"/><path d="M5 15.5v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

const NAV = [
  { view: 'works', icon: 'works', name: '作品' },
  { view: 'style', icon: 'style', name: '我的风格' },
  { view: 'scenes', icon: 'scenes', name: '摄影布景' },
  { view: 'history', icon: 'history', name: '历史结果' },
];

const coverOf = work => (work.results.find(isComplete) || {}).dataUrl || (work.assets.find(a => a.kind === 'overall') || work.assets[0] || {}).dataUrl || '';
const statusChip = work => { const s = workStatus(work); return `<span class="chip ${s.tone ? `chip-${s.tone}` : ''}">${esc(s.text)}</span>`; };
const activeNav = state => (state.view === 'work' ? 'works' : state.view);

/* ---------- 外框：图标栏（悬停展开显示文字）+ 顶栏 ---------- */
function viewSideNav(state) {
  return NAV.map(n => {
    const on = activeNav(state) === n.view;
    return `<button class="rail-item ${on ? 'active' : ''}" data-action="go" data-view="${n.view}" ${on ? 'aria-current="page"' : ''}>
      <span class="rail-icon">${icon(n.icon)}</span><span class="rail-label">${n.name}</span></button>`;
  }).join('');
}

// 作品页的头部在顶栏里：作品名可直接改、状态、演示设置、删除。列表页顶栏留空，标题在页面里
function viewTopbar(state, work) {
  if (state.view !== 'work' || !work) return '';
  return `<nav class="crumbs" aria-label="当前位置"><button data-action="go" data-view="works">作品</button><span class="crumb-sep" aria-hidden="true">/</span></nav>
    <label class="sr-only" for="work-name">作品名称</label>
    <input id="work-name" class="work-name" data-bind="name" value="${esc(work.name)}" maxlength="40" autocomplete="off">
    <span id="work-status">${statusChip(work)}</span>
    <span class="grow"></span>
    <button class="btn btn-quiet btn-sm" data-action="open-demo">演示设置</button>
    <button class="icon-btn" data-action="delete-work" aria-label="删除作品" title="删除作品">${icon('trash')}</button>`;
}

function viewSaveState(status, error) {
  if (status === 'error') return `<span class="dot dot-bad"></span>保存失败：${esc(error)} <button class="btn btn-outline btn-sm" data-action="retry-save">重试</button>`;
  return status === 'saved' ? `${icon('check')}已保存` : '保存中…';
}

function viewTabbar(state) {
  return NAV.map(n => `<button class="${activeNav(state) === n.view ? 'active' : ''}" data-action="go" data-view="${n.view}">${icon(n.icon)}${n.name}</button>`).join('');
}

/* ---------- 作品列表首页 ---------- */
function viewWorks(state) {
  const works = state.works.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const hero = '<section class="hero"><h1>让作品的故事，长成画面</h1></section>';
  if (!works.length) {
    return `${hero}<div class="empty"><h2>还没有作品</h2>
      <p>从上传一件作品的照片开始；也可以先载入示例，看看整个流程。</p>
      <div class="choices"><button class="btn btn-primary" data-action="new-work">新建作品</button><button class="btn btn-outline" data-action="load-sample">载入示例作品</button></div></div>`;
  }
  const cards = works.map(w => {
    const cover = coverOf(w);
    return `<button class="work-card" data-action="open-work" data-id="${w.id}">
      <div class="work-cover stage">${cover ? `<img src="${cover}" alt="">` : '<span class="placeholder">间</span>'}</div>
      <div class="work-meta"><h2>${esc(w.name)}</h2>
        <div class="row">${statusChip(w)}<span class="time">${fmtTime(w.updatedAt)}</span></div></div></button>`;
  }).join('');
  return `${hero}<div class="work-grid">${cards}
    <button class="work-card new" data-action="new-work"><span class="plus">${icon('plus')}</span>新建作品</button></div>`;
}

/* ---------- 步骤条 ---------- */
function viewSteps(work) {
  return `<nav class="steps" aria-label="创作步骤">${STEPS.map((s, i) => {
    const st = stepState(work, s.id);
    const current = work.step === s.id;
    const mark = st === 'done' ? icon('check') : st === 'stale' ? icon('alert') : i + 1;
    return `<button class="step ${st} ${current ? 'current' : ''}" data-action="goto-step" data-step="${s.id}" aria-label="${s.name}，${STEP_STATE_TEXT[st]}" ${current ? 'aria-current="step"' : ''}>
      <span class="mark" aria-hidden="true">${mark}</span>${s.name}</button>`;
  }).join('')}</nav>`;
}

const srcTag = src => {
  const map = { chat: ['src-chat', '来自对话'], scene: ['src-scene', '来自布景'], longterm: ['src-longterm', '来自长期风格'], user: ['src-user', '我改的'], preset: ['src-scene', '来自推荐'], prompt: ['src-chat', '来自提示词'], story: ['src-story', '来自共创'] };
  const [cls, text] = map[src] || [];
  return cls ? `<span class="src ${cls}">${text}</span>` : '';
};

/* ---------- 工作区外壳 ---------- */
function viewWorkspace(state, work) {
  const editors = { asset: viewAssetStep, info: viewInfoStep, story: viewStoryStep, plan: viewPlanStep, output: viewOutputStep };
  const pane = state.pane || 'edit';
  return `${viewSteps(work)}
    <div class="pane-tabs segmented" role="group" aria-label="切换编辑与对话">
      <button aria-pressed="${pane === 'edit'}" data-action="pane" data-pane="edit">编辑</button>
      <button aria-pressed="${pane === 'chat'}" data-action="pane" data-pane="chat">对话</button></div>
    <div class="workspace" data-pane="${pane}">
      <section class="panel editor" aria-label="作品编辑区">${(editors[work.step] || viewAssetStep)(work, state)}</section>
      ${viewAssistant(work)}
    </div>`;
}

/* ---------- 演示设置（只给演示和试用的人用） ---------- */
function viewDemoSettings(work, state) {
  return `<div class="demo-settings">
      <div class="field">
        <span class="field-label">这件作品的资产路线</span>
        <div class="segmented" role="group" aria-label="资产路线">
          <button data-action="route" data-route="A" aria-pressed="${work.route === 'A'}">A · 先做白底</button>
          <button data-action="route" data-route="B" aria-pressed="${work.route === 'B'}">B · 原图直出</button></div>
        <p class="field-hint">用于白底路线的 A/B 对比（PRD 4.3），默认 A。每次生成都会记录路线；切换会撤销资产确认。</p>
        ${work.tasks.length ? `<p class="field-hint">已生成的任务：${work.tasks.map((t, i) => `#${i + 1} 路线 ${t.route}`).join(' · ')}</p>` : ''}
      </div>
      <label class="check"><input type="checkbox" data-bind-global="demoFailNext" ${state.demoFailNext ? 'checked' : ''}>下次生成时，模拟其中一张失败</label>
    </div>`;
}

/* ---------- 助手面板 ---------- */
function agentChecklist(work) {
  const s = work.story;
  const lists = {
    asset: [['上传整体图', work.assets.some(a => a.kind === 'overall')], ['补充背面或细节（可选）', work.assets.some(a => a.kind !== 'overall')], ['对照检查并确认', work.assetsConfirmed]],
    info: [['品类', Boolean(work.info.category)], ['材料', Boolean(work.info.material || work.info.materialUnknown)], ['尺寸', Boolean(work.info.size || work.info.sizeUnknown)], ['不可改变的细节（可选）', Boolean(work.info.keep)]],
    story: STORY_QUESTIONS.map(q => [q.label, Boolean(s.answers[q.key]) || (q.key === 'inspiration' && s.noStory)]).concat([['确认三项总结', s.summaryConfirmed]]),
    plan: [['确定风格', styleReady(work)], ['选择比例', Boolean(work.ratio)], ['审核方案与提示词', Boolean(work.approvedV)], ['批准当前版本', approvalValid(work)]],
    output: [['生成两张候选', work.tasks.length > 0], ['分别验收还原度与风格', work.results.some(r => r.fidelity !== 'none' && r.style !== 'none')], ['导出满意的结果', work.results.some(r => r.exportedAt)]],
  };
  const items = lists[work.step] || [];
  const nowIndex = items.findIndex(([, done]) => !done);
  // 完成=勾，当前=深色圈，待办=浅色圈；圈由 CSS 画，读屏读状态文字
  return items.map(([text, done], i) => {
    const now = !done && i === nowIndex;
    return `<li class="${done ? 'done' : now ? 'now' : ''}"><span class="ico" aria-hidden="true">${done ? icon('check') : ''}</span><span class="sr-only">${done ? '已完成：' : now ? '进行中：' : ''}</span>${esc(text)}</li>`;
  }).join('');
}

function contextOptions(work) {
  const s = work.story;
  if (work.step === 'story' && !s.summaryConfirmed && s.q < STORY_QUESTIONS.length) {
    const q = STORY_QUESTIONS[s.q];
    return `<button class="choice" data-action="story-recommend" data-key="${q.key}">我不知道，给我推荐</button>
      ${q.allowNoStory ? '<button class="choice" data-action="story-nostory">暂无明确故事</button>' : ''}`;
  }
  if (work.step === 'plan') return '<button class="choice" data-action="plan-recommend">给我推荐方向</button>';
  return '';
}

function viewAssistant(work) {
  const msgs = work.chat.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'bot'}"><span class="sr-only">${m.role === 'user' ? '你：' : '小间：'}</span>${esc(m.text)}</div>`).join('');
  return `<aside class="panel assistant" aria-label="创作助手小间">
    <div class="assistant-head"><span class="brand-mark" aria-hidden="true">间</span><h2>小间</h2><span class="chip chip-demo">规则引导 · 未接 AI</span></div>
    <ul class="agent-steps" aria-label="这一步要做的事">${agentChecklist(work)}</ul>
    <div class="chat-list" id="chat-list" aria-live="polite">${msgs}</div>
    <div class="ctx-options">${contextOptions(work)}</div>
    <form class="chat-form" id="chat-form">
      <label class="sr-only" for="chat-input">和小间说（Enter 发送，Shift+Enter 换行）</label>
      <textarea id="chat-input" rows="2" maxlength="500" placeholder="和小间说…" title="Enter 发送，Shift+Enter 换行"></textarea>
      <div class="row"><small id="chat-count"></small><button class="send-btn" type="submit" aria-label="发送">${icon('send')}</button></div>
    </form></aside>`;
}

/* ---------- 01 资产（FR-02） ---------- */
function mediaCard(asset) {
  const kind = ASSET_KINDS[asset.kind];
  return `<div class="media">
    <button class="media-img stage" data-action="zoom" data-src="${asset.dataUrl}" data-caption="${esc(kind)} · ${asset.w}×${asset.h}" aria-label="放大查看${esc(kind)}图">
      <img src="${asset.dataUrl}" alt="${esc(asset.name || kind)}"></button>
    <span class="media-tag"><span class="chip">${esc(kind)}</span>${asset.low ? '<span class="chip chip-warn">分辨率偏低</span>' : ''}</span>
    <div class="media-foot">
      <label class="sr-only" for="kind-${asset.id}">图片类型</label>
      <select id="kind-${asset.id}" data-action-change="asset-kind" data-id="${asset.id}">
        ${Object.entries(ASSET_KINDS).map(([k, v]) => `<option value="${k}" ${asset.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button class="icon-btn" data-action="asset-remove" data-id="${asset.id}" aria-label="删除这张图" title="删除这张图">${icon('close')}</button></div>
  </div>`;
}

function viewAssetStep(work) {
  const overall = work.assets.find(a => a.kind === 'overall');
  const lows = work.assets.filter(a => a.low).length;
  const white = work.route === 'A' ? work.whiteBg : null;
  const canConfirm = overall && (work.route === 'B' || white);
  const whiteSource = white && (work.assets.find(a => a.id === white.sourceId) || overall);
  return `<div class="panel-head"><h2>商品资产</h2></div>
    <div class="panel-body">
      <div class="section-title">参考照片 <span class="muted">${work.assets.length} / ${UPLOAD.maxCount}</span></div>
      <label class="drop" id="drop-zone">
        ${icon('upload', 'drop-icon')}
        <strong>拖入照片，或点击选择</strong>
        <p>JPG、PNG、WebP，单张不超过 10MB</p>
        <input type="file" id="file-input" accept="${UPLOAD.types.join(',')}" multiple class="sr-only">
      </label>
      ${work.assets.length ? `<div class="media-grid">${work.assets.map(a => mediaCard(a)).join('')}</div>` : ''}
      ${work.assets.length && !overall ? '<div class="banner warn">至少需要一张标为「整体」的照片。</div>' : ''}
      ${lows ? `<div class="banner warn">${lows} 张照片分辨率偏低，细节可能看不清，建议补拍。</div>` : ''}

      ${work.route === 'A' && overall ? `
        <div class="section-title">原图和白底对照</div>
        ${white ? `<div class="compare">
            <figure><button class="frame stage" data-action="zoom" data-src="${whiteSource.dataUrl}" data-caption="原图"><img src="${whiteSource.dataUrl}" alt="原图"></button>
              <figcaption><span>原图 · 保留不改</span></figcaption></figure>
            <figure><button class="frame frame-white" data-action="zoom" data-src="${white.dataUrl}" data-caption="白底 · 演示 · 未真实抠图"><img src="${white.dataUrl}" alt="白底图（演示）"></button>
              <figcaption><span>白底 <span class="chip chip-demo">演示 · 未真实抠图</span></span><button class="link-btn" data-action="make-white">重新生成</button></figcaption></figure>
          </div>` : '<div class="banner"><span class="grow">白底图还没生成。</span><button class="btn btn-outline btn-sm" data-action="make-white">生成白底（演示）</button></div>'}` : ''}
      ${overall ? '<p class="field-hint">确认前看看：轮廓完整、数量对、细链和镂空清楚、透明材质没糊。</p>' : ''}
    </div>
    <div class="panel-foot">
      <span class="hint">${work.assetsConfirmed ? '已确认，可以进入下一步' : !overall ? '需要至少一张整体图' : !canConfirm ? '先生成白底图' : '检查无误后确认'}</span>
      <div class="choices">
        ${work.assetsConfirmed ? `<button class="btn btn-outline" data-action="unconfirm-assets">撤销确认</button><button class="btn btn-primary" data-action="goto-step" data-step="info">下一步：信息${icon('next')}</button>`
          : `<button class="btn btn-primary" data-action="confirm-assets" ${canConfirm ? '' : 'disabled'}>确认资产可用</button>`}
      </div></div>`;
}

/* ---------- 02 信息（FR-03） ---------- */
function infoHint(work) {
  const i = work.info;
  return infoReady(work) ? '核心信息已齐' : '还需要：' + [!i.category && '品类', !(i.material || i.materialUnknown) && '材料', !(i.size || i.sizeUnknown) && '尺寸'].filter(Boolean).join('、');
}
function suggestRow(list, field, kind) {
  const s = list.find(x => x.field === field);
  if (!s) return '';
  const shown = kind === 'style' && field === 'tone' ? toneText(s.value) : s.value || '（清空）';
  return `<div class="suggest"><span class="src src-chat">来自对话</span><span class="grow">${esc(shown)}</span>
    <button class="btn btn-primary btn-sm" data-action="adopt" data-kind="${kind}" data-field="${field}">采纳</button>
    <button class="btn btn-ghost btn-sm" data-action="ignore" data-kind="${kind}" data-field="${field}">忽略</button></div>`;
}

function viewInfoStep(work) {
  const i = work.info;
  const stale = work.approvedV && diffSnapshot(approvedPlan(work).snapshot, snapshotOf(work)).includes('商品信息');
  const field = (key, label, extra = '') => `<label class="field-label" for="info-${key}">${label}${extra}</label>`;
  return `<div class="panel-head"><h2>商品信息</h2></div>
    <div class="panel-body">
      ${stale ? '<div class="banner warn"><span class="grow">商品信息改过了，需要回到「方案」重新批准。</span></div>' : ''}
      <div class="form-grid">
        <div class="field">${field('category', '品类')}
          <input type="text" id="info-category" list="category-list" data-bind="info.category" value="${esc(i.category)}" placeholder="如：耳饰、项链、手链" maxlength="20">
          <datalist id="category-list">${CATEGORY_WORDS.map(c => `<option value="${c}">`).join('')}</datalist>
          ${suggestRow(work.infoSuggest, 'category', 'info')}</div>
        <div class="field">${field('material', '主要材料与表面质感')}
          <input type="text" id="info-material" data-bind="info.material" value="${esc(i.material)}" placeholder="如：黄铜镀金、淡水珍珠" maxlength="40" ${i.materialUnknown ? 'disabled' : ''}>
          <label class="check"><input type="checkbox" data-bind="info.materialUnknown" data-rerender ${i.materialUnknown ? 'checked' : ''}>材料未知</label>
          ${suggestRow(work.infoSuggest, 'material', 'info')}</div>
        <div class="field">${field('size', '实际尺寸')}
          <input type="text" id="info-size" data-bind="info.size" value="${esc(i.size)}" placeholder="如：长 2.4cm" maxlength="30" ${i.sizeUnknown ? 'disabled' : ''}>
          <label class="check"><input type="checkbox" data-bind="info.sizeUnknown" data-rerender ${i.sizeUnknown ? 'checked' : ''}>尺寸未知</label>
          ${suggestRow(work.infoSuggest, 'size', 'info')}</div>
        <div class="field full">${field('keep', '不可改变的细节', '<em>建议填写，生成时会严格保留</em>')}
          <textarea id="info-keep" data-bind="info.keep" maxlength="300" placeholder="如：一对两只；叶片上有手刻叶脉；珍珠在上、叶片在下，不能调换">${esc(i.keep)}</textarea></div>
      </div>
      <details class="more" ${i.price || i.audience ? 'open' : ''}><summary>${icon('down', 'sum-icon')}售价和目标顾客（选填）</summary>
        <div class="form-grid">
          <div class="field">${field('price', '售价或区间')}
            <input type="text" id="info-price" data-bind="info.price" value="${esc(i.price)}" placeholder="如：128 元" maxlength="20"></div>
          <div class="field">${field('audience', '目标顾客／购买用途')}
            <input type="text" id="info-audience" data-bind="info.audience" value="${esc(i.audience)}" placeholder="如：自己日常戴、送朋友" maxlength="40"></div>
        </div></details>
    </div>
    <div class="panel-foot"><span class="hint" id="step-hint">${infoHint(work)}</span>
      <div class="choices"><button class="btn btn-outline" data-action="goto-step" data-step="asset">${icon('back')}资产</button>
      <button class="btn btn-primary" data-action="goto-step" data-step="story">下一步：共创${icon('next')}</button></div></div>`;
}

/* ---------- 03 共创（FR-04） ---------- */
function pickPanel(work, q) {
  const set = work.story.cardSet[q.key] || 0;
  const cards = q.cards[set % q.cards.length];
  return `<div class="pick-panel">
    <div class="cards3">${cards.map((c, idx) => `<button class="pick-card" data-action="story-pick" data-key="${q.key}" data-idx="${idx}">
      <strong>${esc(c.title)}</strong><span class="small">${esc(c.text)}</span><small>${esc(c.why)}</small></button>`).join('')}</div>
    <div class="choices"><button class="btn btn-outline btn-sm" data-action="story-shuffle" data-key="${q.key}">换一组（${set % q.cards.length + 1}/${q.cards.length}）</button>
      <button class="btn btn-ghost btn-sm" data-action="story-none" data-key="${q.key}">都不合适，我自己写</button>
      <span class="field-hint">选了也能再改；推荐不会替你编故事。</span></div></div>`;
}

function viewStoryStep(work) {
  const s = work.story;
  const allAnswered = s.q >= STORY_QUESTIONS.length;
  const questions = STORY_QUESTIONS.map((q, idx) => {
    const current = idx === s.q && !s.summaryConfirmed;
    const isNoStory = q.key === 'inspiration' && s.noStory;
    const picking = s.picking === q.key;
    // 「我不知道」只放在当前这题下，推荐卡展开后不再重复；题目说明放进输入框的提示语，不单独占一行
    const helpers = current && !isNoStory ? [
      picking ? '' : `<button class="btn btn-outline btn-sm" data-action="story-recommend" data-key="${q.key}">我不知道，给我推荐</button>`,
      q.allowNoStory ? '<button class="btn btn-ghost btn-sm" data-action="story-nostory">暂无明确故事</button>' : '',
    ].join('') : '';
    return `<div class="field question ${current ? 'q-current' : ''}">
      <label class="field-label" for="story-${q.key}">${q.label}${s.sources[q.key] === 'user' ? '' : srcTag(s.sources[q.key])}</label>
      ${isNoStory ? `<div class="banner"><span class="grow">已记为「暂无明确故事」，之后以造型和材质为主。</span><button class="btn btn-ghost btn-sm" data-action="story-nostory-undo">我想补充</button></div>`
        : `<textarea id="story-${q.key}" data-bind="story.answers.${q.key}" maxlength="300" placeholder="${esc(q.short)}">${esc(s.answers[q.key] || '')}</textarea>`}
      ${helpers ? `<div class="choices">${helpers}</div>` : ''}
      ${picking ? pickPanel(work, q) : ''}
    </div>`;
  }).join('');

  const sum = s.summary;
  const summaryBlock = !sum ? '<p class="field-hint">四个问题答完后，这里会起草总结。</p>' : `
    ${s.summaryConfirmed ? '' : `<div class="banner warn"><span class="grow">${s.summarySrc === 'user' ? '你改过总结，' : '这是按你的回答起草的，'}请检查后确认。</span></div>`}
    <div class="form-grid">
      <div class="field full"><label class="field-label" for="sum-express">作品想表达什么</label>
        <textarea id="sum-express" data-bind="story.summary.express" maxlength="200">${esc(sum.express)}</textarea></div>
      <div class="field"><label class="field-label" for="sum-feel">希望顾客感受到什么</label>
        <textarea id="sum-feel" data-bind="story.summary.feel" maxlength="200">${esc(sum.feel)}</textarea></div>
      <div class="field"><label class="field-label" for="sum-avoid">明确避免什么</label>
        <textarea id="sum-avoid" data-bind="story.summary.avoid" maxlength="200">${esc(sum.avoid)}</textarea></div>
    </div>`;

  return `<div class="panel-head"><h2>深入共创</h2></div>
    <div class="panel-body">
      ${questions}
      <div class="section-title">三项总结</div>
      ${summaryBlock}
    </div>
    <div class="panel-foot"><span class="hint">${s.summaryConfirmed ? '共创完成' : sum ? '确认总结后共创才算完成' : allAnswered ? '' : `还有 ${STORY_QUESTIONS.length - s.q} 个问题`}</span>
      <div class="choices"><button class="btn btn-outline" data-action="goto-step" data-step="info">${icon('back')}信息</button>
        ${s.summaryConfirmed ? `<button class="btn btn-primary" data-action="goto-step" data-step="plan">下一步：方案${icon('next')}</button>`
          : `<button class="btn btn-primary" data-action="story-confirm" ${sum && sum.express && sum.feel ? '' : 'disabled'}>确认总结</button>`}</div></div>`;
}

/* ---------- 04 方案（FR-05 ~ FR-08）：风格部分 ---------- */
/* ---------- 04 方案：按共创回答推荐（规则模版；模版覆盖不到的说法留给 AI 共创） ---------- */
const STORY_REASON = { feel: word => `你希望顾客感到「${word}」`, express: word => `作品表达里有「${word}」`, avoid: word => `你想避免「${word}」` };
const STORY_REC_FIELDS = ['tone', 'background', 'light', 'props', 'composition'];

function viewStoryRec(work, ss) {
  const rows = STORY_REC_FIELDS.filter(f => ss.picks[f]).map(f => {
    const p = ss.picks[f];
    return `<li><span class="k">${STYLE_LABELS[f]}</span><strong>${esc(styleValueText(f, p.value))}</strong><span class="why">${esc(STORY_REASON[p.part](p.word))}</span></li>`;
  });
  if (rows.length && !work.style.placement) rows.push('<li><span class="k">摆放</span><strong>平铺</strong><span class="why">默认，不需要额外角度的照片</span></li>');
  const seen = new Set();
  const exRows = ss.excludes.filter(e => !seen.has(`${e.field}:${e.value}`) && seen.add(`${e.field}:${e.value}`))
    .map(e => `<li class="ex"><span class="k">不推荐</span><strong>${esc(styleValueText(e.field, e.value))}</strong><span class="why">${esc(STORY_REASON.avoid(e.word))}</span></li>`);
  if (!rows.length && !exRows.length && !ss.unmatched.length) return '';
  const applied = Boolean(work.style.placement) && STORY_REC_FIELDS.every(f => !ss.picks[f] || (work.style[f] || '') === ss.picks[f].value);
  const clip = t => (t.length > 18 ? `${t.slice(0, 18)}…` : t);
  return `<div class="story-rec">
    <div class="story-rec-head"><strong>按共创回答推荐</strong><span class="chip chip-demo">规则模版 · 未接 AI</span>
      ${rows.length ? `<button class="btn ${applied ? 'btn-ghost' : 'btn-primary'} btn-sm" data-action="apply-story" ${applied ? 'disabled' : ''}>${applied ? '已套用' : '全部套用'}</button>` : ''}</div>
    ${rows.length || exRows.length ? `<ul class="story-rec-list">${rows.join('')}${exRows.join('')}</ul>` : ''}
    ${ss.unmatched.length ? `<p class="field-hint">${ss.unmatched.slice(0, 2).map(u => `「${esc(clip(u))}」`).join('、')}${ss.unmatched.length > 2 ? ` 等 ${ss.unmatched.length} 句` : ''}没有匹配到规则模版，接入 AI 后由 AI 共创帮你转成画面（原型未接入）。</p>` : ''}
  </div>`;
}

function storyNoteRow(work, field, ss) {
  const note = storyNote(work, field, ss);
  if (!note) return '';
  return `<div class="story-note"><span class="grow">${esc(note.text)}</span>
    ${note.fix != null ? `<button class="btn btn-primary btn-sm" data-action="story-fix" data-field="${field}" data-value="${esc(note.fix)}">换成${esc(styleValueText(field, note.fix))}</button>` : ''}
    <button class="btn btn-ghost btn-sm" data-action="story-keep" data-field="${field}">保留</button></div>`;
}

const recMark = '<span class="sr-only">（按共创推荐）</span>';
// 有选项的字段：「自己描述」是选项行末尾的小输入框，只显示选项以外的说法（2026-10-30 用户确认），长提示放悬停提示
function styleField(work, ss, field, label, options, placeholder, full = true) {
  const value = work.style[field] || '';
  const rec = ss.picks[field]?.value;
  const custom = options && !options.includes(value) ? value : '';
  const input = options
    ? `<input type="text" id="style-${field}" class="choice-input ${custom ? 'filled' : ''}" data-bind="style.${field}" value="${esc(custom)}" maxlength="60" placeholder="自己描述…" title="${esc(placeholder)}">`
    : `<input type="text" id="style-${field}" data-bind="style.${field}" value="${esc(value)}" maxlength="60" placeholder="${esc(placeholder)}">`;
  return `<div class="field ${full ? 'full' : ''}">
    <span class="field-label">${label}${srcTag(work.styleSrc[field])}</span>
    <label class="sr-only" for="style-${field}">${label}${options ? '（自己描述）' : ''}</label>
    ${options ? `<div class="choices">${options.map(o => `<button class="choice ${rec === o ? 'rec' : ''}" data-action="style-set" data-field="${field}" data-value="${esc(o)}" aria-pressed="${value === o}">${esc(o)}${rec === o ? recMark : ''}</button>`).join('')}${input}</div>` : input}
    ${suggestRow(work.styleSuggest, field, 'style')}
    ${storyNoteRow(work, field, ss)}</div>`;
}

function viewStyleSection(work, state) {
  const s = work.style;
  const tone = toneOption(s.tone);
  const scenes = state.scenes;
  const lt = state.longTerm.style;
  const hasLongTerm = Object.values(lt).some(Boolean);
  const conflicts = styleConflicts(s);
  const scene = work.sceneRef && scenes.find(x => x.id === work.sceneRef.id);
  const ss = storyStyle(work);
  return `
    <div class="section-title">风格</div>
    ${viewStoryRec(work, ss)}
    <div class="choices">
      <button class="btn btn-outline btn-sm" data-action="plan-recommend">${state.showPresets ? '收起其他方向' : '其他推荐方向'}</button>
      ${scenes.length ? `<label class="sr-only" for="scene-pick">复用摄影布景</label>
        <select id="scene-pick" class="input" data-action-change="apply-scene">
          <option value="">复用摄影布景…</option>${scenes.map(x => `<option value="${x.id}">${esc(x.name)} · v${x.version}</option>`).join('')}</select>` : ''}
      ${hasLongTerm ? '<button class="btn btn-outline btn-sm" data-action="apply-longterm">套用我的长期风格</button>' : ''}
    </div>
    ${scene ? `<div class="banner"><span class="grow">风格来自布景「${esc(scene.name)}」v${work.sceneRef.version}，只带入布景参数，不带入旧作品的细节和故事。</span></div>` : ''}
    ${state.showPresets ? `<div class="cards3">${PRESET_DIRECTIONS.map((p, i) => `<button class="pick-card" data-action="apply-preset" data-idx="${i}">
        <div class="palette-strip">${toneOption(p.tone).colors.map(c => `<span style="background:${c}"></span>`).join('')}</div>
        <strong>${esc(p.name)}</strong><span class="small">${esc(p.background)} · ${esc(p.light)}</span><small>${esc(p.why)}</small></button>`).join('')}</div>` : ''}
    ${conflicts.length ? `<div class="banner bad"><span class="grow"><strong>风格有冲突，请你决定：</strong><br>${conflicts.map(esc).join('<br>')}</span></div>` : ''}
    <div class="form-grid">
      <div class="field full"><span class="field-label">色调${srcTag(work.styleSrc.tone)}</span>
        <div class="swatches">${STYLE_OPTIONS.tone.map(o => `<button class="swatch ${ss.picks.tone?.value === o.id ? 'rec' : ''}" data-action="style-set" data-field="tone" data-value="${o.id}" aria-pressed="${s.tone === o.id}">
          <i style="background:linear-gradient(135deg,${o.colors[0]},${o.colors[2]})"></i>${o.name}<span class="muted">${o.desc}</span>${ss.picks.tone?.value === o.id ? recMark : ''}</button>`).join('')}</div>
        ${s.tone && !tone ? `<p class="field-hint">自定义：${esc(s.tone)}</p>` : ''}
        ${suggestRow(work.styleSuggest, 'tone', 'style')}
        ${storyNoteRow(work, 'tone', ss)}</div>
      ${styleField(work, ss, 'background', '背景', STYLE_OPTIONS.background, '或者自己描述，如：旧木桌面')}
      ${styleField(work, ss, 'light', '光线', STYLE_OPTIONS.light, '不用摄影术语，如：像早上窗边的光')}
      ${styleField(work, ss, 'placement', '摆放', STYLE_OPTIONS.placement, '平铺、悬挂或支架；需要有对应角度的照片')}
      ${styleField(work, ss, 'props', '道具', null, '如：一小片苔藓；不要道具就留空', false)}
      ${styleField(work, ss, 'propsBanned', '禁止出现', null, '如：花、文字、手', false)}
      ${styleField(work, ss, 'composition', '构图', STYLE_OPTIONS.composition, '主体占比、位置、留白')}
    </div>
    <div class="choices">
      <button class="btn btn-ghost btn-sm" data-action="save-scene-from-plan">把当前风格存为布景</button>
      <button class="btn btn-ghost btn-sm" data-action="update-longterm">更新为我的长期风格</button>
    </div>`;
}

/* ---------- 04 方案：比例、可读方案、提示词、批准 ---------- */
function planReadableRows(work) {
  const i = work.info;
  const sum = work.story.summary || draftSummary(work);
  const s = work.style;
  return [
    ['info', '保真', `不改变颜色、数量、轮廓、连接结构与纹样${i.keep ? `；${i.keep}` : ''}`],
    ['summary', '表达', `${sum.express}；希望顾客感受到：${sum.feel || '—'}；避免：${sum.avoid || '—'}`],
    ['style.background', '背景', s.background || '—'],
    ['style.tone', '色调', s.tone ? toneText(s.tone) : '—'],
    ['style.light', '光线', s.light || '—'],
    ['style.placement', '摆放', s.placement || '—'],
    ['style.props', '道具', s.props || '无道具'],
    ['style.propsBanned', '禁止出现', s.propsBanned || '—'],
    ['style.composition', '构图', s.composition || '—'],
    ['ratio', '比例', work.ratio],
    ['count', '候选数量', `${CANDIDATE_COUNT} 张，同一方案`],
  ];
}

function planBlockers(work) {
  const list = generateBlockers(work).filter(([step]) => step !== 'plan' && step !== 'output').map(([, text]) => text);
  const missing = STYLE_REQUIRED.filter(k => !work.style[k]).map(k => STYLE_LABELS[k]);
  if (missing.length) list.push(`风格还缺${missing.join('、')}`);
  if (styleConflicts(work.style).length) list.push('风格有冲突（见上方红色提示）');
  if (work.promptEdited != null) {
    const { conflicts } = parsePrompt(work.promptEdited, work);
    if (conflicts.length) list.push('提示词与方案有冲突，需要处理');
    else list.push('提示词改动还没同步到方案');
  }
  if (approvalValid(work)) list.push('当前版本已经批准过了');
  return list;
}

function viewPlanLower(work) {
  const plan = approvedPlan(work);
  const valid = approvalValid(work);
  const changed = plan && !valid ? new Set(Object.keys(SNAPSHOT_LABELS).filter(k => plan.snapshot[k] !== snapshotOf(work)[k])) : new Set();
  const rows = planReadableRows(work).map(([key, label, text]) => `<div class="plan-row ${changed.has(key) ? 'changed' : ''}"><span>${label}</span><div>${esc(text)}</div></div>`).join('');
  const parsed = work.promptEdited != null ? parsePrompt(work.promptEdited, work) : null;
  const blockers = planBlockers(work);
  const nextV = work.plans.length + 1;
  // 分段显示：风格选齐前不展示满屏「—」的可读方案和提示词（已手动改过提示词时照常展示，免得改动看不见）
  const showPlan = styleReady(work) || parsed;
  return `
    <div class="section-title">比例 <span class="muted">每次选一种</span></div>
    <div>
      <div class="segmented" role="group" aria-label="选择比例">${Object.keys(RATIOS).map(r => `<button data-action="set-ratio" data-ratio="${r}" aria-pressed="${work.ratio === r}">${r}</button>`).join('')}</div>
      <p class="ratio-note">${esc(RATIOS[work.ratio].note)}</p>
    </div>

    <div class="section-title">可读方案</div>
    ${showPlan ? `<div class="plan-table">${rows}</div>

    <details class="prompt" ${parsed ? 'open' : ''}>
      <summary>${icon('down', 'sum-icon')}完整提示词 ${parsed ? '<span class="chip chip-warn">已手动修改</span>' : '<span class="chip">与方案一致</span>'}</summary>
      <div class="prompt-box">
        <p class="field-hint">风格相关的行改了能同步回方案；其他行来自前面的步骤，请回原步骤改。</p>
        <label class="sr-only" for="prompt-text">完整提示词</label>
        <textarea id="prompt-text" spellcheck="false">${esc(currentPrompt(work))}</textarea>
        ${parsed && parsed.conflicts.length ? `<div class="banner bad"><span class="grow"><strong>提示词和方案对不上，不能批准：</strong><br>${parsed.conflicts.map(esc).join('<br>')}</span></div>` : ''}
        <div class="choices">
          <button class="btn btn-outline btn-sm" data-action="prompt-sync" ${parsed ? '' : 'disabled'}>同步到方案</button>
          <button class="btn btn-ghost btn-sm" data-action="prompt-reset" ${parsed ? '' : 'disabled'}>还原为方案生成的提示词</button>
        </div>
      </div>
    </details>` : '<p class="field-hint">风格选齐后，这里会显示可读方案和完整提示词。</p>'}

    <div class="approve-box approve-bar">
      ${valid ? `<div class="grow"><strong>已批准 v${plan.v}</strong> · ${fmtTime(plan.approvedAt)} · 再改任何一项都要重新批准</div>
        <button class="btn btn-primary" data-action="goto-step" data-step="output">去出图${icon('next')}</button>`
      : `<div class="grow">${blockers.length ? `<span class="approve-warn">还不能批准：${blockers.map(esc).join('；')}</span>`
          : `<strong>可以批准 v${nextV}</strong> · 锁定当前方案（${esc(work.ratio)} · ${CANDIDATE_COUNT} 张候选），保存和聊天都不算批准`}</div>
        <button class="btn btn-primary" data-action="approve-plan" ${blockers.length ? 'disabled' : ''}>批准 v${nextV}</button>`}
    </div>`;
}

function viewPlanStep(work, state) {
  const plan = approvedPlan(work);
  const valid = approvalValid(work);
  const diff = plan && !valid ? diffSnapshot(plan.snapshot, snapshotOf(work)) : [];
  const parent = work.revision && work.results.find(r => r.id === work.revision.fromResultId);
  return `<div class="panel-head"><h2>摄影方案</h2></div>
    <div class="panel-body">
      ${parent ? `<div class="banner warn"><span class="grow">正在从「任务 #${work.tasks.findIndex(t => t.id === parent.taskId) + 1} · 候选 ${parent.slot}」修改${work.revision.reasons.length ? `（不满意：${esc(work.revision.reasons.join('、'))}）` : ''}。改好后重新批准，原结果会保留。</span><button class="btn btn-ghost btn-sm" data-action="cancel-revision">取消修改</button></div>` : ''}
      ${diff.length ? `<div class="banner warn"><span class="grow">v${plan.v} 批准后改了：<strong>${esc(diff.join('、'))}</strong>，需要重新批准。</span></div>` : ''}
      ${viewStyleSection(work, state)}
      ${viewPlanLower(work)}
    </div>
    <div class="panel-foot"><span class="hint"></span>
      <div class="choices"><button class="btn btn-outline" data-action="goto-step" data-step="story">${icon('back')}共创</button>
        <button class="btn btn-outline" data-action="goto-step" data-step="output">出图${icon('next')}</button></div></div>`;
}

/* ---------- 05 出图（FR-08 ~ FR-10） ---------- */
const TASK_STATUS = { queued: ['排队中', ''], running: ['处理中', ''], success: ['成功', 'ok'], partial: ['部分成功', 'warn'], failed: ['失败', 'bad'] };
const VERDICT_TEXT = { none: '未评价', ok: '满意', bad: '不满意' };
const STEP_FIX = { asset: '去确认资产', info: '去补信息', story: '去确认总结', plan: '去批准方案' };

function verdictRow(r, kind, label) {
  const value = r[kind];
  const issues = ISSUES[kind];
  return `<div class="verdict-row"><strong>${label}</strong>
      <button class="mini-btn ok" data-action="verdict" data-id="${r.id}" data-kind="${kind}" data-value="ok" aria-pressed="${value === 'ok'}">满意</button>
      <button class="mini-btn bad" data-action="verdict" data-id="${r.id}" data-kind="${kind}" data-value="bad" aria-pressed="${value === 'bad'}">不满意</button>
      ${value === 'none' ? '<span class="small muted">未评价</span>' : ''}</div>
    ${value === 'bad' ? `<div class="issues">${issues.map(i => `<button class="choice" data-action="issue" data-id="${r.id}" data-issue="${i}" aria-pressed="${r.issues.includes(i)}">${i}</button>`).join('')}</div>` : ''}`;
}

function candidateCard(work, r, compareIds) {
  const { w, h } = RATIOS[r.ratio];
  const frame = `<div class="cand-frame stage" style="aspect-ratio:${w}/${h}">
      <span class="media-tag"><span class="chip">候选 ${r.slot}</span><span class="chip chip-demo">演示</span>${isComplete(r) ? '<span class="chip chip-ok">已完成</span>' : ''}</span>
      ${r.status === 'success' ? `<button class="cand-zoom" data-action="zoom" data-src="${r.dataUrl}" data-caption="候选 ${r.slot} · ${r.ratio} · 演示 · 非 AI 生成" aria-label="放大查看候选 ${r.slot}"><img src="${r.dataUrl}" alt="候选 ${r.slot}（演示图）"></button>`
        : r.status === 'failed' ? `<div class="pending"><span class="chip chip-bad">这一张失败</span><span>另一张已保留，可以单独补齐。</span><button class="btn btn-outline btn-sm" data-action="retry-result" data-id="${r.id}">补齐这一张</button></div>`
        : `<div class="pending"><span class="spinner" aria-hidden="true"></span>${r.status === 'queued' ? '排队中' : '处理中'}<span class="small">演示，没有真实进度</span></div>`}
    </div>`;
  if (r.status !== 'success') return `<div class="cand">${frame}</div>`;
  const original = work.assets.find(a => a.kind === 'overall');
  return `<div class="cand">${frame}
    <div class="verdict">
      ${verdictRow(r, 'fidelity', '还原度')}
      ${original ? `<p class="verdict-ref">对照原图：<button class="link-btn" data-action="zoom" data-src="${original.dataUrl}" data-caption="原图">查看</button></p>` : ''}
      ${verdictRow(r, 'style', '风格')}
    </div>
    <div class="cand-actions">
      ${isComplete(r) ? `<button class="btn btn-primary btn-sm" data-action="export" data-id="${r.id}">${icon('download')}导出图片</button>
        <button class="btn btn-outline btn-sm" data-action="save-scene-from-result" data-id="${r.id}">存为布景</button>`
        : r.fidelity === 'bad' || r.style === 'bad' ? `<button class="btn btn-primary btn-sm" data-action="revise" data-id="${r.id}">从这一版修改</button>` : ''}
      <label class="check"><input type="checkbox" data-action-change="compare" data-id="${r.id}" ${compareIds.includes(r.id) ? 'checked' : ''}>加入对比</label>
      ${r.exportedAt ? `<span class="small muted">已导出 ${fmtTime(r.exportedAt)}</span>` : ''}
    </div></div>`;
}

function viewCompare(work, ids) {
  const items = ids.map(id => work.results.find(r => r.id === id)).filter(Boolean);
  if (items.length < 2) return '';
  const [a, b] = items;
  const planOf = r => work.plans.find(p => p.v === r.planV);
  const diff = diffSnapshot(planOf(a)?.snapshot, planOf(b)?.snapshot);
  const col = r => { const p = planOf(r); const t = work.tasks.findIndex(x => x.id === r.taskId) + 1;
    return `<div class="version-col"><div class="cand-frame stage" style="aspect-ratio:${RATIOS[r.ratio].w}/${RATIOS[r.ratio].h}"><img src="${r.dataUrl}" alt="任务 ${t} 候选 ${r.slot}"></div>
      <div class="plan-table">
        <div class="plan-row"><span>来源</span><div>任务 #${t} · 候选 ${r.slot}</div></div>
        <div class="plan-row"><span>方案</span><div>v${r.planV}</div></div>
        <div class="plan-row"><span>比例</span><div>${r.ratio}</div></div>
        <div class="plan-row"><span>光线</span><div>${esc(p?.style.light || '—')}</div></div>
        <div class="plan-row"><span>背景</span><div>${esc(p?.style.background || '—')}</div></div>
        <div class="plan-row"><span>验收</span><div>还原度 ${VERDICT_TEXT[r.fidelity]} · 风格 ${VERDICT_TEXT[r.style]}</div></div>
      </div></div>`; };
  return `<div class="section-title">版本对比</div>
    <div class="banner"><span class="grow">${a.planV === b.planV ? '两张来自同一版方案。' : `方案 v${a.planV} 与 v${b.planV} 的差别：${esc(diff.join('、') || '无')}。`}</span><button class="btn btn-ghost btn-sm" data-action="clear-compare">关闭对比</button></div>
    <div class="versions">${col(a)}${col(b)}</div>`;
}

function viewOutputStep(work, state) {
  const blockers = generateBlockers(work);
  const compareIds = (state.compare || {})[work.id] || [];
  const plan = approvedPlan(work);
  const tasks = work.tasks.slice().reverse().map(task => {
    const n = work.tasks.indexOf(task) + 1;
    const [text, tone] = TASK_STATUS[task.status];
    const results = task.resultIds.map(id => work.results.find(r => r.id === id));
    return `<div class="task"><div class="task-head"><strong>任务 #${n}</strong><span class="chip ${tone ? `chip-${tone}` : ''}">${text}</span>
        <span class="grow">方案 v${task.planV} · ${task.ratio} · ${fmtTime(task.createdAt)}</span></div>
      <div class="task-body">${results.map(r => candidateCard(work, r, compareIds)).join('')}</div></div>`;
  }).join('');
  return `<div class="panel-head"><h2>出图与验收</h2></div>
    <div class="panel-body">
      ${blockers.length ? `<div class="banner bad"><span class="grow"><strong>还不能生成：</strong><br>${blockers.map(([step, text]) => `${esc(text)}${STEP_FIX[step] ? ` <button class="link-btn" data-action="goto-step" data-step="${step}">${STEP_FIX[step]}</button>` : ''}`).join('<br>')}</span></div>` : ''}
      <div class="approve-box">
        <div class="grow">${plan && approvalValid(work) ? `用方案 <strong>v${plan.v}</strong>（${esc(work.ratio)}）生成 ${CANDIDATE_COUNT} 张候选，两项都满意才算完成。` : '方案批准后才能生成。'}</div>
        <button class="btn btn-primary" data-action="generate" ${blockers.length ? 'disabled' : ''}>生成 ${CANDIDATE_COUNT} 张候选（演示）</button>
      </div>
      <p class="field-hint demo-note">演示模式：候选图是本地拼出的示意图，不代表 AI 出图效果。</p>
      ${viewCompare(work, compareIds)}
      ${tasks || '<p class="field-hint">还没有生成过。</p>'}
      ${work.needs.length ? `<div class="section-title">记下的后续需求</div><ul class="intro-list small">${work.needs.map(n => `<li>${esc(n.text)} <span class="muted">· 本期不支持</span></li>`).join('')}</ul>` : ''}
    </div>
    <div class="panel-foot"><span class="hint">${work.results.some(isComplete) ? '可以导出已完成的结果' : '验收两项都满意才算完成'}</span>
      <div class="choices"><button class="btn btn-outline" data-action="goto-step" data-step="plan">${icon('back')}方案</button></div></div>`;
}

/* ---------- 我的风格（FR-06） ---------- */
function viewLongTerm(state) {
  const lt = state.longTerm.style;
  const has = Object.values(lt).some(Boolean);
  const rows = Object.entries(STYLE_LABELS).map(([k, label]) => `<div class="plan-row"><span>${label}</span><div>${esc(k === 'tone' ? toneText(lt[k]) || '—' : lt[k] || '—')}</div></div>`).join('');
  const workName = id => state.works.find(w => w.id === id)?.name || '已删除的作品';
  const log = state.longTerm.log.slice().reverse().map(entry => {
    const changed = Object.keys(STYLE_LABELS).filter(k => (entry.from[k] || '') !== (entry.to[k] || '')).map(k => STYLE_LABELS[k]);
    return `<li>${fmtTime(entry.at)} · 来自「${esc(workName(entry.workId))}」 · 改了：${esc(changed.join('、') || '无')}</li>`;
  }).join('');
  return `<section class="hero"><h1>我的风格</h1>
      <p>店铺长期的视觉偏好，新作品可一键套用；单件作品里的调整不会改到这里。</p></section>
    ${has ? `<div class="page-stack"><div class="plan-table">${rows}</div>
        <p class="field-hint">要修改，在作品的方案步骤里调整后点「更新为我的长期风格」，确认后才会写入。</p>
        <div class="section-title">修改记录</div>
        ${log ? `<ul class="intro-list small">${log}</ul>` : '<p class="field-hint">暂无修改记录。</p>'}</div>`
      : '<div class="empty"><h2>还没有长期风格</h2><p>在作品的「方案」步骤点「更新为我的长期风格」并确认，就会保存在这里。</p></div>'}`;
}

/* ---------- 摄影布景（FR-06） ---------- */
function viewScenes(state) {
  const card = scene => {
    const p = scene.params;
    const tone = toneOption(p.tone);
    const used = state.works.filter(w => w.sceneRef && w.sceneRef.id === scene.id).length;
    return `<article class="scene-card">
      <div class="palette-strip">${(tone ? tone.colors : ['#eee', '#ddd', '#ccc']).map(c => `<span style="background:${c}"></span>`).join('')}</div>
      <div class="body">
        <div class="title-row"><h2>${esc(scene.name)}</h2><span class="chip">v${scene.version}</span>
          <button class="icon-btn" data-action="delete-scene" data-id="${scene.id}" aria-label="删除布景「${esc(scene.name)}」" title="删除布景">${icon('trash')}</button></div>
        <dl>${Object.entries(STYLE_LABELS).map(([k, label]) => `<dt>${label}</dt><dd>${esc(k === 'tone' ? toneText(p[k]) || '—' : p[k] || '—')}</dd>`).join('')}</dl>
        <p class="muted">${used ? `${used} 件作品正在使用` : '暂未被使用'} · 更新于 ${fmtTime(scene.history.length ? scene.history.at(-1).at : scene.createdAt)}</p>
        ${scene.history.length ? `<details class="more"><summary>${icon('down', 'sum-icon')}历史版本（${scene.history.length}）</summary><ul class="intro-list">${scene.history.slice().reverse().map(h => `<li>v${h.version} · ${esc(h.params.background || '—')} · ${esc(h.params.light || '—')}</li>`).join('')}</ul></details>` : ''}
      </div></article>`;
  };
  return `<section class="hero"><h1>摄影布景</h1>
      <p>可复用的背景、色调、光线、道具和布局组合；布景是方案参数，不是某张结果图。</p></section>
    ${state.scenes.length ? `<div class="scene-grid">${state.scenes.map(card).join('')}</div>`
      : '<div class="empty"><h2>还没有布景</h2><p>在方案步骤点「把当前风格存为布景」，或在满意的候选图下点「存为布景」，下一件作品就能复用。</p></div>'}`;
}

/* ---------- 历史结果（FR-09 / FR-10）：图片网格，图下写明来源与验收，点图打开作品 ---------- */
function viewHistory(state) {
  const items = state.works.flatMap(w => w.results.filter(r => r.status === 'success').map(r => ({ w, r, task: w.tasks.find(t => t.id === r.taskId) })))
    .sort((a, b) => b.task.createdAt - a.task.createdAt);
  const list = items.map(({ w, r, task }) => `<button class="result-card" data-action="open-result" data-work="${w.id}" title="打开作品">
      <span class="result-img stage" style="aspect-ratio:${RATIOS[r.ratio].w}/${RATIOS[r.ratio].h}"><img src="${r.dataUrl}" alt="候选 ${r.slot}（演示图）">
        <span class="media-tag"><span class="chip chip-demo">演示</span>${isComplete(r) ? '<span class="chip chip-ok">已完成</span>' : ''}</span></span>
      <span class="result-meta"><span class="result-title"><strong>${esc(w.name)}</strong><span class="tnum">${fmtTime(task.createdAt)}</span></span>
        <span class="tnum">任务 #${w.tasks.indexOf(task) + 1} · 候选 ${r.slot} · 方案 v${r.planV} · ${r.ratio}</span>
        <span class="verdicts">还原度 ${VERDICT_TEXT[r.fidelity]} · 风格 ${VERDICT_TEXT[r.style]}${r.issues.length ? ` · 问题：${esc(r.issues.join('、'))}` : ''}${r.exportedAt ? ` · 已导出 ${fmtTime(r.exportedAt)}` : ''}</span></span>
    </button>`).join('');
  return `<section class="hero"><h1>历史结果</h1></section>
    ${list ? `<div class="result-grid">${list}</div>` : '<div class="empty"><h2>还没有结果</h2><p>在作品的「出图」步骤生成候选后，会出现在这里。</p></div>'}`;
}
