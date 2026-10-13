import {request,currentExam} from './api.js';
import {addQuestionImage} from './question-media.js?v=1';
currentExam();
const $=id=>document.getElementById(id);
let code='',busy=false;
async function load(mode='random') {
 if(busy)return;busy=true;$('preview-error').textContent='';$('preview-load-error').textContent='';
 document.querySelectorAll('button').forEach(b=>b.disabled=true);
 try {
 const data=await request(mode==='bank'?'admin-bank':'admin-preview',{},code);
 $('preview-code').value='';$('preview-title').textContent=data.title;
 $('preview-mode').textContent=data.bank?'完整題庫審閱（含答案與出處，僅管理者可見）':data.randomized?'隨機試卷：2 題共同影像＋1 題原始影像＋2 題分類抽題':'固定題目預覽';
 $('preview-questions').replaceChildren();$('preview-result').textContent='';
 $('preview-simulate').hidden=!!data.bank;
 for(const [index,q]of data.questions.entries()){
 const field=document.createElement('fieldset');field.className='question';field.dataset.questionId=q.id;
 const legend=document.createElement('legend'),number=document.createElement('span');number.className='question-number';
 number.textContent=(data.bank?'題庫 '+q.id.toUpperCase():'QUESTION '+String(index+1).padStart(2,'0'));
 legend.append(number,document.createTextNode(q.text));field.append(legend);
 addQuestionImage(field,q.image);
 if(q.table){const wrap=document.createElement('div');wrap.className='question-table-wrap';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','輸液成分表，可左右滑動');const table=document.createElement('table');const caption=document.createElement('caption');caption.textContent='輸液成分表（可左右滑動）';table.append(caption);const head=document.createElement('thead'),hr=document.createElement('tr');for(const text of q.table.headers){const th=document.createElement('th');th.scope='col';th.textContent=text;hr.append(th);}head.append(hr);table.append(head);const body=document.createElement('tbody');for(const row of q.table.rows){const tr=document.createElement('tr');row.forEach((text,i)=>{const td=document.createElement(i===0?'th':'td');if(i===0)td.scope='row';td.textContent=text;tr.append(td);});body.append(tr);}table.append(body);wrap.append(table);field.append(wrap);}
 q.options.forEach((text,i)=>{const label=document.createElement('label');label.className='option';const input=document.createElement('input');input.type='radio';input.name=q.id;input.value=i;input.required=!data.bank;const span=document.createElement('span');span.className='option-text';span.textContent=text;label.append(input,span);field.append(label);});
 if(data.bank&&q.review){const review=document.createElement('aside');review.className='question-review';for(const text of [q.review.kind||'原題','答案：'+String.fromCharCode(65+q.review.answer)+' · '+q.options[q.review.answer],q.review.source||'原考題',q.review.explanation||'答案依原題設定。']){const p=document.createElement('p');p.textContent=text;review.append(p);}field.append(review);}
 $('preview-questions').append(field);
 }
 $('preview-login').hidden=true;$('preview-content').hidden=false;
 }catch(error){$('preview-error').textContent=error.message;$('preview-load-error').textContent=error.message;}
 finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}
}
$('preview-login-form').addEventListener('submit',event=>{event.preventDefault();code=$('preview-code').value.trim();load();});
$('preview-reroll').addEventListener('click',()=>load());
$('preview-bank').addEventListener('click',()=>load('bank'));
$('preview-quiz').addEventListener('submit',event=>{event.preventDefault();$('preview-result').textContent='模擬交卷完成。這是預覽測試，未送出正式考卷。';});
$('preview-quiz').addEventListener('reset',()=>{$('preview-result').textContent='';});
$('preview-logout').addEventListener('click',()=>{code='';$('preview-code').value='';$('preview-questions').replaceChildren();$('preview-result').textContent='';$('preview-title').textContent='';$('preview-content').hidden=true;$('preview-login').hidden=false;});
