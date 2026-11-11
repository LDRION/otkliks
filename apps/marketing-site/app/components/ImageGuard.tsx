'use client';

// Блокирует контекстное меню и перетаскивание на картинках.
//
// ЧЕСТНО О ТОМ, ЧТО ЭТО ДАЁТ. Это «лежачий полицейский», а не замок. Картинка —
// обычный публичный файл по своему URL, иначе браузер не смог бы её показать:
// любой желающий возьмёт её через DevTools → Network, Ctrl+S, скриншот или просто
// открыв src напрямую, а с выключенным JS этот код вообще не выполнится. Смысл
// здесь один — отсечь случайное «ПКМ → Сохранить как», не более того. Ничего
// по-настоящему чувствительного класть в public/ нельзя, охрана этого не заменит.
//
// Область намеренно узкая: слушаем contextmenu на документе и гасим его ТОЛЬКО
// когда курсор на <img>. Глобальная блокировка правой кнопки (как делают на
// «защищённых» сайтах) ломает «Открыть ссылку в новой вкладке», копирование
// текста, проверку орфографии в полях — за это справедливо ненавидят.
//
// В админке выключено целиком: там ПКМ по картинке нужен самому владельцу —
// в редакторе блога (PostEditor.tsx) обложки вставляются и проверяются руками.

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export function ImageGuard() {
  const pathname = usePathname();
  const disabled = pathname?.startsWith('/admin') ?? false;

  useEffect(() => {
    if (disabled) {
      delete document.documentElement.dataset.imgGuard;
      return;
    }

    // Флаг на <html> — по нему цепляются CSS-правила (globals.css, блок
    // [data-img-guard] img). Так стили выключаются в админке сами, без второго
    // списка путей в CSS, и не применяются вовсе, если JS не отработал.
    document.documentElement.dataset.imgGuard = '';

    const isImage = (t: EventTarget | null) => t instanceof HTMLElement && t.tagName === 'IMG';

    const onContextMenu = (e: MouseEvent) => {
      if (isImage(e.target)) e.preventDefault();
    };

    // Отдельно от меню: картинку можно утащить мышкой прямо на рабочий стол,
    // и это сохранит файл в обход контекстного меню.
    const onDragStart = (e: DragEvent) => {
      if (isImage(e.target)) e.preventDefault();
    };

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('dragstart', onDragStart);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('dragstart', onDragStart);
      delete document.documentElement.dataset.imgGuard;
    };
  }, [disabled]);

  return null;
}
