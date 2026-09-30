import { DatabaseSync } from 'node:sqlite';
import { ApiError, requireOpen } from './application.mjs';
export function localRepository(filename, fixture, { now = () => Date.now() } = {}) {
  const db = new DatabaseSync(filename);
  db.exec('CREATE TABLE IF NOT EXISTS submissions (exam_id TEXT NOT NULL, student_id TEXT NOT NULL, name TEXT NOT NULL, answers TEXT NOT NULL, score INTEGER NOT NULL, submitted_at TEXT NOT NULL, PRIMARY KEY(exam_id,student_id));');
  if (!db.prepare('PRAGMA table_info(submissions)').all().some(c => c.name === 'survey_complete')) db.exec('ALTER TABLE submissions ADD COLUMN survey_complete INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE TABLE IF NOT EXISTS survey_counts (exam_id TEXT NOT NULL,item_id TEXT NOT NULL,choice INTEGER NOT NULL,response_count INTEGER NOT NULL,PRIMARY KEY(exam_id,item_id,choice))');
  const exams = new Map(fixture.exams.map(exam => [exam.id, structuredClone(exam)]));
  const context = id => exams.has(id) ? { ...exams.get(id), server_now:new Date(now()).toISOString() } : undefined;
  return {
    db,
    async settings() { return fixture.settings; },
    async exam(id) { return context(id); },
    async submission(examId, studentId) {
      const row = db.prepare('SELECT survey_complete FROM submissions WHERE exam_id=? AND student_id=?').get(examId,studentId);
      return row ? {survey_complete:!!row.survey_complete} : undefined;
    },
    async submit(examId,identity,answers) {
      const exam = context(examId);
      if (db.prepare('SELECT 1 FROM submissions WHERE exam_id=? AND student_id=?').get(examId,identity.studentId)) return;
      requireOpen(exam);
      const correct=exam.questions.filter(q=>answers[q.id]===exam.answer_key[q.id]).length;
      db.prepare('INSERT OR IGNORE INTO submissions(exam_id,student_id,name,answers,score,submitted_at) VALUES(?,?,?,?,?,?)').run(examId,identity.studentId,identity.name,JSON.stringify(answers),Math.round(correct*100/exam.questions.length),new Date(now()).toISOString());
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
      return db.prepare('SELECT * FROM submissions WHERE exam_id=? ORDER BY submitted_at,student_id LIMIT ? OFFSET ?').all(examId,limit,offset).map(row=>({...row,answers:JSON.parse(row.answers),survey_complete:!!row.survey_complete}));
    },
    async surveyStats(id) {return db.prepare('SELECT item_id,choice,response_count FROM survey_counts WHERE exam_id=? ORDER BY item_id,choice').all(id);},
    async setOpen(id,open) {exams.get(id).open=open;},
    async setSchedule(id,schedule) {Object.assign(exams.get(id),schedule);},
    close(){db.close();}
  };
}
