'use client';

import { useRef, useState } from 'react';
import { renderMarkdown } from '@/lib/markdown';

type EditablePost = {
  id: number;
  slug: string;
  title: string;
  description: string;
  tag: string;
  body: string;
  published: boolean;
  hasCover: boolean;
  coverPos?: string;
};

function parsePos(s?: string): { x: number; y: number } {
  const m = /^(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/.exec((s || '').trim());
  return m ? { x: +m[1], y: +m[2] } : { x: 50, y: 50 };
}

export function PostEditor({
  action,
  post,
}: {
  // Серверный экшен (create/update) — Next разрешает передавать его пропсом.
  action: (form: FormData) => void;
  post?: EditablePost;
}) {
  const [body, setBody] = useState(post?.body ?? '');
  const [cover, setCover] = useState<string | null>(post?.hasCover ? `/blog/cover/${post.slug}` : null);
  const [coverError, setCoverError] = useState('');

  // Точка кадрирования обложки (object-position). Тянется мышью/пальцем прямо по
  // превью — видимая область смещается, как «водишь» картинку под рамкой.
  const [pos, setPos] = useState(parsePos(post?.coverPos));
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const clamp = (n: number) => Math.max(0, Math.min(100, n));

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current; const f = frameRef.current;
    if (!d || !f) return;
    const rect = f.getBoundingClientRect();
    const dx = ((e.clientX - d.sx) / rect.width) * 100;
    const dy = ((e.clientY - d.sy) / rect.height) * 100;
    // Тянем картинку → показываем противоположную часть: позиция идёт навстречу.
    setPos({ x: clamp(d.px - dx), y: clamp(d.py - dy) });
  }
  function onPointerUp() { dragRef.current = null; }

  // Превью — через data:-адрес, а не blob:. Политика безопасности сайта (CSP img-src:
  // 'self' data: https:) blob-картинки запрещает, и выбранная обложка показывалась
  // битой — ракурс было не настроить, хотя после «Сохранить» файл прикреплялся.
  // Тяжёлое фото (больше 3 МБ или шире 2000 px) ужимаем здесь же в JPEG: сервер
  // принимает до 3 МБ, а снимок с телефона легко весит 5–8.
  async function onCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    setCoverError('');
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.type)) {
      setCoverError('Нужна картинка: PNG, JPG или WebP.');
      input.value = '';
      return;
    }
    const readAsDataUrl = (f: Blob) => new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    let dataUrl = await readAsDataUrl(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(); img.src = dataUrl; });
      const MAX_W = 2000;
      if (file.size > 3_000_000 || img.naturalWidth > MAX_W) {
        const k = Math.min(1, MAX_W / img.naturalWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * k);
        canvas.height = Math.round(img.naturalHeight * k);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
        if (blob && blob.size < file.size) {
          // Подменяем файл в самом поле формы — «Сохранить» отправит уже ужатый.
          const dt = new DataTransfer();
          dt.items.add(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
          input.files = dt.files;
          dataUrl = await readAsDataUrl(blob);
        }
      }
    } catch {
      // Не смогли прочитать как картинку — покажем как есть, сервер проверит тип сам.
    }
    const finalSize = input.files?.[0]?.size ?? file.size;
    if (finalSize > 3_000_000) {
      setCoverError('Картинка тяжелее 3 МБ даже после сжатия — выберите поменьше.');
      input.value = '';
      return;
    }
    setCover(dataUrl);
    setPos({ x: 50, y: 50 });
  }

  return (
    <form action={action} className="editor">
      {post && <input type="hidden" name="id" value={post.id} />}

      <div className="editor-grid">
        <div className="editor-main">
          <label className="editor-label">
            Заголовок
            <input name="title" defaultValue={post?.title} required maxLength={200}
              placeholder="Например: Как AI меняет отклики на hh.ru" />
          </label>

          <div className="editor-row">
            <label className="editor-label">
              Тег
              <input name="tag" defaultValue={post?.tag} maxLength={60} placeholder="HR-скрининг" />
            </label>
            <label className="editor-label editor-check">
              <input type="checkbox" name="published" defaultChecked={post?.published ?? false} />
              <span>Опубликовать (видно всем)</span>
            </label>
          </div>

          <label className="editor-label">
            Короткое описание <span className="muted">— для карточки и поиска</span>
            <textarea name="description" defaultValue={post?.description} rows={2} maxLength={400}
              placeholder="Одно-два предложения, о чём статья." />
          </label>

          <label className="editor-label">
            Заголовочная картинка (обложка)
            <input type="file" name="cover" accept="image/*" onChange={onCoverChange} />
            <span className="muted" style={{ fontSize: '0.8rem' }}>PNG/JPG/WebP. Тяжёлые фото ужмём сами. Показывается в карточке и вверху статьи.</span>
            {coverError && <span className="admin-login-error" style={{ fontSize: '0.85rem' }}>{coverError}</span>}
          </label>
          {/* Точка кадрирования уходит на сервер этим полем — обновляется перетаскиванием. */}
          <input type="hidden" name="cover_pos" value={`${Math.round(pos.x)}% ${Math.round(pos.y)}%`} />
          {cover && (
            <div>
              <div
                ref={frameRef}
                className="editor-cover-frame"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="editor-cover-img"
                  src={cover}
                  alt="Обложка"
                  draggable={false}
                  style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
                />
                <span className="editor-cover-hint">✋ Потяните, чтобы выбрать ракурс</span>
              </div>
              <span className="muted" style={{ fontSize: '0.78rem' }}>Так область и будет видна на сайте (обрезка 16:9).</span>
            </div>
          )}

          <label className="editor-label">
            Текст статьи <span className="muted">— Markdown</span>
            <textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={22}
              className="editor-body"
              placeholder={'# Заголовок\n\nАбзац с **жирным**, *курсивом* и [ссылкой](https://…).\n\n- список\n- пунктов\n\n> Цитата\n\n```\nблок кода\n```'} />
          </label>

          <div className="editor-actions">
            <button className="btn btn--primary" type="submit">Сохранить</button>
            <a className="btn btn--ghost" href="/admin/blog">Отмена</a>
          </div>
        </div>

        <aside className="editor-preview">
          <div className="editor-preview-label muted">Предпросмотр</div>
          <div className="post-prose editor-preview-body"
            // предпросмотр того же безопасного рендера, что и на публичной странице
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: renderMarkdown(body) || '<p class="muted">Здесь появится статья по мере набора…</p>' }} />
        </aside>
      </div>
    </form>
  );
}
