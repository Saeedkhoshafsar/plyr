# n8n-nodes-automationbackend

An [n8n](https://n8n.io) community node package for the self-hosted **Automation
Backend** (this repository). It lets you run browser-automation `steps`
workflows, schedule recurring runs, fetch results, cancel jobs, and **trigger**
n8n workflows from the backend's signed webhooks — all from inside n8n.

It pairs with the backend's n8n-friendly API (step 14): synchronous
`POST /run?wait=true`, the `Idempotency-Key` header, and HMAC-signed webhooks.
See [`../docs/openapi.yaml`](../docs/openapi.yaml) for the full API contract.

## Nodes

### Automation Backend (action node)

| Operation | Method / Endpoint | Notes |
|-----------|-------------------|-------|
| **Run Workflow** | `POST /run` | Submit a `steps` array. Toggle **Wait for Completion** for sync mode (`?wait=true`) and set an **Idempotency Key** to dedupe retries. |
| **Get Job Result** | `GET /job/:userId/:jobId` | Poll a job's status / result. |
| **Create Schedule** | `POST /schedule` | Recurring cron job. |
| **Cancel Job** | `DELETE /cancel/:userId/:jobId` | Optional `closeBrowser` / `closeTab`. |

### Automation Backend Trigger (trigger node)

Exposes an n8n webhook URL. Point a job's `webhookUrl` (the **Webhook URL**
field on the Run/Schedule operation, or the backend `WEBHOOK_SECRET`-signed
notification) at this node's **Production URL** to start a workflow when a job
finishes.

- **Events** — filter by `job.completed`, `job.failed`, `job.cancelled`,
  `job.blocked`, `job.quota_exhausted` (empty = accept all).
- **Verify Signature** — when on, the node verifies the `X-Signature`
  (HMAC-SHA256 of the raw body) header using the **Webhook Secret** from the
  credential, and rejects unsigned/invalid requests with `401`. This must match
  the backend's `WEBHOOK_SECRET`.

## Credentials — Automation Backend API

| Field | Required | Description |
|-------|----------|-------------|
| **Base URL** | ✅ | Root URL of the backend, e.g. `https://automation.example.com`. |
| **API Key** | ✅ | Sent as the `x-api-key` header on every request. |
| **Webhook Secret** | — | Same value as the backend `WEBHOOK_SECRET`; used by the Trigger node for HMAC verification. |

The **Test** button calls `GET /me` and expects `200`.

## Installation

### Option A — n8n GUI (Community Nodes)
1. In n8n: **Settings → Community Nodes → Install**.
2. Enter `n8n-nodes-automationbackend` and confirm.

### Option B — manual / self-hosted
```bash
# In your n8n custom-extensions directory (e.g. ~/.n8n/custom or N8N_CUSTOM_EXTENSIONS)
npm install n8n-nodes-automationbackend
# then restart n8n
```

### Option C — build from this repo (local dev)
```bash
cd n8n-node
npm install --legacy-peer-deps   # n8n-workflow is a peer dep, provided by n8n at runtime
npm run build                    # compiles to dist/ and copies icons
# link into n8n:
#   npm link  (here)  &&  npm link n8n-nodes-automationbackend  (in ~/.n8n/custom)
```

> `n8n-workflow` is intentionally a **peerDependency** — n8n provides it at
> runtime. A local type shim (`types/n8n-workflow.d.ts`) lets the package
> type-check/build standalone without installing n8n's native deps.

## Example workflow

[`examples/example-workflow.json`](examples/example-workflow.json) — import it in
n8n (**Workflows → Import from File**). It:
1. **Manual Trigger → Automation Backend (Run Workflow, Wait=true)** runs a tiny
   `goto`+`extract` flow and returns the result inline; **and**
2. **Automation Backend Trigger** receives the signed webhook for the same job
   on a separate path (verifies the HMAC signature).

## CORS note

The action node calls the backend **server-side from n8n**, so browser CORS does
not apply. Keep `CORS_ALLOWED_ORIGINS` configured only for browser clients
(the dashboard UI / extension).

## License

MIT
