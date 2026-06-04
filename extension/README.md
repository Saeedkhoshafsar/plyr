# Automation Backend Helper — Chrome Extension

A lightweight **Manifest V3** Chrome/Chromium extension that lets you:

- **Pick elements** on any real web page and instantly get a stable **CSS** + **XPath** selector (same selector logic used by the backend's Live Browser View).
- **Record actions** (click / type / Enter / navigation) on the page and turn them into backend **steps**.
- **Send** the recorded steps to your self-hosted `automation-backend` as a Flow (`POST /run`) using your **API Key** — directly from the popup.

It is the *"real browser"* companion (Solution B) to the in-app Live Browser View (Solution A). Use it when you want to capture selectors / flows while browsing in your own logged-in Chrome session.

---

## 1. Requirements

- Google Chrome, Chromium, Brave, or Edge (any Chromium-based browser with MV3 support).
- A running `automation-backend` instance reachable from your browser (e.g. `http://localhost:3000`).
- A valid **API Key** for that backend (a per-user key, or the root/admin env key).

---

## 2. Install (load unpacked)

The extension is **unbundled** plain JS — no build step is needed.

1. Open `chrome://extensions` in your browser.
2. Toggle **Developer mode** ON (top-right).
3. Click **Load unpacked**.
4. Select the `extension/` folder from this repository.
5. The **Automation Backend Helper** icon appears in the toolbar. Pin it for convenience.

> If you change any file, return to `chrome://extensions` and click the **reload** ↻ button on the extension card.

---

## 3. Configure the backend

Click the extension icon to open the popup, then under **Backend**:

| Field      | Example                  | Notes |
|------------|--------------------------|-------|
| Base URL   | `http://localhost:3000`  | Scheme optional — `localhost:3000` becomes `http://localhost:3000`. Trailing slash is stripped. |
| API Key    | *(your key)*             | Sent as the `x-api-key` header. Never logged. |
| User ID    | `0`                      | The `userId` used in the Flow payload. Use `0` (or your env root user) for the admin/env key. |

Click **Save**, then **Test** to verify connectivity. *Test* calls `GET /me` with your key and shows **online / offline**.

---

## 4. Usage

Open any normal **http/https** web page (the content script does not run on `chrome://`, the Web Store, or `file://` pages).

### Pick an element
1. Click **🎯 Pick element**.
2. Hover the page — the element under the cursor is highlighted.
3. Click the target element. Picking is **one-shot**: it stops automatically and shows the selected element's **CSS** and **XPath** in the popup.
4. From the picked box you can:
   - **Copy CSS** to the clipboard.
   - **Add click** → appends `{ action: "click", params: { selector } }` to the step list.
   - **Add extract** → appends `{ action: "extract", params: { selector, name: "value" } }`.

### Record a flow
1. Click **⏺ Record**.
2. Interact with the page normally. The recorder captures:
   - **click** → `click` (with a CSS selector)
   - **input/change** on form fields → `fill` (selector + value)
   - **Enter** key → `press` (`Enter`)
   - **navigation** (URL change) → `goto` (target URL)
3. Click **⏹ Stop recording** when done. Steps accumulate in the **Steps** list.

### Send to backend
1. Review the steps (use **Clear** to start over).
2. Click **Send to backend**. The popup asks the background service worker to `POST /run` with body:
   ```json
   { "userId": "0", "steps": [ ... ], "headless": true }
   ```
3. On success the popup shows **Queued ✓ — Job ID: …**. Track it in the backend UI (Jobs).

> The picked/recorded step format matches the backend's canonical `ACTION_CATALOG` (`{ action, params }`), so steps map 1:1 to backend actions (`goto`, `click`, `fill`, `type`, `press`, `extract`, …).

---

## 5. CORS / networking notes

The extension performs the `GET /me` and `POST /run` requests from its **background service worker**, which is extension-privileged and granted `host_permissions: ["http://*/*", "https://*/*"]`. This avoids the page-context cross-origin restrictions a content-script fetch would hit, so **the default flow works even when the backend's `CORS_ALLOWED_ORIGINS` is empty**.

However, if you customize the extension to fetch from a *page* context, or your backend sits behind a proxy that enforces `Origin` checks, configure CORS on the backend:

```env
# .env on the backend
# Allow any origin (simplest for self-hosted / local dev):
CORS_ALLOWED_ORIGINS=*

# Or allow specific origins (comma-separated). For an extension origin:
# CORS_ALLOWED_ORIGINS=chrome-extension://<your-extension-id>
```

With an **empty** `CORS_ALLOWED_ORIGINS`, the backend answers a preflight `OPTIONS` with `204` but **does not** emit an `Access-Control-Allow-Origin` header — a page-context fetch from a disallowed origin would then be blocked by the browser. The background-fetch path used by this extension is unaffected.

> Tip: For purely local single-user setups, `CORS_ALLOWED_ORIGINS=*` is the least-friction option. For shared deployments, allowlist the specific origins you trust.

---

## 6. Permissions explained

| Permission | Why |
|------------|-----|
| `storage` | Persist your settings + recorded steps in `chrome.storage.local`. |
| `activeTab` / `tabs` | Relay picker/recorder toggles to the active tab. |
| `scripting` | (Reserved) programmatic injection if needed. |
| `host_permissions: http/https` | Let the background worker call your backend and let content scripts run on web pages. |

No data is sent anywhere except to the **Base URL** you configure. Your API Key is stored locally and only transmitted to your backend via the `x-api-key` header.

---

## 7. Files

```
extension/
├── manifest.json          # MV3 manifest
├── background.js          # service worker: sendFlow (/run), checkConnection (/me), relay
├── content/
│   ├── selector.js        # window.ABSelector → cssPath() / xPath() (matches backend picker)
│   └── recorder.js        # element picker overlay + action recorder
├── popup/
│   ├── popup.html         # popup UI (config / capture / steps)
│   ├── popup.css          # dark theme
│   └── popup.js           # popup controller (CSP-safe, no inline JS)
├── icons/                 # 16 / 48 / 128 px
└── README.md              # this file
```

---

## 8. Troubleshooting

- **"Open a normal web page (http/https)…"** — you're on a restricted page (`chrome://`, store, PDF viewer, `file://`). Switch to a normal site.
- **Connection failed (offline)** — check the Base URL, that the backend is running, and that the API Key is valid (`GET /me` should return `success: true`).
- **Send failed: http_401** — invalid/missing API Key.
- **Send failed: http_400** — payload rejected by the backend schema (e.g. an unsupported action). Check the Steps list.
- **No steps recorded** — make sure **Record** is active (button shows *Stop recording*) and you're interacting with the *active* tab.
