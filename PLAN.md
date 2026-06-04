# 📋 PLAN.md — بازیابی و تکمیل پروژه `automation-backend-v37`

> این فایل نقشه‌ی راه پروژه است. در هر جلسه **اول این فایل را بخوان**، ببین کدام استپ‌ها `[x]` خورده‌اند، و از **اولین استپ ناتمام** شروع کن.

---

## 🚀 مدل استقرار: Self-Hosted تک‌کاربره/تیمی (تصمیم جلسه‌ی ۲ — بسیار مهم)

> **تصمیم صاحب پروژه:** پروژه **رایگان و پابلیک (open-source)** منتشر می‌شود و هر کاربر آن را **روی سرور شخصی خودش** اجرا می‌کند (کنار n8n خودش). دلیل: سرور عمومی مشترک برای اتوماسیون مرورگر **ریسک امنیتی/سوءاستفاده بالایی** دارد (کارهای مخرب، دردسر اشتراکی) و ارزش مدیریت VIP/اشتراک را ندارد. self-hosted هم امن‌تر است، هم خدمت به جامعه، هم منطقی‌تر (همان جایی که n8n هست).

**🎯 تأثیر روی معماری (بله، تأثیر دارد — و مثبت است: ساده‌سازی بزرگ):**

| بخش | در مدل قبلی (SaaS چندکاربره) | در مدل جدید (Self-Hosted) |
|------|------------------------------|----------------------------|
| **کاربران** | چند کاربر، سطح‌بندی، plan | معمولاً **تک‌کاربر** (صاحب سرور) یا تیم کوچک معتمد |
| **VIP/Free** | منطق Hybrid پیچیده | **حذف تمایز** — همه «full access». مرورگر persistent برای همه |
| **Quota روزانه** | لازم برای جلوگیری از سوءاستفاده | **پیش‌فرض نامحدود** (منابع مال خودته) |
| **Rate Limit** | سخت‌گیرانه | **سبک/اختیاری** (فقط محافظت پایه) |
| **Plan/Level/Override** | سیستم کامل (~۴۷۵ خط UserManager) | **اختیاری/خاموش** به‌صورت پیش‌فرض |
| **block-user / admin بر کاربران** | لازم | **عملاً بی‌معنی** در تک‌کاربر |
| **API Key** | الزامی برای تفکیک کاربر | **یک توکن ساده** برای محافظت سرور شخصی (نه تفکیک کاربر) |
| **امنیت** | محافظت کاربران از هم | **محافظت سرور از اینترنت** (چون پابلیک نصب می‌شود) |

**✅ تصمیم پیاده‌سازی (بدون حذف کد، با سوییچ):**
معرفی متغیر `DEPLOYMENT_MODE` با دو مقدار:
- **`single`** (پیش‌فرض، توصیه‌شده): تک‌کاربره. VIP/Quota/Plan خاموش، همه full-access، یک API token برای محافظت، rate-limit سبک. ساده برای نصب در ۵ دقیقه کنار n8n.
- **`multi`**: حالت SaaS کامل فعلی (همه‌ی منطق VIP/Quota/Plan/Admin فعال) — برای کسانی که می‌خواهند سرویس عمومی بزنند.

> این کار مزیت رقابتی ما (سروری/مقیاس‌پذیر) را **حفظ** می‌کند ولی **مسیر پیش‌فرض را برای جامعه ساده و امن** می‌سازد. → استپ جدید **۱۸**.

**🔐 نکات امنیتی self-hosted پابلیک (چون روی اینترنت نصب می‌شود):**
- مستندسازی محکم: حتماً پشت auth، توصیه به اجرای پشت reverse-proxy/VPN، هشدار درباره‌ی `--no-sandbox`.
- مقدار پیش‌فرض امن: `API_TOKEN` تصادفی هنگام اولین اجرا تولید شود (نه مقدار `change_me`).
- محافظت SSRF و path-traversal که الان هست → حفظ و تقویت شود (در self-hosted مهم‌تر است چون به شبکه‌ی داخلی کاربر دسترسی دارد).

---

## 🏛️ معماری مرجع پروژه (تثبیت‌شده در جلسه‌ی ۲ — منبع حقیقت)

> صاحب پروژه نقشه‌ی اصلی ۲ سال پیش را دقیق به‌خاطر ندارد؛ این بخش **معماری رسمی و مرجع** است که همه‌ی استپ‌ها باید با آن هم‌راستا باشند.

**ایده‌ی کلان:** پروژه دو بخش دارد — **سمت کلاینت (چند منبع)** و **سمت سرور (مغز پردازش)**. هر کلاینتی workflow/دیتای اتوماسیون را به سرور می‌فرستد؛ سرور آن را می‌پذیرد، ذخیره/صف می‌کند، اجرا می‌کند، و یک **مسیر زنده (Live)** برمی‌گرداند تا کاربر روند و باگ‌های اتوماسیونش را لحظه‌به‌لحظه ببیند.

```
┌─────────────── کلاینت‌ها (Producers) ───────────────┐        ┌──────────── سرور (مغز) ────────────┐
│                                                     │        │                                     │
│  • افزونه‌ی مرورگر (ضبط/ارسال اتوماسیون)            │        │  1) دریافت + احراز هویت (API Key)   │
│  • n8n (ارسال/استلاج workflow)                      │─REST──▶│  2) اعتبارسنجی + ذخیره (storage)    │
│  • داشبورد UI (ساخت/اجرای workflow)                 │ /WS    │  3) صف (BullMQ + Redis)            │
│  • هر کلاینت آینده (mobile/CLI/SDK)                 │        │  4) اجرا (Playwright pipeline)     │
│                                                     │        │  5) انتشار رویداد زنده (Live)      │
└─────────────────────────────────────────────────────┘        └──────────────┬──────────────────────┘
                                                                              │
                          ┌───────────── مسیر زنده (Live Channel) ◀───────────┘
                          ▼
        کاربر در داشبورد (یا هر کلاینت) لحظه‌به‌لحظه می‌بیند:
        • لاگ زنده‌ی هر step  • وضعیت/خطا  • تصویر زنده‌ی مرورگر (screencast)  • باگ اتوماسیون
```

**اصول معماری که از این پس رعایت می‌شوند:**
1. **سرور client-agnostic است:** قرارداد یکسان برای همه‌ی کلاینت‌ها (افزونه، n8n، UI، آینده) — یک فرمت workflow + یک API.
2. **هر workflow ذخیره می‌شود (Workflow Storage):** نه فقط اجرای آنی؛ باید بشود ذخیره، بازاجرا، نسخه‌بندی و از طریق هر کلاینت مدیریت کرد. → این یک شکاف فعلی است (پایین).
3. **مسیر زنده (Live Channel) شهروند درجه‌یک است:** یک کانال استاندارد (WebSocket/SSE) که رویدادهای زنده‌ی job را پخش می‌کند: `log`, `step.start`, `step.done`, `step.error`, `screenshot/frame`, `job.done`. هر کلاینت می‌تواند subscribe کند.
4. **یک منبع حقیقت برای وضعیت job:** Redis؛ هم poll (`/job/:id`) هم push (Live) از همان می‌خوانند.

**وضعیت فعلی نسبت به این معماری:**
- ✅ سرور، صف، اجرا، احراز هویت، webhook خروجی — موجود است.
- ⚠️ **«مسیر زنده» فقط ابتدایی است:** الان فقط با poll کردن `/job/:id` یک `liveStatus` ساده (URL فعلی + یک پیام) برمی‌گردد. **استریم زنده‌ی لاگ و تصویر وجود ندارد.** → استپ‌های ۱۲ و یک استپ جدید Live.
- ⚠️ **Workflow Storage مستقل وجود ندارد:** فقط نتیجه‌ی job ذخیره می‌شود، نه خودِ workflowها برای بازاجرا/مدیریت. → استپ جدید.
- ⚠️ **قرارداد client-agnostic رسمی نیست:** فرمت‌ها پراکنده‌اند؛ باید یک اسکیمای واحد + OpenAPI تعریف شود. → استپ ۱۴.

---

## 🧭 پروژه چیست؟

یک **Backend اتوماسیون مرورگر در سطح Enterprise** که با **Node.js + TypeScript** نوشته شده.

| بخش | تکنولوژی |
|------|-----------|
| وب‌سرور | Express 4 + Helmet (CSP) |
| صف کارها | BullMQ روی Redis |
| اتوماسیون مرورگر | Playwright + playwright-extra + stealth |
| ذخیره‌سازی | Redis (ioredis) + فایل JSON روی دیسک |
| اجرای production | PM2 cluster (۴ worker) |
| احراز هویت | API Key + Admin Secret |

**معماری Hybrid:** کاربران VIP مرورگر اختصاصی persistent دارند؛ کاربران Free از یک مرورگر مشترک (GlobalBrowser) با context ایزوله استفاده می‌کنند.

**قابلیت‌های اصلی:**
- موتور Flow با شرط (`if/else`), حلقه (`while`), خطا (`try/catch/finally`), `switch/case`
- اجرای ماژول‌های افزونه‌ای (`modules/*`)
- زمان‌بندی cron (Schedule) با BullMQ repeatable jobs
- سیستم Quota روزانه + Rate Limit + Plan کاربری
- Webhook با retry و محافظت SSRF
- لغو کار (cancel) با بستن tab/browser

**کد:** ~۸٬۰۰۰ خط TypeScript در ۲۳ فایل.

---

## ⚔️ مقایسه با Automa (github.com/AutomaApp/automa)

> Automa مرجع شماره‌یک متن‌باز در حوزه‌ی اتوماسیون مرورگر است. مقایسه برای تعیین مسیر توسعه.

**تفاوت بنیادی معماری:**

| محور | پروژه ما (`automation-backend`) | Automa |
|------|----------------------------------|--------|
| نوع | **Backend سروری** (Node.js + Playwright) | **افزونه‌ی مرورگر** (Chrome/Firefox Extension) |
| اجرا | مرورگر سمت **سرور** کنترل می‌شود | داخل **مرورگر خودِ کاربر** اجرا می‌شود |
| Frontend | ❌ ندارد | ✅ Vue 3 + Vue Flow (ادیتور بصری drag-and-drop) |
| تعریف Flow | JSON (آرایه‌ی steps) | بلوک‌های گرافیکی به‌هم‌متصل |
| مقیاس‌پذیری | ✅ صف، چند کاربر، Quota، VIP/Free، PM2 cluster | تک‌کاربره، محدود به یک مرورگر |
| لایسنس | MIT | AGPL + لایسنس تجاری |

### 💪 نقاط قوت ما (که Automa ندارد)
- **معماری چندکاربره و سروری:** صف BullMQ، اجرای همزمان، Quota روزانه، پلن VIP/Free، Rate Limit، API Key — Automa هیچ‌کدام را ندارد (تک‌دستگاهه).
- **استقرار مرکزی:** یک سرور برای صدها کاربر؛ مناسب SaaS و سرویس‌دهی تجاری.
- **stealth واقعی سمت سرور:** playwright-extra + stealth + پروفایل persistent برای VIP — ضدتشخیص قوی‌تر برای اسکریپینگ سنگین.
- **TypeScript strict + ساختار سرویس‌محور تمیز** (routes/services/middleware/core).
- **Webhook با retry و محافظت SSRF** به‌صورت داخلی.

### 🔻 نقاط ضعف ما (که Automa دارد و ما نداریم)
- **❌ بدون رابط کاربری بصری:** بزرگ‌ترین ضعف. Automa ادیتور flow گرافیکی دارد؛ ما فقط JSON خام. → استپ‌های ۷، ۸، ۱۰
- **❌ تعداد بلوک/اکشن خیلی کمتر:** Automa **~۵۰+ بلوک** آماده دارد (Google Sheets، Drive، Cookie، Clipboard، Proxy، Export به CSV/JSON/PDF، Notification، AI Workflow، Regex/Slice/Sort داده، Loop Elements/Data، JavaScript Code، Dialog handler و...). ما مجموعه‌ی اکشن محدودتری داریم. → استپ ۱۱
- **❌ بدون Marketplace/اشتراک workflow:** Automa بازارچه‌ی اشتراک‌گذاری دارد.
- **❌ بدون Trigger متنوع:** Automa تریگر روی رویدادها/visit/shortcut دارد؛ ما فقط `/run` و cron.
- **❌ بدون i18n و مستندات کاربری غنی.**
- **❌ بدون export/import داده به فرمت‌های Google Sheets/CSV/PDF/xlsx.**

### 🎯 جمع‌بندی استراتژی
ما نباید کلون Automa شویم؛ مزیت ما **سروری/چندکاربره/SaaS** است. اما باید شکاف‌های کلیدی را پر کنیم:
1. **رابط کاربری بصری** (الهام از Vue Flow Automa) — استپ‌های ۷، ۸، ۱۰
2. **افزایش تعداد بلوک‌ها/اکشن‌ها** به‌سبک Automa (Export داده، Loop، Regex، Cookie و...) — استپ ۱۱
3. **تعامل با مرورگر مثل افزونه** (نکته‌ی صاحب پروژه) — استپ‌های ۱۲، ۱۳
4. **ادغام با n8n** (نکته‌ی صاحب پروژه) — استپ‌های ۱۴، ۱۵

---

## 🎯 دو نکته‌ی کلیدی صاحب پروژه (جلسه‌ی ۲) — تحلیل و تصمیم معماری

### نکته ۱ — «باید مثل افزونه‌ی کروم با مرورگر تعامل داشته باشیم»

**مشکل امروز:** پروژه مرورگر را سمت سرور headless کنترل می‌کند و کاربر هیچ ارتباط بصری/مستقیمی با آن ندارد. کاربر باید سلکتورها را دستی در JSON بنویسد — سخت و گیج‌کننده. درست مثل گفته‌ی صاحب پروژه: «با رابط مجزا از مرورگر سخته بفهمه چی به چیه.»

**راه‌حل (دو لایه‌ی مکمل):**

- **راهکار A — Live Browser View در UI (سمت سرور):**
  نمایش زنده‌ی همان مرورگر سروری داخل داشبورد با **CDP Screencast** (استریم فریم‌ها روی WebSocket که از قبل `ws` در deps هست). کاربر صفحه را زنده می‌بیند، روی عناصر کلیک می‌کند، و یک **Element Picker** سلکتور CSS/XPath را خودکار تولید می‌کند و داخل step می‌گذارد. → استپ ۱۲

- **راهکار B — افزونه‌ی کمکی Chrome (سمت کاربر):**
  یک افزونه‌ی سبک کروم که کاربر روی **مرورگر واقعی خودش** نصب می‌کند؛ با کلیک روی هر عنصر سایت، سلکتور را گرفته و به backend می‌فرستد (مثل تجربه‌ی Automa/iMacros). برای «ضبط» اکشن‌ها و ساخت flow از روی رفتار واقعی کاربر هم استفاده می‌شود. → استپ ۱۳

> تصمیم: **راهکار A اولویت بالاتر** دارد (چون با معماری سروری ما جور است و نیاز به نصب چیزی توسط کاربر ندارد). راهکار B به‌عنوان مکمل قدرتمند بعد از آن.

### نکته ۲ — «باید با n8n هم بشه ارتباط گرفت»

**مشکل امروز:** فقط `/run` (async) و یک webhook خروجی ساده داریم. برای n8n کافی نیست: n8n به یک **API قابل‌اتصال و قابل‌پیش‌بینی** + **node اختصاصی** نیاز دارد.

**راه‌حل:**

- **بهبود API برای ادغام (استپ ۱۴):**
  - حالت **sync اختیاری**: `POST /run?wait=true` که تا پایان جاب صبر کند و نتیجه را برگرداند (مناسب node معمولی n8n).
  - **callback/webhook استاندارد** با امضای HMAC برای امنیت (n8n Webhook node آن را می‌گیرد).
  - مستند **OpenAPI/Swagger** (`docs/openapi.yaml`) تا n8n HTTP Request node راحت کانفیگ شود.
  - فرمت خروجی یکدست و قابل‌parse (همان `{ success, jobId, stepOutputs, result }`).

- **n8n Community Node (استپ ۱۵):**
  ساخت پکیج `n8n-nodes-automationbackend` با عملیات: `Run Workflow`, `Get Job Result`, `Create Schedule`, `Cancel Job` + یک **Trigger node** که webhookهای ما را دریافت می‌کند. مطابق استاندارد n8n (credentials = API Key + Base URL).

---

## 🔍 «همه‌چیزهای جزئی» که باید در نظر گرفته شوند (چک‌لیست مهندسی)

این موارد در استپ‌های مرتبط رعایت می‌شوند تا کیفیت production حفظ شود:

- **CORS:** UI و n8n از origin دیگر صدا می‌زنند → باید CORS کنترل‌شده اضافه شود (الان helmet هست ولی CORS صریح نیست). → استپ ۷
- **CSP و WebSocket:** برای Live View، باید `connect-src`/`ws:` در CSP باز شود و سرور WS امن راه بیفتد. → استپ ۱۲
- **Auth یکپارچه برای UI/WS/افزونه/n8n:** همان API Key؛ برای WS از query-token یا header استفاده شود. → استپ‌های ۷، ۱۲
- **Rate limit برای endpointهای جدید** (sync run, screencast). → استپ ۱۴
- **امنیت Element Picker/افزونه:** اعتبارسنجی سلکتور (همان `sanitizeSelector` موجود) قبل از اجرا. → استپ ۱۳
- **HMAC signature روی webhook خروجی** (الان امضا ندارد → برای n8n لازم). → استپ ۱۴
- **Idempotency key** روی `/run` تا n8n با retry جاب تکراری نسازد. → استپ ۱۴
- **مدیریت طول عمر مرورگر برای Live View** (مرورگر باید تا پایان session UI زنده بماند، نه فقط حین jobs). → استپ ۱۲
- **i18n (فارسی/انگلیسی) و RTL** در UI. → استپ ۷
- **مستندسازی همه‌ی اکشن‌ها و رویدادهای webhook** برای کاربر n8n. → استپ ۱۴

---

## 🔴 وضعیت فعلی پروژه (تشخیص جلسه‌ی ۱)

پروژه **روی ویندوز** توسعه داده شده و الان قرار است **Node-base / Linux** اجرا شود. به همین دلیل و به‌دلیل کارِ ناتمام، الان **کامپایل نمی‌شود** (۹ خطای TypeScript). جزئیات کامل در بخش «🐛 باگ‌های یافته‌شده».

---

## 🐛 باگ‌های یافته‌شده (آنالیز کامل جلسه‌ی ۱)

### دسته A — باگ‌های Blocker (مانع کامپایل/اجرا — اولویت بحرانی)

- **[A1] خطای حروف بزرگ/کوچک مسیر import** — `src/index.ts:35` می‌نویسد `from './routes'` اما پوشه `src/Routes/` است. روی ویندوز (case-insensitive) کار می‌کرد، روی Linux خطای `Cannot find module './routes'` می‌دهد. → استپ ۲
- **[A2] کلیدهای config گمشده** — `src/pipeline.ts` از `config.UPLOADS_DIR` و `config.DOWNLOADS_DIR` استفاده می‌کند ولی در `src/config.ts` تعریف **نشده‌اند**. خطای `Property 'UPLOADS_DIR' does not exist`. → استپ ۲
- **[A3] پراپرتی ناشناخته `redis`** — `src/index.ts:320` هنگام صدا زدن `runPipeline` فیلد `redis: connection` می‌فرستد، اما امضای تابع `runPipeline` در `pipeline.ts` چنین پارامتری ندارد. → استپ ۲
- **[A4] `WeakRef` شناخته نمی‌شود** — `src/core/ProfileManager.ts:44,102` از `WeakRef` استفاده می‌کند، ولی `tsconfig.json` با `target: ES2020` آن را نمی‌شناسد (`WeakRef` از ES2021 است). → استپ ۲
- **[A5] خطای `new Date(undefined)`** — `src/Routes/user.routes.ts:199,244` به `new Date(thisSchedule.next)` پاس می‌دهد که ممکن است `undefined` باشد (نوعش `number | undefined`). → استپ ۲
- **[A6] پارامتر `any` ضمنی** — `src/pipeline.ts:525` پارامتر `e` نوع ندارد و با `strict` خطا می‌دهد. → استپ ۲

### دسته B — باگ‌های محیط/استقرار (مانع اجرا روی Node-base/Linux)

- **[B1] مسیر Chrome ویندوزی** — `.env` مقدار `CHROME_EXE=C:\...\chrome.exe` دارد و `config.ts` پیش‌فرض ویندوزی می‌گذارد؛ روی Linux باید مسیر لینوکسی یا Playwright bundled باشد. → استپ ۳
- **[B2] باینری‌های ویندوزی Redis (~۴۸MB)** — پوشه `Redis/` پر از `*.exe` و `*.dll` ویندوزی است که روی Linux بی‌فایده و سنگین است؛ نباید در ریپو باشد. → استپ ۱ (gitignore شد) / استپ ۳ (مستندسازی نصب)
- **[B3] `postinstall` شکننده** — `package.json` دارد `"postinstall": "playwright install --with-deps chromium"` که در محیط بدون sudo/CI شکست می‌خورد. → استپ ۳
- **[B4] `node_modules` ویندوزی در zip** — باینری‌های `.node` ناسازگار با Linux بودند (حذف و دوباره نصب شد). → استپ ۱ ✅

### دسته C — باگ‌های منطقی / Race condition (نیازمند بررسی دقیق)

- **[C1] دوبار `sadd` در active jobs** — هم در `/run` (route) و هم در ابتدای worker، `job.id` به مجموعه active اضافه می‌شود؛ احتمال ناسازگاری شمارش. → استپ ۵
- **[C2] محاسبه‌ی `thisJobNumber` نادرست** — در `/run` بر اساس `scard` قبل از افزودن محاسبه می‌شود؛ با درخواست‌های همزمان درست نیست. → استپ ۵
- **[C3] خطای `unhandledRejection` بدون shutdown** — برخلاف `uncaughtException`، در `unhandledRejection` فقط log می‌شود؛ سیاست ناهماهنگ. → استپ ۵
- **[C4] فقدان Validation مرکزی با Zod** — `zod` در dependencies هست ولی validation دستی در `validation.ts` انجام شده؛ یکپارچه نیست. → استپ ۶
- **[C5] 🔴 باگ قفل توزیع‌شده‌ی ناامن (کشف‌شده در استپ ۵)** — `ProfileManager.tryLockUser` با `SET NX EX` قفل می‌گیرد (درست)، اما `unlockUser` یک `DEL` بدون‌قیدوشرط می‌زند. اگر قفل job A به‌خاطر TTL منقضی شود و job B قفل را بگیرد، پایان job A قفلِ **B** را حذف می‌کند → نقض mutual-exclusion. راه‌حل: token تصادفی هنگام قفل + آزادسازی شرطی با Lua (compare-and-del). **اولویت بالا** → استپ ۵.۵
- **[C6] استفاده از `redis.keys('lock:user:*')`** — در `getLockedUserCount` (و احتمالاً جاهای دیگر) `KEYS` blocking است و در production ضدالگوست؛ باید با شمارنده/`SCAN` جایگزین شود. → استپ ۵.۵

### دسته D — کمبودها / نبود قابلیت

- **[D1] هیچ رابط کاربری (UI) وجود ندارد** — پروژه فقط API است. کاربر صریحاً UI خواسته. باید یک داشبورد وب ساده ساخته شود (ساخت/اجرا/مانیتور جاب‌ها، Quota، زمان‌بندی‌ها). → استپ‌های ۷ و ۸
- **[D2] فقدان مستندات** — نه `README`, نه مستند API. → استپ ۳
- **[D3] فقدان تست** — هیچ تست واحد/یکپارچه‌ای نیست. → استپ ۹
- **[D4] فقدان Dockerfile / docker-compose** — برای استقرار Node-base/Linux لازم است. → استپ ۴
- **[D5] فقدان healthcheck استاندارد و آماده‌ی k8s/compose** — بررسی شود. → استپ ۴

### دسته E — شکاف‌ها نسبت به Automa (از مقایسه)

- **[E1] فقدان ادیتور Flow بصری** — Automa drag-and-drop دارد، ما فقط JSON. ساخت visual flow builder بعد از UI پایه. → استپ ۱۰
- **[E2] تعداد کم بلوک/اکشن** — Automa ~۵۰+ بلوک دارد. افزودن اکشن‌های پرکاربرد: Export داده، Cookie، Clipboard، Loop Elements/Data، Regex/Slice/Sort variable، Notification، JavaScript Code، Dialog handler. → استپ ۱۱
- **[E3] فقدان export داده به فرمت‌های جدول** — CSV/JSON/xlsx. → استپ ۱۱
- **[E4] فقدان Triggerهای متنوع** — فقط `/run` و cron. (اولویت پایین — backlog)
- **[E5] فقدان Marketplace/اشتراک workflow** — (اولویت پایین — backlog)

### دسته F — دو نکته‌ی کلیدی صاحب پروژه (جلسه‌ی ۲)

- **[F1] فقدان تعامل بصری با مرورگر** — کاربر مرورگر را نمی‌بیند و سلکتورها را دستی می‌نویسد. نیاز به Live Browser View + Element Picker. → استپ ۱۲
- **[F2] فقدان افزونه‌ی کمکی مرورگر** — برای انتخاب سلکتور/ضبط اکشن از مرورگر واقعی کاربر، مثل Automa. → استپ ۱۳
- **[F3] API ناکافی برای n8n** — نبود حالت sync، نبود OpenAPI، نبود HMAC، نبود idempotency. → استپ ۱۴
- **[F4] فقدان n8n Community Node** — برای ادغام بومی با n8n. → استپ ۱۵
- **[F5] فقدان CORS صریح** — برای صدا زدن از UI/n8n با origin متفاوت. → استپ ۷

### دسته G — معماری مرجع (جلسه‌ی ۲ — از توضیح صاحب پروژه)

- **[G1] «مسیر زنده» فقط ابتدایی است** — الان فقط poll `liveStatus` ساده. باید کانال زنده‌ی استاندارد (WebSocket/SSE) با رویدادهای `log/step.start/step.done/step.error/job.done` ساخته شود تا کاربر باگ اتوماسیون را لحظه‌به‌لحظه ببیند. → **استپ ۱۶** (پایه‌ی استپ ۱۲)
- **[G2] فقدان Workflow Storage مستقل** — فقط نتیجه‌ی job ذخیره می‌شود، نه خودِ workflowها برای ذخیره/بازاجرا/نسخه‌بندی/مدیریت از هر کلاینت. → **استپ ۱۷**
- **[G3] قرارداد client-agnostic رسمی نیست** — فرمت‌ها پراکنده؛ نیاز به اسکیمای واحد workflow + OpenAPI تا افزونه/n8n/UI/کلاینت آینده همه یکسان وصل شوند. → استپ ۱۴ (+ اسکیما در استپ ۶ Zod)

### دسته H — مدل استقرار Self-Hosted (جلسه‌ی ۲)

- **[H1] پیچیدگی غیرضروری multi-tenant در مدل self-hosted** — ~۱۲۰۰ خط VIP/Quota/Plan/Admin که در تک‌کاربره لازم نیست. باید با `DEPLOYMENT_MODE=single` خاموش‌شدنی شود (نه حذف). → استپ ۱۸
- **[H2] پیش‌فرض‌های ناامن برای نصب پابلیک** — `ADMIN_SECRET=change_me`، API Key دستی. باید توکن تصادفی خودکار + هشدارهای امنیتی نصب. → استپ ۱۸ + استپ ۳ (README امنیتی)
- **[H3] نصب پیچیده برای کاربر عادی جامعه** — باید «نصب ۵ دقیقه‌ای کنار n8n» با docker-compose واحد (app + redis) باشد. → استپ ۴ (compose) + استپ ۳ (docs)

---

## ✅ استپ‌ها

- [x] **استپ ۱ — بازیابی، پاک‌سازی و آپلود اولیه به GitHub** ✅ 2026-06-04
  1. استخراج پروژه از بکاپ و انتقال به مخزن کاری ✅
  2. حذف `node_modules` ویندوزی و نصب مجدد روی Linux ✅
  3. نوشتن `.gitignore` کامل (env، Redis، profiles، logs، dist) ✅
  4. ساخت `.env.example` امن (بدون secret) ✅
  5. ساخت `PLAN.md` با آنالیز کامل باگ‌ها ✅
  6. commit و push اولیه‌ی کل پروژه به GitHub ✅

- [x] **استپ ۲ — رفع ۹ خطای کامپایل TypeScript (دسته A)** ✅ 2026-06-04
  1. ✅ رفع [A1] حروف بزرگ مسیر import (`./routes` → `./Routes`)
  2. ✅ افزودن کلیدهای گمشده `UPLOADS_DIR`/`DOWNLOADS_DIR` به config [A2]
  3. ✅ [A3] فیلد `redis: connection` بلااستفاده بود → از فراخوانی `runPipeline` در `index.ts` حذف شد (داخل `pipeline.ts` اصلاً استفاده نمی‌شد)
  4. ✅ ارتقای `tsconfig` به `target: ES2021` + `lib: ["ES2021","DOM","DOM.Iterable"]` برای `WeakRef` [A4]
  5. ✅ رفع `new Date(undefined)` در `user.routes.ts:199,244` با گارد `?` [A5] و `any` ضمنی `(e: any)` در `pipeline.ts:525` [A6]
  6. ✅ build سبز: `npx tsc --noEmit` → 0 خطا، `npm run build` → خروجی `dist/` تولید شد
  - ⚠️ **نکته‌ی مهم کشف‌شده حین کار:** افزودن صریح `lib` در tsconfig، DOM پیش‌فرض را حذف کرد و ~۳۰ خطای `Cannot find name 'document/window/HTMLElement'` در `page.evaluate()` ایجاد شد (کد سمت مرورگر Playwright). حل: افزودن `"DOM"` و `"DOM.Iterable"` به آرایه‌ی `lib`.

- [x] **استپ ۳ — سازگارسازی با Node-base/Linux + مستندات (دسته B + D2)** ✅ 2026-06-04
  1. ✅ [B1] `CHROME_EXE` خالی‌by‌default → استفاده از Chromium بسته‌بندی‌شده‌ی Playwright (Node-base). مسیر سیستمی فقط در صورت ست‌بودن env اعمال می‌شود؛ به هر دو محل launch (`GlobalBrowser.ts`, `pipeline.ts`) به‌صورت اختیاری `executablePath` تزریق شد. (کشف: قبلاً `CHROME_EXE` تعریف ولی هیچ‌جا استفاده نمی‌شد و پیش‌فرض ویندوزی گمراه‌کننده بود.)
  2. ✅ [B3] `postinstall` امن/قابل‌skip شد: با `SKIP_BROWSER_INSTALL=1` رد می‌شود و خطای دانلود مرورگر non-fatal است؛ اسکریپت‌های صریح `install:browser` و `install:browser:deps` اضافه شد.
  3. ✅ [B2] هیچ ارجاع Windows-Redis در سورس نبود؛ `Redis/` از قبل gitignore شده و `REDIS_URL` env-driven است. راهنمای نصب Redis روی Linux (apt + Docker) به README اضافه شد.
  4. ✅ README کامل شد (نصب، Redis، مرورگر bundled، skip browser، متغیرها + ردیف `CHROME_EXE`، لینک API).
  5. ✅ `docs/API.md` نوشته شد (همه‌ی endpointهای health/user/admin + احراز هویت `x-api-key`/`x-admin-token` + کدهای وضعیت).
  - ✅ تأیید: `npx tsc --noEmit` → 0 خطا؛ گارد postinstall تست شد.

- [x] **استپ ۴ — استقرار Node-base: Docker + Compose (دسته D4/D5)** ✅ 2026-06-04
  1. ✅ `Dockerfile` چندمرحله‌ای: stage build (npm install --ignore-scripts + tsc + prune) و stage runtime روی image رسمی `mcr.microsoft.com/playwright:v1.56.1-jammy` (مرورگر + deps سیستمی bundled). `.dockerignore` هم اضافه شد.
  2. ✅ `docker-compose.yml`: سرویس `app` + `redis:7-alpine` با volume پایدار، `depends_on` با شرط `service_healthy`، و override خودکار `REDIS_URL=redis://redis:6379`. پوشه‌های logs/profiles/uploads/downloads به‌صورت bind-mount پایدار.
  3. ✅ `healthcheck` در هر دو (Dockerfile + compose) روی مسیر `/health` موجود؛ منطق one-liner تست شد (status 200 → exit 0).
  4. ⚠️ تست build واقعی container در sandbox ممکن نبود (Docker در محیط نصب نیست). به‌جای آن اعتبارسنجی استاتیک شد: compose YAML معتبر، `package-lock.json` موجود برای COPY، `npm run build` سبز، و healthcheck cmd تست شد. → **تست end-to-end container روی ماشین کاربر باید انجام شود** (در README مستند شد).
  5. ✅ بخش «اجرا با Docker» به README اضافه شد (compose up/down، docker build/run، توضیح volumeها و healthcheck).

- [x] **استپ ۵ — رفع باگ‌های منطقی/Race (دسته C)** ✅ 2026-06-04
  1. ✅ [C1] worker `sadd` به‌عنوان نقطه‌ی ثبت معتبر برای جاب‌های scheduled مستندسازی شد (idempotent؛ تنها نقطه‌ی removal در `finally{}`). [C2] `thisJobNumber` حالا از `scard` **بعد از** `sadd` گرفته می‌شود → حذف race خواندن‌قبل‌از‌نوشتن در `/run` همزمان.
  2. ✅ [C3] `unhandledRejection` با `uncaughtException` هماهنگ شد: هر دو `shutdown()` graceful را صدا می‌زنند (idempotent؛ supervisor/Docker نمونه‌ی تمیز بالا می‌آورد).
  3. ⚠️ بازبینی قفل‌گذاری → دو باگ جدی کشف شد ([C5] آزادسازی ناامن قفل، [C6] استفاده از `KEYS`). طبق قانون کاری، inline اصلاح نشد؛ در PLAN ثبت و **استپ ۵.۵ با اولویت بالا** پیش از استپ ۶ اضافه شد.
  4. ✅ تأیید: `npx tsc --noEmit` سبز. تست دستی end-to-end نیازمند Redis زنده است (در استپ ۵.۵ همراه با اصلاح قفل انجام می‌شود).

- [x] **استپ ۵.۵ — 🔴 رفع باگ قفل توزیع‌شده‌ی ناامن + حذف `KEYS` (اولویت بالا) (دسته C5/C6)** ✅ 2026-06-04
  1. ✅ [C5] `tryLockUser` حالا `randomUUID()` به‌عنوان مقدار قفل ذخیره می‌کند و token را برمی‌گرداند (یا `null`). در worker، `lockToken` نگه‌داری و به هر دو محل آزادسازی پاس داده می‌شود.
  2. ✅ [C5] `unlockUser(redis, userId, token)` آزادسازی شرطی با Lua (`compare-and-del`): فقط اگر مقدار قفل == token خودش باشد حذف می‌کند؛ بدون token هیچ DELای نمی‌زند. → نقض mutual-exclusion رفع شد.
  3. ✅ [C6] helper مشترک `scanKeys` در `utils/redis-keys.ts` اضافه شد (SCAN غیرمسدودکننده) و همه‌ی `KEYS`ها جایگزین شدند: `ProfileManager.getLockedUserCount`, `admin.routes.ts` (۴ مورد), `UserManager.ts` (۲ مورد).
  4. ✅ تست همزمانی با **Redis زنده** نوشته و اجرا شد (۷ سناریو، همه PASS) — مهم‌ترین: سناریوی ۴ اثبات کرد unlock کهنه دیگر قفل تازه‌ی جاب دیگر را نمی‌دزدد. `tsc` و `npm run build` سبز. (آرتیفکت `dump.rdb` به gitignore اضافه شد.)

- [x] **استپ ۶ — یکپارچه‌سازی Validation با Zod (دسته C4)** ✅ 2026-06-04
  1. ✅ `src/schemas.ts` ساخته شد: `runBodySchema` و `scheduleBodySchema` (envelope: userId, steps غیرخالی، headless loose، webhookUrl معتبر، cron با ۵–۶ فیلد) + helperهای `parseBody` و `formatZodError`.
  2. ✅ هر دو route `/run` و `/schedule` حالا اول با Zod (`parseBody`) اعتبارسنجی envelope را انجام می‌دهند؛ سپس درخت عمیق `steps` همچنان با `validateSteps` سخت‌شده‌ی موجود (legacy format، اندازه، nested if/while/try/switch) sanitize می‌شود. **استراتژی:** Zod برای shape و خطای یکدست، منطق recursive قدیمی برای عمق — بدون شکستن کد battle-tested.
  3. ✅ پیام‌های خطا یکدست شد: قالب واحد `{ success:false, error, details:[{path,message}] }` با کد ۴۰۰.
  4. ✅ تست ورودی‌های نامعتبر: ۱۰ سناریو (userId گمشده/عددی، steps خالی/غیرآرایه، webhookUrl بد، cron خالی/۳-فیلدی/۶-فیلدی) همه PASS. `tsc` و `npm run build` سبز.

- [ ] **استپ ۷ — رابط کاربری (UI) — بخش ۱: ساختار و احراز هویت (دسته D1)**
  1. ساخت پوشه `public/` و سرو static از Express
  2. صفحه‌ی ورود با API Key (ذخیره در localStorage)
  3. طرح‌بندی داشبورد (sidebar + header) با CSS مدرن RTL/LTR
  4. اتصال به endpointهای سلامت و نمایش وضعیت سیستم

- [ ] **استپ ۸ — رابط کاربری (UI) — بخش ۲: ساخت/اجرا/مانیتور جاب (دسته D1)**
  1. فرم ساخت Flow (افزودن step، action، params)
  2. ارسال به `/run` و نمایش `jobId`
  3. صفحه‌ی مانیتور: poll کردن `/job/:id` و نمایش خروجی stepها
  4. صفحه‌ی Quota و لیست/حذف Scheduleها
  5. پنل ادمین ساده (در صورت ورود با admin secret)

- [ ] **استپ ۹ — تست و پایدارسازی (دسته D3)**
  1. افزودن `vitest`/`jest` و تست واحد برای `validation`, `helpers`, `ConditionEngine`
  2. تست یکپارچه‌ی مسیرهای API با mock Redis
  3. اجرای lint/type-check در یک اسکریپت `npm run check`
  4. به‌روزرسانی README با نحوه‌ی اجرای تست

- [ ] **استپ ۱۰ — ادیتور Flow بصری (پر کردن شکاف اصلی با Automa) (دسته E1)**
  1. افزودن کتابخانه‌ی flow بصری به UI (drag-and-drop نودها) — الهام از Vue Flow
  2. تبدیل دوطرفه بین گراف بصری ↔ JSON steps موجود
  3. پنل تنظیمات هر نود (params اکشن‌ها به‌صورت فرم)
  4. ذخیره/بارگذاری workflow (localStorage یا endpoint)
  5. اجرای مستقیم workflow از ادیتور و نمایش نتیجه

- [ ] **استپ ۱۱ — افزایش بلوک‌ها/اکشن‌ها به‌سبک Automa (دسته E2/E3)**
  1. افزودن اکشن Export داده (CSV/JSON) [E3]
  2. افزودن Cookie get/set و Clipboard
  3. افزودن Loop Elements / Loop Data و breakpoint
  4. افزودن دستکاری متغیر: Regex / Slice / Sort
  5. افزودن Notification و Dialog handler
  6. مستندسازی همه‌ی اکشن‌ها در `docs/API.md`

- [ ] **استپ ۱۲ — Live Browser View + Element Picker (نکته ۱ صاحب پروژه — راهکار A) (دسته F1)** _(وابسته به استپ ۱۶)_
  1. راه‌اندازی WebSocket server امن (با auth) برای استریم مرورگر
  2. استریم زنده‌ی صفحه با CDP Screencast به UI (canvas)
  3. ارسال کلیک/تایپ کاربر از UI به مرورگر سروری (تعامل دوطرفه)
  4. Element Picker: کلیک روی عنصر → تولید خودکار سلکتور CSS/XPath
  5. درج خودکار سلکتور انتخاب‌شده در step مربوطه در UI
  6. باز کردن `connect-src`/`ws` در CSP و مدیریت طول عمر مرورگر session

- [ ] **استپ ۱۳ — افزونه‌ی کمکی Chrome (نکته ۱ صاحب پروژه — راهکار B) (دسته F2)**
  1. ساخت اسکلت افزونه (manifest v3) در پوشه‌ی `extension/`
  2. Element Picker روی مرورگر واقعی کاربر (content script)
  3. ضبط اکشن‌ها (کلیک/تایپ/ناوبری) و تبدیل به steps
  4. ارسال امن به backend با API Key
  5. مستند نصب و استفاده

- [ ] **استپ ۱۴ — بهبود API برای ادغام n8n (نکته ۲ صاحب پروژه) (دسته F3/F5)**
  1. افزودن حالت sync: `POST /run?wait=true` (صبر تا پایان + بازگشت نتیجه)
  2. افزودن HMAC signature به webhook خروجی + هدر `X-Signature`
  3. افزودن Idempotency-Key روی `/run`
  4. نوشتن `docs/openapi.yaml` (Swagger) برای همه‌ی endpointها
  5. افزودن CORS کنترل‌شده [F5] و rate limit برای endpointهای جدید

- [ ] **استپ ۱۵ — n8n Community Node (نکته ۲ صاحب پروژه) (دسته F4)**
  1. ساخت پکیج `n8n-nodes-automationbackend` (ساختار استاندارد n8n)
  2. عملیات‌ها: Run Workflow / Get Job Result / Create Schedule / Cancel Job
  3. Trigger node برای دریافت webhookهای ما (با تأیید HMAC)
  4. Credentials = API Key + Base URL
  5. مستند نصب در n8n + نمونه‌ی workflow

- [ ] **استپ ۱۶ — کانال زنده‌ی استاندارد (Live Channel) — قلب «مسیر زنده» (دسته G1)**
  1. تعریف رویدادهای استاندارد: `log`, `step.start`, `step.done`, `step.error`, `job.done`
  2. انتشار رویدادها از داخل pipeline حین اجرای هر step (event emitter)
  3. کانال تحویل: WebSocket (`ws` موجود) + fallback به SSE برای کلاینت‌های ساده
  4. احراز هویت کانال با API Key + محدودسازی به owner همان job
  5. بافر کوتاه رویدادها در Redis تا کلاینت دیرتر هم بتواند آخرین وضعیت را بگیرد
  6. تست: subscribe از UI و دیدن لاگ زنده‌ی یک job نمونه

- [ ] **استپ ۱۷ — Workflow Storage (ذخیره/بازاجرا/مدیریت workflow) (دسته G2)**
  1. مدل ذخیره‌سازی workflow در Redis (id, userId, name, steps, نسخه, زمان)
  2. CRUD endpoint: `POST/GET/PUT/DELETE /workflows`
  3. اجرای workflow ذخیره‌شده با `POST /workflows/:id/run`
  4. نسخه‌بندی ساده (history) و تعلق به کاربر (auth)
  5. مستند + هم‌راستا کردن افزونه/n8n/UI با همین storage

- [ ] **استپ ۱۸ — حالت Self-Hosted تک‌کاربره (`DEPLOYMENT_MODE`) (دسته H) — اولویت بالا**
  1. افزودن `DEPLOYMENT_MODE` (`single`/`multi`) به config با پیش‌فرض `single`
  2. در حالت `single`: خاموش‌کردن Quota/VIP/Plan/Level (همه full-access، مرورگر persistent)
  3. در حالت `single`: یک `API_TOKEN` ساده (تولید تصادفی خودکار اگر تنظیم نشده) به‌جای سیستم چندکاربره
  4. مخفی/غیرفعال‌کردن endpointهای admin مدیریت کاربر در حالت `single`
  5. rate-limit سبک پیش‌فرض + هشدارهای امنیتی نصب
  6. تست هر دو حالت + مستندسازی در README

---

## 📝 یادداشت‌ها

- محیط فعلی sandbox **Redis ندارد**؛ تست‌های نیازمند Redis ممکن است نیاز به نصب محلی Redis (لینوکسی) داشته باشند — در استپ مربوطه نصب می‌شود.
- secret واقعی در `.env` نسخه‌ی بکاپ یافت نشد (مقادیر placeholder بودند)، اما `.env` همچنان gitignore شد تا اشتباهی push نشود.
- **ترتیب اجرای پیشنهادی (به‌روز با تصمیم self-hosted):**
  1. پایه‌ای: **کامپایل سبز** (۲) → **حالت Self-Hosted (۱۸)** → **Node-base/Linux** (۳) → **Docker تک‌فرمانه (۴)**
  2. زیرساخت معماری مرجع: **کانال زنده (۱۶)** → **Workflow Storage (۱۷)**
  3. دو نکته‌ی صاحب پروژه:
     - **n8n:** بهبود API + قرارداد client-agnostic (۱۴) → n8n Node (۱۵)
     - **تعامل با مرورگر:** UI پایه (۷-۸) → Live View + Picker (۱۲، روی ۱۶) → افزونه (۱۳)
  4. تکمیلی: باگ‌های منطقی (۵) → Zod (۶) → ادیتور بصری (۱۰) → بلوک‌های بیشتر (۱۱) → تست (۹)
- **چرا استپ ۱۸ زود؟** چون مدل تک‌کاربره/چندکاربره روی auth، quota، routes و UI تأثیر می‌گذارد؛ بهتر است قبل از ساخت UI و n8n تثبیت شود تا دوباره‌کاری نشود.
- **استراتژی نسبت به Automa:** کلون نمی‌کنیم؛ مزیت ما سروری/چندکاربره/SaaS است. شکاف‌های کلیدی (UI بصری، تعامل مرورگر مثل افزونه، تعداد بلوک) را پر می‌کنیم — جزئیات در بخش «⚔️ مقایسه با Automa» و «🎯 دو نکته‌ی کلیدی».
- **نکته‌ی فنی n8n:** بهترین تجربه‌ی کاربری با ترکیب «sync run + Trigger node» حاصل می‌شود؛ webhook بدون HMAC امن نیست.
- **نکته‌ی فنی Live View:** از `ws` موجود + CDP Screencast استفاده می‌کنیم؛ نیازی به وابستگی سنگین جدید نیست.
