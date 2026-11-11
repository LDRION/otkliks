// Что на странице формы требует человека: капча, вход по паролю, загрузка файла.
//
// Считаем только ВИДИМОЕ. Раньше капчу искали подстрокой «captcha» во всём HTML —
// и страница вопросов работодателя на hh.ru всегда «оказывалась» с капчей: слово
// есть в служебных скриптах hh, хотя человеку ничего проходить не нужно. Так же
// ложно срабатывают невидимые reCAPTCHA v3 / SmartCaptcha (их значок в углу —
// не проверка) и скрытые поля пароля/файла из формы входа или смены аватарки.
//
// Функция выполняется В БРАУЗЕРЕ (page.evaluate), поэтому самодостаточна.
function detectVisibleBlockersInPage() {
  const visible = (el, minW = 1, minH = 1) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < minW || r.height < minH) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
  };
  const any = (selector, minW, minH) => Array.from(document.querySelectorAll(selector)).some((el) => visible(el, minW, minH));

  // Виджет проверки: iframe «я не робот» / задачи с картинками, либо сам блок капчи.
  const captchaFrame = Array.from(document.querySelectorAll('iframe')).some((f) => {
    const src = f.getAttribute('src') || '';
    if (!/recaptcha|hcaptcha|challenges\.cloudflare|smartcaptcha|captcha/i.test(src)) return false;
    if (/size=invisible/i.test(src)) return false;
    if (f.closest('.grecaptcha-badge')) return false;            // значок reCAPTCHA v3
    return visible(f, 60, 40);
  });
  const captchaBlock = any([
    '.g-recaptcha:not([data-size="invisible"])', '.h-captcha:not([data-size="invisible"])',
    '.cf-turnstile', '.smart-captcha', '[data-testid*="captcha" i]',
    'img[src*="captcha" i]', 'input[name*="captcha" i]',
  ].join(','), 20, 20);

  return {
    captcha: captchaFrame || captchaBlock,
    password: any('input[type="password"]'),
    file: any('input[type="file"]'),
  };
}

module.exports = { detectVisibleBlockersInPage };
