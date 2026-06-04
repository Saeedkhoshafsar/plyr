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
| Production | PM2 cluster |

- **Hybrid Browser:** کاربران VIP مرورگر persistent اختصاصی، کاربران Free مرورگر مشترک با context ایزوله.
- **Flow Engine:** پشتیبانی از `if/else`, `while`, `try/catch/finally`, `switch`, متغیر و ماژول افزونه‌ای.
- **Schedule:** زمان‌بندی cron با BullMQ repeatable jobs.
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
| `PORT` | `3000` | پورت سرور |
| `REDIS_URL` | `redis://127.0.0.1:6379` | اتصال Redis |
| `API_KEYS` | — | کلیدهای API مجاز (با کاما) |
| `ADMIN_SECRET` | — | رمز پنل ادمین |
| `MAX_CONCURRENT` | `20` | حداکثر اجرای همزمان |
| `DEFAULT_HEADLESS` | `true` | اجرای بدون نمایش مرورگر |
| `CHROME_EXE` | _(خالی)_ | اختیاری؛ مسیر Chrome سیستمی. خالی = Chromium بسته‌بندی‌شده‌ی Playwright |

---

## مستندات API

فهرست کامل endpointها، احراز هویت و نمونه‌ها در [`docs/API.md`](./docs/API.md).

---

## وضعیت توسعه

این پروژه طبق `PLAN.md` به‌صورت استپ‌به‌استپ تکمیل می‌شود. وضعیت لحظه‌ای استپ‌ها را در همان فایل ببینید.

## مجوز

MIT
