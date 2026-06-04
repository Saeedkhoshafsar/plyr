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
      'common.minutes': 'دقیقه',
      'common.logoutDone': 'خارج شدید.',
      'common.empty': 'موردی یافت نشد.',
      'common.error': 'خطا',
      'common.confirm': 'آیا مطمئن هستید؟',
      'common.delete': 'حذف',
      'common.cancel': 'انصراف',
      'common.refresh': 'به‌روزرسانی',
      'common.copy': 'کپی',
      'common.copied': 'کپی شد',
      'common.userId': 'شناسه‌ی کاربر',

      // Run / Flow builder
      'run.title': 'ساخت و اجرای Flow',
      'run.userId': 'شناسه‌ی کاربر (userId)',
      'run.userIdHint': 'کلید شما به این شناسه bind شده است.',
      'run.headless': 'اجرای بدون نمایش (headless)',
      'run.webhook': 'آدرس Webhook (اختیاری)',
      'run.steps': 'مراحل (Steps)',
      'run.addStep': 'افزودن مرحله',
      'run.noSteps': 'هنوز مرحله‌ای اضافه نشده. روی «افزودن مرحله» بزنید.',
      'run.action': 'اکشن',
      'run.submit': 'اجرا (Run)',
      'run.submitting': 'در حال ارسال…',
      'run.queued': 'جاب در صف قرار گرفت',
      'run.jobId': 'شناسه‌ی جاب',
      'run.viewJob': 'مشاهده‌ی جاب',
      'run.removeStep': 'حذف',
      'run.moveUp': 'بالا',
      'run.moveDown': 'پایین',
      'run.needStep': 'حداقل یک مرحله لازم است.',
      'run.needUserId': 'شناسه‌ی کاربر لازم است.',
      'run.loadExample': 'نمونه',
      'run.clearAll': 'پاک کردن همه',
      // step param labels
      'p.url': 'آدرس (URL)',
      'p.selector': 'سلکتور (CSS)',
      'p.text': 'متن',
      'p.value': 'مقدار',
      'p.key': 'کلید',
      'p.ms': 'مدت (میلی‌ثانیه)',
      'p.name': 'نام',
      'p.message': 'پیام',
      'p.attribute': 'صفت (attribute)',
      'p.direction': 'جهت',

      // Jobs
      'jobs.title': 'جاب‌ها',
      'jobs.refresh': 'به‌روزرسانی',
      'jobs.id': 'شناسه',
      'jobs.state': 'وضعیت',
      'jobs.time': 'زمان',
      'jobs.actions': 'عملیات',
      'jobs.view': 'جزئیات',
      'jobs.cancel': 'لغو',
      'jobs.empty': 'هیچ جابی یافت نشد.',
      'jobs.cancelled': 'درخواست لغو ارسال شد.',
      'jobs.detail': 'جزئیات جاب',
      'jobs.back': 'بازگشت به لیست',
      'jobs.progress': 'پیشرفت',
      'jobs.output': 'خروجی مراحل',
      'jobs.noOutput': 'هنوز خروجی‌ای ثبت نشده.',
      'jobs.live': 'در حال اجرا (به‌روزرسانی زنده)…',
      'jobs.duration': 'مدت اجرا',
      'jobs.result': 'نتیجه',
      'state.waiting': 'در صف',
      'state.delayed': 'در صف',
      'state.active': 'در حال اجرا',
      'state.completed': 'موفق',
      'state.failed': 'ناموفق',
      'state.unknown': 'نامشخص',

      // Quota
      'quota.title': 'سهمیه و طرح',
      'quota.plan': 'طرح',
      'quota.level': 'سطح',
      'quota.type': 'نوع کاربر',
      'quota.subscription': 'اشتراک',
      'quota.usage': 'مصرف امروز',
      'quota.used': 'مصرف‌شده',
      'quota.remaining': 'باقی‌مانده',
      'quota.limit': 'سقف',
      'quota.unlimited': 'نامحدود',
      'quota.maxTabs': 'حداکثر تب',
      'quota.maxSteps': 'حداکثر مرحله',
      'quota.maxSchedules': 'حداکثر زمان‌بندی',
      'quota.priority': 'اولویت',

      // Schedules
      'sched.title': 'زمان‌بندی‌ها',
      'sched.name': 'نام',
      'sched.cron': 'الگوی Cron',
      'sched.next': 'اجرای بعدی',
      'sched.created': 'ساخته‌شده',
      'sched.tz': 'منطقه‌ی زمانی',
      'sched.actions': 'عملیات',
      'sched.empty': 'زمان‌بندی فعالی وجود ندارد.',
      'sched.count': 'تعداد',
      'sched.deleted': 'زمان‌بندی حذف شد.',
      'sched.confirmDelete': 'این زمان‌بندی حذف شود؟',

      // Admin
      'nav.admin': 'پنل ادمین',
      'admin.title': 'پنل ادمین',
      'admin.tokenLabel': 'رمز ادمین (Admin Secret)',
      'admin.connect': 'اتصال',
      'admin.invalidToken': 'رمز ادمین نامعتبر است.',
      'admin.stats': 'آمار سیستم',
      'admin.totalJobs': 'کل جاب‌ها',
      'admin.success': 'موفق',
      'admin.failed': 'ناموفق',
      'admin.totalSteps': 'کل مراحل',
      'admin.hint': 'برای دسترسی به پنل ادمین، رمز ادمین را وارد کنید (در .env تنظیم شده).',
      'admin.locked': 'قفل (نیاز به رمز ادمین)',
      'admin.disconnect': 'قطع اتصال',
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
      'common.minutes': 'min',
      'common.logoutDone': 'Signed out.',
      'common.empty': 'Nothing found.',
      'common.error': 'Error',
      'common.confirm': 'Are you sure?',
      'common.delete': 'Delete',
      'common.cancel': 'Cancel',
      'common.refresh': 'Refresh',
      'common.copy': 'Copy',
      'common.copied': 'Copied',
      'common.userId': 'User ID',

      // Run / Flow builder
      'run.title': 'Build & run a Flow',
      'run.userId': 'User ID (userId)',
      'run.userIdHint': 'Your key is bound to this user id.',
      'run.headless': 'Headless run',
      'run.webhook': 'Webhook URL (optional)',
      'run.steps': 'Steps',
      'run.addStep': 'Add step',
      'run.noSteps': 'No steps yet. Click “Add step”.',
      'run.action': 'Action',
      'run.submit': 'Run',
      'run.submitting': 'Submitting…',
      'run.queued': 'Job queued',
      'run.jobId': 'Job ID',
      'run.viewJob': 'View job',
      'run.removeStep': 'Remove',
      'run.moveUp': 'Up',
      'run.moveDown': 'Down',
      'run.needStep': 'At least one step is required.',
      'run.needUserId': 'User ID is required.',
      'run.loadExample': 'Example',
      'run.clearAll': 'Clear all',
      'p.url': 'URL',
      'p.selector': 'Selector (CSS)',
      'p.text': 'Text',
      'p.value': 'Value',
      'p.key': 'Key',
      'p.ms': 'Duration (ms)',
      'p.name': 'Name',
      'p.message': 'Message',
      'p.attribute': 'Attribute',
      'p.direction': 'Direction',

      // Jobs
      'jobs.title': 'Jobs',
      'jobs.refresh': 'Refresh',
      'jobs.id': 'ID',
      'jobs.state': 'State',
      'jobs.time': 'Time',
      'jobs.actions': 'Actions',
      'jobs.view': 'Details',
      'jobs.cancel': 'Cancel',
      'jobs.empty': 'No jobs found.',
      'jobs.cancelled': 'Cancel request sent.',
      'jobs.detail': 'Job details',
      'jobs.back': 'Back to list',
      'jobs.progress': 'Progress',
      'jobs.output': 'Step outputs',
      'jobs.noOutput': 'No output recorded yet.',
      'jobs.live': 'Running (live updates)…',
      'jobs.duration': 'Duration',
      'jobs.result': 'Result',
      'state.waiting': 'Queued',
      'state.delayed': 'Queued',
      'state.active': 'Running',
      'state.completed': 'Success',
      'state.failed': 'Failed',
      'state.unknown': 'Unknown',

      // Quota
      'quota.title': 'Quota & plan',
      'quota.plan': 'Plan',
      'quota.level': 'Level',
      'quota.type': 'User type',
      'quota.subscription': 'Subscription',
      'quota.usage': "Today's usage",
      'quota.used': 'Used',
      'quota.remaining': 'Remaining',
      'quota.limit': 'Limit',
      'quota.unlimited': 'unlimited',
      'quota.maxTabs': 'Max tabs',
      'quota.maxSteps': 'Max steps',
      'quota.maxSchedules': 'Max schedules',
      'quota.priority': 'Priority',

      // Schedules
      'sched.title': 'Schedules',
      'sched.name': 'Name',
      'sched.cron': 'Cron pattern',
      'sched.next': 'Next run',
      'sched.created': 'Created',
      'sched.tz': 'Timezone',
      'sched.actions': 'Actions',
      'sched.empty': 'No active schedules.',
      'sched.count': 'Count',
      'sched.deleted': 'Schedule deleted.',
      'sched.confirmDelete': 'Delete this schedule?',

      // Admin
      'nav.admin': 'Admin',
      'admin.title': 'Admin panel',
      'admin.tokenLabel': 'Admin Secret',
      'admin.connect': 'Connect',
      'admin.invalidToken': 'Invalid admin secret.',
      'admin.stats': 'System stats',
      'admin.totalJobs': 'Total jobs',
      'admin.success': 'Success',
      'admin.failed': 'Failed',
      'admin.totalSteps': 'Total steps',
      'admin.hint': 'Enter the admin secret (set in .env) to access the admin panel.',
      'admin.locked': 'Locked (admin secret required)',
      'admin.disconnect': 'Disconnect',
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
