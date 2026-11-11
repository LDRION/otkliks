/**
 * outcomeClassifier.js — классификация входящего сообщения работодателя для статистики
 * дашборда ("сколько отказов, сколько приглашений на собеседование"). В hhorosho этого не
 * было (только Telegram-лог сырых сообщений) — здесь нужно тенанту на сайте/в лаунчере.
 *
 * Разделено на дешёвую эвристику (мгновенно, без LLM — покрывает большинство типовых
 * формулировок hh.ru) и LLM-фолбэк на неочевидные случаи, чтобы не тратить вызов Siberi
 * на каждое сообщение в переписке.
 */

const REJECTION_RE =
  /отказ|не подходит|не рассматрива|выбрали другого|остановили выбор на друг|к сожалению.{0,40}(не смож|не подойд)/i;
const INTERVIEW_RE =
  /собеседовани|интервью|созвон|встреч[аеу].{0,20}(в офисе|онлайн|по\s*zoom|по\s*видео)|пригласить вас|хотели бы пообщаться|назначим (звонок|встречу)/i;

function heuristicClassify(text) {
  const t = String(text || '');
  if (REJECTION_RE.test(t)) return 'rejection';
  if (INTERVIEW_RE.test(t)) return 'interview';
  return null;
}

/**
 * @param {string} messageText — последнее сообщение работодателя
 * @param {{ ask: Function }} llmClient
 * @returns {Promise<'interview'|'rejection'|'question'|'other'|null>} null — ИИ не ответил
 */
async function classifyOutcome(messageText, llmClient) {
  const heuristic = heuristicClassify(messageText);
  if (heuristic) return heuristic;

  try {
    const { text } = await llmClient.ask(
      'Классифицируй сообщение работодателя кандидату в переписке на hh.ru. Ответь СТРОГО одним словом на английском: '
        + 'interview (приглашают на собеседование/созвон/встречу), rejection (отказ), question (уточняющий вопрос по вакансии), '
        + 'other (что-то ещё — приветствие, техническая ошибка, нерелевантное).',
      String(messageText || '').slice(0, 2000),
      { timeoutMs: 30000, kind: 'outcome_classify' },
    );
    const word = text.trim().toLowerCase();
    if (word.includes('interview')) return 'interview';
    if (word.includes('rejection')) return 'rejection';
    if (word.includes('question')) return 'question';
    return 'other';
  } catch {
    // Сбой ИИ (в том числе квота) — исход неизвестен, а не «другое»: иначе исход треда
    // скакал «вопрос» → «другое» → «вопрос», и каждое возвращение давало новое событие.
    return null;
  }
}

module.exports = { classifyOutcome, heuristicClassify };
