// Состояние автопилота — одно на весь кабинет.
//
// Зачем отдельный модуль: дашборд, профиль и устройства раньше каждый по-своему
// намекали, запущено ли что-нибудь, и в сумме получалась неправда. Дашборд писал
// «Автопилот работает по резюме», хотя ни одного лаунчера привязано не было и ни
// одного отклика не отправлялось. Теперь вывод делается в одном месте, и все
// страницы показывают одно и то же.

// Единственная поставка лаунчера — архив. Установщик собирать перестали: без
// подписи кода антивирусы убивали его прямо на распаковке, и он через раз не
// доходил до конца (см. apps/local-agent/electron-builder.yml). Архив
// исполняемым файлом не является, под поведенческую проверку не попадает и
// ставится без борьбы: распаковать и запустить Otkliks.exe.
// Пусто = сборки ещё нет, и кабинет честно говорит об этом вместо ссылки в никуда.
export const LAUNCHER_ZIP_URL = process.env.NEXT_PUBLIC_LAUNCHER_ZIP_URL || '';
export const LAUNCHER_AVAILABLE = LAUNCHER_ZIP_URL.length > 0;

// Лаунчер отмечается на сервере при каждом обращении (requireDevice обновляет
// lastSeenAt). Полчаса без единого запроса — считаем, что он не работает: живой
// автопилот ходит за задачами куда чаще.
const STALE_AFTER_MS = 30 * 60 * 1000;

export type AutopilotDevice = { deviceId: string; label: string; lastSeenAt?: string };

export type AutopilotStep = {
  key: string;
  title: string;
  /** Что осталось сделать — для фразы «Осталось: …». Название шага туда не годится:
   *  оно сформулировано как результат («Резюме подключено»), а нужен глагол. */
  todo: string;
  detail: string;
  done: boolean;
  blocked?: boolean;      // шаг, на котором всё стоит прямо сейчас
  href?: string;
  hrefLabel?: string;
};

export type AutopilotStatus = {
  state: 'running' | 'stale' | 'blocked';
  headline: string;
  reason: string;
  steps: AutopilotStep[];
};

export function getAutopilotStatus(input: {
  resumeCount: number;
  subscriptionActive: boolean;
  devices: AutopilotDevice[];
  /** Невыполненное задание дня бесплатного тарифа — пока оно есть, автопилот на паузе. */
  pendingTaskTitle?: string | null;
}): AutopilotStatus {
  const { resumeCount, subscriptionActive, devices, pendingTaskTitle } = input;

  const lastSeen = devices
    .map((d) => (d.lastSeenAt ? new Date(d.lastSeenAt).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  const deviceLive = lastSeen > 0 && Date.now() - lastSeen < STALE_AFTER_MS;

  const steps: AutopilotStep[] = [
    {
      key: 'resume',
      todo: 'подключить резюме',
      title: 'Резюме подключено',
      detail: resumeCount
        ? `Автопилот будет искать вакансии по ${resumeCount === 1 ? 'нему' : `${resumeCount} резюме`}.`
        : 'Без ссылки на резюме hh.ru искать нечего.',
      done: resumeCount > 0,
      href: '/app/profile',
      hrefLabel: resumeCount ? 'Изменить' : 'Добавить резюме',
    },
    // Оплата больше не обязательна: бесплатный тариф полный (с 29.09.2026). Шаг
    // «оплатить подписку» здесь раньше блокировал статус у всех бесплатных.
    subscriptionActive
      ? { key: 'subscription', todo: '', title: 'Подписка активна', detail: 'Приоритетная обработка и до 200 откликов в день.', done: true }
      : pendingTaskTitle
        ? { key: 'task', todo: 'выполнить задание дня', title: 'Задание дня', detail: `«${pendingTaskTitle}» — пока оно не выполнено, бесплатный автопилот на паузе.`, done: false }
        : { key: 'subscription', todo: '', title: 'Бесплатный тариф', detail: 'Всё включено: до 100 откликов в день, переписка и анкеты.', done: true },
    {
      key: 'launcher',
      todo: 'установить лаунчер',
      title: 'Лаунчер подключён к аккаунту',
      detail: devices.length
        ? `Привязано устройств: ${devices.length}. Скачать заново можно в любой момент — ссылка в шапке.`
        : LAUNCHER_AVAILABLE
          // Про SmartScreen предупреждаем заранее: подписи кода у сборки нет, и
          // окно «Windows защитила ваш компьютер» иначе выглядит как вирус.
          ? 'Скачайте архив, распакуйте в любую папку и запустите Otkliks.exe — потом войдите под этим же email. Установка не нужна. Windows может показать предупреждение SmartScreen (у сборки нет платной подписи): «Подробнее» → «Выполнить в любом случае».'
          : 'Установщика пока нет — он в работе. Отклики начнутся, когда лаунчер можно будет поставить.',
      done: devices.length > 0,
      href: devices.length ? '/app/devices' : undefined,
      hrefLabel: devices.length ? 'Устройства' : undefined,
    },
    {
      key: 'running',
      todo: 'запустить лаунчер',
      title: 'Автопилот отправляет отклики',
      detail: deviceLive
        ? 'Лаунчер на связи, работа идёт.'
        : 'Начнётся сразу после запуска лаунчера — события появятся ниже.',
      done: deviceLive,
    },
  ];

  // Блокирует первый невыполненный шаг — на него и показываем пальцем.
  const firstUndone = steps.find((s) => !s.done);
  if (firstUndone) firstUndone.blocked = true;

  if (deviceLive) {
    return {
      state: 'running',
      headline: 'Автопилот работает',
      reason: 'Лаунчер на связи и отправляет отклики. Ход работы — в событиях ниже.',
      steps,
    };
  }

  if (devices.length > 0) {
    const hours = Math.floor((Date.now() - lastSeen) / 3600000);
    return {
      state: 'stale',
      headline: 'Автопилот не работает',
      reason: lastSeen
        ? `Лаунчер не выходил на связь ${hours < 1 ? 'больше получаса' : `${hours} ч`}. Запустите его на компьютере.`
        : 'Лаунчер привязан, но ни разу не выходил на связь. Запустите его на компьютере.',
      steps,
    };
  }

  return {
    state: 'blocked',
    headline: 'Автопилот не запущен',
    reason: firstUndone
      ? firstUndone.key === 'launcher' && !LAUNCHER_AVAILABLE
        ? 'Всё готово, кроме лаунчера: программы для вашего компьютера пока не существует, мы её собираем. Без неё отклики не отправляются.'
        : `Осталось: ${firstUndone.todo}.`
      : 'Осталось запустить лаунчер.',
    steps,
  };
}
