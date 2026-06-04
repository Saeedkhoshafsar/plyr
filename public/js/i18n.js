/* ============================================
   i18n — Persian / English with RTL/LTR switch
   Step 7. Exposes window.I18N.
   ============================================ */
(function () {
  'use strict';

  var DICT = {
    fa: {
      'app.title': 'بک‌اند اتوماسیون',
      'login.subtitle': 'برای ورود کلید API خود را وارد کنید',
      'login.apiKey': 'کلید API',
      'login.remember': 'مرا به خاطر بسپار',
      'login.submit': 'ورود',
      'login.invalid': 'کلید API نامعتبر است یا سرور در دسترس نیست.',
      'login.empty': 'لطفاً کلید API را وارد کنید.',
      'login.checking': 'در حال بررسی…',

      'nav.dashboard': 'داشبورد',
      'nav.run': 'اجرای Flow',
      'nav.jobs': 'جاب‌ها',
      'nav.schedules': 'زمان‌بندی‌ها',
      'nav.quota': 'سهمیه',
      'nav.logout': 'خروج',

      'status.checking': 'در حال بررسی…',
      'status.online': 'سیستم آنلاین',
      'status.offline': 'سیستم در دسترس نیست',
      'status.degraded': 'وضعیت ناپایدار',

      'dash.title': 'وضعیت سیستم',
      'dash.system': 'سرویس',
      'dash.version': 'نسخه',
      'dash.uptime': 'مدت فعالیت',
      'dash.redis': 'Redis',
      'dash.lua': 'اسکریپت‌های Lua',
      'dash.browsers': 'مرورگرها',
      'dash.vip': 'VIP',
      'dash.free': 'رایگان',
      'dash.total': 'مجموع',
      'dash.pages': 'صفحات ثبت‌شده',
      'dash.features': 'ویژگی‌ها',
      'dash.connected': 'متصل',
      'dash.disconnected': 'قطع',
      'dash.loaded': 'بارگذاری شد',
      'dash.fallback': 'fallback',
      'dash.on': 'فعال',
      'dash.off': 'غیرفعال',
      'dash.refresh': 'به‌روزرسانی',
      'dash.loadError': 'خطا در دریافت وضعیت سیستم',

      'feat.flattener': 'Flattener',
      'feat.resourceBlocking': 'مسدودسازی منابع',
      'feat.turbo': 'حالت توربو',
      'feat.sequential': 'اجرای ترتیبی رایگان',
      'feat.webhookRetries': 'تلاش مجدد Webhook',

      'common.comingSoon': 'این بخش در استپ بعدی تکمیل می‌شود.',
      'common.loading': 'در حال بارگذاری…',
      'common.seconds': 'ثانیه',
      'common.logoutDone': 'خارج شدید.',
    },
    en: {
      'app.title': 'Automation Backend',
      'login.subtitle': 'Enter your API key to sign in',
      'login.apiKey': 'API Key',
      'login.remember': 'Remember me',
      'login.submit': 'Sign in',
      'login.invalid': 'Invalid API key or server unavailable.',
      'login.empty': 'Please enter your API key.',
      'login.checking': 'Checking…',

      'nav.dashboard': 'Dashboard',
      'nav.run': 'Run Flow',
      'nav.jobs': 'Jobs',
      'nav.schedules': 'Schedules',
      'nav.quota': 'Quota',
      'nav.logout': 'Logout',

      'status.checking': 'Checking…',
      'status.online': 'System online',
      'status.offline': 'System unavailable',
      'status.degraded': 'Degraded',

      'dash.title': 'System status',
      'dash.system': 'Service',
      'dash.version': 'Version',
      'dash.uptime': 'Uptime',
      'dash.redis': 'Redis',
      'dash.lua': 'Lua scripts',
      'dash.browsers': 'Browsers',
      'dash.vip': 'VIP',
      'dash.free': 'Free',
      'dash.total': 'Total',
      'dash.pages': 'Registered pages',
      'dash.features': 'Features',
      'dash.connected': 'connected',
      'dash.disconnected': 'disconnected',
      'dash.loaded': 'loaded',
      'dash.fallback': 'fallback',
      'dash.on': 'on',
      'dash.off': 'off',
      'dash.refresh': 'Refresh',
      'dash.loadError': 'Failed to load system status',

      'feat.flattener': 'Flattener',
      'feat.resourceBlocking': 'Resource blocking',
      'feat.turbo': 'Turbo mode',
      'feat.sequential': 'Free sequential',
      'feat.webhookRetries': 'Webhook retries',

      'common.comingSoon': 'This section will be built in the next step.',
      'common.loading': 'Loading…',
      'common.seconds': 's',
      'common.logoutDone': 'Signed out.',
    },
  };

  var LANG_META = {
    fa: { dir: 'rtl', label: 'English', next: 'en' },
    en: { dir: 'ltr', label: 'فارسی', next: 'fa' },
  };

  var STORAGE_KEY = 'ab_lang';
  var current = localStorage.getItem(STORAGE_KEY) || 'fa';
  if (!DICT[current]) current = 'fa';

  function t(key) {
    var table = DICT[current] || DICT.fa;
    return table[key] || (DICT.fa[key] || key);
  }

  function meta() {
    return LANG_META[current];
  }

  function getLang() {
    return current;
  }

  function setLang(lang) {
    if (!DICT[lang]) return;
    current = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    apply();
  }

  function toggle() {
    setLang(meta().next);
  }

  /** Apply translations to all [data-i18n] elements + html dir/lang. */
  function apply() {
    var m = meta();
    document.documentElement.lang = current;
    document.documentElement.dir = m.dir;
    if (document.body) document.body.setAttribute('data-lang', current);

    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    var phNodes = document.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < phNodes.length; j++) {
      phNodes[j].setAttribute('placeholder', t(phNodes[j].getAttribute('data-i18n-placeholder')));
    }
    // update language toggle buttons label
    var labels = document.querySelectorAll('[data-lang-label]');
    for (var k = 0; k < labels.length; k++) labels[k].textContent = m.label;

    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: current } }));
  }

  window.I18N = { t: t, apply: apply, setLang: setLang, toggle: toggle, getLang: getLang, meta: meta };
})();
