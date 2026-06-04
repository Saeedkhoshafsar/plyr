# automation-backend (v37 → بازیابی و توسعه)

Backend اتوماسیون مرورگر مبتنی بر **Node.js + TypeScript** — **رایگان، متن‌باز، و Self-Hosted**.

> 🏠 **مدل استقرار:** این پروژه برای اجرا روی **سرور شخصی خودتان** طراحی شده (ترجیحاً کنار n8n). به‌صورت پیش‌فرض **تک‌کاربره و full-access** است؛ نه سرویس عمومی مشترک. دلیل: اتوماسیون مرورگر روی سرور عمومی ریسک سوءاستفاده بالایی دارد. (حالت چندکاربره/SaaS هم با `DEPLOYMENT_MODE=multi` در دسترس است.)
>
> این مخزن نسخه‌ی بازیابی‌شده از یک بکاپ قدیمی است که اکنون در حال **پاک‌سازی، رفع باگ، سازگارسازی با Linux، افزودن رابط کاربری، مسیر زنده، و ادغام با n8n** است.
> نقشه‌ی راه، معماری مرجع و لیست کامل باگ‌ها در فایل [`PLAN.md`](./PLAN.md) قرار دارد.

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
- Redis ≥ 6 (روی Linux از پکیج رسمی نصب شود؛ باینری ویندوزی داخل ریپو نیست)
- مرورگر Chromium (از طریق Playwright نصب می‌شود)

## نصب

```bash
npm install
npx playwright install chromium     # نصب مرورگر
cp .env.example .env                 # سپس مقادیر را ویرایش کنید
```

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

---

## وضعیت توسعه

این پروژه طبق `PLAN.md` به‌صورت استپ‌به‌استپ تکمیل می‌شود. وضعیت لحظه‌ای استپ‌ها را در همان فایل ببینید.

## مجوز

MIT
