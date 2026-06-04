# API Reference — automation-backend

مرجع کامل endpointهای HTTP. همه‌ی پاسخ‌ها JSON هستند. مسیرهای کاربری و سلامت روی ریشه (`/`) و مسیرهای ادمین زیر `/admin` mount شده‌اند.

> **Base URL پیش‌فرض:** `http://localhost:3000`

---

## احراز هویت (Authentication)

| نوع | Header | توضیح |
|------|--------|-------|
| کاربر | `x-api-key: <API_KEY>` | لازم برای `/run`, `/cancel`, `/job`, `/jobs`, `/quota`. کلیدها در `API_KEYS` تعریف می‌شوند. |
| ادمین | `x-admin-token: <ADMIN_SECRET>` | لازم برای همه‌ی مسیرهای `/admin/*`. مقدار از `ADMIN_SECRET`. |

> در حالت Self-Hosted تک‌کاربره (`DEPLOYMENT_MODE=single`) احراز هویت ممکن است ساده‌تر/غیرفعال شود — به استپ ۱۸ در `PLAN.md` مراجعه کنید.

نمونه‌ی فراخوانی:

```bash
curl -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk_live_xxx" \
  -d '{ "userId": "u1", "steps": [ { "action": "goto", "url": "https://example.com" } ] }'
```

---

## Health

### `GET /health`
بررسی سلامت سرویس (Redis، Lua، مرورگر). نیازی به احراز هویت ندارد.

**پاسخ نمونه:**
```json
{ "status": "ok", "redis": "connected", "lua": true }
```

---

## User Endpoints

### `POST /run`
ثبت یک جاب اتوماسیون در صف. _(auth: x-api-key)_

**Body:**
| فیلد | نوع | الزامی | توضیح |
|------|-----|--------|-------|
| `userId` | string | ✅ | شناسه‌ی کاربر |
| `steps` | Step[] | ✅ | آرایه‌ی مراحل اتوماسیون (طبق Flow Engine) |
| `headless` | boolean | ❌ | پیش‌فرض از `DEFAULT_HEADLESS` |
| `webhookUrl` | string (URL) | ❌ | برای دریافت نتیجه‌ی جاب |

**پاسخ موفق (200):**
```json
{
  "success": true,
  "jobId": "123",
  "message": "Job queued successfully",
  "yourJobNumber": 1,
  "queueLimit": 3,
  "priority": 100,
  "userType": "Free",
  "webhookEnabled": false
}
```

**خطاها:** `400` (ورودی نامعتبر)، `429` (سهمیه‌ی روزانه تمام شده یا محدودیت صف).

---

### `POST /schedule`
ثبت یک جاب زمان‌بندی‌شده‌ی تکرارشونده (cron) با BullMQ repeatable. _(auth: x-api-key)_

**Body:** `userId`, `steps`, `cron` (الگوی cron)، `name?`، `headless?`، `webhookUrl?`.

---

### `GET /schedules/:userId`
فهرست زمان‌بندی‌های فعال یک کاربر. _(auth: x-api-key)_

**پاسخ نمونه:**
```json
{
  "success": true,
  "schedules": [
    { "key": "...", "scheduleId": "...", "name": "daily", "cron": "0 9 * * *", "nextRun": "2026-06-05T09:00:00.000Z", "timezone": "UTC" }
  ]
}
```

---

### `DELETE /schedule/:userId/:key`
حذف یک زمان‌بندی با `key`. _(auth: x-api-key)_

---

### `DELETE /cancel/:userId/:jobId`
لغو یک جاب در حال اجرا یا در صف. _(auth: x-api-key)_

---

### `GET /quota/:userId`
سهمیه‌ی باقی‌مانده/مصرف‌شده‌ی کاربر. _(auth: x-api-key)_

---

### `GET /jobs/:userId`
فهرست جاب‌های اخیر کاربر. _(auth: x-api-key)_

### `GET /job/:userId/:jobId`
جزئیات و نتیجه‌ی یک جاب مشخص. _(auth: x-api-key)_

---

## Admin Endpoints (`/admin/*`)

همه با `x-admin-token`. در حالت `single` این مسیرها معمولاً غیرفعال یا باز می‌شوند (استپ ۱۸).

| Method | Path | توضیح |
|--------|------|-------|
| GET | `/admin/stats` | آمار کلی سیستم |
| POST | `/admin/set-user-level` | تنظیم سطح کاربر |
| GET | `/admin/user/:userId` | اطلاعات کاربر |
| GET | `/admin/user/:userId/settings` | تنظیمات کاربر |
| POST | `/admin/user/:userId/settings` | به‌روزرسانی تنظیمات کاربر |
| POST | `/admin/user/:userId/plan` | تغییر پلن کاربر |
| POST | `/admin/user/:userId/extend` | تمدید اعتبار کاربر |
| POST | `/admin/users/settings` | تنظیمات گروهی |
| POST | `/admin/users/plan` | تغییر پلن گروهی |
| POST | `/admin/users/extend` | تمدید گروهی |
| GET | `/admin/users/blocked` | کاربران مسدود |
| GET | `/admin/users/expiring` | کاربران رو به انقضا |
| GET | `/admin/users/overrides` | overrideهای پلن |
| GET | `/admin/users/sequential` | کاربران sequential |
| POST | `/admin/api-keys/generate` | تولید API key |
| GET | `/admin/api-keys` | فهرست API keyها |
| DELETE | `/admin/api-keys/:key` | حذف API key |
| POST | `/admin/reset-quota/:userId` | ریست سهمیه |
| POST | `/admin/cleanup` | پاک‌سازی فایل‌های موقت |
| POST | `/admin/reload-lua` | بارگذاری مجدد اسکریپت‌های Lua |
| POST | `/admin/restart-global-browser` | ری‌استارت مرورگر مشترک |
| POST | `/admin/system/restart` | ری‌استارت سیستم |

---

## کدهای وضعیت

| کد | معنی |
|----|------|
| `200` | موفق |
| `400` | ورودی نامعتبر |
| `401/403` | احراز هویت ناموفق |
| `404` | مسیر/منبع یافت نشد |
| `429` | محدودیت نرخ یا سهمیه |
| `500` | خطای سرور |

> 📌 مستندات OpenAPI/Swagger و رویدادهای webhook خروجی در استپ‌های ۱۴ و ۱۶ تکمیل می‌شوند.
