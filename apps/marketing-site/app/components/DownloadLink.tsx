'use client';

import { LAUNCHER_ZIP_URL } from '@/lib/autopilot';
import { reachGoal } from './Analytics';

/**
 * Ссылка на скачивание лаунчера — одна на весь сайт.
 *
 * Появилась потому, что скачать было негде: кнопка жила только в карточке статуса
 * на дашборде и исчезала, как только шаг «лаунчер подключён» становился выполненным.
 * А запись об устройстве в базе остаётся навсегда — человек удалил папку, а сайт
 * по-прежнему считает, что всё установлено, и скачать заново неоткуда.
 *
 * Поставка одна — архив. Установщик не собираем: без подписи кода антивирусы
 * убивали его на распаковке (подробности в apps/local-agent/electron-builder.yml).
 */
export function DownloadLink({
  className = '',
  children = 'Скачать лаунчер',
  style,
}: {
  className?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  if (!LAUNCHER_ZIP_URL) return null;
  return (
    <a href={LAUNCHER_ZIP_URL} className={className} style={style} download
      onClick={() => reachGoal('launcher_download', 'launcher_download', { file_name: 'otkliks.zip' })}>
      {children}
    </a>
  );
}
