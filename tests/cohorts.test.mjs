import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,sha256} from '../server/application.mjs';
import {localRepository} from '../server/local-repository.mjs';
const code='test-only-teacher-code-32-characters-minimum';
test('cohort rosters and completion remain independent; additions keep the cohort group',async t=>{
 const ids=['course-cohort2','course-cohort3'];
 const repo=localRepository(':memory:',{settings:{admin_hash:await sha256(code),allowed_origins:[]},exams:ids.map(id=>({id,title:id,open:true,opens_at:'2027-01-01T10:00:00Z',closes_at:'2027-01-01T11:30:00Z',questions:[{id:'q1',text:'test',options:['a','b']}],answer_key:{q1:0}})),roster:[{exam_id:ids[0],student_id:'A1',name:'甲',group_name:'A'},{exam_id:ids[1],student_id:'C1',name:'乙',group_name:'C'}]},{now:()=>Date.parse('2027-01-01T11:00:00Z')});t.after(()=>repo.close());const handler=createHandler(repo);
 const call=async(examId,action,data={},admin='')=>{const r=await handler(new Request('https://test',{method:'POST',headers:{'Content-Type':'application/json','X-Teacher-Code':admin},body:JSON.stringify({examId,action,...data})}));return {status:r.status,body:await r.json()};};
 assert.equal((await call(ids[0],'start',{studentId:'C1',name:'乙'})).status,403);
 for(const [examId,studentId,name] of [[ids[0],'A1','甲'],[ids[1],'C1','乙']]){
  assert.equal((await call(examId,'start',{studentId,name})).status,200);
  const submitted=await call(examId,'submit',{studentId,name,answers:{q1:0}});assert.equal(submitted.body.submitted,true);assert.equal(submitted.body.score,undefined);
  assert.equal((await call(examId,'survey-submit',{studentId,name,answers:{s1:0,s2:0,s3:0,s4:0,s5:0}})).body.surveyComplete,true);
 }
 await call(ids[1],'admin-roster-add',{studentId:'C2',name:'丙'},code);
 assert.equal((await repo.roster(ids[1])).find(r=>r.student_id==='C2').group_name,'C');
 assert.equal((await repo.list(ids[0],0,100)).length,1);assert.equal((await repo.list(ids[1],0,100)).length,1);
});
test('pending banks cannot open, preview or accept answers even if marked open',async()=>{
 const handler=createHandler({settings:async()=>({admin_hash:await sha256(code),allowed_origins:[]}),exam:async()=>({questions:[{id:'pending',pending:true}],open:true,server_now:'2027-01-01T11:00:00Z',opens_at:'2027-01-01T10:00:00Z',closes_at:'2027-01-01T11:30:00Z'})});
 for(const action of ['start','submit','admin-preview','admin-bank','admin-open-now','admin-toggle']){
  const r=await handler(new Request('https://test',{method:'POST',headers:{'Content-Type':'application/json','X-Teacher-Code':code},body:JSON.stringify({examId:'pending-cohort2',action,open:true})}));assert.equal(r.status,409,action);
 }
});
