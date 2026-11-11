/**
 * plainText.js — подчистка вывода LLM перед тем, как текст уходит в plain-textarea hh.ru.
 * Портировано без изменений из личного hhorosho.
 */

function toPlainText(text, { canonicalLinks = {} } = {}) {
  let out = String(text || '');

  // Модель иногда дублирует одну и ту же ссылку подряд двумя разными подписями —
  // схлопываем ДО удаления markdown-разметки, иначе подписи склеятся без разделителя.
  out = out.replace(/(\[[^\]]*\]\((https?:\/\/[^\s)]+)\))(?:\[[^\]]*\]\(\2\))+/g, '$1');

  out = out
    .replace(/\[([^\]]*)\]\((?:https?:\/\/)?[^\s)]+\)/g, '$1') // [label](url) -> label
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold** -> bold
    .replace(/^#{1,6}\s+/gm, ''); // ## заголовок -> заголовок

  // Изредка модель роняет одиночный чужеродный иероглиф посреди слова — CJK/Kana/Hangul
  // не имеют причин появляться в русско-/англоязычной переписке, это генерационный глюк.
  out = out.replace(/[一-鿿぀-ヿ가-힯]/g, '');

  // [label](url) выше всегда оставляет ЛЕЙБЛ и выбрасывает url — модель не всегда пишет
  // полный канонический адрес лейблом. canonicalLinks — { "github.com": "github.com/handle" } —
  // нормализуем любое упоминание домена к канону, а не полагаемся на то, что напишет модель.
  for (const [domain, canonical] of Object.entries(canonicalLinks)) {
    const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:https?:\\/\\/)?(?:www\\.)?${escaped}(?:\\/[A-Za-z0-9_-]*)?`, 'gi');
    out = out.replace(re, canonical);
  }

  return out.trim();
}

module.exports = { toPlainText };
