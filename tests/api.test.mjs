import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,sha256} from '../server/application.mjs';
import {localRepository} from '../server/local-repository.mjs';
const code='test-only-teacher-code-32-characters-minimum';
const quiz={q1:0,q2:1}, survey={s1:0,s2:1,s3:2,s4:3,s5:4};
async function setup(t) {
  let now=Date.parse('2026-09-30T18:45:00+08:00');
  const fixture={roster:['A123','B123'].map(student_id=>({exam_id:'exam-one',student_id,name:'測試學員',group_name:'B'})),settings:{admin_hash:await sha256(code),allowed_origins:['https://school.example']},exams:[{id:'exam-one',title:'Synthetic test',open:true,opens_at:'2026-09-30T18:30:00+08:00',closes_at:'2026-09-30T19:30:00+08:00',questions:[{id:'q1',text:'A?',options:['A','B']},{id:'q2',text:'B?',options:['A','B']}],answer_key:quiz}]};
  const repo=localRepository(':memory:',fixture,{now:()=>now});
  t.after(()=>repo.close());const handler=createHandler(repo);
  const call=async(body,teacher='',origin='https://school.example')=>{
    const response=await handler(new Request('https://api.example',{method:'POST',headers:{'content-type':'application/json',Origin:origin,'X-Teacher-Code':teacher},body:JSON.stringify({examId:'exam-one',name:'測試學員',studentId:'A123',...body})}));
    return {status:response.status,body:await response.json()};
  };
  return {repo,call,handler,setTime:value=>{now=Date.parse(value);}};
}
test('no answers or grades in student payload; survey appears only after quiz',async t=>{
  const {call}=await setup(t);const start=await call({action:'start'});
  assert.equal(start.status,200);assert.equal(start.body.questions.length,2);
  assert.deepEqual(Object.keys(start.body.questions[0]).sort(),['id','options','text']);
  assert.equal(start.body.survey,undefined);assert.equal(start.body.score,undefined);
  const receipt=await call({action:'submit',answers:quiz,score:0});
  assert.equal(receipt.body.submitted,true);assert.equal(receipt.body.surveyComplete,false);
  assert.equal(receipt.body.survey.length,5);assert.equal(receipt.body.score,undefined);
  assert.equal((await call({action:'admin-list'},code)).body.rows[0].score,100);
});
test('exact opening and closing boundaries apply to both quiz and survey',async t=>{
  const {call,setTime}=await setup(t);
  setTime('2026-09-30T18:29:59.999+08:00');
  assert.equal((await call({action:'start'})).status,409);
  assert.equal((await call({action:'submit',answers:quiz,serverNow:'2026-09-30T11:00:00Z'})).status,409);
  setTime('2026-09-30T18:30:00+08:00');
  assert.equal((await call({action:'submit',answers:quiz})).status,200);
  setTime('2026-09-30T19:30:00+08:00');
  assert.equal((await call({action:'survey-submit',answers:survey})).status,409);
  assert.equal((await call({action:'submit',studentId:'B123',answers:quiz})).status,409);
  assert.equal((await call({action:'start'})).body.surveyComplete,false);
  assert.equal((await call({action:'start'})).body.survey,undefined);
});
test('19:29:59.999 is allowed; another date is not',async t=>{
  const {call,setTime}=await setup(t);
  setTime('2026-09-30T19:29:59.999+08:00');
  await call({action:'submit',answers:quiz});
  assert.equal((await call({action:'survey-submit',answers:survey})).body.surveyComplete,true);
  setTime('2026-10-01T18:45:00+08:00');
  assert.equal((await call({action:'start',studentId:'B123'})).status,409);
});
test('reopening never bypasses the cutoff',async t=>{
  const {call,setTime}=await setup(t);setTime('2026-09-30T19:30:00+08:00');
  await call({action:'admin-toggle',open:true},code);
  assert.equal((await call({action:'submit',answers:quiz})).status,409);
});
test('anonymous statistics have no identity fields; completion is separate and atomic',async t=>{
  const {call,repo,setTime}=await setup(t);
  assert.equal((await call({action:'survey-submit',answers:survey})).status,409);
  await call({action:'submit',answers:quiz});
  assert.equal((await call({action:'survey-submit',answers:{s1:0}})).status,400);
  assert.equal((await call({action:'admin-list'},code)).body.rows[0].survey_complete,false);
  assert.equal((await repo.surveyStats('exam-one')).length,0);
  await Promise.all(Array.from({length:12},()=>call({action:'survey-submit',answers:survey})));
  const record=(await call({action:'admin-list'},code)).body.rows[0];
  assert.equal(record.survey_complete,true);
  assert.equal(record.survey_answers,undefined);assert.equal(record.survey_completed_at,undefined);
  const bins=await repo.surveyStats('exam-one');
  assert.equal(bins.length,5);for(const bin of bins){assert.equal(bin.response_count,1);assert.deepEqual(Object.keys(bin).sort(),['choice','item_id','response_count']);}
  assert.equal((await call({action:'admin-survey'},code)).body.available,false);
  setTime('2026-09-30T19:30:00+08:00');
  const stats=(await call({action:'admin-survey'},code)).body;
  assert.equal(stats.available,true);assert.equal(stats.counts.length,5);
  assert.equal((await call({action:'survey-submit',answers:survey})).body.surveyComplete,true);
});
test('resume pending questionnaire without retaking; completed request retries are safe',async t=>{
  const {call}=await setup(t);await call({action:'submit',answers:quiz});
  const resumed=await call({action:'start',studentId:' ａ１２３ ',name:' 測試學員 '});
  assert.equal(resumed.body.submitted,true);assert.equal(resumed.body.questions,undefined);assert.equal(resumed.body.survey.length,5);
  await call({action:'survey-submit',answers:survey});
  assert.equal((await call({action:'start'})).body.surveyComplete,true);
  await call({action:'submit',answers:{q1:1,q2:0}});
  assert.equal((await call({action:'admin-list'},code)).body.rows[0].score,100);
});
test('concurrent quiz submissions preserve first score and name',async t=>{
  const {call}=await setup(t);
  await Promise.all(Array.from({length:12},()=>call({action:'submit',answers:quiz})));
  await call({action:'submit',studentId:' ａ１２３ ',name:'不得覆寫',answers:{q1:1,q2:0}});
  const rows=(await call({action:'admin-list'},code)).body.rows;
  assert.equal(rows.length,1);assert.equal(rows[0].score,100);assert.equal(rows[0].name,'測試學員');
});
test('bad answers and unknown actions cannot write',async t=>{
  const {call}=await setup(t);
  for(const answers of [{q1:0},{q1:0,q2:2},{q1:0,q2:'1'},{q1:0,q2:1,q3:1},null])assert.equal((await call({action:'submit',answers})).status,400);
  assert.equal((await call({action:'delete'})).status,400);
  assert.equal((await call({action:'admin-list'},code)).body.rows.length,0);
});
test('all teacher endpoints require a valid code; dates are validated and fixed to Taipei time',async t=>{
  const {call}=await setup(t);
  for(const action of ['admin-list','admin-toggle','admin-schedule','admin-survey','admin-roster'])assert.equal((await call({action,date:'2026-10-01',open:true})).status,401);
  assert.equal((await call({action:'admin-schedule',date:'2026-02-30'},code)).status,400);
  assert.equal((await call({action:'admin-schedule',date:'2026-10-01'},code)).status,200);
  const w=(await call({action:'info'})).body.window;
  assert.equal(w.opensAt,'2026-10-01T18:30:00+08:00');assert.equal(w.closesAt,'2026-10-01T19:30:00+08:00');
  assert.equal((await call({action:'start'})).status,409);
});
test('paused, unscheduled, bad identity and disallowed origins fail closed',async t=>{
  const {call,repo}=await setup(t);
  assert.equal((await call({action:'info'},'','https://evil.example')).status,403);
  assert.equal((await call({action:'start',name:' '})).status,400);
  await call({action:'admin-toggle',open:false},code);
  assert.equal((await call({action:'start'})).status,409);
  await repo.setSchedule('exam-one',{opens_at:null,closes_at:null});
  assert.equal((await call({action:'info'})).body.window.state,'unscheduled');
  assert.equal((await call({action:'start'})).status,409);
});
test('authoritative write rechecks time after an earlier successful read',async t=>{
  const {call,repo,setTime}=await setup(t);
  const original=repo.submit.bind(repo);
  repo.submit=async(...args)=>{setTime('2026-09-30T19:30:00+08:00');return original(...args);};
  assert.equal((await call({action:'submit',answers:quiz})).status,409);
  assert.equal((await call({action:'admin-list'},code)).body.rows.length,0);
});

test('roster blocks unknown IDs and mismatched names on every student action, including receipts',async t=>{
  const {call,repo}=await setup(t);
  for(const action of ['start','submit','survey-submit']){
    for(const identity of [{studentId:'OUTSIDE'},{name:'其他姓名'}]){
      const r=await call({action,...identity,answers:action==='survey-submit'?survey:quiz});
      assert.equal(r.status,403);assert.deepEqual(Object.keys(r.body),['error']);
    }
  }
  assert.equal((await call({action:'start',studentId:' ａ１２３ ',name:' 測試學員 '})).status,200);
  await call({action:'submit',answers:quiz});
  assert.equal((await call({action:'start',name:'冒用'})).status,403);
  assert.equal((await call({action:'survey-submit',name:'冒用',answers:survey})).status,403);
  assert.equal((await repo.surveyStats('exam-one')).length,0);
  repo.db.prepare('INSERT INTO submissions VALUES(?,?,?,?,?,?,?)').run('exam-one','OUTSIDE','測試學員','{}',0,'2026-09-30T10:35:00Z',0);
  assert.equal((await call({action:'start',studentId:'OUTSIDE'})).status,403);
  assert.equal((await call({action:'survey-submit',studentId:'OUTSIDE',answers:survey})).status,403);
  assert.equal((await call({action:'admin-list'},code)).body.rows.length,2);
  assert.equal((await call({action:'admin-roster'},code)).body.rows.length,2);
  assert.equal((await call({action:'info'})).body.rows,undefined);
});
