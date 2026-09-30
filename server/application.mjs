export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function normalizeIdentity(name, studentId) {
  if (typeof name !== 'string' || typeof studentId !== 'string') throw new ApiError(400, '請填寫姓名與學號。');
  const cleanName = name.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const cleanId = studentId.normalize('NFKC').trim().toUpperCase();
  if (!cleanName || cleanName.length > 60 || /[\p{Cc}\p{Cf}]/u.test(cleanName)) throw new ApiError(400, '請輸入有效姓名（最多 60 字）。');
  if (!/^[A-Z0-9][A-Z0-9-]{0,31}$/.test(cleanId)) throw new ApiError(400, '學號限 1–32 碼英文字母、數字或連字號，請勿包含空格。');
  return { name: cleanName, studentId: cleanId };
}

export function validateAnswers(answers, questions) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length !== questions.length) throw new ApiError(400, '請完成所有題目後再交卷。');
  for (const q of questions) {
    if (!Object.hasOwn(answers, q.id) || !Number.isInteger(answers[q.id]) || answers[q.id] < 0 || answers[q.id] >= q.options.length) throw new ApiError(400, '請完成所有題目後再交卷。');
  }
  return Object.fromEntries(questions.map(q => [q.id, answers[q.id]]));
}

export async function sha256(value) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(buffer)].map(n => n.toString(16).padStart(2, '0')).join('');
}

function equalDigest(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function createHandler(repository) {
  return async function handle(request) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    try {
      const settings = await repository.settings();
      const origin = request.headers.get('Origin');
      if (origin) {
        if (!settings.allowed_origins.includes(origin)) throw new ApiError(403, '此網站尚未獲准使用測驗服務。');
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'content-type, x-teacher-code';
      }
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') throw new ApiError(405, '僅接受測驗頁面送出的請求。');
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new ApiError(415, '不支援的資料格式。');
      const text = await request.text();
      if (text.length > 16384) throw new ApiError(413, '送出的資料過長。');
      let body;
      try { body = JSON.parse(text); } catch { throw new ApiError(400, '資料格式不正確。'); }
      if (!body || typeof body !== 'object' || typeof body.examId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(body.examId)) throw new ApiError(400, '無效的測驗場次。');
      const admin = ['admin-list', 'admin-toggle'].includes(body.action);
      if (admin) {
        const code = request.headers.get('X-Teacher-Code') || '';
        if (code.length < 32 || code.length > 150 || !equalDigest(await sha256(code), settings.admin_hash)) throw new ApiError(401, '管理碼不正確。');
      } else if (!['start', 'submit'].includes(body.action)) throw new ApiError(400, '無效的操作。');
      const exam = await repository.exam(body.examId);
      if (!exam) throw new ApiError(404, '找不到此場測驗，請確認講師提供的網址。');
      if (admin) {
        if (body.action === 'admin-toggle') {
          if (typeof body.open !== 'boolean') throw new ApiError(400, '請指定收卷狀態。');
          await repository.setOpen(exam.id, body.open);
          return reply({ ok: true });
        }
        const offset = body.offset ?? 0;
        if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new ApiError(400, '無效的分頁。');
        const rows = await repository.list(exam.id, offset, 501);
        return reply({ exam: { id: exam.id, title: exam.title, open: exam.open }, rows: rows.slice(0, 500), hasMore: rows.length > 500 });
      }
      const identity = normalizeIdentity(body.name, body.studentId);
      // Repeated requests return only a receipt; neither stored responses nor grades are returned.
      if (await repository.submitted(exam.id, identity.studentId)) return reply({ submitted: true });
      if (!exam.open) throw new ApiError(409, '本場測驗尚未開放或已停止收卷，請聯絡講師。');
      if (body.action === 'start') {
        return reply({ title: exam.title, identity, questions: exam.questions.map(q => ({ id: q.id, text: q.text, options: q.options })) });
      }
      const answers = validateAnswers(body.answers, exam.questions);
      await repository.submit(exam.id, identity, answers);
      return reply({ submitted: true });
    } catch (error) {
      if (error instanceof ApiError) return reply({ error: error.message }, error.status);
      // Do not expose database errors, answer keys, credentials, or student information.
      return reply({ error: '服務暫時無法處理，請保留此頁並稍後重試。' }, 503);
    }
  };
}
