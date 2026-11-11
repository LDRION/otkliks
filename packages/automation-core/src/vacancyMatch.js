/**
 * vacancyMatch.js — ИИ-отбор вакансий перед откликом.
 *
 * Проблема, которую чиним: автопилот откликался на ВСЁ подряд, включая чужой стек
 * (PHP/1C там, где в резюме о них ни слова). Правило владельца: «дотягивать» смежные
 * навыки можно, но только если резюме закрывает хотя бы половину требований вакансии.
 * Поэтому перед откликом спрашиваем модель: какая доля требуемого стека реально закрыта
 * резюме и не является ли ОСНОВНОЙ язык/стек вакансии чужим. Медленнее (лишний вызов
 * LLM на вакансию), зато по уму — как и просили.
 */

const MIN_MATCH_PERCENT = 70;

function buildSystem() {
  return `Ты — строгий фильтр релевантности вакансий для кандидата. Лучше пропустить сомнительную
вакансию, чем откликнуться на чужую: неуместный отклик вредит репутации кандидата.
Твоя задача: сравнить ТРЕБОВАНИЯ вакансии с реальными навыками из резюме и решить, стоит ли откликаться.

Как считать:
1. Выпиши ключевые ТРЕБУЕМЫЕ hard-skills / технологии / стек вакансии (5–12 пунктов, самое важное).
2. Для каждого реши, закрыт ли он кандидатом. Засчитывай:
   - прямое совпадение (в резюме есть эта технология);
   - смежное внутри одного стека — как ПОЛОВИНУ пункта (React↔Vue, Node.js↔TypeScript,
     PostgreSQL↔MySQL, и т.п.): такое кандидат может «дотянуть».
   Не засчитывай навык, которого в резюме нет и он не смежен ничему из резюме.
3. matchPercent = доля закрытых требований в процентах (0..100), смежное = 0.5 пункта.
4. coreStackForeign — САМОЕ ВАЖНОЕ правило. Определи ОСНОВНОЙ язык/технологию вакансии — то,
   на чём реально написана работа и что стоит в названии (PHP, 1С, Java, C#, Go, Python, Ruby,
   Scala, Lua, C++, Kotlin, Swift, PHP/Laravel, Roblox/Lua, gamedev-движки и т.п.). Если этого
   основного языка/технологии НЕТ в резюме и он не смежен ничему в нём — coreStackForeign = true,
   и это ЖЁСТКИЙ стоп: apply = false ВСЕГДА, даже если совпали общие понятия (REST, API, SQL,
   микросервисы, Docker, очереди). «PHP-разработчик», «Backend (PHP/Laravel)», «Roblox-разработчик
   (Lua)», «1С-программист» при резюме без этих технологий — ЧУЖОЙ стек: НЕ откликаемся, точка.
   Общие слова «Backend»/«Fullstack» в названии не делают язык своим — смотри именно на язык/движок.
5. overqualified — вакансия НИЖЕ уровня кандидата: стажёр/trainee/intern/практикант, а также
   явно младшая (junior) позиция, когда в резюме несколько лет коммерческого опыта. На такие
   НЕ откликаемся (apply=false): это трата отклика на нижестоящую роль.
6. apply = (matchPercent >= ${MIN_MATCH_PERCENT}) И (coreStackForeign == false) И (overqualified == false).
   Чужой основной язык или переквалификация перевешивают любой процент совпадения по мелочи.

Верни СТРОГО один JSON-объект, без текста вокруг и без markdown:
{"matchPercent": <целое 0..100>, "coreStackForeign": <true|false>, "overqualified": <true|false>, "apply": <true|false>, "reason": "<коротко по-русски, 1 фраза>"}`;
}

function buildUser({ resumeText, vacancyTitle, company, vacancyDescription, strongStack }) {
  return [
    'РЕЗЮМЕ КАНДИДАТА:',
    String(resumeText || '').slice(0, 6000),
    '',
    `ВАКАНСИЯ: ${vacancyTitle}${company ? ` — ${company}` : ''}`,
    'ОПИСАНИЕ ВАКАНСИИ:',
    String(vacancyDescription || '').slice(0, 6000),
    '',
    strongStack && strongStack.length
      ? `Сильный стек кандидата (по нему можно уверенно заявлять смежное): ${strongStack.join(', ')}`
      : '',
  ].join('\n');
}

// Достаём JSON даже если модель обернула его в текст/```json.
function parseVerdict(raw) {
  const s = String(raw || '');
  const match = s.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ apply: boolean, assessed: boolean, matchPercent: number, coreStackForeign: boolean, overqualified: boolean, reason: string }>}
 * assessed=false — модель НЕ смогла оценить (ошибка/не JSON). В этом случае apply=false, но
 * это НЕ «мисматч»: вызывающий не должен помечать вакансию пропущенной навсегда — надо
 * попробовать снова, когда AI освободится. Раньше тут был fail-OPEN (apply:true при сбое),
 * из-за чего под нагрузкой AI автопилот откликался на ВСЁ подряд (PHP, Roblox, стажёр).
 */
async function assessVacancyFit({ resumeText, vacancyTitle, company, vacancyDescription, strongStack, llmClient }) {
  try {
    const { text } = await llmClient.ask(buildSystem(), buildUser({ resumeText, vacancyTitle, company, vacancyDescription, strongStack }), {
      timeoutMs: 120000,
      kind: 'vacancy_match',
    });
    const v = parseVerdict(text);
    if (!v || typeof v.matchPercent !== 'number') {
      // Не смогли разобрать вердикт — НЕ откликаемся вслепую, но и не хороним вакансию.
      return { apply: false, assessed: false, matchPercent: -1, coreStackForeign: false, overqualified: false, reason: 'модель вернула не JSON — оценю позже' };
    }
    const matchPercent = Math.max(0, Math.min(100, Math.round(v.matchPercent)));
    const coreStackForeign = v.coreStackForeign === true;
    const overqualified = v.overqualified === true;
    const apply = typeof v.apply === 'boolean'
      ? v.apply && !coreStackForeign && !overqualified
      : matchPercent >= MIN_MATCH_PERCENT && !coreStackForeign && !overqualified;
    return { apply, assessed: true, matchPercent, coreStackForeign, overqualified, reason: String(v.reason || '').slice(0, 200) };
  } catch (e) {
    // Сбой AI (перегрузка/таймаут) — НЕ откликаемся наугад. Fail-CLOSED: лучше пропустить
    // круг и попробовать снова, чем откликнуться на чужую вакансию. assessed=false → ретрай.
    return { apply: false, assessed: false, matchPercent: -1, coreStackForeign: false, overqualified: false, reason: `оценка не удалась (${e.message})` };
  }
}

module.exports = { assessVacancyFit, MIN_MATCH_PERCENT };
