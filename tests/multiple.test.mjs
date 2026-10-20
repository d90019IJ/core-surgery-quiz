import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,sha256,validateAnswers} from '../server/application.mjs';
import {localRepository} from '../server/local-repository.mjs';
const questions=[{id:'single',text:'Synthetic single',options:['A','B']},{id:'multi',type:'multiple',text:'Synthetic multiple',options:['A','B','C','D','E']}];
test('multiple choice rejects empty, duplicate, malformed and wrong-shaped answers',()=>{
 for(const value of [[],[0,0],[0,5],[0,-1],['0',1],[0,null],[0,1.5],0,null,{}]){
 assert.throws(()=>validateAnswers({single:0,multi:value},questions),{status:400});
 }
 assert.throws(()=>validateAnswers({single:[0],multi:[0,1]},questions),{status:400});
 assert.deepEqual(validateAnswers({single:0,multi:[3,1,0,2]},questions),{single:0,multi:[0,1,2,3]});
});
test('mixed random exams grade exact sets independent of order and retain single-choice compatibility',async t=>{
 const code='synthetic-teacher-code-long-enough-32',eid='multi-test',now=()=>Date.parse('2026-10-21T18:45:00+08:00');
 const repo=localRepository(':memory:',{settings:{admin_hash:await sha256(code),allowed_origins:[]},exams:[{id:eid,title:'Synthetic',open:true,opens_at:'2026-10-21T18:30:00+08:00',closes_at:'2026-10-21T19:30:00+08:00',questions,answer_key:{single:0,multi:[0,1,2,3]},assignment_rules:[{ids:['single','multi'],count:2}]}],roster:['EXACT','MISSING','EXTRA'].map(student_id=>({exam_id:eid,student_id,name:'Synthetic'}))},{now});
 t.after(()=>repo.close());const handle=createHandler(repo);
 const call=async(action,studentId,answers,auth='')=>{const r=await handle(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json','X-Teacher-Code':auth},body:JSON.stringify({action,examId:eid,name:'Synthetic',studentId,answers})}));return{status:r.status,data:await r.json()};};
 for(const [id,answer,score]of [['EXACT',[3,2,1,0],100],['MISSING',[0,1,2],50],['EXTRA',[0,1,2,3,4],50]]){
 const started=await call('start',id);assert.equal(started.status,200);assert.equal(started.data.questions.find(q=>q.id==='multi').type,'multiple');assert(started.data.questions.every(q=>!q.review));
 const r=await call('submit',id,{single:0,multi:answer});assert.equal(r.status,200);assert.equal(r.data.score,undefined);assert.equal(r.data.answers,undefined);assert.equal(r.data.submitted,true);
 assert.equal(repo.db.prepare('select score from submissions where student_id=?').get(id).score,score);
 }
 const repeat=await call('submit','EXACT',{single:1,multi:[4]});assert.equal(repeat.data.submitted,true);assert.equal(repo.db.prepare("select score from submissions where student_id='EXACT'").get().score,100);
 const bank=await call('admin-bank','EXACT',undefined,code);assert.deepEqual(bank.data.questions.find(q=>q.id==='multi').review.answer,[0,1,2,3]);
 assert.equal((await call('admin-bank','EXACT')).status,401);
});
