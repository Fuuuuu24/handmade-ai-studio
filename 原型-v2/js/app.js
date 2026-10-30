/* 一间 v2 原型 · app：事件与流程控制 */
'use strict';

const state = Store.load();
const $ = sel => document.querySelector(sel);
const currentWork = () => state.works.find(w => w.id === state.currentId) || null;

/* ---------- 渲染 ---------- */
function renderChrome() {
  const work = currentWork();
  $('#side-nav').innerHTML = viewSideNav(state);
  $('#recent-works').innerHTML = viewRecent(state);
  $('#breadcrumb').innerHTML = viewBreadcrumb(state, work);
  $('#tabbar').innerHTML = viewTabbar(state);
  renderSaveState();
}
function renderSaveState() {
  const el = $('#save-state');
  el.className = `save-state ${Store.status === 'error' ? 'error' : ''}`;
  el.innerHTML = viewSaveState(Store.status, Store.error);
}
function render() {
  if (state.view === 'work' && !currentWork()) state.view = 'works';
  const work = currentWork();
  if (work) work.story.q = nextQuestion(work);   // 题号按答案推算，不依赖存下来的旧值
  const views = { works: () => viewWorks(state), work: () => viewWorkspace(state, work), style: () => viewLongTerm(state), scenes: () => viewScenes(state), history: () => viewHistory(state) };
  const scrollY = window.scrollY;
  const chatScroll = $('#chat-list')?.scrollTop;
  $('#view').innerHTML = (views[state.view] || views.works)();
  renderChrome();
  if (state.view === 'work') {
    window.scrollTo(0, scrollY);
    const chat = $('#chat-list');
    const grew = work.chat.length !== render.lastChatLen || work.id !== render.lastWorkId;
    if (chat) chat.scrollTop = grew || chatScroll == null ? chat.scrollHeight : chatScroll;
    render.lastChatLen = work.chat.length;
    render.lastWorkId = work.id;
  }
  document.title = work && state.view === 'work' ? `${work.name} · 一间` : '一间 · 手作影像工作台';
}
// 只刷新步骤条和状态，不重绘编辑区（输入时保持焦点）
function refreshLight() {
  const work = currentWork();
  const steps = $('.steps');
  if (work && steps) steps.outerHTML = viewSteps(work);
  const chip = $('#work-status');
  if (work && chip) chip.innerHTML = statusChip(work);
  const hint = $('#step-hint');
  if (work && hint && work.step === 'info') hint.textContent = infoHint(work);
  renderChrome();
}
Store.listeners.push(renderSaveState);

/* ---------- 通用反馈 ---------- */
let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
let confirmResolve = null;
function askConfirm(title, bodyHtml, okText = '确定') {
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
// 演示设置弹窗：只给演示和试用的人用（路线 A/B、模拟失败），内容随当前作品刷新
function renderDemo() {
  const work = currentWork();
  if (work) $('#demo-body').innerHTML = viewDemoSettings(work, state);
}
function openLightbox(src, caption) {
  $('#lightbox-body').innerHTML = `<img src="${esc(src)}" alt="${esc(caption)}"><p class="lightbox-caption">${esc(caption)}</p>`;
  $('#lightbox').showModal();
}
function save(work) { Store.touch(work); }

/* ---------- 导航与作品 ---------- */
function go(view) { state.view = view; save(); render(); $('#view').focus({ preventScroll: true }); window.scrollTo(0, 0); }
function openWork(id) { state.currentId = id; state.view = 'work'; save(); render(); window.scrollTo(0, 0); }
function createWork(name) {
  const work = newWork(name);
  work.chat.push({ role: 'bot', text: `你好，我是小间。我们先给「${work.name}」建档：上传至少一张整体照片，有背面或细节图更好。`, at: now() });
  state.works.push(work);
  openWork(work.id);
  return work;
}
// 示例图内联在 js/sample.js：直接用 file:// 打开页面也能载入；图片就绪后才建作品，失败不留空作品
async function loadSample() {
  try {
    const img = await compressImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(SAMPLE_SVG)}`);
    const work = createWork('雨后青苔 · 耳饰');
    work.assets.push({ id: uid('a'), kind: 'overall', name: '示例 · 自制耳饰示意图', ...img });
    work.chat.push({ role: 'bot', text: '已载入示例作品。注意：示例图是自制的示意插画，不是真实商品照片。', at: now() });
    await ensureWhiteBg(work);
    save(work); render();
  } catch (error) {
    toast(`示例图片载入失败：${error.message}`);
  }
}

/* ---------- 事件分发 ---------- */
const actions = {
  go: el => go(el.dataset.view),
  'new-work': () => createWork(),
  'load-sample': () => loadSample(),
  'open-work': el => openWork(el.dataset.id),
  'retry-save': () => { if (Store.flush()) toast('已保存'); },
  'open-intro': () => $('#intro-dialog').showModal(),
  'close-dialog': el => { el.closest('dialog').close(); if (el.closest('#intro-dialog')) { state.seenIntro = true; save(); } },
  'confirm-ok': () => closeConfirm(true),
  'confirm-cancel': () => closeConfirm(false),
  zoom: el => openLightbox(el.dataset.src, el.dataset.caption || ''),
};

document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { event.preventDefault(); fn(el, event); }
});
$('#confirm-dialog').addEventListener('cancel', () => closeConfirm(false));
$('#intro-dialog').addEventListener('close', () => { if (!state.seenIntro) { state.seenIntro = true; save(); } });

/* ---------- 工作区基础交互 ---------- */
function botSay(work, text) { work.chat.push({ role: 'bot', text, at: now() }); }

function gotoStep(work, step) {
  if (work.step === step) return;
  work.step = step;
  const hello = {
    info: '这一步填商品的核心信息。不确定的勾「未知」，我不会替你猜材料或尺寸。也可以直接跟我说，比如「黄铜耳饰，2.4cm」。',
    story: work.story.summaryConfirmed ? '共创总结已经确认过了。要改的话直接编辑总结，改完需要重新确认。' : STORY_QUESTIONS[Math.min(work.story.q, STORY_QUESTIONS.length - 1)].ask,
    plan: '这一步定风格和比例。最上面是按你的共创回答整理的推荐（规则模版），可以一键套用，也可以自己选；也可以直接跟我说，比如「亚麻布背景，窗边侧光，不要花」。',
    output: '方案批准后就能生成两张候选。记得分别看还原度和风格。',
  }[step];
  const last = work.chat[work.chat.length - 1];
  if (hello && (!last || last.text !== hello)) botSay(work, hello);
  save(work); render(); window.scrollTo(0, 0);
}

Object.assign(actions, {
  'goto-step': el => gotoStep(currentWork(), el.dataset.step),
  pane: el => { state.pane = el.dataset.pane; render(); },
  'delete-work': async () => {
    const work = currentWork();
    const ok = await askConfirm(`删除「${work.name}」？`, `<p>作品的照片、共创记录、方案和 ${work.results.length} 张结果都会从这个浏览器删除，<strong>删除后无法找回</strong>。已保存的摄影布景不受影响。</p>`, '删除作品');
    if (!ok) return;
    state.works = state.works.filter(w => w.id !== work.id);
    state.currentId = null;
    go('works');
    toast('作品已删除');
  },
});

document.addEventListener('keydown', event => {
  if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('#chat-form').requestSubmit();
  }
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'chat-form') return;
  event.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  const work = currentWork();
  work.chat.push({ role: 'user', text, at: now() });
  handleChat(work, text);
  save(work); render();
  $('#chat-input')?.focus();
});

function handleChat(work, text) {
  const result = interpretChat(work, text);
  if (result.reply) botSay(work, result.reply);
  if (result.need) work.needs.push({ text: result.need, at: now() });
  if (result.recommend) openStoryPicker(work, result.recommend);
  if (result.answer) {
    applyStoryAnswer(work, result.answer.key, result.answer.value, 'chat');
    const next = STORY_QUESTIONS[work.story.q];
    if (!work.story.summary && next && !result.reply.includes(next.ask)) storyAdvanceMessage(work);
  }
  result.infoSuggest.forEach(s => { work.infoSuggest = work.infoSuggest.filter(x => x.field !== s.field).concat(s); });
  result.styleSuggest.forEach(s => { work.styleSuggest = work.styleSuggest.filter(x => x.field !== s.field).concat(s); });
}
/* ---------- 03 共创 ---------- */
function nextQuestion(work) {
  const s = work.story;
  const idx = STORY_QUESTIONS.findIndex(q => !(s.answers[q.key] || (q.key === 'inspiration' && s.noStory)));
  return idx === -1 ? STORY_QUESTIONS.length : idx;
}
// 故事变了：起草的总结跟着更新；用户改过的总结保留但退回待确认（AC-04.6）
function syncSummary(work) {
  const s = work.story;
  s.q = nextQuestion(work);
  if (s.q < STORY_QUESTIONS.length && !s.summary) return;
  const wasConfirmed = s.summaryConfirmed;
  const firstDraft = !s.summary;
  if (!s.summary || s.summarySrc !== 'user') { s.summary = draftSummary(work); s.summarySrc = 'draft'; }
  s.summaryConfirmed = false;
  if (firstDraft) botSay(work, '四个问题都聊完了。我按你的回答起草了三项总结，请检查后确认。');
  if (wasConfirmed) botSay(work, '故事有改动，三项总结退回待确认。已批准的方案也会因此失效。');
}
function applyStoryAnswer(work, key, value, src) {
  const s = work.story;
  s.answers[key] = value;
  s.sources[key] = src;
  s.picking = null;
  syncSummary(work);
}
function storyAdvanceMessage(work) {
  const q = STORY_QUESTIONS[work.story.q];
  if (q) botSay(work, q.ask);
}
function openStoryPicker(work, key) {
  work.story.picking = key;
  work.step = 'story';
  botSay(work, '给你几个方向参考，每个都写了理由。选一个之后还能改成你自己的话；都不合适可以换一组。');
}

Object.assign(actions, {
  'story-recommend': el => { const work = currentWork(); openStoryPicker(work, el.dataset.key); save(work); render(); },
  'story-shuffle': el => { const work = currentWork(); const k = el.dataset.key; work.story.cardSet[k] = (work.story.cardSet[k] || 0) + 1; save(work); render(); },
  'story-none': el => {
    const work = currentWork();
    work.story.picking = null;
    save(work); render();
    $(`#story-${el.dataset.key}`)?.focus();
  },
  'story-pick': el => {
    const work = currentWork();
    const q = STORY_QUESTIONS.find(x => x.key === el.dataset.key);
    const card = q.cards[(work.story.cardSet[q.key] || 0) % q.cards.length][Number(el.dataset.idx)];
    applyStoryAnswer(work, q.key, `${card.title}：${card.text}`, 'preset');
    if (!work.story.summary) storyAdvanceMessage(work);
    save(work); render();
  },
  'story-nostory': () => {
    const work = currentWork();
    work.story.noStory = true;
    work.story.answers.inspiration = '';
    work.story.picking = null;
    botSay(work, '好，记为「暂无明确故事」。我不会替你编灵感，之后以造型和材质为主。');
    syncSummary(work);
    if (!work.story.summary) storyAdvanceMessage(work);
    save(work); render();
  },
  'story-nostory-undo': () => { const work = currentWork(); work.story.noStory = false; syncSummary(work); save(work); render(); },
  'story-confirm': () => {
    const work = currentWork();
    work.story.summaryConfirmed = true;
    botSay(work, '总结已确认，共创完成。下一步定风格和比例，再审核方案。');
    save(work); render();
  },
});

/* ---------- 01 资产 ---------- */
function invalidateAssets(work, why) {
  if (work.assetsConfirmed) { work.assetsConfirmed = false; botSay(work, `${why}，资产确认已撤销，请重新检查后确认。`); }
}
// A 路线：整体图变了就重做白底演示图（只是把原图放到白底上，未真实抠图）
async function ensureWhiteBg(work) {
  const source = work.assets.find(a => a.kind === 'overall');
  if (work.route !== 'A' || !source || work.whiteBg?.sourceId === source.id) return;
  try {
    work.whiteBg = await makeWhiteBgDemo(source);
    botSay(work, '已按整体图做了白底图（演示，未真实抠图），请和原图对照检查。');
  } catch (error) { toast(`白底演示生成失败：${error.message}`); }
}

async function addFiles(work, files) {
  const errors = [];
  let added = 0;
  let markedOverall = '';
  for (const file of files) {
    const problem = checkFile(file, work.assets.length);
    if (problem) { errors.push(problem); continue; }
    try {
      const img = await compressImage(await readAsDataUrl(file));
      const kind = work.assets.some(a => a.kind === 'overall') ? 'detail' : 'overall';
      if (kind === 'overall') markedOverall = file.name;
      work.assets.push({ id: uid('a'), kind, name: file.name, ...img });
      added++;
    } catch (error) { errors.push(`「${file.name}」${error.message}`); }
  }
  if (added) invalidateAssets(work, '照片有变动');
  if (added) {
    const kinds = markedOverall
      ? `「${markedOverall}」标成了「整体」${added > 1 ? '，其余先标成「细节」' : ''}`
      : '已有整体图，新加的先标成「细节」';
    botSay(work, `收到 ${added} 张照片。${kinds}；标错了可以在图下面改成整体、背面或细节。`);
    await ensureWhiteBg(work);
  }
  if (errors.length) botSay(work, `有 ${errors.length} 张没有添加：\n${errors.join('\n')}`);
  save(work); render();
  if (errors.length) toast(`${errors.length} 张未添加，原因见对话`);
}

Object.assign(actions, {
  'asset-remove': async el => {
    const work = currentWork();
    const asset = work.assets.find(a => a.id === el.dataset.id);
    const ok = await askConfirm('删除这张照片？', `<p>「${esc(asset.name)}」会从这件作品里移除。已经生成的历史结果仍会保留当时的记录。</p>`, '删除照片');
    if (!ok) return;
    work.assets = work.assets.filter(a => a.id !== asset.id);
    if (work.whiteBg && work.whiteBg.sourceId === asset.id) work.whiteBg = null;
    invalidateAssets(work, '照片被删除');
    await ensureWhiteBg(work);
    save(work); render();
  },
  // 路线只在演示设置里切换，商家流程里不出现
  route: async el => {
    const work = currentWork();
    if (work.route === el.dataset.route) return;
    work.route = el.dataset.route;
    invalidateAssets(work, '资产路线改了');
    await ensureWhiteBg(work);
    save(work); render(); renderDemo();
  },
  'open-demo': () => { renderDemo(); $('#demo-dialog').showModal(); },
  'make-white': async () => {
    const work = currentWork();
    const source = work.assets.find(a => a.kind === 'overall');
    if (!source) { toast('先上传一张整体图'); return; }
    try {
      work.whiteBg = await makeWhiteBgDemo(source);
      invalidateAssets(work, '白底图重新生成了');
      botSay(work, '白底图（演示）已生成。它只是把原图放到白底上，没有真实抠图，请对照看看。');
      save(work); render();
    } catch (error) { toast(`白底演示生成失败：${error.message}`); }
  },
  'confirm-assets': () => {
    const work = currentWork();
    work.assetsConfirmed = true;
    botSay(work, '资产已确认。下一步填商品信息。');
    save(work); render();
  },
  'unconfirm-assets': () => { const work = currentWork(); work.assetsConfirmed = false; save(work); render(); },
});

['dragenter', 'dragover'].forEach(type => document.addEventListener(type, event => {
  const zone = event.target.closest?.('#drop-zone');
  if (!zone) return;
  event.preventDefault();
  zone.classList.add('over');
}));
['dragleave', 'drop'].forEach(type => document.addEventListener(type, event => {
  const zone = event.target.closest?.('#drop-zone');
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove('over');
  if (type === 'drop' && event.dataTransfer?.files?.length) addFiles(currentWork(), [...event.dataTransfer.files]);
}));

/* ---------- 对话建议：采纳 / 忽略（AC-05.1：推测不直接写入） ---------- */
Object.assign(actions, {
  adopt: el => {
    const work = currentWork();
    const { kind, field } = el.dataset;
    const list = kind === 'info' ? 'infoSuggest' : 'styleSuggest';
    const item = work[list].find(x => x.field === field);
    if (!item) return;
    if (kind === 'info') {
      work.info[field] = item.value;
      if (field === 'material') work.info.materialUnknown = false;
      if (field === 'size') work.info.sizeUnknown = false;
    } else {
      work.style[field] = item.value;
      work.styleSrc[field] = 'chat';
      work.sceneRef = null;
    }
    work[list] = work[list].filter(x => x !== item);
    save(work); render();
  },
  ignore: el => {
    const work = currentWork();
    const list = el.dataset.kind === 'info' ? 'infoSuggest' : 'styleSuggest';
    work[list] = work[list].filter(x => x.field !== el.dataset.field);
    save(work); render();
  },
});

/* ---------- 04 方案 ---------- */
const STYLE_KEYS = Object.keys(STYLE_LABELS);
function applyStyle(work, values, src, sceneRef = null) {
  STYLE_KEYS.forEach(k => { if (values[k] !== undefined) { work.style[k] = values[k]; work.styleSrc[k] = src; } });
  work.sceneRef = sceneRef;
  work.styleSuggest = [];
}
async function askName(title, hint, initial) {
  const ok = await askConfirm(title, `<p>${hint}</p><label class="field"><span class="field-label">名称</span><input type="text" class="input" id="name-input" maxlength="20" value="${esc(initial)}"></label>`, '保存');
  const value = ok ? ($('#name-input')?.value || '').trim() : '';
  return ok ? value : null;
}
function saveScene(name, params, workId) {
  const existing = state.scenes.find(s => s.name === name);
  if (existing) {
    existing.history.push({ version: existing.version, params: existing.params, at: now() });
    existing.version += 1;
    existing.params = clone(params);
    return existing;
  }
  const scene = { id: uid('s'), name, version: 1, params: clone(params), history: [], createdAt: now(), fromWorkId: workId };
  state.scenes.push(scene);
  return scene;
}

Object.assign(actions, {
  'style-set': el => {
    const work = currentWork();
    const { field, value } = el.dataset;
    work.style[field] = work.style[field] === value ? '' : value;
    work.styleSrc[field] = 'user';
    work.sceneRef = null;
    save(work); render();
  },
  'set-ratio': el => { const work = currentWork(); work.ratio = el.dataset.ratio; save(work); render(); },
  // 按共创回答套用推荐（规则模版）；摆放没选时先按「平铺」
  'apply-story': () => {
    const work = currentWork();
    const defaulted = !work.style.placement;
    applyStyle(work, Object.fromEntries(Object.entries(storyStyle(work).picks).map(([f, p]) => [f, p.value])), 'story');
    if (defaulted) { work.style.placement = '平铺'; work.styleSrc.placement = 'preset'; }
    botSay(work, `已按你的共创回答套用推荐（规则模版），每一项都还能改${defaulted ? '；摆放先按「平铺」，要悬挂或支架可以改' : ''}。`);
    save(work); render();
  },
  'story-fix': el => {
    const work = currentWork();
    const { field, value } = el.dataset;
    work.style[field] = value;
    work.styleSrc[field] = 'story';
    work.sceneRef = null;
    save(work); render();
  },
  'story-keep': el => {
    const work = currentWork();
    work.styleAck = { ...work.styleAck, [el.dataset.field]: work.style[el.dataset.field] };
    save(work); render();
  },
  'plan-recommend': () => {
    const work = currentWork();
    state.showPresets = !state.showPresets;
    if (work.step !== 'plan') { work.step = 'plan'; state.showPresets = true; }
    if (state.showPresets) botSay(work, '给了三个推荐方向，各写了理由。套用后每一项都还能改。');
    save(work); render();
  },
  'apply-preset': el => {
    const work = currentWork();
    const p = PRESET_DIRECTIONS[Number(el.dataset.idx)];
    applyStyle(work, { tone: p.tone, background: p.background, light: p.light, props: p.props, composition: p.composition, placement: work.style.placement || '平铺' }, 'preset');
    state.showPresets = false;
    botSay(work, `套用了「${p.name}」。摆放先按「${work.style.placement}」，要悬挂或支架可以改。`);
    save(work); render();
  },
  'apply-longterm': () => {
    const work = currentWork();
    const lt = state.longTerm.style;
    applyStyle(work, Object.fromEntries(STYLE_KEYS.filter(k => lt[k]).map(k => [k, lt[k]])), 'longterm');
    botSay(work, '已套用你的长期风格。这里的调整只影响这件作品，不会改长期风格。');
    save(work); render();
  },
  'save-scene-from-plan': async () => {
    const work = currentWork();
    const name = await askName('存为摄影布景', '布景只保存背景、色调、光线、摆放、道具和构图，不保存商品细节和故事。用同一个名字保存会升级为新版本，旧版本保留。', work.sceneRef ? state.scenes.find(s => s.id === work.sceneRef.id)?.name || '' : '');
    if (name == null) return;
    if (!name) { toast('请填写布景名称'); return; }
    const scene = saveScene(name, work.style, work.id);
    work.sceneRef = { id: scene.id, version: scene.version };
    save(work); render();
    toast(`已保存布景「${scene.name}」v${scene.version}`);
  },
  'update-longterm': async () => {
    const work = currentWork();
    const lt = state.longTerm.style;
    const changes = STYLE_KEYS.filter(k => (work.style[k] || '') !== (lt[k] || '')).map(k => `<li>${STYLE_LABELS[k]}：${esc(k === 'tone' ? toneText(lt[k]) || '空' : lt[k] || '空')} → <strong>${esc(k === 'tone' ? toneText(work.style[k]) || '空' : work.style[k] || '空')}</strong></li>`);
    if (!changes.length) { toast('和长期风格一样，没有需要更新的'); return; }
    const ok = await askConfirm('更新我的长期风格？', `<p>长期风格会影响之后新作品的默认建议。以下内容会被改写：</p><ul class="intro-list">${changes.join('')}</ul><p>已有作品和历史结果不受影响。</p>`, '同意更新');
    if (!ok) return;
    state.longTerm.log.push({ at: now(), from: clone(lt), to: clone(work.style), workId: work.id });
    state.longTerm.style = clone(work.style);
    save(work); toast('长期风格已更新');
  },
  'prompt-sync': () => {
    const work = currentWork();
    const { conflicts, updates } = parsePrompt(work.promptEdited, work);
    if (conflicts.length) { toast('提示词还有冲突，先处理'); return; }
    applyStyle(work, updates, 'prompt', work.sceneRef);
    if (Object.keys(updates).length) work.sceneRef = null;
    work.promptEdited = null;
    botSay(work, Object.keys(updates).length ? `已把提示词里的改动同步回方案：${Object.keys(updates).map(k => STYLE_LABELS[k]).join('、')}。` : '提示词和方案一致，没有需要同步的改动。');
    save(work); render();
  },
  'prompt-reset': () => { const work = currentWork(); work.promptEdited = null; save(work); render(); },
  'approve-plan': () => {
    const work = currentWork();
    if (planBlockers(work).length) { render(); return; }
    const v = work.plans.length + 1;
    work.plans.push({ v, snapshot: snapshotOf(work), prompt: currentPrompt(work), style: clone(work.style), ratio: work.ratio, route: work.route, approvedAt: now(), parentResultId: work.revision?.fromResultId || null });
    work.approvedV = v;
    botSay(work, `方案 v${v} 已批准。现在可以去「出图」生成 ${CANDIDATE_COUNT} 张候选。`);
    save(work); render();
  },
  'cancel-revision': () => {
    const work = currentWork();
    const prev = work.revision?.prev;
    if (prev) Object.assign(work, clone(prev));   // 恢复修改前的风格、比例和批准状态
    work.revision = null;
    botSay(work, '已取消修改，恢复到修改前的方案状态。');
    save(work); render();
  },
});

/* ---------- 05 出图（演示任务，无真实服务） ---------- */
const delay = ms => new Promise(r => setTimeout(r, ms));
function finishTask(task, work) {
  const rs = task.resultIds.map(id => work.results.find(r => r.id === id));
  const ok = rs.filter(r => r.status === 'success').length;
  task.status = ok === rs.length ? 'success' : ok ? 'partial' : 'failed';
}
async function runCandidate(work, task, result, fail) {
  result.status = 'running';
  save(work); if (currentWork() === work) render();
  await delay(900);
  try {
    if (fail) throw new Error('演示设置：模拟失败');
    result.dataUrl = await renderDemoCandidate({ ...work, ratio: task.ratio, route: task.route, style: work.plans.find(p => p.v === task.planV).style }, result.slot);
    result.status = 'success';
  } catch (error) {
    result.status = 'failed';
    result.error = error.message;
  }
}

Object.assign(actions, {
  generate: async () => {
    const work = currentWork();
    if (generateBlockers(work).length) { render(); return; }
    const plan = approvedPlan(work);
    const task = { id: uid('t'), planV: plan.v, ratio: plan.ratio, route: plan.route, status: 'queued', createdAt: now(), resultIds: [] };
    ['A', 'B'].slice(0, CANDIDATE_COUNT).forEach(slot => {
      const r = { id: uid('r'), taskId: task.id, planV: plan.v, ratio: plan.ratio, slot, status: 'queued', dataUrl: '', fidelity: 'none', style: 'none', issues: [], parentId: plan.parentResultId, exportedAt: null };
      work.results.push(r);
      task.resultIds.push(r.id);
    });
    work.tasks.push(task);
    const failB = state.demoFailNext;
    state.demoFailNext = false;
    work.revision = null;
    save(work); render();
    await delay(500);
    task.status = 'running';
    for (const id of task.resultIds) {
      const r = work.results.find(x => x.id === id);
      await runCandidate(work, task, r, failB && r.slot === 'B');
    }
    finishTask(task, work);
    botSay(work, task.status === 'success' ? '两张候选好了（演示图）。请分别看还原度和风格。'
      : task.status === 'partial' ? '有一张失败了，成功的那张已保留，可以单独补齐。' : '这次两张都失败了，可以重试。');
    save(work); if (currentWork() === work) render();
  },
  'retry-result': async el => {
    const work = currentWork();
    const r = work.results.find(x => x.id === el.dataset.id);
    if (r.status !== 'failed') return;   // 防重复点击：只补失败的那张
    const task = work.tasks.find(t => t.id === r.taskId);
    task.status = 'running';
    await runCandidate(work, task, r, false);
    finishTask(task, work);
    save(work); render();
  },
  verdict: el => {
    const work = currentWork();
    const r = work.results.find(x => x.id === el.dataset.id);
    const { kind, value } = el.dataset;
    r[kind] = r[kind] === value ? 'none' : value;
    if (r[kind] !== 'bad') r.issues = r.issues.filter(i => !ISSUES[kind].includes(i));
    if (isComplete(r)) botSay(work, `候选 ${r.slot} 两项都满意，标为已完成，可以导出或把布景存下来。`);
    save(work); render();
  },
  issue: el => {
    const work = currentWork();
    const r = work.results.find(x => x.id === el.dataset.id);
    const i = el.dataset.issue;
    r.issues = r.issues.includes(i) ? r.issues.filter(x => x !== i) : r.issues.concat(i);
    save(work); render();
  },
  revise: el => {
    const work = currentWork();
    const r = work.results.find(x => x.id === el.dataset.id);
    const plan = work.plans.find(p => p.v === r.planV);
    const prev = { style: clone(work.style), styleSrc: clone(work.styleSrc), ratio: work.ratio, promptEdited: work.promptEdited, approvedV: work.approvedV, sceneRef: work.sceneRef };
    work.style = clone(plan.style);
    work.ratio = plan.ratio;
    work.promptEdited = null;
    work.approvedV = null;
    work.revision = { fromResultId: r.id, reasons: r.issues.slice(), prev };
    work.step = 'plan';
    const fidelityIssues = r.issues.filter(i => ISSUES.fidelity.includes(i));
    botSay(work, `从候选 ${r.slot} 开始修改，已恢复当时的方案 v${plan.v}。${fidelityIssues.length ? `还原度问题（${fidelityIssues.join('、')}）可能需要补拍更清楚的细节图，或在「信息」里补充不可改变的细节。` : ''}改好后重新批准。`);
    save(work); render(); window.scrollTo(0, 0);
  },
  export: el => {
    const work = currentWork();
    const r = work.results.find(x => x.id === el.dataset.id);
    if (!isComplete(r)) { toast('两项都满意的结果才能导出'); return; }
    try {
      const a = document.createElement('a');
      a.href = r.dataUrl;
      a.download = `${work.name}-方案v${r.planV}-${r.slot}-${r.ratio.replace(':', 'x')}-演示.jpg`;
      document.body.appendChild(a); a.click(); a.remove();
      r.exportedAt = now();
      save(work); render();
      toast('已开始下载（演示图）');
    } catch (error) { toast(`导出失败：${error.message}`); }
  },
  'save-scene-from-result': async el => {
    const work = currentWork();
    const r = work.results.find(x => x.id === el.dataset.id);
    const plan = work.plans.find(p => p.v === r.planV);
    const name = await askName('把这一版的布景存下来', '会保存这版方案的背景、色调、光线、摆放、道具和构图。下一件作品复用时会重新适配，不带入这件作品的商品细节和故事。', '');
    if (name == null) return;
    if (!name) { toast('请填写布景名称'); return; }
    const scene = saveScene(name, plan.style, work.id);
    save(work); render();
    toast(`已保存布景「${scene.name}」v${scene.version}`);
  },
  'clear-compare': () => { state.compare = {}; render(); },
});


/* ---------- 布景 / 历史 ---------- */
Object.assign(actions, {
  'delete-scene': async el => {
    const scene = state.scenes.find(s => s.id === el.dataset.id);
    const ok = await askConfirm(`删除布景「${scene.name}」？`, '<p>布景会从这个浏览器删除，删除后无法找回。已经用它批准或生成过的方案和结果会保留当时的快照，不受影响。</p>', '删除布景');
    if (!ok) return;
    state.scenes = state.scenes.filter(s => s.id !== scene.id);
    save(); render(); toast('布景已删除');
  },
  'open-result': el => { const work = state.works.find(w => w.id === el.dataset.work); work.step = 'output'; openWork(work.id); },
});

/* ---------- 输入事件：统一入口 ---------- */
// input：边打字边写回数据，只做轻量刷新，保持输入框焦点
document.addEventListener('input', event => {
  const el = event.target;
  if (el.id === 'chat-input') { $('#chat-count').textContent = el.value.length > 400 ? `${el.value.length} / 500` : ''; return; }
  const work = currentWork();
  if (!work) return;
  if (el.id === 'prompt-text') {
    work.promptEdited = el.value === buildPrompt(work) ? null : el.value;
    save(work); refreshLight();
    return;
  }
  const path = el.dataset.bind;
  if (!path) return;
  setPath(work, path, el.type === 'checkbox' ? el.checked : el.value);
  if (path.startsWith('style.')) { work.styleSrc[path.slice(6)] = 'user'; work.sceneRef = null; }
  if (path.startsWith('story.summary.')) work.story.summarySrc = 'user';
  if (path.startsWith('story.answers.')) work.story.sources[path.split('.')[2]] = 'user';
  save(work); refreshLight();
});

// change：选择完成或输入框失焦后的处理
const changeActions = {
  'asset-kind': async (el, work) => {
    work.assets.find(a => a.id === el.dataset.id).kind = el.value;
    invalidateAssets(work, '照片类型改了');
    await ensureWhiteBg(work);
    save(work); render();
  },
  'apply-scene': (el, work) => {
    if (!el.value) return;
    const scene = state.scenes.find(s => s.id === el.value);
    applyStyle(work, scene.params, 'scene', { id: scene.id, version: scene.version });
    botSay(work, `已复用布景「${scene.name}」v${scene.version}。只带入背景、光线、道具和布局，不带入旧作品的商品细节和故事；请按这件作品检查摆放和构图。`);
    save(work); render();
  },
  compare: (el, work) => {
    state.compare = state.compare || {};
    let ids = (state.compare[work.id] || []).filter(id => id !== el.dataset.id);
    if (el.checked) ids = ids.concat(el.dataset.id).slice(-2);
    state.compare[work.id] = ids;
    render();
    if (ids.length === 2) toast('已打开版本对比');
  },
};

document.addEventListener('change', event => {
  const el = event.target;
  if (el.dataset.bindGlobal) { state[el.dataset.bindGlobal] = el.checked; save(); return; }
  const work = currentWork();
  if (!work) return;
  if (el.id === 'file-input') { addFiles(work, [...el.files]); el.value = ''; return; }
  const handler = changeActions[el.dataset.actionChange];
  if (handler) { handler(el, work); return; }
  const path = el.dataset.bind || '';
  if (path === 'name') {
    if (!work.name.trim()) { work.name = '未命名作品'; save(work); render(); }
    return;
  }
  if (path.startsWith('story.answers.')) {
    const before = work.story.q;
    syncSummary(work);
    if (work.story.q !== before && !work.story.summary) storyAdvanceMessage(work);
    save(work); render();
    return;
  }
  if (path.startsWith('story.summary.')) {
    if (!work.story.summaryConfirmed) return;
    work.story.summaryConfirmed = false;
    botSay(work, '总结改了，需要重新确认。');
    save(work); render();
    return;
  }
  if (el.id === 'prompt-text' || path.startsWith('style.') || el.dataset.rerender !== undefined) render();
});

/* ---------- 启动 ---------- */
// 刷新时仍在进行的演示任务：如实标为中断，不自动重新提交（PRD 7.3）
let interrupted = 0;
state.works.forEach(work => work.tasks.forEach(task => {
  if (task.status !== 'queued' && task.status !== 'running') return;
  task.resultIds.forEach(id => {
    const r = work.results.find(x => x.id === id);
    if (r && r.status !== 'success') { r.status = 'failed'; r.error = '页面刷新，任务中断'; interrupted++; }
  });
  finishTask(task, work);
}));
// 旧数据升级到 v2：①路线改由演示设置控制，没选过路线的作品改用新的默认 A（Q14 白底流程）；
// ②批准快照里的商品信息只保留核心字段，免得旧批准因售价、目标顾客被误判失效
let unreadable = 0;
const upgrading = state.version < 2;
if (upgrading) {
  state.works.forEach(work => {
    if (!work.routeChosen) work.route = 'A';
    delete work.routeChosen;
    work.plans.forEach(plan => {
      try { plan.snapshot.info = coreInfo(JSON.parse(plan.snapshot.info)); } catch { unreadable++; }
    });
  });
  state.version = 2;
}
if (interrupted || upgrading || Store.status === 'dirty') Store.flush();
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });   // 页面里写死的图标位，用 views 里同一套图标填充
render();
const notices = [
  interrupted && `${interrupted} 张演示图因页面刷新中断，可在出图页单独补齐`,
  unreadable && `${unreadable} 个旧方案的快照无法读取，对应作品需要重新批准方案`,
].filter(Boolean);
if (notices.length) toast(notices.join('；'));
if (!state.seenIntro) $('#intro-dialog').showModal();
