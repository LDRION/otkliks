'use client';

import { useState, useTransition } from 'react';
import { openTaskAction, doneTaskAction } from './taskActions';

export type FreeTask = { id: string; day: number; title: string; text: string; url: string; action: string; minOpenSec: number };
export type FreeTasksState = {
  day: number; total: number; doneCount: number; allDone: boolean;
  pending: FreeTask | null; next: FreeTask | null; nextAt: string | null;
};

// Задание дня бесплатного тарифа. Пока оно не выполнено, бесплатный автопилот стоит на
// паузе — поэтому карточка стоит первой на дашборде и объясняет, что будет дальше.
export function TaskCard({ tasks }: { tasks: FreeTasksState }) {
  const task = tasks.pending;
  const [opened, setOpened] = useState(false);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();
  if (!task) return null;

  const open = () => {
    // Окно — сразу по клику (иначе браузер сочтёт его всплывающим и заблокирует),
    // отметку о переходе — следом.
    window.open(task.url, '_blank', 'noopener');
    setOpened(true);
    setMsg('');
    start(async () => {
      const r = await openTaskAction(task.id);
      if (r.error) setMsg(r.error);
    });
  };

  const done = () => start(async () => {
    const r = await doneTaskAction(task.id);
    setMsg(r.error || 'Засчитано — автопилот продолжит работу в течение минуты.');
    if (!r.error) setOpened(false);
  });

  return (
    <div className="card task-card" style={{ marginTop: 24 }}>
      <div className="task-card__head">
        <span className="tag tag--accent">Задание {task.day} из {tasks.total}</span>
        <span className="muted" style={{ fontSize: '0.85rem' }}>Бесплатный автопилот на паузе — продолжит сразу после задания</span>
      </div>
      <h2 style={{ fontSize: '1.2rem', marginTop: 12 }}>{task.title}</h2>
      <p className="muted" style={{ marginTop: 6 }}>{task.text}</p>
      <div className="task-card__row">
        <button type="button" className="btn btn--primary" onClick={open} disabled={pending}>{task.action}</button>
        <button type="button" className="btn btn--ghost" onClick={done} disabled={pending || !opened}>Готово</button>
      </div>
      {msg && <p className="muted" style={{ marginTop: 10, fontSize: '0.88rem' }}>{msg}</p>}
      <p className="muted" style={{ marginTop: 12, fontSize: '0.8rem' }}>
        Всего четыре задания — по одному в первые дни. Дальше бесплатный тариф работает без них.
      </p>
    </div>
  );
}
