import { ApiError } from './application.mjs';

export function supabaseRepository(url, key) {
  if (!url || !key) throw new Error('Missing server configuration');
  async function query(path, options = {}) {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      ...options, headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(18000)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (error.message === 'EXAM_CLOSED') throw new ApiError(409, '本場測驗已停止收卷，請聯絡講師。');
      if (error.message === 'INVALID_ANSWERS') throw new ApiError(400, '請完成所有題目後再交卷。');
      throw new Error('Database operation failed');
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  const eq = value => encodeURIComponent(value);
  return {
    async settings() {
      const rows = await query('core_quiz_settings?select=admin_hash,allowed_origins&id=eq.1');
      if (!rows?.length) throw new Error('Quiz not configured');
      return rows[0];
    },
    async exam(id) {
      return (await query(`core_quiz_exams?select=id,title,open,questions&id=eq.${eq(id)}`))[0];
    },
    async submitted(examId, studentId) {
      return (await query(`core_quiz_submissions?select=student_id&exam_id=eq.${eq(examId)}&student_id=eq.${eq(studentId)}&limit=1`)).length > 0;
    },
    async submit(examId, identity, answers) {
      await query('rpc/core_quiz_submit', { method: 'POST', body: JSON.stringify({ p_exam_id: examId, p_student_id: identity.studentId, p_name: identity.name, p_answers: answers }) });
    },
    async list(examId, offset, limit) {
      return query(`core_quiz_submissions?select=name,student_id,submitted_at,score,answers&exam_id=eq.${eq(examId)}&order=submitted_at.asc,student_id.asc&offset=${offset}&limit=${limit}`);
    },
    async setOpen(id, open) {
      await query(`core_quiz_exams?id=eq.${eq(id)}`, { method: 'PATCH', body: JSON.stringify({ open }) });
    }
  };
}
