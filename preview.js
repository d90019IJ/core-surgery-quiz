import {request,currentExam} from './api.js';
currentExam();
const $=id=>document.getElementById(id);
$('preview-login-form').addEventListener('submit',async event=>{
 event.preventDefault();$('preview-error').textContent='';$('preview-login-button').disabled=true;
 try{
 const data=await request('admin-preview',{},$('preview-code').value.trim());
 $('preview-code').value='';$('preview-title').textContent=data.title;
 $('preview-questions').replaceChildren();
 for(const [index,q]of data.questions.entries()){
 const field=document.createElement('fieldset');field.className='question';
 const legend=document.createElement('legend');const number=document.createElement('span');number.className='question-number';number.textContent='QUESTION '+String(index+1).padStart(2,'0');legend.append(number,document.createTextNode(q.text));field.append(legend);
 if(q.table){const wrap=document.createElement('div');wrap.className='question-table-wrap';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','輸液成分表，可左右滑動');const table=document.createElement('table');const caption=document.createElement('caption');caption.textContent='輸液成分表（可左右滑動）';table.append(caption);const head=document.createElement('thead'),hr=document.createElement('tr');for(const text of q.table.headers){const th=document.createElement('th');th.scope='col';th.textContent=text;hr.append(th);}head.append(hr);table.append(head);const body=document.createElement('tbody');for(const row of q.table.rows){const tr=document.createElement('tr');row.forEach((text,i)=>{const td=document.createElement(i===0?'th':'td');if(i===0)td.scope='row';td.textContent=text;tr.append(td);});body.append(tr);}table.append(body);wrap.append(table);field.append(wrap);}
 q.options.forEach((text,i)=>{const label=document.createElement('label');label.className='option';const input=document.createElement('input');input.type='radio';input.name=q.id;input.value=i;input.required=true;const span=document.createElement('span');span.className='option-text';span.textContent=text;label.append(input,span);field.append(label);});
 $('preview-questions').append(field);
 }
 $('preview-login').hidden=true;$('preview-content').hidden=false;
 }catch(error){$('preview-error').textContent=error.message;}finally{$('preview-login-button').disabled=false;}
});
$('preview-quiz').addEventListener('submit',event=>{event.preventDefault();$('preview-result').textContent='模擬交卷完成。這是預覽測試，未送出正式考卷。';});
$('preview-quiz').addEventListener('reset',()=>{$('preview-result').textContent='';});
$('preview-logout').addEventListener('click',()=>{$('preview-questions').replaceChildren();$('preview-result').textContent='';$('preview-title').textContent='';$('preview-content').hidden=true;$('preview-login').hidden=false;});
