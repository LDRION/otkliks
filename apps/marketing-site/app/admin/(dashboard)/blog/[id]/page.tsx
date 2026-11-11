import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPostById } from '@/lib/blog';
import { PostEditor } from '../PostEditor';
import { updatePostAction, deletePostAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = getPostById(Number(id));
  if (!post) notFound();

  return (
    <div>
      <Link href="/admin/blog" className="post-back" style={{ display: 'inline-block', marginBottom: 12 }}>← К списку</Link>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.5rem' }}>Редактирование статьи</h1>
        <form action={deletePostAction}>
          <input type="hidden" name="id" value={post.id} />
          <button className="btn btn--ghost admin-danger" type="submit">Удалить статью</button>
        </form>
      </div>
      <PostEditor
        action={updatePostAction}
        post={{
          id: post.id, slug: post.slug, title: post.title, description: post.description,
          tag: post.tag, body: post.body, published: post.published, hasCover: post.hasCover,
        }}
      />
    </div>
  );
}
