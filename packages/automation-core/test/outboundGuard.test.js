// Контроль исходящего текста (outboundGuard.js): конверт, шаблоны, проверка адресата.
// Главный случай — живая утечка 26.09.2026: хвост с вопросами кандидату про сам текст
// ушёл работодателю, ни один шаблон его не знал.
const test = require('node:test');
const assert = require('node:assert');
const { stripAssistantLeak } = require('../src/assistantLeak');
const { extractEnvelope, checkAddressee, guardOutgoing, parseFlags, applyFlags } = require('../src/outboundGuard');
const { sentenceSpans } = require('../src/assistantLeak');
const { generateReply } = require('../src/replyAgent');

const BODY = 'Здравствуйте, Дарья!\n'
  + 'Спасибо за предоставленное тестовое задание. Я ознакомился с требованиями.\n'
  + 'После того как я передам выполненное задание, мы сможем созвониться?';
const LEAK = 'Если вы хотите, чтобы я скорректировал ответ, уточните:\n'
  + 'Нужно ли добавить ссылку на GitHub или другие примеры кода прямо сейчас?\n'
  + 'Требуется ли изменить тон сообщения?';

// ИИ-заглушка: отвечает по kind. Записывает, какие запросы были.
function fakeLlm(byKind) {
  const calls = [];
  return {
    calls,
    async ask(system, user, opts) {
      calls.push(opts.kind);
      const r = byKind[opts.kind];
      if (r instanceof Error) throw r;
      return { text: typeof r === 'function' ? r(user, calls) : r };
    },
  };
}

const PROFILE = { fullName: 'Тимофей', strongStack: ['React'], honestGaps: [], contactTelegram: '' };
const THREAD = { resumeText: 'React', vacancyTitle: 'Фронтенд', company: 'GREEN-API', messages: [{ from: 'employer', text: 'Выполните тестовое, дедлайн 5 дней.' }] };

test('живой случай 26.09: шаблоны режут хвост целиком', () => {
  const r = stripAssistantLeak(`${BODY}\n${LEAK}`);
  assert.strictEqual(r.text, BODY);
  assert.ok(r.dropped.startsWith('Если вы хотите, чтобы я скорректировал ответ'));
});

test('новые шаблоны по одному', () => {
  for (const t of ['Могу скорректировать этот ответ.', 'Скорректирую текст, если нужно.',
    'Если хотите, чтобы я переписал вступление — скажите.', 'Требуется ли изменить тон сообщения?',
    'Могу поменять тон на более формальный.', 'Можно сделать ответ короче.', 'Подойдёт ли тон ответа?']) {
    assert.strictEqual(stripAssistantLeak(`Здравствуйте! ${t}`).text, 'Здравствуйте!', t);
  }
});

test('нормальные фразы работодателю шаблоны не трогают', () => {
  for (const t of ['Нужно ли использовать TypeScript в тестовом задании?', 'Могу прислать примеры кода, если это будет полезно.',
    'Уточните, пожалуйста, формат сдачи задания.', 'Если нужно скорректировать время, дайте знать — подстроюсь.',
    'Код пишу в строгом стиле TypeScript.', 'Требуется ли покрытие тестами?', 'Результат отправлю на указанную почту.',
    // копирайтер/редактор — эти слова для него рабочие
    'Умею держать единый тон сообщений бренда.', 'У меня лёгкий стиль письма.', 'Могу скорректировать тексты сайта под ваш ToV.',
    'Умею сделать текст проще и понятнее.', 'Пишу письма клиентам в дружелюбном тоне.']) {
    const r = stripAssistantLeak(`Здравствуйте! ${t}`);
    assert.strictEqual(r.leaked, false, t);
  }
});

test('конверт: уходит только содержимое меток', () => {
  const e = extractEnvelope(`Вот ответ:\n[[СООБЩЕНИЕ]]\n${BODY}\n[[/СООБЩЕНИЕ]]\nЕсли нужно, могу сделать тон мягче.`);
  assert.strictEqual(e.text, BODY);
  assert.ok(e.enveloped);
  assert.ok(e.outside.includes('тон мягче'));

  assert.strictEqual(extractEnvelope(BODY).text, BODY);
  assert.strictEqual(extractEnvelope(`${BODY}\n[[/СООБЩЕНИЕ]]\nкомментарий`).text, BODY);
  assert.strictEqual(extractEnvelope(`[[СООБЩЕНИЕ]]${BODY}`).text, BODY);
  assert.ok(!/СООБЩЕНИЕ|message>/i.test(extractEnvelope('[[СООБЩЕНИЕ]]Привет[[/СООБЩЕНИЕ]][[СООБЩЕНИЕ]]ещё[[/СООБЩЕНИЕ]]').text));
  assert.strictEqual(extractEnvelope('[[ сообщение ]]\nПривет\n[[ / сообщение ]]\nкомментарий').text, 'Привет');
  assert.strictEqual(extractEnvelope('<message>Привет</message>').text, 'Привет');
});

test('разбор ответа проверки', () => {
  assert.deepStrictEqual(parseFlags('{"meta": [5, 4, 4]}', 6), [4, 5]);
  assert.deepStrictEqual(parseFlags('Вот результат: {"meta": []}', 6), []);
  assert.deepStrictEqual(parseFlags('[2, 9]', 6), [2]);
  assert.strictEqual(parseFlags('не знаю', 6), null);
});

test('отмеченные предложения: заголовок убираем, хвост режем', () => {
  const text = `Вот ответ:\n${BODY}\n${LEAK}`;
  const spans = sentenceSpans(text);
  // 1 — заголовок, 2..5 — тело (строка 2 из двух предложений), 6..8 — хвост
  const body = applyFlags(text, spans, [1, 6, 7, 8]);
  assert.strictEqual(body.text, BODY);
  assert.ok(body.dropped.includes('Вот ответ') && body.dropped.includes('тон сообщения'));
  // Отмечено только начало хвоста — режем до конца всё равно: вопросы после него тоже служебные.
  const noHeader = `${BODY}\n${LEAK}`;
  assert.strictEqual(applyFlags(noHeader, sentenceSpans(noHeader), [5]).text, BODY);
  assert.strictEqual(applyFlags(text, spans, []).text, text);
});

test('проверка адресата ловит формулировку, которой нет в шаблонах', async () => {
  const novel = `${BODY}\nЕсли что-то в тексте не так — поправлю.`;
  assert.strictEqual(stripAssistantLeak(novel).leaked, false); // шаблоны не знают
  const llm = fakeLlm({ leak_check: '{"meta": [5]}' });
  const r = await checkAddressee(novel, llm);
  assert.strictEqual(r.checked, true);
  assert.strictEqual(r.text, BODY);
  assert.deepStrictEqual(llm.calls, ['leak_check']);
});

test('битый ответ проверки — вторая попытка', async () => {
  let n = 0;
  const llm = fakeLlm({ leak_check: () => (++n === 1 ? '{"meta":}' : '{"meta": [5]}') });
  const r = await checkAddressee(`${BODY}\nМогу поправить формулировки.`, llm);
  assert.strictEqual(r.checked, true);
  assert.strictEqual(r.text, BODY);
  assert.deepStrictEqual(llm.calls, ['leak_check', 'leak_check']);
});

test('проверка упала — текст не теряем, помечаем', async () => {
  const down = await checkAddressee(BODY, fakeLlm({ leak_check: new Error('timeout') }));
  assert.strictEqual(down.checked, false);
  assert.strictEqual(down.text, BODY);
  const junk = await checkAddressee(BODY, fakeLlm({ leak_check: 'Всё хорошо!' }));
  assert.strictEqual(junk.checked, false);
  assert.strictEqual(junk.text, BODY);
});

test('guardOutgoing: хвост внутри конверта — срежут шаблоны, даже если проверка промолчала', async () => {
  const r = await guardOutgoing(`[[СООБЩЕНИЕ]]\n${BODY}\n${LEAK}\n[[/СООБЩЕНИЕ]]`, { llmClient: fakeLlm({ leak_check: '{"meta": []}' }) });
  assert.strictEqual(r.text, BODY);
  assert.strictEqual(r.leaked, true);
  assert.strictEqual(r.checked, true);
});

test('generateReply: комментарий модели после конверта работодателю не уходит', async () => {
  const llm = fakeLlm({
    chat_reply: `[[СООБЩЕНИЕ]]\n${BODY}\n[[/СООБЩЕНИЕ]]\nЕсли хотите, могу добавить ссылку на GitHub или сменить тон.`,
    leak_check: '{"meta": []}',
  });
  const r = await generateReply(THREAD, PROFILE, llm);
  assert.strictEqual(r.needsHuman, false);
  assert.strictEqual(r.text, BODY);
  assert.strictEqual(r.trimmedLeak, null);
  assert.strictEqual(r.addresseeChecked, true);
  assert.deepStrictEqual(llm.calls, ['chat_reply', 'leak_check']);
});

test('generateReply: модель проигнорировала конверт и дописала новый хвост — режет проверка', async () => {
  const llm = fakeLlm({
    chat_reply: `${BODY}\nМогу оформить иначе, если так будет лучше.`,
    leak_check: (user) => (user.includes('оформить иначе') ? '{"meta": [5]}' : '{"meta": []}'),
  });
  const r = await generateReply(THREAD, PROFILE, llm);
  assert.strictEqual(r.text, BODY);
  assert.ok(r.trimmedLeak.includes('оформить иначе'));
});

test('generateReply: всё сообщение не работодателю — не отправляем', async () => {
  const llm = fakeLlm({ chat_reply: `[[СООБЩЕНИЕ]]\n${LEAK}\n[[/СООБЩЕНИЕ]]`, leak_check: '{"meta": [1, 2, 3]}' });
  await assert.rejects(() => generateReply(THREAD, PROFILE, llm), /не отправляю/);
});

test('промпт ответа требует конверт', async () => {
  const { buildSystemPrompt, buildScreenerBotPrompt } = require('../src/replyAgent');
  assert.ok(buildSystemPrompt(PROFILE).includes('[[СООБЩЕНИЕ]]'));
  assert.ok(buildScreenerBotPrompt(PROFILE).includes('[[СООБЩЕНИЕ]]'));
});
