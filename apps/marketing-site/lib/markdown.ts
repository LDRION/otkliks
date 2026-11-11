// Небольшой безопасный Markdown → HTML для тела статей блога. Свой, а не зависимость:
// контент пишет админ (доверенный), деплой — standalone-бандл, и лишний пакет в
// pnpm-lockfile/Docker тут дороже, чем ~120 строк под наш набор возможностей.
// Поддержано: заголовки, абзацы, **жир**/*курсив*/`код`, [ссылки](url), ![картинки](url),
// блоки ```кода```, > цитаты, - и 1. списки, --- разделитель. Весь текст экранируется.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Инлайн-разметка внутри уже экранированного текста. Порядок важен: сначала код (в нём
// ничего не разбираем), потом картинки/ссылки, потом жир/курсив.
function inline(text: string): string {
  let t = text;
  // `код`
  t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // ![alt](src)
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) =>
    /^(https?:|\/)/.test(src) ? `<img src="${src}" alt="${alt}" loading="lazy" />` : _m);
  // [text](href)
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, txt, href) => {
    if (!/^(https?:|\/|#|mailto:)/.test(href)) return _m;
    const ext = /^https?:/.test(href);
    return `<a href="${href}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${txt}</a>`;
  });
  // **жир** и __жир__
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // *курсив* и _курсив_
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  return t;
}

export function renderMarkdown(src: string): string {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    if (buf.length) out.push(`<p>${inline(escapeHtml(buf.join(' ')))}</p>`);
    buf.length = 0;
  };

  const paraBuf: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // блок кода ```
    if (/^```/.test(line.trim())) {
      flushParagraph(paraBuf);
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { code.push(lines[i]); i += 1; }
      i += 1; // закрывающая ```
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    // разделитель ---
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph(paraBuf);
      out.push('<hr />');
      i += 1;
      continue;
    }

    // заголовки # .. ######
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph(paraBuf);
      const level = h[1].length;
      out.push(`<h${level}>${inline(escapeHtml(h[2].trim()))}</h${level}>`);
      i += 1;
      continue;
    }

    // цитата >
    if (/^\s*>\s?/.test(line)) {
      flushParagraph(paraBuf);
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${inline(escapeHtml(quote.join(' ')))}</blockquote>`);
      continue;
    }

    // списки (- * + или 1.)
    const ul = /^\s*[-*+]\s+/.test(line);
    const ol = /^\s*\d+\.\s+/.test(line);
    if (ul || ol) {
      flushParagraph(paraBuf);
      const tag = ul ? 'ul' : 'ol';
      const items: string[] = [];
      const re = ul ? /^\s*[-*+]\s+/ : /^\s*\d+\.\s+/;
      while (i < lines.length && re.test(lines[i])) {
        items.push(`<li>${inline(escapeHtml(lines[i].replace(re, '').trim()))}</li>`);
        i += 1;
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // пустая строка — конец абзаца
    if (line.trim() === '') {
      flushParagraph(paraBuf);
      i += 1;
      continue;
    }

    // обычная строка абзаца
    paraBuf.push(line.trim());
    i += 1;
  }
  flushParagraph(paraBuf);
  return out.join('\n');
}
