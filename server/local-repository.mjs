import { DatabaseSync } from 'node:sqlite';
import { ApiError } from './application.mjs';

export function localRepository(filename, fixture) {
  const db = new DatabaseSync(filename);
  db.exec(`CREATE TABLE IF NOT EXISTS submissions (
    exam_id TEXT NOT NULL, student_id TEXT NOT NULL, name TEXT NOT NULL,
    answers TEXT NOT NULL, score INTEGER NOT NULL, submitted_at TEXT NOT NULL,
    PRIMARY KEY(exam_id, student_id));`);
  const exams = new Map(fixture.exams.map(exam => [exam.id, structuredClone(exam)]));
  return {
    db,
    async settings() { return fixture.settings; },
    async exam(id) { return exams.get(id); },
    async submitted(examId, studentId) { return !!db.prepare('SELECT 1 FROM submissions WHERE exam_id=? AND student_id=?').get(examId, studentId); },
    async submit(examId, identity, answers) {
      const exam = exams.get(examId);
      if (!exam.open) throw new ApiError(409, '本場測驗已停止收卷，請聯絡講師。');
      const correct = exam.questions.filter(q => answers[q.id] === exam.answer_key[q.id]).length;
      db.prepare('INSERT OR IGNORE INTO submissions VALUES(?,?,?,?,?,?)').run(examId, identity.studentId, identity.name, JSON.stringify(answers), Math.round(correct * 100 / exam.questions.length), new Date().toISOString());
    },
    async list(examId, offset, limit) {
      return db.prepare('SELECT * FROM submissions WHERE exam_id=? ORDER BY submitted_at,student_id LIMIT ? OFFSET ?').all(examId, limit, offset).map(row => ({ ...row, answers: JSON.parse(row.answers) }));
    },
    async setOpen(id, open) { exams.get(id).open = open; },
    close() { db.close(); }
  };
}
