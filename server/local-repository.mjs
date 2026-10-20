import { DatabaseSync } from 'node:sqlite';
import { ApiError, requireOpen, validateAnswers, answersEqual } from './application.mjs';
export function localRepository(filename, fixture, { now = () => Date.now() } = {}) {
  const db = new DatabaseSync(filename);
  db.exec('CREATE TABLE IF NOT EXISTS submissions (exam_id TEXT NOT NULL, student_id TEXT NOT NULL, name TEXT NOT NULL, answers TEXT NOT NULL, score INTEGER NOT NULL, submitted_at TEXT NOT NULL, PRIMARY KEY(exam_id,student_id));');
  if (!db.prepare('PRAGMA table_info(submissions)').all().some(c => c.name === 'survey_complete')) db.exec('ALTER TABLE submissions ADD COLUMN survey_complete INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE TABLE IF NOT EXISTS survey_counts (exam_id TEXT NOT NULL,item_id TEXT NOT NULL,choice INTEGER NOT NULL,response_count INTEGER NOT NULL,PRIMARY KEY(exam_id,item_id,choice))');
  db.exec('CREATE TABLE IF NOT EXISTS assignments (exam_id TEXT NOT NULL,student_id TEXT NOT NULL,questions TEXT NOT NULL,answer_key TEXT NOT NULL,PRIMARY KEY(exam_id,student_id))');
  if (!db.prepare('PRAGMA table_info(submissions)').all().some(c=>c.name==='question_ids')) db.exec('ALTER TABLE submissions ADD COLUMN question_ids TEXT');
  const pick = e => {
    if(!e.assignment_rules)return structuredClone(e.questions);
    const shuffle=values=>{const result=[...values];for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;};
    const result=e.assignment_rules.flatMap(rule=>shuffle(e.questions.filter(q=>rule.ids.includes(q.id))).slice(0,rule.count));
    if(result.length!==e.assignment_rules.reduce((sum,r)=>sum+r.count,0)||new Set(result.map(q=>q.id)).size!==result.length)throw Error('Invalid rules');
    return structuredClone(shuffle(result));
  };
  const exams = new Map(fixture.exams.map(exam => [exam.id, structuredClone(exam)]));
  const context = id => exams.has(id) ? { ...exams.get(id), server_now:new Date(now()).toISOString() } : undefined;
  return {
    db,
    async settings() { return fixture.settings; },
    async answerKey(id) { return exams.get(id).answer_key; },
    async previewQuestions(id) { return pick(exams.get(id)); },
    async assignedQuestions(id,identity) {
      const e=context(id);requireOpen(e);
      if(!(fixture.roster||[]).some(r=>r.exam_id===id&&r.student_id===identity.studentId&&r.name===identity.name))throw new ApiError(403,'不在名單');
      const existing=db.prepare('SELECT questions FROM assignments WHERE exam_id=? AND student_id=?').get(id,identity.studentId);
      if(existing)return JSON.parse(existing.questions);
      const questions=pick(e),key=Object.fromEntries(questions.map(q=>[q.id,e.answer_key[q.id]]));
      db.prepare('INSERT INTO assignments VALUES(?,?,?,?)').run(id,identity.studentId,JSON.stringify(questions),JSON.stringify(key));
      return questions;
    },
    async exam(id) { return context(id); },
    async addRoster(examId, identity) {
      fixture.roster ||= [];
      if(fixture.roster.some(r=>r.exam_id===examId && r.student_id===identity.studentId)) throw new ApiError(409,'此學號已在應考名單中，請先核對現有資料。');
      fixture.roster.push({exam_id:examId,student_id:identity.studentId,name:identity.name,group_name:'B'});
    },
    async authorize(examId, identity) {
      return (fixture.roster || []).find(r=>r.exam_id===examId && r.student_id===identity.studentId && r.name===identity.name)?.name || null;
    },
    async roster(examId) { return (fixture.roster || []).filter(r=>r.exam_id===examId).map(({student_id,name,group_name})=>({student_id,name,group_name})); },
    async submission(examId, studentId) {
      const row = db.prepare('SELECT survey_complete FROM submissions WHERE exam_id=? AND student_id=?').get(examId,studentId);
      return row ? {survey_complete:!!row.survey_complete} : undefined;
    },
    async submit(examId,identity,answers) {
      const exam = context(examId);
      if (db.prepare('SELECT 1 FROM submissions WHERE exam_id=? AND student_id=?').get(examId,identity.studentId)) return;
      requireOpen(exam);
      const assignment=exam.assignment_rules ? db.prepare('SELECT * FROM assignments WHERE exam_id=? AND student_id=?').get(examId,identity.studentId) : null;
      if(exam.assignment_rules&&!assignment)throw new ApiError(409,'Assignment required');
      const questions=assignment?JSON.parse(assignment.questions):exam.questions,key=assignment?JSON.parse(assignment.answer_key):exam.answer_key;
      answers=validateAnswers(answers,questions);
      const correct=questions.filter(q=>answersEqual(answers[q.id],key[q.id])).length;
      db.prepare('INSERT OR IGNORE INTO submissions(exam_id,student_id,name,answers,score,submitted_at,question_ids) VALUES(?,?,?,?,?,?,?)').run(examId,identity.studentId,identity.name,JSON.stringify(answers),Math.round(correct*100/questions.length),new Date(now()).toISOString(),JSON.stringify(questions.map(q=>q.id)));
    },
    async submitSurvey(examId,studentId,answers) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row=db.prepare('SELECT survey_complete FROM submissions WHERE exam_id=? AND student_id=?').get(examId,studentId);
        if (!row) throw new ApiError(409,'請先交卷。');
        if (!row.survey_complete) {
          requireOpen(context(examId));
          for (const [item,choice] of Object.entries(answers)) db.prepare('INSERT INTO survey_counts VALUES(?,?,?,1) ON CONFLICT(exam_id,item_id,choice) DO UPDATE SET response_count=response_count+1').run(examId,item,choice);
          db.prepare('UPDATE submissions SET survey_complete=1 WHERE exam_id=? AND student_id=?').run(examId,studentId);
          requireOpen(context(examId));
        }
        db.exec('COMMIT');
      } catch(error) {db.exec('ROLLBACK');throw error;}
    },
    async list(examId,offset,limit) {
      return db.prepare('SELECT * FROM submissions WHERE exam_id=? ORDER BY submitted_at,student_id LIMIT ? OFFSET ?').all(examId,limit,offset).map(row=>({...row,answers:JSON.parse(row.answers),question_ids:row.question_ids?JSON.parse(row.question_ids):null,survey_complete:!!row.survey_complete}));
    },
    async surveyStats(id) {return db.prepare('SELECT item_id,choice,response_count FROM survey_counts WHERE exam_id=? ORDER BY item_id,choice').all(id);},
    async openNow(id) {
      const e=context(id), current=now();
      const taipeiDay=value=>new Date(Date.parse(value)+8*3600000).toISOString().slice(0,10);
      if(!e?.opens_at || !e.closes_at || current>=Date.parse(e.closes_at) || taipeiDay(e.closes_at)!==taipeiDay(e.server_now)) throw new ApiError(409,'僅能在考試當天、截止前立即開放；請先確認已儲存的考試日期。');
      Object.assign(exams.get(id),{open:true,opens_at:new Date(Math.min(current,Date.parse(e.opens_at))).toISOString()});
    },
    async setOpen(id,open) {exams.get(id).open=open;},
    async setSchedule(id,schedule) {Object.assign(exams.get(id),schedule);},
    close(){db.close();}
  };
}
