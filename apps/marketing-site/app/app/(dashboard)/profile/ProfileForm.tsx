'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateProfileAction } from '../profileActions';
import { type ProfileBase, sameResumes } from './profileBase';

type ResumeRow = { key: string; label: string; url: string };

type Props = {
  fullName: string;
  strongStack: string[];
  honestGaps: string[];
  portfolioCanonical: string;
  contactTelegram: string;
  minSalaryAmount: number;
  minSalaryCurrency: string;
  resumeProfiles: ResumeRow[];
};

type Fields = Omit<ProfileBase, 'resumes'>;
const FIELD_KEYS: (keyof Fields)[] = ['fullName', 'strongStack', 'honestGaps', 'portfolio', 'contactTelegram', 'salaryAmount', 'salaryCurrency'];

function makeKey() {
  return Math.random().toString(36).slice(2, 10);
}

function baseFromProps(props: Props): ProfileBase {
  return {
    fullName: props.fullName,
    strongStack: props.strongStack.join(', '),
    honestGaps: props.honestGaps.join(', '),
    portfolio: props.portfolioCanonical,
    contactTelegram: props.contactTelegram,
    salaryAmount: props.minSalaryAmount ? String(props.minSalaryAmount) : '',
    salaryCurrency: props.minSalaryCurrency || 'RUB',
    resumes: props.resumeProfiles.map((r) => ({ label: r.label, url: r.url })),
  };
}

function rowsFromProps(props: Props): ResumeRow[] {
  return props.resumeProfiles.length ? props.resumeProfiles.map((r) => ({ ...r })) : [{ key: makeKey(), label: '', url: '' }];
}

function pickFields(b: ProfileBase): Fields {
  return Object.fromEntries(FIELD_KEYS.map((k) => [k, b[k]])) as Fields;
}

export function ProfileForm(props: Props) {
  const [state, formAction, pending] = useActionState(updateProfileAction, undefined);
  const router = useRouter();

  // Профиль один на аккаунт и живёт на сервере; этот кабинет и вкладка «Профиль» в
  // лаунчере — два окна в одни и те же данные. base — последняя версия с сервера.
  // Она уходит вместе с формой, и серверное действие отправляет только поля, которые
  // человек поменял здесь, — остальное могли за это время поправить в лаунчере.
  const base = baseFromProps(props);
  const baseKey = JSON.stringify(base);
  const [fields, setFields] = useState<Fields>(() => pickFields(base));
  const [resumes, setResumes] = useState<ResumeRow[]>(() => rowsFromProps(props));
  const prevBase = useRef<ProfileBase>(base);
  const prevState = useRef(state);

  // Пришла новая версия с сервера (сохранили в лаунчере, вернулись на вкладку):
  // трёхсторонняя сверка — поле, которое человек здесь не трогал, берём новое; то,
  // что он уже поменял, не затираем. После успешного сохранения — всё по серверу
  // (он нормализует значения: ldrion → @ldrion).
  useEffect(() => {
    const old = prevBase.current;
    const force = state !== prevState.current && !!state?.success;
    prevState.current = state;
    if (!force && JSON.stringify(old) === baseKey) return;
    const next: ProfileBase = JSON.parse(baseKey);
    setFields((cur) => {
      const out = { ...cur };
      for (const k of FIELD_KEYS) if (force || cur[k] === old[k]) out[k] = next[k];
      return out;
    });
    setResumes((cur) => (force || sameResumes(cur, old.resumes) ? rowsFromProps(props) : cur));
    prevBase.current = next;
    // props читаются только вместе с baseKey — он и есть их отпечаток
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, state]);

  // Свежие данные с сервера — при возврате на вкладку и раз в минуту, пока она видна.
  useEffect(() => {
    let last = 0;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 3000) return;
      last = Date.now();
      router.refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, 60000);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      clearInterval(timer);
    };
  }, [router]);

  function setField(k: keyof Fields, v: string) {
    setFields((cur) => ({ ...cur, [k]: v }));
  }

  function updateResume(index: number, field: 'label' | 'url', value: string) {
    setResumes((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function addResume() {
    setResumes((prev) => [...prev, { key: makeKey(), label: '', url: '' }]);
  }

  function removeResume(index: number) {
    setResumes((prev) => prev.filter((_, i) => i !== index));
  }

  // Сохранена ли строка — сверяем с тем, что пришло с сервера. После успешного
  // сохранения серверное действие делает revalidatePath, страница переотдаёт props,
  // и строка сама переключается на «сохранено». Без этой пометки заполненная форма
  // выглядит ровно как незаполненный черновик — с этого и началась жалоба.
  function isSaved(row: ResumeRow) {
    const url = row.url.trim();
    if (!url) return false;
    return props.resumeProfiles.some((p) => p.url.trim() === url && p.label.trim() === row.label.trim());
  }

  const savedCount = resumes.filter(isSaved).length;

  return (
    <form action={formAction} style={{ display: 'grid', gap: 24 }}>
      <div className="card">
        <div className="section-title" style={{ fontWeight: 700, marginBottom: 4 }}>Резюме hh.ru</div>
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 16 }}>
          Откройте резюме на hh.ru и скопируйте адрес из строки браузера — вакансии
          автопилот подберёт по нему сам. Можно добавить несколько: он будет вести
          отклики по каждому параллельно (например, отдельно fullstack и отдельно AI/LLM).
        </p>
        <div style={{ display: 'grid', gap: 16 }}>
          {resumes.map((resume, i) => (
            <div
              key={resume.key}
              style={{ display: 'grid', gap: 10, paddingTop: i > 0 ? 16 : 0, borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <b style={{ fontSize: '0.9rem' }}>{resume.label.trim() || `Резюме ${i + 1}`}</b>
                <span className={`row-state row-state--${isSaved(resume) ? 'saved' : 'draft'}`}>
                  <span className="row-state__dot" />
                  {isSaved(resume) ? 'подключено' : 'не сохранено'}
                </span>
              </div>
              <div className="admin-login-form" style={{ display: 'grid', gap: 10 }}>
                <div className="field">
                  <label>Ссылка на резюме {i + 1} на hh.ru</label>
                  <input
                    placeholder="https://hh.ru/resume/8afd1acc…"
                    value={resume.url}
                    onChange={(e) => updateResume(i, 'url', e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Название (для себя)</label>
                  <input
                    placeholder="Fullstack"
                    value={resume.label}
                    onChange={(e) => updateResume(i, 'label', e.target.value)}
                  />
                </div>
              </div>
              {resumes.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeResume(i)}
                  className="btn btn--ghost btn--sm"
                  style={{ width: 'fit-content', color: 'var(--danger)' }}
                >
                  Удалить резюме
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addResume} className="btn btn--ghost btn--sm" style={{ marginTop: 16 }}>
          + Добавить ещё резюме
        </button>
        <input type="hidden" name="resumeProfilesJson" value={JSON.stringify(resumes)} />
        <input type="hidden" name="baseJson" value={baseKey} />
      </div>

      <div className="card">
        <div className="section-title" style={{ fontWeight: 700, marginBottom: 4 }}>Минимальная плата</div>
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 14 }}>
          От какой суммы рассматривать предложения. Вакансии ниже — пропускаем; где вилка{' '}
          <b>не указана</b> — всё равно откликаемся и упоминаем ваш ориентир в письме.
          Понимаем ₽, $ и € (сравниваем по курсу ЦБ). Оставьте 0 — подхватим «от какой ЗП»
          прямо из вашего резюме на hh.ru.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            name="minSalaryAmount"
            type="number"
            min={0}
            step={1000}
            inputMode="numeric"
            placeholder="напр. 250000"
            value={fields.salaryAmount}
            onChange={(e) => setField('salaryAmount', e.target.value)}
            style={{ maxWidth: 200 }}
          />
          <select name="minSalaryCurrency" value={fields.salaryCurrency} onChange={(e) => setField('salaryCurrency', e.target.value)} style={{ maxWidth: 110 }}>
            <option value="RUB">₽ рубли</option>
            <option value="USD">$ доллары</option>
            <option value="EUR">€ евро</option>
          </select>
          <span className="muted" style={{ fontSize: '0.85rem' }}>в месяц</span>
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ fontWeight: 700, marginBottom: 12 }}>Как писать сопроводительные</div>
        <div className="admin-login-form" style={{ display: 'grid', gap: 12 }}>
          <div className="field">
            <label>Ваше имя</label>
            <input name="fullName" value={fields.fullName} onChange={(e) => setField('fullName', e.target.value)} />
          </div>
          <div className="field">
            <label>Сильные стороны (через запятую, без хеджирования)</label>
            <textarea name="strongStack" rows={2} value={fields.strongStack} onChange={(e) => setField('strongStack', e.target.value)} />
          </div>
          <div className="field">
            <label>Честные пробелы (через запятую)</label>
            <textarea name="honestGaps" rows={2} value={fields.honestGaps} onChange={(e) => setField('honestGaps', e.target.value)} />
          </div>
          <div className="field">
            {/* Раньше здесь было два поля — «домен» и «ссылка», — хотя второе
                полностью содержит первое. Домен нужен только внутри, как ключ для
                починки ссылки в готовом письме, и выводится из неё сам. */}
            <label>Ссылка на портфолио (необязательно)</label>
            <input name="portfolioCanonical" placeholder="github.com/handle" value={fields.portfolio} onChange={(e) => setField('portfolio', e.target.value)} />
          </div>
          <div className="field">
            <label>Telegram для связи с работодателями (необязательно)</label>
            <input name="contactTelegram" placeholder="@username" value={fields.contactTelegram} onChange={(e) => setField('contactTelegram', e.target.value)} autoComplete="off" />
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              Автопилот назовёт его, только если работодатель сам попросит контакт. Пусто — ответит,
              что удобно продолжить в чате hh.ru, и никаких контактов не придумает.
            </span>
          </div>
        </div>
      </div>

      {state?.error && <p className="admin-login-error">{state.error}</p>}
      {state?.success && state.trialRevoked && (
        <p className="admin-login-error">
          Сохранено — но это резюме уже подключено на другом аккаунте, поэтому бесплатный
          тариф на этом аккаунте недоступен. Резюме и профиль сохранены — чтобы автопилот
          заработал, оформите платный тариф или используйте исходный аккаунт.
        </p>
      )}
      {state?.success && !state.trialRevoked && (
        <div className="form-saved">
          <span className="form-saved__mark" aria-hidden="true" />
          <span>
            Профиль сохранён.{' '}
            <span className="form-saved__count">
              {savedCount === 0
                ? 'Резюме пока не подключено — добавьте ссылку, иначе автопилоту нечего искать.'
                : `Автопилот работает по ${savedCount} ${savedCount === 1 ? 'резюме' : 'резюме'}.`}
            </span>
          </span>
        </div>
      )}
      <button type="submit" className="btn btn--primary" disabled={pending} style={{ width: 'auto' }}>
        {pending ? 'Сохраняем…' : 'Сохранить'}
      </button>
    </form>
  );
}
