// Вход через Яндекс и VK. Обычные ссылки, а не кнопки с onClick: провайдеру
// нужен полноценный переход с редиректами, и через fetch его не сделать.
//
// Кнопки показываются всегда. Если провайдер не настроен (нет client_id),
// core-api вернёт человека обратно с понятной ошибкой — это лучше, чем
// проверять наличие ключей на клиенте и раскрывать состав конфигурации.

function YandexIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#FC3F1D" />
      <path
        d="M13.28 19h2.2V5h-3.2c-3.22 0-5.5 1.98-5.5 4.9 0 2.33 1.11 3.7 3.09 5.11L6.43 19h2.39l3.77-5.63-1.11-.75c-1.6-1.09-2.39-1.93-2.39-3.76 0-1.6 1.13-2.68 2.9-2.68h1.29V19z"
        fill="#fff"
      />
    </svg>
  );
}

function VkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect width="24" height="24" rx="5.5" fill="#0077FF" />
      <path
        d="M12.42 16.4c-4.09 0-6.63-2.86-6.73-7.6h2.09c.07 3.49 1.68 4.99 2.9 5.29V8.8h2v3c1.18-.13 2.42-1.51 2.84-3h1.94a5.65 5.65 0 0 1-2.6 3.72 5.85 5.85 0 0 1 3.04 3.88h-2.14c-.39-1.24-1.51-2.2-3.08-2.36v2.36h-.26z"
        fill="#fff"
      />
    </svg>
  );
}

export function OAuthButtons({ next = '/app' }: { next?: string }) {
  const qs = `?next=${encodeURIComponent(next)}`;
  return (
    <div className="oauth-block">
      <div className="oauth-divider"><span>или</span></div>
      <div className="oauth-buttons">
        <a href={`/api/auth/yandex${qs}`} className="btn btn--ghost oauth-btn">
          <YandexIcon />
          Яндекс
        </a>
        <a href={`/api/auth/vk${qs}`} className="btn btn--ghost oauth-btn">
          <VkIcon />
          VK
        </a>
      </div>
      {/* При первом входе через Яндекс/VK аккаунт создаётся сразу — согласие даётся
          нажатием кнопки, поэтому оно написано прямо здесь (core-api записывает его
          с source: 'oauth'). */}
      <p className="consent-note">
        Входя через Яндекс или VK впервые, вы даёте{' '}
        <a href="/consent" target="_blank" rel="noopener">согласие на обработку персональных данных</a>{' '}
        и принимаете <a href="/oferta" target="_blank" rel="noopener">оферту</a>.
      </p>
    </div>
  );
}
