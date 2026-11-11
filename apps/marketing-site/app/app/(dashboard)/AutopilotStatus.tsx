import type { AutopilotStatus } from '@/lib/autopilot';
import { LAUNCHER_ZIP_URL } from '@/lib/autopilot';
import { DownloadLink } from '@/app/components/DownloadLink';

const STATE_LABEL: Record<AutopilotStatus['state'], string> = {
  running: 'работает',
  stale: 'остановлен',
  blocked: 'не запущен',
};

// Главный ответ на вопрос «работает ли оно вообще» — крупно, первым экраном, с
// причиной и следующим шагом. До этого дашборд отвечал на него только косвенно, и
// заголовок «Автопилот работает по резюме» читался как «уже работает», хотя не
// было ни привязанного лаунчера, ни единого отклика.
export function AutopilotStatusCard({ status }: { status: AutopilotStatus }) {
  return (
    <div className={`ap-status ap-status--${status.state}`}>
      <div className="ap-status__head">
        <span className="ap-status__dot" aria-hidden="true" />
        <div>
          <div className="ap-status__headline">{status.headline}</div>
          <p className="ap-status__reason">{status.reason}</p>
        </div>
        <span className="ap-status__badge">{STATE_LABEL[status.state]}</span>
      </div>

      <ol className="ap-steps">
        {status.steps.map((step, i) => (
          <li
            key={step.key}
            className={`ap-step${step.done ? ' ap-step--done' : ''}${step.blocked ? ' ap-step--blocked' : ''}`}
          >
            <span className="ap-step__num" aria-hidden="true">{step.done ? '' : i + 1}</span>
            <div className="ap-step__body">
              <div className="ap-step__title">
                {step.title}
                {step.href && step.hrefLabel && (
                  <a href={step.href} className="ap-step__link">{step.hrefLabel}</a>
                )}
              </div>
              <p className="ap-step__detail">{step.detail}</p>

              {/* Кнопка появляется, только когда сборка реально существует
                  (NEXT_PUBLIC_LAUNCHER_ZIP_URL) — иначе честно говорим об этом
                  вместо ссылки в никуда. */}
              {/* Кнопка показывается на шаге лаунчера ВСЕГДА, а не только пока он
                  не выполнен: скачать заново нужно и тому, у кого устройство уже
                  привязано, — например, после переустановки системы. */}
              {step.key === 'launcher' && LAUNCHER_ZIP_URL && (
                <DownloadLink className="btn btn--primary ap-step__cta">
                  {step.done ? 'Скачать заново' : 'Скачать лаунчер'}
                </DownloadLink>
              )}
              {step.key === 'launcher' && !LAUNCHER_ZIP_URL && (
                <span className="ap-step__pending">Сборка в работе — напишем, когда будет готова</span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
