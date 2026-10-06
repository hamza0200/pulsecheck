# Installing and running PulseCheck locally

PulseCheck runs entirely on your machine: a Node.js API, a React app served by Vite, and
three Docker containers (two PostgreSQL databases and the Mailpit email catcher).

## Prerequisites

| Tool           | Version                       | Check with               |
| -------------- | ----------------------------- | ------------------------ |
| Node.js        | 22.13 or newer (see `.nvmrc`) | `node -v`                |
| npm            | 10 or newer (ships with Node) | `npm -v`                 |
| Docker Desktop | any recent version            | `docker compose version` |

With [nvm](https://github.com/nvm-sh/nvm), run `nvm use` in the project root to switch to the
version in `.nvmrc` (`nvm install` first if you don't have Node 22 yet).

## First-time setup

```bash
git clone <your-fork-url> pulsecheck
cd pulsecheck
nvm use
npm install                               # installs both workspaces and runs `prisma generate`
cp backend/.env.example backend/.env      # local settings, never committed
docker compose up -d                      # Postgres (dev + test) and Mailpit
npm run db:migrate                        # create the tables in the dev database
npm run admin:create                      # prompts for the admin email and password
                                          # and adds 10 sample websites to that account
npm run db:seed                           # optional: re-adds the sample websites (idempotent)
npm run dev                               # API on :4000, web app on :5173
```

Open <http://localhost:5173>.

### What each service is

| Service         | URL / port            | Purpose                                            |
| --------------- | --------------------- | -------------------------------------------------- |
| Web app (Vite)  | http://localhost:5173 | The React app. `/api` is proxied to the API.       |
| API (Express)   | http://localhost:4000 | REST API, SSE stream, check scheduler.             |
| PostgreSQL      | localhost:5432        | Development database `pulsecheck`.                 |
| PostgreSQL test | localhost:5433        | Throwaway database for the test suite (in-memory). |
| Mailpit SMTP    | localhost:1025        | Receives every email the app sends.                |
| Mailpit inbox   | http://localhost:8025 | Web UI to read those emails.                       |

Quick sanity checks once `npm run dev` is running:

```bash
curl http://localhost:4000/health   # {"status":"ok",...}
curl http://localhost:4000/ready    # {"status":"ready"} when the DB is reachable
```

## Logging in as admin vs a normal user

- **Admin:** there are no admin credentials in `.env`. `npm run admin:create` stores the admin
  in the database (password hashed with bcrypt). Log in with those details on the normal login
  page; admins see an extra **Admin** link in the top navigation.
- **Normal user:** click **Create an account** on the login page. New accounts are always
  regular users and only ever see their own monitors.

To create the admin without prompts (for scripts), pipe the password on stdin:

```bash
echo 'a-long-password-here' | npm run admin:create -- --email admin@example.com
```

Running `admin:create` with an email that already exists offers to promote that user to admin.

### Sample monitors

When `admin:create` creates the **first** admin, it also adds ten sample monitors to that
account (the sites listed in `backend/src/modules/admin/demo-monitors.ts`). Pass `--no-seed`
to skip them (`npm run admin:create -- --no-seed`). Promoting an existing user never adds
them. `npm run db:seed` adds any missing samples to the first admin at any time and is safe
to re-run.

## Testing the forgot-password flow with Mailpit

1. Open <http://localhost:5173/forgot-password> and enter the email of an existing account.
2. Open the Mailpit inbox at <http://localhost:8025>. The reset email is there within a second.
3. Click the link in the email. It opens `/reset-password?token=…` in the app.
4. Choose a new password. Any other logged-in sessions of that user are signed out.

Down and recovery alerts for monitors also land in Mailpit, addressed to the monitor's owner.

## Running tests, lint and type-check

```bash
npm test               # backend (Vitest + Supertest, real test DB) then frontend (Vitest + RTL)
npm run test:backend   # backend only; migrates the test database automatically first
npm run test:frontend
npm run lint
npm run typecheck
npm run format:check
```

The backend tests need the `postgres-test` container running (`docker compose up -d`). They
never touch the development database: the test setup swaps `DATABASE_URL` for
`TEST_DATABASE_URL` before any app code loads.

## Troubleshooting

**A port is already in use.** If the API logs `Port 4000 is already in use`, another
process holds it: stop it (`lsof -i :4000` shows which) or change `PORT` in `backend/.env`.
For Docker, another project may already use 5432, 5433, 1025 or 8025.
Docker Compose reads host ports from a root `.env` file, so create `./.env` (next to
`docker-compose.yml`, not `backend/.env`) with for example:

```bash
POSTGRES_PORT=5434
POSTGRES_TEST_PORT=5435
MAILPIT_SMTP_PORT=1026
MAILPIT_UI_PORT=8026
```

then update the matching values in `backend/.env` (`DATABASE_URL`, `TEST_DATABASE_URL`,
`SMTP_PORT`) and run `docker compose up -d` again. For ports 4000/5173, set `PORT` in
`backend/.env` and start Vite with `API_URL=http://localhost:<port> npm run dev`.

**`ECONNREFUSED` / "Can't reach database server".** The containers aren't running or aren't
healthy yet. Run `docker compose ps`; start them with `docker compose up -d --wait`. Check
that the port in `DATABASE_URL` matches the one Compose published.

**"Cannot find module '../generated/prisma/client.js'".** The Prisma client hasn't been
generated (it lives in `backend/src/generated/`, which is git-ignored). Run
`npm run db:generate`. This normally runs automatically after `npm install`.

**"Invalid environment variables" on start.** The API validates `backend/.env` with Zod at
startup and lists each bad value. Compare your file against `backend/.env.example`.

**Emails don't arrive in Mailpit.** Check that the `mailpit` container is running and that
`SMTP_HOST`/`SMTP_PORT` in `backend/.env` point at it (`localhost` / `1025` by default). For
alerts, also check that the user has **alert emails** enabled on the Account page. If
delivery fails, the API logs `Failed to send email` (password reset) or
`Failed to send alert email` (alerts) with the reason.

**A site is wrongly marked down.** Some sites sit behind a firewall or bot protection
(Cloudflare, Sucuri, etc.) that blocks unknown clients or our honest
`PulseCheck/1.0 (local uptime monitor)` user agent, returning 403 or 503. Open the monitor's
detail page to see the status code and error for each check. Also check your own network:
corporate VPNs and DNS filters can block or redirect requests. A site is only marked down
after two consecutive failed checks.

An error like `CERT_HAS_EXPIRED` or `UNABLE_TO_VERIFY_LEAF_SIGNATURE` means the site's HTTPS
certificate really is broken. Browsers would show a warning too, so PulseCheck counts it as
down. The dashboard's **SSL expires in** column shows the days left, and the monitor's
detail page shows the exact expiry date.

**The dashboard says "No monitors yet" for the admin.** The samples go to the first admin
only when `admin:create` creates it. If the admin was created with `--no-seed`, was promoted
from an existing user, or was created before this feature existed, run `npm run db:seed`
and refresh.

**The dashboard says "Reconnecting…".** The live-update stream dropped, usually because the
API stopped or restarted (`tsx watch` restarts it on every backend file change). It
reconnects on its own with increasing delays; the data on screen refreshes once it's back.
If it never reconnects, check the API terminal for errors.

**A private or local URL is refused.** That's the SSRF guard (see
[node-concepts.md](./node-concepts.md)). For local testing only, set
`ALLOW_PRIVATE_TARGETS=true` in `backend/.env`.
