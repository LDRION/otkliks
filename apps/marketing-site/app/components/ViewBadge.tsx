const fmt = (n: number) => n.toLocaleString('ru-RU');

export function ViewBadge({ count }: { count: number }) {
  return (
    <span className="view-badge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M5 20c1-4 4-6 7-6s6 2 7 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      {fmt(count)}
    </span>
  );
}
