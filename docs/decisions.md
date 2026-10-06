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
