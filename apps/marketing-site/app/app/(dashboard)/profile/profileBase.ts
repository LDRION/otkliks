// Последняя версия профиля с сервера в том виде, в каком она стоит в полях формы.
// Общая для формы (сверка с новыми данными) и серверного действия (какие поля
// человек поменял — только их и отправляем, см. ProfileForm.tsx).
export type ProfileBase = {
  fullName: string;
  strongStack: string;
  honestGaps: string;
  portfolio: string;
  contactTelegram: string;
  salaryAmount: string;
  salaryCurrency: string;
  resumes: { label: string; url: string }[];
};

// Резюме сравниваем по заполненным строкам: пустая строка-заготовка — не изменение.
export function filledResumes(rows: { label?: string; url?: string }[]) {
  return rows
    .filter((r) => r?.url?.trim())
    .map((r) => ({ label: (r.label || '').trim(), url: r.url!.trim() }));
}

export function sameResumes(a: { label?: string; url?: string }[], b: { label?: string; url?: string }[]) {
  return JSON.stringify(filledResumes(a)) === JSON.stringify(filledResumes(b));
}
