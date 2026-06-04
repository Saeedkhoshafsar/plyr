# 📋 PLAN.md — بازیابی و تکمیل پروژه `automation-backend-v37`

> این فایل نقشه‌ی راه پروژه است. در هر جلسه **اول این فایل را بخوان**، ببین کدام استپ‌ها `[x]` خورده‌اند، و از **اولین استپ ناتمام** شروع کن.

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
ما نباید کلون Automa شویم؛ مزیت ما **سروری/چندکاربره/SaaS** است. اما باید دو شکاف کلیدی را پر کنیم:
1. **رابط کاربری بصری** (الهام از Vue Flow Automa) — استپ‌های ۷، ۸، ۱۰
2. **افزایش تعداد بلوک‌ها/اکشن‌ها** به‌سبک Automa (Export داده، Loop، Regex، Cookie و...) — استپ ۱۱

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

---

## ✅ استپ‌ها

- [x] **استپ ۱ — بازیابی، پاک‌سازی و آپلود اولیه به GitHub** ✅ 2026-06-04
  1. استخراج پروژه از بکاپ و انتقال به مخزن کاری ✅
  2. حذف `node_modules` ویندوزی و نصب مجدد روی Linux ✅
  3. نوشتن `.gitignore` کامل (env، Redis، profiles، logs، dist) ✅
  4. ساخت `.env.example` امن (بدون secret) ✅
  5. ساخت `PLAN.md` با آنالیز کامل باگ‌ها ✅
  6. commit و push اولیه‌ی کل پروژه به GitHub ✅

- [ ] **استپ ۲ — رفع ۹ خطای کامپایل TypeScript (دسته A)**
  1. رفع [A1] حروف بزرگ مسیر import (`./Routes`)
  2. افزودن کلیدهای گمشده `UPLOADS_DIR`/`DOWNLOADS_DIR` به config [A2]
  3. هماهنگ‌کردن امضای `runPipeline` با فیلد `redis` [A3]
  4. ارتقای `tsconfig` به `ES2021`+`lib` برای `WeakRef` [A4]
  5. رفع `new Date(undefined)` در schedule routes [A5] و `any` ضمنی [A6]
  6. تأیید build سبز با `npx tsc --noEmit` و `npm run build`

- [ ] **استپ ۳ — سازگارسازی با Node-base/Linux + مستندات (دسته B + D2)**
  1. اصلاح تشخیص خودکار `CHROME_EXE` برای Linux/Playwright bundled [B1]
  2. امن‌کردن `postinstall` (اختیاری/قابل skip) [B3]
  3. مستندسازی نصب Redis روی Linux + حذف وابستگی به `Redis/` ویندوزی [B2]
  4. نوشتن `README.md` کامل (نصب، اجرا، متغیرها)
  5. نوشتن `docs/API.md` (همه‌ی endpointها)

- [ ] **استپ ۴ — استقرار Node-base: Docker + Compose (دسته D4/D5)**
  1. نوشتن `Dockerfile` چندمرحله‌ای (build + runtime با Playwright)
  2. نوشتن `docker-compose.yml` (app + redis)
  3. افزودن `healthcheck` به compose و route سلامت
  4. تست build و اجرای محلی container
  5. مستندسازی اجرا در README

- [ ] **استپ ۵ — رفع باگ‌های منطقی/Race (دسته C)**
  1. یکپارچه‌سازی مدیریت active jobs set [C1][C2]
  2. هماهنگ‌کردن سیاست `unhandledRejection`/`uncaughtException` [C3]
  3. بازبینی قفل‌گذاری کاربر و Lua scripts
  4. تست دستی مسیرهای `/run`, `/cancel`, `/job`

- [ ] **استپ ۶ — یکپارچه‌سازی Validation با Zod (دسته C4)**
  1. تعریف schemaهای Zod برای `/run` و `/schedule`
  2. جایگزینی validation دستی با Zod در routeها
  3. پیام‌های خطای یکدست
  4. تست ورودی‌های نامعتبر

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

---

## 📝 یادداشت‌ها

- محیط فعلی sandbox **Redis ندارد**؛ تست‌های نیازمند Redis ممکن است نیاز به نصب محلی Redis (لینوکسی) داشته باشند — در استپ مربوطه نصب می‌شود.
- secret واقعی در `.env` نسخه‌ی بکاپ یافت نشد (مقادیر placeholder بودند)، اما `.env` همچنان gitignore شد تا اشتباهی push نشود.
- اولویت: ابتدا **کامپایل سبز** (استپ ۲)، سپس **اجرای Node-base** (۳-۴)، سپس **UI پایه** (۷-۸)، سپس **ادیتور بصری + بلوک‌های بیشتر** (۱۰-۱۱) برای پر کردن شکاف با Automa.
- **استراتژی نسبت به Automa:** کلون نمی‌کنیم؛ مزیت ما سروری/چندکاربره/SaaS است. فقط دو شکاف کلیدی (UI بصری + تعداد بلوک) را پر می‌کنیم — جزئیات در بخش «⚔️ مقایسه با Automa».
