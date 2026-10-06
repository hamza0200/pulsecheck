# Architecture

How PulseCheck is put together: the moving parts, how a request and a check run flow through
them, and how the data is modelled. For why each choice was made, see
[decisions.md](./decisions.md). For the Node.js concepts behind the code, see
[node-concepts.md](./node-concepts.md).

## Components

```mermaid
flowchart LR
  subgraph Browser
    R["React app<br/>TanStack Query, EventSource"]
  end
  subgraph Dev["Vite dev server :5173"]
    P["/api proxy"]
  end
  subgraph API["Node.js process :4000"]
    X["Express app<br/>routes, controllers, services"]
    S["Scheduler<br/>setInterval 60s"]
    RUN["Check runner<br/>runWithLimit(5)"]
    BUS(["Event bus<br/>typed EventEmitter"])
    AL["Alerts<br/>Nodemailer"]
    SSE["SSE streams<br/>per user"]
  end
  DB[("PostgreSQL")]
  MP["Mailpit<br/>SMTP :1025, inbox :8025"]
  SITES(["Monitored websites"])

  R -->|"HTTP /api/*"| P --> X
  R <-.->|"text/event-stream"| P
  X --> DB
  S --> RUN
  X -->|"check now"| RUN
  RUN -->|"GET, TLS, DNS"| SITES
  RUN -->|"transaction"| DB
  RUN -->|"emit"| BUS
  BUS --> AL --> MP
  BUS --> SSE --> X
  X -->|"reset emails"| MP
```

Everything server-side runs in **one Node.js process**: the HTTP API, the scheduler, the
check runner, the event bus, and the SSE connections. That keeps local setup to a single
`npm run dev`. The places where this would have to change for several instances are listed
in [node-concepts.md §20](./node-concepts.md) and [decisions.md](./decisions.md).

## Frontend and the Vite dev proxy

In development the browser only ever talks to one origin, `http://localhost:5173`, which is
Vite. Vite serves the React app and forwards every request starting with `/api` to the
Express API on `http://localhost:4000` (`frontend/vite.config.ts` → `server.proxy`).

```mermaid
flowchart LR
  B[Browser] -->|"/ , /assets, /login …"| V[Vite dev server :5173]
  B -->|"/api/*"| V
  V -->|"proxy /api/* (+ X-Forwarded-For)"| E[Express API :4000]
```

Why it matters:

- **Same origin means no CORS.** The React app calls `fetch('/api/monitors')`, a relative
  URL. The API needs no CORS middleware and the browser sends no preflight `OPTIONS`
  requests.
- **Cookies just work.** The `pc_refresh` cookie is set by a response that came from
  `localhost:5173`, so the browser stores it for that origin and sends it back on
  `/api/auth/*` calls. With two origins we would need `credentials: 'include'`,
  `Access-Control-Allow-Credentials`, and `SameSite=None; Secure` cookies.
- **Real client IPs.** The proxy adds `X-Forwarded-For`, and Express trusts it only from
  loopback (`app.set('trust proxy', 'loopback')`), so rate limits see the real client.
- **SSE streams pass through unbuffered.** The proxy config leaves `text/event-stream`
  responses alone (`Cache-Control: no-transform`).

In production the same property comes from serving the built React app from Express itself
(see [deployment.md](./deployment.md)).

## Request lifecycle and middleware chain

`backend/src/app.ts` registers middleware in this order. Every request passes through the
global layers top to bottom; route-level middleware runs only for matching routes.

```mermaid
flowchart TD
  A["Incoming request"] --> B["requestLogger (pino-http)<br/>request id, X-Request-Id header, masked URL"]
  B --> C["helmet<br/>security headers"]
  C --> D["express.json (100 kb limit)"]
  D --> E["cookie-parser"]
  E --> F{"/health, /ready?"}
  F -->|yes| H["health router (no auth, no limits)"]
  F -->|no| G["global /api rate limit<br/>300 per minute per IP"]
  G --> I["module router<br/>/api/auth, /account, /monitors, /stream, /admin"]
  I --> J["route rate limiter (login, signup, reset, check-now…)"]
  J --> K["requireAuth → requireAdmin (where needed)"]
  K --> L["validate (Zod: params, query, body)"]
  L --> M["controller → service → repository → Prisma"]
  M --> N["JSON response"]
  I -->|"no route matched"| O["notFoundHandler → 404"]
  M -->|"thrown error / rejected promise"| P["errorHandler<br/>AppError, ZodError → 4xx; anything else → logged 500"]
```

- **`requireAuth`** verifies the Bearer JWT, then loads the user by primary key. A disabled
  user gets `403` immediately, and `req.user` comes from the database row.
- **`requireAdmin`** checks `req.user.role`, which came from the database, not from the
  token.
- **`validate`** replaces `req.body`, `req.query` and `req.params` with Zod's parsed,
  coerced and normalised output. Controllers declare those types through Express's
  `RequestHandler` generics.
- **Errors:** Express 5 forwards rejected promises from async handlers to `errorHandler`.
  It is the only place that turns errors into responses, always in the
  `{ error: { code, message, details? } }` shape.

## Folder structure and the layered module pattern

```
backend/src/
├── server.ts           process lifecycle: listen, scheduler, signals, graceful shutdown
├── app.ts              builds the Express app (no listen), used by server.ts and by tests
├── config/env.ts       Zod-validated environment, loaded once
├── lib/                cross-cutting tools with no HTTP knowledge
│   ├── logger, errors, prisma, mailer, tokens, password, rateLimit
│   ├── concurrency (runWithLimit), retry, events (typed bus), csv, ssrf-guard
├── middleware/         requestId/logging, requireAuth, requireAdmin, validate, errorHandler
├── modules/<feature>/  one folder per feature
│   ├── *.routes.ts       URL → middleware chain → controller
│   ├── *.controller.ts   HTTP only: read req, call the service, write res
│   ├── *.service.ts      business rules; never touches req/res
│   ├── *.repository.ts   Prisma queries (always scoped by userId where relevant)
│   └── *.schemas.ts      Zod request schemas and their inferred types
└── generated/prisma/   Prisma client (generated, git-ignored)
```

Modules: `auth`, `account`, `monitors`, `checks` (checker, ssl, runner, scheduler, state
machine, retention), `incidents`, `alerts`, `stream`, `admin`, `health`.

The layers point one way: routes → controller → service → repository. Services can be called
from places other than HTTP, for example `checkMonitorById` is used by both the scheduler and
the check-now endpoint. Modules that need to react to each other communicate through the
event bus, so neither imports the other: the runner emits `monitor.down` and alerts listens;
admin emits `user.disabled` and the stream module listens.

## One check run, from scheduler tick to dashboard update

```mermaid
sequenceDiagram
  autonumber
  participant T as Scheduler (setInterval 60s)
  participant R as Runner
  participant G as SSRF guard
  participant W as Website
  participant D as PostgreSQL
  participant E as Event bus
  participant M as Alerts / Mailpit
  participant S as SSE stream
  participant B as Browser

  T->>R: runChecks()
  alt a run is already in progress
    R-->>T: null (overlap guard)
  end
  R->>D: SELECT due monitors (not paused, owner active, interval elapsed)
  loop runWithLimit(tasks, 5): at most 5 checks at once
    R->>G: dns.lookup(host, all) → refuse private addresses
    R->>W: GET (User-Agent, AbortSignal.timeout, redirect manual)
    W-->>R: 301 Location
    R->>G: validate the redirect target
    R->>W: GET target → 200, read ≤ 64 KB, cancel
    Note over R: network error or timeout → retry once (backoff + jitter)
    R->>D: BEGIN, SELECT monitor FOR UPDATE, INSERT check,<br/>open/resolve incident, UPDATE monitor, COMMIT
    R->>E: emit monitor.checked (+ monitor.down / monitor.recovered)
    E->>M: owner has alerts on → send email
    E->>S: owner has an open stream → write SSE event
    S-->>B: event: monitor.checked
    B->>B: invalidate queries → refetch /api/monitors
  end
  R->>R: log summary { checked, up, down, durationMs }, store for /api/admin/stats
```

Daily, per HTTPS monitor, the runner also opens a TLS connection to the vetted IP to read the
certificate's expiry, and emits `monitor.sslExpiring` when fewer than 14 days remain.

## Monitor state machine

`nextState()` in `backend/src/modules/checks/state-machine.ts`:

```mermaid
stateDiagram-v2
  [*] --> UNKNOWN: monitor created (or URL changed)
  UNKNOWN --> UP: check succeeds
  UNKNOWN --> UNKNOWN: 1st failure
  UNKNOWN --> DOWN: 2nd consecutive failure / open incident, emit monitor.down
  UP --> UP: success / failures reset to 0
  UP --> UP: 1st failure (failures = 1)
  UP --> DOWN: 2nd consecutive failure / open incident, emit monitor.down
  DOWN --> DOWN: further failures (no new incident or email)
  DOWN --> UP: one success / resolve incident, emit monitor.recovered
```

Paused monitors and monitors of disabled owners are simply not selected as due, so their
state stays frozen until they are resumed or re-enabled.

## Auth

### Frontend pieces

| Piece        | File                                 | Role                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API client   | `frontend/src/api/client.ts`         | Keeps the access token in a module variable (memory only), adds `Authorization: Bearer`, refreshes once on 401 and retries, and shares one in-flight refresh between concurrent callers                                                      |
| Auth context | `frontend/src/auth/AuthProvider.tsx` | `status` (`loading`/`authenticated`/`guest`), `user`, `login`, `signup`, `logout`. On load it calls `/api/auth/refresh` to restore the session from the cookie. If a refresh fails mid-session it becomes a guest and clears the query cache |
| Route guards | `frontend/src/auth/guards.tsx`       | `ProtectedRoute` sends guests to `/login` and remembers where they were going. `GuestRoute` sends logged-in users onward (back to that page, or `/dashboard`). `AdminRoute` shows "Admins only" to non-admins                                |

The guards are for user experience only. Every rule is enforced again by the API.

### Refresh-token rotation

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (React)
  participant A as API /api/auth/refresh
  participant D as PostgreSQL

  Note over B: Page load or access token expired (401)
  B->>A: POST /refresh (cookie pc_refresh = token T1)
  A->>A: verify JWT signature/expiry, read jti + family
  A->>D: find refresh_tokens row by jti
  A->>A: timingSafeEqual(sha256(T1), row.token_hash)
  alt row already revoked
    A->>D: revoke every live token in the family
    A-->>B: 401 REFRESH_TOKEN_REUSED (if the family had a live token) or INVALID_REFRESH_TOKEN
  else valid
    A->>D: BEGIN, UPDATE … SET revoked_at = now() WHERE id = jti AND revoked_at IS NULL
    A->>D: INSERT new token T2 (same family, hash only), COMMIT
    A-->>B: 200 { accessToken, user } + Set-Cookie pc_refresh = T2
  end
  Note over B: Access token kept in memory only, T2 lives in the httpOnly cookie
```

### Forgot / reset password

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as API
  participant D as PostgreSQL
  participant M as Mailpit (SMTP)
  participant U as User's inbox

  B->>A: POST /api/auth/forgot-password { email }
  A->>D: find user by lowercase email
  alt user exists and is active
    A->>A: token = randomBytes(32), hash = sha256(token)
    A->>D: BEGIN, delete unused tokens of user, INSERT hash, expires in 30 min, COMMIT
    A--)M: send email in the background (not awaited)
  end
  A-->>B: 200 "If an account exists…" (identical either way)
  M-->>U: link APP_URL/reset-password?token=…
  U->>B: open link
  B->>A: POST /api/auth/reset-password { token, password }
  A->>D: find row by sha256(token), unused, not expired
  alt not found
    A-->>B: 400 INVALID_OR_EXPIRED_TOKEN
  else found
    A->>D: BEGIN, mark used (only if still unused), UPDATE password_hash,<br/>revoke all refresh tokens, COMMIT
    A-->>B: 200, every session signed out
  end
```

## Frontend data flow and live updates

- **Server state lives in TanStack Query** (`frontend/src/api/*.ts`). Query keys are grouped
  under `['monitors', …]`. Every monitor mutation (create, update, pause, check now, delete)
  invalidates that group, so all screens refetch consistent data. Lists with pagination
  (check history, admin users) use `useInfiniteQuery` with the API's opaque `nextCursor`.
- **Live updates** (`frontend/src/hooks/useStatusStream.ts`):
  1. `POST /api/stream/ticket` with the access token.
  2. `new EventSource('/api/stream?ticket=…')`.
  3. On `monitor.checked`, refetch the monitor list (and that monitor's detail), batched over
     500 ms because a run delivers up to 5 results at once.
  4. On `monitor.down` / `monitor.recovered`, show a polite live-region notice.
  5. On error, close the stream and reconnect with a **new** ticket, using exponential backoff
     with jitter (tickets are single-use, so `EventSource`'s own reconnect can't work).
     After reconnecting, refetch once to catch up on anything missed.
- **The dashboard is the triage view:** down monitors sort first. Each row has a 30-check
  status strip, where failures are taller red ticks so they don't rely on colour alone.
  Status badges pair a word with a glyph.
- **CSV download:** a plain link can't send the `Authorization` header, so the client fetches
  `export.csv` and saves the blob with a temporary object URL.
- **Code splitting:** the monitor detail page, the only one using Recharts, is lazy-loaded
  through React Router's `lazy` route option.

## Data model

```mermaid
erDiagram
  users ||--o{ monitors : owns
  users ||--o{ refresh_tokens : has
  users ||--o{ password_reset_tokens : has
  monitors ||--o{ checks : records
  monitors ||--o{ incidents : has

  users {
    uuid id PK
    text email UK "stored lowercase"
    text password_hash "bcrypt"
    enum role "USER or ADMIN"
    bool is_disabled
    bool alerts_enabled
  }
  refresh_tokens {
    uuid id PK "the JWT's jti"
    uuid user_id FK
    uuid family_id "one per login"
    text token_hash UK "sha256"
    timestamptz expires_at
    timestamptz revoked_at
  }
  password_reset_tokens {
    uuid id PK
    uuid user_id FK
    text token_hash UK "sha256"
    timestamptz expires_at "30 min"
    timestamptz used_at
  }
  monitors {
    uuid id PK
    uuid user_id FK
    text url "unique per user"
    int interval_minutes "min 5"
    int timeout_ms
    bool is_paused
    enum current_status "UNKNOWN UP DOWN"
    int consecutive_failures
    timestamptz last_checked_at
    timestamptz ssl_expires_at
  }
  checks {
    uuid id PK
    uuid monitor_id FK
    timestamptz checked_at
    bool is_up
    int status_code
    int response_time_ms
    text error
  }
  incidents {
    uuid id PK
    uuid monitor_id FK
    timestamptz started_at
    timestamptz resolved_at "null while open"
    text cause
  }
```

Every foreign key is `ON DELETE CASCADE`. Deleting a user removes their monitors, checks,
incidents and tokens in one statement.

### Index choices

| Index                                                          | Serves                                                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checks (monitor_id, checked_at DESC)`                         | Latest check per monitor (`LATERAL … LIMIT 1`), the 30-check status strip, keyset pagination of history, 24h/7d/30d uptime windows, CSV export batches |
| `checks (checked_at)`                                          | Retention deletes (`checked_at < cutoff`) and the admin "checks in last 24h" count                                                                     |
| `monitors (user_id, url)` unique                               | Duplicate prevention per user, and "my monitors" lookups (leading column `user_id`)                                                                    |
| `monitors (is_paused, last_checked_at)`                        | The runner's due-monitor query                                                                                                                         |
| `incidents (monitor_id, started_at DESC)`                      | Incidents list per monitor, finding the open incident                                                                                                  |
| `refresh_tokens (family_id)`, `(user_id)`, `token_hash` unique | Revoking a family on reuse, revoking all of a user's sessions, lookup by hash                                                                          |
| `users (email)` unique, `(created_at)`                         | Login lookup; admin users list ordered newest first                                                                                                    |

Uptime percentages are computed in SQL with `COUNT(*) FILTER (WHERE …)`, so check rows are
never loaded into Node to be counted. Checks older than 30 days are deleted daily in batches
of 5,000 (`backend/src/modules/checks/retention.ts`).

### Multi-tenancy: every query scoped to `userId`

Users share tables; isolation is enforced in the repository layer:

- Every monitor query takes both the monitor id and the caller's `userId`
  (`findFirst({ where: { id, userId } })`, `updateMany` / `deleteMany` with both). Someone
  else's monitor is indistinguishable from a missing one, so both return `404`. A test hits
  every `/api/monitors/:id…` endpoint as another user and expects `404` each time.
- Checks and incidents are only reachable through their monitor, after the ownership check.
- SSE streams filter events by `userId`, and the payload sent to the browser has the owner
  id stripped.
- Alert emails go only to the monitor's owner, re-read from the database at send time, and
  only if `alerts_enabled` is on and the owner isn't disabled.
- Admin endpoints are the only cross-tenant views. They return counts and account metadata,
  never password hashes or tokens.
