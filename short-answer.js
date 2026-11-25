export function addShortAnswer(field,q) {
 if(q.type!=='short')return;
 const note=document.createElement('p');note.className='muted';note.textContent='中英文皆可，交卷後由教師人工複核。';field.append(note);
 for(let i=0;i<q.fields;i++){
  const label=document.createElement('label');label.className='short-answer-label';label.textContent=q.fields===1?'您的答案':'措施 '+(i+1);
  const input=document.createElement('textarea');input.name=q.id;input.required=true;input.maxLength=800;input.rows=q.fields===1?2:3;input.className='short-answer';label.append(input);field.append(label);
 }
}
export function complete(field) {
 const texts=[...field.querySelectorAll('textarea')];
 return texts.length ? texts.every(x=>x.value.trim()) : !!field.querySelector('input:checked');
}
