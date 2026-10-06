# PulseCheck

**A multi-user uptime monitor.** Add your websites, and PulseCheck checks them on a schedule,
shows their status live, and emails you when one goes down or comes back up.

![PulseCheck dashboard: monitors with status, a strip of the last 30 checks, response time, uptime and SSL expiry](docs/screenshot.png)

## What it does

**For everyone**

- Sign up and log in; reset a forgotten password by email
- Monitor up to 20 websites, each checked every 5 minutes or more
- Live dashboard: status, the last 30 checks at a glance, response time, 24h uptime,
  days until the SSL certificate expires
- Detail page per site: 24-hour response-time chart, uptime over 24 hours, 7 days and
  30 days, incident history, full check history, CSV export
- Email alerts when a site goes down, recovers, or its SSL certificate is about to expire
- Pause, resume, edit, or check a site on demand

**For admins**

- **Overview:** users, monitors up and down, checks in the last 24 hours, the last check run
- **Users:** search accounts, see how many sites each user monitors, disable or re-enable
  accounts
- **Monitors:** every user's monitored URLs with status and owner (read-only), with search
  and filters

## Tech stack

### Backend

| Technology                                                                     | Version         | Used for                                                                             |
| ------------------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------ |
| [Node.js](https://nodejs.org)                                                  | 22 LTS or newer | Runtime (ES Modules, native `fetch`, `node:dns`, `node:tls`, `node:crypto`, streams) |
| [TypeScript](https://www.typescriptlang.org)                                   | 6.0             | Strict typing across the whole project                                               |
| [Express](https://expressjs.com)                                               | 5               | HTTP API, middleware, async error handling                                           |
| [PostgreSQL](https://www.postgresql.org)                                       | 17              | Database                                                                             |
| [Prisma](https://www.prisma.io)                                                | 7               | Schema, migrations, type-safe queries (`pg` driver adapter)                          |
| [Zod](https://zod.dev)                                                         | 4               | Request validation and environment validation at startup                             |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken)                     | 9               | Access tokens and rotating refresh tokens                                            |
| [bcrypt](https://github.com/kelektiv/node.bcrypt.js)                           | 6               | Password hashing                                                                     |
| [Nodemailer](https://nodemailer.com)                                           | 10              | Password-reset and alert emails over SMTP                                            |
| [Pino](https://getpino.io) + pino-http                                         | 10 / 11         | Structured JSON logs with request IDs and secret redaction                           |
| [helmet](https://helmetjs.github.io)                                           | 8               | Security headers                                                                     |
| [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) | 8               | Rate limiting on login, signup, password reset, check-now and the API as a whole     |
| cookie-parser                                                                  | 1               | Reading the httpOnly refresh-token cookie                                            |
| [tsx](https://tsx.is)                                                          | 4               | Running TypeScript directly in development and for CLI scripts                       |

### Frontend

| Technology                                   | Version     | Used for                                                              |
| -------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| [React](https://react.dev)                   | 19          | User interface                                                        |
| [Vite](https://vite.dev)                     | 8           | Dev server (with an `/api` proxy to the backend) and production build |
| [React Router](https://reactrouter.com)      | 7           | Routing, protected and admin-only routes, code splitting              |
| [TanStack Query](https://tanstack.com/query) | 5           | Server data fetching, caching and pagination                          |
| [Tailwind CSS](https://tailwindcss.com)      | 4           | Styling                                                               |
| [Recharts](https://recharts.org)             | 3           | Response-time chart                                                   |
| EventSource (Server-Sent Events)             | browser API | Live dashboard updates                                                |
| Schibsted Grotesk (Fontsource)               | 5           | Typeface, self-hosted                                                 |

### Testing and tooling

| Technology                                                     | Used for                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [Vitest](https://vitest.dev)                                   | Test runner for backend and frontend                                                                        |
| [Supertest](https://github.com/ladjs/supertest)                | Testing the API against a real PostgreSQL test database                                                     |
| [React Testing Library](https://testing-library.com) + jsdom   | Testing screens the way a user uses them                                                                    |
| [ESLint](https://eslint.org) + [Prettier](https://prettier.io) | Linting and formatting                                                                                      |
| npm workspaces                                                 | One repository, separate `backend` and `frontend` packages                                                  |
| [Docker Compose](https://docs.docker.com/compose/)             | Local PostgreSQL (development and test) and [Mailpit](https://mailpit.axllent.org) (catches emails locally) |
| [GitHub Actions](https://github.com/features/actions)          | CI: lint, format check, type-check and all tests on pushes to `main` and pull requests                      |

## Getting started

**You need:** Node.js 22 or newer, npm, and Docker Desktop.

```bash
git clone https://github.com/hamza0200/pulsecheck.git
cd pulsecheck
nvm use                                # optional: switch to the Node version in .nvmrc
npm install
cp backend/.env.example backend/.env
docker compose up -d                   # PostgreSQL (dev + test) and Mailpit
npm run db:migrate
npm run admin:create                   # creates the admin and adds 10 sample sites
npm run dev
```

Then open:

|                                  | URL                   |
| -------------------------------- | --------------------- |
| The app                          | http://localhost:5173 |
| API                              | http://localhost:4000 |
| Mailpit (emails sent by the app) | http://localhost:8025 |

Log in with the admin account you just created. The sample sites are checked within about a
minute. To try a normal account, use **Create an account** on the login page.

Ports already taken, or something not working? See
[docs/installation.md](docs/installation.md#troubleshooting).

## Project structure

```
pulsecheck/
├── backend/                 Express API
│   ├── prisma/              database schema, migrations, seed script
│   ├── scripts/             CLI tools (create admin)
│   ├── src/
│   │   ├── config/          environment validation
│   │   ├── lib/             shared tools: logging, email, tokens, rate limits, SSRF guard…
│   │   ├── middleware/      auth, validation, error handling, request logging
│   │   └── modules/         one folder per feature: auth, account, monitors, checks,
│   │                        incidents, alerts, stream, admin
│   └── tests/               API and unit tests
├── frontend/                React app
│   └── src/
│       ├── api/             API client and data hooks
│       ├── auth/            login state and route guards
│       ├── components/      shared UI
│       ├── pages/           one file per screen
│       └── tests/           screen and unit tests
├── docs/                    project documentation
└── docker-compose.yml       local PostgreSQL ×2 and Mailpit
```

## Scripts

Run from the repository root.

| Command                | What it does                                                             |
| ---------------------- | ------------------------------------------------------------------------ |
| `npm run dev`          | Start the API and the web app together                                   |
| `npm test`             | Run all backend and frontend tests                                       |
| `npm run lint`         | Lint the whole project                                                   |
| `npm run typecheck`    | Type-check both packages                                                 |
| `npm run format`       | Format all files with Prettier                                           |
| `npm run build`        | Production build of the API and the web app                              |
| `npm run db:migrate`   | Apply database migrations                                                |
| `npm run admin:create` | Create (or promote) an admin; the first admin also gets the sample sites |
| `npm run db:seed`      | Add the sample sites to the first admin again (safe to re-run)           |
| `npm run db:studio`    | Browse the database in Prisma Studio                                     |

## Documentation

| Document                                  | What's in it                                                          |
| ----------------------------------------- | --------------------------------------------------------------------- |
| [Installation](docs/installation.md)      | Running locally, testing emails, troubleshooting                      |
| [Architecture](docs/architecture.md)      | Diagrams, request flow, data model                                    |
| [API](docs/api.md)                        | Every endpoint with examples                                          |
| [Node.js concepts](docs/node-concepts.md) | The Node.js concepts used, where they live in the code, interview Q&A |
| [Decisions](docs/decisions.md)            | Design decisions and the alternatives considered                      |
| [Deployment](docs/deployment.md)          | How the app could be deployed                                         |
