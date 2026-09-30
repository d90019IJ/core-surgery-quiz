import { request, currentExam } from './api.js';
currentExam();
const $ = id => document.getElementById(id);
let identity, questions = [], busy = false, finished = false;
if (window.QUIZ_CONFIG.preview) $('preview-notice').hidden = false;

function done() {
  finished = true;
  identity = undefined;
  questions = [];
  const main = document.createElement('main');
  main.className = 'done-screen';
  const title = document.createElement('h1');
  title.tabIndex = -1;
  title.textContent = '你已交卷';
  main.append(title);
  document.body.replaceChildren(main);
  document.title = '你已交卷';
  title.focus();
}

function renderQuestions() {
  const fragment = document.createDocumentFragment();
  for (const [index, question] of questions.entries()) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'question';
    const legend = document.createElement('legend');
    const number = document.createElement('span');
    number.className = 'question-number';
    number.textContent = `QUESTION ${String(index + 1).padStart(2, '0')}`;
    legend.append(number, document.createTextNode(question.text));
    fieldset.append(legend);
    question.options.forEach((option, choice) => {
      const label = document.createElement('label');
      label.className = 'option';
      const input = document.createElement('input');
      input.type = 'radio'; input.name = question.id; input.value = choice; input.required = true;
      const text = document.createElement('span');
      text.className = 'option-text';
      const letter = document.createElement('span');
      letter.className = 'choice-letter'; letter.textContent = String.fromCharCode(65 + choice);
      text.append(letter, document.createTextNode(option));
      label.append(input, text); fieldset.append(label);
    });
    fragment.append(fieldset);
  }
  $('questions').replaceChildren(fragment);
  $('progress').max = questions.length;
  updateProgress();
}

function updateProgress() {
  const count = $('quiz-form').querySelectorAll('input:checked').length;
  $('progress').value = count;
  $('progress-label').textContent = `已作答 ${count} / ${questions.length}`;
}

$('identity-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  $('identity-error').textContent = '';
  $('start-button').disabled = true;
  $('start-button').textContent = '正在確認資料…';
  try {
    const result = await request('start', {
      name: $('student-name').value, studentId: $('student-id').value
    });
    if (result.submitted) { done(); return; }
    identity = result.identity;
    questions = result.questions;
    $('student-summary').textContent = `${identity.name} · ${identity.studentId}`;
    $('exam-title').textContent = result.title;
    renderQuestions();
    $('identity-view').hidden = true; $('quiz-view').hidden = false;
    $('main').classList.add('in-quiz');
    $('step1').classList.remove('active'); $('step2').classList.add('active');
    $('quiz-view').scrollIntoView({ block: 'start' });
  } catch (error) { $('identity-error').textContent = error.message; }
  finally {
    busy = false;
    if (!finished) { $('start-button').disabled = false; $('start-button').textContent = '開始作答'; }
  }
});
$('quiz-form').addEventListener('change', updateProgress);
$('quiz-form').addEventListener('submit', event => {
  event.preventDefault();
  if (busy) return;
  $('confirm-identity').textContent = `${identity.name} · ${identity.studentId}，已完成 ${questions.length} 題。`;
  $('submit-dialog').showModal();
});
$('cancel-submit').addEventListener('click', () => $('submit-dialog').close());
$('confirm-submit').addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  $('submit-dialog').close();
  $('quiz-error').textContent = '';
  $('submit-button').disabled = true;
  $('submit-button').textContent = '正在交卷…';
  for (const input of $('quiz-form').querySelectorAll('input')) input.disabled = true;
  const answers = Object.fromEntries(questions.map(question => [
    question.id, Number($('quiz-form').querySelector(`input[name="${question.id}"]:checked`).value)
  ]));
  try {
    const result = await request('submit', { ...identity, answers });
    if (!result.submitted) throw new Error('尚未確認交卷成功，請重試。');
    done();
  } catch (error) { $('quiz-error').textContent = error.message; }
  finally {
    busy = false;
    if (!finished) {
      $('submit-button').disabled = false; $('submit-button').textContent = '重試交卷';
      for (const input of $('quiz-form').querySelectorAll('input')) input.disabled = false;
    }
  }
});
window.addEventListener('beforeunload', event => {
  if (identity && !finished) { event.preventDefault(); event.returnValue = ''; }
});
