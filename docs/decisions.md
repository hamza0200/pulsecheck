# Design decisions

Short records: what we chose, what else we considered, why, and what would change at scale.

---

## Express 5 instead of NestJS or Fastify

- **Decision:** Express 5 with a small, explicit routes → controller → service → repository
  layout.
- **Alternatives:** NestJS (opinionated, decorators, dependency injection, close to Laravel's
  structure); Fastify (faster, schema-first, built-in logging).
- **Why:** Express is the most widely known Node framework, and its middleware model is the
  concept interviews probe. Express 5 finally forwards rejected promises from async handlers
  to the error handler, removing the old `asyncHandler` boilerplate. NestJS would hide the
  Node concepts this project is meant to show behind framework abstractions.
- **At scale:** Fastify's lower per-request overhead matters only at very high request rates;
  this app's work is dominated by outbound HTTP checks, not inbound requests. NestJS starts to
  pay off with many teams working on one codebase.

## Prisma instead of Drizzle (or raw SQL)

- **Decision:** Prisma 7 with the `pg` driver adapter and migrations from `schema.prisma`.
- **Alternatives:** Drizzle (SQL-like TypeScript query builder, lighter, no generate step);
  Knex or raw `pg` (full control, no type safety by default).
- **Why:** Prisma's schema file is the most readable single description of the data model,
  migrations are generated from it, and generated types flow into services. For the few
  queries that need real SQL (uptime aggregates), `$queryRaw` with tagged templates stays
  parameterised and safe from injection.
- **At scale:** Drizzle or raw SQL give finer control over complex queries and bundle size.
  Prisma's connection pool would need tuning, or a pooler such as PgBouncer, with many
  instances.

## JWT access token + rotating refresh token instead of server sessions

- **Decision:** a 15-minute JWT access token kept in memory by the browser and sent as a
  `Bearer` header, plus a 7-day refresh token in an `httpOnly`, `SameSite=Lax` cookie. Refresh
  tokens are stored only as SHA-256 hashes, rotated on every use, and grouped into a
  **family** per login. Presenting an already-revoked token revokes the whole family.
- **Alternatives:** classic server sessions (Laravel's default: a session id cookie plus a
  session store); long-lived JWTs with no refresh; opaque random refresh tokens instead of
  JWTs.
- **Why:** stateless access tokens are the industry-standard pattern for SPAs and are a
  common interview topic. Rotation with reuse detection means a stolen refresh token is
  usable at most once before it is detected. The refresh token is a JWT so it can be checked
  cheaply before any database lookup, and its `jti` claim points straight at its database row.
- **Trade-off we accepted:** `requireAuth` still does one primary-key lookup per request, so
  disabling or demoting a user takes effect immediately rather than when the access token
  expires. That gives up some of JWT's statelessness for correctness. Without it we would
  need a revocation list or very short token lifetimes.
- **Reuse detection is precise:** replaying a revoked token kills the family and is logged
  as theft only if the family still had a live token. Tokens revoked by logout, password
  reset or an admin disabling the user simply get `401 INVALID_REFRESH_TOKEN`.
- **Known edge case:** two browser tabs refreshing in the same instant would look like reuse.
  The frontend shares one in-flight refresh call per tab, which covers React StrictMode's
  double effects. A short "grace window" for just-rotated tokens would cover multiple tabs at
  the cost of slightly weaker reuse detection.
- **At scale:** works across any number of API instances with no shared session store.

## Admin creation via CLI instead of environment variables

- **Decision:** `npm run admin:create` prompts for the email and password (password hidden),
  validates them with the signup rules, hashes with bcrypt, and writes only to the database.
  It can also promote an existing user. A non-interactive form reads the password from stdin.
- **Alternatives:** `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` seeded on boot; promoting via
  raw SQL; a "first user to sign up becomes admin" rule.
- **Why:** environment variables leak into process listings, CI logs, crash reports and
  shell history, and stay valid long after they are needed. A plaintext admin password in
  `.env` is a common real-world breach. "First signup wins" is a race any visitor can take
  part in. A CLI needs shell access to the server, which already implies full trust.
- **At scale:** the same command runs once on the server after deployment (see
  [deployment.md](./deployment.md)). Larger systems would use SSO with role claims.

## SSRF strategy: resolve and check every address, at every step

- **Decision:** `lib/ssrf-guard.ts` only allows `http`/`https` on ports 80/443, rejects
  credentials in URLs, resolves the hostname with `dns.lookup({ all: true })`, and refuses the
  URL if **any** resolved address is loopback, private, link-local or reserved (checked with
  `net.BlockList`, IPv4-mapped IPv6 unwrapped). It runs when a monitor is created or its URL
  changes, again before every check (DNS can change after saving), and on every redirect hop
  (the checker follows redirects manually). `ALLOW_PRIVATE_TARGETS=true` disables the address
  check for local testing only; env validation refuses it in production.
- **Alternatives:** validate only at save time (defeated by changing DNS later, or by
  redirecting to `http://169.254.169.254`); a hostname denylist (defeated by any DNS name
  pointing at a private IP); sending checks through an egress proxy that enforces the policy
  at the network level.
- **Why:** checking resolved addresses rather than strings covers decimal/hex IP tricks,
  `localhost` aliases and attacker-controlled DNS. Re-checking at request time and per hop
  closes the "save a good URL, then change the DNS or redirect" holes.
- **Remaining gap (DNS rebinding):** `fetch` resolves the hostname again after our check, so
  a malicious DNS server with a ~0 TTL could answer "public" to the guard and "private" to
  the connection a few milliseconds later. The full fix is to connect to the exact IP we
  validated: an undici `Agent` with a custom `connect.lookup` that returns the vetted
  address (or the guard itself acting as the resolver). Another option is a network-level
  egress firewall or proxy.
- **At scale:** run checkers in an isolated network segment with an egress firewall that
  blocks private ranges, as defence in depth on top of the application guard.

## Per-user monitor limit enforced with a row lock

- **Decision:** creating a monitor runs in a transaction that first takes
  `SELECT … FROM users WHERE id = $1 FOR UPDATE`, then counts the user's monitors and inserts.
- **Alternatives:** count then insert without a lock (two parallel requests can both see 19
  and both insert); a `SERIALIZABLE` transaction with retries; a counter column with a
  `CHECK` constraint.
- **Why:** the lock makes concurrent creates by the same user run one after another, and
  doesn't affect other users. A test fires three creates at once with 19 existing monitors
  and expects exactly one to succeed.

## In-process scheduler instead of cron or a job queue (BullMQ)

- **Decision:** `scheduler.ts` calls `runChecks()` every 60 seconds with an `unref()`'d
  `setInterval` inside the API process. The runner works out which monitors are due from
  `last_checked_at` and each monitor's interval.
- **Alternatives:** system cron or a platform cron hitting a protected endpoint (Laravel's
  `schedule:run` model); a Redis-backed queue such as BullMQ with repeatable jobs and
  separate worker processes; Postgres-backed queues (pg-boss, graphile-worker).
- **Why:** zero extra infrastructure for a local app, and it demonstrates timers,
  `unref()` and graceful shutdown. Because "due" is computed from the database, a restart
  never loses schedule state: overdue monitors are simply picked up on the next tick.
- **At scale:** move checks to dedicated workers fed by a queue (BullMQ or pg-boss). That
  gives retries per job, horizontal scaling and isolation from API latency. See
  [deployment.md](./deployment.md) for why free hosting tiers that sleep also break an
  in-process scheduler.

## Down after 2 consecutive failures, up after 1 success

- **Decision:** a monitor becomes `DOWN` (opens an incident and emails the owner) only on
  its 2nd consecutive failed check. A single success marks it `UP` and resolves the incident.
  Implemented as the pure function `nextState` in `modules/checks/state-machine.ts`.
- **Alternatives:** down on the first failure (fastest, noisiest); N-of-M sliding window;
  confirmation from a second region before alerting.
- **Why:** a single failure is often a blip (a dropped packet, a deploy restart, a
  transient 502). Each check already retries network errors once, so 2 failed checks mean
  at least 3 failed requests spread over one interval: a strong signal. Recovery needs no
  confirmation, because a 2xx proves the site answered.
- **At scale:** multi-region confirmation is the standard next step, so one region's
  network trouble doesn't page anyone.

## Overlap guard now, advisory lock for multiple instances

- **Decision:** `runChecks()` keeps the in-flight run in a module variable. A trigger
  arriving while a run is still going returns `null` immediately. A per-monitor in-flight
  set also stops "check now" from racing the scheduler on the same monitor, and the state
  update takes a `FOR UPDATE` lock on the monitor row.
- **Alternatives:** let runs overlap (double checks and double alerts); queue the trigger
  to run after the current one (needless: the next tick picks up anything still due).
- **Why:** a slow site or a large backlog can make a run take longer than the 60-second
  tick.
- **At scale:** a module variable only protects one process. With several API instances,
  each would run the scheduler. Wrap the run in a Postgres advisory lock
  (`SELECT pg_try_advisory_lock(<key>)`, skipping the run if it returns false). Or claim work
  per monitor with `UPDATE … SET last_checked_at = now() WHERE … RETURNING` combined with
  `FOR UPDATE SKIP LOCKED`, which also lets instances share the load instead of electing one
  leader.

## Server-Sent Events instead of WebSockets or polling

- **Decision:** live dashboard updates go over SSE (`GET /api/stream`, `text/event-stream`),
  read in the browser with the native `EventSource`.
- **Alternatives:** WebSockets (bidirectional, needs a protocol upgrade and usually a
  library like `ws` or Socket.IO); polling `GET /api/monitors` every N seconds; long
  polling.
- **Why:** updates only flow server → browser. SSE is plain HTTP, so it works through the
  Vite proxy and ordinary reverse proxies, needs no library on either side, and
  `EventSource` reconnects automatically. Polling would mostly fetch "nothing changed" and
  delay updates by up to the poll interval.
- **At scale:** each open stream holds one connection and some listeners in one process.
  With several instances, a check run on instance A must reach users connected to instance
  B. Publish events through Redis pub/sub or Postgres `LISTEN/NOTIFY` instead of the
  in-process `EventEmitter`. HTTP/2 also removes the browser's ~6-connections-per-host limit
  for SSE on HTTP/1.1.

## SSE authentication with one-time stream tickets

- **Decision:** the client calls `POST /api/stream/ticket` with its access token and gets a
  random 256-bit ticket, valid for 60 seconds and single-use, stored in memory with the
  user id. It then opens `GET /api/stream?ticket=…`. The server consumes the ticket, checks
  the user is still active, and streams only that user's events.
- **Alternatives:**
  - **Access token in the query string:** simplest, but the 15-minute token ends up in
    server and proxy logs, browser history, and the `Referer` header.
  - **Cookie auth:** `EventSource` sends cookies on same-origin requests, so this would work
    with the Vite proxy. But our auth cookie is the refresh token, scoped to `/api/auth` on
    purpose. Adding a second, session-style cookie would bring back cookie sessions and the
    need for CSRF thinking.
  - **Polling or WebSockets:** see the previous record. WebSockets have the same
    "no custom header from the browser API" problem.
- **Why:** the ticket is worthless once used or after 60 seconds, so leaking it through a
  log line is harmless. It costs one extra request per connection.
- **At scale:** tickets in a process-local `Map` only work with one instance (or sticky
  sessions). Move them to Redis with a 60-second TTL and use `GETDEL` to consume them.

## Access token in memory, not localStorage

- **Decision:** the frontend keeps the 15-minute access token in a module variable
  (`frontend/src/api/client.ts`). The 7-day refresh token is an `httpOnly` cookie that
  JavaScript can't read. On page load the app calls `/api/auth/refresh` to get a new access
  token.
- **Alternatives:** `localStorage` or `sessionStorage` (survive reloads, readable by any
  script on the page); both tokens in cookies (needs CSRF protection on every mutating
  route); a server session cookie only.
- **Why:** any XSS bug can read `localStorage` and send a long-lived token to an attacker,
  who can then use it from anywhere. A token in memory dies with the tab, and the refresh
  cookie can't be read by script at all. XSS is still serious, since the attacker can make
  requests while the tab is open, but it can't take the credentials away. `SameSite=Lax`
  plus `Path=/api/auth` keeps the cookie off cross-site POSTs and every other route.
- **Cost:** one extra `/refresh` request on every page load, and concurrent 401s must
  share one refresh call (rotation would otherwise treat the second refresh as token reuse).
  The API client does this with a single in-flight promise.
