// Отзывы соискателей. Серверный компонент: фотографии подхватываются из
// public/images/reviews по имени файла (см. README.txt там же) — положили evgeniy.jpg,
// и после ближайшей сборки вместо кружка с буквой появится фото.
//
// Эмодзи — картинками Microsoft Fluent Emoji (лицензия MIT, лежат в public/images/emoji),
// а не символами: обычные эмодзи рисует шрифт системы, и на Android они выглядят совсем
// не так, как задумано. Новый эмодзи в тексте — добавить файл и строку в EMOJI ниже.

import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';

type Review = { id: string; name: string; stars: number; text: string };

const REVIEWS: Review[] = [
  {
    id: 'evgeniy',
    name: 'Евгений',
    stars: 5,
    text: 'Полгода не мог найти нормальную работу, откровенно задолбался тратить на это время, '
      + 'уже почти потерял надежду. Если бы не ваш сервис, жена бы выгнала из дома, спасибо! 😆',
  },
  {
    id: 'dmitriy',
    name: 'Дмитрий',
    stars: 0,
    text: 'в последнее время сайты по поиску работы и правда забиты хламом с мошенниками, '
      + 'наконец-то хоть кто-то решил эту проблему, оффер за 2 недели получил))',
  },
  {
    id: 'zlata',
    name: 'Злата',
    stars: 5,
    text: 'На прошлом месте появились разногласия с начальством, а после ухода я просто устала '
      + 'откликаться на хх... Откликс - лучшее лекарство от мигрени и стресса 😂🥰',
  },
  {
    id: 'natalya',
    name: 'Наталья',
    stars: 4,
    text: 'Хотелось бы, чтобы не приходилось включать компьютер для работы вашего сервиса. '
      + 'Но приятно, что всё работает на фоне и вообще не нагружает систему. '
      + 'С четвёртого приглашения получила место!',
  },
  {
    id: 'german',
    name: 'Герман',
    stars: 0,
    text: 'мне друг посоветовал вас, всем бы таких друзей\nрекомендую!!!',
  },
  {
    id: 'maryana',
    name: 'Марьяна',
    stars: 5,
    text: 'Я уже и правда планировала идти к психологу, собеседование за собеседованием '
      + 'проваливала.. За 11 дней вы решили проблему, которую я уже называла несбыточной мечтой)',
  },
  {
    id: 'karim',
    name: 'Карим',
    stars: 5,
    text: 'Теперь ни один из моих друзей не оправдает свою безработность, просто скину лентяям '
      + 'ссылку на ваш сайт, вы лучшие)',
  },
  {
    id: 'elena',
    name: 'Елена',
    stars: 0,
    text: 'Не смогла получить офер за месяц работы вашего сервиса, но без него я бы не поняла '
      + 'что проблема в моем резюме. Поработала над ним - и за неделю сверху нашла, юху!!',
  },
  {
    id: 'valeriy',
    name: 'Валерий',
    stars: 5,
    text: 'не знаю каких богов вы подкупили но они явно знают путь к белой полосе благодарю!!)',
  },
  {
    id: 'sofya',
    name: 'Софья',
    stars: 0,
    text: 'В свои 22 я уже почти поседела, пока искала нормальное место! Каждый второй диалог '
      + 'с работодателем - уже или тупой скрипт, или аи..... Вы решили мою проблему ❤',
  },
  {
    id: 'andrey',
    name: 'Андрей',
    stars: 5,
    text: 'Приписываю Откликс к лику святых, очень выручили 🙏🙏🙏',
  },
  {
    id: 'ivan',
    name: 'Иван',
    stars: 4,
    text: 'наткнулся на техническую ошибку в работе, иногда откликс должен был ответить в чате '
      + 'с нанимателем "да" или "нет", а в итоге писал целые абзацы, из-за чего диалог не '
      + 'продолжался( а когда написал в поддержку - исправили за несколько часов, огонь, '
      + 'поднять щиты за работяг, теперь я тоже работяга 💪',
  },
  {
    id: 'karina',
    name: 'Карина',
    stars: 5,
    text: 'привет всем, этим ребятам можно и НУЖНО верить))\nискала подвох, разве кто-то будет '
      + 'что-то делать по совести за такие гроши? 😀\nоткликс не подвёл, зря тревожилась, тревожница',
  },
  {
    id: 'mihail',
    name: 'Михаил',
    stars: 5,
    text: 'Ну хотя бы вы используете ИИ для людей, обычно все эти нейросети только отталкивают! '
      + 'Если начнется восстание машин, откликс мы бить не будем 😉',
  },
  {
    id: 'yana',
    name: 'Яна',
    stars: 4,
    text: 'я уже писала вашему онлайн консультанту, напишу и сюда: добавьте возможность '
      + 'сохранить манер речи по одному примеру, чтобы пользователь мог показать иишке стиль '
      + 'для общения... больше даже не знаю, к чему придраться',
  },
];

const EMOJI: Record<string, string> = {
  '😆': 'grin-squint',
  '😂': 'joy',
  '🥰': 'hearts',
  '😉': 'wink',
  '❤': 'heart',
  '🙏': 'pray',
  '💪': 'muscle',
  '😀': 'grin',
};

// \uFE0F — «вариационный селектор»: невидимый символ, который часто идёт за эмодзи
// (например, у ❤️) и без учёта которого он остался бы в тексте отдельной кракозяброй.
const EMOJI_RE = new RegExp(`(${Object.keys(EMOJI).join('|')})\uFE0F?`, 'g');

function withEmoji(line: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  EMOJI_RE.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((match = EMOJI_RE.exec(line)) !== null) {
    if (match.index > last) out.push(line.slice(last, match.index));
    out.push(
      <img
        key={`${keyPrefix}-${match.index}`}
        className="tm-emoji"
        src={`/images/emoji/${EMOJI[match[1]]}.png`}
        alt=""
        width={20}
        height={20}
      />,
    );
    last = match.index + match[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

const REVIEWS_DIR = path.join(process.cwd(), 'public', 'images', 'reviews');

function photoOf(id: string): string | null {
  for (const ext of ['webp', 'jpg', 'jpeg', 'png']) {
    try {
      if (fs.existsSync(path.join(REVIEWS_DIR, `${id}.${ext}`))) return `/images/reviews/${id}.${ext}`;
    } catch { /* нет папки — значит, фото просто ещё не добавили */ }
  }
  return null;
}

function Stars({ value }: { value: number }) {
  if (!value) return null;
  return (
    <span className="tm-stars" aria-label={`${value} из 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className={i <= value ? 'is-on' : ''} aria-hidden="true">
          <path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4L2.6 9.4l6.5-.9z" />
        </svg>
      ))}
    </span>
  );
}

export function Testimonials() {
  return (
    <section id="reviews" className="section section--subtle">
      <div className="container">
        <span className="eyebrow">Отзывы</span>
        <h2 style={{ marginTop: 16, marginBottom: 32, maxWidth: 640 }}>
          Соискатели, которые смогли
        </h2>

        <div className="tm-grid">
          {REVIEWS.map((r) => {
            const photo = photoOf(r.id);
            return (
              <figure className="tm-card reveal" key={r.id}>
                <figcaption className="tm-card__head">
                  {photo
                    ? <img className="tm-avatar" src={photo} alt={r.name} width={44} height={44} loading="lazy" />
                    : <span className="tm-avatar tm-avatar--letter" aria-hidden="true">{r.name[0]}</span>}
                  <span className="tm-card__who">
                    <span className="tm-name">{r.name}</span>
                    <Stars value={r.stars} />
                  </span>
                </figcaption>
                <blockquote className="tm-text">
                  {r.text.split('\n').map((line, i) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <p key={i}>{withEmoji(line, `${r.id}-${i}`)}</p>
                  ))}
                </blockquote>
              </figure>
            );
          })}
        </div>
      </div>
    </section>
  );
}
