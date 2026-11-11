// Где автопилот заполняет анкеты: пиктограммы источников каруселью (IconCarousel),
// пояснение — под ней, прямо на странице. Раньше пояснение было затемнением низа экрана,
// но такой градиент на старых матрицах ложится полосами — см. комментарий в IconCarousel.

import { IconCarousel, type CarouselItem } from './IconCarousel';

const SOURCES: CarouselItem[] = [
  {
    id: 'google',
    brand: '#7248b9',
    name: 'Google Формы',
    text: 'Текстовые ответы, выбор вариантов, списки и шкалы. Если форма требует вход '
      + 'в Google-аккаунт — войдите один раз в лаунчере, дальше Откликс справится сам.',
    icon: (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M29 4H13a5 5 0 0 0-5 5v30a5 5 0 0 0 5 5h22a5 5 0 0 0 5-5V15z" fill="#7248b9" />
        <path d="M29 4v7.5a3.5 3.5 0 0 0 3.5 3.5H40z" fill="#b69cf0" />
        <g fill="#fff">
          <circle cx="16.5" cy="23" r="1.9" />
          <circle cx="16.5" cy="29" r="1.9" />
          <circle cx="16.5" cy="35" r="1.9" />
          <rect x="21" y="21.4" width="12" height="3.2" rx="1.6" />
          <rect x="21" y="27.4" width="12" height="3.2" rx="1.6" />
          <rect x="21" y="33.4" width="9" height="3.2" rx="1.6" />
        </g>
      </svg>
    ),
  },
  {
    id: 'yandex',
    brand: '#fc3f1d',
    name: 'Яндекс Формы',
    text: 'Все типы вопросов, в том числе формы, которые открываются только после входа '
      + 'в Яндекс ID, — достаточно один раз войти в лаунчере.',
    icon: (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <rect x="4" y="4" width="40" height="40" rx="12" fill="#fc3f1d" />
        <text x="24" y="33.5" textAnchor="middle" fontSize="27" fontWeight="800" fill="#fff" fontFamily="Arial, Helvetica, sans-serif">Я</text>
      </svg>
    ),
  },
  {
    id: 'site',
    brand: '#12c8b0',
    name: 'Сайт компании',
    text: 'Анкета на сайте работодателя: поля, выпадающие списки, чекбоксы, многошаговые '
      + 'формы. Если форма просит файл или капчу — Откликс не рискует и передаёт её вам.',
    icon: (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <linearGradient id="fs-site-grad" x1="4" y1="6" x2="44" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#4f5bd5" />
            <stop offset="1" stopColor="#12c8b0" />
          </linearGradient>
        </defs>
        <rect x="4" y="7" width="40" height="34" rx="7" fill="url(#fs-site-grad)" />
        <g fill="#fff" opacity="0.75">
          <circle cx="10" cy="13" r="1.6" />
          <circle cx="15" cy="13" r="1.6" />
          <circle cx="20" cy="13" r="1.6" />
        </g>
        <rect x="10" y="19" width="28" height="5" rx="2.5" fill="#fff" />
        <rect x="10" y="27" width="20" height="5" rx="2.5" fill="#fff" opacity="0.85" />
        <rect x="10" y="34.5" width="10" height="3.5" rx="1.75" fill="#0b0b12" opacity="0.35" />
        <path d="M33 28.5l8.5 3.3-3.6 1.4 2.4 3.9-1.9 1.1-2.4-3.9-2.6 2.7z" fill="#fff" stroke="#16203a" strokeWidth="1" strokeLinejoin="round" />
      </svg>
    ),
  },
];


export function FormSources() {
  return (
    <div className="form-sources">
      <span className="form-sources__label">Где заполняем</span>

      <IconCarousel items={SOURCES} label="Форматы анкет, которые заполняет Откликс" />

      <ul className="form-perks">
        <li className="form-perk">
          <span className="form-perk__ico" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M15.5 3a5.5 5.5 0 0 0-5.24 7.18L3 17.44V21h3.56l1-1v-2h2v-2h2l1.38-1.38A5.5 5.5 0 1 0 15.5 3zm1.5 6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" fill="currentColor" /></svg>
          </span>
          <span>Анкеты за логином Google или Яндекса — войдите в лаунчере один раз, дальше сам</span>
        </li>
        <li className="form-perk">
          <span className="form-perk__ico" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm3 5v2h10V9zm0 4v2h7v-2z" fill="currentColor" /></svg>
          </span>
          <span>Вопросы работодателя прямо в отклике на hh.ru — тоже отвечаем по резюме</span>
        </li>
      </ul>

      <p className="form-consent">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5zm-1.2 13.4l6-6-1.4-1.4-4.6 4.6-2.2-2.2-1.4 1.4z" fill="currentColor" /></svg>
        <span>
          Только с вашего согласия: при первом запуске лаунчер спрашивает, можно ли ему
          заполнять анкеты. Каждый ответ, ушедший работодателю, виден в ленте событий.
        </span>
      </p>

    </div>
  );
}
