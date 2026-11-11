import { SOCIALS } from '@/lib/socials';

// Кружки-ссылки на соцсети. Вид задаёт класс контейнера (footer-socials,
// topbar-socials, nav-panel-socials) — разметка одна.
export function SocialLinks({ className }: { className: string }) {
  return (
    <div className={className} aria-label="Откликс в соцсетях">
      {SOCIALS.map((x) => (
        <a key={x.name} href={x.href} target="_blank" rel="noopener noreferrer me" aria-label={`Откликс в ${x.name}`} title={x.name}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={x.path} fill="currentColor" /></svg>
        </a>
      ))}
    </div>
  );
}
