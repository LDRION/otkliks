import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch } from '@/lib/coreApi';
import { unpairDeviceAction } from './deviceActions';
import { LAUNCHER_AVAILABLE } from '@/lib/autopilot';
import { DownloadLink } from '@/app/components/DownloadLink';

export const metadata: Metadata = {
  title: 'Устройства',
  robots: { index: false, follow: false },
};

type Device = {
  deviceId: string;
  label: string;
  pairedAt: string;
  lastSeenAt?: string;
};

export default async function DevicesPage() {
  const session = await getCustomerSession();
  if (!session) redirect('/app/login');

  const { devices } = await coreApiFetch<{ devices: Device[] }>('/api/devices', {
    token: session.coreApiToken,
  });

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60, maxWidth: 640 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Устройства</h1>
      <p className="muted" style={{ marginTop: 8, marginBottom: 28 }}>
        Локальные лаунчеры, привязанные к вашему аккаунту. Отвязанное устройство перестаёт
        отправлять отклики и статистику — при следующем запуске лаунчера потребуется войти заново.
      </p>

      {devices.length === 0 && (
        <div className="card">
          <b>Устройств ещё нет</b>
          <p className="muted" style={{ marginTop: 8 }}>
            {LAUNCHER_AVAILABLE
              ? 'Скачайте архив, распакуйте и запустите Otkliks.exe из папки Otkliks — устройство появится здесь после первого входа под этим email.'
              : 'Сборки лаунчера пока нет — мы её готовим. Пока скачивать нечего, и привязать устройство не получится.'}
          </p>
          <DownloadLink className="btn btn--primary" style={{ display: 'inline-block', marginTop: 14 }} />
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {devices.map((d) => (
          <div
            key={d.deviceId}
            className="card"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{d.label}</div>
              <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                подключено {new Date(d.pairedAt).toLocaleDateString('ru-RU')}
                {d.lastSeenAt && ` · был на связи ${new Date(d.lastSeenAt).toLocaleString('ru-RU')}`}
              </div>
            </div>
            <form action={unpairDeviceAction}>
              <input type="hidden" name="deviceId" value={d.deviceId} />
              <button type="submit" className="btn btn--ghost btn--sm" style={{ color: 'var(--danger)' }}>
                Отвязать
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
