# Node.js concepts in PulseCheck

Each section covers what the concept is, where it lives in this codebase, and a likely
interview question with a short answer. In the code, search for `[Node concept:` to find
the comments that point at these places.

## PHP/Laravel → Node.js mapping

| Laravel / PHP                                    | PulseCheck (Node.js)                                             |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| PHP-FPM: one process per request, shared-nothing | One long-lived process; an event loop serves every request       |
| `routes/api.php` + controllers                   | `modules/*/*.routes.ts` + `*.controller.ts`                      |
| Form Requests (`rules()`)                        | Zod schemas + `middleware/validate.ts`                           |
| Middleware (`auth`, `can:`)                      | Express middleware (`requireAuth`, `requireAdmin`)               |
| `App\Exceptions\Handler`                         | `middleware/errorHandler.ts` (4-argument Express middleware)     |
| Eloquent models + migrations                     | Prisma schema, generated client, `prisma migrate`                |
| `DB::transaction()`                              | `prisma.$transaction(async (tx) => …)`                           |
| `Hash::make()` / `Hash::check()`                 | `bcrypt.hash()` / `bcrypt.compare()` (async, on the thread pool) |
| `config/*.php` + `.env`                          | `config/env.ts`: `process.loadEnvFile()` + Zod validation        |
| Artisan commands                                 | `scripts/*.ts` run with `tsx` via `npm run …`                    |
| `Log::info()` (Monolog)                          | Pino structured JSON logs with a request id per request          |
| Events + Listeners                               | `EventEmitter` event bus + alert/SSE listeners                   |
| Queues + scheduler (`schedule:run` via cron)     | In-process `setInterval` scheduler (see decisions.md)            |
| Mail + Mailables, Mailhog                        | Nodemailer over SMTP, Mailpit                                    |
| Sanctum / Passport                               | JWT access tokens + rotating refresh tokens                      |
| `composer.json` scripts, PSR-4 autoloading       | `package.json` scripts, ES Modules with explicit `.js` imports   |

---

## 1. Event loop, and why blocking is bad

**What:** Node runs JavaScript on a single thread. The event loop takes finished I/O
callbacks and timers off its queues and runs them one at a time. Microtasks (resolved
promises) run after each callback, before the next timer or I/O event. Any synchronous
CPU-heavy work, like `bcrypt.hashSync` or a big `JSON.parse`, stalls every other request
until it finishes.

**Where:** `backend/src/lib/password.ts` (`hashPassword`, `verifyPassword`) uses bcrypt's
async API, which runs on libuv's thread pool.

**Interview Q:** _Why does bcrypt have both `hash` and `hashSync`, and which belongs on a
server?_ **A:** `hashSync` blocks the event loop for the whole hash (~250ms at cost 12), so
every other request waits. `hash` hands the work to the libuv thread pool and resolves a
promise, so the loop keeps serving requests. Use the async one on servers.

## 10. crypto: `randomBytes`, SHA-256 hashing, `timingSafeEqual`

**What:** `node:crypto` gives cryptographically secure randomness (`randomBytes`,
`randomUUID`), hashes (`createHash('sha256')`) and a constant-time comparison
(`timingSafeEqual`) that doesn't leak how much of a secret matched through response timing.

**Where:** `backend/src/lib/tokens.ts`: `generateOpaqueToken`, `hashToken`, `safeEqual`.
Refresh tokens are stored as SHA-256 hashes (`auth.service.ts` → `issueSession`) and compared
with `safeEqual` in `authService.refresh`.

**Interview Q:** _Why store a SHA-256 of reset/refresh tokens but bcrypt for passwords?_
**A:** Passwords are low-entropy and guessable, so they need a slow, salted hash. Tokens are
256 random bits, which can't be brute-forced, so a fast hash is enough. It still means a
database leak doesn't hand over live sessions.

## 11. CLI with `node:readline/promises` and `process.argv` / stdin

**What:** `readline/promises` gives `await rl.question()` for prompts. `util.parseArgs`
parses `process.argv` without a dependency. `process.stdin` is a Readable stream that can be
consumed with `for await` when input is piped in.

**Where:** `backend/scripts/create-admin.ts`. Hidden password input works by giving readline
a custom `Writable` (`MutableStdout`) that drops writes while muted, so typed characters
aren't echoed. `process.stdin.isTTY` switches between interactive prompts and reading the
password from piped stdin.

**Interview Q:** _How do you detect whether a script is being piped into vs run in a
terminal?_ **A:** `process.stdin.isTTY` is `true` only for an interactive terminal. When
input is piped, read stdin as a stream instead of prompting.

## 12. Express middleware order and central error handling

**What:** middleware runs in registration order, and each one calls `next()` or ends the
response. An error handler has four arguments `(err, req, res, next)` and must come last.
Express 5 automatically forwards rejected promises from async handlers to it.

**Where:** `backend/src/app.ts` (`createApp`):
requestLogger → helmet → JSON body → cookies → routes → 404 → `errorHandler`.

**Interview Q:** _What happens in Express 4 vs 5 when an async route handler throws?_
**A:** In Express 4 the rejection is unhandled: the request hangs and the process may crash.
You needed `try/catch` + `next(err)` or an `asyncHandler` wrapper. Express 5 catches the
returned promise and calls `next(err)` for you.

## 13. Validation with Zod, and env validation at startup

**What:** Zod schemas validate and normalise untrusted input at runtime, and TypeScript types
are inferred from the same schema, so the types can't drift from the checks.

**Where:** `backend/src/config/env.ts` validates `process.env` once at startup and exits
with a readable list of problems. `backend/src/modules/auth/auth.schemas.ts` and
`backend/src/middleware/validate.ts` handle requests.

**Interview Q:** _Why validate env vars at startup instead of reading `process.env` where
needed?_ **A:** Fail fast. A missing secret should stop the deploy at boot, not cause a 500
hours later on the first request that needs it. You also get typed, coerced values (numbers,
booleans) in one place.

## 14. Auth: JWT access + rotating refresh tokens with reuse detection

**What:** a short-lived signed access token proves identity on each request. A long-lived
refresh token, kept in an httpOnly cookie, gets new access tokens. Each refresh revokes the
presented token and issues a new one in the same family. If an already-revoked token shows
up again, someone has a copy, so the whole family is revoked.

**Where:** `backend/src/modules/auth/auth.service.ts` (`refresh`, `issueSession`),
`backend/src/lib/tokens.ts`, `backend/src/middleware/requireAuth.ts`.

**Interview Q:** _How do you log out a JWT?_ **A:** You can't revoke a stateless access
token, so keep it short-lived (15 minutes) and revoke the refresh token server-side.
PulseCheck also looks up the user on each request, so disabling an account takes effect
immediately.

## 16. Database: Prisma, migrations, transactions, indexes, cascades

**What:** `schema.prisma` declares the models; `prisma migrate dev` turns schema changes
into SQL migration files. `$transaction` runs several writes atomically.
`onDelete: Cascade` lets PostgreSQL remove dependent rows.

**Where:** `backend/prisma/schema.prisma` (indexes are explained in comments),
`backend/prisma/migrations/`, and the transaction in `authService.refresh`.

**Interview Q:** _Why do the refresh-token revoke and create happen in one transaction with
a conditional update?_ **A:** Atomicity: a crash between the two must not leave the user
logged out or holding two valid tokens. `updateMany where revokedAt IS NULL` returns how many
rows changed, so two concurrent refreshes can't both succeed.

## 17. Email with Nodemailer (SMTP) and a local catcher

**What:** Nodemailer speaks SMTP to any mail server. Locally that server is Mailpit, which
accepts every message and shows it in a web inbox, so no real email ever leaves the machine.
In production only `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` change.

**Where:** `backend/src/lib/mailer.ts` (`mailer.send`, `mailer.sendInBackground`, pooled
transport closed on shutdown). The reset email is built in
`backend/src/modules/auth/auth.emails.ts` and sent from `passwordResetService.requestReset`.
Tests replace `mailer.send` with a `vi.spyOn` mock (`backend/tests/helpers/mail.ts`).

**Interview Q:** _Why doesn't the forgot-password endpoint await the email?_ **A:** Two
reasons. Awaiting SMTP would make responses for real accounts noticeably slower than for
unknown emails, which leaks who has an account through timing. It also ties the API's
latency and availability to the mail server's. The send runs in the background, and its
failure is logged rather than thrown.

## 19. Structured logging with request ids and redaction; health vs readiness

**What:** Pino writes JSON log lines. pino-http gives each request a child logger stamped
with its id. `redact` removes secrets before they're written. `/health` (liveness) says "the
process is alive"; `/ready` (readiness) says "I can serve traffic, the DB is reachable".

**Where:** `backend/src/lib/logger.ts`, `backend/src/middleware/requestId.ts`,
`backend/src/modules/health/health.routes.ts`.

**Interview Q:** _Why shouldn't the liveness probe check the database?_ **A:** If the
database blips, an orchestrator would restart every healthy API instance, which fixes nothing
and adds load. Liveness should only fail when restarting this process would actually help.

## 22. ES Modules, npm workspaces, scripts, `.env` handling

**What:** `"type": "module"` makes `.js`/`.ts` files ES modules. With `NodeNext` resolution,
relative imports include the `.js` extension of the compiled output. npm workspaces install
both packages from one lockfile and run scripts with `-w`. Node 22's
`process.loadEnvFile()` reads `.env` without the `dotenv` package.

**Where:** root `package.json` (`workspaces`, delegated scripts), `backend/tsconfig.json`,
`backend/src/config/env.ts`.

**Interview Q:** _Why do TypeScript ESM imports say `./app.js` when the file is `app.ts`?_
**A:** Node's ESM loader doesn't guess extensions. The import must name the file that exists
at runtime, which is the compiled `.js`. TypeScript resolves `./app.js` back to `app.ts` at
compile time.

---

_Sections 2–9, 15, 18, 20 and 21 are added as those features are built._
