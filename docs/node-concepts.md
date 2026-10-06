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

## 2. Async/await, `Promise.all` vs `Promise.allSettled`

**What:** `await` pauses an async function without blocking the thread; other work runs
meanwhile. `Promise.all` rejects as soon as any promise rejects (fail fast) and resolves
with every value. `Promise.allSettled` waits for all of them and reports each outcome as
`{status: 'fulfilled', value}` or `{status: 'rejected', reason}`.

**Where:** `monitorsService.list` and `.get` (`backend/src/modules/monitors/monitors.service.ts`)
use `Promise.all` for independent queries, where any failure should fail the request.
`runWithLimit` (`backend/src/lib/concurrency.ts`) returns allSettled-style results, so in
`runner.ts` → `executeRun` one crashed check is logged and counted while the rest finish.

**Interview Q:** _When would you pick `allSettled` over `all`?_ **A:** When the tasks are
independent and partial success is useful: checking 500 websites, sending a batch of
notifications. With `all`, one rejection rejects the combined promise immediately, though
the other promises keep running unobserved and their results are lost.

## 3. Concurrency limiting (`runWithLimit`), and why `next++` needs no lock

**What:** start N "workers" that each pull the next task index from a shared counter until
none remain. At most N tasks are in flight at once, and results are stored by index to
preserve order.

**Where:** `backend/src/lib/concurrency.ts` (`runWithLimit`), used with a limit of 5 in
`backend/src/modules/checks/runner.ts` (`executeRun`).

**Interview Q:** _Two workers share `next` and both do `const i = next++`. Isn't that a race
condition?_ **A:** Not in Node. JavaScript runs on one thread, and a function only gives up
control at an `await`. `next++` is synchronous, so no other worker can run between reading
and incrementing it. Races in Node happen across `await` points, for example
read-from-DB → await → write-to-DB. That's why the monitor update uses a row lock.

## 4. Timeouts and cancellation (`AbortSignal.timeout`, `AbortController`)

**What:** an `AbortSignal` is a cancellation token that fetch, streams, timers and many Node
APIs accept. `AbortSignal.timeout(ms)` creates one that aborts itself after `ms`, so you
don't need to clear any timers. `AbortController` lets you abort manually. Aborting rejects
the pending operation and releases its socket.

**Where:** `backend/src/modules/checks/checker.ts` → `attemptCheck`: one
`AbortSignal.timeout(timeoutMs)` covers every redirect hop. Timeout errors are recognised by
`err.name === 'TimeoutError'` in `describeFetchError`. The TLS check uses
`socket.setTimeout` + `destroy` (`backend/src/modules/checks/ssl.ts`).

**Interview Q:** _Doesn't `Promise.race([fetch(url), timeout(5000)])` do the same?_ **A:** No.
The race stops you waiting, but the request keeps running in the background and holds a
socket until it finishes. An `AbortSignal` actually cancels the request.

## 5. Retries with exponential backoff and jitter

**What:** retry transient failures a bounded number of times, waiting longer each time
(base × 2^attempt) with randomness ("jitter") so many clients don't retry in lockstep.
Only retry errors that might succeed next time.

**Where:** `backend/src/lib/retry.ts` (`retry`, `backoffDelay`, full-jitter strategy).
`performCheck` in `checker.ts` retries once, only for `TransientCheckError` (timeouts,
network errors). HTTP 500 and SSRF blocks are never retried.

**Interview Q:** _Why add jitter?_ **A:** If a server blips and 1,000 clients fail at the
same moment, fixed backoff makes all 1,000 retry at the same moment again: a thundering herd
that can knock the server over as it recovers. Random delays spread the retries out.

## 6. Timers: `setInterval`, `.unref()`, cleanup on shutdown

**What:** timers are event-loop callbacks. An active timer keeps the process alive.
`.unref()` says "don't keep the process alive just for me". `clearInterval` stops one.
`node:timers/promises` provides an awaitable `setTimeout`.

**Where:** `backend/src/modules/checks/scheduler.ts` (`startScheduler`, `stopScheduler`:
startup `setTimeout` + 60-second `setInterval`, both unref'd). `waitForCurrentRun` in
`runner.ts` races the run against an unref'd awaitable timer. `server.ts` stops the scheduler
first on `SIGTERM`/`SIGINT`.

**Interview Q:** _What's `unref()` for, and why use it on the scheduler?_ **A:** Without it,
the interval alone would keep Node running forever after the HTTP server closes, so shutdown
would hang until something force-killed the process. With `unref()`, the process exits
naturally once real work is done.

## 7. `EventEmitter`: typed events, listener cleanup, `setMaxListeners`

**What:** `EventEmitter` is Node's built-in publish/subscribe mechanism. `emit` calls
listeners synchronously, in registration order. `@types/node` lets you type the event map
(`new EventEmitter<AppEvents>()`), so event names and payloads are checked. An `'error'`
event with no listener throws and crashes the process.

**Where:** `backend/src/lib/events.ts` (`events`, `AppEvents`). The runner
(`modules/checks/runner.ts` → `checkMonitor`) only calls `events.emit(...)`. Listeners:

- `backend/src/modules/alerts/alerts.service.ts` (`registerAlertListeners`, which returns an
  unsubscribe function).
- `backend/src/modules/stream/stream.service.ts` (`openStream` adds one listener per event
  per connection and removes them in `connection.close` on `req.on('close')`).

`events.setMaxListeners(MAX_CONNECTIONS + 10)` raises Node's default warning threshold of 10
to the number of streams we deliberately allow, so the "possible memory leak" warning still
fires if listeners ever leak beyond that.

**Interview Q:** _What causes "MaxListenersExceededWarning" and how do you fix it?_ **A:**
Usually a leak: something calls `.on()` per request or connection and never calls `.off()`,
so listeners, and everything their closures reference, pile up forever. Fix the cleanup
(remove listeners on `close`). Raise `setMaxListeners` only when many listeners are expected
by design, and even then keep a cap.

**Interview Q:** _Why an event bus instead of calling `sendEmail()` from the runner?_ **A:**
Decoupling. The runner shouldn't know who cares about a state change. Adding SSE, Slack or
webhooks means adding a listener, not editing and re-testing the runner. And a failure in
one listener is contained instead of breaking the check pipeline.

## 8. Streams: partial body reading, `Transform` + `pipeline` for CSV, backpressure

**What:** streams process data piece by piece instead of loading it all into memory.

- Readable streams can be read chunk by chunk and cancelled early.
- A `Transform` reshapes data as it flows through.
- `stream/promises` `pipeline()` connects stages, propagates errors and destroys every stage
  on failure.
- **Backpressure:** when the destination is slower than the source, `write()` returns
  `false`. `pipeline` pauses the source until the destination emits `'drain'`.

**Where:**

- Partial body reading: `backend/src/modules/checks/checker.ts` → `readBodyPrefix` reads at
  most 64 KB from `response.body`'s reader, then calls `cancel()`.
- CSV export:
  - `iterateChecks` (`checks.repository.ts`) is an async generator that pulls 1,000 rows at a
    time.
  - `Readable.from()` turns it into a stream.
  - `toCsvTransform` (`backend/src/lib/csv.ts`) turns row objects into CSV text.
  - `pipeline(rows, toCsv, res)` in `monitors.controller.ts` → `exportCsv`.
- Reading piped stdin with `for await`: `backend/scripts/create-admin.ts`.

**Interview Q:** _How would you export 10 million rows as CSV without running out of memory?_
**A:** Never build the whole file. Read in batches (keyset pagination or a DB cursor) from an
async generator, wrap it in `Readable.from`, transform rows to CSV lines, and `pipeline` into
the HTTP response. Backpressure makes a slow client slow down the reads, so memory stays at
about one batch. `pipeline` also cleans up if the client disconnects halfway.

## 9. Networking: `node:dns`, `node:net` IP checks, `node:tls`

**What:** `dns.lookup` resolves a hostname through the operating system's resolver, the same
path the HTTP client uses. `{ all: true }` returns every A/AAAA record. `net.isIP` tells IPv4
from IPv6, and `net.BlockList` matches addresses against CIDR ranges natively.

**Where:** `backend/src/modules/checks/ssl.ts` → `getCertificateExpiry` uses
`tls.connect({ host: <vetted IP>, port: 443, servername })` and reads
`getPeerCertificate().valid_to`. `backend/src/lib/ssrf-guard.ts`: `isPrivateAddress` (BlockList with private,
loopback, link-local and reserved ranges, unwrapping `::ffff:a.b.c.d`) and `assertPublicUrl`
(protocol/port rules plus `dns.lookup` of all addresses).

**Interview Q:** _What's the difference between `dns.lookup` and `dns.resolve4`?_ **A:**
`lookup` calls `getaddrinfo` on libuv's thread pool, honours `/etc/hosts`, and matches what
`http`/`fetch` will connect to. `resolve*` sends DNS queries over the network with c-ares,
skipping `/etc/hosts`. For SSRF checks you want what the client will actually use, so
`lookup`. Note that `lookup` uses the thread pool, so very many concurrent lookups can queue
behind each other (default pool size 4).

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

## 15. Security: helmet, rate limiting, IDOR, SSRF, user enumeration

**What:**

- **helmet** sets defensive HTTP headers.
- **Rate limits** slow brute force and abuse.
- **IDOR** (insecure direct object reference) means changing an id in a URL to reach someone
  else's data. It's prevented by scoping every query to the owner.
- **SSRF** (server-side request forgery) means tricking the server into requesting internal
  addresses on the attacker's behalf. The classic target is the cloud metadata endpoint
  `169.254.169.254`, which can leak cloud credentials.
- **User enumeration** means learning which emails have accounts from different responses
  or timings.

**Where:**

- helmet: `backend/src/app.ts`.
- Rate limits: `backend/src/lib/rateLimit.ts` plus the limiters in each `*.routes.ts`.
- IDOR: `backend/src/modules/monitors/monitors.repository.ts`, where every query takes
  `userId`, and the IDOR test in `backend/tests/monitors.test.ts`.
- SSRF: `backend/src/lib/ssrf-guard.ts`, called from `monitorsService.create/update` and, from
  milestone 5, the checker on every request and redirect hop.
- Enumeration: `authService.login` (same 401 plus `burnPasswordCheck` for unknown emails) and
  `passwordResetService.requestReset` (same 200 either way, email sent in the background).

**Interview Q:** _A user can enter any URL and your server fetches it. What can go wrong?_
**A:** SSRF. They can scan your internal network, hit admin panels on localhost, or read
cloud metadata credentials. Resolve the hostname and refuse private and reserved addresses,
re-check at request time because DNS can change, validate every redirect hop yourself
(`redirect: 'manual'`), and ideally pin the connection to the vetted IP to stop DNS
rebinding.

## 16. Database: Prisma, migrations, transactions, indexes, cascades

**What:** `schema.prisma` declares the models; `prisma migrate dev` turns schema changes
into SQL migration files. `$transaction` runs several writes atomically.
`onDelete: Cascade` lets PostgreSQL remove dependent rows.

**Where:** `backend/prisma/schema.prisma` (indexes are explained in comments),
`backend/prisma/migrations/`, and the transaction in `authService.refresh`.

**Cursor pagination and SQL aggregation:** `checksRepository.listPage`
(`backend/src/modules/checks/checks.repository.ts`) pages with
`WHERE (checked_at, id) < (cursor)` instead of `OFFSET`. `monitorRepository.uptimeStats` and
`uptime24h` compute uptime with `COUNT(*) FILTER (WHERE …)` in PostgreSQL rather than loading
checks into memory. `latestChecks` uses `CROSS JOIN LATERAL … LIMIT 1` so each monitor's
latest check is a single index lookup on `(monitor_id, checked_at DESC)`. The monitor-limit
transaction takes a `FOR UPDATE` row lock (`monitorRepository.lockUser`).

**Interview Q:** _Why cursor pagination instead of `LIMIT/OFFSET`?_ **A:** `OFFSET 10000`
still reads and discards 10,000 rows, so deep pages get slower. Rows inserted while someone
is paging also shift `OFFSET` pages, causing duplicates or gaps. A keyset cursor seeks
straight to the position through the index, so every page costs the same.

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

## 18. SSE real-time updates and ticket-based auth

**What:** Server-Sent Events are one long HTTP response with
`Content-Type: text/event-stream`. The server writes `event: name\ndata: json\n\n` blocks as
things happen. The browser's `EventSource` parses them and reconnects automatically.
Comment lines (`: heartbeat`) keep idle connections alive through proxies.

**Where:** `backend/src/modules/stream/`:

- `tickets.ts`: `issueTicket` / `consumeTicket`, a `Map` with a 60-second TTL and single
  use.
- `stream.routes.ts`: `POST /ticket`, `GET /`.
- `stream.service.ts` → `openStream`: headers, `flushHeaders`, per-user filtering, a 25-second
  heartbeat interval, and cleanup on `req.on('close')`. `closeAllStreams` runs during
  shutdown.

**Interview Q:** _`EventSource` can't set headers. How do you authenticate it?_ **A:** Use a
same-origin cookie, or exchange the access token for a short-lived, single-use ticket and
pass that in the query string. Never put the long-lived token itself in a URL: URLs end up in
logs and browser history.

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

_Sections 20 and 21 are added as those features are built._
