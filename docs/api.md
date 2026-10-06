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
