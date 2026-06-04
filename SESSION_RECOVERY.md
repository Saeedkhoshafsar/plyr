# 🔄 SESSION RECOVERY — راهنمای ادامه‌ی کار در sandbox جدید

> این فایل برای **عامل/Agent جلسه‌ی بعدی** است. چون sandbox هر بار ریست می‌شود و **تنها بکاپ پروژه همین ریپوی گیت‌هاب است**، هر چیزی که برای ادامه لازم است اینجا و در `PLAN.md` ثبت شده. ابتدا این فایل، سپس `PLAN.md` را بخوان.

- **Repo:** https://github.com/Saeedkhoshafsar/plyr  (branch: `main`)
- **پروژه:** `automation-backend` — بک‌اند اتوماسیون مرورگر (Node.js + TypeScript)، رایگان/متن‌باز/**Self-Hosted**.
- **آخرین به‌روزرسانی این سند:** 2026-06-04 — پس از پایان استپ ۸.

---

## ۱) قوانین کاری (AGENT_RULES — خلاصه‌ی اجباری)

1. اول **`PLAN.md`** را بخوان؛ از **اولین استپ ناتمام (`[ ]`)** ادامه بده.
2. اختیار کامل، **بدون سؤال**. توضیح اضافه نده — فقط ابزار را صدا بزن و کار کن.
3. هر استپ شامل ۴–۶ تسک است. وقتی **وسط یک استپ به باگ پیچیده برخوردی، آن را inline حل نکن**؛ در `PLAN.md` یادداشت کن و یک استپ با اولویت بالا **پیش از** استپ بعدی اضافه کن (الگوی استپ ۵.۵ را ببین).
4. **در پایان هر استپ:** `PLAN.md` را آپدیت کن → commit + push به گیت‌هاب → یک گزارش ۳-خطی بده → سپس **منتظر بمان** تا کاربر بگوید «ادامه».
5. این فایل (`SESSION_RECOVERY.md`) را هم در پایان هر استپ به‌روز نگه دار (بخش «وضعیت فعلی»).

---

## ۲) راه‌اندازی sandbox جدید (Setup)

```bash
# 1) کلون (اگر از قبل نیست)
cd /home/user/webapp

# 2) نصب وابستگی‌ها بدون دانلود مرورگر (سریع‌تر؛ مرورگر در صورت نیاز جدا نصب می‌شود)
SKIP_BROWSER_INSTALL=1 npm install --ignore-scripts

# 3) فایل env
cp .env.example .env    # سپس API_KEYS و ADMIN_SECRET را پر کن

# 4) بررسی سلامت کامپایل (باید 0 خطا بدهد)
npx tsc --noEmit
npm run build
```

### Redis (برای تست‌های زنده‌ی صف/قفل لازم است)
```bash
sudo apt-get update && sudo apt-get install -y redis-server
redis-server --daemonize yes --port 6379
redis-cli ping     # باید PONG بدهد
# پاک‌سازی بعد از تست:  redis-cli flushall && redis-cli shutdown nosave
```

### مرورگر (فقط اگر اجرای واقعی pipeline لازم شد)
```bash
npm run install:browser        # = playwright install chromium
```

> ⚠️ **نکات محیطی مهم (از جلسات قبل):**
> - **Docker در sandbox نصب نیست** → نمی‌توان build واقعی container زد؛ فقط اعتبارسنجی استاتیک. تست end-to-end Docker روی ماشین کاربر.
> - `dump.rdb` آرتیفکت Redis است و **gitignore شده**؛ بعد از تست پاکش کن، commit نکن.
> - دانلود از لینک AI Drive با Cloudflare 403 می‌دهد → باید header `User-Agent` مرورگر به curl اضافه شود.

---

## ۳) ⚠️ نکته‌ی بحرانی فنی: خط‌پایان CRLF

تمام فایل‌های `src/**/*.ts`, `tsconfig.json`, `package.json`, `.env.example` با **CRLF (`\r\n`)** ذخیره شده‌اند (میراث ویندوز).
- ابزار `Edit` با مچ چندخطی **شکست می‌خورد** چون `\r` را نمی‌بیند.
- **روش مطمئن:** از یک اسکریپت Python با حالت باینری استفاده کن و `\r\n` را صریح در رشته‌ها بگذار:

```python
python3 - <<'PY'
p='src/FILE.ts'
with open(p,'rb') as f: d=f.read()
old=b"...line1\r\n...line2\r\n"
new=b"...new1\r\n...new2\r\n"
assert d.count(old)==1, d.count(old)   # همیشه یکتا بودن مچ را چک کن
open(p,'wb').write(d.replace(old,new))
print("OK")
PY
```
- فایل‌های markdown جدید (`PLAN.md`, `README.md`, `docs/*`, این فایل) **LF** هستند و با ابزار `Edit` کار می‌کنند.

---

## ۴) معماری در یک نگاه

- **Entry:** `src/index.ts` (Express + Helmet، صف BullMQ، worker، Lua، graceful shutdown، GC).
- **Config:** `src/config.ts` (env-driven؛ `cleanEnv`، `parsePlans`، `CHROME_EXE` خالی=Chromium باندل‌شده).
- **Pipeline اجرا:** `src/pipeline.ts` (`runPipeline`, Flow Engine: if/while/try/switch).
- **Routes:** `src/Routes/` → `user.routes.ts` (/me,/run,/schedule,/quota,/jobs,/job,/cancel)، `admin.routes.ts` (/admin/*)، `health.routes.ts` (/health). Mount: user/health روی `/`، admin روی `/admin`. **`/me`** = هویت صاحب کلید (بدون strict-binding) برای login UI.
- **UI (استپ ۷):** پوشه‌ی `public/` در **روت پروژه** (نه `src/`)؛ با `express.static(path.resolve(process.cwd(),'public'))` سرو می‌شود. فایل‌ها: `index.html`، `css/styles.css`، `js/i18n.js` (فارسی/انگلیسی + RTL/LTR)، `js/api.js` (`window.API`: کلید در localStorage `ab_api_key`، `validateKey`→`/me`)، `js/app.js` (login/router/theme/health + export `window.AppUtil`)، `js/views.js` (استپ ۸ — `window.Views`: run/jobs/jobDetail/quota/schedules/admin). **ترتیب لود مهم است:** i18n → api → views → app؛ `views.js` باید `AppUtil` را lazy (تابع `U()`) بخواند چون `app.js` بعداً آن را می‌سازد. همه‌ی فایل‌های `public/**` با **LF** هستند (با Edit کار می‌کنند).
- **CORS (F5):** middleware صریح در `index.ts` با `config.CORS_ALLOWED_ORIGINS` (env کاما-جدا؛ `*` = هرجا بدون credentials؛ خالی = same-origin). CSP در helmet با `scriptSrc:'self'`/`connectSrc:'self'` ⇒ **JS باید خارجی باشد (نه inline)**.
- **Core:** `ProfileManager` (مرورگر/قفل کاربر)، `GlobalBrowser` (مرورگر مشترک Free)، `QuotaManager`، `UserManager`.
- **Validation:** `src/validation.ts` (sanitize عمیق steps) + `src/schemas.ts` (Zod envelope — استپ ۶).
- **Auth:** کاربر `x-api-key`، ادمین `x-admin-token`.
- **مدل استقرار:** پیش‌فرض **single (self-hosted تک‌کاربره)**؛ حالت `multi`/SaaS بعداً (استپ ۱۸).
- معماری مرجع کامل + مقایسه با Automa + ۲ نیاز صاحب پروژه (مرورگر تعاملی + ادغام n8n) + «مسیر زنده» همگی در بالای `PLAN.md`.

---

## ۵) وضعیت فعلی (به‌روز در پایان هر استپ)

**استپ‌های تمام‌شده:** ۱، ۲، ۳، ۴، ۵، ۵.۵، ۶، ۷، ۸، ۹، ۱۰ ✅

**استپ بعدی برای شروع:** **استپ ۱۱ — افزایش بلوک‌ها/اکشن‌های جدید به‌سبک Automa (دسته E2/E3)** (اکشن‌های بیشتر در کاتالوگ `ACTIONS` — مثل condition/loop/keyboard/upload/select-option/get-attribute/wait-for-selector — هم در فرم خطی استپ ۸ و هم در نودهای ادیتور استپ ۱۰؛ و افزودن نودهای کنترل‌جریان (شاخه/حلقه) به ادیتور با چند پورت خروجی).

> 🧭 **برای استپ ۱۱ آماده است:** ادیتور node-based (استپ ۱۰) و فرم خطی (استپ ۸) هر دو از **یک کاتالوگ `ACTIONS` مشترک از نظر مفهومی** استفاده می‌کنند — ولی **دو کپی جدا** دارند: یکی در `public/js/views.js` (فرم خطی) و یکی در `public/js/flow-editor.js` (نودها). برای استپ ۱۱ هر اکشن جدید را باید **در هر دو** اضافه کرد (یا کاتالوگ را به یک ماژول مشترک منتقل کرد — توصیه می‌شود). فرمت هر اکشن: `{ id, icon?, fields:[{k,label,type,ph?,options?}] }`؛ بک‌اند `{action, params}` می‌گیرد — مطمئن شو هر اکشن جدید در pipeline اجرای بک‌اند (`src/`) هم پشتیبانی می‌شود وگرنه فقط UI است. نودهای کنترل‌جریان نیاز به چند پورت خروجی دارند (ادیتور فعلاً تک‌پورت/زنجیره‌ای است؛ `toSteps()` خطی است). همه‌ی `public/**` و `tests/**` و `*.config.ts` **LF**؛ `src/**/*.ts` و `package.json` **CRLF**.

**خلاصه‌ی کارهای انجام‌شده‌ی کلیدی:**
- استپ ۲: ۹ خطای TS رفع شد (import casing، UPLOADS/DOWNLOADS_DIR، redis param، ES2021+DOM lib، new Date guard، implicit any).
- استپ ۳: `CHROME_EXE` خالی=Chromium باندل، postinstall امن/skippable، README + `docs/API.md`.
- استپ ۴: `Dockerfile` (multi-stage روی playwright image)، `docker-compose.yml` (app+redis)، healthcheck `/health`.
- استپ ۵: race مدیریت active jobs ([C2] `scard` بعد از `sadd`)، هماهنگی `unhandledRejection`/`uncaughtException`.
- استپ ۵.۵: **قفل توزیع‌شده‌ی امن** (token + Lua compare-and-del در `ProfileManager`)، حذف همه‌ی `KEYS` با `scanKeys` (SCAN). تست زنده ۷ سناریو PASS.
- استپ ۶: لایه‌ی Zod (`src/schemas.ts`) برای `/run` و `/schedule`، خطای یکدست؛ تست ۱۰ سناریو PASS.
- استپ ۷: UI بخش ۱ — `public/` + static serving، login با API Key (localStorage `ab_api_key` + `GET /me`)، shell داشبورد (sidebar/topbar) RTL/LTR + i18n، اتصال به `/health`، **CORS صریح [F5]**. e2e Playwright PASS.
- استپ ۸: UI بخش ۲ — `public/js/views.js` (`window.Views`): flow builder (`ACTIONS` catalog) → `POST /run`، صفحه‌ی jobs + job detail (poll)، Quota، Schedules (list/delete)، پنل admin (`x-admin-token` → `/admin/stats`). **باگ lazy `AppUtil`:** `views.js` قبل از `app.js` لود می‌شود پس `U()` به صورت lazy resolve شد. e2e Playwright بدون خطای console PASS.
- استپ ۹: **تست و پایدارسازی (D3)** — `vitest`+`supertest`؛ `tests/unit/` (helpers ۱۴، validation ۲۲ شامل SSRF، condition-engine ۱۹ شامل regex امن، schemas ۱۲) + `tests/integration/api.test.ts` (۱۴) روی اپ Express سبک با میدل‌ورهای واقعی auth/admin بدون Redis. اسکریپت‌های `test`/`test:watch`/`check`. **`npm test` → ۸۱ تست سبز**، `npm run check` سبز. عمداً `src/index.ts` import نشد (side-effect `startServer()`).
- استپ ۱۰: **ادیتور Flow بصری node-based (الهام از Automa)** — `public/js/flow-editor.js` (`window.FlowEditor`): بوم SVG + کارت‌های HTML، drag نودها، اتصال پورت out→in، pan/zoom، حذف نود/لبه، inspector params، save/load/clear در localStorage، اجرای مستقیم `POST /run`، تبدیل دوطرفه گراف↔`steps[]`. ادغام: nav/route `editor`، اسکریپت در index.html (i18n→api→flow-editor→views→app)، کلیدهای `fe.*` (fa+en)، CSS. e2e Playwright: add→connect(start→goto→click)→JSON(۲ step)→save/load→**run(Job ID:1)**؛ بدون خطای console.

**باگ‌های ثبت‌شده که هنوز باز/بعداً:** بخش «دسته‌ها» در `PLAN.md` را ببین. (دسته‌های D–H در استپ‌های ۷+ پوشش داده می‌شوند.)

---

## ۶) چک‌لیست پایان هر استپ (کپی-پیست)

```text
[ ] کد تغییر کرد و تست/typecheck سبز است (npx tsc --noEmit)
[ ] اگر باگ پیچیده‌ی جدید دیدی: در PLAN.md ثبت + استپ اولویت‌دار اضافه شد
[ ] PLAN.md: استپ فعلی [x] و تاریخ خورد
[ ] SESSION_RECOVERY.md بخش «وضعیت فعلی» به‌روز شد
[ ] git add -A && commit پیام واضح && git push origin main
[ ] گزارش ۳-خطی + لینک ریپو داده شد
[ ] منتظر «ادامه» ماند
```
