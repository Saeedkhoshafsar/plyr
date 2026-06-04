# 🔄 SESSION RECOVERY — راهنمای ادامه‌ی کار در sandbox جدید

> این فایل برای **عامل/Agent جلسه‌ی بعدی** است. چون sandbox هر بار ریست می‌شود و **تنها بکاپ پروژه همین ریپوی گیت‌هاب است**، هر چیزی که برای ادامه لازم است اینجا و در `PLAN.md` ثبت شده. ابتدا این فایل، سپس `PLAN.md` را بخوان.

- **Repo:** https://github.com/Saeedkhoshafsar/plyr  (branch: `main`)
- **پروژه:** `automation-backend` — بک‌اند اتوماسیون مرورگر (Node.js + TypeScript)، رایگان/متن‌باز/**Self-Hosted**.
- **آخرین به‌روزرسانی این سند:** 2026-06-04 — پس از پایان استپ ۱۳ (افزونه‌ی کمکی Chrome — Manifest V3).

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
- فایل‌های markdown جدید (`PLAN.md`, `README.md`, `docs/*`, این فایل)، و نیز همه‌ی `public/**`, `tests/**`, `*.config.ts`, و **`extension/**`** (افزونه‌ی استپ ۱۳) **LF** هستند و با ابزار `Edit` کار می‌کنند. فقط `src/**/*.ts`, `package.json`, `.env.example` **CRLF**اند (باید با اسکریپت پایتونِ binary-mode ویرایش شوند).

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

**استپ‌های تمام‌شده:** ۱، ۲، ۳، ۴، ۵، ۵.۵، ۶، ۷، ۸، ۹، ۱۰، ۱۱، ۱۲، ۱۳، ۱۶ ✅ _(استپ ۱۶ زودتر از ۱۲ انجام شد چون استپ ۱۲ به آن وابسته بود — طبق AGENT_RULE 3)_

**استپ بعدی برای شروع:** **استپ ۱۴ — بهبود API برای ادغام n8n (نکته ۲ صاحب پروژه) (دسته F3/F5)** — افزودن حالت sync `POST /run?wait=true` (صبر تا پایان + بازگشت نتیجه)، افزودن HMAC signature به webhook خروجی + هدر `X-Signature`، افزودن `Idempotency-Key` روی `/run`، نوشتن `docs/openapi.yaml` (Swagger) برای همه‌ی endpointها، و افزودن CORS کنترل‌شده [F5] + rate limit برای endpointهای جدید. ⚠️ نکته: `CORS_ALLOWED_ORIGINS` فعلاً در `.env`/`.env.example` خالی است (preflight=204 ولی بدون هدر `Access-Control-Allow-Origin`)؛ منطق CORS در `src/index.ts` خطوط ~۷۴–۹۶ است. افزونه‌ی استپ ۱۳ به‌خاطر fetch از داخل service worker مستقل از این تنظیم کار می‌کند، ولی n8n/UIِ مرورگری به CORS درست نیاز دارند.

**نکته‌ی محیطی استپ ۱۲ (Live Browser View):** مرورگر سروری در این sandbox حتی با نصب `redis-server` و libهای `libnss3/libnspr4/...` بالا نیامد (`GlobalBrowser is not available`) چون deps کامل Playwright موجود نیست — محدودیت محیطی، نه باگ کد. با این حال `GlobalBrowser.initialize` خطا را می‌بلعد و `app.listen` اجرا می‌شود، پس مسیر WS و auth کامل تست شد (روی سوکت معتبرِ `/browser/ws` پیام `error: browser_unavailable` به‌درستی emit شد). **تست استریم واقعیِ فریم‌ها باید روی Docker/ماشین کاربر انجام شود.** معماری استپ ۱۲: `/browser/ws` یک listenerِ `upgrade` مستقل دارد که فقط مسیر خودش را می‌گیرد و کنار `/live/ws` همزیست است (هر دو path-based، رگرسیون گرفته شد).

> 🧭 **نکته‌ی مهم برای استپ‌های بعدی (کاتالوگ اکشن مشترک):** از استپ ۱۱، کاتالوگ `ACTIONS` دیگر دو کپی نیست؛ به **یک ماژول مشترک** منتقل شد: `public/js/actions.js` → `window.ACTION_CATALOG = { ACTIONS, actionById, ids }`. هم `views.js` (فرم خطی) و هم `flow-editor.js` (نودها) از همان می‌خوانند (flow-editor یک `actionById` محلی دارد که برای نودهای مصنوعی مثل `__start__` مقدار `null` برمی‌گرداند). برای افزودن اکشن جدید: فقط در `actions.js` اضافه کن + پیاده‌سازی بک‌اند در `src/pipeline.ts` (قبل از بخش «43. EXTERNAL MODULE») + کلیدهای i18n `p.*` (fa+en). فرمت اکشن: `{ id, icon?, fields:[{k,label,type,ph?,options?}] }`؛ بک‌اند `{action, params}` می‌گیرد. ⚠️ نودهای کنترل‌جریان چندپورتی هنوز ساخته نشده‌اند (`toSteps()` خطی است) — کار آینده‌ی ادیتور. ترتیب لود اسکریپت: **actions** → i18n → api → flow-editor → views → app. همه‌ی `public/**` و `tests/**` و `*.config.ts` **LF**؛ `src/**/*.ts` و `package.json` **CRLF**.

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
- استپ ۱۱: **افزایش اکشن‌ها به‌سبک Automa (E2/E3)** — کشف کلیدی: بک‌اند `src/pipeline.ts` از قبل **۴۰+ اکشن** داشت ولی UI فقط ۱۰ تا را نشان می‌داد. (الف) کاتالوگ مشترک `public/js/actions.js` (`window.ACTION_CATALOG`، ۱۸ اکشن) ساخته شد و `views.js`+`flow-editor.js` به آن متصل شدند (پایان دو کپی). (ب) چهار اکشن جدید به بک‌اند اضافه شد: `cookie` (getAll/get/set/clear)، `variable`/`set-variable` (op: set/regex/replace/slice/split/join/sort — regex امن ضد ReDoS)، `export-data` (csv/json → `downloads/<userId>/`، helperهای `toCsv`/`csvEscape`)، `notification`. (ج) کلیدهای i18n `p.*` جدید (fa+en)، `actions.js` اول در index.html لود می‌شود. (د) `docs/API.md` بخش کامل «کاتالوگ اکشن‌ها». **تست:** `tsc`/`build` سبز، `npm test`=**۹۱** (+۱۰ تست `export-csv.test.ts`؛ `toCsv`/`csvEscape` با `export function` قابل‌تست شدند). e2e Playwright: کاتالوگ مشترک + ۸ اکشن جدید + `POST /run`(200, Job ID:1)، بدون خطای console. اجرای واقعی pipeline در sandbox به‌دلیل نبود deps مرورگر سروری شکست می‌خورد (`GlobalBrowser unavailable`) — محدودیت محیطی، نه باگ کد.
- استپ ۱۶: **کانال زنده‌ی استاندارد (Live Channel) — دسته G1** _(زودتر از ۱۲–۱۵ چون استپ ۱۲ به آن وابسته بود)_. (الف) `src/core/LiveBus.ts`: نوع‌های رویداد `LiveEventType` (`job.start`/`log`/`step.start`/`step.done`/`step.error`/`job.done`/`job.error`)، کلاس `LiveBus` (publish→capped list ۲۰۰تایی + TTL ۳۰دقیقه + Pub/Sub؛ `getBuffer` برای replay)، و `JobLivePublisher` (شمارنده‌ی `seq` + fire-and-forget). کلیدهای Redis: `getLiveChannel`/`getLiveBufferKey`. (ب) `src/types.ts`: `onEvent?` به `AutomationContext`؛ `src/pipeline.ts`: param/destructure/context `onEvent` + emit `step.start`/`step.done`/`step.error` در `executeStepGroup`. (ج) `src/index.ts`: ساخت `liveBus`، wrap لاگ worker برای emit `log`، emit `job.start`/`job.done`/`job.error` دور `runPipeline`، پاس‌دادن `onEvent`؛ endpoint SSE `GET /live/sse/:userId/:jobId`؛ باز کردن CSP `connect-src: 'self' ws: wss:`. (د) `src/core/LiveServer.ts`: سرور WebSocket روی `/live/ws` (هندلر `upgrade`)، یک subscriber با `psubscribe live:ch:*` برای fan-out (سازگار با PM2 cluster)، replay بافر روی connect، heartbeat ping، و `authorizeLive` (env-key=admin، یا owner-match با `validateAndGetOwner`). (ه) UI: `public/js/live.js` (`window.LiveClient` با WS→fallback SSE + `window.LiveView`)، کلیدهای i18n `live.*`+`nav.live` (fa+en)، آیتم nav + route `live` در `app.js`/`views.js` + هوک `stopAll`→`LiveView.stop`. **وابستگی جدید:** `@types/ws` (devDep). **تست:** `tsc`/`build` سبز، `npm test`=**۹۸** (+۴ تست `live-bus.test.ts` integration روی Redis واقعی شامل cap+Pub/Sub، +۳ تست `live-auth.test.ts`). e2e واقعی (سرور زیر `Xvfb :99`+`DISPLAY=:99` کامل بالا آمد چون `GlobalBrowser.initialize` خطا را می‌بلعد و `app.listen` اجرا می‌شود): SSE بدون کلید=401، کلید غلط=403، کلید معتبر=200 stream؛ WS بدون/غلط کلید=403، معتبر=OPEN؛ replay buffer + live stream هر دو سبز (`E2E_PASS`)؛ UI بدون خطای console/CSP.

- استپ ۱۲: **Live Browser View + Element Picker (دسته F1)** _(۲۰۲۶-۰۶-۰۴)_. (الف) `src/core/LiveBrowser.ts`: کلاس `LiveBrowserSession` (context+page ایزوله از `GlobalBrowser.getContext()`، CDP `Page.startScreencast` jpeg q=60 با ack هر فریم، متدهای `navigate`/`click`/`scroll`/`type`/`key` روی `Input.dispatchMouseEvent`/`Input.insertText`/`keyboard.press`، `setPicker` با تزریق `PICKER_SCRIPT` + binding `__abReportPick` از `exposeBinding`، idle-TTL ۵دقیقه auto-close) و `LiveBrowserManager` (registry با cap، `create`/`destroy`/`shutdown`). (ب) `src/core/BrowserStreamServer.ts`: WS روی `/browser/ws` با `attach(server)` که listenerِ `upgrade` مستقل ثبت می‌کند و **فقط مسیر `/browser/ws`** را می‌گیرد (بقیه را رها می‌کند تا با LiveServer همزیست شود)؛ auth با `authorizeLive`؛ هر سوکت یک session؛ frameها و eventها را به‌صورت JSON می‌فرستد و دستورات `{t:...}` را می‌گیرد. (ج) `src/index.ts`: import + ساخت `liveBrowserManager`(cap=min(MAX_CONCURRENT,8)) و `browserStreamServer`، `attach` در `startServer`، و بستن در graceful shutdown. (د) UI: `public/js/browser-view.js` (`window.BrowserView`: canvas + مپ مختصات + ارسال input + Picker + کارت سلکتور با کپی/افزودن گام via `Views.addStep`)؛ `Views.addStep()` جدید در `views.js`؛ nav `browser` + route + هوک `stopAll`؛ کلیدهای i18n `bv.*`+`nav.browser` (fa+en)؛ اسکریپت در index.html (live→browser-view→views). **CSP بدون تغییر** (استپ ۱۶ از قبل `ws:` و `imgSrc data:` را باز کرده بود). **تست:** `tsc`/`build` سبز، `npm test`=**۱۰۳** (+۵ تست `live-browser.test.ts`). e2e WS: no_key=403، bad_key=403، no_userId=400، valid=OPEN، پیام `error:browser_unavailable` روی سوکت معتبر؛ رگرسیون `/live/ws` سالم؛ UI بدون خطای console/CSP. (استریم واقعی فریم محدودیت محیطی sandbox — تست روی Docker.)

- استپ ۱۳: **افزونه‌ی کمکی Chrome — Manifest V3 (دسته F2)** _(۲۰۲۶-۰۶-۰۴)_. پوشه‌ی جدید **`extension/`** (همه فایل‌ها **LF**، با ابزار `Edit` کار می‌کنند — TS کامپایل نمی‌شوند، خارج از `tsconfig`). (الف) `manifest.json` MV3: permissions storage/activeTab/scripting/tabs، host_permissions http+https، action popup، background `service_worker: background.js`، content_scripts `["content/selector.js","content/recorder.js"]` در document_idle، آیکون‌های 16/48/128 (ساخته‌شده با PIL). _نکته: `default_locale` عمداً حذف شد چون `_locales/` و `__MSG_*` نداریم._ (ب) `content/selector.js`: `window.ABSelector = {cssPath, xPath}` — **همان منطق `PICKER_SCRIPT` بک‌اند** (id shortcut، class hints، `:nth-of-type`، `CSS.escape` با fallback، سقف ۶ سطح). (ج) `content/recorder.js`: Picker (overlay هایلایت hover + گزارش بدون فعال‌سازی هندلر صفحه) + Recorder (click→`click`، input/change→`fill`، Enter→`press`، ناوبری→`goto`)؛ وضعیت در `chrome.storage.local` (`ab_picker/ab_recording/ab_steps/ab_last_url`)؛ پیام‌ها `AB_PICK_START/STOP`، `AB_REC_START/STOP`، `AB_PING` ← و `AB_PICKED`، `AB_STEP_RECORDED` →. (د) `background.js` (service worker): `sendFlow`→`POST {base}/run` با `x-api-key` و بدنه `{userId, steps, headless:true, webhookUrl?}`؛ `checkConnection`→`GET /me`؛ `relayToActiveTab`؛ `normalizeBase` (افزودن http:// + حذف اسلش انتهایی)؛ کلید **هرگز لاگ نمی‌شود**؛ fetch از داخل worker تا CORS صفحه دور زده شود. (ه) `popup/`: `popup.html`+`popup.css`(dark)+`popup.js` (CSP-safe، بدون inline): Backend (Base/Key/User+Save/Test)، Capture (Pick/Record + کارت عنصر با add click/extract/copy)، Steps (count/Clear/Send)، status. فرمت گام `{action, params}` مطابق `public/js/actions.js`. (و) `extension/README.md`: نصب load-unpacked، تنظیمات، pick/record/send، جدول مجوزها، و **نکته‌ی CORS** (background-fetch مستقل از `CORS_ALLOWED_ORIGINS`؛ توصیه `*` یا origin افزونه در صورت نیاز). **تست:** `tsc`/`build` سبز، `npm test`=**۱۰۸** (+۵ تست `extension-selector.test.ts` با fake-DOM در `vm`، بدون jsdom). قرارداد افزونه↔بک‌اند روی سرور تأیید شد: `/me`→`{success:true}`، `/run`→`{success:true, jobId}`، بدون کلید→401. تست واقعی pick/record در Chrome باید روی ماشین کاربر انجام شود (sandbox مرورگر گرافیکی ندارد).

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
