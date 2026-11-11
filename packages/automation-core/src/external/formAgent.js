/**
 * formAgent.js — универсальное прохождение веб-форм: смотрит на страницу, решает, что
 * заполнить и куда нажать, делает шаг, смотрит снова.
 *
 * Зачем ещё один модуль поверх googleForm/genericForm. Те разбирают разметку по заранее
 * известным признакам — это быстро и предсказуемо, но работает ровно до тех пор, пока
 * форма похожа на ожидаемую. Работодатели присылают что угодно: свои конструкторы,
 * многошаговые опросники, формы с валидацией и условными вопросами. Под каждый вариант
 * писать разбор бессмысленно, поэтому здесь другой подход: страница сериализуется в
 * список интерактивных элементов (роль, подпись, значение, обязательность), список
 * уходит модели вместе с резюме, а модель возвращает план действий. Дальше цикл:
 * действие → новый снимок → следующее решение. Так закрывается и то, чего мы никогда
 * не видели.
 *
 * Почему снимок текстовый, а не картинка. Скриншот пришлось бы гонять через
 * vision-модель, а наш LLM-канал (core-api /api/agent/generate) принимает текст. Список
 * элементов с подписями даёт модели ровно ту же информацию, что человек видит глазами,
 * стоит дешевле и не зависит от вёрстки.
 *
 * Границы жёсткие и не обсуждаются: капча, форма входа, загрузка файла и тесты знаний —
 * это остановка и передача человеку. Автопилот заполняет анкеты о кандидате, а не
 * притворяется им там, где проверяют его самого.
 */

const { normalizeTelegram } = require('../replyAgent');

const { detectVisibleBlockersInPage } = require('./pageBlockers');

const SNAPSHOT_SELECTOR = [
  'input:not([type="hidden"])', 'textarea', 'select',
  'button', '[role="button"]', '[role="radio"]', '[role="checkbox"]',
  '[role="listbox"]', '[role="option"]', '[role="switch"]', '[contenteditable="true"]',
].join(', ');

// По ВИДИМОМУ тексту: «Подтвердите, что вы ознакомились с…» — обычный вопрос анкеты,
// а не капча, поэтому ловим только проверку «человек ли вы».
const CAPTCHA_RE = /я не робот|i'?m not a robot|подтвердите, что вы (не робот|человек)|введите (текст|символы) с картинки/i;
const CONFIRM_RE = /спасибо|благодарим|отправлен|принят|получили ваш|ответ записан|заявка получена|thank you|submitted|received|recorded/i;
const MAX_STEPS = 8;
const MAX_ELEMENTS = 60;

/**
 * Снимок страницы для модели: что здесь есть и что с этим можно сделать.
 * Каждому элементу присваивается ref — по нему агент потом и действует.
 */
async function snapshot(page) {
  const base = await page.evaluate((sel) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    };

    // Подпись элемента — то, что рядом с ним видит человек.
    //
    // Живой случай 29.09.2026: в анкете hh.ru (vacancy_response) у полей нет <label>, и
    // подписью становилось машинное name — «task_380806266_text». Это видел и человек в
    // отчёте о заполненной форме, и сама модель, решавшая, что писать в поле. Теперь name
    // — последний запасной вариант и только читаемый, а раньше него — текст вопроса над
    // полем в его собственном блоке.
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const CONTROL = 'input:not([type="hidden"]), textarea, select, [role="radio"], [role="checkbox"], [role="listbox"], [contenteditable="true"]';
    const hasControl = (node) => node.matches?.(CONTROL) || !!node.querySelector?.(CONTROL);

    // Ближайший текст ВЫШЕ поля в пределах его блока: предыдущие соседи на каждом уровне
    // вверх. Встретили соседа с другим полем — это уже чужой вопрос, дальше не идём.
    const textAbove = (el, maxDepth = 5) => {
      let node = el;
      for (let depth = 0; node && node !== document.body && depth < maxDepth; depth += 1) {
        for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
          if (hasControl(sib)) return '';
          const t = clean(sib.innerText || sib.textContent);
          if (t) return t;
        }
        const parent = node.parentElement;
        if (!parent) break;
        const own = Array.from(parent.childNodes)
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim())
          .filter(Boolean)
          .join(' ');
        if (own) return clean(own);
        node = parent;
      }
      return '';
    };

    // Машинные имена полей (task_380806266_text, field-12345, uuid) подписью не считаем.
    const readableName = (v) => (v && !/\d{4,}|[0-9a-f]{8}-[0-9a-f]{4}/i.test(v) ? v : '');

    // Общие подсказки внутри поля — не вопрос. Живой случай 06–09.10.2026: в анкете hh
    // (vacancy_response) подписью 13 раз становилось «Писать тут», и модель заполняла поле,
    // не зная вопроса «На какую заработную плату вы ориентируетесь?».
    const GENERIC_HINT = /^(?:писать тут|пишите тут|ваш ответ|ответ|введите(?: текст| ответ| значение)?|напишите(?: ответ| здесь| тут)?|текст|комментарий|сообщение)[.…:]*$/i;
    const meaningful = (t) => (t && !GENERIC_HINT.test(t) ? t : '');

    // Вопрос анкеты hh: <div data-qa="task-question">…</div> перед полем ответа. Берём
    // последний такой перед полем, если между ними нет другого поля (иначе вопрос чужой).
    const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const hhTaskQuestion = (el) => {
      let q = null;
      for (const cand of document.querySelectorAll('[data-qa="task-question"]')) if (before(cand, el)) q = cand;
      if (!q) return '';
      const name = el.getAttribute('name');
      const foreign = Array.from(document.querySelectorAll(CONTROL)).some((c) => c !== el
        && !(name && c.getAttribute('name') === name) && before(q, c) && before(c, el));
      return foreign ? '' : clean(q.innerText || q.textContent);
    };

    // Последний запасной путь — по расположению: ближайший текст над полем (до 160 px),
    // перекрывающий его по горизонтали. Не зависит от того, как глубоко hh спрятал поле.
    const textNear = (el) => {
      const r = el.getBoundingClientRect();
      if (!r.height) return '';
      const scope = el.closest('form') || document.body;
      const name = el.getAttribute('name');
      const others = Array.from(scope.querySelectorAll(CONTROL)).filter((c) => c !== el && !(name && c.getAttribute('name') === name));
      let best = null; let bestGap = 160;
      for (const n of scope.querySelectorAll('*')) {
        if (n === el || n.contains(el) || hasControl(n)) continue;
        // Другое поле между текстом и нашим — это вопрос или заголовок чужого поля.
        if (others.some((c) => before(n, c) && before(c, el))) continue;
        if (!Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
        const b = n.getBoundingClientRect();
        if (!b.width || !b.height || b.right < r.left || b.left > r.right) continue;
        const gap = r.top - b.bottom;
        if (gap < -2 || gap >= bestGap) continue;
        best = n; bestGap = gap;
      }
      return best ? meaningful(clean(best.innerText || best.textContent)) : '';
    };

    const labelOf = (el) => {
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();
      // Поле для текста/выбора (не вариант-переключатель и не кнопка): у него вопрос рядом.
      const isText = tag === 'textarea' || tag === 'select' || el.getAttribute('contenteditable') === 'true'
        || (tag === 'input' && !['submit', 'button', 'reset', 'radio', 'checkbox'].includes(type));
      if (isText) {
        const task = hhTaskQuestion(el);
        if (task) return task;
      }
      if (el.id) {
        const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const t = meaningful(clean(byFor?.textContent));
        if (t) return t;
      }
      // Обёртка-<label> у полей hh (magritte) содержит только подсказку «Писать тут» —
      // такую подписью не считаем.
      const parentLabel = meaningful(clean(el.closest('label')?.textContent));
      if (parentLabel && parentLabel !== clean(el.getAttribute('placeholder'))) return parentLabel;
      if (el.getAttribute?.('aria-labelledby')) {
        const ref = document.getElementById(el.getAttribute('aria-labelledby'));
        const t = meaningful(clean(ref?.textContent));
        if (t) return t;
      }
      const aria = meaningful(clean(el.getAttribute?.('aria-label')));
      if (aria) return aria;

      const isField = isText || (tag === 'input' && ['radio', 'checkbox'].includes(type));
      if (isField) {
        const question = meaningful(textAbove(el, 8));
        const hint = clean(el.getAttribute('placeholder') || el.getAttribute('title'));
        const usefulHint = meaningful(hint);
        // Короткий текст над полем без вопроса — скорее заголовок раздела («Контакты»):
        // подсказку из поля тогда добавляем, она уточняет, что именно вводить.
        if (question) return usefulHint && question.length < 40 && !/\?$/.test(question) && !question.includes(usefulHint) ? `${question} (${usefulHint})` : question;
        if (usefulHint) return usefulHint;
        const near = isText ? textNear(el) : '';
        if (near) return near;
        return hint || clean(readableName(el.getAttribute('name')));
      }

      // Кнопки и пункты: их собственный текст.
      if (el.textContent?.trim()) return clean(el.textContent);
      for (const attr of ['value', 'title', 'placeholder']) {
        const v = el.getAttribute?.(attr);
        if (v && v.trim()) return clean(v);
      }
      return clean(readableName(el.getAttribute?.('name')));
    };

    // Вопрос для группы вариантов (радио/галочки): legend или текст над блоком, в котором
    // лежат все варианты группы. Без него модель видела только «Да» / «Нет».
    const groupQuestion = (el) => {
      const task = hhTaskQuestion(el);
      if (task) return task;
      const fs = el.closest('fieldset');
      const legend = fs?.querySelector('legend');
      if (legend?.textContent?.trim()) return clean(legend.textContent);
      const name = el.getAttribute('name');
      let box = el.parentElement;
      if (name) {
        const all = Array.from(document.getElementsByName(name));
        // Одиночная галочка («Согласен на обработку данных») — сама себе вопрос: текст
        // над ней обычно заголовок раздела, он бы только запутал.
        if (all.length < 2) return '';
        while (box && box !== document.body && !all.every((x) => box.contains(x))) box = box.parentElement;
      } else {
        box = el.closest('[role="radiogroup"], [role="group"]');
        if (!box) return '';
      }
      if (!box || box === document.body) return '';
      const labelled = box.getAttribute('aria-labelledby');
      if (labelled) {
        const ref = document.getElementById(labelled);
        if (ref?.textContent?.trim()) return clean(ref.textContent);
      }
      if (box.getAttribute('aria-label')) return clean(box.getAttribute('aria-label'));
      // Вопрос часто лежит внутри того же блока, перед вариантами (так в анкете hh).
      for (const child of Array.from(box.children)) {
        if (hasControl(child)) break;
        const t = clean(child.innerText || child.textContent);
        if (t) return t;
      }
      return textAbove(box);
    };

    // Прошлые пометки убираем: страница могла перерисоваться, и старые номера
    // теперь принадлежат другим элементам.
    document.querySelectorAll('[data-otkliks-ref]').forEach((el) => el.removeAttribute('data-otkliks-ref'));

    const els = Array.from(document.querySelectorAll(sel)).filter(visible);
    const items = els.map((el, index) => {
      // Номер живёт в самом элементе. Раньше он был позицией в отфильтрованном списке,
      // а действие искало элемент по той же позиции среди ВСЕХ подходящих узлов, включая
      // невидимые — номера расходились, и клики уходили в пустоту (таймаут по каждому).
      el.setAttribute('data-otkliks-ref', String(index));
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || '';
      const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : '';

      let kind = 'other';
      if (tag === 'textarea' || (tag === 'input' && ['text', 'email', 'tel', 'url', 'number', 'date', 'search'].includes(type))) kind = 'input';
      else if (el.getAttribute('contenteditable') === 'true') kind = 'input';
      else if (tag === 'select' || role === 'listbox') kind = 'select';
      else if (type === 'radio' || role === 'radio') kind = 'radio';
      else if (type === 'checkbox' || role === 'checkbox' || role === 'switch') kind = 'checkbox';
      else if (tag === 'button' || role === 'button' || type === 'submit') kind = 'button';
      else if (role === 'option') kind = 'option';

      const checked = el.getAttribute('aria-checked') === 'true' || el.checked === true;
      const label = labelOf(el);
      const group = (kind === 'radio' || kind === 'checkbox') ? groupQuestion(el) : '';
      // Не все конструкторы ставят нативный required — часть (Яндекс.Формы и другие)
      // рисуют обязательность текстом в подписи вместо атрибута. См. тот же фикс и
      // комментарий в genericForm.js readFields — там это поймано на живой форме.
      const requiredByText = /обязательн|required/i.test(label) || /^\s*\*/.test(label);

      return {
        ref: index,
        kind,
        label,
        group: group && group !== label ? group : undefined,
        value: kind === 'input' ? String(el.value || el.textContent || '').slice(0, 120) : undefined,
        checked: (kind === 'radio' || kind === 'checkbox') ? checked : undefined,
        required: el.required === true || el.getAttribute('aria-required') === 'true' || requiredByText,
        // Настоящий HTML-тип для input'ов (email/tel/number/date/url) — иначе модель
        // видит только kind:'input' и не отличает поле почты от произвольного текста
        // (см. buildSystemPrompt: нейтральную фразу-заглушку в такое поле писать нельзя).
        format: tag === 'input' ? type : undefined,
        options: tag === 'select'
          ? Array.from(el.options).map((o) => o.textContent.trim()).filter(Boolean).slice(0, 25)
          : undefined,
      };
    }).filter((i) => i.label || i.kind !== 'other');

    return {
      title: document.title || '',
      heading: (document.querySelector('h1, [role="heading"]')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      url: location.href,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
      items,
    };
  }, SNAPSHOT_SELECTOR);
  // Признаки, по которым мы обязаны остановиться, — только видимые (см. pageBlockers.js).
  const b = await page.evaluate(detectVisibleBlockersInPage).catch(() => ({}));
  return { ...base, hasPassword: !!b.password, hasFileInput: !!b.file, captchaMarkup: !!b.captcha };
}

function buildSystemPrompt(profile) {
  const name = String(profile.fullName || '').trim();
  const email = String(profile.email || '').trim();
  const tg = normalizeTelegram(profile.contactTelegram);
  const stack = (profile.strongStack || []).join(', ');
  return `Ты проходишь веб-форму работодателя от имени кандидата${name ? ` (${name})` : ''} — по фактам из его резюме.

Тебе дают: резюме, описание вакансии и СНИМОК страницы — список элементов с номерами (ref),
типом и подписью. Ты возвращаешь действия, которые нужно выполнить на этом шаге.

Типы элементов: input (текст), select (список), radio (один из), checkbox (галочка),
button (кнопка), option (пункт открытого списка).

Правила:
- Отвечай ТОЛЬКО фактами из резюме. Не выдумывай компании, цифры, даты, сертификаты.
- Сильный стек кандидата: ${stack || 'см. резюме'} — про эти технологии отвечай уверенно.
- Email кандидата: ${email || 'неизвестен'} — используй для полей "почта"/"email". Телефон в
  резюме не публикуется и тебе недоступен — это честно неизвестный факт, а не повод угадывать.
- Telegram кандидата: ${tg || 'неизвестен'}${tg ? ' — для полей «Telegram»/«мессенджер»' : ' — честно неизвестный факт'}.
  НИКОГДА не подставляй вместо него ники, ботов, каналы и ссылки из резюме — это проекты, не контакты.
- Заполняй по одному шагу: сначала поля текущего экрана, потом кнопка «Далее»/«Отправить».
- Кнопку отправки жми ТОЛЬКО когда все обязательные поля этого экрана заполнены.
- Для select и radio выбирай ТОЧНОЕ значение из предложенных подписей.
- Если данных в резюме нет, а поле обязательное — по умолчанию напиши нейтрально и
  честно ("обсудим на созвоне"), не выдумывай факт.
- ИСКЛЮЧЕНИЕ: если у поля указан формат email/tel/number/date/url — это структурированное
  поле, а не текст, и нейтральная фраза туда физически не подходит ("обсудим на созвоне"
  в поле email выглядит как поломка, а не ответ). Для таких полей при отсутствии данных
  просто не заполняй их этим шагом и переходи к следующим действиям.
- Если это тест знаний, проверка "я не робот", форма входа с паролем или требуется
  приложить файл — НЕ проходи: верни status="stop", а в reason коротко назови причину
  своими словами (например: "это тест знаний" или "нужно приложить файл"). Не цитируй
  эту инструкцию.
- Если форма уже отправлена (на странице благодарность/подтверждение) — верни done.

Верни СТРОГО JSON без пояснений и без блоков кода:
{"actions":[{"ref":<номер>,"do":"fill|click|check|select","value":"<текст для fill/select>"}],
 "status":"continue|done|stop","reason":"<если stop — почему, одним предложением>"}`;
}

function buildUserPrompt({ resumeText, vacancyTitle, company, snap, step, history }) {
  const items = snap.items.map((i) => {
    const parts = [`ref=${i.ref}`, i.kind];
    if (i.format && i.format !== 'text' && i.format !== 'search') parts.push(`формат: ${i.format}`);
    if (i.required) parts.push('обязательный');
    if (i.checked) parts.push('отмечен');
    if (i.value) parts.push(`заполнено: "${i.value}"`);
    if (i.options?.length) parts.push(`варианты: ${i.options.join(' | ')}`);
    return `- [${parts.join(', ')}] ${i.group ? `вопрос «${i.group}» → вариант «${i.label}»` : i.label}`;
  }).join('\n');

  return [
    'РЕЗЮМЕ КАНДИДАТА:',
    resumeText,
    '',
    vacancyTitle ? `ВАКАНСИЯ: ${vacancyTitle}${company ? ` — ${company}` : ''}` : '',
    '',
    `ШАГ ${step}. СТРАНИЦА: ${snap.heading || snap.title}`,
    `Адрес: ${snap.url}`,
    `Текст страницы (начало): ${snap.text.slice(0, 600)}`,
    '',
    history.length ? `УЖЕ СДЕЛАНО: ${history.join('; ')}` : '',
    '',
    'ЭЛЕМЕНТЫ:',
    items || '(интерактивных элементов не найдено)',
  ].filter(Boolean).join('\n');
}

function parsePlan(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('модель вернула не JSON');
  const parsed = JSON.parse(raw.slice(start, end + 1));
  return {
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    status: ['continue', 'done', 'stop'].includes(parsed.status) ? parsed.status : 'continue',
    reason: String(parsed.reason || ''),
  };
}

/** Выполняет одно действие модели. Возвращает описание для истории или null. */
async function applyAction(page, action) {
  const el = page.locator(`[data-otkliks-ref="${Number(action.ref)}"]`).first();
  if (!(await el.count())) return null;

  const value = action.value === undefined ? '' : String(action.value);

  switch (action.do) {
    case 'fill':
      await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await el.fill(value, { timeout: 5000 });
      return `заполнил поле ${action.ref}`;
    case 'select':
      try {
        await el.selectOption({ label: value }, { timeout: 5000 });
      } catch {
        await el.click({ timeout: 5000 });   // кастомный список — открываем и ищем пункт
        const option = page.locator('[role="option"]').filter({ hasText: value.slice(0, 40) }).first();
        if (await option.count()) await option.click({ timeout: 5000 });
      }
      return `выбрал «${value.slice(0, 40)}» в ${action.ref}`;
    case 'check':
      await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      try {
        await el.check({ timeout: 5000 });
      } catch {
        await el.click({ timeout: 5000 });   // ARIA-чекбоксы обычным check() не берутся
      }
      return `отметил ${action.ref}`;
    case 'click':
      await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      try {
        await el.click({ timeout: 5000 });
      } catch {
        // Кнопку может перекрывать подсказка или анимация — жмём напрямую.
        await el.evaluate((node) => node.click());
      }
      return `нажал ${action.ref}`;
    default:
      return null;
  }
}

function detectBlocker(snap) {
  if (snap.captchaMarkup || CAPTCHA_RE.test(snap.text)) return 'REQUIRES_CAPTCHA';
  if (snap.hasPassword) return 'REQUIRES_LOGIN';
  if (snap.hasFileInput) return 'REQUIRES_FILE_UPLOAD';
  return null;
}

/**
 * Проходит форму по адресу url.
 *
 * @param {{ dryRun?: boolean }} opts dryRun — заполнять, но не отправлять: нужен, чтобы
 *   проверять агента на чужих страницах, ничего им не присылая.
 * @returns {{ submitted: boolean, steps: number, actions: string[], reason?: string }}
 */
async function runFormAgent(browserCtx, url, {
  resumeText, vacancyTitle, company, profile, llmClient, dryRun = false, maxSteps = MAX_STEPS,
}) {
  const { browser, page } = await browserCtx.getPage();
  const history = [];
  // Пары «вопрос → ответ» для показа человеку: он должен видеть, что именно ушло
  // работодателю от его имени, а не только факт «анкета отправлена».
  const filledFields = [];

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    for (let step = 1; step <= maxSteps; step += 1) {
      const snap = await snapshot(page);

      const blocker = detectBlocker(snap);
      if (blocker) return { submitted: false, steps: step, actions: history, reason: blocker };

      // Форма уже поблагодарила — дальше делать нечего.
      if (CONFIRM_RE.test(snap.text) && history.length) {
        return { submitted: true, steps: step, actions: history, fields: filledFields };
      }

      if (!snap.items.length) {
        return { submitted: false, steps: step, actions: history, reason: 'NO_QUESTIONS_FOUND' };
      }

      if (snap.items.length > MAX_ELEMENTS) snap.items = snap.items.slice(0, MAX_ELEMENTS);

      const { text } = await llmClient.ask(
        buildSystemPrompt(profile),
        buildUserPrompt({ resumeText, vacancyTitle, company, snap, step, history }),
        { timeoutMs: 300000, kind: 'form_fill' },
      );

      let plan;
      try {
        plan = parsePlan(text);
      } catch {
        const retry = await llmClient.ask(
          buildSystemPrompt(profile),
          `${buildUserPrompt({ resumeText, vacancyTitle, company, snap, step, history })}\n\n`
          + 'ВАЖНО: предыдущий ответ не разобрался. Верни ТОЛЬКО валидный JSON без пояснений.',
          { timeoutMs: 300000, kind: 'form_fill' },
        ).catch(() => ({ text: '' }));

        try {
          plan = parsePlan(retry.text);
        } catch (e) {
          return { submitted: false, steps: step, actions: history, reason: `PLAN_PARSE_FAILED: ${e.message}` };
        }
      }

      if (plan.status === 'stop') {
        return { submitted: false, steps: step, actions: history, reason: plan.reason || 'модель остановилась' };
      }
      if (plan.status === 'done') {
        return { submitted: true, steps: step, actions: history, fields: filledFields };
      }
      if (!plan.actions.length) {
        return { submitted: false, steps: step, actions: history, reason: 'модель не предложила действий' };
      }

      const itemByRef = new Map(snap.items.map((i) => [String(i.ref), i]));

      for (const action of plan.actions) {
        // В режиме проверки не нажимаем ничего, что может отправить форму.
        if (dryRun && action.do === 'click') {
          history.push(`(проверка) пропустил нажатие ${action.ref}`);
          continue;
        }
        try {
          const done = await applyAction(page, action);
          if (done) {
            history.push(done);
            const item = itemByRef.get(String(action.ref));
            // В отчёт — «вопрос → ответ». Выбор варианта (радио/галочка) — тоже ответ:
            // раньше клики по вариантам в отчёт не попадали вовсе.
            const isChoice = item && (item.kind === 'radio' || item.kind === 'checkbox');
            if (['fill', 'select', 'check'].includes(action.do) || (action.do === 'click' && isChoice)) {
              const question = (isChoice && item.group) || item?.label || `поле ${action.ref}`;
              const answer = isChoice
                ? (item.group ? item.label : 'да')
                : String(action.value ?? '');
              if (answer) filledFields.push({ question, answer });
            }
          }
        } catch (e) {
          history.push(`не удалось ${action.do} ${action.ref}: ${e.message.slice(0, 60)}`);
        }
      }

      await page.waitForTimeout(1200);

      if (dryRun) {
        return { submitted: false, steps: step, actions: history, reason: 'DRY_RUN' };
      }
    }

    const finalText = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (CONFIRM_RE.test(finalText)) {
      return { submitted: true, steps: maxSteps, actions: history, fields: filledFields };
    }

    return { submitted: false, steps: maxSteps, actions: history, fields: filledFields, reason: 'NO_CONFIRMATION' };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = { runFormAgent, snapshot, parsePlan, buildSystemPrompt, buildUserPrompt, SNAPSHOT_SELECTOR };
