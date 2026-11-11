// hh.ru отдаёт id резюме двумя формами в зависимости от того, откуда клиент скопировал
// ссылку: прямая страница резюме (/applicant/resumes/<id>) или ссылка "похожие вакансии"
// (?resume=<id> в поиске). Нужен стабильный id именно резюме — не URL целиком — чтобы
// поймать повторное использование ОДНОГО И ТОГО ЖЕ резюме под разными email (см.
// checkAndClaimResume в routes/profile.js).
function extractResumeId(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    const fromQuery = u.searchParams.get('resume');
    if (fromQuery) return fromQuery;
    const fromPath = u.pathname.match(/\/resumes\/([^/]+)/i);
    if (fromPath) return fromPath[1];
  } catch {
    return null;
  }
  return null;
}

module.exports = { extractResumeId };
