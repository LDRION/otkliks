'use server';

import { revalidatePath } from 'next/cache';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch } from '@/lib/coreApi';
import { parsePortfolioLink } from '@/lib/portfolioLink';
import { type ProfileBase, sameResumes } from './profile/profileBase';

export type ProfileState = { error?: string; success?: boolean; trialRevoked?: boolean } | undefined;

export async function updateProfileAction(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const session = await getCustomerSession();
  if (!session) return { error: 'Сессия истекла, войдите заново' };

  const fullName = String(formData.get('fullName') || '').trim();
  const strongStack = String(formData.get('strongStack') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const honestGaps = String(formData.get('honestGaps') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Домен больше не спрашиваем отдельным полем — выводим из самой ссылки
  // (packages/automation-core/src/portfolioLink.js объясняет, зачем он вообще нужен).
  const portfolioCanonical = String(formData.get('portfolioCanonical') || '').trim();
  const portfolioLink = parsePortfolioLink(portfolioCanonical);

  // Минимальная плата: сумма ≥ 0 и валюта из белого списка. 0 = не задано (автопилот
  // возьмёт «от какой ЗП» из резюме). Сравнение с вилками вакансий — в core/automation.
  // Telegram для связи — единственный контакт, который ИИ может назвать работодателю.
  // Проверку формата делает core-api (там же нормализация к @ник).
  const contactTelegram = String(formData.get('contactTelegram') || '').trim().slice(0, 64);
  const minSalaryAmount = Math.max(0, Math.round(Number(formData.get('minSalaryAmount')) || 0));
  const minSalaryCurrencyRaw = String(formData.get('minSalaryCurrency') || 'RUB');
  const minSalaryCurrency = ['RUB', 'USD', 'EUR'].includes(minSalaryCurrencyRaw) ? minSalaryCurrencyRaw : 'RUB';

  let resumeRows: { key?: string; label?: string; url?: string }[] = [];
  try {
    resumeRows = JSON.parse(String(formData.get('resumeProfilesJson') || '[]'));
  } catch {
    return { error: 'Не получилось прочитать резюме — обновите страницу и попробуйте снова' };
  }

  const resumeProfiles = resumeRows
    .filter((r) => r?.url?.trim())
    .map((r, i) => ({
      key: r.key?.trim() || `resume_${i}`,
      label: r.label?.trim() || `Резюме ${i + 1}`,
      similarVacanciesUrl: r.url!.trim(),
    }));

  // Что человек поменял — сверяем с версией профиля, которую форма получила с
  // сервера (baseJson). Отправляем только это: остальные поля могли за это время
  // поправить в лаунчере, и старые значения со страницы затёрли бы их. Нет base
  // (страница из старой сборки) — шлём всё, как раньше.
  let base: ProfileBase | null = null;
  try {
    base = JSON.parse(String(formData.get('baseJson') || 'null'));
  } catch {
    base = null;
  }
  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  const body: { fullName?: string; profile?: Record<string, unknown>; resumeProfiles?: typeof resumeProfiles } = {};
  const profile: Record<string, unknown> = {};
  if (!base || fullName !== base.fullName.trim()) body.fullName = fullName;
  if (!base || !same(strongStack, list(base.strongStack))) profile.strongStack = strongStack;
  if (!base || !same(honestGaps, list(base.honestGaps))) profile.honestGaps = honestGaps;
  if (!base || portfolioCanonical !== base.portfolio.trim()) {
    // Пустое поле = убрать ссылку (undefined сервер пропустил бы молча).
    profile.portfolioLink = portfolioLink || { domain: '', canonical: '' };
  }
  if (!base || contactTelegram !== base.contactTelegram.trim()) profile.contactTelegram = contactTelegram;
  if (!base || minSalaryAmount !== (Number(base.salaryAmount) || 0) || minSalaryCurrency !== base.salaryCurrency) {
    profile.minSalary = { amount: minSalaryAmount, currency: minSalaryCurrency };
  }
  if (Object.keys(profile).length) body.profile = profile;
  if (!base || !sameResumes(resumeRows, base.resumes)) body.resumeProfiles = resumeProfiles;

  let trialRevoked = false;
  try {
    const res = await coreApiFetch<{ trialRevoked?: boolean }>('/api/profile', {
      method: 'PUT',
      token: session.coreApiToken,
      body,
    });
    trialRevoked = !!res.trialRevoked;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Не получилось сохранить' };
  }

  revalidatePath('/app/profile');
  revalidatePath('/app');
  return { success: true, trialRevoked };
}
