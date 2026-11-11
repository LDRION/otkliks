// Скрининг-бот hh принимает на закрытый вопрос только вариант ответа («Да» / «Нет», кнопками
// или текстом), а на развёрнутый ответ переспрашивает: по 46 тредам — 37 повторов (06.10.2026).
const test = require('node:test');
const assert = require('node:assert');
const { looksLikeClosedQuestion } = require('../src/employerMessage');
const { generateReply, deliverClarificationAnswer } = require('../src/replyAgent');

test('закрытые вопросы бота — «да/нет»', () => {
  for (const t of ['Есть ли у вас опыт сопровождения AI-продуктов/агентов/LLM-систем?',
    'Обучаетесь ли на данный момент в университете?', 'Вы готовы выполнить тестовое задание?',
    'Готовы получить сообщение от нашего HR?', 'Был ли у тебя опыт работы с LLM, RAG?',
    'Есть ли у вас красный диплом о профильном высшем образовании, как описано в вакансии?',
    'Работа предполагает формат присутствия в офисе в г. Кургане. Рассматриваете ли вы такой формат?',
    'У вас есть опыт преподавания программирования детям в формате групповых онлайн-занятий?']) {
    assert.ok(looksLikeClosedQuestion(t), t);
  }
  for (const t of ['Где вы проживаете на данный момент?', 'Какая ваша зарплатная вилка на данный момент?',
    'Сколько лет опыта с Python?', 'Офис или удалёнка?', 'Выберите удобный формат?', 'Спасибо!']) {
    assert.ok(!looksLikeClosedQuestion(t), t);
  }
});

const BOT_INTRO = 'Здравствуйте! Спасибо за интерес к вакансии. Чтобы работодатель узнал о вас больше, пожалуйста, ответьте на несколько вопросов. Это займет всего пару минут. Начнем?';
const thread = (quickReplies) => ({
  resumeText: 'Fullstack, 7 лет, Python, LLM-агенты, своя ИИ-платформа в продакшене.', vacancyTitle: 'Support engineer AI/LLM', company: 'ЛАНИТ',
  messages: [{ from: 'employer', text: BOT_INTRO }, { from: 'employer', text: 'Есть ли у вас опыт сопровождения AI-продуктов/агентов/LLM-систем?' }],
  isScreenerBot: true, quickReplies,
});
const profile = { fullName: 'Тимофей', strongStack: ['Python', 'LLM'], honestGaps: [], portfolioLink: null };
const llm = (...answers) => { const calls = []; return { calls, ask: async (s, u) => { calls.push(u); return { text: answers.shift() ?? '' }; } }; };

test('бот с вариантами: уходит ровно текст варианта', async () => {
  const l = llm('1');
  const r = await generateReply(thread(['Да', 'Нет']), profile, l);
  assert.deepStrictEqual(r, { needsHuman: false, text: 'Да', quickReply: true });
  assert.match(l.calls[0], /1\) Да\n2\) Нет/);
  assert.strictEqual((await generateReply(thread(['На территории РФ', 'За пределами РФ']), profile, llm('Вариант 2'))).text, 'За пределами РФ');
});

test('честно выбрать нельзя — вопрос человеку с вариантами', async () => {
  const r = await generateReply(thread(['Да', 'Нет']), profile, llm('0'));
  assert.strictEqual(r.needsHuman, true);
  assert.match(r.question, /Ответьте одним из вариантов: Да \/ Нет/);
});

test('модель не дала номер — не отправляем ничего', async () => {
  await assert.rejects(generateReply(thread(['Да', 'Нет']), profile, llm('Да, конечно', 'опыт есть')), /не выбрал вариант/);
  await assert.rejects(generateReply(thread(['Да', 'Нет']), profile, llm('7', '9')), /не выбрал вариант/);
});

test('ответ человека боту уходит как есть, без «улучшения»', async () => {
  const l = llm('Да, у меня большой опыт сопровождения…');
  const sent = await deliverClarificationAnswer({ messages: thread().messages, answerText: ' Да ', aiImprove: true, question: 'q' }, profile, l);
  assert.strictEqual(sent, 'Да');
  assert.strictEqual(l.calls.length, 0);
});
