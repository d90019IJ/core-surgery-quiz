import { mountExamSelector } from './exam-selector.js?v=20261125';
import { request, currentExam } from './api.js';
currentExam();
mountExamSelector();
const $ = id => document.getElementById(id);
let code = '', rows = [], exam = null, stats = null, busy = false;
if (window.QUIZ_CONFIG.preview) $('preview-notice').hidden = false;
const time = value => new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
const questionIds = row => row.question_ids || Object.keys(row.answers).sort();
const choiceLetters = value => (Array.isArray(value)?value:[value]).map(n=>typeof n==='string'?n:String.fromCharCode(65+n)).join('+');
const choices = row => questionIds(row).map(q=>q.toUpperCase()+':'+choiceLetters(row.answers[q])).join(' / ');
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
  $('exam-preview-link').href='./preview.html?exam='+encodeURIComponent(exam.id);
  $('exam-status').textContent = exam.id + ' · ' + stateText[exam.window.state];
  $('toggle-exam').textContent = exam.open ? '暫停收件' : '恢復定時收件';
  $('exam-date').value = exam.window.opensAt ? new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(exam.window.opensAt)) : '';
  $('exam-opens-time').value = exam.window.opensAt ? new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(exam.window.opensAt)) : '18:30';
  const complete = rows.filter(row => row.survey_complete).length;
  $('record-count').textContent = rows.length + ' 人已交卷 · ' + complete + ' 人完成課程 · ' + (rows.length-complete) + ' 人問卷未完成';
  $('records').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    for (const value of [row.name,row.student_id,time(row.submitted_at),row.score??'待複核',choices(row),statusText(row)]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    if(row.grading_status==='pending'||row.manual_grades){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=row.grading_status==='pending'?'批改簡答':'查看／修正批改';button.onclick=()=>run(()=>openReview(row.student_id));tr.lastElementChild.append(document.createElement('br'),button);}
    return tr;
  }));
  $('empty').hidden = rows.length !== 0;
  renderStats(); $('login-view').hidden = true; $('dashboard').hidden = false;
}
async function run(task,errorId='admin-error') {
  if(busy)return; busy=true; $(errorId).textContent='';
  document.querySelectorAll('button, input, select, textarea').forEach(control=>control.disabled=true);
  try {await task();} catch(error){$(errorId).textContent=error.message;}
  finally{busy=false;document.querySelectorAll('button, input, select, textarea').forEach(control=>control.disabled=false);}
}
$('admin-login').addEventListener('submit',event=>{
  event.preventDefault();code=$('teacher-code').value.trim();
  run(async()=>{await refresh();$('teacher-code').value='';},'login-error');
});
$('refresh').addEventListener('click',()=>run(refresh));
$('logout').addEventListener('click',()=>{
  reviewPanel.replaceChildren();reviewPanel.hidden=true;$('roster-add-form').reset();$('roster-message').textContent='';$('roster-error').textContent='';$('roster').replaceChildren();$('roster-count').textContent='';code='';rows=[];exam=null;stats=null;$('records').replaceChildren();$('survey-statistics').replaceChildren();$('teacher-code').value='';
  $('dashboard').hidden=true;$('login-view').hidden=false;
});
$('toggle-exam').addEventListener('click',()=>{
  if(!confirm(exam.open?'暫停後，考試與問卷都無法送出。確定暫停？':'恢復後仍受已儲存的日期及開放時間限制，已交卷的學號仍無法重考。確定恢復？'))return;
  run(async()=>{await request('admin-toggle',{open:!exam.open},code);await refresh();});
});
$('schedule-form').addEventListener('submit',event=>{
  event.preventDefault();
  if(!confirm('設定為 '+$('exam-date').value+' 台灣時間 '+$('exam-opens-time').value+'–19:30？既有交卷與完成紀錄會保留。'))return;
  run(async()=>{await request('admin-schedule',{date:$('exam-date').value,opensTime:$('exam-opens-time').value},code);await refresh();$('schedule-note').textContent='時間已儲存。考試與問卷於同一天 19:30 截止。';});
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
  download([['測驗場次','姓名','學號','交卷時間（台北）','得分','題組（依顯示順序）','第1題','第2題','第3題','第4題','第5題','問卷完成','課程狀態'],
    ...rows.map(row=>[exam.id,row.name,"'"+row.student_id,time(row.submitted_at),row.score??'待複核',questionIds(row).join(' / '),...questionIds(row).map(q=>choiceLetters(row.answers[q])),row.survey_complete?'是':'否',statusText(row)])],
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

$('open-now').addEventListener('click',()=>{
  if(!confirm('立即開放已儲存日期的本場考試及問卷？僅限考試當天操作，仍於 19:30 截止，已交卷者無法重考。'))return;
  run(async()=>{await request('admin-open-now',{},code);await refresh();$('schedule-note').textContent='已立即開放，考試與問卷仍於當天 19:30 截止。';});
});

const reviewPanel=document.createElement('section');reviewPanel.className='grading-panel';reviewPanel.hidden=true;$('dashboard').append(reviewPanel);
async function openReview(studentId){
 const {record,questions}=await request('admin-review',{studentId},code);
 reviewPanel.replaceChildren();reviewPanel.hidden=false;
 const heading=document.createElement('h2');heading.textContent=record.name+' · '+record.student_id+' · 簡答複核';reviewPanel.append(heading);
 const guidance=document.createElement('p');guidance.textContent='逐項判讀，不以文字完全相同為限。IICP 四項須為不同措施，重複措施只計一次。全部評閱後才產生總分；每題等權重，IICP 四欄各占該題四分之一。';reviewPanel.append(guidance);
 const form=document.createElement('form');const controls={};
 for(const q of questions){
  const title=document.createElement('h3');title.textContent=q.text;form.append(title);
  const rubric=document.createElement('p');rubric.textContent=q.review?.explanation||'依教師參考答案評閱';form.append(rubric);controls[q.id]=[];
  record.answers[q.id].forEach((value,i)=>{
   const answer=document.createElement('p');answer.className='student-answer';answer.textContent=(i+1)+'. '+value;form.append(answer);
   const label=document.createElement('label');label.textContent='第 '+(i+1)+' 項判定：';
   const select=document.createElement('select');select.required=true;select.setAttribute('aria-label',q.id+' 第 '+(i+1)+' 項判定');
   for(const [val,text] of [['','請評閱'],['1','正確且不重複'],['0','不正確或重複']]){const option=document.createElement('option');option.value=val;option.textContent=text;select.append(option);}
   select.value=record.manual_grades?.[q.id]?.[i]??'';label.append(select);form.append(label);controls[q.id].push(select);
  });
 }
 const noteLabel=document.createElement('label');noteLabel.className='short-answer-label';noteLabel.textContent='批改備註（選填）';const note=document.createElement('textarea');note.className='short-answer';note.maxLength=2000;note.value=record.review_note||'';noteLabel.append(note);form.append(noteLabel);
 const submit=document.createElement('button');submit.className='primary';submit.textContent='儲存並完成複核';const message=document.createElement('p');message.setAttribute('role','status');form.append(submit,message);
 form.onsubmit=event=>{event.preventDefault();const grades=Object.fromEntries(Object.entries(controls).map(([id,items])=>[id,items.map(x=>Number(x.value))]));run(async()=>{await request('admin-grade',{studentId,grades,note:note.value},code);await refresh();message.textContent='已儲存複核結果，成績表已更新。';});};
 reviewPanel.append(form);reviewPanel.scrollIntoView({block:'start'});
}
