# Build Spec: "PulseCheck" — Multi-user Uptime Monitor (Node.js + React)

> **For Claude Code.** Read this whole file before writing any code. Build the project in the milestone order in section 13. After each milestone, run the tests and the app, then stop and summarise what you built and which Node.js concepts it used.

---

## 1. Context and goals

The developer building this is an experienced React/TypeScript engineer who is **new to Node.js on the backend** and is preparing for a Senior Product Engineer (JavaScript & Node.js) interview. The project has two goals:

1. **Learning:** exercise the core Node.js concepts in section 10 in real code the developer can explain in an interview.
2. **Usefulness:** a complete multi-user app where people sign up, add their own website URLs, and see their own uptime dashboard.

**The app runs locally only.** Do not create deployment configuration (no `render.yaml`, no hosting workflows, no Dockerfile for the app). Deployment is covered only as **documentation** in `docs/deployment.md` (section 9).

Because of goal 1:

- Prefer clear, idiomatic code over clever code.
- Add short comments **only** where a Node.js concept is at work, tagged like `// [Node concept: event loop] ...`, so the developer can search for them.
- Record design decisions with real alternatives in `docs/decisions.md`.

---

## 2. What the app does

### Users

- Anyone can **sign up** with email and password, then **log in**.
- **Forgot password**: request a reset link by email, then set a new password from that link.
- Each user manages **their own monitors** and sees **only their own** dashboard, checks, incidents and alerts.
- Users can change their password and alert preferences on an account settings screen.

### Admin

- There is an `ADMIN` role stored in the database. **Admin credentials live only in the database**, never in `.env`.
- The first admin is created with an interactive CLI command (`npm run admin:create`, see section 6.9).
- Admins log in through the same login screen and get an extra **Admin** area with Overview, Users and Monitors tabs: list of users (email, signup date, monitor count, active/disabled), ability to disable or re-enable a user, system stats (checks in the last 24h, last run duration, monitors up/down), and a read-only list of every user's monitored URLs with status and owner.
- Admins do not see other users' passwords or tokens, ever.

### Monitoring

- Monitors a user's URLs on a schedule (in-process scheduler; the app runs locally).
- Each check records: up/down, HTTP status code, response time (ms), error message.
- Checks the SSL certificate expiry once a day per monitor.
- Marks a site **down only after 2 consecutive failed checks**; marks it **up** after 1 success.
- Emails the monitor's owner when a site goes down and when it recovers (state changes only).
- Live dashboard updates via Server-Sent Events (SSE), scoped to the logged-in user.
- CSV export of a monitor's check history.

### Seed data

`npm run admin:create` attaches these 10 monitors to the **first admin user** when it creates that admin (skippable with `--no-seed`). `npm run db:seed` does the same on demand (and fails with a clear message telling the developer to run `npm run admin:create` first if no admin exists). Both must be idempotent.

```
https://w3toolkit.com
https://w3generators.com
https://qrcode-panda.com
https://w3programmings.com
https://happinessmeansbusiness.com
https://hamzamehmood.com
https://araceuas.com
https://www.premierassistedlivingfacility.com
https://changeforchangecreativesolutions.net
https://ezwills.com.sg
```

Use the hostname without `www.` as the default display name.

### Be a polite client

These are real websites. The checker must:

- Enforce a minimum interval of **5 minutes** per monitor (default 10).
- Send a clear `User-Agent`: `PulseCheck/1.0 (local uptime monitor)`, so site owners can filter it out of server logs.
- Use `GET`, follow redirects (max 5), and read **at most the first 64 KB** of the body, then cancel the stream. Never download images, CSS or JS.
- Treat 2xx and 3xx final responses as **up**; 4xx/5xx, timeouts, DNS and TLS errors as **down**.

### Fair-use limits per user

- Max **20 monitors** per user (configurable in `.env` as `MAX_MONITORS_PER_USER`).
- Only `http://` and `https://` URLs on ports 80 and 443.
- **SSRF protection (required):** since users now enter arbitrary URLs, the checker must resolve the hostname with `dns.lookup` (all addresses) and **refuse** loopback, private, link-local and reserved ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `0.0.0.0/8`, `::1`, `fc00::/7`, `fe80::/10`). Validate on create/update **and** again at check time (DNS can change), and re-validate each redirect target. Allow an `ALLOW_PRIVATE_TARGETS=true` env flag for local testing only. Explain SSRF in `docs/node-concepts.md`.

---

## 3. Tech stack

**Root**

- npm workspaces monorepo: `frontend` and `backend`.
- Node.js **22 LTS or newer**; `"engines"` field and `.nvmrc`.
- TypeScript strict everywhere; ESLint + Prettier at the root.
- `docker-compose.yml` with **only local dev services**: PostgreSQL (dev), PostgreSQL (test), and **Mailpit** (local email catcher with a web inbox at `http://localhost:8025`).
- A root `npm run dev` that starts backend and frontend together.

**Backend**

- Express 5, PostgreSQL via **Prisma**, **Zod** (requests + env), **Pino** + `pino-http` with request IDs.
- JWT access token (15 min) + refresh token (7 days) in an `httpOnly`, `SameSite=Lax` cookie (`Secure` when not localhost); refresh tokens stored **hashed** and rotated on every use; reuse of a revoked token revokes the whole token family.
- `bcrypt` async API, `helmet`, `express-rate-limit` (auth routes and forgot-password).
- **Nodemailer** over SMTP, pointing at Mailpit locally. All emails (password reset, alerts) are visible in Mailpit.
- Native `fetch`, `node:dns`, `node:net`, `node:tls`, `node:crypto`, `node:stream`, `node:readline/promises`.
- Tests: **Vitest** + **Supertest**, separate test database.

**Frontend**

- Vite + React + TypeScript, React Router, TanStack Query, Tailwind CSS, Recharts, native `EventSource`.
- **Vite dev proxy**: `/api` → backend. Frontend and API share an origin in development, so cookies just work and no CORS setup is needed. Document this in `docs/architecture.md`.
- Tests: Vitest + React Testing Library.

---

## 4. Project structure

```
pulsecheck/
├── package.json              # workspaces: ["frontend", "backend"]
├── .nvmrc
├── docker-compose.yml        # postgres, postgres-test, mailpit (dev only)
├── README.md
├── docs/
│   ├── installation.md
│   ├── deployment.md         # documentation only
│   ├── architecture.md
│   ├── api.md
│   ├── node-concepts.md
│   └── decisions.md
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.ts
│   ├── scripts/
│   │   └── create-admin.ts   # interactive CLI
│   ├── src/
│   │   ├── server.ts         # HTTP server, scheduler, graceful shutdown
│   │   ├── app.ts            # Express app (no listen; used by tests)
│   │   ├── config/env.ts
│   │   ├── lib/              # logger, errors, prisma, concurrency, retry, events,
│   │   │                     # mailer, tokens, ssrf-guard
│   │   ├── middleware/       # requestId, requireAuth, requireAdmin, validate,
│   │   │                     # errorHandler
│   │   └── modules/
│   │       ├── auth/         # signup, login, refresh, logout, forgot/reset password
│   │       ├── account/      # profile, change password, alert preferences
│   │       ├── monitors/     # CRUD + CSV export
│   │       ├── checks/       # checker, ssl, runner, scheduler
│   │       ├── incidents/
│   │       ├── alerts/       # listens to event bus, sends emails
│   │       ├── stream/       # SSE + stream tickets
│   │       └── admin/        # users list, disable/enable, system stats
│   └── tests/
└── frontend/
    ├── package.json
    ├── vite.config.ts        # includes /api proxy
    └── src/
        ├── main.tsx
        ├── api/              # fetch client with refresh-on-401, query hooks
        ├── auth/             # AuthProvider, ProtectedRoute, AdminRoute
        ├── hooks/useStatusStream.ts
        ├── pages/
        │   ├── Login.tsx
        │   ├── Signup.tsx
        │   ├── ForgotPassword.tsx
        │   ├── ResetPassword.tsx
        │   ├── Dashboard.tsx
        │   ├── MonitorDetail.tsx
        │   ├── MonitorForm.tsx
        │   ├── Account.tsx
        │   ├── admin/AdminOverview.tsx
        │   ├── admin/AdminUsers.tsx
        │   └── NotFound.tsx
        ├── components/
        └── tests/
```

Each backend module follows **routes → controller → service → repository (Prisma)**. Controllers handle HTTP only; services hold the logic and never touch `req`/`res`.

---

## 5. Data model (Prisma)

- **User**: id, email (unique, stored lowercase), passwordHash, role (`USER | ADMIN`, default `USER`), isDisabled (default false), alertsEnabled (default true), createdAt, updatedAt.
- **RefreshToken**: id, userId, familyId, tokenHash, expiresAt, revokedAt, createdAt.
- **PasswordResetToken**: id, userId, tokenHash, expiresAt (30 min), usedAt, createdAt.
- **Monitor**: id, userId, name, url, intervalMinutes (default 10, min 5), timeoutMs (default 10000), isPaused, currentStatus (`UNKNOWN | UP | DOWN`), consecutiveFailures, lastCheckedAt, sslExpiresAt, sslCheckedAt, createdAt, updatedAt. Unique on (userId, url).
- **Check**: id, monitorId, checkedAt, isUp, statusCode?, responseTimeMs?, error?. **Index on (monitorId, checkedAt DESC)**.
- **Incident**: id, monitorId, startedAt, resolvedAt?, cause.

Cascade deletes: deleting a user deletes their monitors, checks, incidents and tokens.

Retention: a daily job deletes `Check` rows older than 30 days, in batches.

---

## 6. Backend behaviour

### 6.1 Sign up

- `POST /api/auth/signup` with `{ email, password }`. Password: min 10 characters; reject the 10 most common passwords from a small built-in list.
- Email normalised to lowercase. Duplicate email returns `409 EMAIL_TAKEN`.
- New users get role `USER`. **Signup can never create an admin.**
- On success, log the user in (set refresh cookie, return access token + user).

### 6.2 Log in, refresh, log out

- `POST /api/auth/login`: rate-limited (e.g. 10 attempts / 15 min per IP + email). Wrong email and wrong password return the **same** `401 INVALID_CREDENTIALS` message. Disabled users get `403 ACCOUNT_DISABLED`.
- `POST /api/auth/refresh`: rotates the refresh token. If a **revoked** token is presented, revoke every token in that family (likely theft) and return 401.
- `POST /api/auth/logout`: revokes the current refresh token and clears the cookie.
- `GET /api/auth/me`: current user (id, email, role, alertsEnabled).

### 6.3 Forgot and reset password

- `POST /api/auth/forgot-password` with `{ email }`: **always** returns `200` with the same message whether or not the email exists (prevents user enumeration). If the user exists and isn't disabled, create a token with `crypto.randomBytes(32)`, store only its SHA-256 hash, expire in 30 minutes, invalidate older unused tokens for that user, and email a link: `${APP_URL}/reset-password?token=<token>`. Rate-limited.
- `POST /api/auth/reset-password` with `{ token, password }`: hash the incoming token, find a matching unused, unexpired record, update the password, mark the token used, and **revoke all refresh tokens** for that user (logs out other sessions). Invalid/expired token returns `400 INVALID_OR_EXPIRED_TOKEN`.
- The email is sent to Mailpit locally; `docs/installation.md` explains how to open it.

### 6.4 Account

- `GET/PATCH /api/account`: update `alertsEnabled`.
- `POST /api/account/change-password`: requires current password; revokes other sessions.
- `DELETE /api/account`: requires password; deletes the account and its data.

### 6.5 Check runner

`runChecks()` in `modules/checks/runner.ts`:

1. Load **due** monitors: not paused, owner not disabled, `lastCheckedAt` null or older than `intervalMinutes`.
2. Run with `runWithLimit(tasks, 5)` — implement it yourself in `lib/concurrency.ts` (no `p-limit`), with `allSettled` semantics so one failure never stops the rest.
3. Each check:
   - SSRF guard (section 2) before the request and for each redirect hop (use `redirect: 'manual'` and follow up to 5 hops yourself so each hop can be validated).
   - `fetch` with `AbortSignal.timeout(timeoutMs)` and the `User-Agent` header.
   - Measure time with `performance.now()`.
   - Read at most 64 KB of the body via its stream reader, then cancel.
   - On network error or timeout, retry **once** with `lib/retry.ts` (exponential backoff + jitter) before recording failure.
4. Save the `Check` and update the monitor in a **transaction**.
5. State machine:
   - success → if `DOWN`, resolve the open incident and emit `monitor.recovered`; set `UP`, reset `consecutiveFailures`.
   - failure → increment `consecutiveFailures`; at 2 (and not already `DOWN`) open an incident, set `DOWN`, emit `monitor.down`.
6. Overlap guard: if a run is in progress, a new trigger returns immediately. Note in `decisions.md` that multiple instances would need a Postgres advisory lock.
7. Log a summary `{ checked, up, down, durationMs }` and store the last run stats for the admin overview.

### 6.6 SSL check

`modules/checks/ssl.ts`: `tls.connect({ host, port: 443, servername: host })`, read `getPeerCertificate().valid_to`, close the socket, with a timeout. At most once per 24h per monitor. Emit `monitor.sslExpiring` when fewer than 14 days remain (max once a day).

### 6.7 Scheduler

`scheduler.ts` calls `runChecks()` every 60 seconds with `setInterval`, uses `.unref()`, runs once shortly after startup, and stops on shutdown. Controlled by `SCHEDULER_ENABLED` (default `true`; tests set it to `false` and call `runChecks()` directly).

### 6.8 Event bus, alerts and SSE

- `lib/events.ts`: a typed `EventEmitter`. Events carry `userId`. The runner only emits; it never calls email or SSE code directly.
- `modules/alerts`: on `monitor.down`, `monitor.recovered`, `monitor.sslExpiring`, email the **monitor owner** if `alertsEnabled`. Email errors are logged, never thrown into the runner.
- **SSE auth with stream tickets:** `EventSource` can't send an `Authorization` header, so:
  - `POST /api/stream/ticket` (authenticated) returns a random one-time ticket valid for 60 seconds, stored in memory with the userId.
  - `GET /api/stream?ticket=...` validates and consumes the ticket, then streams only that user's events.
  - Record this decision (and the alternatives: cookie auth, polling, WebSockets) in `decisions.md`.
- SSE details: correct headers, heartbeat comment every 25 seconds, **remove the listener on `req.on('close')`**, sensible `setMaxListeners`.

### 6.9 Creating the admin (credentials only in the database)

`npm run admin:create` runs `backend/scripts/create-admin.ts`:

- Uses `node:readline/promises` to prompt for email and password (password input hidden or at least not echoed; explain the approach), with confirmation.
- Validates with the same Zod rules as signup.
- If the email exists, offers to **promote** that user to `ADMIN` (and optionally reset the password); otherwise creates a new `ADMIN` user.
- Hashes the password with bcrypt before saving. Nothing is written to `.env` or logged.
- Also support a non-interactive form for scripting: `npm run admin:create -- --email a@b.com` reading the password from stdin.

There are **no** `ADMIN_EMAIL` or `ADMIN_PASSWORD` environment variables.

### 6.10 Admin API

All require `requireAuth` + `requireAdmin` (checks `role === 'ADMIN'` from the database, not just from the token, so a demoted admin loses access immediately).

- `GET /api/admin/stats`: user count, monitor count, monitors up/down, checks in last 24h, last run summary.
- `GET /api/admin/users?cursor=&limit=&search=`: email, role, isDisabled, createdAt, monitor count.
- `PATCH /api/admin/users/:id`: `{ isDisabled }`. Disabling revokes the user's refresh tokens. An admin cannot disable themselves.

### 6.11 Full API list

Errors always use `{ "error": { "code": string, "message": string, "details"?: unknown } }`. Document every endpoint with request/response examples in `docs/api.md`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Liveness |
| GET | `/ready` | none | Readiness (DB `SELECT 1`) |
| POST | `/api/auth/signup` | none | Create account |
| POST | `/api/auth/login` | none | Log in |
| POST | `/api/auth/refresh` | cookie | Rotate refresh token |
| POST | `/api/auth/logout` | cookie | Log out |
| GET | `/api/auth/me` | user | Current user |
| POST | `/api/auth/forgot-password` | none | Request reset email |
| POST | `/api/auth/reset-password` | none | Set new password with token |
| GET / PATCH / DELETE | `/api/account` | user | Settings / delete account |
| POST | `/api/account/change-password` | user | Change password |
| GET | `/api/monitors` | user | Own monitors + status + 24h uptime |
| POST | `/api/monitors` | user | Create (validation, SSRF, per-user limit) |
| GET | `/api/monitors/:id` | user | Detail + uptime 24h/7d/30d + avg response |
| PATCH | `/api/monitors/:id` | user | Update / pause / resume |
| DELETE | `/api/monitors/:id` | user | Delete |
| POST | `/api/monitors/:id/check-now` | user | Run one check immediately (rate-limited: once per minute) |
| GET | `/api/monitors/:id/checks?cursor=&limit=` | user | Cursor pagination |
| GET | `/api/monitors/:id/incidents` | user | Incidents |
| GET | `/api/monitors/:id/export.csv` | user | Streamed CSV |
| POST | `/api/stream/ticket` | user | One-time SSE ticket |
| GET | `/api/stream?ticket=` | ticket | SSE updates for this user |
| GET | `/api/admin/stats` | admin | System stats |
| GET | `/api/admin/users` | admin | Users list |
| GET | `/api/admin/monitors` | admin | All users' monitors (read-only) |
| PATCH | `/api/admin/users/:id` | admin | Disable / enable |

Every `/api/monitors/:id...` query filters by **both** `id` and `userId` (IDOR prevention); a test must prove user A gets `404` for user B's monitor. Uptime % is computed with a SQL aggregate, not in memory.

### 6.12 CSV export

Read checks in batches and write them through a `Transform` stream into the response with `stream/promises` `pipeline`, so memory stays flat. Set `Content-Type: text/csv` and `Content-Disposition`. Escape fields properly.

### 6.13 Startup and shutdown

- `config/env.ts` validates env with Zod; on failure, print what's wrong and exit 1.
- On `SIGTERM`/`SIGINT`: stop the scheduler, `server.close()`, end SSE connections, wait for an in-progress run (10s cap), close the mail transport, disconnect Prisma, exit.
- `unhandledRejection` / `uncaughtException`: log with Pino and exit 1.

### 6.14 Environment variables (`backend/.env.example`)

```
NODE_ENV=development
PORT=4000
APP_URL=http://localhost:5173
DATABASE_URL=postgresql://pulse:pulse@localhost:5432/pulsecheck
TEST_DATABASE_URL=postgresql://pulse:pulse@localhost:5433/pulsecheck_test
JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me-too
SCHEDULER_ENABLED=true
MAX_MONITORS_PER_USER=20
ALLOW_PRIVATE_TARGETS=false
SMTP_HOST=localhost
SMTP_PORT=1025
MAIL_FROM="PulseCheck <no-reply@pulsecheck.local>"
LOG_LEVEL=info
```

No admin credentials and no third-party API keys are needed to run the app locally.

---

## 7. Frontend screens

All forms: client-side validation mirroring the backend, clear field errors, disabled submit while pending, server error messages shown inline. Every page has loading, empty and error states, is responsive, and has accessible labels and visible keyboard focus.

| Route | Screen | Access | Notes |
|---|---|---|---|
| `/login` | **Login** | guest | Email, password, "Forgot password?" link, "Create an account" link. Redirects to `/dashboard` (or the page the user originally wanted) on success. |
| `/signup` | **Sign up** | guest | Email, password, confirm password, password strength hint. Logs in on success. |
| `/forgot-password` | **Forgot password** | guest | Email field. After submit, always shows "If an account exists, we've sent a reset link" (no enumeration). Link back to login. |
| `/reset-password?token=` | **Reset password** | guest | New password + confirm. On success, show a message and link to login. Handles invalid/expired token with a "request a new link" button. |
| `/dashboard` | **Dashboard** | user | Summary cards (total, up, down, avg response), monitors table/grid with status badge, response time, 24h uptime, SSL days left, last checked; actions: pause/resume, check now, edit, delete (with confirm). Live updates via SSE with a "live / reconnecting" indicator. Empty state with "Add your first monitor". Shows "x of 20 monitors used". |
| `/monitors/new`, `/monitors/:id/edit` | **Monitor form** | user | Name, URL, interval (min 5), timeout. |
| `/monitors/:id` | **Monitor detail** | user | Response-time chart (24h), uptime 24h/7d/30d, incidents list, checks table with "Load more" (cursor), "Download CSV". |
| `/account` | **Account** | user | Alert email toggle, change password, delete account (password confirmation). |
| `/admin` | **Admin overview** | admin | System stats cards, last run summary. |
| `/admin/users` | **Admin users** | admin | Searchable, paginated users list; disable/enable with confirm. |
| `*` | **Not found** | any | — |

App shell: top nav with Dashboard, Account, Admin (admins only), user email, Log out.

Auth handling: access token kept **in memory only** (never localStorage); on app load call `/api/auth/refresh` to restore the session; on any 401, refresh once and retry the request; if refresh fails, go to `/login`. `ProtectedRoute` and `AdminRoute` guard pages (the backend still enforces everything).

---

## 8. Documentation rules (required)

Create a short **`README.md`** at the root and a **`docs/`** folder. Docs are part of "done" for every milestone and must stay accurate.

**`README.md`**

- One-paragraph description and a screenshot placeholder.
- Feature list (user features and admin features).
- Tech stack.
- Quick start (the commands from section 14) with a link to `docs/installation.md`.
- Scripts reference table (`dev`, `test`, `lint`, `typecheck`, `db:migrate`, `db:seed`, `admin:create`, etc.).
- Links to every file in `docs/`.

**`docs/installation.md`** — installing and running locally

- Prerequisites: Node version (with `nvm use`), npm, Docker Desktop.
- Clone, install, copy `.env.example`, start Docker services, migrate, create admin, seed, run.
- How to open Mailpit and test the forgot-password flow end to end.
- How to log in as admin vs a normal user.
- Running tests, lint and type-check.
- Troubleshooting: port in use, DB connection refused, Prisma client not generated, emails not arriving, a site wrongly marked down (firewall / bot protection blocking the user agent).

**`docs/deployment.md`** — documentation only (no config files in the repo). Start with a note that the project is set up for local use and this guide explains how it *could* be deployed. Cover:

- The simplest production shape: **one Node service** that also serves the built React app (`express.static` + SPA fallback), plus a managed PostgreSQL. Explain why one service avoids CORS and cross-site cookie issues.
- Step-by-step example on Render (web service) + Neon (Postgres), including build and start commands and environment variables.
- Replacing Mailpit with a real SMTP provider.
- The free-tier sleep problem for the in-process scheduler and the options: an external cron hitting a protected endpoint, a paid always-on instance, or a separate worker. Note that free tiers change often; check current provider limits.
- A small VPS alternative (PM2 or systemd, Nginx reverse proxy, HTTPS with Let's Encrypt).
- A production checklist: secrets, `Secure` cookies, `trust proxy`, migrations with `prisma migrate deploy`, creating the admin with `admin:create` on the server, backups, log retention.

**`docs/architecture.md`** — how the app is built

- Mermaid component diagram (React app, Vite proxy, Express API, check runner, event bus, alerts/Nodemailer, SSE, Postgres, Mailpit).
- Mermaid sequence diagrams: (1) one check run from scheduler tick to dashboard update; (2) forgot-password flow; (3) refresh-token rotation.
- Mermaid state diagram of the monitor state machine.
- Middleware chain and request lifecycle.
- Folder structure and the layered module pattern.
- Data model and index choices; multi-tenancy (how every query is scoped to `userId`).

**`docs/api.md`** — every endpoint with method, auth, request body, response examples and error codes.

**`docs/node-concepts.md`** — for each concept in section 10: what it is (2–4 sentences), where it lives in this codebase (file + function), and a likely interview question with a short answer.

**`docs/decisions.md`** — short records (decision, alternatives, why, what changes at scale). At minimum: Express vs NestJS/Fastify, Prisma vs Drizzle, in-process scheduler vs cron vs queue (BullMQ), SSE vs WebSockets vs polling, SSE ticket auth, JWT + refresh vs sessions, token storage in memory vs localStorage, 2-failure threshold, overlap guard and multi-instance locking, SSRF strategy, admin creation via CLI instead of env.

---

## 9. Security checklist

- Passwords hashed with bcrypt (async); never logged or returned.
- Reset and refresh tokens stored only as hashes; reset tokens single-use with 30-minute expiry.
- No user enumeration on login or forgot password.
- Rate limiting on login, signup, forgot-password, reset-password, check-now.
- `helmet` headers; cookies `httpOnly` and `SameSite=Lax`.
- IDOR prevention on every resource; admin routes check role from the database.
- SSRF guard on monitor URLs, at save time, at check time and on redirects.
- Zod validation on every input; Prisma prevents SQL injection.
- Logs never include passwords, tokens or full cookies (configure Pino redaction).

---

## 10. Node.js concepts this project must demonstrate

Each must appear in the code and be explained in `docs/node-concepts.md`:

1. Event loop, microtasks vs timers; why blocking is bad (bcrypt async API, I/O-bound checker).
2. Async/await, `Promise.all` vs `Promise.allSettled`.
3. Concurrency limiting (`runWithLimit`); why `next++` needs no lock.
4. Timeouts and cancellation (`AbortSignal.timeout`, `AbortController`).
5. Retries with exponential backoff and jitter.
6. Timers: `setInterval`, `.unref()`, cleanup on shutdown.
7. `EventEmitter`: typed events, listener cleanup, `setMaxListeners`, leak avoidance.
8. Streams: partial body reading; `Transform` + `pipeline` for CSV; backpressure.
9. Networking: `node:dns` lookups and `node:net` IP checks (SSRF), `node:tls` certificates.
10. `crypto`: `randomBytes`, SHA-256 token hashing, `timingSafeEqual`.
11. CLI with `node:readline/promises` and `process.argv`/stdin (admin creation).
12. Express middleware order, central error handling, Express 5 async errors.
13. Validation with Zod; env validation at startup.
14. Auth: JWT access + rotating refresh tokens with reuse detection, password reset flow, roles.
15. Security: helmet, rate limiting, IDOR, SSRF, user enumeration.
16. Database: Prisma, migrations, transactions, indexes, cursor pagination, SQL aggregation, cascades.
17. Email with Nodemailer (SMTP) and a local catcher.
18. SSE real-time updates and ticket-based auth.
19. Structured logging with request IDs and redaction; health/readiness checks.
20. Process lifecycle: graceful shutdown, `unhandledRejection`, stateless processes and scaling.
21. Testing: unit, integration with Supertest + real test DB, mocking `fetch` and the mailer.
22. ES Modules, npm workspaces, scripts, `.env` handling.

---

## 11. Quality rules

- TypeScript strict, no `any` (use `unknown` and narrow).
- No secrets in Git; `.env` ignored, `.env.example` committed.
- Small, focused commits per milestone.
- One failing monitor never crashes a run; alert or SSE errors never crash the process.

---

## 12. Required tests (minimum)

- `runWithLimit`: respects the limit, preserves order, handles rejections.
- `retry`: retry count and give-up behaviour.
- State machine: UP → 1 failure stays UP → 2 failures DOWN + incident → success resolves.
- Checker with mocked `fetch`: 200, 301→200, 500, timeout.
- SSRF guard: blocks `127.0.0.1`, `10.x`, `169.254.169.254`, `::1`, a hostname resolving to a private IP, and a redirect to a private IP; allows a public IP.
- Auth: signup, duplicate email, login, wrong password (same message as unknown email), disabled user, refresh rotation, refresh reuse revokes family, logout.
- Forgot/reset: same response for known and unknown emails, email sent (mocked mailer), token works once, expired token rejected, sessions revoked after reset.
- Monitors: CRUD, validation, per-user limit, IDOR (user A cannot see user B's monitor).
- Admin: non-admin gets 403, admin can list and disable users, cannot disable self.
- CSV export: headers and escaping.
- Frontend: login form validation, forgot-password success message, ProtectedRoute redirect.

---

## 13. Milestones (build in this order)

1. **Scaffold**: workspaces, TypeScript, lint, Docker Compose (Postgres ×2, Mailpit), Express app with `/health` and `/ready`, env validation, logger, error handler, CI. Start README and `docs/installation.md`.
2. **Database + auth**: Prisma schema, migrations, signup/login/refresh/logout/me, `admin:create` CLI, seed script, tests.
3. **Password reset + account**: Nodemailer + Mailpit, forgot/reset flow, account endpoints, tests.
4. **Monitors API**: CRUD, validation, SSRF guard, per-user limit, IDOR protection, cursor pagination, uptime aggregation, tests.
5. **Check runner**: `runWithLimit`, `retry`, checker, SSL check, state machine, incidents, transactions, overlap guard, scheduler, check-now, tests.
6. **Events, alerts, SSE, CSV**: event bus, owner email alerts, SSE tickets and stream, streamed CSV, tests.
7. **Admin API**: stats, users list, disable/enable, tests.
8. **Frontend auth screens**: app shell, Login, Sign up, Forgot password, Reset password, auth provider, route guards, tests.
9. **Frontend app screens**: Dashboard with live updates, Monitor form, Monitor detail with chart and CSV, Account, Admin overview, Admin users.
10. **Hardening**: graceful shutdown, rate limits, log redaction, retention job.
11. **Docs pass**: complete every file in `docs/` (including `deployment.md` as documentation only), verify README links, and confirm a fresh clone works by following `docs/installation.md` exactly.

---

## 14. Definition of done

These commands take a fresh clone to a working app:

```bash
nvm use
npm install
cp backend/.env.example backend/.env
docker compose up -d
npm run db:migrate
npm run admin:create      # prompts for admin email and password; adds the 10 sample sites
npm run db:seed           # optional: re-adds the sample sites (idempotent)
npm run dev               # frontend http://localhost:5173, API http://localhost:4000
```

Then:

- The admin logs in and, within a few minutes, sees real results for all 10 seed sites.
- A new user can sign up, add their own URLs, and see only their own dashboard.
- Forgot password works end to end, with the email visible in Mailpit at `http://localhost:8025`.
- Down/recovery alerts appear in Mailpit for the monitor's owner.
- All tests pass; README and every `docs/` file are accurate.
- No deployment configuration exists in the repo; `docs/deployment.md` explains deployment.
- At the end, print a short summary: what was built, how to run it, and the 5 Node.js concepts most worth rehearsing for an interview, with the file where each lives.
