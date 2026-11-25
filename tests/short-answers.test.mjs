import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAnswers,publicQuestions,createHandler,sha256} from '../server/application.mjs';
const questions=[{id:'q1',type:'short',fields:1,text:'Formula',review:{explanation:'private answer'}},{id:'q2',type:'short',fields:4,text:'Four interventions'},{id:'q3',text:'Choice',options:['A','B']}];
const good={q1:[' MAP - ICP '],q2:['one','two','three','four'],q3:0};
test('short answers preserve words, trim edges, require every field and reject oversized or malformed payloads',()=>{
 assert.deepEqual(validateAnswers(good,questions),{...good,q1:['MAP - ICP']});
 for(const q1 of [null,0,'MAP-ICP',[],[''],['   '],['x','y'],[null],['x'.repeat(801)]])assert.throws(()=>validateAnswers({...good,q1},questions));
 for(const q2 of [[],['one'],['a','b','c',' '],['a','b','c',2]])assert.throws(()=>validateAnswers({...good,q2},questions));
 assert.throws(()=>validateAnswers({...good,unknown:1},questions));
});
test('public short questions never leak private grading guidance',()=>{
 const result=publicQuestions(questions);assert.equal(result[0].fields,1);assert.equal(result[1].fields,4);assert.equal(result[0].review,undefined);assert.equal(result[0].type,'short');
});
test('both review endpoints require teacher authentication and return no data on failure',async()=>{
 const code='synthetic-teacher-code-at-least-32-characters';let touched=0;
 const repo={settings:async()=>({admin_hash:await sha256(code),allowed_origins:[]}),exam:async()=>({id:'qa',title:'QA',questions,open:false,server_now:new Date().toISOString()}),review:async()=>{touched++;return {record:{answers:good},questions};},grade:async()=>{touched++;}};
 const handler=createHandler(repo);const call=(action,key='',extra={})=>handler(new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json','X-Teacher-Code':key},body:JSON.stringify({examId:'qa',action,studentId:'QA123',...extra})}));
 for(const action of ['admin-review','admin-grade'])assert.equal((await call(action)).status,401);
 assert.equal(touched,0);assert.equal((await call('admin-review',code)).status,200);
 assert.equal((await call('admin-grade',code,{grades:{q1:[1],q2:[1,1,1,0]},note:''})).status,200);
 assert.equal((await call('admin-grade',code,{grades:[],note:''})).status,400);
 assert.equal((await call('admin-grade',code,{grades:{},note:'x'.repeat(2001)})).status,400);
 assert.equal(touched,2);
});
