import {exams} from './exams.js';
const cohort=Number(new URLSearchParams(location.search).get('cohort'));
const group={1:'B',2:'A',3:'C'}[cohort];
const status=document.getElementById('status'),note=document.getElementById('note'),button=document.getElementById('refresh');
const taipeiDate=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
async function refresh(){
 if(!group){status.textContent='梯次連結不正確，請向助教索取。';button.disabled=true;return;}
 document.getElementById('title').textContent=`第 ${cohort} 梯次 · ${group} 組考試入口`;
 button.disabled=true;status.textContent='正在確認今天的場次…';note.textContent='';
 try{
  const sessions=await Promise.all(exams.filter(e=>e.cohort===cohort).map(async e=>{
   const response=await fetch(window.QUIZ_CONFIG.apiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'info',examId:e.id}),signal:AbortSignal.timeout(25000),cache:'no-store'});
   if(!response.ok)throw Error('無法確認場次');return {...e,info:await response.json()};
  }));
  const today=taipeiDate(sessions[0].info.window.serverNow);
  const matches=sessions.filter(e=>e.info.window.opensAt&&taipeiDate(e.info.window.opensAt)===today);
  if(matches.length===1){location.replace('./?cohort='+cohort+'&exam='+encodeURIComponent(matches[0].id));return;}
  if(matches.length>1){status.textContent='今天有多個場次，請聯絡助教確認考試連結。';return;}
  status.textContent='今日無測驗';
  const next=sessions.filter(e=>e.info.window.opensAt&&taipeiDate(e.info.window.opensAt)>today).sort((a,b)=>Date.parse(a.info.window.opensAt)-Date.parse(b.info.window.opensAt))[0];
  note.textContent=next?`下一場：${taipeiDate(next.info.window.opensAt)} ${next.title}。請於當天使用本連結進入。`:'本梯次目前沒有後續場次。';
 }catch{status.textContent='暫時無法確認場次，請稍後重新確認。';}finally{button.disabled=false;}
}
button.addEventListener('click',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});refresh();
