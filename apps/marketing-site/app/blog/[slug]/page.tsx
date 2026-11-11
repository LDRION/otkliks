import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPostBySlug, listPosts } from '@/lib/blog';
import { renderMarkdown } from '@/lib/markdown';
import { SITE_URL, SITE_NAME, buildBreadcrumbJsonLd } from '@/lib/site';
import { ReadingProgress } from '../../components/ReadingProgress';
import { BrandedCover } from '../../components/BrandedCover';
import { RecordView } from '../../components/RecordView';
import { getSession } from '@/lib/session';
import { hasAtLeastRole } from '@/lib/session-token';

// Читаем из БД на каждый запрос: новый пост из админки виден сразу, без пересборки.
export const dynamic = 'force-dynamic';

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });

// ~180 слов/мин для русского текста без учёта разметки — грубо, но для честной
// пометки «N мин чтения» под статьёй большего и не нужно.
function estimateReadingMinutes(markdown: string): number {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 180));
}

// Достаём пары вопрос/ответ из подзаголовков ### — но только те, что реально
// оканчиваются на «?»: так не выйдет случайно выдать за FAQ обычный h3-подзаголовок
// в статье без раздела вопросов (такое AI-краулеры и Google Rich Results справедливо
// штрафуют как вводящую в заблуждение разметку).
function extractFaq(markdown: string): { question: string; answer: string }[] {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const faq: { question: string; answer: string }[] = [];
  let question: string | null = null;
  let answer: string[] = [];

  const flush = () => {
    if (question && answer.length) faq.push({ question, answer: answer.join(' ').trim() });
    question = null;
    answer = [];
  };

  for (const line of lines) {
    const h3 = line.match(/^###\s+(.*)$/);
    const otherHeading = /^#{1,2}\s+/.test(line);
    if (h3) {
      flush();
      question = h3[1].trim().endsWith('?') ? h3[1].trim() : null;
      continue;
    }
    if (otherHeading) {
      flush();
      continue;
    }
    if (question && line.trim()) answer.push(line.trim());
  }
  flush();
  return faq;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post || !post.published) return { title: 'Статья не найдена — Откликс' };
  const url = `${SITE_URL}/blog/${post.slug}`;
  const imageUrl = post.hasCover ? `${SITE_URL}/blog/cover/${post.slug}` : undefined;
  const images = imageUrl ? [{ url: imageUrl, alt: post.title }] : undefined;
  return {
    // Без « — Откликс»: его и так добавляет шаблон заголовка в корневом layout —
    // раньше в выдаче было «…пошаговый план — Откликс — Откликс».
    title: post.title,
    description: post.description,
    keywords: post.tag ? [post.tag] : undefined,
    alternates: { canonical: url },
    openGraph: {
      type: 'article', locale: 'ru_RU', siteName: SITE_NAME, url,
      title: post.title, description: post.description, images,
      publishedTime: new Date(post.publishedAt ?? post.updatedAt).toISOString(),
      modifiedTime: new Date(post.updatedAt).toISOString(),
    },
    // Без своего twitter-блока страница унаследовала бы общий сайтовый — при шаринге
    // конкретной статьи в Telegram/X показывался бы заголовок сайта, а не статьи.
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post || !post.published) notFound();

  const session = await getSession();
  const canEdit = !!session && hasAtLeastRole(session.role, 'editor');

  const html = renderMarkdown(post.body);
  const url = `${SITE_URL}/blog/${post.slug}`;
  const imageUrl = post.hasCover ? `${SITE_URL}/blog/cover/${post.slug}` : `${SITE_URL}/opengraph-image`;
  const publishedIso = new Date(post.publishedAt ?? post.updatedAt).toISOString();
  const modifiedIso = new Date(post.updatedAt).toISOString();
  const minutes = estimateReadingMinutes(post.body);

  // Публикуем от лица бренда: у блога пока нет персональных авторских страниц, а
  // приписывать статью конкретному человеку без его byline на сайте было бы нечестной
  // заявкой на экспертность (то самое E-E-A-T, которое Google и AI-краулеры проверяют).
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    image: imageUrl,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: publishedIso,
    dateModified: modifiedIso,
    inLanguage: 'ru-RU',
    keywords: post.tag || undefined,
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon` },
    },
  };

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: 'Главная', path: '/' },
    { name: 'Блог', path: '/blog' },
    { name: post.title, path: `/blog/${post.slug}` },
  ]);

  const related = listPosts({ publishedOnly: true })
    .filter((p) => p.slug !== post.slug)
    .slice(0, 3);

  const faq = extractFaq(post.body);
  const faqJsonLd = faq.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faq.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      }
    : null;

  return (
    <main>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      {faqJsonLd && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <ReadingProgress />
      <RecordView slug={post.slug} />
      <article className="section post">
        <div className="container post-container">
          <div className="post-topbar">
            <Link href="/blog" className="post-back">← Все статьи</Link>
            {canEdit && (
              <Link href={`/admin/blog/${post.id}`} className="btn btn--primary btn--sm post-edit-btn">✎ Изменить статью</Link>
            )}
          </div>

          {/* Брендовая обложка: фото + «ОТКЛИКС» + рисующийся лазурный контур +
              заголовок поверх — собирается сама из картинки и названия поста.
              h1 живёт внутри неё (для SEO и структуры). */}
          <BrandedCover
            variant="hero"
            src={post.hasCover ? `/blog/cover/${post.slug}` : null}
            title={post.title}
            tag={post.tag}
            pos={post.coverPos}
          />

          <p className="post-meta muted" style={{ marginTop: 14 }}>
            <span>{SITE_NAME}</span>
            <span className="post-meta-dot" aria-hidden="true">·</span>
            <time dateTime={publishedIso}>{formatDate(post.publishedAt ?? post.updatedAt)}</time>
            <span className="post-meta-dot" aria-hidden="true">·</span>
            <span>{minutes} мин чтения</span>
          </p>

          <div
            className="post-prose"
            // Тело статьи — Markdown из БД, отрендеренный нашим безопасным конвертером
            // (весь текст экранируется, сырой HTML не проходит). eslint-disable ниже —
            // это единственный намеренный dangerouslySetInnerHTML в проекте.
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: html }}
          />

          {related.length > 0 && (
            <div className="post-related">
              <h2 style={{ fontSize: '1.15rem' }}>Читайте также</h2>
              <div className="post-related__list">
                {related.map((r) => (
                  <Link key={r.slug} href={`/blog/${r.slug}`} className="card blog-teaser-card post-related__item reveal">
                    <span className="tag tag--accent">{r.tag}</span>
                    <span className="post-related__title">{r.title}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </article>

      <section className="section section--subtle">
        <div className="container">
          <div className="card post-cta">
            <div>
              <h2 style={{ fontSize: '1.5rem' }}>Хватит откликаться вручную по вечерам</h2>
              <p className="muted" style={{ marginTop: 10 }}>
                Откликс подберёт вакансии, напишет письма и ответит в чате — вместо вас.
              </p>
            </div>
            <Link href="/#pricing" className="btn btn--primary" style={{ flex: 'none' }}>Выбрать тариф</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
