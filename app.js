import { request, currentExam } from './api.js';
currentExam();
const $ = id => document.getElementById(id);
let identity, questions = [], survey = [], busy = false, finished = false, stage = 'identity', clock = null, syncBusy = false;
if (window.QUIZ_CONFIG.preview) $('preview-notice').hidden = false;
const timePanel = document.createElement('div');
timePanel.className = 'time-panel';
timePanel.innerHTML = '<strong id="window-label">正在確認考試時間…</strong><p id="window-date"></p><p id="countdown" aria-live="off"></p><small>考試及必填問卷皆須於當天 19:30 前完成送出（台灣時間）。</small>';
$('work-panel').prepend(timePanel);
const surveyView = document.createElement('section');
surveyView.id = 'survey-view'; surveyView.hidden = true;
surveyView.innerHTML = '<span class="pill">考試已交卷</span><h2 tabindex="-1" id="survey-heading">你已交卷</h2><p>請完成課程滿意度調查，才算完成整個課程流程。</p><p class="muted">五項皆必填。問卷只保存整體統計，學員紀錄只標示是否完成，不保存個人與答案的對應。</p><p id="survey-closed-note" class="error" hidden>考試已交卷，問卷尚未完成。目前已停止收件，無法送出問卷。</p><form id="survey-form"><div id="survey-questions"></div><p id="survey-error" class="error" role="alert"></p><button class="primary full" id="survey-submit">送出問卷並完成課程</button></form><button type="button" class="secondary" id="check-completion">重新查詢完成狀態</button>';
$('work-panel').append(surveyView);
const resultView = document.createElement('section');
resultView.id = 'result-view'; resultView.hidden = true;
resultView.innerHTML = '<h2 id="result-heading" tabindex="-1"></h2><p id="result-note"></p>';
$('work-panel').append(resultView);
$('start-button').disabled = true;
function activeWindow() {
  if (!clock) return { state: 'unknown' };
  const now = clock.now + performance.now() - clock.base;
  let state = clock.value.state;
  if (clock.value.closesAt && now >= Date.parse(clock.value.closesAt)) state = 'closed';
  // Open only after the next successful server check, never merely on client time.
  return { ...clock.value, state, now };
}
function setWindow(value) {
  clock = { value, now: Date.parse(value.serverNow), base: performance.now() };
  tick();
}
function tick() {
  if (finished) return;
  const w = activeWindow(), open = w.state === 'open';
  const labels = { unknown: '正在確認考試時間…', unscheduled: '尚未設定考試日期', before: '尚未開放', open: '開放作答與問卷填寫中', paused: '講師已暫停收件', closed: '考試與問卷皆已截止' };
  $('window-label').textContent = labels[w.state];
  $('window-date').textContent = w.opensAt ? new Date(w.opensAt).toLocaleDateString('zh-TW', { timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit' }) + ' · 18:30–19:30（台灣時間）' : '';
  if (open) {
    const seconds = Math.max(0, Math.floor((Date.parse(w.closesAt) - w.now) / 1000));
    $('countdown').textContent = '剩餘 ' + Math.floor(seconds / 60) + ' 分 ' + String(seconds % 60).padStart(2, '0') + ' 秒（含問卷）';
  } else $('countdown').textContent = '';
  $('start-button').disabled = busy || !['open', 'closed', 'paused'].includes(w.state);
  $('start-button').textContent = w.state === 'open' ? '開始作答／繼續問卷' : ['closed','paused'].includes(w.state) ? '查看完成狀態' : '尚未開放';
  $('submit-button').disabled = busy || !open;
  $('confirm-submit').disabled = busy || !open;
  $('survey-submit').disabled = busy || !open;
  $('check-completion').disabled = busy;
  for (const input of document.querySelectorAll('#quiz-form input, #survey-form input')) input.disabled = busy || !open;
  if (!open && $('submit-dialog').open) $('submit-dialog').close();
  if (stage === 'survey') {
    $('survey-form').hidden = !open;
    $('survey-closed-note').hidden = open;
  }
}
async function syncInfo() {
  if (finished || syncBusy) return;
  syncBusy = true;
  try { const result = await request('info'); setWindow(result.window); }
  catch (error) { if (!clock) $('identity-error').textContent = error.message; }
  finally { syncBusy = false; }
}
function showStage(next) {
  stage = next;
  for (const name of ['identity','quiz','survey','result']) $(name + '-view').hidden = name !== next;
  $('main').classList.toggle('in-quiz', next === 'quiz' || next === 'survey');
  $('step1').classList.toggle('active', next === 'identity');
  $('step2').classList.toggle('active', next === 'quiz');
  $('step3').classList.toggle('active', next === 'survey' || next === 'result');
}
function result(heading, note) {
  showStage('result');
  $('result-heading').textContent = heading; $('result-note').textContent = note;
  $('result-heading').focus();
}
function receiveReceipt(value) {
  identity = value.identity;
  questions = [];
  $('questions').replaceChildren();
  setWindow(value.window);
  if (value.surveyComplete) {
    finished = true;
    clearInterval(clockTimer); clearInterval(pollTimer);
    result('問卷已送出', '你已完成考試與課後問卷，課程流程已完成。');
    timePanel.hidden = true;
    return;
  }
  if (value.survey) {
    survey = value.survey; renderQuestions('survey-questions', survey);
    showStage('survey'); tick(); $('survey-heading').focus();
    $('survey-view').scrollIntoView({ block:'start' });
  } else {
    result('你已交卷', '問卷尚未完成，目前未開放收件。只有考試與問卷皆送出才算完成課程。');
  }
}
function renderQuestions(target, items) {
  const fragment = document.createDocumentFragment();
  for (const [index, question] of items.entries()) {
    const fieldset = document.createElement('fieldset'); fieldset.className = 'question';
    const legend = document.createElement('legend');
    const number = document.createElement('span'); number.className = 'question-number';
    number.textContent = (target === 'questions' ? 'QUESTION ' : '問卷 ') + String(index + 1).padStart(2, '0');
    legend.append(number, document.createTextNode(question.text)); fieldset.append(legend);
    question.options.forEach((option, choice) => {
      const label = document.createElement('label'); label.className = 'option';
      const input = document.createElement('input'); input.type = 'radio'; input.name = question.id; input.value = choice; input.required = true;
      const text = document.createElement('span'); text.className = 'option-text'; text.textContent = option;
      label.append(input, text); fieldset.append(label);
    });
    fragment.append(fieldset);
  }
  $(target).replaceChildren(fragment);
}
function answersFor(formId, items) {
  return Object.fromEntries(items.map(q => [q.id, Number($(formId).querySelector('input[name="' + q.id + '"]:checked').value)]));
}
function updateProgress() {
  const count = $('quiz-form').querySelectorAll('input:checked').length;
  $('progress').value = count; $('progress-label').textContent = '已作答 ' + count + ' / ' + questions.length;
}
$('identity-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  busy = true; tick(); $('identity-error').textContent = '';
  try {
    const value = await request('start', { name: $('student-name').value, studentId: $('student-id').value });
    if (value.submitted) { receiveReceipt(value); return; }
    identity = value.identity; questions = value.questions; setWindow(value.window);
    $('student-summary').textContent = identity.name + ' · ' + identity.studentId;
    $('exam-title').textContent = value.title;
    renderQuestions('questions', questions); $('progress').max = questions.length; updateProgress();
    showStage('quiz'); $('quiz-view').scrollIntoView({ block:'start' });
  } catch (error) { $('identity-error').textContent = error.message; await syncInfo(); }
  finally { busy = false; tick(); }
});
$('quiz-form').addEventListener('change', updateProgress);
$('quiz-form').addEventListener('submit', event => {
  event.preventDefault(); if (busy || activeWindow().state !== 'open') return;
  $('confirm-identity').textContent = identity.name + ' · ' + identity.studentId + '，已完成 ' + questions.length + ' 題。交卷後還需完成必填問卷。';
  $('submit-dialog').showModal();
});
$('cancel-submit').addEventListener('click', () => $('submit-dialog').close());
$('confirm-submit').addEventListener('click', async () => {
  if (busy || activeWindow().state !== 'open') return;
  const answers = answersFor('quiz-form', questions);
  busy = true; tick(); $('submit-dialog').close(); $('quiz-error').textContent = '';
  try { receiveReceipt(await request('submit', { ...identity, answers })); }
  catch (error) { $('quiz-error').textContent = error.message; await syncInfo(); }
  finally { busy = false; tick(); }
});
$('survey-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || activeWindow().state !== 'open') return;
  const answers = answersFor('survey-form', survey);
  busy = true; tick(); $('survey-error').textContent = '';
  try { receiveReceipt(await request('survey-submit', { ...identity, answers })); }
  catch (error) { $('survey-error').textContent = error.message; await syncInfo(); }
  finally { busy = false; tick(); }
});
$('check-completion').addEventListener('click', async () => {
  if (busy || !identity) return;
  busy=true;tick();
  try { receiveReceipt(await request('start', identity)); }
  catch(error) { $('survey-closed-note').hidden=false;$('survey-closed-note').textContent=error.message; }
  finally {busy=false;tick();}
});
window.addEventListener('beforeunload', event => {
  if (identity && !finished && activeWindow().state === 'open') { event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncInfo(); });
const clockTimer = setInterval(tick, 1000);
const pollTimer = setInterval(syncInfo, 20000);
syncInfo();
