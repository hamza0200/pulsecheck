# API reference

Base URL in development: `http://localhost:5173/api` (through the Vite proxy) or
`http://localhost:4000/api` (directly). `/health` and `/ready` are at the root.

## Conventions

- **Requests and responses are JSON** unless stated otherwise (CSV export, SSE stream).
- **Authentication:** endpoints marked _user_ or _admin_ need
  `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes. Get a new one from
  `POST /api/auth/refresh`, which uses the `pc_refresh` httpOnly cookie.
- **Errors** always have this shape:

  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": {} } }
  ```

  `details` appears only for validation errors, as
  `{ "formErrors": string[], "fieldErrors": { "<field>": string[] } }`.

- **Rate limits:** every `/api` route shares a ceiling of 300 requests per minute per IP.
  Sensitive routes have tighter limits of their own, listed with each endpoint. Limited
  responses are `429 RATE_LIMITED` with standard `RateLimit` and `RateLimit-Policy` headers.
- **Every response** carries an `X-Request-Id` header. Quote it when reporting a problem; the
  same id is on every server log line for that request.

### Common error codes

| Status | Code               | When                                                    |
| ------ | ------------------ | ------------------------------------------------------- |
| 400    | `VALIDATION_ERROR` | Body, query or params failed Zod validation             |
| 400    | `INVALID_BODY`     | Body isn't valid JSON                                   |
| 401    | `UNAUTHORIZED`     | Missing, invalid or expired access token                |
| 403    | `ACCOUNT_DISABLED` | The account was disabled by an admin                    |
| 403    | `ADMIN_ONLY`       | Admin endpoint called by a non-admin                    |
| 404    | `NOT_FOUND`        | Unknown route, or a resource that isn't yours           |
| 429    | `RATE_LIMITED`     | Too many requests; see the `RateLimit` response headers |
| 500    | `INTERNAL_ERROR`   | Unexpected server error (details are only in the logs)  |

---

## Health

### `GET /health`

Liveness. No auth. Never touches the database.

```json
200 { "status": "ok", "uptimeSeconds": 42 }
```

### `GET /ready`

Readiness. No auth. Runs `SELECT 1` against PostgreSQL.

```json
200 { "status": "ready" }
503 { "error": { "code": "NOT_READY", "message": "Database is not reachable" } }
```

---

## Auth

The `pc_refresh` cookie is `HttpOnly`, `SameSite=Lax`, `Path=/api/auth`, valid for 7 days,
and `Secure` whenever `APP_URL` isn't localhost. Endpoints that start a session respond with:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": "uuid", "email": "ada@example.com", "role": "USER", "alertsEnabled": true }
}
```

### `POST /api/auth/signup`

No auth. Rate limit: 20 per hour per IP.

```json
{ "email": "Ada@Example.com", "password": "correct-horse-battery" }
```

- Email is trimmed and lowercased. Password: at least 10 characters, at most 72 bytes, not
  in the built-in common-password list.
- Always creates a `USER`. Any `role` field in the body is ignored.

| Status | Body / code                  |
| ------ | ---------------------------- |
| 201    | Session (see above) + cookie |
| 400    | `VALIDATION_ERROR`           |
| 409    | `EMAIL_TAKEN`                |
| 429    | `RATE_LIMITED`               |

### `POST /api/auth/login`

No auth. Rate limit: 10 attempts per 15 minutes per IP + email.

```json
{ "email": "ada@example.com", "password": "correct-horse-battery" }
```

| Status | Body / code                                                            |
| ------ | ---------------------------------------------------------------------- |
| 200    | Session + cookie                                                       |
| 401    | `INVALID_CREDENTIALS` (identical for unknown email and wrong password) |
| 403    | `ACCOUNT_DISABLED` (only after a correct password)                     |
| 429    | `RATE_LIMITED`                                                         |

### `POST /api/auth/refresh`

Auth: `pc_refresh` cookie. No body. Rotates the refresh token: the old one is revoked and a
new cookie is set.

| Status | Body / code                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------- |
| 200    | Session + new cookie                                                                           |
| 401    | `INVALID_REFRESH_TOKEN`: missing, invalid or expired cookie (cookie cleared)                   |
| 401    | `REFRESH_TOKEN_REUSED`: a revoked token was replayed; every session from that login is revoked |
| 403    | `ACCOUNT_DISABLED`                                                                             |

### `POST /api/auth/logout`

Auth: `pc_refresh` cookie (optional). Revokes the current refresh token and clears the
cookie. Always returns `204`.

### `GET /api/auth/me`

Auth: user.

```json
200 { "user": { "id": "uuid", "email": "ada@example.com", "role": "USER", "alertsEnabled": true } }
```

### `POST /api/auth/forgot-password`

No auth. Rate limit: 5 per 15 minutes per IP + email.

```json
{ "email": "ada@example.com" }
```

Always responds the same way, whether or not the account exists:

```json
200 { "message": "If an account exists for that email, we've sent a link to reset the password." }
```

If the account exists and isn't disabled, older unused reset links are invalidated and an
email with `${APP_URL}/reset-password?token=<token>` is sent in the background. The link is
single-use and expires after 30 minutes. Only a SHA-256 hash of the token is stored.

### `POST /api/auth/reset-password`

No auth. Rate limit: 10 per 15 minutes per IP.

```json
{ "token": "<token from the email link>", "password": "a-new-password-123" }
```

| Status | Body / code                                                          |
| ------ | -------------------------------------------------------------------- |
| 200    | `{ "message": "Your password has been reset. You can now log in." }` |
| 400    | `INVALID_OR_EXPIRED_TOKEN`: unknown, used or expired token           |
| 400    | `VALIDATION_ERROR`: the new password breaks the password rules       |

On success every refresh token of that user is revoked, which signs out all sessions.

---

## Account

All endpoints need a user access token.

### `GET /api/account`

```json
200 {
  "account": {
    "id": "uuid",
    "email": "ada@example.com",
    "role": "USER",
    "alertsEnabled": true,
    "createdAt": "2026-10-06T08:00:00.000Z"
  }
}
```

### `PATCH /api/account`

Only `alertsEnabled` can be changed. Unknown fields such as `role` are rejected with `400`.

```json
{ "alertsEnabled": false }
```

Returns `200 { "account": { … } }`.

### `POST /api/account/change-password`

Rate limit: 10 per 15 minutes per IP.

```json
{ "currentPassword": "old-password-123", "newPassword": "new-password-456" }
```

| Status | Body / code                                                               |
| ------ | ------------------------------------------------------------------------- |
| 200    | `{ "message": "Password changed. Other sessions have been signed out." }` |
| 400    | `INVALID_PASSWORD` (`details.fieldErrors.currentPassword`)                |
| 400    | `VALIDATION_ERROR`: weak new password, or the same as the current one     |

Every other session is revoked. The session making the request stays logged in: the access
token's `sid` claim identifies its refresh-token family.

### `DELETE /api/account`

Rate limit: 10 per 15 minutes per IP.

```json
{ "password": "my-password-123" }
```

| Status | Body / code                                                                            |
| ------ | -------------------------------------------------------------------------------------- |
| 204    | Deleted. Monitors, checks, incidents and tokens are removed by cascade; cookie cleared |
| 400    | `INVALID_PASSWORD`                                                                     |
| 409    | `LAST_ADMIN`: the only active admin can't delete their account                         |

---

## Monitors

All endpoints need a user access token. Every `/api/monitors/:id…` query filters by both
`id` and the caller's `userId`: another user's monitor returns `404 MONITOR_NOT_FOUND`, the
same as a monitor that doesn't exist. `:id` must be a UUID (else `400 VALIDATION_ERROR`).

### The monitor object

```json
{
  "id": "0aec55c0-49af-4307-96f8-10d0846e9d73",
  "name": "example.com",
  "url": "https://example.com",
  "intervalMinutes": 10,
  "timeoutMs": 10000,
  "isPaused": false,
  "currentStatus": "UP",
  "consecutiveFailures": 0,
  "lastCheckedAt": "2026-10-06T09:10:00.000Z",
  "sslExpiresAt": "2027-01-01T23:59:59.000Z",
  "sslCheckedAt": "2026-10-06T09:10:01.000Z",
  "createdAt": "2026-10-06T08:00:00.000Z",
  "updatedAt": "2026-10-06T09:10:00.000Z"
}
```

`currentStatus` is `UNKNOWN` (never checked), `UP` or `DOWN`. A monitor becomes `DOWN` only
after 2 consecutive failed checks.

### `GET /api/monitors`

Your monitors with their latest check and 24h uptime (computed with a SQL aggregate), plus
usage against the per-user limit.

```json
200 {
  "monitors": [
    {
      "...": "monitor fields",
      "lastCheck": {
        "monitorId": "uuid",
        "checkedAt": "2026-10-06T09:10:00.000Z",
        "isUp": true,
        "statusCode": 200,
        "responseTimeMs": 182,
        "error": null
      },
      "uptime24h": 99.31,
      "recentChecks": [
        { "checkedAt": "2026-10-06T08:50:00.000Z", "isUp": true },
        { "checkedAt": "2026-10-06T09:00:00.000Z", "isUp": false },
        { "checkedAt": "2026-10-06T09:10:00.000Z", "isUp": true }
      ]
    }
  ],
  "usage": { "used": 10, "max": 20 }
}
```

`lastCheck` and `uptime24h` are `null` until the first check. `recentChecks` holds the last
30 checks, oldest first (the dashboard's status strip); it comes from one `LATERAL … LIMIT 30`
query for all monitors.

### `POST /api/monitors`

```json
{ "url": "https://example.com", "name": "Example", "intervalMinutes": 10, "timeoutMs": 10000 }
```

| Field             | Rules                                                                                        | Default                 |
| ----------------- | -------------------------------------------------------------------------------------------- | ----------------------- |
| `url`             | required; `http`/`https`; port 80/443 only; no `user:pass@`; must resolve to public IPs only | —                       |
| `name`            | 1–100 characters                                                                             | hostname without `www.` |
| `intervalMinutes` | integer 5–1440                                                                               | 10                      |
| `timeoutMs`       | integer 1000–30000                                                                           | 10000                   |

URLs are normalised (lowercase host, no `#fragment`, no trailing `/` on a bare domain), so
`https://Example.com/` and `https://example.com` count as the same monitor.

| Status | Body / code                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------- |
| 201    | `{ "monitor": { … } }`                                                                                                  |
| 400    | `VALIDATION_ERROR`, or an SSRF code with `details.fieldErrors.url`:                                                     |
|        | `INVALID_URL`, `UNSUPPORTED_PROTOCOL`, `UNSUPPORTED_PORT`, `CREDENTIALS_IN_URL`, `UNRESOLVABLE_HOST`, `PRIVATE_ADDRESS` |
| 409    | `MONITOR_EXISTS`: you already monitor this URL                                                                          |
| 409    | `MONITOR_LIMIT_REACHED`: you have `MAX_MONITORS_PER_USER` monitors (default 20)                                         |

### `GET /api/monitors/:id`

The monitor, its latest check, and stats over the last 24 hours, 7 days and 30 days.

```json
200 {
  "monitor": {
    "...": "monitor fields",
    "lastCheck": { "...": "as above" },
    "stats": {
      "uptime24h": 99.31,
      "uptime7d": 99.8,
      "uptime30d": 99.95,
      "avgResponseMs24h": 210,
      "checks24h": 144
    }
  }
}
```

Uptime values are percentages rounded to 2 decimals, or `null` when there are no checks in
that window. `avgResponseMs24h` averages successful checks only.

### `PATCH /api/monitors/:id`

Any subset of `name`, `url`, `intervalMinutes`, `timeoutMs`, `isPaused` (same rules as
create; at least one field). Pause with `{ "isPaused": true }` and resume with `false`.
Changing `url` re-runs the SSRF guard, resets the status to `UNKNOWN`, clears SSL data and
closes any open incident. Returns `200 { "monitor": { … } }`; errors as for create, plus
`404`.

### `DELETE /api/monitors/:id`

`204`. Checks and incidents are deleted with it (cascade). `404` if it isn't yours.

### `GET /api/monitors/:id/checks?cursor=&limit=&since=`

Check history, newest first, with keyset (cursor) pagination.

| Query    | Rules                                                                      |
| -------- | -------------------------------------------------------------------------- |
| `limit`  | 1–500, default 50                                                          |
| `cursor` | the `nextCursor` from the previous page (opaque)                           |
| `since`  | optional ISO 8601 timestamp: only checks after it (used for the 24h chart) |

```json
200 {
  "checks": [
    {
      "id": "uuid",
      "checkedAt": "2026-10-06T09:10:00.000Z",
      "isUp": false,
      "statusCode": 503,
      "responseTimeMs": 87,
      "error": "HTTP 503"
    }
  ],
  "nextCursor": "MjAyNi0xMC0wNlQwOToxMDowMC4wMDBafDZm..."
}
```

`nextCursor` is `null` on the last page. A malformed cursor returns `400 INVALID_CURSOR`.

### `GET /api/monitors/:id/incidents?limit=`

Most recent incidents first. `limit` 1–100, default 20.

```json
200 {
  "incidents": [
    { "id": "uuid", "startedAt": "2026-10-06T09:00:00.000Z", "resolvedAt": null, "cause": "HTTP 503" }
  ]
}
```

`resolvedAt: null` means the incident is still open (the site is down).

### `POST /api/monitors/:id/check-now`

Runs one check immediately, outside the schedule (works on paused monitors too). It goes
through the same pipeline as scheduled checks: SSRF guard, retry, state machine, incidents,
events. Rate limit: once per minute per user and monitor.

```json
200 {
  "check": {
    "checkedAt": "2026-10-06T12:49:42.167Z",
    "isUp": false,
    "statusCode": null,
    "responseTimeMs": null,
    "error": "CERT_HAS_EXPIRED: certificate has expired"
  },
  "monitor": { "...": "same as GET /api/monitors/:id" }
}
```

| Status | Code                                                            |
| ------ | --------------------------------------------------------------- |
| 404    | `MONITOR_NOT_FOUND`                                             |
| 409    | `CHECK_IN_PROGRESS`: the scheduler is checking this monitor now |
| 429    | `RATE_LIMITED`                                                  |

#### How a check is judged

- `GET` with `User-Agent: PulseCheck/1.0 (local uptime monitor)` and the monitor's timeout
  for the whole attempt.
- Redirects are followed manually, up to 5 hops, and each hop passes the SSRF guard.
- At most the first 64 KB of the body is read, then the stream is cancelled.
- A final 2xx or 3xx response is **up**. 4xx/5xx, timeouts, DNS and TLS errors are **down**.
- Timeouts and network errors are retried once (exponential backoff with jitter) before being
  recorded. HTTP error statuses are not retried.
- Typical `error` values: `HTTP 503`, `Timed out after 10000 ms`, `ENOTFOUND: …`,
  `ECONNREFUSED: …`, `CERT_HAS_EXPIRED: certificate has expired`,
  `Blocked redirect to http://10.0.0.1/: …`, `Too many redirects (more than 5)`.

### `GET /api/monitors/:id/export.csv`

Streams the monitor's full check history as CSV, oldest first. Rows are read from the
database in batches of 1,000 and streamed straight to the client, so memory stays flat
however long the history is.

```
200
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="example.com-checks-2026-10-06.csv"

checked_at,is_up,status_code,response_time_ms,error
2026-10-06T13:06:07.438Z,false,,,CERT_HAS_EXPIRED: certificate has expired
2026-10-06T13:16:07.102Z,true,200,182,
```

- Lines end with CRLF. Fields with commas, quotes or newlines are quoted (RFC 4180).
- Text starting with `=`, `+`, `-` or `@` is prefixed with `'` so spreadsheets don't run it
  as a formula.
- `404 MONITOR_NOT_FOUND` if the monitor isn't yours.
- Because the access token goes in the `Authorization` header, the web app downloads it with
  `fetch` and saves the blob. A plain link can't send the header.

---

## Live updates (Server-Sent Events)

`EventSource` can't send an `Authorization` header, so opening the stream takes two steps.

### `POST /api/stream/ticket`

Auth: user.

```json
201 { "ticket": "x7Q2…43 random characters", "expiresInSeconds": 60 }
```

The ticket is random, single-use, valid for 60 seconds, and held in server memory.

### `GET /api/stream?ticket=<ticket>`

No other auth. Consumes the ticket and keeps the response open as a `text/event-stream`.

| Status | Code                                                                   |
| ------ | ---------------------------------------------------------------------- |
| 200    | Stream opened                                                          |
| 400    | `VALIDATION_ERROR`: no `ticket` query parameter                        |
| 401    | `INVALID_TICKET`: unknown, expired or already used (get a new ticket)  |
| 503    | `TOO_MANY_STREAMS`: more than 10 streams for this user, or 200 overall |

You only receive events for **your own** monitors:

```
retry: 5000

event: ready
data: {"connectedAt":"2026-10-06T13:06:04.258Z"}

event: monitor.checked
data: {"monitorId":"…","name":"example.com","url":"https://example.com","status":"UP","checkedAt":"…","isUp":true,"statusCode":200,"responseTimeMs":182,"error":null,"consecutiveFailures":0}

event: monitor.down
data: {"monitorId":"…","name":"example.com","url":"https://example.com","cause":"HTTP 503","startedAt":"…"}

event: monitor.recovered
data: {"monitorId":"…","name":"example.com","url":"https://example.com","downSince":"…","recoveredAt":"…"}

: heartbeat
```

- A `: heartbeat` comment every 25 seconds keeps proxies from closing the idle connection.
- If the connection drops, get a **new** ticket before reconnecting: tickets are single-use,
  so `EventSource`'s built-in automatic reconnect would get a 401.

---

## Admin

Every admin endpoint runs `requireAuth` and then `requireAdmin`. The role is read from the
database on each request, not from the token, so a demoted admin loses access immediately.
No admin endpoint ever returns password hashes or tokens.

| Status | Code                                       |
| ------ | ------------------------------------------ |
| 401    | `UNAUTHORIZED`: no or invalid access token |
| 403    | `ADMIN_ONLY`: the caller isn't an admin    |

### `GET /api/admin/stats`

```json
200 {
  "users": { "total": 2, "admins": 1, "disabled": 0 },
  "monitors": { "total": 10, "up": 9, "down": 0, "unknown": 1, "paused": 0 },
  "checksLast24h": 10,
  "lastRun": {
    "checked": 10,
    "up": 9,
    "down": 1,
    "errors": 0,
    "durationMs": 8138,
    "startedAt": "2026-10-06T14:28:35.230Z",
    "finishedAt": "2026-10-06T14:28:43.367Z"
  },
  "schedulerEnabled": true
}
```

- `lastRun` is `null` until the scheduler has completed a run since the process started (it
  lives in memory). Ticks that find nothing due don't replace it, so it always describes the
  last run that actually checked something.
- `lastRun.down` counts failed checks in that run. `monitors.down` counts monitors currently
  in the `DOWN` state, which needs 2 consecutive failures.

### `GET /api/admin/users?cursor=&limit=&search=`

Newest users first. `limit` 1–100 (default 20). `search` is a case-insensitive substring
match on email. `cursor` is the previous page's `nextCursor`.

```json
200 {
  "users": [
    {
      "id": "uuid",
      "email": "ada@example.com",
      "role": "USER",
      "isDisabled": false,
      "createdAt": "2026-10-06T14:28:31.000Z",
      "monitorCount": 3
    }
  ],
  "nextCursor": null
}
```

### `GET /api/admin/monitors?cursor=&limit=&search=&userId=&status=`

Every user's monitors, newest first. This is a **read-only** view: admins can see each
monitor's URL, status and owner, but only the owner can change a monitor.

| Query    | Rules                                                         |
| -------- | ------------------------------------------------------------- |
| `limit`  | 1–100, default 25                                             |
| `cursor` | the previous page's `nextCursor`                              |
| `search` | case-insensitive match on URL, monitor name or owner email    |
| `userId` | only this user's monitors (the Users tab links here)          |
| `status` | `UP`, `DOWN` or `UNKNOWN` (active monitors only), or `PAUSED` |

```json
200 {
  "monitors": [
    {
      "id": "uuid",
      "name": "bobs-shop.com",
      "url": "https://bobs-shop.com",
      "intervalMinutes": 5,
      "isPaused": false,
      "currentStatus": "DOWN",
      "lastCheckedAt": "2026-10-06T16:40:00.000Z",
      "sslExpiresAt": null,
      "createdAt": "2026-10-06T16:30:00.000Z",
      "owner": { "id": "uuid", "email": "bob@example.com", "isDisabled": false }
    }
  ],
  "nextCursor": null
}
```

`400 VALIDATION_ERROR` for an invalid `userId` or `status`.

### `PATCH /api/admin/users/:id`

```json
{ "isDisabled": true }
```

Disabling a user:

- revokes all of their refresh tokens;
- blocks their existing access tokens on the next request (`403 ACCOUNT_DISABLED`);
- closes their open live-update streams;
- pauses their monitors' checks (disabled owners are skipped).

Re-enabling (`false`) lets them log in again.

| Status | Body / code                                                                               |
| ------ | ----------------------------------------------------------------------------------------- |
| 200    | `{ "user": { …same shape as the users list… } }`                                          |
| 400    | `CANNOT_DISABLE_SELF`, or `VALIDATION_ERROR` (unknown fields such as `role` are rejected) |
| 404    | `USER_NOT_FOUND`                                                                          |
