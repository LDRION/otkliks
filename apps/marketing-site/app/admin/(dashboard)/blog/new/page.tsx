import Link from 'next/link';
import { PostEditor } from '../PostEditor';
import { createPostAction } from '../actions';

export default function NewPostPage() {
  return (
    <div>
      <Link href="/admin/blog" className="post-back" style={{ display: 'inline-block', marginBottom: 12 }}>← К списку</Link>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 16 }}>Новая статья</h1>
      <PostEditor action={createPostAction} />
    </div>
  );
}
