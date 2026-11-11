const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('otkliks', {
  // Версия сборки в интерфейсе: без неё при разборе жалоб непонятно, работает ли у
  // человека свежий лаунчер или он смотрит на поведение прошлой версии.
  appVersion: () => ipcRenderer.invoke('app:version'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateState: () => ipcRenderer.invoke('update:state'),
  updateApply: () => ipcRenderer.invoke('update:apply'),
  onUpdateState: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s)),
  getConsent: () => ipcRenderer.invoke('consent:get'),
  accountLogin: (service) => ipcRenderer.invoke('account:login', service),
  accountStatus: (service) => ipcRenderer.invoke('account:status', service),
  setConsent: (enabled) => ipcRenderer.invoke('consent:set', enabled),
  login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
  register: (email, password, fullName, consent) => ipcRenderer.invoke('auth:register', { email, password, fullName, consent: consent === true }),
  session: () => ipcRenderer.invoke('auth:session'),
  logout: () => ipcRenderer.invoke('auth:logout'),

  updateProfile: (fields) => ipcRenderer.invoke('profile:update', fields),
  pairDevice: () => ipcRenderer.invoke('device:pair'),
  changePassword: (currentPassword, newPassword) =>
    ipcRenderer.invoke('auth:changePassword', { currentPassword, newPassword }),
  getNotificationPrefs: () => ipcRenderer.invoke('notifications:get'),
  setNotificationPrefs: (prefs) => ipcRenderer.invoke('notifications:set', prefs),

  hhLogin: () => ipcRenderer.invoke('hh:login'),
  hhStatus: () => ipcRenderer.invoke('hh:status'),
  hhFinishLogin: () => ipcRenderer.invoke('hh:finishLogin'),

  startAutomation: () => ipcRenderer.invoke('automation:start'),
  stopAutomation: () => ipcRenderer.invoke('automation:stop'),
  automationStatus: () => ipcRenderer.invoke('automation:status'),
  // Задание дня бесплатного тарифа.
  taskOpen: (id, url) => ipcRenderer.invoke('tasks:open', { id, url }),
  taskDone: (id) => ipcRenderer.invoke('tasks:done', id),
  // Автозапуск вместе с Windows (переключатель в шапке).
  autoLaunchGet: () => ipcRenderer.invoke('autolaunch:get'),
  autoLaunchSet: (enabled) => ipcRenderer.invoke('autolaunch:set', enabled === true),
  // Автопилот запустил не человек, а сам лаунчер (автозапуск) — обновить кнопку.
  onAutomationChanged: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('automation:changed', listener);
    return () => ipcRenderer.removeListener('automation:changed', listener);
  },

  localStats: () => ipcRenderer.invoke('stats:local'),
  // Отклики по дням для графика на «Обзоре».
  dailyStats: (days) => ipcRenderer.invoke('stats:daily', days),
  feedHistory: () => ipcRenderer.invoke('feed:history'),
  interviewInvites: () => ipcRenderer.invoke('interviews:list'),
  clarificationsList: () => ipcRenderer.invoke('clarifications:list'),
  clarificationsAnswer: (id, answerText, aiImprove) =>
    ipcRenderer.invoke('clarifications:answer', { id, answerText, aiImprove }),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  negotiationTail: (negotiationId, incoming) => ipcRenderer.invoke('negotiation:tail', { negotiationId, incoming }),
  interviewHide: (negotiationId) => ipcRenderer.invoke('interviews:hide', negotiationId),
  clarificationDismiss: (id) => ipcRenderer.invoke('clarifications:dismiss', id),
  exclusionsList: () => ipcRenderer.invoke('exclusions:list'),
  exclusionAdd: (payload) => ipcRenderer.invoke('exclusions:add', payload),
  exclusionRemove: (id) => ipcRenderer.invoke('exclusions:remove', id),
  blacklistList: () => ipcRenderer.invoke('blacklist:list'),
  blacklistAdd: (payload) => ipcRenderer.invoke('blacklist:add', payload),
  blacklistRemove: (id) => ipcRenderer.invoke('blacklist:remove', id),
  blacklistPreview: (negotiationId) => ipcRenderer.invoke('blacklist:preview', { negotiationId }),
  blacklistWord: (text) => ipcRenderer.invoke('blacklist:word', text),
  openBilling: () => ipcRenderer.invoke('shell:openBilling'),

  // Управление окном: у окна теперь нет системной рамки (frame: false), поэтому
  // свои кнопки. «Закрыть» прячет в трей — то же, что и раньше делал крестик.
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowClose: () => ipcRenderer.invoke('window:close'),

  onLog: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('agent:log', listener);
    return () => ipcRenderer.removeListener('agent:log', listener);
  },
  // Пользователя сменили из меню в трее — окно должно вернуться к форме входа
  // само, а не показывать данные уже разлогиненного аккаунта.
  onSignedOut: (cb) => {
    const listener = (_e, reason) => cb(reason || null);
    ipcRenderer.on('auth:signed-out', listener);
    return () => ipcRenderer.removeListener('auth:signed-out', listener);
  },
  onEvent: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener);
  },
});
