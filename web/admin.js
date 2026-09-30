import { request, currentExam } from './api.js';
currentExam();
const $ = id => document.getElementById(id);
let code = '', rows = [], exam = null, busy = false;
if (window.QUIZ_CONFIG.preview) $('preview-notice').hidden = false;
const time = value => new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
const choices = answers => Object.entries(answers).sort(([a], [b]) => a.localeCompare(b)).map(([q, a]) => `${q.toUpperCase()}:${String.fromCharCode(65 + a)}`).join(' / ');

async function refresh() {
  const all = [];
  let offset = 0, result;
  do {
    result = await request('admin-list', { offset }, code);
    all.push(...result.rows); offset += result.rows.length;
  } while (result.hasMore);
  rows = all; exam = result.exam;
  $('admin-title').textContent = exam.title;
  $('exam-status').textContent = `${exam.id} · ${exam.open ? '開放作答中' : '已停止收卷'}`;
  $('toggle-exam').textContent = exam.open ? '停止收卷' : '開放收卷';
  $('record-count').textContent = `${rows.length} 人已交卷`;
  $('records').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    for (const value of [row.name, row.student_id, time(row.submitted_at), row.score, choices(row.answers)]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    return tr;
  }));
  $('empty').hidden = rows.length !== 0;
  $('login-view').hidden = true; $('dashboard').hidden = false;
}

async function run(task, errorId = 'admin-error') {
  if (busy) return;
  busy = true;
  $(errorId).textContent = '';
  document.querySelectorAll('button').forEach(button => button.disabled = true);
  try { await task(); }
  catch (error) { $(errorId).textContent = error.message; }
  finally { busy = false; document.querySelectorAll('button').forEach(button => button.disabled = false); }
}
$('admin-login').addEventListener('submit', event => {
  event.preventDefault();
  code = $('teacher-code').value.trim();
  run(async () => { await refresh(); $('teacher-code').value = ''; }, 'login-error');
});
$('refresh').addEventListener('click', () => run(refresh));
$('logout').addEventListener('click', () => {
  code = ''; rows = []; exam = null;
  $('records').replaceChildren(); $('teacher-code').value = '';
  $('dashboard').hidden = true; $('login-view').hidden = false;
});
$('toggle-exam').addEventListener('click', () => {
  if (!confirm(exam.open ? '停止收卷後，尚未交卷的學員將無法交卷。確定停止？' : '確定重新開放收卷？已交卷的學號仍無法重考。')) return;
  run(async () => { await request('admin-toggle', { open: !exam.open }, code); await refresh(); });
});

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^0\d+$/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
$('export').addEventListener('click', () => run(async () => {
  await refresh();
  const data = [
    ['測驗場次', '姓名', '學號', '交卷時間（台北）', '得分', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
    ...rows.map(row => [exam.id, row.name, "'" + row.student_id, time(row.submitted_at), row.score,
      ...['q1', 'q2', 'q3', 'q4', 'q5'].map(q => String.fromCharCode(65 + row.answers[q]))])
  ];
  const blob = new Blob(['\uFEFF' + data.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `核心外科講堂-${exam.id}-成績.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
