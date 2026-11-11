import type { MDXComponents } from 'mdx/types';

// Обязательный файл для app-router MDX (@next/mdx) — сюда подключаются кастомные стили
// для markdown-элементов постов блога.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h2: (props) => <h2 style={{ marginTop: 40, marginBottom: 12 }} {...props} />,
    h3: (props) => <h3 style={{ marginTop: 28, marginBottom: 10, fontSize: '1.15rem' }} {...props} />,
    p: (props) => <p style={{ marginBottom: 16, color: 'var(--text)' }} {...props} />,
    ul: (props) => <ul style={{ marginBottom: 16, paddingLeft: 22 }} {...props} />,
    ol: (props) => <ol className="post-prose-ol" {...props} />,
    li: (props) => <li style={{ marginBottom: 6 }} {...props} />,
    a: (props) => <a style={{ color: 'var(--accent)' }} {...props} />,
    hr: () => <hr className="post-prose-hr" />,
    img: (props) => <img className="post-prose-img" {...props} />,
    code: (props) => <code className="post-prose-code" {...props} />,
    pre: (props) => <pre className="post-prose-pre" {...props} />,
    blockquote: (props) => (
      <blockquote
        style={{
          borderLeft: '3px solid var(--accent)',
          paddingLeft: 16,
          margin: '20px 0',
          color: 'var(--text-muted)',
          fontStyle: 'italic',
        }}
        {...props}
      />
    ),
    ...components,
  };
}
