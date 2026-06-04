# automation-backend (v37 → بازیابی و توسعه)

Backend اتوماسیون مرورگر مبتنی بر **Node.js + TypeScript** — **رایگان، متن‌باز، و Self-Hosted**.

> 🏠 **مدل استقرار:** این پروژه برای اجرا روی **سرور شخصی خودتان** طراحی شده (ترجیحاً کنار n8n). به‌صورت پیش‌فرض **تک‌کاربره و full-access** است؛ نه سرویس عمومی مشترک. دلیل: اتوماسیون مرورگر روی سرور عمومی ریسک سوءاستفاده بالایی دارد. (حالت چندکاربره/SaaS هم با `DEPLOYMENT_MODE=multi` در دسترس است.)
>
> این مخزن نسخه‌ی بازیابی‌شده از یک بکاپ قدیمی است که اکنون در حال **پاک‌سازی، رفع باگ، سازگارسازی با Linux، افزودن رابط کاربری، مسیر زنده، و ادغام با n8n** است.
> نقشه‌ی راه، معماری مرجع و لیست کامل باگ‌ها در فایل [`PLAN.md`](./PLAN.md) قرار دارد.
>
> 🔄 **برای ادامه‌ی توسعه در محیط/جلسه‌ی جدید:** ابتدا [`SESSION_RECOVERY.md`](./SESSION_RECOVERY.md) را بخوانید (راه‌اندازی sandbox، نکته‌ی CRLF، وضعیت فعلی، و قوانین کاری). تنها بکاپ پروژه همین ریپو است.

---

## معماری

| بخش | تکنولوژی |
|------|-----------|
| وب‌سرور | Express 4 + Helmet |
| صف کار | BullMQ (روی Redis) |
| اتوماسیون | Playwright + stealth |
| ذخیره‌سازی | Redis + JSON روی دیسک |
| رابط کاربری | Vanilla JS (بدون build)، i18n (فا/EN، RTL/LTR)، CSP سخت |
| Production | PM2 cluster |

- **Hybrid Browser:** کاربران VIP مرورگر persistent اختصاصی، کاربران Free مرورگر مشترک با context ایزوله.
- **Flow Engine:** پشتیبانی از `if/else`, `while`, `try/catch/finally`, `switch`, متغیر و ماژول افزونه‌ای.
- **ادیتور Flow بصری (node-based):** ساخت جریان به‌صورت گراف نودها (الهام از Automa) — هر اکشن یک نود، اتصال بصری نودها، drag-and-drop، pan/zoom، ذخیره/بارگذاری در localStorage و اجرای مستقیم. تبدیل دوطرفه با همان فرمت `steps` بک‌اند. علاوه بر فرم خطی ساده.
- **نمایش زندهٔ مرورگر + Element Picker:** مرورگر سروری را زنده داخل داشبورد ببینید (CDP Screencast روی WebSocket `/browser/ws`)، روی صفحه کلیک/تایپ/اسکرول کنید (تعامل دوطرفه با `Input.*`)، و با ابزار «انتخاب عنصر» سلکتور CSS/XPath را خودکار بسازید و با یک کلیک به‌صورت گام `click`/`extract` به فرم اجرا اضافه کنید. هر نشست یک context ایزوله با TTL بی‌کاری دارد.
- **افزونهٔ کمکی Chrome (Manifest V3):** پوشهٔ [`extension/`](extension/README.md) — روی مرورگر واقعی خودتان عنصر انتخاب کنید (CSS/XPath با همان منطق Picker بک‌اند)، اکشن‌ها را ضبط کنید (click/fill/press/goto) و با API Key مستقیم از popup به‌صورت یک Flow (`POST /run`) به بک‌اند بفرستید. بدون build؛ از طریق *Load unpacked* نصب می‌شود. راهنمای نصب و نکتهٔ CORS در `extension/README.md`.
- **Schedule:** زمان‌بندی cron با BullMQ repeatable jobs.
- **ادغام n8n / API (F3):** حالت همگام `POST /run?wait=true` (صبر تا پایان جاب و بازگشت نتیجه به‌صورت inline؛ در timeout پاسخ `202` با `pollUrl`)، هدر `Idempotency-Key` برای جلوگیری از اجرای دوبارهٔ درخواست‌های تکراری، و **webhookهای امضاشده با HMAC-SHA256** (`X-Signature: sha256=…` + `X-Webhook-Timestamp` وقتی `WEBHOOK_SECRET` ست شود). مشخصات کامل OpenAPI در [`docs/openapi.yaml`](./docs/openapi.yaml).
- **n8n Community Node (F4):** پکیج [`n8n-node/`](n8n-node/README.md) با نام `n8n-nodes-automationbackend` — یک Action node (Run Workflow / Get Job Result / Create Schedule / Cancel Job) و یک Trigger node (دریافت webhookهای بک‌اند با **تأیید امضای HMAC**)؛ Credentials = Base URL + API Key (+ Webhook Secret اختیاری). نصب و نمونهٔ workflow در `n8n-node/README.md`.
- **Workflow Storage (G2):** ذخیرهٔ workflowهای **قابل‌بازاجرا و نسخه‌بندی‌شده** در Redis، مستقل از نتیجهٔ job. CRUD کامل (`POST/GET/PUT/DELETE /workflows/:userId[/:workflowId]`)، تاریخچهٔ نسخه‌ها (`GET …/versions`، هرس خودکار با `WORKFLOW_MAX_VERSIONS`)، و بازاجرا با `POST /workflows/:userId/:workflowId/run` (همان قرارداد `?wait=true` + `Idempotency-Key`). هر workflow به کاربرش گره خورده (strict API-key binding) و از همان storage برای افزونه/n8n/UI استفاده می‌شود.
- **امنیت:** API Key، Admin Secret، Rate Limit، محافظت SSRF، Path-traversal guard.

---

## پیش‌نیازها

- Node.js ≥ 20
- Redis ≥ 6 (روی Linux از پکیج رسمی نصب شود؛ باینری ویندوزی داخل ریپو **نیست**)
- مرورگر Chromium (از طریق Playwright نصب می‌شود — به‌صورت bundled، نیازی به Chrome سیستمی نیست)

### نصب Redis روی Linux

```bash
# Debian / Ubuntu
sudo apt-get update && sudo apt-get install -y redis-server
sudo systemctl enable --now redis-server

# یا با Docker
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

سپس مقدار `REDIS_URL` در `.env` را تنظیم کنید (پیش‌فرض: `redis://127.0.0.1:6379`).

## نصب

### 🚀 نصب تعاملی با `install.sh` (ساده‌ترین راه)

به‌جای اجرای دستی دستورها، اسکریپت تعاملی `install.sh` همه‌چیز را قدم‌به‌قدم و **با تأیید شما** پیش می‌برد. اول می‌پرسد روی **سرور** نصب می‌کنید یا **کلاینت**:

```bash
chmod +x install.sh
./install.sh
```

سه هدف نصب پشتیبانی می‌شود:

| گزینه | چه‌کار می‌کند |
|-------|----------------|
| **۱) Server (Docker)** | استک کامل (app + redis) با `docker compose` — ساده‌ترین مسیر؛ Chromium و وابستگی‌های سیستمی داخل image هستند |
| **۲) Server (Node)** | نصب بومی: Node deps + Redis (تشخیص خودکار apt/dnf/pacman/brew) + Playwright Chromium + build + اجرا با PM2 (+ systemd اختیاری) |
| **۳) Client** | ابزارهای سمت کلاینت روی همین دستگاه: راهنمای بارگذاری افزونهٔ Chrome + build و نصب n8n community node در `~/.n8n/custom` |

اسکریپت در حالت سرور می‌تواند `.env` را از `.env.example` بسازد و یک `API_TOKEN` تصادفی برای حالت single تولید و در `.env` بنویسد.

```bash
# حالت‌های غیرتعاملی (برای CI/automation):
./install.sh --server-docker        # استک Docker
./install.sh --server-node          # نصب بومی Node + PM2
./install.sh --client               # ساخت ابزارهای کلاینت
./install.sh --server-docker --yes  # بدون پرسش (تأیید خودکار همه‌ی مراحل)
./install.sh --help                 # راهنما
```

### نصب دستی (در صورت تمایل)

```bash
npm install                          # postinstall به‌صورت خودکار Chromium را دانلود می‌کند (در صورت خطا، non-fatal)
# اگر می‌خواهید دانلود مرورگر حین نصب انجام نشود:
SKIP_BROWSER_INSTALL=1 npm install
# و بعداً به‌صورت دستی:
npm run install:browser              # = playwright install chromium
npm run install:browser:deps        # نصب Chromium + وابستگی‌های سیستمی (نیازمند sudo)

cp .env.example .env                 # سپس مقادیر را ویرایش کنید
```

> 🧩 **مرورگر:** به‌صورت پیش‌فرض از Chromium بسته‌بندی‌شده‌ی Playwright استفاده می‌شود. اگر می‌خواهید Chrome/Chromium نصب‌شده‌ی سیستم استفاده شود، مسیر آن را در `CHROME_EXE` بگذارید (در غیر این‌صورت خالی بماند).

## اجرا

```bash
# توسعه (hot reload)
npm run dev

# build + production
npm run build
npm start

# production cluster با PM2
pm2 start ecosystem.config.js
```

## اجرا با Docker (توصیه‌شده برای Self-Hosted)

استک کامل (app + redis) با یک دستور بالا می‌آید:

```bash
cp .env.example .env          # مقادیر را ویرایش کنید (API_KEYS, ADMIN_SECRET, ...)
docker compose up -d --build  # build و اجرا
docker compose logs -f app    # مشاهده‌ی لاگ‌ها
docker compose down           # توقف
```

- سرویس روی `http://localhost:3000` در دسترس است.
- `REDIS_URL` به‌صورت خودکار به سرویس `redis` داخل compose اشاره می‌کند (مقدار `.env` را override می‌کند).
- پوشه‌های `logs/`, `profiles/`, `uploads/`, `downloads/` به‌صورت volume پایدار می‌مانند.
- Healthcheck داخلی روی مسیر `/health` تعریف شده (هم در Dockerfile و هم در compose).
- مرورگر از image رسمی Playwright (`v1.56.1-jammy`) با همه‌ی وابستگی‌های سیستمی تأمین می‌شود — نیازی به نصب جداگانه‌ی Chromium نیست.

> برای اجرای فقط با `docker build`:
> ```bash
> docker build -t automation-backend .
> docker run -p 3000:3000 --env-file .env -e REDIS_URL=redis://host.docker.internal:6379 automation-backend
> ```

## متغیرهای محیطی

همه‌ی متغیرها در [`.env.example`](./.env.example) با توضیح آمده‌اند. مهم‌ترین‌ها:

| متغیر | پیش‌فرض | توضیح |
|-------|---------|-------|
| `DEPLOYMENT_MODE` | `single` | `single` = self-hosted تک‌کاربرهٔ full-access؛ `multi` = چندکاربرهٔ SaaS (plan/quota/admin) |
| `API_TOKEN` | _(تولید خودکار)_ | فقط حالت `single`: توکن مشترک احراز هویت. اگر خالی باشد یک `tok_<hex>` تصادفی در boot ساخته و یک‌بار در لاگ چاپ می‌شود |
| `PORT` | `3000` | پورت سرور |
| `REDIS_URL` | `redis://127.0.0.1:6379` | اتصال Redis |
| `API_KEYS` | — | کلیدهای API مجاز (با کاما) — فقط حالت `multi` |
| `ADMIN_SECRET` | — | رمز پنل ادمین — فقط حالت `multi` |
| `MAX_CONCURRENT` | `20` | حداکثر اجرای همزمان |
| `DEFAULT_HEADLESS` | `true` | اجرای بدون نمایش مرورگر |
| `CHROME_EXE` | _(خالی)_ | اختیاری؛ مسیر Chrome سیستمی. خالی = Chromium بسته‌بندی‌شده‌ی Playwright |

---

## حالت‌های استقرار (`DEPLOYMENT_MODE`)

این بک‌اند دو حالت اجرا دارد؛ پیش‌فرض **`single`** (مناسب self-hosted):

### 🏠 `single` — تک‌کاربرهٔ self-hosted (پیش‌فرض)
- **full-access:** Quota / VIP / Plan / Level همگی خاموش‌اند؛ همهٔ درخواست‌ها با سقف بالا اجرا می‌شوند و کاربر مسدودشدنی نیست.
- **احراز هویت ساده:** یک `API_TOKEN` مشترک کل سرویس را احراز هویت می‌کند. آن را به‌صورت `Authorization: Bearer <API_TOKEN>` (یا هدر `x-api-key`، یا کوئری `?api_key=`) بفرستید. هویت همهٔ درخواست‌ها روی کاربر ثابت `local` نگاشت می‌شود.
- **تولید خودکار توکن:** اگر `API_TOKEN` تنظیم نشده باشد، یک توکن قوی تصادفی (`tok_<hex>`) هنگام بالا آمدن سرور ساخته و **یک‌بار** در لاگ چاپ می‌شود. برای پایداری بین ری‌استارت‌ها، آن را در `.env` بگذارید.
- **endpointهای مدیریت کاربرِ admin غیرفعال‌اند:** مسیرهای `/admin/set-user-level`, `/admin/user/*`, `/admin/users/*`, `/admin/api-keys/*` با ۴۰۴ پاسخ می‌دهند؛ اما endpointهای عملیاتی (`/admin/stats`, `/admin/cleanup`, ری‌استارت مرورگر و …) باز می‌مانند.
- **rate-limit سبک:** `RATE_LIMIT_PER_MINUTE` (پیش‌فرض ۱۲۰) همچنان فعال است.
- نمونهٔ پاسخ `GET /me`: `{ "success": true, "userId": "local", "isAdmin": false, "mode": "single", "isSingleUser": true }`

### 🏢 `multi` — چندکاربرهٔ SaaS
- مدل اصلی چندمستأجری: plan/quota/VIP/level per-user، احراز هویت با `API_KEYS` و strict binding هر کلید به مالکش، و پنل کامل admin با `ADMIN_SECRET`.
- برای فعال‌سازی: `DEPLOYMENT_MODE=multi` به‌علاوهٔ تنظیم `API_KEYS` و یک `ADMIN_SECRET` قوی.

> ⚠️ **امنیت نصب:** در حالت `multi` اگر `ADMIN_SECRET` روی مقدار پیش‌فرض بماند، در boot هشدار داده می‌شود. در حالت `single` حتماً `API_TOKEN` خودتان را ست کنید (یا توکن تصادفیِ چاپ‌شده را نگه دارید) و سرور را پشت TLS/شبکهٔ امن قرار دهید.

---

## مستندات API

فهرست کامل endpointها، احراز هویت و نمونه‌ها در [`docs/API.md`](./docs/API.md). مشخصات ماشین‌خوانِ OpenAPI 3.0 (مناسب برای import در n8n/Swagger UI/Postman) در [`docs/openapi.yaml`](./docs/openapi.yaml).

---

## تست و پایداری

تست‌ها با [Vitest](https://vitest.dev) + [Supertest](https://github.com/ladjs/supertest) نوشته شده‌اند.

```bash
# اجرای کامل تست‌ها (unit + integration)
npm test

# اجرای تست‌ها در حالت watch
npm run test:watch

# بررسی نوع‌ها (type-check) بدون خروجی build
npm run check
```

ساختار تست‌ها:

- `tests/unit/` — تست‌های واحد خالص (بدون Redis/شبکه):
  - `helpers.test.ts` — `parseNumber` / `parseInteger` / `parseBoolean` / `securePath` / `isVipUser`
  - `validation.test.ts` — `sanitizeUserId` / `sanitizeModuleName` / `sanitizeLogMessage` / `validateWebhookUrl` (SSRF) / `validateHeadless` / `validateSteps`
  - `condition-engine.test.ts` — عملگرهای `ConditionEngine` (مقایسه/رشته/عددی/regex امن + ضد ReDoS) و `resolveVariables`
  - `schemas.test.ts` — اسکیماهای Zod (`runBodySchema` / `scheduleBodySchema` / `parseBody`)
- `tests/integration/` — تست‌های یکپارچه روی یک اپ Express سبک با Supertest:
  - `api.test.ts` — میدل‌ورهای واقعی احراز هویت: `requireApiKey` (۴۰۱ بدون کلید، ۴۰۳ کلید نامعتبر، ۲۰۰ با کلید env)، `requireAdminApiKey` و `requireAdminAuth` (`x-admin-token`) + روت `/health`
  - `setup.ts` — قبل از import شدن `src/config.ts` متغیرهای محیطی تست را force می‌کند (از طریق `setupFiles` در `vitest.config.ts`)

> توجه: تست‌های یکپارچه عمداً `src/index.ts` را import نمی‌کنند، چون این فایل هنگام load با `startServer()` سرور و مرورگر را بالا می‌آورد. به‌جای آن، میدل‌ورهای واقعی روی یک اپ Express سبک سوار می‌شوند. مسیرهای auth کلید-env و admin-token بدون Redis کار می‌کنند؛ بررسی strict-binding کلیدِ کاربر به Redis نیاز دارد.

---

## وضعیت توسعه

این پروژه طبق `PLAN.md` به‌صورت استپ‌به‌استپ تکمیل می‌شود. وضعیت لحظه‌ای استپ‌ها را در همان فایل ببینید.

## مجوز

MIT
