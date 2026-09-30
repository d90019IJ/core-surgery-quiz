import { request, currentExam } from './api.js';
currentExam();
const $ = id => document.getElementById(id);
let code = '', rows = [], exam = null, stats = null, busy = false;
if (window.QUIZ_CONFIG.preview) $('preview-notice').hidden = false;
const time = value => new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
const choices = answers => Object.entries(answers).sort(([a],[b]) => a.localeCompare(b)).map(([q,a]) => q.toUpperCase()+':'+String.fromCharCode(65+a)).join(' / ');
const statusText = row => row.survey_complete ? '已完成課程' : '已交卷／問卷未完成';
const stateText = {unscheduled:'尚未設定日期',before:'尚未到開放時間',open:'開放考試與問卷',paused:'已暫停收件',closed:'考試與問卷已截止'};
function renderStats() {
  $('survey-statistics').replaceChildren();
  $('survey-release-note').textContent = stats.available ? '僅提供各題選項的人數統計，沒有個人答案或身分對應。' : '為避免以即時變化推測個人答案，問卷統計會在截止後顯示。';
  $('export-survey').hidden = !stats.available;
  if (!stats.available) return;
  for (const q of stats.questions) {
    const section = document.createElement('section'); section.className = 'survey-stat-card';
    const heading = document.createElement('h3'); heading.textContent = q.text; section.append(heading);
    q.options.forEach((option,choice) => {
      const count = stats.counts.find(row => row.item_id === q.id && row.choice === choice)?.response_count || 0;
      const line = document.createElement('p'); line.textContent = option + '：' + count + ' 人'; section.append(line);
    });
    $('survey-statistics').append(section);
  }
}
async function refresh() {
  const all = []; let offset = 0, value;
  do { value = await request('admin-list', {offset}, code); all.push(...value.rows); offset += value.rows.length; } while (value.hasMore);
  rows = all; exam = value.exam;
  stats = await request('admin-survey', {}, code);
  const roster = (await request('admin-roster', {}, code)).rows;
  $('roster-count').textContent = roster.length + ' 位同學具備應考資格；須填寫相符的姓名與學號。';
  $('roster').replaceChildren(...roster.map(row=>{
    const tr=document.createElement('tr');
    for(const value of [row.student_id,row.name]){const td=document.createElement('td');td.textContent=value;tr.append(td);}
    return tr;
  }));
  $('admin-title').textContent = exam.title;
  $('exam-status').textContent = exam.id + ' · ' + stateText[exam.window.state];
  $('toggle-exam').textContent = exam.open ? '暫停收件' : '恢復定時收件';
  $('exam-date').value = exam.window.opensAt ? new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(exam.window.opensAt)) : '';
  const complete = rows.filter(row => row.survey_complete).length;
  $('record-count').textContent = rows.length + ' 人已交卷 · ' + complete + ' 人完成課程 · ' + (rows.length-complete) + ' 人問卷未完成';
  $('records').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    for (const value of [row.name,row.student_id,time(row.submitted_at),row.score,choices(row.answers),statusText(row)]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    return tr;
  }));
  $('empty').hidden = rows.length !== 0;
  renderStats(); $('login-view').hidden = true; $('dashboard').hidden = false;
}
async function run(task,errorId='admin-error') {
  if(busy)return; busy=true; $(errorId).textContent='';
  document.querySelectorAll('button, input').forEach(control=>control.disabled=true);
  try {await task();} catch(error){$(errorId).textContent=error.message;}
  finally{busy=false;document.querySelectorAll('button, input').forEach(control=>control.disabled=false);}
}
$('admin-login').addEventListener('submit',event=>{
  event.preventDefault();code=$('teacher-code').value.trim();
  run(async()=>{await refresh();$('teacher-code').value='';},'login-error');
});
$('refresh').addEventListener('click',()=>run(refresh));
$('logout').addEventListener('click',()=>{
  $('roster-add-form').reset();$('roster-message').textContent='';$('roster-error').textContent='';$('roster').replaceChildren();$('roster-count').textContent='';code='';rows=[];exam=null;stats=null;$('records').replaceChildren();$('survey-statistics').replaceChildren();$('teacher-code').value='';
  $('dashboard').hidden=true;$('login-view').hidden=false;
});
$('toggle-exam').addEventListener('click',()=>{
  if(!confirm(exam.open?'暫停後，考試與問卷都無法送出。確定暫停？':'恢復後仍受指定日期 18:30–19:30 限制，已交卷的學號仍無法重考。確定恢復？'))return;
  run(async()=>{await request('admin-toggle',{open:!exam.open},code);await refresh();});
});
$('schedule-form').addEventListener('submit',event=>{
  event.preventDefault();
  if(!confirm('設定為 '+$('exam-date').value+' 台灣時間 18:30–19:30？既有交卷與完成紀錄會保留。'))return;
  run(async()=>{await request('admin-schedule',{date:$('exam-date').value},code);await refresh();$('schedule-note').textContent='時間已儲存。考試與問卷於同一天 19:30 截止。';});
});
function csvCell(value) {
  let text=String(value??'');if(/^[\s]*[=+@-]/.test(text)||/^0\d+$/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
function download(data,name) {
  const blob=new Blob(['\uFEFF'+data.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('export').addEventListener('click',()=>run(async()=>{
  await refresh();
  download([['測驗場次','姓名','學號','交卷時間（台北）','得分','Q1','Q2','Q3','Q4','Q5','問卷完成','課程狀態'],
    ...rows.map(row=>[exam.id,row.name,"'"+row.student_id,time(row.submitted_at),row.score,...['q1','q2','q3','q4','q5'].map(q=>String.fromCharCode(65+row.answers[q])),row.survey_complete?'是':'否',statusText(row)])],
    '核心外科講堂-'+exam.id+'-成績與完成狀態.csv');
}));
$('export-survey').addEventListener('click',()=>run(async()=>{
  await refresh();if(!stats.available)throw new Error('問卷統計於截止後提供。');
  download([['題目','選項','人數'],...stats.questions.flatMap(q=>q.options.map((option,choice)=>[q.text,option,stats.counts.find(row=>row.item_id===q.id&&row.choice===choice)?.response_count||0]))],
    '核心外科講堂-'+exam.id+'-匿名問卷統計.csv');
}));

$('roster-add-form').addEventListener('submit',event=>{
  event.preventDefault();
  const name=$('roster-name').value.trim(), studentId=$('roster-student-id').value.trim();
  $('roster-message').textContent='';
  run(async()=>{
    await request('admin-roster-add',{name,studentId},code);
    $('roster-add-form').reset();
    $('roster-message').textContent='已新增至本場考試名單。';
    await refresh();
  },'roster-error');
});
