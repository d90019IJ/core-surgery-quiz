import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, sha256 } from '../server/application.mjs';
import { localRepository } from '../server/local-repository.mjs';

// Synthetic data only; the real answer key must never be committed.
const code = 'test-only-teacher-code-32-characters-minimum';
async function setup(t) {
  const fixture = { settings: { admin_hash: await sha256(code), allowed_origins: ['https://school.example'] }, exams: [{ id: 'exam-one', title: 'Synthetic test', open: true, questions: [{id:'q1',text:'A?',options:['A','B']},{id:'q2',text:'B?',options:['A','B']}], answer_key: {q1:0,q2:1} }] };
  const repo = localRepository(':memory:', fixture);
  t.after(() => repo.close());
  const handler = createHandler(repo);
  const call = async (body, teacher = '', origin = 'https://school.example') => {
    const response = await handler(new Request('https://api.example', { method: 'POST', headers: {'content-type':'application/json',Origin:origin,'X-Teacher-Code':teacher}, body:JSON.stringify({examId:'exam-one', name:'測試學員', studentId:'A123',...body}) }));
    return { status: response.status, body: await response.json() };
  };
  return { repo, call, handler };
}
test('student start never returns answers or score', async t => {
  const { call } = await setup(t);
  const result = await call({ action: 'start' });
  assert.equal(result.status, 200); assert.equal(result.body.questions.length, 2);
  assert.deepEqual(Object.keys(result.body).sort(), ['identity', 'questions', 'title']);
  assert.deepEqual(Object.keys(result.body.questions[0]).sort(), ['id', 'options', 'text']);
});
test('successful submission returns a receipt only; grade is server calculated', async t => {
  const { call } = await setup(t);
  assert.deepEqual((await call({action:'submit',answers:{q1:0,q2:0},score:100})).body, {submitted:true});
  assert.equal((await call({action:'admin-list'},code)).body.rows[0].score,50);
  assert.deepEqual((await call({action:'start'})).body,{submitted:true});
});
test('same normalized student ID cannot overwrite first submission with a different name', async t => {
  const { call } = await setup(t);
  await call({action:'submit',studentId:' ａ１２３ ',answers:{q1:0,q2:1}});
  await call({action:'submit',name:'另一個名字',answers:{q1:1,q2:0}});
  const rows=(await call({action:'admin-list'},code)).body.rows;
  assert.equal(rows.length,1); assert.equal(rows[0].name,'測試學員'); assert.equal(rows[0].score,100);
});
test('concurrent requests yield a single immutable record', async t => {
  const { call } = await setup(t);
  await Promise.all(Array.from({length:12},()=>call({action:'submit',answers:{q1:0,q2:1}})));
  assert.equal((await call({action:'admin-list'},code)).body.rows.length,1);
});
test('rejects incomplete, out-of-range, string, extra and null answers', async t => {
  const { call } = await setup(t);
  for (const answers of [{q1:0},{q1:0,q2:2},{q1:0,q2:'1'},{q1:0,q2:1,q3:1},null]) assert.equal((await call({action:'submit',answers})).status,400);
  assert.equal((await call({action:'admin-list'},code)).body.rows.length,0);
});
test('teacher routes require a correct management code', async t => {
  const { call } = await setup(t);
  assert.equal((await call({action:'admin-list'})).status,401);
  assert.equal((await call({action:'admin-toggle',open:false},'x'.repeat(40))).status,401);
  assert.equal((await call({action:'admin-list'},code)).status,200);
});
test('closing prevents submission; reopening does not reset completed attempts', async t => {
  const { call } = await setup(t);
  await call({action:'submit',answers:{q1:0,q2:1}});
  await call({action:'admin-toggle',open:false},code);
  assert.equal((await call({action:'submit',studentId:'B123',answers:{q1:0,q2:1}})).status,409);
  await call({action:'admin-toggle',open:true},code);
  assert.deepEqual((await call({action:'start'})).body,{submitted:true});
});
test('origin, identity and operation validation', async t => {
  const { call } = await setup(t);
  assert.equal((await call({action:'start'},'','https://evil.example')).status,403);
  assert.equal((await call({action:'start',name:'  '})).status,400);
  assert.equal((await call({action:'start',studentId:'A 123'})).status,400);
  assert.equal((await call({action:'delete'})).status,400);
  assert.equal((await call({action:'start',examId:'missing'})).status,404);
});
