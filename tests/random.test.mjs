import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,sha256} from '../server/application.mjs';
import {localRepository} from '../server/local-repository.mjs';
async function setup(t){
 let now=Date.parse('2026-10-14T18:45:00+08:00');
 const code='synthetic-teacher-code-long-enough-32';
 const exam={id:'random-qa',title:'Synthetic random exam',open:true,opens_at:'2026-10-14T18:30:00+08:00',closes_at:'2026-10-14T19:30:00+08:00',
 questions:['a','b','c','d','e','f','g','h','i'].map((id,i)=>({id,text:'Synthetic '+id,options:['X','Y'],review:{explanation:'PRIVATE EXPLANATION'},...(i<5?{image:{src:'data:image/png;base64,AAAA',alt:'Synthetic image'}}:{})})),
 answer_key:Object.fromEntries(['a','b','c','d','e','f','g','h','i'].map(id=>[id,1])),
 assignment_rules:[{ids:['a','b'],count:2},{ids:['c','d','e'],count:1},{ids:['f','g'],count:1},{ids:['h','i'],count:1}]};
 const repo=localRepository(':memory:',{settings:{admin_hash:await sha256(code),allowed_origins:['https://school.example']},exams:[exam],roster:Array.from({length:20},(_,i)=>({exam_id:exam.id,student_id:'STUDENT'+i,name:'Synthetic',group_name:'B'}))},{now:()=>now});
 t.after(()=>repo.close());const handler=createHandler(repo);
 const call=async(action,extra={},admin='')=>{const r=await handler(new Request('https://api.example',{method:'POST',headers:{'Content-Type':'application/json','X-Teacher-Code':admin},body:JSON.stringify({action,examId:exam.id,studentId:'STUDENT0',name:'Synthetic',...extra})}));return{status:r.status,body:await r.json()};};
 return{repo,exam,call,code,setTime:t=>now=Date.parse(t)};
}
test('assigned exams always contain five questions, three images, both anchors and one per topic',async t=>{
 const {call}=await setup(t);const variants=new Set();
 for(let i=0;i<20;i++){
 const r=await call('start',{studentId:'STUDENT'+i});assert.equal(r.status,200);
 const qs=r.body.questions,ids=qs.map(q=>q.id);assert.equal(qs.length,5);assert.equal(new Set(ids).size,5);
 assert.ok(ids.includes('a')&&ids.includes('b'));assert.equal(qs.filter(q=>q.image).length,3);
 assert.equal(ids.filter(x=>['f','g'].includes(x)).length,1);assert.equal(ids.filter(x=>['h','i'].includes(x)).length,1);
 assert.ok(qs.every(q=>!q.review&&!q.answer));variants.add(ids.join(','));
 }
 assert.ok(variants.size>1);
});
test('refresh and concurrent starts keep identical assignment; wrong question IDs cannot be graded',async t=>{
 const {call,repo}=await setup(t);
 const attempts=await Promise.all(Array.from({length:12},()=>call('start')));
 for(const r of attempts)assert.deepEqual(r.body.questions,attempts[0].body.questions);
 assert.equal(repo.db.prepare('SELECT count(*) n FROM assignments').get().n,1);
 const qs=attempts[0].body.questions,answers=Object.fromEntries(qs.map(q=>[q.id,1]));
 const bad={...answers};delete bad[qs[0].id];bad['unassigned']=1;
 assert.equal((await call('submit',{answers:bad})).status,400);
 assert.equal((await call('submit',{answers})).body.score,undefined);
 assert.equal((await repo.list('random-qa',0,10))[0].score,100);
 assert.deepEqual((await repo.list('random-qa',0,10))[0].question_ids,qs.map(q=>q.id));
 assert.equal((await call('start')).body.submitted,true);
});
test('preview does not assign; bank answers restricted to teacher; no question leak from info',async t=>{
 const {call,repo,code,setTime}=await setup(t);setTime('2026-10-13T18:45:00+08:00');
 for(const action of ['admin-preview','admin-bank'])assert.equal((await call(action)).status,401);
 const info=(await call('info')).body;assert.equal(info.questionCount,5);assert.equal(info.questions,undefined);
 const p=(await call('admin-preview',{},code)).body;assert.equal(p.questions.length,5);assert.ok(p.questions.every(q=>!q.review));
 const b=(await call('admin-bank',{},code)).body;assert.equal(b.questions.length,9);assert.ok(b.questions.every(q=>q.review.answer===1));
 assert.equal(repo.db.prepare('SELECT count(*) n FROM assignments').get().n,0);
 assert.equal((await call('start')).status,409);
});
test('deadline and roster checks protect assignment and submission',async t=>{
 const {call,repo,setTime}=await setup(t);
 assert.equal((await call('start',{name:'Wrong'})).status,403);
 setTime('2026-10-14T19:30:00+08:00');assert.equal((await call('start')).status,409);
 assert.equal(repo.db.prepare('SELECT count(*) n FROM assignments').get().n,0);
});
