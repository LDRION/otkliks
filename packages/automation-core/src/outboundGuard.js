/**
 * outboundGuard.js — последний контроль текста, который уйдёт работодателю в чат.
 *
 * Чат-ассистенты за Siberi AI по привычке договаривают с тем, кто их спросил. Правило
 * адресата в промпте (AUDIENCE_RULE) и узкие шаблоны assistantLeak.js это снижают, но
 * формулировки каждый раз новые: живой случай 26.09.2026 — работодателю ушло «Если вы
 * хотите, чтобы я скорректировал ответ, уточните: Нужно ли добавить ссылку на GitHub…?
 * Требуется ли изменить тон сообщения?» — ни один шаблон этого не знал.
 *
 * Поэтому три слоя, каждый ловит то, что пропустил предыдущий:
 *  1. Конверт. Модель кладёт сообщение между [[СООБЩЕНИЕ]] и [[/СООБЩЕНИЕ]]; всё, что
 *     после закрывающей метки, отбрасывается. Уходит только то, что внутри: привычке
 *     «договорить» есть куда деться, не доходя до работодателя. Метки — не <message>:
 *     Siberi вычищает из ответа HTML-теги и markdown (проверено 29.09.2026), а такие
 *     квадратные скобки проходят как есть.
 *  2. Шаблоны (assistantLeak.js) — быстро и бесплатно режут известные формулировки.
 *  3. Проверка адресата — отдельный короткий запрос к ИИ: какие предложения обращены НЕ к
 *     работодателю. Ловит новые формулировки, которых нет ни в одном шаблоне.
 * Режем с первого служебного предложения до конца: сменив адресата, модель к работодателю
 * уже не возвращается, и хвост целиком служебный — даже фразы, которые сами по себе
 * выглядели бы невинно («Нужно ли добавить ссылку на GitHub?»).
 */

const { toPlainText } = require('./plainText');
const { stripAssistantLeak, sentenceSpans } = require('./assistantLeak');

const ENVELOPE_RULE = `ФОРМАТ ВЫВОДА — ОБЯЗАТЕЛЬНО. Сообщение помести между строками [[СООБЩЕНИЕ]] и [[/СООБЩЕНИЕ]]:
[[СООБЩЕНИЕ]]
текст сообщения
[[/СООБЩЕНИЕ]]
Отправлено будет ТОЛЬКО то, что между метками, — дословно и без чьей-либо проверки. Внутри меток —
только слова кандидата получателю: никаких пояснений, вариантов и вопросов тому, кто дал задание.
Всё, что окажется после [[/СООБЩЕНИЕ]], отбрасывается и никуда не уходит.`;

const TAG_OPEN = /\[\[\s*СООБЩЕНИЕ\s*\]\]/i;
const TAG_CLOSE = /\[\[\s*\/\s*СООБЩЕНИЕ\s*\]\]/i;
const ANY_TAG = /\[\[\s*\/?\s*СООБЩЕНИЕ\s*\]\]|<\/?message>/gi;

/**
 * Достаёт текст из конверта. Нет конверта — весь текст (старое поведение, дальше его
 * проверят шаблоны и проверка адресата).
 * @returns {{ text: string, outside: string, enveloped: boolean }}
 */
function extractEnvelope(raw) {
  const s = String(raw || '');
  const open = s.search(TAG_OPEN);
  let inner;
  let outside;
  if (open !== -1) {
    const rest = s.slice(open).replace(TAG_OPEN, '');
    const close = rest.search(TAG_CLOSE);
    inner = close === -1 ? rest : rest.slice(0, close);
    outside = `${s.slice(0, open)}\n${close === -1 ? '' : rest.slice(close).replace(TAG_CLOSE, '')}`;
  } else {
    // Закрывающая метка без открывающей: сообщение — всё, что до неё.
    const close = s.search(TAG_CLOSE);
    inner = close === -1 ? s : s.slice(0, close);
    outside = close === -1 ? '' : s.slice(close).replace(TAG_CLOSE, '');
  }
  return {
    // Метки не должны уйти работодателю ни при каком раскладе.
    text: inner.replace(ANY_TAG, '').trim(),
    outside: outside.trim(),
    enveloped: open !== -1,
  };
}

const CHECK_SYSTEM = `Ты — контролёр исходящих сообщений. Ниже пронумерованные предложения текста, который
автоматически, без проверки человеком, уйдёт работодателю в чат hh.ru от имени кандидата.
Найди предложения, адресованные НЕ работодателю.

Отметь предложение, если оно:
- предлагает изменить, скорректировать, переписать, сократить, дополнить САМ ЭТОТ ТЕКСТ или сделать другой вариант;
- спрашивает, какой нужен тон, стиль, длина или содержание текста, что в него добавить или убрать;
- обращается к кандидату или к тому, кто заказал текст (в том числе на «ты»);
- объясняет, как или по каким правилам составлен текст, или является заметкой, комментарием, заголовком
  вроде «Вот ответ:», «Вариант сообщения:».

НЕ отмечай: приветствие, благодарность, подпись, ответы работодателю и вопросы ему по существу — о вакансии,
задании, сроках, собеседовании, условиях работы. Вопрос «Нужно ли…?» про работу или задание — это вопрос
работодателю, его не отмечай; про сам текст сообщения — отмечай.

Ответь только JSON без пояснений: {"meta": [номера отмеченных предложений]}. Всё адресовано работодателю —
{"meta": []}.`;

/** Номера отмеченных предложений из ответа проверки; null — ответ не разобрать. */
function parseFlags(raw, count) {
  const s = String(raw || '');
  let list = null;
  const obj = s.match(/\{[\s\S]*?\}/);
  if (obj) {
    try {
      const parsed = JSON.parse(obj[0]);
      if (Array.isArray(parsed.meta)) list = parsed.meta;
    } catch { /* ниже попробуем голый массив */ }
  }
  if (!list) {
    const arr = s.match(/\[[\d,\s]*\]/);
    if (arr) {
      try { list = JSON.parse(arr[0]); } catch { /* не разобрать */ }
    }
  }
  if (!Array.isArray(list)) return null;
  return [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= count))].sort((a, b) => a - b);
}

/**
 * По отмеченным предложениям решает, что оставить. Отмеченные подряд с самого начала —
 * это заголовок-преамбула («Вот ответ:»): убираем только их. Первое отмеченное после
 * начала содержания — смена адресата: режем с него до конца.
 */
function applyFlags(text, spans, flagged) {
  if (!flagged.length) return { text, dropped: '' };
  const set = new Set(flagged);
  let first = 0;
  while (first < spans.length && set.has(first + 1)) first += 1;
  let end = spans.length;
  for (let i = first; i < spans.length; i += 1) {
    if (set.has(i + 1)) { end = i; break; }
  }
  const keepStart = first < spans.length ? spans[first].start : text.length;
  const keepEnd = end < spans.length ? spans[end].start : text.length;
  const kept = text.slice(keepStart, keepEnd).trim();
  const head = text.slice(0, keepStart).trim();
  const tail = text.slice(keepEnd).trim();
  return { text: kept, dropped: [head, tail].filter(Boolean).join(' … ') };
}

/**
 * Проверка адресата отдельным запросом к ИИ.
 * @returns {Promise<{ text: string, dropped: string, checked: boolean, error?: string }>}
 *   checked=false — проверить не удалось (сеть, непонятный ответ): текст возвращаем как
 *   есть, его уже проверили конверт и шаблоны.
 */
async function checkAddressee(text, llmClient, { timeoutMs = 60000 } = {}) {
  const spans = sentenceSpans(text);
  if (!spans.length || !llmClient) return { text, dropped: '', checked: false };
  const numbered = spans.map((sp, i) => `${i + 1}. ${text.slice(sp.start, sp.end).trim()}`).join('\n');
  // Вторая попытка — на битый ответ (живьём бывает «{"meta":}») или сбой сети.
  let error = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let raw;
    try {
      ({ text: raw } = await llmClient.ask(CHECK_SYSTEM, numbered, { timeoutMs, kind: 'leak_check' }));
    } catch (e) {
      error = e.message;
      continue;
    }
    const flagged = parseFlags(raw, spans.length);
    if (flagged) return { ...applyFlags(text, spans, flagged), checked: true };
    error = 'непонятный ответ проверки';
  }
  return { text, dropped: '', checked: false, error };
}

/**
 * Все три слоя подряд: конверт → разметка в простой текст → шаблоны → проверка адресата.
 * @returns {Promise<{ text: string, dropped: string, leaked: boolean, checked: boolean }>}
 *   leaked — что-то срезано шаблонами или проверкой (то, что модель сама вынесла за
 *   конверт, утечкой не считается — так и задумано).
 */
async function guardOutgoing(raw, { llmClient, allowTy = false, canonicalLinks = {} } = {}) {
  const env = extractEnvelope(raw);
  const plain = toPlainText(env.text, { canonicalLinks });
  const byPatterns = stripAssistantLeak(plain, { allowTy });
  const drops = [];
  if (byPatterns.leaked) drops.push(byPatterns.dropped);
  let text = byPatterns.text;
  let checked = false;
  if (text) {
    const res = await checkAddressee(text, llmClient);
    checked = res.checked;
    if (res.dropped) drops.push(res.dropped);
    text = res.text;
  }
  return { text, dropped: drops.join(' … '), leaked: drops.length > 0, checked, outside: env.outside };
}

module.exports = { ENVELOPE_RULE, extractEnvelope, checkAddressee, guardOutgoing, parseFlags, applyFlags };
