'use server';

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { hasAtLeastRole } from '@/lib/session-token';
import { createPost, updatePost, deletePost, setCover } from '@/lib/blog';

// Писать блог может редактор и выше (editor/admin/owner). Проверяем в каждом действии:
// серверные экшены — публичная точка входа, полагаться только на middleware нельзя.
async function requireEditor() {
  const s = await getSession();
  if (!s || !hasAtLeastRole(s.role, 'editor')) redirect('/admin/login');
  return s;
}

// Обложка из формы → BLOB в БД. Ограничиваем 3 МБ и только картинки.
async function saveCoverFromForm(id: number, form: FormData) {
  const file = form.get('cover');
  if (file && typeof file !== 'string' && (file as File).size > 0) {
    const f = file as File;
    if (!/^image\//.test(f.type)) return;
    const buf = Buffer.from(await f.arrayBuffer());
    if (buf.length > 0 && buf.length <= 3_000_000) setCover(id, f.type, buf);
  }
}

// Валидируем точку кадрирования «x% y%» (0..100), иначе — центр.
function sanitizePos(raw: string): string {
  const m = /^(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%$/.exec(raw.trim());
  if (!m) return '50% 50%';
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return `${clamp(parseFloat(m[1]))}% ${clamp(parseFloat(m[2]))}%`;
}

function fields(form: FormData) {
  return {
    title: String(form.get('title') || '').trim(),
    description: String(form.get('description') || '').trim(),
    tag: String(form.get('tag') || '').trim(),
    body: String(form.get('body') || ''),
    published: form.get('published') === 'on' || form.get('published') === 'true',
    coverPos: sanitizePos(String(form.get('cover_pos') || '')),
  };
}

export async function createPostAction(form: FormData) {
  const s = await requireEditor();
  const data = fields(form);
  if (!data.title) redirect('/admin/blog/new?error=title');
  const id = createPost({ ...data, authorEmail: s.email });
  await saveCoverFromForm(id, form);
  redirect('/admin/blog');
}

export async function updatePostAction(form: FormData) {
  await requireEditor();
  const id = Number(form.get('id'));
  const data = fields(form);
  if (!Number.isFinite(id) || !data.title) redirect('/admin/blog');
  updatePost(id, data);
  await saveCoverFromForm(id, form);
  redirect('/admin/blog');
}

export async function deletePostAction(form: FormData) {
  await requireEditor();
  const id = Number(form.get('id'));
  if (Number.isFinite(id)) deletePost(id);
  redirect('/admin/blog');
}
