import { exams } from './exams.js';
export function mountExamSelector() {
  const current = exams.find(e => e.id === window.QUIZ_CONFIG.examId);
  document.querySelectorAll('[data-exam-group]').forEach(el => { el.textContent = '陽明交大醫學系117級' + (current?.group || 'B') + '組'; });
  const panel = document.createElement('section');
  panel.className = 'schedule-card';
  panel.style.cssText = 'max-width:1100px;margin:16px auto;padding:16px';
  const lockedCohort = Number(new URLSearchParams(location.search).get('cohort'));
  if (lockedCohort && !location.pathname.endsWith('/admin.html')) {
    const note=document.createElement('p');note.textContent=`第 ${current?.cohort || lockedCohort} 梯次 · ${current?.group || ''} 組`;panel.append(note);
    const link=document.createElement('a');link.href='./cohort.html?cohort='+lockedCohort;link.textContent='返回本梯次入口';panel.append(link);document.querySelector('main').before(panel);return;
  }
  const label = document.createElement('label'); label.htmlFor = 'exam-selector'; label.textContent = '選擇梯次與考試場次';
  const select = document.createElement('select'); select.id = 'exam-selector'; select.style.cssText = 'width:100%;padding:12px;font:inherit';
  for (const [cohort,group] of [[1,'B'],[2,'A'],[3,'C']]) {
    const optgroup = document.createElement('optgroup'); optgroup.label = `第 ${cohort} 梯次 · ${group} 組`;
    for (const e of exams.filter(e=>e.cohort===cohort)) {
      const option = document.createElement('option'); option.value=e.id; option.textContent=`${e.date} ${e.title}${e.ready?'':'（待補考題）'}`; option.selected=e.id===window.QUIZ_CONFIG.examId; optgroup.append(option);
    }
    select.append(optgroup);
  }
  if (!current) { const option=document.createElement('option');option.value=window.QUIZ_CONFIG.examId;option.textContent='目前場次';option.selected=true;select.append(option); }
  select.addEventListener('change',()=>{ const url=new URL(location.href);url.searchParams.set('exam',select.value);location.assign(url); });
  panel.append(label,select);
  if (current) {
    const note=document.createElement('p');note.className='muted';note.textContent=`第 ${current.cohort} 梯次 · ${current.group} 組${current.ready?'':' · 考題尚未備妥，暫不開放考試'}`;panel.append(note);
    if (location.pathname.endsWith('/admin.html')) {
      const a=document.createElement('a');a.href='./?exam='+encodeURIComponent(current.id);a.textContent='開啟本場學生登入頁';panel.append(a);
      const p=document.createElement('p'),cohortLink=document.createElement('a');cohortLink.href='./cohort.html?cohort='+current.cohort;cohortLink.textContent='本梯次固定學生連結（自動顯示當天場次）';p.append(cohortLink);panel.append(p);
    }
  }
  document.querySelector('main').before(panel);
}
