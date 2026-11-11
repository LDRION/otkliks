// Express 4 не ловит отклонённые промисы из async-обработчиков: запрос просто
// висит до таймаута, а ошибка уходит в unhandledRejection. Эта функция проходит
// по всем маршрутам роутера и оборачивает обработчики так, что ошибка уходит в
// общий обработчик app.js — он отвечает 500 без подробностей наружу.
function wrapAsyncRouter(router) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const l of layer.route.stack) {
      const fn = l.handle;
      if (fn.length > 3) continue; // обработчик ошибок (err, req, res, next) не трогаем
      l.handle = (req, res, next) => {
        try {
          const r = fn(req, res, next);
          if (r && typeof r.catch === 'function') r.catch(next);
        } catch (e) { next(e); }
      };
    }
  }
  return router;
}

module.exports = { wrapAsyncRouter };
