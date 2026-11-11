import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { getViewCount, recordView } from '@/lib/views';
import { getPostBySlug } from '@/lib/blog';

const VISITOR_COOKIE = 'otkliks_vid';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return NextResponse.json({ count: getViewCount(slug) });
}

// Registers one view for the current visitor (deduped by a long-lived anonymous
// cookie, not a login) and returns the updated unique-visitor count.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (!getPostBySlug(slug)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const cookieStore = await cookies();
  const existingVisitorId = cookieStore.get(VISITOR_COOKIE)?.value;
  const visitorId = existingVisitorId ?? randomUUID();

  const count = recordView(slug, visitorId);

  const response = NextResponse.json({ count });
  if (!existingVisitorId) {
    response.cookies.set(VISITOR_COOKIE, visitorId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}
