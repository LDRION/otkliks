/**
 * tray.js — значок Откликса в области уведомлений Windows.
 *
 * Зачем он вообще: автопилот работает часами, и окно всё это время только мешает.
 * До трея закрытие окна означало выход из программы (window-all-closed → app.quit),
 * то есть свернуть автопилот «в фон» было нельзя вовсе — либо окно на экране, либо
 * отклики не отправляются. Теперь крестик прячет окно, а выход — осознанный пункт
 * меню.
 *
 * Поведение значка: ЛКМ — показать окно, ПКМ — меню (открыть / сменить
 * пользователя / выход).
 */
const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');

let tray = null;
// Пока флаг не поднят, закрытие окна прячет его в трей, а не выходит из программы.
// Поднимается только из пункта «Выход» и при обновлении — иначе приложение
// невозможно было бы закрыть по-настоящему.
let quitting = false;

function iconPath() {
  // Именно src/assets, а не build/: в пакет попадает только то, что перечислено в
  // files у electron-builder (src/**), а build/ туда не входит — иконка из него
  // в собранном лаунчере просто не нашлась бы, и значок вышел бы пустым.
  return path.join(__dirname, '..', 'assets', 'tray.ico');
}

/**
 * @param {object} deps
 * @param {() => import('electron').BrowserWindow | null} deps.getWindow
 * @param {() => void} deps.showWindow      показать/восстановить окно
 * @param {() => Promise<void>} deps.logout сменить пользователя (разлогин + окно входа)
 */
function createTray({ getWindow, showWindow, logout }) {
  if (tray) return tray;

  let image = nativeImage.createFromPath(iconPath());
  // Пустая картинка = невидимый значок: место в трее занято, а нажать не на что.
  // Лучше отдать Electron дефолт, чем показать пользователю пустоту.
  if (image.isEmpty()) image = nativeImage.createEmpty();

  tray = new Tray(image);
  tray.setToolTip('Откликс — автопилот откликов на hh.ru');

  const menu = Menu.buildFromTemplate([
    { label: 'Открыть Откликс', click: () => showWindow() },
    { type: 'separator' },
    {
      label: 'Сменить пользователя',
      click: async () => {
        try { await logout(); } catch { /* разлогин не должен ронять трей */ }
        showWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);

  // ЛКМ по значку — показать окно. На Windows это событие 'click'; двойной клик
  // ведём туда же, иначе быстрый двойной щелчок не делает ничего.
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());

  return tray;
}

const isQuitting = () => quitting;
// Обновление ставится при выходе (autoInstallOnAppQuit), и этот выход тоже должен
// быть настоящим, а не сворачиванием в трей.
const setQuitting = (v) => { quitting = !!v; };
function destroyTray() {
  tray?.destroy();
  tray = null;
}

module.exports = { createTray, isQuitting, setQuitting, destroyTray };
